'use strict';
/**
 * 文本指纹与相似度（core/translate/fingerprint.js）
 *
 * 用途：判断「这一轮 OCR 出来的文字」和「上一轮」是不是同一段内容。
 * 为什么不能直接比哈希——OCR 每轮都会抖动一两个字符（i/l、O/0、少一个标点），
 * 精确哈希一变就当成新文本，于是定时轮询会**对同一段文字反复调用付费 API**（实测问题）。
 *
 * 做法：
 *   1. 归一化易混字符（i/l/1/|→i、o/0→o、rn→m 等）、去空白与标点、英文统一小写；
 *      这样「PIease」与「Please」会归一成同一个串，「LO g」与「Log」也相同。
 *   2. 归一化后先比全等；不等再用编辑距离算相似度，超过阈值（默认 0.98）仍视为同一段。
 *   3. 中文不做大小写转换，但同样去除空白与标点，所以「欢 迎 使 用」与「欢迎使用」等价。
 */

/** 关闭 NFKC 之外的自定义易混映射，便于排查 */
const CONFUSABLES = [
  [/[iIl|!]/g, 'i'],
  [/[oO0]/g, 'o'],
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/1/g, 'i'],
];

/**
 * 归一化文本，用于「是否同一段内容」的比较。
 * 注意：**只用于比较**，绝不用于替换展示给用户/发给模型的文本。
 * @param {string} text
 * @returns {string}
 */
function normalizeForCompare(text) {
  let s = String(text || '');
  try {
    s = s.normalize('NFKC');
  } catch (e) {
    /* 老 Node 没有 normalize 时忽略 */
  }
  // 去空白、标点、符号；保留字母（各语言）与数字
  s = s.replace(/[^\p{L}\p{N}]+/gu, '');
  // 英文统一小写（对中日韩无影响）
  s = s.toLowerCase();
  for (const [re, to] of CONFUSABLES) s = s.replace(re, to);
  return s;
}

/** 编辑距离（两行滚动数组，短文本足够快） */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}

/** 相似度 0..1（1 = 完全相同） */
function similarity(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  if (!max) return 1;
  return 1 - levenshtein(x, y) / max;
}

/**
 * 两段原文是否视为「同一段内容」（OCR 抖动容忍）。
 * @param {string} prevText 上一轮原文
 * @param {string} nextText 本轮原文
 * @param {{threshold?:number}} [opts] threshold 默认 0.98
 * @returns {{same:boolean, similarity:number, prevKey:string, nextKey:string}}
 */
function isSameContent(prevText, nextText, opts = {}) {
  const threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 0.98;
  const prevKey = normalizeForCompare(prevText);
  const nextKey = normalizeForCompare(nextText);
  if (!nextKey) return { same: false, similarity: 0, prevKey, nextKey };
  if (prevKey === nextKey) return { same: true, similarity: 1, prevKey, nextKey };
  const sim = similarity(prevKey, nextKey);
  return { same: sim >= threshold, similarity: sim, prevKey, nextKey };
}

/** 缓存键：语言 + 归一化文本（同一段话在不同目标语言下互不干扰） */
function cacheKey(targetLang, text) {
  return `${String(targetLang || '')}|${normalizeForCompare(text)}`;
}

module.exports = {
  normalizeForCompare,
  levenshtein,
  similarity,
  isSameContent,
  cacheKey,
};
