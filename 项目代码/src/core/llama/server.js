'use strict';
/**
 * llama-server 生命周期管理（core/llama/server.js）
 *
 * 依据 M1-T5 + SEC-CORS-01 + DSH-05（不改动外部源码，仅以子进程方式启动）：
 *   llama-server -m <gguf> --host 127.0.0.1 --port 8081 -c 4096 --cors-origins localhost
 *
 * 安全要点：
 *  - 只监听 127.0.0.1（不对外暴露）
 *  - 必须携带 --cors-origins localhost，避免恶意网页 CSRF 本地推理服务
 *  - 子进程 stdout/stderr 写入日志文件，但只保留启动摘要（不含 OCR 原文）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { err, CODES } = require('../errors');
const paths = require('../paths');

const DEFAULT_PORT = 8081;

function candidateBinaries(projectRoot) {
  // resourceRoot() 才是「runtime/ 所在的层级」：开发态 = 项目代码，打包态 = app\resources。
  // PROJECT_ROOT（工作区根）与 exe 目录作为旧布局兜底，避免升级后找不到。
  const roots = [paths.resourceRoot(), projectRoot, paths.appRoot()];
  const list = [];
  for (const root of roots) {
    list.push(path.join(root, 'runtime', 'llama', 'llama-server.exe'));
    list.push(path.join(root, 'runtime', 'llama', 'llama-server'));
    list.push(path.join(root, 'runtime', 'llama-server.exe'));
  }
  return [...new Set(list)];
}

class LlamaServerManager {
  constructor(opts = {}) {
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.offline = { ...(opts.offline || {}) };
    this.child = null;
    this.ready = false;
    this.lastError = null;
    this.startedAt = null;
    this.logStream = null;
    /** 最近一次被使用的时间（毫秒），空闲卸载用 */
    this.lastUsedAt = null;
    this.idleTimer = null;
  }

  updateConfig(offline) {
    this.offline = { ...this.offline, ...(offline || {}) };
    return this.offline;
  }

  get port() {
    return Number(this.offline.port) || DEFAULT_PORT;
  }

  get baseUrl() {
    return `http://${this.offline.host || '127.0.0.1'}:${this.port}`;
  }

  /** 解析可执行文件路径：配置优先，其次项目 runtime 目录，最后 PATH */
  resolveBinary() {
    const configured = (this.offline.serverPath || '').trim();
    if (configured && fs.existsSync(configured)) return configured;
    for (const p of candidateBinaries(paths.PROJECT_ROOT)) {
      if (fs.existsSync(p)) return p;
    }
    return 'llama-server.exe'; // 依赖 PATH
  }

  resolveModel() {
    const configured = (this.offline.modelPath || '').trim();
    if (configured) return configured;
    // 分发版把模型随包放在 app/resources/models/（只读位置），
    // 用户自己下载的模型放数据目录 models/，两处都找，数据目录优先。
    const dirs = [paths.modelsDir(), path.join(paths.PROJECT_ROOT, 'models')];
    for (const dir of dirs) {
      try {
        const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'));
        if (files.length) return path.join(dir, files[0]);
      } catch { /* 目录不存在 */ }
    }
    return '';
  }

  status() {
    return {
      running: !!this.child && !this.child.killed && this.child.exitCode === null,
      ready: this.ready,
      pid: this.child ? this.child.pid : null,
      port: this.port,
      baseUrl: this.baseUrl,
      contextSize: Number(this.offline.contextSize) || 4096,
      threads: Number(this.offline.threads) || 0,
      binaryPath: this.resolveBinary(),
      modelPath: this.resolveModel(),
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  buildArgs() {
    const model = this.resolveModel();
    const args = [
      '-m', model,
      '--host', this.offline.host || '127.0.0.1',
      '--port', String(this.port),
      '-c', String(Number(this.offline.contextSize) || 4096),
      // SEC-CORS-01：必须限定来源，禁止默认反射任意 Origin
      '--cors-origins', this.offline.corsOrigins || 'localhost',
    ];
    const threads = Number(this.offline.threads) || 0;
    if (threads > 0) args.push('-t', String(threads));
    const gpu = Number(this.offline.gpuLayers) || 0;
    if (gpu > 0) args.push('-ngl', String(gpu));
    return args;
  }

  async start() {
    if (this.status().running) return this.status();

    const binary = this.resolveBinary();
    const model = this.resolveModel();
    if (!model) {
      this.lastError = 'MODEL_MISSING';
      throw err(CODES.MODEL_MISSING, '未找到 GGUF 模型文件');
    }
    const usingPath = !fs.existsSync(binary);
    if (usingPath && !binary.includes('llama-server')) {
      this.lastError = 'LLAMA_NOT_INSTALLED';
      throw err(CODES.LLAMA_NOT_INSTALLED, '未找到 llama-server 可执行文件');
    }
    if (!fs.existsSync(binary) && process.platform === 'win32') {
      // 交给 PATH；若不存在 spawn 会报 ENOENT
      this.logger.warn('llama-server 未在预期位置找到，尝试 PATH');
    }

    const args = this.buildArgs();
    paths.ensure.logs();
    fs.mkdirSync(path.dirname(paths.llmLogFile()), { recursive: true });
    this.logStream = fs.createWriteStream(paths.llmLogFile(), { flags: 'a' });

    this.logger.info('启动 llama-server', {
      binary: path.basename(binary), port: this.port, ctx: this.offline.contextSize, cors: this.offline.corsOrigins,
    });

    try {
      this.child = spawn(binary, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
    } catch (e) {
      this.lastError = e.message;
      throw err(CODES.LLAMA_START_FAILED, 'llama-server 启动失败', { reason: e.code || '' });
    }

    this.child.stdout.on('data', (d) => { if (this.logStream) this.logStream.write(d); });
    this.child.stderr.on('data', (d) => {
      if (this.logStream) this.logStream.write(d);
      const s = d.toString('utf8');
      if (/error|failed/i.test(s)) this.logger.warn('llama-server 输出错误', { len: s.length });
    });
    this.child.on('error', (e) => {
      this.lastError = e.code || e.message;
      this.ready = false;
      this.logger.error('llama-server 进程错误', { code: e.code || '' });
    });
    this.child.on('exit', (code, signal) => {
      this.ready = false;
      this.startedAt = null;
      this.logger.warn('llama-server 退出', { code, signal });
      if (this.logStream) { try { this.logStream.end(); } catch { /* noop */ } this.logStream = null; }
    });

    this.startedAt = new Date().toISOString();
    this.touch();
    return this.status();
  }

  async health(timeoutMs = 1500) {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      const ok = res.ok;
      this.ready = ok;
      return { ok, status: res.status };
    } catch (e) {
      this.ready = false;
      return { ok: false, status: 0, reason: String(e && e.name || '') };
    }
  }

  /** 轮询等待就绪（首次加载模型可能 5~30s） */
  async waitReady(timeoutMs = 60000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const h = await this.health();
      if (h.ok) { this.ready = true; this.touch(); return true; }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  /**
   * 记录「刚用过」的时间，并确保空闲卸载定时器在跑。
   * 第二十二轮：模型常驻要 1.9–2.2 GB，闲下来就该让出来。
   */
  touch() {
    this.lastUsedAt = Date.now();
    this.armIdleTimer();
  }

  armIdleTimer() {
    const idleMs = Number(this.offline && this.offline.idleStopMs) || 0;
    if (idleMs <= 0) {
      this.disarmIdleTimer();
      return;
    }
    if (this.idleTimer) return;
    // 每 30s 检查一次，开销可以忽略
    this.idleTimer = setInterval(async () => {
      const idleFor = Date.now() - (this.lastUsedAt || Date.now());
      if (!this.child || idleFor < idleMs) return;
      this.logger.info('离线模型空闲卸载', { idleSeconds: Math.round(idleFor / 1000) });
      this.disarmIdleTimer();
      try { await this.stop(); } catch { /* 已经停了 */ }
    }, 30000);
    this.idleTimer.unref?.();
  }

  disarmIdleTimer() {
    if (!this.idleTimer) return;
    clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  async stop() {
    this.disarmIdleTimer();
    if (!this.child) return { stopped: false };
    const child = this.child;
    this.child = null;
    this.ready = false;
    return new Promise((resolve) => {
      const done = () => {
        if (this.logStream) { try { this.logStream.end(); } catch { /* noop */ } this.logStream = null; }
        resolve({ stopped: true });
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
        done();
      }, 3000);
      child.once('exit', () => { clearTimeout(timer); done(); });
      try { child.kill(); } catch { clearTimeout(timer); done(); }
    });
  }
}

module.exports = { LlamaServerManager, DEFAULT_PORT };
