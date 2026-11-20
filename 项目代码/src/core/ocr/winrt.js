'use strict';
/**
 * Windows 原生 OCR 引擎适配（core/ocr/winrt.js）
 *
 * 实现 F-10「区域 OCR」的第一引擎：调用 Windows.Media.Ocr（系统内置，无第三方依赖）。
 * 若系统语言包缺失或识别失败，上层可回退到 tesseract / mock（见 ocr/index.js）。
 *
 * 约定：本模块只接收图片文件/缓冲区，不自行截屏（截图由 capture 层负责，SCR-01）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { runPowerShellFile } = require('../native/ps');
const { chooseBest, mergeLines, repairText, repairCjkPunctuation } = require('./score');
const paths = require('../paths');
const { err, CODES } = require('../errors');

function tmpFile(ext) {
  paths.ensure.tmp();
  const name = `ocr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
  return path.join(paths.tmpDir(), name);
}

function safeUnlink(file) {
  try { fs.unlinkSync(file); } catch { /* 已删除或不存在 */ }
}

/**
 * 多遍识别的默认组合（实测见 项目测试/reports/ocr-paragraph-bench.json 与 ocr-scale-hi.json）：
 *   2x 不锐化：整段中文正文最稳（dark-15px 0.9554，gray-14px 0.8793，明显优于 3x/4x/5x）；
 *   2x + USM160：单行小字提示、按钮文案更稳（ui-hint-14px 相似度 1.0）。
 * 所以两遍都固定在 2 倍，只切锐化开关；倍数再大反而掉分（4x 整段只剩 0.848）。
 */
const DEFAULT_PASSES = [
  { scale: 2, sharpen: 0 },
  { scale: 3, sharpen: 0 },
  // 文字压在照片/半透明浮层上时对比度很低（灰字压图片尤其明显），
  // 适度拉伸对比度能救回整行甚至整字（实测 bg-gray-20px：CtrI→Ctrl、新框选→重新框选）。
  { scale: 2, sharpen: 0, contrast: 30 },
  { scale: 2, sharpen: 160 },
];

/** 短文本阈值（去空白后字符数）：≤ 该值按"提示行"处理，优先选锐化那一遍 */
const SHORT_TEXT_CHARS = 60;

/** C# 预处理辅助类的编译缓存目录（数据目录下 cache/，可用 TRANSLATOR_HOME 重定向） */
function cacheDir() {
  const dir = path.join(paths.home(), 'cache');
  try { paths.ensureDir(dir); } catch { /* 不可写时交给脚本自己回退 */ }
  return dir;
}

/**
 * @param {object} opts
 * @param {Buffer} opts.buffer             PNG/JPEG 图像数据
 * @param {string[]} [opts.langs]          首选语言标签，如 ['zh-Hans-CN','en-US']
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.scale]            放大倍数（默认 2，小字号识别率显著提升）
 * @param {number} [opts.sharpen]          USM 锐化强度百分比（默认 0；短文本建议 120-160，整段正文不要锐化）
 * @param {number} [opts.contrast]         额外对比度拉伸百分比（0-100）
 * @returns {Promise<{text:string, lines:Array, lang:string, ms:number, engine:'winrt'}>}
 */
