'use strict';
/**
 * RapidOCR 风格的 ONNX 识别引擎（PP-OCRv4 mobile det/rec）。
 *
 * 与 WinRT 引擎的关系：两者是并列可选的引擎，由 OcrService 选择；
 * 本引擎不依赖系统语言包，中文小字与背景图上的文字通常更稳。
 *
 * 处理流程：
 *   截图 PNG → 解码像素 → 灰度 → 行投影切行 → 逐行等比缩放到高 48 → rec 推理 → CTC 解码 → 文本修复
 *
 * 只用了 `onnxruntime-node` 一个原生依赖（见 AGENTS.md 依赖清单）；
 * 注意 ORT 原生层对含中文的路径会报 "File doesn't exist"，所以模型一律用 Buffer 传入。
 */

const fs = require('fs');
const path = require('path');
const { decodePng } = require('./png');
const { repairText, repairCjkPunctuation } = require('./score');

const REC_HEIGHT = 48;
const MIN_REC_WIDTH = 320;
const MAX_REC_WIDTH = 3200;
const INK_THRESHOLD = 34; // 与行背景灰度的差值阈值

let ortModule = null;
function loadOrt() {
  if (!ortModule) {
    // 依赖装在项目代码/node_modules 下；从模块所在位置向上找到项目根
    ortModule = require('onnxruntime-node');
  }
  return ortModule;
}

function loadKeys(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function createSession(ort, file) {
  const buf = fs.readFileSync(file);
  return ort.InferenceSession.create(buf, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
}

function buildGray(img) {
  const { width, height, data } = img;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return gray;
}

/** 用直方图众数估计一段像素的背景灰度（比均值稳，文字占比高时不会把背景带偏）。 */
function backgroundOf(values, count) {
  const hist = new Uint32Array(32);
  for (let i = 0; i < count; i += 1) {
    const bin = Math.min(31, Math.max(0, (values[i] / 8) | 0));
    hist[bin] += 1;
  }
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < 32; i += 1) {
    if (hist[i] > bestCount) { bestCount = hist[i]; best = i; }
  }
  return best * 8 + 4;
}

/**
 * 生成「墨迹图」：与局部均值的差超过阈值的像素记为 1。
 * 用局部均值而不是整幅背景，是为了在照片/渐变背景上也能分出文字（整幅背景法在 bg-* 图上完全失效）。
 */
function inkMap(gray, width, height, radius = 6, threshold = 26) {
  const ii = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      ii[(y + 1) * (width + 1) + (x + 1)] = ii[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const sum =
        ii[(y1 + 1) * (width + 1) + (x1 + 1)] -
        ii[y0 * (width + 1) + (x1 + 1)] -
        ii[(y1 + 1) * (width + 1) + x0] +
        ii[y0 * (width + 1) + x0];
      const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
      if (Math.abs(gray[y * width + x] - mean) > threshold) out[y * width + x] = 1;
    }
  }
  return out;
}

