'use strict';
/**
 * Electron desktopCapturer 区域截图（core/capture/electron.js）
 *
 * 在宿主壳（Electron 主进程）中运行。依据 M1-T3：截图能力由宿主壳提供，
 * DSH 插件不直接操作屏幕，只经宿主桥请求本函数。
 *
 * 多显示器 / HiDPI：先按显示器 bounds 定位所属显示器，再用缩略图尺寸与显示器逻辑
 * 尺寸之比换算物理像素，最后裁剪出目标矩形。
 */
const { err, CODES } = require('../errors');

function getElectron() {
  try {
    // 延迟 require：本模块在非 Electron 环境（单元测试）被引用时不应崩溃
    // eslint-disable-next-line global-require
    return require('electron');
  } catch {
    return null;
  }
}

function pickSource(sources, display) {
  if (!sources.length) return null;
  const byDisplay = sources.find((s) => String(s.display_id) === String(display.id));
  if (byDisplay) return byDisplay;
  return sources[0];
}

async function captureRegion(region, opts = {}) {
  const electron = getElectron();
  if (!electron || !electron.screen || !electron.desktopCapturer) {
    throw err(CODES.CAPTURE_UNAVAILABLE, 'Electron 截图能力不可用');
  }
  const { screen, desktopCapturer } = electron;
  const { x, y, width, height } = region || {};
  for (const [k, v] of Object.entries({ x, y, width, height })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw err(CODES.CAPTURE_FAILED, `区域参数 ${k} 非法`);
    }
  }
  if (width < 2 || height < 2) throw err(CODES.CAPTURE_FAILED, '区域尺寸过小');

  const displays = screen.getAllDisplays();
  const cx = Math.round(x + width / 2);
  const cy = Math.round(y + height / 2);
  const display = displays.find((d) => {
    const b = d.bounds;
    return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height;
  }) || screen.getPrimaryDisplay();

  const scale = display.scaleFactor || 1;
  const thumbW = Math.round(display.bounds.width * scale);
  const thumbH = Math.round(display.bounds.height * scale);

  const started = Date.now();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH },
  });
  const src = pickSource(sources, display);
  if (!src || !src.thumbnail || src.thumbnail.isEmpty()) {
    throw err(CODES.CAPTURE_FAILED, '未能获取显示器画面');
  }
  const img = src.thumbnail;
  const size = img.getSize();
  const kx = size.width / display.bounds.width;
  const ky = size.height / display.bounds.height;

  const cropRect = {
    x: Math.max(0, Math.round((x - display.bounds.x) * kx)),
    y: Math.max(0, Math.round((y - display.bounds.y) * ky)),
    width: Math.max(1, Math.round(width * kx)),
    height: Math.max(1, Math.round(height * ky)),
  };
  // 裁剪矩形越界时收敛到图像范围内
  cropRect.width = Math.min(cropRect.width, size.width - cropRect.x);
  cropRect.height = Math.min(cropRect.height, size.height - cropRect.y);
  if (cropRect.width < 1 || cropRect.height < 1) {
    throw err(CODES.CAPTURE_FAILED, '区域超出显示器范围');
  }

  const cropped = img.crop(cropRect);
  return {
    buffer: cropped.toPNG(),
    width: cropRect.width,
    height: cropRect.height,
    backend: 'electron',
    ms: Date.now() - started,
  };
}

/**
 * 低分辨率帧指纹（第二十二轮性能优化）
 *
 * 定时翻译最常见的场景是「画面根本没动」：游戏暂停、视频停帧、网页静置。
 * 这时候没必要按整屏物理分辨率回读一遍再裁剪——那一步是每轮 CPU 的最大头。
 * 这里只请求一张很粗的整屏缩略图（默认长边 480px），裁出同一块区域算哈希，
 * 调用方先比哈希，没变就整轮跳过（连 OCR 都不跑）。
 *
 * 注意：缩略图有轻微抖动（尤其缩放插值），所以「相同」只用于判定无需重做，
 * 判定不同时仍回到 captureRegion() 走原路径，不会漏掉真实变化。
 */
const PEEK_LONG_SIDE = 480;
/** 帧签名边长（32×32 灰度，存 1KB，够用来判"画面没动"） */
const SIG_SIDE = 32;

async function peekRegion(region, opts = {}) {
  const electron = getElectron();
  if (!electron || !electron.screen || !electron.desktopCapturer) return null;
  const { screen, desktopCapturer } = electron;
  const { x, y, width, height } = region || {};
  if (![x, y, width, height].every((v) => Number.isFinite(v)) || width < 2 || height < 2) return null;

  const displays = screen.getAllDisplays();
  const cx = Math.round(x + width / 2);
  const cy = Math.round(y + height / 2);
  const display = displays.find((d) => {
    const b = d.bounds;
    return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height;
  }) || screen.getPrimaryDisplay();

  const b = display.bounds;
  const longSide = Math.max(b.width, b.height) || 1;
  const k = Math.min(1, PEEK_LONG_SIDE / longSide);
  const thumbSize = {
    width: Math.max(16, Math.round(b.width * k)),
    height: Math.max(16, Math.round(b.height * k)),
  };

  let src;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumbSize });
    src = pickSource(sources, display);
  } catch {
    return null;
  }
  if (!src || !src.thumbnail || src.thumbnail.isEmpty()) return null;

  const img = src.thumbnail;
  const size = img.getSize();
  const kx = size.width / b.width;
  const ky = size.height / b.height;
  const rect = {
    x: Math.max(0, Math.min(size.width - 1, Math.round((x - b.x) * kx))),
    y: Math.max(0, Math.min(size.height - 1, Math.round((y - b.y) * ky))),
    width: Math.max(1, Math.round(width * kx)),
    height: Math.max(1, Math.round(height * ky)),
  };
  rect.width = Math.min(rect.width, size.width - rect.x);
  rect.height = Math.min(rect.height, size.height - rect.y);

  const crop = img.crop(rect);
  // 缩到 32×32 再取灰度：比逐字节精确哈希稳得多，
  // 缩略图的抖动 / 轻微压缩差异不会误判成"画面变了"。
  const small = crop.resize({ width: SIG_SIDE, height: SIG_SIDE, quality: 'good' }).toBitmap();
  const sig = Buffer.alloc(SIG_SIDE * SIG_SIDE);
  for (let i = 0, p = 0; i < small.length; i += 4, p += 1) {
    // BGRA
    sig[p] = Math.round((small[i] * 0.114 + small[i + 1] * 0.587 + small[i + 2] * 0.299));
  }
  return { sig, sigSide: SIG_SIDE, width: rect.width, height: rect.height };
}

/**
 * 两帧签名是否"基本没变"：平均绝对差 ≤ tolerance（0–255）。
 * 默认 3，可容忍编码噪声，但字幕跳字、画面切换一定超过它。
 */
function sameFrame(a, b, tolerance = 3) {
  if (!a || !b || a.length !== b.length || !a.length) return false;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length <= tolerance;
}

async function probe() {
  const electron = getElectron();
  if (!electron || !electron.desktopCapturer) {
    return { ok: false, backend: 'electron', reason: 'not running inside electron' };
  }
  return { ok: true, backend: 'electron', displays: electron.screen.getAllDisplays().length };
}

module.exports = { captureRegion, peekRegion, sameFrame, probe };
