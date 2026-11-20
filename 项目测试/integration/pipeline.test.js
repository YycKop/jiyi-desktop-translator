'use strict';
/**
 * 单轮翻译流水线测试（M1-T6 / M2-T3 / M3-T1 / F-11）
 *
 * `executeRound` 是「截图 → OCR → 去重 → 翻译 → 结果」的总编排，
 * 这里用桩件替换截图/OCR/翻译，验证编排逻辑本身（不触碰真实屏幕，符合 SCR-01/SCR-02）。
 */
const test = require('node:test');
const assert = require('node:assert');

const { executeRound, hashText, isOfflineAvailable } =
  require('../../项目代码/src/core/pipeline/round');

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, child() { return this; },
};

const REGION = { x: 100, y: 100, width: 200, height: 100 };

function baseConfig(over = {}) {
  return {
    general: { targetLang: 'zh', sourceLang: 'auto', dedupeEnabled: false, minRetranslateMs: 0 },
    capture: { lastSelection: REGION, intervalMs: 2000, mode: 'interval' },
    network: { primaryTimeoutMs: 5000, backupTimeoutMs: 3000, maxApiAttempts: 2 },
    offline: {},
    ...over,
  };
}

function makeDeps({ config = baseConfig(), ocrText = 'Hello World', apis = [], captureError = null, translate } = {}) {
  const calls = { capture: 0, ocr: 0, translate: [] };
  const deps = {
    logger: silentLogger,
    store: {
      raw: () => config,
      getEnabledApisOrdered: () => apis,
      getApiSecret: () => 'sk-test-0000',
    },
    capture: {
      captureRegion: async (region) => {
        calls.capture += 1;
        if (captureError) throw captureError;
        return { buffer: Buffer.from([1, 2, 3]), width: region.width, height: region.height, backend: 'mock', ms: 1 };
      },
    },
    ocr: {
      recognize: async () => { calls.ocr += 1; return { text: ocrText, lines: [], engine: 'mock', ms: 1 }; },
    },
    llama: { status: () => ({ running: false }), health: async () => ({ ok: false }) },
    translateFn: translate || (async ({ text, targetLang }) => {
      calls.translate.push({ text, targetLang });
      return { text: '你好世界', engine: 'MockEngine', apiId: 'a1', latencyMs: 3, attempts: [{ ok: true }] };
    }),
  };
  const state = { lastSource: '', lastSourceHash: '', lastTranslation: null, lastTranslateAt: 0 };
  return { deps, state, calls };
}

test('正常流程：截图 → OCR → 翻译，并返回耗时明细', async () => {
  const { deps, state, calls } = makeDeps();
  const res = await executeRound(deps, state, { regionOverride: REGION });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.sourceText, 'Hello World');
  assert.strictEqual(res.translatedText, '你好世界');
  assert.strictEqual(res.engine, 'MockEngine');
  assert.strictEqual(calls.capture, 1);
  assert.strictEqual(calls.ocr, 1);
  assert.strictEqual(calls.translate.length, 1);
  assert.strictEqual(calls.translate[0].targetLang, 'zh');
  assert.ok(res.timings && typeof res.timings.totalMs === 'number');
});

test('汉字间空格在送翻译前被折叠', async () => {
  // 目标语言用英文：中文→中文现在会走「无需翻译」短路（第八轮需求 4），不再调用翻译
  const { deps, state, calls } = makeDeps({
    config: baseConfig({ general: { targetLang: 'en', sourceLang: 'auto', dedupeEnabled: false, minRetranslateMs: 0 } }),
    ocrText: '欢 迎 使 用 桌 面 翻 译 助 手',
  });
  const res = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(calls.translate[0].text, '欢迎使用桌面翻译助手');
});

test('中文→中文 不调用翻译接口，直接返回原文（第八轮需求 4 的短路）', async () => {
  const { deps, state, calls } = makeDeps({ ocrText: '请点击保存按钮' });
  const res = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.translatedText, '请点击保存按钮');
  assert.ok(['无需翻译', '繁体转换'].includes(res.engine));
  assert.strictEqual(calls.translate.length, 0);
});

test('OCR 未识别到文字时返回 NO_TEXT，且不调用翻译', async () => {
  const { deps, state, calls } = makeDeps({ ocrText: '   ' });
  const res = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'NO_TEXT');
  assert.ok(res.userMessage.includes('未识别到文字'));
  assert.strictEqual(calls.translate.length, 0);
});

test('未设置框选区域时返回提示且不调用截图', async () => {
  const { deps, state, calls } = makeDeps({ config: baseConfig({ capture: { lastSelection: null } }) });
  const res = await executeRound(deps, state, {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'CONFIG_INVALID');
  assert.ok(res.userMessage.includes('框选'));
  assert.strictEqual(calls.capture, 0);
});

test('源语言与目标语言相同时直接返回「无需翻译」', async () => {
  const cfg = baseConfig();
  cfg.general.sourceLang = 'zh';
  const { deps, state, calls } = makeDeps({ config: cfg, ocrText: '这是一段中文' });
  const res = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.engine, '无需翻译');
  assert.strictEqual(res.translatedText, '这是一段中文');
  assert.strictEqual(calls.translate.length, 0);
});

test('开启去重时，短时间内相同原文返回 unchanged 复用上次译文', async () => {
  const cfg = baseConfig();
  cfg.general.dedupeEnabled = true;
  cfg.general.minRetranslateMs = 5000;
  const { deps, state } = makeDeps({ config: cfg });

  const first = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(first.ok, true);
  const second = await executeRound(deps, state, { regionOverride: REGION });

  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.unchanged, true);
  assert.strictEqual(second.translatedText, first.translatedText);
  assert.strictEqual(second.engine, first.engine);
});

