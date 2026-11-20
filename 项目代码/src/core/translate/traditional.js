'use strict';
/**
 * 简繁转换工具（core/translate/traditional.js）
 *
 * 背景：本地 HY-MT 模型对「Translate into Traditional Chinese」这类指令几乎不动手，
 * 实测会把简体原文原样吐回来（= 用户看到"繁体翻不出来"）。因此做两层保障：
 *   1. 提示词层：目标为繁体时改用"逐字转换"式指令（实测有效）；
 *   2. 兜底层：模型仍返回简体（或原样返回）时，用 OpenCC 单字表做确定性转换。
 *
 * 只做字符级转换，不做「软件/軟體」这类词汇替换——那交给模型，猜错比不换更糟。
 */
const { MAP } = require('./traditional-table');

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;

/** 统计文本里「只属于简体」的汉字数量 */
function countSimplified(text) {
  if (!text) return 0;
  let n = 0;
  for (const ch of String(text)) if (MAP.has(ch)) n += 1;
  return n;
}

function countCjk(text) {
  const m = String(text || '').match(CJK_RE);
  return m ? m.length : 0;
}

/** 简体字占比（0~1），用于判断一段文本整体是不是简体 */
function simplifiedRatio(text) {
  const cjk = countCjk(text);
  if (!cjk) return 0;
  return countSimplified(text) / cjk;
}

/** 确定性字符转换（不改变非汉字内容） */
function toTraditional(text) {
  const s = String(text || '');
  let out = '';
  for (const ch of s) out += MAP.get(ch) || ch;
  return out;
}

/**
 * 判断「目标为繁体」时是否需要兜底转换。
 *
 * 触发条件（满足其一）：
 *   - 译文与原文完全一致（模型没做任何事）
 *   - 译文里仍有 ≥3 个简体专有字，且占比不低于原文的一半（说明还是简体）
 *
 * 反例保护：一段本来就正确的繁体文本，简体专有字数量应当接近 0；
 * 「台/裡/著」这类简繁同形字不会被误判为简体。
 */
function shouldConvert(translated, sourceText) {
  const out = String(translated || '');
  if (!out.trim()) return false;
  if (sourceText && out.trim() === String(sourceText).trim()) return true;
  const simpOut = countSimplified(out);
  if (simpOut < 3) return false;
  const simpSrc = countSimplified(sourceText);
  if (!simpSrc) return true;
  return simpOut >= simpSrc * 0.5;
}

/**
 * 目标语言为繁体时的收尾处理。
 *
 * 注意：**只有目标是繁体才允许调用**。传入 targetLang 时会在内部再确认一次，
 * 因为一旦对「目标简体」的译文也做转换，就会出现「英文→简体中文」却输出繁体
 * 的诡异结果（实测过）。
 *
 * @param {string} translated 译文
 * @param {string} sourceText 原文（用于判断是否原样返回）
 * @param {string} [targetLang] 目标语言 code
 * @returns {{text:string, converted:boolean, reason?:string}}
 */
function ensureTraditional(translated, sourceText, targetLang) {
  if (targetLang && !isTraditionalTarget(targetLang)) {
    return { text: String(translated || ''), converted: false, reason: 'target-not-traditional' };
  }
  const out = String(translated || '');
  if (!shouldConvert(out, sourceText)) return { text: out, converted: false };
  const conv = toTraditional(out);
  // 转换后简体字没有减少，说明表里没有这些字，保持原样更安全
  if (countSimplified(conv) >= countSimplified(out)) {
    return { text: out, converted: false, reason: 'no-mapping' };
  }
  return { text: conv, converted: true, reason: 'fallback-table' };
}

function isTraditionalTarget(targetLang) {
  return String(targetLang || '').trim().toLowerCase().replace('_', '-') === 'zh-tw';
}

module.exports = {
  toTraditional,
  countSimplified,
  countCjk,
  simplifiedRatio,
  shouldConvert,
  ensureTraditional,
  isTraditionalTarget,
  TABLE_SIZE: MAP.size,
};