/** 按行投影切出文本行，返回 [{y0,y1,x0,x1}]。 */
function findLines(gray, width, height) {
  const ink = inkMap(gray, width, height);
  const rowInk = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let n = 0;
    const base = y * width;
    for (let x = 0; x < width; x += 1) if (ink[base + x]) n += 1;
    rowInk[y] = n;
  }

  // 阈值同时参考「最密的一行」：面板/卡片背景有纹理时，固定百分比会把整幅图当成一行，
  // 而文字行的墨迹量总是明显高于纹理行，用 max*0.12 能干净地切开。
  let maxRowInk = 0;
  for (let y = 0; y < height; y += 1) if (rowInk[y] > maxRowInk) maxRowInk = rowInk[y];
  const rowThreshold = Math.max(3, Math.round(width * 0.02), Math.round(maxRowInk * 0.12));
  const bands = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y < height; y += 1) {
    if (rowInk[y] >= rowThreshold) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > 2) {
        bands.push([start, y - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) bands.push([start, height - 1]);

  const lines = [];
  for (const [y0raw, y1raw] of bands) {
    const y0 = Math.max(0, y0raw - 1);
    const y1 = Math.min(height - 1, y1raw + 1);
    if (y1 - y0 < 8) continue;

    // 行内按列投影确定左右边界（同样基于墨迹图）
    const colInk = new Uint32Array(width);
    for (let x = 0; x < width; x += 1) {
      let n = 0;
      for (let y = y0; y <= y1; y += 1) if (ink[y * width + x]) n += 1;
      colInk[x] = n;
    }
    const colThreshold = Math.max(1, Math.round((y1 - y0 + 1) * 0.05));
    // 注意：不能按「列墨迹占比高 = 边框」来裁边——像「」」这种字的竖笔也几乎占满行高，
    // 会被误当成边框裁掉。边框造成的多余字符统一交给 cleanLine() 在识别后清理。
    let x0 = 0;
    while (x0 < width && colInk[x0] < colThreshold) x0 += 1;
    let x1 = width - 1;
    while (x1 > x0 && colInk[x1] < colThreshold) x1 -= 1;
    if (x1 - x0 < 4) continue;

    lines.push({
      y0,
      y1,
      x0: Math.max(0, x0 - 1),
      x1: Math.min(width - 1, x1 + 1),
    });
  }
  return lines;
}

/** 双线性缩放出一个灰度浮点块（高度固定 48，宽度按比例）。 */
function resizeLine(gray, width, box, targetHeight) {
  const srcW = box.x1 - box.x0 + 1;
  const srcH = box.y1 - box.y0 + 1;
  const scale = targetHeight / srcH;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const out = new Float32Array(dstW * targetHeight);
  let min = 255;
  let max = 0;
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = box.y0 + (y + 0.5) / scale - 0.5;
    const y0 = Math.max(box.y0, Math.min(box.y1, Math.floor(sy)));
    const y1 = Math.max(box.y0, Math.min(box.y1, y0 + 1));
    const wy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < dstW; x += 1) {
      const sx = box.x0 + (x + 0.5) / scale - 0.5;
      const xa = Math.max(box.x0, Math.min(box.x1, Math.floor(sx)));
      const xb = Math.max(box.x0, Math.min(box.x1, xa + 1));
      const wx = Math.max(0, Math.min(1, sx - xa));
      const v00 = gray[y0 * width + xa];
      const v01 = gray[y0 * width + xb];
      const v10 = gray[y1 * width + xa];
      const v11 = gray[y1 * width + xb];
      const top = v00 + (v01 - v00) * wx;
      const bottom = v10 + (v11 - v10) * wx;
      const v = top + (bottom - top) * wy;
      out[y * dstW + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // 识别模型训练的是「浅底深字」：整行偏暗（深色主题/照片底）就反相，否则一行都识别不出来。
  if ((min + max) / 2 < 128) {
    for (let i = 0; i < out.length; i += 1) out[i] = 255 - out[i];
    // 反相后极值也跟着翻转，必须重算，否则拉伸会把整行压成纯白（曾导致 para-gray-14px 全空）
    const swapped = min;
    min = 255 - max;
    max = 255 - swapped;
  }
  // 局部对比度拉伸，照片底上的淡字也能凑到模型能接受的动态范围
  const span = Math.max(1, max - min);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.max(0, Math.min(255, ((out[i] - min) / span) * 255));
  }
  return { data: out, width: dstW, height: targetHeight };
}

/** 灰度块 → [1,3,48,W] 张量，归一化 (v/127.5 - 1)。 */
function toTensor(ort, line, padWidth) {
  const { width, height, data } = line;
  const W = Math.max(padWidth || 0, width);
  const size = 3 * height * W;
  const buf = new Float32Array(size);
  const plane = height * W;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = x < width ? data[y * width + x] / 127.5 - 1 : 0;
      const idx = y * W + x;
      buf[idx] = v;
      buf[plane + idx] = v;
      buf[2 * plane + idx] = v;
    }
  }
  return new ort.Tensor('float32', buf, [1, 3, height, W]);
}

/** CTC 贪心解码。 */
function ctcDecode(output, keys) {
  return ctcDecodeDetailed(output, keys).text;
}

/**
 * CTC 贪心解码 + 置信度。
 * 置信度 = **实际吐出字符**的那几步的 softmax 概率均值。
 * 不能把 blank 步算进去：blank 的概率几乎恒为 0.999，一平均就人人 0.99，
 * 中英模型读纯谚文（一个字都吐不出）也会拿到接近 1 的分数，
 * 「低分才换日/韩模型」的判据就永远不触发（第二十一轮需求 5 踩过这个坑）。
 */
function ctcDecodeDetailed(output, keys) {
  const [, steps, classes] = output.dims;
  const data = output.data;
  const chars = keys.slice();
  // 类别数 = 字典长度 + blank + 空格
  const useSpace = classes === chars.length + 2;
  let prev = -1;
  let text = '';
  let sum = 0;
  let emitted = 0;
  for (let t = 0; t < steps; t += 1) {
    let best = 0;
    let bestScore = -Infinity;
    const base = t * classes;
    for (let c = 0; c < classes; c += 1) {
      const v = data[base + c];
      if (v > bestScore) { bestScore = v; best = c; }
    }
    if (best !== 0 && best !== prev) {
      if (best === chars.length + 1) text += ' ';
      else if (best - 1 < chars.length) text += chars[best - 1];
      sum += Number.isFinite(bestScore) ? bestScore : 0;
      emitted += 1;
    }
    prev = best;
  }
  return { text, score: emitted > 0 ? sum / emitted : 0, emitted };
}

