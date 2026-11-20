'use strict';
/**
 * 翻译调用链单元测试（F-05a / F-06 / M4-T4 / M4-T5）
 *
 * 用注入的 fetchImpl 模拟网关，验证：
 *  - 主用失败后自动切备用，engine 记为首个成功的 API 名称
 *  - 最多只尝试前 N 个（默认 2 个）
 *  - 全失败且离线不可用 → 抛出带用户提示的 TRANSLATE_ALL_FAILED
 *  - 全失败且离线可用 → 降级「离线模式」
 *  - 失败信息与 attempts 中不出现明文密钥（KEY-03）
 */
const test = require('node:test');
const assert = require('node:assert');

const { translate, testConnection, LOCAL_NOT_READY_MSG } = require('../../项目代码/src/core/translate/chain');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function completion(text) {
  return { choices: [{ message: { content: text } }] };
}

/** 按 host 分派响应，并记录调用顺序 */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const host = new URL(url).host;
    calls.push({ url, host, body: JSON.parse(init.body || '{}'), headers: init.headers || {} });
    const handler = routes[host];
    if (!handler) throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    return handler(init);
  };
  fn.calls = calls;
  return fn;
}

const APIS = [
  { id: 'a1', name: '主用API', baseUrl: 'https://primary.test/v1', model: 'm1', apiKey: 'sk-primary-secret', order: 0 },
  { id: 'a2', name: '备用API', baseUrl: 'https://backup.test/v1', model: 'm2', apiKey: 'sk-backup-secret', order: 1 },
  { id: 'a3', name: '第三个API', baseUrl: 'https://third.test/v1', model: 'm3', apiKey: 'sk-third-secret', order: 2 },
];

test('主用 401 后自动切到备用，engine 为备用名称', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(401, { error: 'invalid api key' }),
    'backup.test': () => jsonResponse(200, completion('你好世界')),
  });

  const res = await translate({
    text: 'Hello world', targetLang: 'zh', apis: APIS, fetchImpl,
  });

  assert.strictEqual(res.text, '你好世界');
  assert.strictEqual(res.engine, '备用API');
  assert.strictEqual(res.apiId, 'a2');
  assert.strictEqual(res.attempts.length, 2);
  assert.strictEqual(res.attempts[0].ok, false);
  assert.strictEqual(res.attempts[0].code, 'API_UNAUTHORIZED');
  assert.strictEqual(res.attempts[1].ok, true);
});

test('最多只尝试前 2 个候选（F-05a）', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(500, { error: 'boom' }),
    'backup.test': () => jsonResponse(500, { error: 'boom' }),
    'third.test': () => jsonResponse(200, completion('不应该被调用')),
  });

  await assert.rejects(
    () => translate({ text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl }),
    (e) => e.code === 'TRANSLATE_ALL_FAILED',
  );
  assert.strictEqual(fetchImpl.calls.length, 2, '默认 maxApiAttempts=2');
  assert.ok(fetchImpl.calls.every((c) => !c.url.includes('third.test')));
});

test('全失败且离线不可用 → 抛出带「离线模型未安装」提示的错误', async () => {
  const fetchImpl = makeFetch({});
  await assert.rejects(
    () => translate({ text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: false }),
    (e) => {
      assert.strictEqual(e.code, 'TRANSLATE_ALL_FAILED');
      assert.strictEqual(e.userMessage, LOCAL_NOT_READY_MSG);
      assert.ok(Array.isArray(e.details.attempts));
      return true;
    },
  );
});

test('全失败且离线可用 → 降级为「离线模式」', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(403, { error: 'forbidden' }),
    'backup.test': () => jsonResponse(404, { error: 'no model' }),
    '127.0.0.1:8081': () => jsonResponse(200, completion('离线译文')),
  });

  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: true,
  });
  assert.strictEqual(res.text, '离线译文');
  assert.strictEqual(res.engine, '离线模式');
  assert.strictEqual(res.apiId, null);
});

test('首个 API 成功即返回，不触碰备用', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(200, completion('直接成功')),
  });
  const res = await translate({ text: 'Hi', targetLang: 'zh', apis: APIS, fetchImpl });
  assert.strictEqual(res.text, '直接成功');
  assert.strictEqual(fetchImpl.calls.length, 1);
});

