'use strict';
/**
 * 轻量文本语种判断（core/translate/textlang.js）
 *
 * 用途：在调用模型之前识别「原文已经是目标语言」的情况，避免
 *   - 中文原文 + 目标中文 → 小模型偶尔吐英文（实测 zh→zh 输出英文）
 *   - 中文原文 + 目标繁体 → 走一次 2.7 秒的模型调用（纯转换可瞬时完成）
 * 只做形状判断，不追求语种识别精度。
 */
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const KANA_RE = /[\u3040-\u30ff]/g;
const HANGUL_RE = /[\uac00-\ud7af]/g;
const LATIN_RE = /[A-Za-z]/g;

function count(re, text) {
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

/** 去掉空白后的字符数，作为比例分母 */
function visibleLength(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

function hanRatio(text) {
  const n = visibleLength(text);
  if (!n) return 0;
  return count(HAN_RE, text) / n;
}

function latinRatio(text) {
  const n = visibleLength(text);
  if (!n) return 0;
  return count(LATIN_RE, text) / n;
}

/**
 * 是否像中文：汉字占比 ≥ threshold（默认 0.6），
 * 且不含假名/谚文（否则是日文或韩文，不能被当成中文跳过翻译）。
 */
function looksLikeChinese(text, threshold = 0.6) {
  if (count(KANA_RE, text) > 0 || count(HANGUL_RE, text) > 0) return false;
  return hanRatio(text) >= threshold;
}

/** 是否像英文/拉丁文：拉丁字母占比 ≥ 0.6 */
function looksLikeEnglish(text, threshold = 0.6) {
  return latinRatio(text) >= threshold;
}

module.exports = {
  hanRatio, latinRatio, looksLikeChinese, looksLikeEnglish, visibleLength,
};
