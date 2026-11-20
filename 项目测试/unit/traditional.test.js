'use strict';
/**
 * 简繁转换与「原文已是目标语言」判定的单元测试（对应需求 1/4）
 */
const test = require('node:test');
const assert = require('node:assert');

const path = require('path');
const CODE = path.resolve(__dirname, '..', '..', '项目代码', 'src', 'core', 'translate');

const {
  toTraditional, countSimplified, shouldConvert, ensureTraditional, isTraditionalTarget, TABLE_SIZE,
} = require(path.join(CODE, 'traditional.js'));
const { looksLikeChinese, looksLikeEnglish, hanRatio } = require(path.join(CODE, 'textlang.js'));

const ZH = '请点击保存按钮，然后继续。';
const ZH_TW = '請點擊保存按鈕，然後繼續。';

test('简繁表规模合理（应覆盖常用字）', () => {
  assert.ok(TABLE_SIZE > 2000, `转换表只有 ${TABLE_SIZE} 条`);
});

test('字符转换能覆盖常见简体字', () => {
  assert.strictEqual(toTraditional(ZH), ZH_TW);
  assert.strictEqual(toTraditional('该用户已经登录'), '該用戶已經登錄');
  assert.strictEqual(toTraditional('请勿关闭窗口！'), '請勿關閉窗口！');
});

test('转换不改动非汉字内容', () => {
  const s = 'Click 保存 v1.2 (2026)';
  const out = toTraditional(s);
  assert.ok(out.includes('Click'));
  assert.ok(out.includes('v1.2 (2026)'));
});

test('countSimplified 能区分简繁', () => {
  assert.ok(countSimplified(ZH) >= 5);
  assert.strictEqual(countSimplified(ZH_TW), 0);
  assert.strictEqual(countSimplified('Hello world'), 0);
});

test('shouldConvert：译文与原文完全相同时判定需要转换', () => {
  assert.strictEqual(shouldConvert(ZH, ZH), true);
});

test('shouldConvert：已经是繁体时不转换', () => {
  assert.strictEqual(shouldConvert(ZH_TW, ZH), false);
});

test('ensureTraditional：目标不是繁体时一律不动', () => {
  const r = ensureTraditional(ZH, 'English source', 'zh');
  assert.strictEqual(r.converted, false);
  assert.strictEqual(r.text, ZH);
  assert.strictEqual(r.reason, 'target-not-traditional');
});

test('ensureTraditional：目标繁体且模型原样返回简体时兜底转换', () => {
  const r = ensureTraditional(ZH, ZH, 'zh-TW');
  assert.strictEqual(r.converted, true);
  assert.strictEqual(r.text, ZH_TW);
});

test('ensureTraditional：目标繁体但已经是繁体时保持原样', () => {
  const r = ensureTraditional(ZH_TW, ZH, 'zh-TW');
  assert.strictEqual(r.converted, false);
  assert.strictEqual(r.text, ZH_TW);
});

test('isTraditionalTarget 兼容大小写与下划线写法', () => {
  for (const v of ['zh-TW', 'zh_TW', 'ZH-tw', ' zh-TW ']) assert.strictEqual(isTraditionalTarget(v), true, v);
  for (const v of ['zh', 'en', '', undefined, 'zh-CN']) assert.strictEqual(isTraditionalTarget(v), false, String(v));
});

test('looksLikeChinese：中文为真，日文/韩文/英文为假', () => {
  assert.strictEqual(looksLikeChinese(ZH), true);
  assert.strictEqual(looksLikeChinese('保存ボタンをクリックしてください。'), false);
  assert.strictEqual(looksLikeChinese('저장 버튼을 클릭하세요.'), false);
  assert.strictEqual(looksLikeChinese('Click the save button.'), false);
});

test('looksLikeEnglish：英文为真，中文为假', () => {
  assert.strictEqual(looksLikeEnglish('Click the save button to continue.'), true);
  assert.strictEqual(looksLikeEnglish(ZH), false);
});

test('hanRatio 计算与规模无关的比例', () => {
  // 「中文abc」= 2 个汉字 / 5 个可见字符
  assert.ok(Math.abs(hanRatio('中文abc') - 0.4) < 1e-9);
  assert.strictEqual(hanRatio('纯英文'), 1);
  assert.strictEqual(hanRatio(''), 0);
});
