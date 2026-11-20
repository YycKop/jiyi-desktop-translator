'use strict';
/**
 * 帧签名比较（第二十二轮性能优化）
 *
 * `sameFrame()` 是"画面有没有动"的判据，容差太小会被缩略图抖动骗到（每轮都全量），
 * 太大会漏掉真实变化（字幕换了字却不重译）。这里把两端都钉住。
 */
const test = require('node:test');
const assert = require('node:assert');

const { sameFrame } = require('../../项目代码/src/core/capture/electron');
const { CaptureService } = require('../../项目代码/src/core/capture');

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, child() { return this; },
};

function sig(len, value) {
  return Buffer.alloc(len, value);
}

test('完全相同的签名判为同一帧', () => {
  assert.equal(sameFrame(sig(1024, 40), sig(1024, 40)), true);
});

test('整体亮度抖动 1–2 级仍算同一帧（缩略图压缩噪声）', () => {
  const a = Buffer.alloc(1024);
  const b = Buffer.alloc(1024);
  for (let i = 0; i < a.length; i += 1) {
    a[i] = 100;
    b[i] = i % 3 === 0 ? 102 : 100; // 部分像素差 2
  }
  assert.equal(sameFrame(a, b), true);
});

test('字幕换行这类变化必须判为不同帧', () => {
  const a = sig(1024, 12);
  const b = Buffer.alloc(1024);
  for (let i = 0; i < b.length; i += 1) b[i] = i < 512 ? 12 : 230; // 下半屏从黑变白
  assert.equal(sameFrame(a, b), false);
});

test('长度不同或空签名不算同一帧', () => {
  assert.equal(sameFrame(sig(1024, 1), sig(512, 1)), false);
  assert.equal(sameFrame(null, sig(1024, 1)), false);
  assert.equal(sameFrame(Buffer.alloc(0), Buffer.alloc(0)), false);
});

test('容差可调：放宽到 60 时同样的变化会被当成同一帧', () => {
  const a = sig(1024, 12);
  const b = Buffer.alloc(1024);
  for (let i = 0; i < b.length; i += 1) b[i] = i < 512 ? 12 : 72;
  assert.equal(sameFrame(a, b, 3), false);
  assert.equal(sameFrame(a, b, 60), true);
});

test('CaptureService：不支持低分辨率指纹的后端返回 null 而不是抛错', async () => {
  const svc = new CaptureService({ backend: 'mock', logger: silentLogger });
  const r = await svc.peekRegion({ x: 0, y: 0, width: 100, height: 50 });
  assert.equal(r, null);
});

test('CaptureService.sameFrame 在 mock 后端下仍可用', () => {
  const svc = new CaptureService({ backend: 'mock', logger: silentLogger });
  assert.equal(svc.sameFrame(sig(64, 5), sig(64, 5)), true);
  assert.equal(svc.sameFrame(sig(64, 5), sig(64, 90)), false);
});
