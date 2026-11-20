'use strict';
/**
 * GDI 区域截图（core/capture/win32.js）
 *
 * 用于：核心引擎自测、无 Electron 时的 headless 运行、集成测试。
 * 生产环境优先使用 Electron desktopCapturer（src/shell/capture.js），二者契约一致。
 *
 * SCR-01：只截取调用方给定的矩形区域，不做全屏/定时/后台采集。
 * FS-03：PNG 临时文件写 $PROJECT_ROOT/tmp/ 并在返回前删除。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { runPowerShellFile } = require('../native/ps');
const paths = require('../paths');
const { err, CODES } = require('../errors');

async function captureRegion(region, opts = {}) {
  const { x, y, width, height } = region || {};
  for (const [k, v] of Object.entries({ x, y, width, height })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw err(CODES.CAPTURE_FAILED, `区域参数 ${k} 非法`);
    }
  }
  if (width < 2 || height < 2) throw err(CODES.CAPTURE_FAILED, '区域尺寸过小');
  if (width > 8000 || height > 8000) throw err(CODES.CAPTURE_FAILED, '区域尺寸超出上限');

  if (process.platform !== 'win32') {
    throw err(CODES.CAPTURE_UNAVAILABLE, 'GDI 截图仅支持 Windows');
  }

  paths.ensure.tmp();
  const png = path.join(paths.tmpDir(), `cap-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`);
  try {
    const r = await runPowerShellFile('capture-region.ps1', [
      '-X', String(Math.round(x)), '-Y', String(Math.round(y)),
      '-W', String(Math.round(width)), '-H', String(Math.round(height)),
      '-Out', png,
    ], { timeoutMs: opts.timeoutMs || 15000, signal: opts.signal });

    if (!fs.existsSync(png)) {
      throw err(CODES.CAPTURE_FAILED, r.timedOut ? '截图超时' : '截图失败（未能生成图像）', { code: r.code });
    }
    const buffer = fs.readFileSync(png);
    return {
      buffer,
      width: Math.round(width),
      height: Math.round(height),
      backend: 'gdi',
      ms: r.ms,
    };
  } finally {
    try { fs.unlinkSync(png); } catch { /* 已删除 */ }
    try { fs.unlinkSync(png + '.json'); } catch { /* 已删除 */ }
  }
}

async function probe() {
  if (process.platform !== 'win32') return { ok: false, backend: 'gdi', reason: 'windows-only' };
  return { ok: true, backend: 'gdi' };
}

module.exports = { captureRegion, probe };
