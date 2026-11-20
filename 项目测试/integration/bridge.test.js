'use strict';
/**
 * 宿主桥安全测试（M1-T3 / SEC-CORS-01 / KEY-03 / FS-03）
 *
 * 宿主桥是本项目里唯一对外开监听端口的组件，属限制书第 8 节「高风险代码」，
 * 因此逐条验证：仅本机监听、令牌鉴权、Origin 白名单（403）、体积上限、错误不泄漏密钥。
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { HostBridge, originAllowed, ALLOWED_ORIGIN_HOSTS } = require('../../项目代码/src/core/host/bridge');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };

/** 极简 HTTP 客户端，避免额外依赖 */
function request(port, { method = 'GET', path = '/health', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* 保留原文 */ }
        resolve({ status: res.statusCode, body: data, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function withBridge(handlers, fn) {
  const bridge = new HostBridge({ handlers, logger: silentLogger, port: 0 });
  const info = await bridge.start();
  try {
    return await fn(info, bridge);
  } finally {
    await bridge.stop();
  }
}

const handlers = {
  status: async () => ({ ok: true }),
  captureRegion: async (r) => ({ base64: 'iVBORw0KGgo=', width: r.width, height: r.height, ms: 1, backend: 'mock' }),
  ocrRegion: async (r) => ({ text: '识别到的一行文字', engine: 'mock-ocr', width: r.width, height: r.height, ms: 2 }),
  translateText: async (p) => ({ text: `译:${p.text}`, engine: 'mock', latencyMs: 1, apiId: null }),
  setSelectionRegion: async (r) => ({ saved: true, region: r }),
  showHud: async () => ({ shown: true }),
};

test('服务只监听 127.0.0.1，并携带随机令牌', async () => {
  await withBridge(handlers, async (info) => {
    assert.ok(info.token && info.token.length >= 20);
    const res = await request(info.port, { path: '/health' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);
    assert.strictEqual(res.json.service, 'desktop-translator-host');
  });
});

test('缺少或错误令牌 → 401', async () => {
  await withBridge(handlers, async (info) => {
    const noToken = await request(info.port, { path: '/v1/host/status' });
    assert.strictEqual(noToken.status, 401);
    assert.strictEqual(noToken.json.code, 'BRIDGE_UNAUTHORIZED');

    const badToken = await request(info.port, { path: '/v1/host/status', headers: { 'x-bridge-token': 'wrong' } });
    assert.strictEqual(badToken.status, 401);

    const good = await request(info.port, { path: '/v1/host/status', headers: { 'x-bridge-token': info.token } });
    assert.strictEqual(good.status, 200);
  });
});

test('恶意 Origin → 403（SEC-CORS-01 等价防护）', async () => {
  await withBridge(handlers, async (info) => {
    const evil = await request(info.port, {
      method: 'POST',
      path: '/v1/host/capture_region',
      headers: { 'x-bridge-token': info.token, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: { x: 0, y: 0, width: 10, height: 10 },
    });
    assert.strictEqual(evil.status, 403);
    assert.strictEqual(evil.json.code, 'FORBIDDEN_ORIGIN');

    const okLocal = await request(info.port, {
      method: 'POST',
      path: '/v1/host/capture_region',
      headers: { 'x-bridge-token': info.token, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: { x: 0, y: 0, width: 10, height: 10 },
    });
    assert.strictEqual(okLocal.status, 200);
  });
});

test('originAllowed 白名单只含本机', () => {
  assert.deepStrictEqual(ALLOWED_ORIGIN_HOSTS, ['127.0.0.1', 'localhost', '[::1]']);
  assert.strictEqual(originAllowed(undefined), true);
  assert.strictEqual(originAllowed('http://127.0.0.1:5173'), true);
  assert.strictEqual(originAllowed('http://localhost'), true);
  assert.strictEqual(originAllowed('https://evil.example'), false);
  assert.strictEqual(originAllowed('http://127.0.0.1.evil.example'), false);
});

test('capture_region 校验坐标数字', async () => {
  await withBridge(handlers, async (info) => {
    const bad = await request(info.port, {
      method: 'POST',
      path: '/v1/host/capture_region',
      headers: { 'x-bridge-token': info.token, 'content-type': 'application/json' },
      body: { x: 'a', y: 0, width: 10, height: 10 },
    });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.json.code, 'BAD_REGION');

    const good = await request(info.port, {
      method: 'POST',
      path: '/v1/host/capture_region',
      headers: { 'x-bridge-token': info.token, 'content-type': 'application/json' },
      body: { x: 1, y: 2, width: 30, height: 40 },
    });
    assert.strictEqual(good.status, 200);
    assert.strictEqual(good.json.width, 30);
  });
});

test('ocr_region 返回识别文本（插件不接触屏幕）', async () => {
  await withBridge(handlers, async (info) => {
    const headers = { 'x-bridge-token': info.token, 'content-type': 'application/json' };
    const res = await request(info.port, {
      method: 'POST', path: '/v1/host/ocr_region', headers, body: { x: 10, y: 20, width: 200, height: 100 },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.text, '识别到的一行文字');
    assert.strictEqual(res.json.engine, 'mock-ocr');
    assert.ok(!('base64' in res.json), 'OCR 接口不回传图像数据');
  });
});

test('translate_text 拒绝空文本与超长文本', async () => {
  await withBridge(handlers, async (info) => {
    const headers = { 'x-bridge-token': info.token, 'content-type': 'application/json' };
    const empty = await request(info.port, { method: 'POST', path: '/v1/host/translate_text', headers, body: { text: '   ' } });
    assert.strictEqual(empty.status, 400);
    assert.strictEqual(empty.json.code, 'EMPTY_TEXT');

    const huge = await request(info.port, {
      method: 'POST', path: '/v1/host/translate_text', headers, body: { text: 'x'.repeat(20001) },
    });
    assert.strictEqual(huge.status, 413);
    assert.strictEqual(huge.json.code, 'TEXT_TOO_LONG');

    const ok = await request(info.port, {
      method: 'POST', path: '/v1/host/translate_text', headers, body: { text: 'Hello', targetLang: 'zh' },
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.text, '译:Hello');
  });
});

test('未知路由 404，GET 打 POST 路由 405，非法 JSON 400', async () => {
  await withBridge(handlers, async (info) => {
    const headers = { 'x-bridge-token': info.token, 'content-type': 'application/json' };
    assert.strictEqual((await request(info.port, { path: '/nope', headers })).status, 404);
    assert.strictEqual((await request(info.port, { path: '/v1/host/capture_region', headers })).status, 405);
    const badJson = await request(info.port, { method: 'POST', path: '/v1/host/capture_region', headers, body: '{oops' });
    assert.strictEqual(badJson.status, 400);
    assert.strictEqual(badJson.json.code, 'BAD_JSON');
  });
});

test('handler 抛错返回 code，且不泄漏密钥类内容', async () => {
  const failing = {
    ...handlers,
    translateText: async () => {
      const e = new Error('upstream said sk-live-should-not-leak failed');
      e.code = 'TRANSLATE_ALL_FAILED';
      throw e;
    },
  };
  await withBridge(failing, async (info) => {
    const res = await request(info.port, {
      method: 'POST',
      path: '/v1/host/translate_text',
      headers: { 'x-bridge-token': info.token, 'content-type': 'application/json' },
      body: { text: 'secret text', targetLang: 'zh' },
    });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.json.ok, false);
    assert.ok(!res.body.includes('sk-live-should-not-leak'), '错误响应不得回显上游原始报文');
  });
});
