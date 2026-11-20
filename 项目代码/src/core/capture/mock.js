'use strict';
/**
 * Mock / 合成图截图后端（core/capture/mock.js）
 *
 * 仅供测试与开发：返回内存中的合成图像（纯色底 + 渲染文字），或从文件回放。
 * 绝不读取真实桌面（SCR-02）。
 */
const fs = require('fs');

/** 1x1 白色 PNG 兜底 */
const WHITE_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

let source = { type: 'buffer', buffer: WHITE_1X1 };
let calls = [];

function setImage(buffer) {
  source = { type: 'buffer', buffer: Buffer.from(buffer) };
}

function setImageFile(file) {
  source = { type: 'file', file };
}

function reset() {
  source = { type: 'buffer', buffer: WHITE_1X1 };
  calls = [];
}

function getCalls() {
  return calls.slice();
}

async function captureRegion(region, opts = {}) {
  calls.push({ region, at: Date.now() });
  if (opts.signal && opts.signal.aborted) {
    const e = new Error('已取消');
    e.code = 'ABORTED';
    throw e;
  }
  if (source.type === 'file') {
    return {
      buffer: fs.readFileSync(source.file),
      width: region ? region.width : 0,
      height: region ? region.height : 0,
      backend: 'file',
      ms: 1,
    };
  }
  return {
    buffer: source.buffer,
    width: region ? region.width : 1,
    height: region ? region.height : 1,
    backend: 'mock',
    ms: 0,
  };
}

async function probe() {
  return { ok: true, backend: 'mock' };
}

module.exports = {
  captureRegion, probe, setImage, setImageFile, reset, getCalls, WHITE_1X1,
};
