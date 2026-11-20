'use strict';
/**
 * 文本指纹测试（对应「OCR 抖动导致重复计费」的修复）
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeForCompare, levenshtein, similarity, isSameContent, cacheKey,
} = require('../../项目代码/src/core/translate/fingerprint');

test('易混字符归一：i/l/1/| 与 O/0 视为同一字符', () => {
  assert.strictEqual(normalizeForCompare('PIease'), normalizeForCompare('Please'));
  assert.strictEqual(normalizeForCompare('LOg in tO'), normalizeForCompare('Log in to'));
  assert.strictEqual(normalizeForCompare('he11o'), normalizeForCompare('hello'));
  assert.strictEqual(normalizeForCompare('w0rld'), normalizeForCompare('world'));
});

test('空白与标点被忽略，中文去空格后等价', () => {
  assert.strictEqual(normalizeForCompare('欢 迎 使 用'), normalizeForCompare('欢迎使用'));
  assert.strictEqual(normalizeForCompare('Hello, World!'), normalizeForCompare('hello world'));
});

test('编辑距离与相似度', () => {
  assert.strictEqual(levenshtein('abc', 'abc'), 0);
  assert.strictEqual(levenshtein('abc', 'abd'), 1);
  assert.strictEqual(similarity('abc', 'abc'), 1);
  assert.ok(similarity('abcdefghij', 'abcdefghix') > 0.85);
});

test('isSameContent：抖动容忍 + 真实变化能区分', () => {
  assert.strictEqual(isSameContent('Please click', 'PIease click').same, true);
  assert.strictEqual(isSameContent('Log in to see', 'LO g in tO see').same, true);
  const changed = isSameContent('Press Save to continue', 'Open the settings window now');
  assert.strictEqual(changed.same, false);
  assert.ok(changed.similarity < 0.6);
});

test('isSameContent：阈值可调', () => {
  const a = 'the quick brown fox jumps';
  const b = 'the quick brown fox jumpz';
  assert.strictEqual(isSameContent(a, b, { threshold: 0.9 }).same, true);
  assert.strictEqual(isSameContent(a, b, { threshold: 0.999 }).same, false);
});

test('空文本不算相同（避免把「没识别到文字」当成没变化）', () => {
  assert.strictEqual(isSameContent('something', '').same, false);
});

test('cacheKey 区分目标语言', () => {
  assert.notStrictEqual(cacheKey('zh', 'Hello'), cacheKey('ja', 'Hello'));
  assert.strictEqual(cacheKey('zh', 'Hello'), cacheKey('zh', 'hello'));
});
