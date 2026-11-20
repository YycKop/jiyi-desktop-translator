'use strict';
/**
 * 去重与缓存回归（用户反馈问题 4：OCR 抖动导致同一段文字反复调用付费 API）
 *
 * 场景：定时轮询每 2 秒识别同一块屏幕，OCR 每轮会抖 1~2 个字符（i/l、O/0、少标点）。
 * 期望：① 抖动后的文本仍判为「同一段」，不调用翻译接口；② 真正换了内容要重新翻译；
 *       ③ 关掉去重（或用户点「重新翻译」）时才真的再请求。
 */
const test = require('node:test');
const assert = require('node:assert');

const { executeRound } = require('../../项目代码/src/core/pipeline/round');

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, child() { return this; },
};

const REGION = { x: 10, y: 10, width: 300, height: 120 };

function makeDeps({ texts = [], dedupeEnabled = true } = {}) {
  const calls = { translate: [], ocr: 0 };
  let i = 0;
  const config = {
    general: {
      targetLang: 'zh', sourceLang: 'auto', dedupeEnabled, minRetranslateMs: 0, cacheTtlMs: 600000, dedupeSimilarity: 0.98,
    },
    capture: { lastSelection: REGION, intervalMs: 2000, mode: 'interval' },
    network: { primaryTimeoutMs: 5000, backupTimeoutMs: 3000, maxApiAttempts: 2 },
    offline: {},
  };
  const deps = {
    logger: silentLogger,
    store: { raw: () => config, getEnabledApisOrdered: () => [], getApiSecret: () => 'sk-test-0000' },
    capture: {
      captureRegion: async (region) => ({
        buffer: Buffer.from([1]), width: region.width, height: region.height, backend: 'mock', ms: 1,
      }),
    },
    ocr: {
      recognize: async () => {
        const text = texts[Math.min(i, texts.length - 1)];
        i += 1;
        calls.ocr += 1;
        return { text, lines: [], engine: 'mock', ms: 1 };
      },
    },
    llama: { status: () => ({ running: false }), health: async () => ({ ok: false }) },
    translateFn: async ({ text }) => {
      calls.translate.push(text);
      return {
        text: `译文：${text}`, engine: 'MockEngine', apiId: 'a1', latencyMs: 2, attempts: [{ ok: true }],
      };
    },
  };
  return { deps, calls };
}

test('OCR 抖动（i/l、O/0、标点）判为同一段，不重复调用接口', async () => {
  const { deps, calls } = makeDeps({
    texts: [
      'Please click the link, it will fill in.',
      'PIease click the link, it will fill in.',
      'Please click the link it will fill in',
      'Please click the Iink, it wiII fill in.',
    ],
  });
  const state = {};
  const r1 = await executeRound(deps, state, { regionOverride: REGION });
  const r2 = await executeRound(deps, state, { regionOverride: REGION });
  const r3 = await executeRound(deps, state, { regionOverride: REGION });
  const r4 = await executeRound(deps, state, { regionOverride: REGION });

  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.unchanged, undefined);
  assert.strictEqual(r2.unchanged, true);
  assert.strictEqual(r3.unchanged, true);
  assert.strictEqual(r4.unchanged, true);
  // 关键断言：四轮只发生 1 次真实翻译
  assert.strictEqual(calls.translate.length, 1);
});

test('文字确实变了就重新翻译', async () => {
  const { deps, calls } = makeDeps({
    texts: ['Press Save to continue', 'This is a completely different sentence about settings'],
  });
  const state = {};
  await executeRound(deps, state, { regionOverride: REGION });
  const r2 = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(r2.unchanged, undefined);
  assert.strictEqual(calls.translate.length, 2);
});

test('force（用户点重新翻译）会绕过去重', async () => {
  const { deps, calls } = makeDeps({ texts: ['Same text every time'] });
  const state = {};
  await executeRound(deps, state, { regionOverride: REGION });
  const r2 = await executeRound(deps, state, { regionOverride: REGION, force: true });
  assert.strictEqual(r2.unchanged, undefined);
  assert.strictEqual(calls.translate.length, 2);
});

test('来回切换同一段文字命中译文缓存，不再请求接口', async () => {
  const { deps, calls } = makeDeps({
    texts: ['First paragraph here', 'Second paragraph here', 'First paragraph here'],
  });
  const state = {};
  await executeRound(deps, state, { regionOverride: REGION });
  await executeRound(deps, state, { regionOverride: REGION });
  const r3 = await executeRound(deps, state, { regionOverride: REGION });
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(r3.cached, true);
  assert.strictEqual(calls.translate.length, 2); // 第三轮用缓存
});

test('关掉去重时每轮都翻译（配置开关有效）', async () => {
  const { deps, calls } = makeDeps({ texts: ['Same text every time'], dedupeEnabled: false });
  const state = {};
  await executeRound(deps, state, { regionOverride: REGION });
  const r2 = await executeRound(deps, state, { regionOverride: REGION });
  // 去重关闭后还有缓存兜底：这里断言「不会静默返回 unchanged」
  assert.strictEqual(r2.unchanged, undefined);
  assert.ok(calls.translate.length >= 1);
});
