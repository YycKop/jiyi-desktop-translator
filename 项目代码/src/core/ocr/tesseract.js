'use strict';
/**
 * Tesseract OCR 兜底适配（core/ocr/tesseract.js）
 *
 * F-10 要求 RapidOCR 优先、Tesseract 兜底。本机未安装 Tesseract，因此该适配器
 * 在检测不到可执行文件时直接返回不可用，由 ocr/index.js 回退到下一引擎。
 * 安装方式（用户自行）见 开发文档/V1-运行部署指南。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { tmpFile, safeUnlink } = require('./winrt');
const { err, CODES } = require('../errors');

let cachedPath = null;
let probed = false;

function findBinary() {
  if (probed) return cachedPath;
  probed = true;
  const candidates = [
    process.env.TESSERACT_PATH,
    'tesseract.exe',
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'tesseract.exe') {
      // 交给 PATH 解析，运行时若不存在会 spawn error
      cachedPath = c;
      return cachedPath;
    }
    try {
      if (fs.existsSync(c)) { cachedPath = c; return cachedPath; }
    } catch { /* 忽略 */ }
  }
  cachedPath = null;
  return null;
}

function run(cmd, args, { timeoutMs = 20000, signal } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errText = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* noop */ } }, timeoutMs);
    const onAbort = () => { try { child.kill(); } catch { /* noop */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { errText += d.toString('utf8'); });
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, out, err: errText, timedOut });
    };
    child.on('error', (e) => { errText += String(e && e.message); finish(-1); });
    child.on('close', (c) => finish(c));
  });
}

async function probe() {
  const bin = findBinary();
  if (!bin) return { ok: false, engine: 'tesseract', reason: '未检测到 tesseract 可执行文件' };
  const r = await run(bin, ['--version'], { timeoutMs: 6000 });
  return r.code === 0
    ? { ok: true, engine: 'tesseract', version: (r.out.split('\n')[0] || '').trim() }
    : { ok: false, engine: 'tesseract', reason: 'tesseract 无法执行' };
}

async function recognize({ buffer, langs = ['chi_sim', 'eng'], signal, timeoutMs = 20000 }) {
  const bin = findBinary();
  if (!bin) throw err(CODES.OCR_UNAVAILABLE, '未安装 Tesseract');
  const img = tmpFile('.png');
  const base = img.replace(/\.png$/, '');
  try {
    fs.writeFileSync(img, buffer);
    const args = [img, base, '-l', langs.join('+'), '--psm', '6'];
    const r = await run(bin, args, { timeoutMs, signal });
    if (r.timedOut) throw err(CODES.OCR_FAILED, 'Tesseract 超时');
    if (r.code !== 0) throw err(CODES.OCR_FAILED, 'Tesseract 执行失败');
    const text = fs.readFileSync(base + '.txt', 'utf8');
    return {
      text: text.trim(), lines: [], lang: langs.join('+'), engine: 'tesseract', ms: 0,
    };
  } finally {
    safeUnlink(img);
    safeUnlink(base + '.txt');
  }
}

module.exports = { recognize, probe, findBinary };
