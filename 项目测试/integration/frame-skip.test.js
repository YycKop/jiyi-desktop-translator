'use strict';
/**
 * 帧指纹跳过回归（第二十二轮性能优化）
 *
 * 背景：定时翻译原来每轮都要「整屏物理分辨率回读 + OCR」，画面静止时纯属白烧 CPU
 * （实测 1 秒一轮常态 20%、0.3 秒一轮 42%）。现在先在低分辨率缩略图上算 32×32 灰度签名，
 * 与上一轮「基本没变」就直接复用上一轮整轮结果。
 *
 * 这里守住的边界：
 *  ① 画面没变 → 不截图、不 OCR、不翻译，返回 skipped:'frame'；
 *  ② 画面变了 → 正常走完整流程；
 *  ③ 用户点「重新翻译」（force）→ 必须重新做，不能拿缓存糊弄；
 *  ④ 改了目标语言 / 识别语言 / 区域 → 即使画面没动也要重做；
 *  ⑤ 后端不支持 peekRegion（旧环境）→ 退化成每轮全量，不能报错。
 */
const test = require('node:test');
const assert = require('node:assert');

const { executeRound } = require('../../项目代码/src/core/pipeline/round');

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, child() { return this; },
};

const REGION = { x: 10, y: 10, width: 300, height: 120 };

function sigOf(value) {
  const buf = Buffer.alloc(1024, value);
  return buf;
}

function makeDeps({
  // 每轮 peek 返回的签名，数组用完后重复最后一个
  sigs = [sigOf(10)],
  text = 'Hello World',
} = {}) {
  const calls = { peek: 0, capture: 0, ocr: 0, translate: 0 };
  let i = 0;
  const config = {
    general: {
      targetLang: 'zh', sourceLang: 'auto', dedupeEnabled: true, minRetranslateMs: 0, cacheTtlMs: 600000, dedupeSimilarity: 0.98, priority: 'online',
    },
    capture: { lastSelection: REGION, intervalMs: 1000, mode: 'interval' },
    ocr: { engine: 'auto', lang: 'auto' },
    network: { primaryTimeoutMs: 5000, backupTimeoutMs: 3000, maxApiAttempts: 2 },
    offline: {},
  };
  const deps = {
    logger: silentLogger,
    store: { raw: () => config, getEnabledApisOrdered: () => [], getApiSecret: () => 'sk-test-0000' },
    capture: {
      peekRegion: async () => {
        const s = sigs[Math.min(i, sigs.length - 1)];
        i += 1;
        calls.peek += 1;
        return { sig: s, sigSide: 32, width: 64, height: 27 };
      },
      sameFrame: (a, b) => Buffer.compare(a, b) === 0,
      captureRegion: async (region) => {
        calls.capture += 1;
        return {
          buffer: Buffer.from([1]), width: region.width, height: region.height, backend: 'mock', ms: 1,
        };
      },
    },
    ocr: {
      recognize: async () => {
        calls.ocr += 1;
        return { text, lines: [], engine: 'mock', ms: 1 };
      },
    },
    llama: { status: () => ({ running: false }), health: async () => ({ ok: false }) },
    translateFn: async ({ text: t }) => {
      calls.translate += 1;
      return {
        text: `译文：${t}`, engine: 'MockEngine', apiId: 'a1', latencyMs: 2, attempts: [{ ok: true }],
      };
    },
    config,
  };
  return { deps, calls, config };
}

test('画面没变时跳过截图与 OCR，直接复用上一轮结果', async () => {
  const { deps, calls } = makeDeps({ sigs: [sigOf(10), sigOf(10), sigOf(10)] });
  const state = {};

  const first = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(first.ok, true);
  assert.equal(calls.capture, 1, '首轮应该完整截图一次');
  assert.equal(calls.ocr, 1, '首轮应该 OCR 一次');

  const second = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(second.ok, true);
  assert.equal(second.skipped, 'frame', '第二轮应标记为按帧跳过');
  assert.equal(second.unchanged, true);
  assert.equal(calls.capture, 1, '画面没变就不该再截图');
  assert.equal(calls.ocr, 1, '画面没变就不该再 OCR');
  assert.equal(calls.translate, 1, '画面没变就不该再翻译');
  assert.equal(second.text, first.text, '应复用上一轮译文');

  // 第三轮仍然静止 → 继续跳过
  const third = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(third.skipped, 'frame');
  assert.equal(calls.ocr, 1);
});

test('画面变了必须重新识别', async () => {
  const { deps, calls } = makeDeps({ sigs: [sigOf(10), sigOf(200)] });
  const state = {};
  await executeRound(deps, state, { trigger: 'interval' });
  const second = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(second.skipped, undefined);
  assert.equal(calls.capture, 2);
  assert.equal(calls.ocr, 2);
});

test('force（用户点重新翻译）时不吃帧缓存', async () => {
  const { deps, calls } = makeDeps({ sigs: [sigOf(10), sigOf(10)] });
  const state = {};
  await executeRound(deps, state, { trigger: 'manual' });
  const again = await executeRound(deps, state, { trigger: 'manual', force: true });
  assert.equal(again.skipped, undefined);
  assert.equal(calls.ocr, 2, 'force 时必须重新 OCR');
});

test('目标语言变了，即使画面没动也要重做', async () => {
  const { deps, calls, config } = makeDeps({ sigs: [sigOf(10), sigOf(10)] });
  const state = {};
  await executeRound(deps, state, { trigger: 'interval' });
  config.general.targetLang = 'en';
  const second = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(second.skipped, undefined, '场景键（目标语言）变了不能跳过');
  assert.equal(calls.ocr, 2);
});

test('识别语言变了也要重做', async () => {
  const { deps, calls, config } = makeDeps({ sigs: [sigOf(10), sigOf(10)] });
  const state = {};
  await executeRound(deps, state, { trigger: 'interval' });
  config.ocr.lang = 'japan';
  const second = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(second.skipped, undefined);
  assert.equal(calls.ocr, 2);
});

test('后端不支持 peekRegion 时退化为每轮全量，不报错', async () => {
  const { deps, calls } = makeDeps({ sigs: [sigOf(10), sigOf(10)] });
  delete deps.capture.peekRegion;
  const state = {};
  const a = await executeRound(deps, state, { trigger: 'interval' });
  const b = await executeRound(deps, state, { trigger: 'interval' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.skipped, undefined);
  assert.equal(calls.capture, 2);
  assert.equal(calls.ocr, 2);
});
