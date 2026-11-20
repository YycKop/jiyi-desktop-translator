'use strict';
/**
 * 宿主桥（core/host/bridge.js）
 *
 * 依据 F-03 / M1-T3 / M1-T4 / PLG-04：
 *  DSH 侧插件不直接操作屏幕、也不持有用户 API Key。所有系统能力（截图、翻译）
 *  由宿主壳通过本机 HTTP 桥提供：
 *    POST /v1/host/capture_region   {x,y,width,height}  -> {base64,width,height,ms}
 *    POST /v1/host/ocr_region       {x,y,width,height}  -> {text,engine,width,height,ms}
 *    POST /v1/host/translate_text   {text,targetLang}   -> {text,engine,latencyMs}
 *    POST /v1/host/set_selection_region {x,y,width,height}
 *    POST /v1/host/hud/show         {text,engine}
 *    GET  /v1/host/status
 *    GET  /health
 *
 * 安全约束：
 *  - 只监听 127.0.0.1（不对外可达）
 *  - 每次启动生成一次性令牌，写入 bridge.json（不含任何用户密钥），插件读取后随请求携带
 *  - 校验 Origin：存在 Origin 头且不在白名单时 403（防御浏览器侧 CSRF，SEC-CORS-01 同理）
 *  - 不记录请求正文；日志仅记录路径、状态码与耗时
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { err, CODES, normalize } = require('../errors');
const { safeEqual } = require('../security/secrets');

const MAX_BODY = 256 * 1024;
const ALLOWED_ORIGIN_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        const e = new Error('body too large');
        e.code = 'BODY_TOO_LARGE';
        req.destroy();
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function originAllowed(origin) {
  if (!origin) return true; // 非浏览器客户端（Node/插件）
  try {
    const u = new URL(origin);
    if (!ALLOWED_ORIGIN_HOSTS.includes(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function describeError(e) {
  const ae = normalize(e, CODES.TRANSLATE_ALL_FAILED);
  // 只回传可读摘要，且抹除可能的密钥片段：上游报错常把 Authorization 里的
  // 令牌原样带回，直接透出等于把用户 Key 泄漏给调用方（KEY-03）。
  const raw = String(ae.userMessage || ae.message || '处理失败');
  const error = raw.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-****').slice(0, 200);
  return {
    ok: false,
    code: ae.code,
    error,
  };
}

/** 只有这些路径是 POST 接口，其余路径无论方法一律 404 */
const POST_ROUTES = new Set([
  '/v1/host/capture_region',
  '/v1/host/ocr_region',
  '/v1/host/translate_text',
  '/v1/host/set_selection_region',
  '/v1/host/hud/show',
]);

class HostBridge {
  /**
   * @param {object} opts
   * @param {object} opts.handlers {captureRegion, translateText, setSelectionRegion, showHud, status}
   * @param {object} opts.logger
   * @param {number} [opts.port] 0 = 随机端口
   */
  constructor(opts) {
    this.handlers = opts.handlers || {};
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.port = opts.port || 0;
    this.token = crypto.randomBytes(24).toString('base64url');
    this.server = null;
    this.sockets = new Set();
    this.startedAt = null;
  }

  _auth(req) {
    const token = req.headers['x-bridge-token'];
    if (!token || !safeEqual(token, this.token)) return false;
    return true;
  }

  _send(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  async _route(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;

    res.on('finish', () => {
      this.logger.debug('宿主桥请求', { route, status: res.statusCode, ms: Date.now() - started });
    });

    if (!originAllowed(req.headers.origin)) {
      this._send(res, 403, { ok: false, code: 'FORBIDDEN_ORIGIN', error: 'Origin 不被允许' });
      return;
    }

    if (route === 'GET /health') {
      this._send(res, 200, { ok: true, service: 'desktop-translator-host', pid: process.pid, startedAt: this.startedAt });
      return;
    }

    if (!this._auth(req)) {
      this.logger.warn('宿主桥鉴权失败', { route });
      this._send(res, 401, { ok: false, code: CODES.BRIDGE_UNAUTHORIZED, error: '未授权：缺少或错误的一次性令牌' });
      return;
    }

    try {
      if (route === 'GET /v1/host/status') {
        const status = this.handlers.status ? await this.handlers.status() : {};
        this._send(res, 200, { ok: true, ...status });
        return;
      }

      if (req.method !== 'POST' && POST_ROUTES.has(url.pathname)) {
        this._send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '方法不被允许' });
        return;
      }
      if (!POST_ROUTES.has(url.pathname)) {
        this._send(res, 404, { ok: false, code: 'NOT_FOUND', error: '未知接口' });
        return;
      }

      const raw = await readBody(req);
      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch {
          this._send(res, 400, { ok: false, code: 'BAD_JSON', error: '请求体不是合法 JSON' });
          return;
        }
      }