/** 行文本清洗：去掉因裁切到面板边框而多出的成对括号/竖线，空行丢弃。 */
const EDGE_LEAD = /^[」』】）〕”’〞|]+/;
const EDGE_TAIL = /[「『【（〔“‘〝|]+$/;
function cleanLine(raw) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 2) return text;
  text = text.replace(EDGE_LEAD, '').replace(EDGE_TAIL, '').trim();
  return text;
}

/**
 * 可用的识别模型（第二十一轮需求 5：日文/韩文识别）。
 * PP-OCRv4 的中英模型字典里没有谚文（Hangul），片假名/平假名也覆盖不全，
 * 所以另有独立的 japan / korean 模型；它们输入尺度与输出结构完全一致，可以共用同一条预处理链路。
 */
const RECOGNIZERS = {
  ch: { file: 'ch_PP-OCRv4_rec_mobile.onnx', dict: 'ppocr_keys_v1.txt', label: '中英' },
  japan: { file: 'japan_PP-OCRv4_rec_mobile.onnx', dict: 'japan_dict.txt', label: '日文' },
  korean: { file: 'korean_PP-OCRv4_rec_mobile.onnx', dict: 'korean_dict.txt', label: '韩文' },
};
const LANG_ALIASES = {
  auto: 'ch', zh: 'ch', 'zh-cn': 'ch', ch: 'ch', en: 'ch', 'zh+en': 'ch',
  ja: 'japan', jp: 'japan', japan: 'japan', japanese: 'japan',
  ko: 'korean', kr: 'korean', korean: 'korean',
};
/** 自动模式下，主模型得分低于它就再跑日/韩模型比一比 */
const AUTO_RETRY_SCORE = 0.82;

/**
 * 各模型「应该认出什么字形」：
 * - ch：汉字 / 拉丁字母 / 数字（中英混排是常态，所以拉丁也算命中）
 * - japan：假名 + 汉字（日语用这两种）
 * - korean：谚文（韩语正文几乎全是谚文；拉丁字母只当外来词，这里不算命中，
 *   否则纯英文截图会被韩文模型用 0.99 的置信度抢走——第二十一轮实测踩到过）
 */
const SCRIPT_TESTS = {
  ch: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/gu,
  japan: /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/gu,
  korean: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/gu,
};

/**
 * 输出文本里「符合该模型预期字形」的比例（0–1，忽略空白）。
 * 置信度只说明模型对自己吐的字有多确定，不说明它是不是在瞎认——
 * 所以要把置信度和字形比例乘起来，才能横向比较三个模型。
 */
function scriptRatio(text, name) {
  // 标点与符号不参与统计：日文一行里「、。」这种字符很容易占掉两三成，
  // 不剔掉的话真日文的贴合度会被压到 0.7 以下，反而输给中文模型。
  const t = String(text || '').replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!t) return 0;
  const test = SCRIPT_TESTS[name] || SCRIPT_TESTS.ch;
  const matched = (t.match(test) || []).length;
  return matched / t.length;
}

/** 一个候选模型的综合分：置信度 × 字形贴合度（完全贴不上就只剩 35% 权重） */
function languageScore(score, text, name) {
  return score * (0.35 + 0.65 * scriptRatio(text, name));
}

class RapidOcr {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {string} opts.modelsDir 模型目录（含 *_rec_mobile.onnx 与对应字典）
   */
  constructor(opts = {}) {
    this.logger = opts.logger || null;
    this.modelsDir = opts.modelsDir || '';
    this.session = null;
    this.keys = null;
    this.loading = null;
    this.lastError = null;
    this.engines = new Map(); // name -> { session, keys, label }
    this.ort = null;
  }

  modelFiles() {
    const dir = this.modelsDir;
    return {
      rec: path.join(dir, 'ch_PP-OCRv4_rec_mobile.onnx'),
      keys: path.join(dir, 'ppocr_keys_v1.txt'),
    };
  }

  filesOf(name) {
    const meta = RECOGNIZERS[name] || RECOGNIZERS.ch;
    return { file: path.join(this.modelsDir, meta.file), dict: path.join(this.modelsDir, meta.dict) };
  }

