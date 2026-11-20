'use strict';
/**
 * detectShortcut（原文已是目标语言 → 跳过模型）的单元测试
 * 对应需求 1（繁体/英文翻不出来）与需求 4（语言互译校验）
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const CODE = path.resolve(__dirname, '..', '..', '项目代码', 'src', 'core', 'pipeline', 'round.js');
const { detectShortcut } = require(CODE);

const ZH = '请点击保存按钮，然后继续。';
const EN = 'Click the save button to continue.';
const JA = '保存ボタンをクリックしてください。';

test('中文原文 + 目标简体中文 → 直接返回原文', () => {
  const r = detectShortcut(ZH, 'zh');
  assert.deepStrictEqual(r, { text: ZH, engine: '无需翻译' });
});

test('中文原文 + 目标繁体中文 → 字形转换，不调用模型', () => {
  const r = detectShortcut(ZH, 'zh-TW');
  assert.strictEqual(r.engine, '繁体转换');
  assert.strictEqual(r.text, '請點擊保存按鈕，然後繼續。');
});

test('已经是繁体 + 目标繁体 → 无需翻译', () => {
  const r = detectShortcut('請點擊保存按鈕', 'zh-TW');
  assert.strictEqual(r.engine, '无需翻译');
});

test('英文原文 + 目标英文 → 无需翻译', () => {
  const r = detectShortcut(EN, 'en');
  assert.strictEqual(r.engine, '无需翻译');
  assert.strictEqual(r.text, EN);
});

test('日文原文 + 目标中文 → 不得短路（含假名）', () => {
  assert.strictEqual(detectShortcut(JA, 'zh'), null);
});

test('英文原文 + 目标中文 → 不得短路', () => {
  assert.strictEqual(detectShortcut(EN, 'zh'), null);
  assert.strictEqual(detectShortcut(EN, 'zh-TW'), null);
});

test('中文原文 + 目标英文/日文 → 不得短路', () => {
  assert.strictEqual(detectShortcut(ZH, 'en'), null);
  assert.strictEqual(detectShortcut(ZH, 'ja'), null);
});

test('空文本返回 null', () => {
  assert.strictEqual(detectShortcut('', 'zh'), null);
  assert.strictEqual(detectShortcut('   ', 'zh-TW'), null);
});
