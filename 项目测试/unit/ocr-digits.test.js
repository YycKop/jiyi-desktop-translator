'use strict';
/**
 * 数字与百分号的收敛规则回归（第十三轮，用户反馈「框里文字识别不全」）
 *
 * WinRT 在中文语境下会把 `3.5` 输出成 `3 ． 5`、`100%` 输出成 `100 ％`；
 * 旧版 repairCjkPunctuation 还会把小数点当句号改成「3。5」。这里锁住三条规则：
 *   ① 数字之间的小数点/间隔号 → 半角 `.`
 *   ② 数字后的中文百分号 → `%`，并去掉前面的空格
 *   ③ 千分位空格 → 直接合并（`1 024` → `1024`）
 */
const test = require('node:test');
const assert = require('node:assert');

const { repairCjkPunctuation } = require('../../项目代码/src/core/ocr/score');

test('数字之间的小数点被认成全角时恢复为半角', () => {
  const r = repairCjkPunctuation('共 128 个文件，耗时 3 ． 5 秒。');
  assert.ok(r.text.includes('3.5'), `期望 3.5，实际 ${r.text}`);
  assert.ok(!r.text.includes('．'), `不应残留全角句点：${r.text}`);
  assert.ok(!r.text.includes('3。5'), `不应把小数点改成句号：${r.text}`);
  assert.strictEqual(r.changed, true);
});

test('百分号前的空格去掉，保留半角百分号', () => {
  const r = repairCjkPunctuation('成功率 100 ％ 以上。');
  assert.ok(r.text.includes('100%'), `期望 100%，实际 ${r.text}`);
  assert.ok(!/100\s+[％%]/.test(r.text), `百分号前不应有余留空格：${r.text}`);
});

test('千分位空格合并，且不影响正常中文断句', () => {
  const r = repairCjkPunctuation('共 1 024 条记录，请核对。');
  assert.ok(r.text.includes('1024'), `期望 1024，实际 ${r.text}`);
  assert.ok(r.text.includes('，'), `中文标点应保持全角：${r.text}`);
});

test('不把英文单词之间的空格误合并', () => {
  const r = repairCjkPunctuation('save your work before closing');
  assert.strictEqual(r.text, 'save your work before closing');
});
