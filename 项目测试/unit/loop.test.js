'use strict';
/**
 * 定时轮询引擎单元测试（F-11 / M3-T1）
 *
 * 只验证与时间无关的契约与基本节拍，避免依赖真实网络与 OCR。
 */
const test = require('node:test');
const assert = require('node:assert');

const { TranslationLoop, clampInterval, MIN_INTERVAL, MAX_INTERVAL } =
  require('../../项目代码/src/core/pipeline/loop');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('clampInterval 夹取到 200–600000ms', () => {
  assert.strictEqual(clampInterval(5), MIN_INTERVAL);
  assert.strictEqual(clampInterval(9999999), MAX_INTERVAL);
  assert.strictEqual(clampInterval(2000), 2000);
  assert.strictEqual(clampInterval('abc'), 2000, '非法输入回落到默认 2s');
});

test('start 后按间隔重复执行，stop 后不再执行', async () => {
  let calls = 0;
  const loop = new TranslationLoop({
    execute: async () => { calls += 1; return { ok: true }; },
    logger: silentLogger,
    intervalMs: MIN_INTERVAL,
  });

  loop.start(MIN_INTERVAL, 'test');
  assert.strictEqual(loop.isRunning(), true);
  assert.strictEqual(loop.getStatus().running, true);

  await sleep(MIN_INTERVAL * 2 + 120);
  loop.stop('test-done');
  const afterStop = calls;
  assert.ok(afterStop >= 2, `应至少执行 2 次，实际 ${afterStop}`);
  assert.strictEqual(loop.isRunning(), false);

  await sleep(MIN_INTERVAL + 60);
  assert.strictEqual(calls, afterStop, 'stop 之后不应继续触发');
});

test('重复 start 不会叠加定时器', async () => {
  let calls = 0;
  const loop = new TranslationLoop({
    execute: async () => { calls += 1; return { ok: true }; },
    logger: silentLogger,
    intervalMs: MIN_INTERVAL,
  });
  loop.start(MIN_INTERVAL);
  loop.start(MIN_INTERVAL);
  await sleep(MIN_INTERVAL + 80);
  loop.stop();
  assert.ok(calls <= 2, `不应出现双倍触发，实际 ${calls}`);
});

test('执行抛错不会中断循环，并累加失败计数', async () => {
  let calls = 0;
  const loop = new TranslationLoop({
    execute: async () => { calls += 1; throw new Error('boom'); },
    logger: silentLogger,
    intervalMs: MIN_INTERVAL,
  });
  loop.start(MIN_INTERVAL);
  await sleep(MIN_INTERVAL * 2 + 120);
  loop.stop();
  assert.ok(calls >= 2, '异常后应继续下一拍');
  assert.ok(loop.getStatus().stats.failed >= 1);
});

test('getStatus 返回 running 与 intervalMs', () => {
  const loop = new TranslationLoop({ execute: async () => ({ ok: true }), logger: silentLogger, intervalMs: 2000 });
  const st = loop.getStatus();
  assert.strictEqual(st.running, false);
  assert.strictEqual(st.intervalMs, 2000);
});
