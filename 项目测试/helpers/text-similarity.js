'use strict';
/**
 * 文本相似度工具（测试用）
 *
 * 用于 D1.3「中英文印刷体识别率 ≥95%」的量化验收：以字符级编辑距离计算相似度。
 * 归一化规则与实际流水线一致（折叠汉字间空格、忽略大小写与空白差异），
 * 这样测的是"可用性"而不是逐字节一致性。
 */

/** 与 core/translate/prompt.js 的 collapseCjkSpaces 等价（测试侧独立实现，避免自证） */
const CJK = '\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF';
const CJK_SPACE_RE = new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g');

function stripCjkSpaces(text) {
  let s = String(text || '');
  let prev;
  do {
    prev = s;
    s = s.replace(CJK_SPACE_RE, '$1');
  } while (s !== prev);
  return s;
}

/** 归一化：去空白、统一大小写、折叠汉字间空格 */
function normalize(text) {
  return stripCjkSpaces(String(text || ''))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Levenshtein 编辑距离（两行滚动数组，O(min(n,m)) 空间） */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length];
}

/** 相似度 0..1（1 表示完全一致） */
function similarity(actual, expected) {
  const a = normalize(actual);
  const b = normalize(expected);
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** 逐字符 diff 摘要，便于报告里定位错字 */
function diffSummary(actual, expected) {
  const a = normalize(actual);
  const b = normalize(expected);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  let ta = a.length;
  let tb = b.length;
  while (ta > i && tb > i && a[ta - 1] === b[tb - 1]) {
    ta -= 1;
    tb -= 1;
  }
  return {
    firstDiffAt: i,
    actualSlice: a.slice(i, ta),
    expectedSlice: b.slice(i, tb),
    expectedLen: b.length,
  };
}

module.exports = { normalize, levenshtein, similarity, diffSummary, stripCjkSpaces };