  /** 该语言的模型文件是否已就位（缺文件时自动模式直接跳过，不报错） */
  hasModel(name = 'ch') {
    const f = this.filesOf(name);
    return fs.existsSync(f.file) && fs.existsSync(f.dict);
  }

  availableLangs() {
    return Object.keys(RECOGNIZERS).filter((n) => this.hasModel(n));
  }

  async ensure() {
    if (this.session) return this;
    return this.ensureLang('ch');
  }

  async ensureLang(name = 'ch') {
    const key = LANG_ALIASES[String(name).toLowerCase()] || 'ch';
    const hit = this.engines.get(key);
    if (hit) {
      if (key === 'ch') { this.session = hit.session; this.keys = hit.keys; this.ort = this.ort || hit.ort; }
      return hit;
    }
    const f = this.filesOf(key);
    if (!fs.existsSync(f.file)) throw new Error(`缺少识别模型：${f.file}`);
    if (!fs.existsSync(f.dict)) throw new Error(`缺少字典：${f.dict}`);
    const meta = RECOGNIZERS[key];
    const loadingKey = `loading:${key}`;
    if (this[loadingKey]) return this[loadingKey];
    this[loadingKey] = (async () => {
      const ort = this.ort || loadOrt();
      this.ort = ort;
      const keys = loadKeys(f.dict);
      const session = await createSession(ort, f.file);
      const entry = { name: key, label: meta.label, keys, session, ort };
      this.engines.set(key, entry);
      if (key === 'ch') { this.session = session; this.keys = keys; }
      return entry;
    })();
    try {
      return await this[loadingKey];
    } finally {
      this[loadingKey] = null;
    }
  }

  async probe() {
    const started = Date.now();
    try {
      await this.ensure();
      return {
        ok: true,
        engine: 'rapid',
        lang: 'zh+en',
        langs: this.availableLangs(),
        ms: Date.now() - started,
      };
    } catch (e) {
      this.lastError = e && e.message;
      return { ok: false, engine: 'rapid', reason: this.lastError, ms: Date.now() - started };
    }
  }

  /** 单行推理，返回 {text, score, ms}；name 为 ch / japan / korean */
  async recognizeLine(gray, width, box, name = 'ch') {
    const rec = await this.ensureLang(name);
    const line = resizeLine(gray, width, box, REC_HEIGHT);
    const padWidth = Math.max(MIN_REC_WIDTH, Math.ceil(line.width / 8) * 8);
    const tensor = toTensor(rec.ort || this.ort, line, Math.min(MAX_REC_WIDTH, padWidth));
    const started = Date.now();
    const feeds = {};
    feeds[rec.session.inputNames[0]] = tensor;
    const out = await rec.session.run(feeds);
    const result = out[rec.session.outputNames[0]];
    const decoded = ctcDecodeDetailed(result, rec.keys);
    return { text: decoded.text, score: decoded.score, ms: Date.now() - started, width: line.width };
  }

  /** 自动模式下的多语种择优：主模型得分低时才去试日 / 韩，避免每行都跑三遍 */
  async recognizeLineAuto(gray, width, box, lang) {
    const primary = lang === 'auto' ? 'ch' : LANG_ALIASES[String(lang || '').toLowerCase()] || 'ch';
    let best = await this.recognizeLine(gray, width, box, primary);
    best.lang = primary;
    if (lang !== 'auto') return best;
    if (best.score >= AUTO_RETRY_SCORE) return best;
    for (const alt of ['japan', 'korean']) {
      if (alt === primary || !this.hasModel(alt)) continue;
      let r;
      try {
        r = await this.recognizeLine(gray, width, box, alt);
      } catch (e) {
        if (this.logger) this.logger.warn('备用识别模型不可用', { lang: alt, message: e && e.message });
        continue;
      }
      // 高置信度且明显压过主模型才替换，避免把本来正确的中文改坏
      if (r.score > best.score + 0.05) {
        r.lang = alt;
        best = r;
      }
    }
    return best;
  }