async function recognize(opts) {
  const {
    buffer, langs = ['zh-Hans-CN', 'en-US'], signal, timeoutMs = 15000, scale = 2,
    sharpen = 0, contrast = 0,
  } = opts;
  if (!buffer || !buffer.length) throw err(CODES.OCR_FAILED, 'OCR 输入图像为空');

  const img = tmpFile('.png');
  const out = tmpFile('.json');
  const prep = `${img}.prep.png`;
  try {
    fs.writeFileSync(img, buffer);
    // 放大/锐化/对比度都在 PowerShell 侧用 GDI+ 与内联 C# 完成（无需图像库依赖），派生图由本模块删除
    const args = ['-ImagePath', img, '-OutPath', out, '-Lang', langs.join(','), '-Scale', String(scale)];
    if (sharpen > 0) args.push('-Sharpen', String(Math.round(sharpen)));
    if (contrast > 0) args.push('-Contrast', String(Math.round(contrast)));
    // 编译好的 C# 辅助类缓存在数据目录，避免每次调用都启动编译器；
    // multi-pass 会同时起两个 PowerShell，缓存命中后第二个不用再编译。
    args.push('-CacheDir', cacheDir());
    const r = await runPowerShellFile('winrt-ocr.ps1', args, { timeoutMs, signal });

    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      throw err(CODES.OCR_FAILED, r.timedOut ? 'OCR 超时' : 'OCR 引擎无返回', { code: r.code, stderrLen: (r.stderr || '').length });
    }
    if (!parsed.ok) throw err(CODES.OCR_FAILED, parsed.error || 'OCR 引擎返回失败');
    // 两道收敛：先修 i/l 类混淆（英文），再修中文标点与字间空格
    const repaired = repairText(parsed.text || '');
    const cjk = repairCjkPunctuation(repaired.text);
    return {
      text: cjk.text,
      lines: (parsed.lines || []).map((l) => ({ text: repairCjkPunctuation(repairText(l.text || '').text).text, words: l.words || [] })),
      lang: parsed.lang || '',
      ms: parsed.ms || r.ms,
      engine: 'winrt',
      repaired: repaired.changed || cjk.changed || undefined,
      sharpened: parsed.sharpened === true,
      prepFallback: parsed.prepFallback === true || undefined,
      meanLuma: typeof parsed.meanLuma === 'number' ? parsed.meanLuma : undefined,
    };
  } finally {
    // FS-03：临时文件用后即删
    safeUnlink(img);
    safeUnlink(prep);
    safeUnlink(out);
  }
}

/**
 * 多遍识别：同一张图用不同放大倍数各识别一次，再按「异常形状」打分择优。
 *
 * 为什么需要（实测数据，见 项目测试/reports/ocr-scale-experiment.json）：
 *   il-640x160：2x 把 "Please" 认成 "PIease"，3x 正确；
 *   il-small-480x90：3x 把 "the" 拆成 "th e"，2x 正确；
 *   en-480x120：2x 把 "jumps" 认成 "JUmps"，3x 正确。
 * 没有哪个倍数通吃，所以取两遍结果中更"干净"的一遍（core/ocr/score.js）。
 *
 * @param {object} opts {buffer, langs, signal, timeoutMs, scales=[2,3]}
 * @returns {Promise<{text,lines,lang,ms,engine,scaleSeries,chosenScale,reason}>}
 */