test('force=true 时跳过去重强制重译', async () => {
  const cfg = baseConfig();
  cfg.general.dedupeEnabled = true;
  cfg.general.minRetranslateMs = 60000;
  const { deps, state, calls } = makeDeps({ config: cfg });

  await executeRound(deps, state, { regionOverride: REGION });
  const forced = await executeRound(deps, state, { regionOverride: REGION, force: true });
  assert.ok(!forced.unchanged);
  assert.strictEqual(calls.translate.length, 2);
});

test('截图失败转换为带用户提示的 CAPTURE_FAILED', async () => {
  // 与真实 capture 服务一致：抛带 code 的 AppError
  const boom = new Error('截图失败，请确认框选区域有效');
  boom.code = 'CAPTURE_FAILED';
  boom.userMessage = '截图失败，请确认框选区域有效';
  const { deps, state } = makeDeps({ captureError: boom });
  const res = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'CAPTURE_FAILED');
  assert.ok(res.userMessage.includes('截图失败'));
});

test('翻译全部失败且离线不可用时返回可读提示，不外泄异常细节', async () => {
  const translate = async () => {
    const e = new Error('upstream 500 with sk-live-abcdef');
    e.code = 'TRANSLATE_ALL_FAILED';
    e.userMessage = '离线模型未安装，请配置联网 API 或下载模型';
    throw e;
  };
  const { deps, state } = makeDeps({ translate });
  const res = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'TRANSLATE_ALL_FAILED');
  assert.ok(res.userMessage.includes('离线模型未安装'));
  assert.ok(!JSON.stringify(res).includes('sk-live-abcdef'));
});

test('API Key 解密失败时跳过该候选而不中断流程', async () => {
  const apis = [{ id: 'a1', name: 'A', baseUrl: 'https://a.test/v1', model: 'm', order: 0 }];
  const depsBundle = makeDeps({ apis });
  depsBundle.deps.store.getApiSecret = () => {
    const e = new Error('decrypt failed');
    e.code = 'SECRET_DECRYPT_FAILED';
    throw e;
  };
  const res = await executeRound(depsBundle.deps, depsBundle.state, { regionOverride: REGION });
  // 候选为空 → 直接走降级/失败路径，但不应抛出未捕获异常
  assert.strictEqual(typeof res.ok, 'boolean');
});

test('hashText 对同一文本稳定，不同文本不同', () => {
  assert.strictEqual(hashText('abc'), hashText('abc'));
  assert.notStrictEqual(hashText('abc'), hashText('abd'));
});

/* ------------------------------------------ 第十八轮：在线 / 离线优先级 */

test('离线优先：先拉起离线模型，并让调用链按 offline 起步', async () => {
  let readyCalls = 0;
  const seen = [];
  const translate = async (opts) => {
    seen.push(opts.priority);
    return { text: '离线译文', engine: '离线模式', apiId: null, latencyMs: 5, attempts: [] };
  };
  const bundle = makeDeps({ translate, config: baseConfig({ general: { targetLang: 'zh', sourceLang: 'auto', dedupeEnabled: false, minRetranslateMs: 0, priority: 'offline' } }) });
  bundle.deps.ensureOfflineReady = async () => { readyCalls += 1; };
  const res = await executeRound(bundle.deps, bundle.state, { regionOverride: REGION });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.engine, '离线模式');
  assert.deepStrictEqual(seen, ['offline'], '应把 priority=offline 传给调用链');
  assert.strictEqual(readyCalls, 1, '离线优先时即使配了 API 也要先把模型拉起来');
});

test('在线优先：仍把 online 传给调用链', async () => {
  const seen = [];
  const translate = async (opts) => {
    seen.push(opts.priority);
    return { text: '在线译文', engine: 'MockEngine', apiId: 'a1', latencyMs: 3, attempts: [] };
  };
  const apis = [{ id: 'a1', name: 'A', baseUrl: 'https://a.test/v1', model: 'm', order: 0 }];
  const bundle = makeDeps({ translate, apis });
  bundle.deps.ensureOfflineReady = async () => { throw new Error('不该被调用'); };
  const res = await executeRound(bundle.deps, bundle.state, { regionOverride: REGION });

  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(seen, ['online']);
});

test('离线优先时离线失败，链路自动改走在线（attempts 里 stage 依次 offline→online）', async () => {
  const { translate } = require('../../项目代码/src/core/translate/chain');
  const fetchImpl = async (url) => {
    const host = new URL(url).host;
    const body = (text) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });
    if (host === '127.0.0.1:8081') {
      return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'llama down' }) };
    }
    return body('在线补齐的译文');
  };
  const apis = [{ id: 'a1', name: '主用API', baseUrl: 'https://primary.test/v1', model: 'm1', apiKey: 'sk-test-000000', order: 0 }];
  const res = await translate({
    text: 'Hello', targetLang: 'zh', apis, offlineAvailable: true, priority: 'offline', fetchImpl,
  });
  assert.strictEqual(res.text, '在线补齐的译文');
  assert.strictEqual(res.stage, 'online');
  assert.strictEqual(res.fallback, true);
  assert.deepStrictEqual(res.attempts.map((a) => a.stage), ['offline', 'online']);
});

test('isOfflineAvailable 在 llama 未运行时为 false', async () => {
  assert.strictEqual(await isOfflineAvailable({ llama: null }), false);
  assert.strictEqual(await isOfflineAvailable({ llama: { status: () => ({ running: false }) } }), false);
  assert.strictEqual(
    await isOfflineAvailable({ llama: { status: () => ({ running: true }), health: async () => ({ ok: false }) } }),
    false,
  );
  assert.strictEqual(
    await isOfflineAvailable({ llama: { status: () => ({ running: true }), health: async () => ({ ok: true }) } }),
    true,
  );
});