  /**
   * 估一个模型在一批行上的「有效得分」（只取最宽的两行做样本，够用且便宜）。
   * 单看置信度会误判：纯英文被韩文模型读出来也有 0.99 的自信，
   * 所以得分 = 置信度 × 字形贴合度（见 languageScore），英文在韩文模型下会被压到 0.35 折。
   */
  async scoreLang(gray, width, boxes, name) {
    const samples = boxes
      .slice()
      .sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))
      .slice(0, 2);
    let sum = 0;
    let count = 0;
    for (const box of samples) {
      const r = await this.recognizeLine(gray, width, box, name);
      // 空文本说明这个模型压根没有可输出的字符，记 0 而不是它的 blank 概率
      const eff = r.text.trim() ? languageScore(r.score, r.text, name) : 0;
      sum += eff;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }

  /** 选这块画面用哪个识别模型：固定语言直接用，auto 时按置信度挑 */
  async chooseLang(gray, width, boxes, lang) {
    if (lang && lang !== 'auto') {
      const fixed = LANG_ALIASES[String(lang).toLowerCase()] || 'ch';
      return this.hasModel(fixed) ? fixed : 'ch';
    }
    const candidates = ['ch', 'japan', 'korean'].filter((n) => this.hasModel(n));
    if (candidates.length <= 1) return 'ch';
    // 第二十二轮性能优化：定时翻译每轮都要选一次语言，三个模型全跑等于每轮多两次推理。
    // 先用上一轮选中的模型试一次，分数够高就直接沿用（同一段画面语言几乎不会变）。
    const hint = this.langHint;
    if (hint && candidates.includes(hint)) {
      const hintScore = await this.scoreLang(gray, width, boxes, hint).catch(() => 0);
      if (hintScore >= AUTO_RETRY_SCORE) {
        if (this.logger) this.logger.debug('识别模型沿用上轮', { lang: hint, score: hintScore });
        return hint;
      }
    }
    let bestName = candidates[0];
    let bestScore = -1;
    for (const name of candidates) {
      let score;
      try {
        score = await this.scoreLang(gray, width, boxes, name);
      } catch (e) {
        if (this.logger) this.logger.warn('识别模型评估失败', { lang: name, message: e && e.message });
        continue;
      }
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
    // 中英模型明显够用时不为了零点几分去换成日/韩
    if (bestName !== 'ch' && bestScore < AUTO_RETRY_SCORE) {
      const chScore = await this.scoreLang(gray, width, boxes, 'ch').catch(() => 0);
      if (chScore >= bestScore) {
        this.langHint = 'ch';
        return 'ch';
      }
    }
    this.langHint = bestName;
    if (this.logger) this.logger.debug('识别模型选择', { lang: bestName, score: bestScore });
    return bestName;
  }

  /**
   * 识别一块图像。
   * @param {{buffer:Buffer, signal?:AbortSignal, lang?:string}} opts
   *   lang: auto（默认，中英优先、低分时试日/韩）/ ch / japan / korean
   */
  async recognize(opts = {}) {
    const lang = opts.lang || 'auto';
    await this.ensure();
    if (opts.signal && opts.signal.aborted) throw new Error('ABORTED');
    const started = Date.now();
    const img = decodePng(opts.buffer);
    const gray = buildGray(img);
    const boxes = findLines(gray, img.width, img.height);
    const lines = [];
    const langsUsed = new Set();
    let ocrMs = 0;
    // 整块画面选一次语言：混排的截图上逐行换模型会把中日韩文字打成大杂烩
    const chosen = boxes.length ? await this.chooseLang(gray, img.width, boxes, lang) : 'ch';
    for (const box of boxes) {
      if (opts.signal && opts.signal.aborted) throw new Error('ABORTED');
      const r = await this.recognizeLine(gray, img.width, box, chosen);
      r.lang = chosen;
      ocrMs += r.ms;
      const text = cleanLine(r.text);
      if (!text) continue; // 面板边框/阴影切出来的空行直接丢掉
      langsUsed.add(chosen);
      lines.push({
        text,
        lang: chosen,
        score: Math.round((r.score || 0) * 1000) / 1000,
        box: { x: box.x0, y: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 },
      });
    }
    const rough = lines.map((l) => l.text).join('\n');
    const repaired = repairCjkPunctuation(repairText(rough).text).text;
    const used = [...langsUsed];
    return {
      text: repaired,
      lines: repaired.split('\n').filter((l) => l.trim().length > 0),
      boxes: lines.map((l) => ({ text: l.text, lang: l.lang, score: l.score, ...l.box })),
      lang: used.length === 0 ? 'zh+en' : used.map((n) => (RECOGNIZERS[n] || RECOGNIZERS.ch).label).join('+'),
      langsUsed: used,
      engine: 'rapid',
      ms: Date.now() - started,
      ocrMs,
      lineCount: lines.length,
    };
  }
}

module.exports = {
  RapidOcr,
  findLines,
  ctcDecode,
  RECOGNIZERS,
  REC_HEIGHT,
  LANG_ALIASES,
  scriptRatio,
  languageScore,
};