async function recognizeMulti(opts) {
  const {
    buffer, langs = ['zh-Hans-CN', 'en-US'], signal, timeoutMs = 15000,
    scales, passes = DEFAULT_PASSES,
  } = opts;
  if (!buffer || !buffer.length) throw err(CODES.OCR_FAILED, 'OCR 输入图像为空');

  // 兼容老的 scales=[2,3] 调用；新调用请用 passes，才能同时控制放大倍数与锐化
  const list = (Array.isArray(passes) && passes.length ? passes
    : (Array.isArray(scales) && scales.length ? scales.map((s) => ({ scale: s, sharpen: 0 })) : DEFAULT_PASSES)
  ).slice(0, 4);
  if (list.length === 1) {
    const p = list[0];
    const r = await recognize({ buffer, langs, signal, timeoutMs, scale: p.scale, sharpen: p.sharpen || 0, contrast: p.contrast || 0 });
    return { ...r, scaleSeries: [{ scale: p.scale, sharpen: p.sharpen || 0, contrast: p.contrast || 0, ms: r.ms, text: r.text }], chosenScale: p.scale, reason: 'single-pass' };
  }

  const t0 = Date.now();
  const settled = await Promise.allSettled(list.map(async (p) => {
    const r = await recognize({ buffer, langs, signal, timeoutMs, scale: p.scale, sharpen: p.sharpen || 0, contrast: p.contrast || 0 });
    return { ...r, scale: p.scale, sharpen: p.sharpen || 0, contrast: p.contrast || 0 };
  }));
  const ok = [];
  const failures = [];
  for (let i = 0; i < settled.length; i += 1) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      ok.push({
        text: String(s.value.text || ''),
        lines: s.value.lines,
        lang: s.value.lang,
        ms: s.value.ms,
        scale: list[i].scale,
        sharpen: list[i].sharpen || 0,
        contrast: list[i].contrast || 0,
      });
    } else {
      const label = `${list[i].scale}x/sh${list[i].sharpen || 0}/ct${list[i].contrast || 0}`;
      failures.push({ pass: label, error: String((s.reason && s.reason.message) || s.reason) });
    }
  }
  if (!ok.length) {
    // 两遍都失败时把两边的错误都带上：用户反馈里只看到"不可用"根本没法排查
    const detail = failures.map((f) => `${f.pass}: ${f.error}`).join(' | ');
    throw err(CODES.OCR_FAILED, `OCR 引擎失败（${detail}）`);
  }

  // 先按"谁更可信"排个序，再逐行择优：各遍常常"各错一行"，取每行更干净的那份最划算。
  // 依据 项目测试/reports/ocr-paragraph-bench.json：整段正文 s3-sh0 平均 0.9439 优于 s3-sh160 的 0.9338，
  // 而单行小字提示 ui-hint-14px 只有锐化那遍才 1.0。长度差一个量级，用字符数区分即可。
  const ordered = ok.slice();
  let shortText = false;
  if (ordered.length > 1) {
    const probeChars = String(ordered[0].text || '').replace(/\s+/g, '').length;
    shortText = probeChars <= SHORT_TEXT_CHARS;
    // 短文本（提示行、按钮文案）只有锐化那遍最准，把锐化遍排到最前；
    // 长文本则相反（锐化会毁掉整段中文的笔画）。
    ordered.sort((a, b) => ((b.sharpen > 0) === shortText ? 1 : 0) - ((a.sharpen > 0) === shortText ? 1 : 0));
  }
  // 短文本关掉"多遍投票"：投票会把别的遍的近似结果选上来，反而不如信任排序后的首遍。
  const merged = mergeLines(ordered, { voting: !shortText });
  const useMerged = merged.reason === 'line-merge';
  const { best, scored, reason: pickReason } = chooseBest(ordered);
  const scaleSeries = scored.map((c) => ({
    scale: c.scale,
    sharpen: c.sharpen,
    contrast: c.contrast || 0,
    chars: String(c.text || '').replace(/\s+/g, '').length,
    text: c.text,
    score: c.score,
  }));
  return {
    text: useMerged ? merged.text : best.text,
    lines: useMerged ? merged.text.split(/\r?\n/).map((t) => ({ text: t })) : best.lines,
    lang: best.lang,
    ms: Date.now() - t0,
    engine: 'winrt',
    scaleSeries,
    chosenScale: useMerged ? 'merge' : best.scale,
    chosenSharpen: best.sharpen,
    chosenContrast: best.contrast || 0,
    reason: useMerged ? 'line-merge' : pickReason,
    lineMerge: useMerged ? merged.lines : undefined,
    failures: failures.length ? failures : undefined,
  };
}

/** 引擎自检：能否创建 OCR 引擎（不涉及真实截图） */
async function probe(opts = {}) {
  const { langs = ['zh-Hans-CN'] } = opts;
  if (process.platform !== 'win32') return { ok: false, reason: 'windows-only' };
  // 用 1x1 的白色 PNG 做最小自检，不触碰真实屏幕内容（SCR-02）
  const white1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
  );
  try {
    // 自检不放大也不锐化：既快（~200ms），也不依赖 C# 辅助类能否编译成功，
    // 避免"引擎明明能用却因为编译失败被判成不可用"
    const r = await recognize({ buffer: white1x1, langs, timeoutMs: 15000, scale: 1, sharpen: 0 });
    return { ok: true, engine: 'winrt', lang: r.lang, ms: r.ms };
  } catch (e) {
    return { ok: false, engine: 'winrt', reason: e.message, code: e.code };
  }
}

module.exports = { recognize, recognizeMulti, probe, tmpFile, safeUnlink };