test('空文本直接返回空结果且不发请求', async () => {
  const fetchImpl = makeFetch({});
  const res = await translate({ text: '   ', targetLang: 'zh', apis: APIS, fetchImpl });
  assert.strictEqual(res.empty, true);
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('密钥只出现在 Authorization 头，失败信息中不含明文', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(401, { error: 'invalid' }),
    'backup.test': () => jsonResponse(401, { error: 'invalid' }),
  });
  let captured;
  try {
    await translate({
      text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: false,
    });
  } catch (e) { captured = e; }

  assert.ok(captured, '应抛出错误');
  const serialized = JSON.stringify({ msg: captured.message, user: captured.userMessage, details: captured.details });
  assert.ok(!serialized.includes('sk-primary-secret'), '错误信息不得包含明文密钥（KEY-03）');
  assert.strictEqual(fetchImpl.calls[0].headers.Authorization, 'Bearer sk-primary-secret');
});

test('用户主动取消立即中止（不降级离线）', async () => {
  const controller = new AbortController();
  const fetchImpl = async () => {
    controller.abort();
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  await assert.rejects(
    () => translate({ text: 'Hi', targetLang: 'zh', apis: APIS, fetchImpl, signal: controller.signal, offlineAvailable: true }),
    (e) => e.code === 'ABORTED',
  );
});

test('testConnection 成功返回样例与延迟', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(200, completion('你好')),
  });
  const r = await testConnection(APIS[0], { fetchImpl });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sample, '你好');
  assert.ok(typeof r.latencyMs === 'number');
});

test('testConnection 失败返回可读提示', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(401, { error: 'invalid key' }),
  });
  const r = await testConnection(APIS[0], { fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'API_UNAUTHORIZED');
  assert.ok(r.hint.includes('API Key'));
});

/* ---------------------------------------------- 第十八轮：在线 / 离线优先级（F-05b） */

test('离线优先：离线成功即返回，不触碰联网 API', async () => {
  const fetchImpl = makeFetch({
    '127.0.0.1:8081': () => jsonResponse(200, completion('离线先答')),
    'primary.test': () => jsonResponse(200, completion('不该被调用')),
  });
  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: true, priority: 'offline',
  });
  assert.strictEqual(res.text, '离线先答');
  assert.strictEqual(res.stage, 'offline');
  assert.strictEqual(res.fallback, false);
  assert.strictEqual(res.priority, 'offline');
  assert.strictEqual(fetchImpl.calls.length, 1, '只应打离线端口');
  assert.ok(fetchImpl.calls[0].url.includes('127.0.0.1:8081'));
});

test('离线优先：离线失败后自动改用联网 API 完成翻译', async () => {
  const fetchImpl = makeFetch({
    '127.0.0.1:8081': () => jsonResponse(500, { error: 'llama-server down' }),
    'primary.test': () => jsonResponse(200, completion('在线补齐')),
  });
  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: true, priority: 'offline',
  });
  assert.strictEqual(res.text, '在线补齐');
  assert.strictEqual(res.engine, '主用API');
  assert.strictEqual(res.stage, 'online');
  assert.strictEqual(res.fallback, true, '越过了优先通道，应标记为兜底');
  assert.strictEqual(res.attempts[0].stage, 'offline');
  assert.strictEqual(res.attempts[0].ok, false);
  assert.strictEqual(res.attempts[1].stage, 'online');
  assert.strictEqual(res.attempts[1].ok, true);
});

test('在线优先：在线全部失败后降级离线，stage 记为 offline', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(502, { error: 'bad gateway' }),
    'backup.test': () => jsonResponse(503, { error: 'unavailable' }),
    '127.0.0.1:8081': () => jsonResponse(200, completion('离线兜底')),
  });
  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: true,
  });
  assert.strictEqual(res.text, '离线兜底');
  assert.strictEqual(res.stage, 'offline');
  assert.strictEqual(res.fallback, true);
  assert.strictEqual(res.attempts.filter((a) => a.stage === 'online').length, 2);
});

test('离线优先但模型未就绪 → 直接走联网 API，并标记为兜底', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(200, completion('没有模型也能翻')),
  });
  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: false, priority: 'offline',
  });
  assert.strictEqual(res.text, '没有模型也能翻');
  assert.strictEqual(res.stage, 'online');
  assert.strictEqual(res.fallback, true);
  assert.ok(!fetchImpl.calls.some((c) => c.url.includes('127.0.0.1:8081')));
});

test('优先级非法值回落为在线优先', async () => {
  const fetchImpl = makeFetch({
    'primary.test': () => jsonResponse(200, completion('在线先答')),
    '127.0.0.1:8081': () => jsonResponse(200, completion('不该被调用')),
  });
  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis: APIS, fetchImpl, offlineAvailable: true, priority: 'whatever',
  });
  assert.strictEqual(res.text, '在线先答');
  assert.strictEqual(res.stage, 'online');
});