      if (route === 'POST /v1/host/capture_region') {
        const { x, y, width, height } = body || {};
        if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
          this._send(res, 400, { ok: false, code: 'BAD_REGION', error: '需要数字字段 x/y/width/height' });
          return;
        }
        const r = await this.handlers.captureRegion({ x, y, width, height });
        const base64 = r && r.buffer ? Buffer.from(r.buffer).toString('base64') : String((r && r.base64) || '');
        this._send(res, 200, {
          ok: true, base64, width: r.width, height: r.height, ms: r.ms, backend: r.backend,
        });
        return;
      }

      if (route === 'POST /v1/host/ocr_region') {
        const { x, y, width, height } = body || {};
        if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
          this._send(res, 400, { ok: false, code: 'BAD_REGION', error: '需要数字字段 x/y/width/height' });
          return;
        }
        const r = await this.handlers.ocrRegion({ x, y, width, height });
        this._send(res, 200, {
          ok: true, text: r.text, engine: r.engine, width: r.width, height: r.height, ms: r.ms,
        });
        return;
      }

      if (route === 'POST /v1/host/translate_text') {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) {
          this._send(res, 400, { ok: false, code: 'EMPTY_TEXT', error: 'text 不能为空' });
          return;
        }
        if (text.length > 20000) {
          this._send(res, 413, { ok: false, code: 'TEXT_TOO_LONG', error: '文本过长（上限 20000 字符）' });
          return;
        }
        const r = await this.handlers.translateText({
          text,
          targetLang: body.targetLang || 'zh',
          sourceLang: body.sourceLang || 'auto',
        });
        this._send(res, 200, {
          ok: true, text: r.text, engine: r.engine, latencyMs: r.latencyMs, apiId: r.apiId || null,
        });
        return;
      }

      if (route === 'POST /v1/host/set_selection_region') {
        const { x, y, width, height } = body || {};
        const r = await this.handlers.setSelectionRegion({ x, y, width, height });
        this._send(res, 200, { ok: true, ...r });
        return;
      }

      if (route === 'POST /v1/host/hud/show') {
        const r = await this.handlers.showHud({
          text: String(body.text || ''),
          engine: String(body.engine || ''),
          source: typeof body.source === 'string' ? body.source : '',
        });
        this._send(res, 200, { ok: true, ...r });
        return;
      }

      this._send(res, 404, { ok: false, code: 'NOT_FOUND', error: '未知接口' });
    } catch (e) {
      const payload = describeError(e);
      const status = payload.code === CODES.ABORTED ? 499 : 500;
      this.logger.warn('宿主桥处理失败', { route, code: payload.code });
      this._send(res, status, payload);
    }
  }

  async start() {
    if (this.server) return { port: this.port, token: this.token };
    this.server = http.createServer((req, res) => { this._route(req, res).catch(() => res.destroy()); });
    this.server.on('connection', (sock) => {
      this.sockets.add(sock);
      sock.on('close', () => this.sockets.delete(sock));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.port = this.server.address().port;
    this.startedAt = new Date().toISOString();
    this.logger.info('宿主桥已启动', { port: this.port });
    return { port: this.port, token: this.token };
  }

  /** 把端口与一次性令牌写进 bridge.json（权限 0600），供 DSH 插件读取 */
  writeBridgeFile(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = {
      port: this.port,
      token: this.token,
      pid: process.pid,
      startedAt: this.startedAt,
      api: 'desktop-translator-host-bridge/1',
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* Windows 上可能不支持 */ }
    return file;
  }

  removeBridgeFile(file) {
    try { fs.unlinkSync(file); } catch { /* 已删除 */ }
  }

  async stop() {
    if (!this.server) return { stopped: false };
    const server = this.server;
    this.server = null;
    for (const sock of this.sockets) { try { sock.destroy(); } catch { /* noop */ } }
    this.sockets.clear();
    await new Promise((resolve) => server.close(() => resolve()));
    this.logger.info('宿主桥已关闭');
    return { stopped: true };
  }
}

module.exports = {
  HostBridge, readBody, originAllowed, ALLOWED_ORIGIN_HOSTS,
};
