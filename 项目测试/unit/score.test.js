'use strict';
/**
 * OCR 结果打分与择优测试（对应「i 被识别成 l」的修复）
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  scoreText, chooseBest, mergeLines, hasCaseJump, repairText, repairCjkPunctuation,
} = require('../../项目代码/src/core/ocr/score');

test('hasCaseJump 识别 OCR 典型错误形状', () => {
  assert.strictEqual(hasCaseJump('PIease'), true);
  assert.strictEqual(hasCaseJump('JUmps'), true);
  assert.strictEqual(hasCaseJump('LOg'), true);
  assert.strictEqual(hasCaseJump('SubtitIes'), true);
  assert.strictEqual(hasCaseJump('Please'), false);
  assert.strictEqual(hasCaseJump('Log'), false);
  assert.strictEqual(hasCaseJump('iPhone'), false, '首字母大写 + 词内大写是正常写法');
});

test('scoreText：干净文本 0 分，脏文本有惩罚', () => {
  assert.strictEqual(scoreText('Please click the link to continue.').score, 0);
  assert.ok(scoreText('PIease click the link to continue.').score > 0);
  assert.ok(scoreText('Click th e link').score > 0);
  assert.ok(scoreText('———').score > 0, '纯符号行算噪声');
  assert.strictEqual(scoreText('欢迎使用桌面翻译助手').score, 0, '中文不做大小写/单字母判断');
});

test('chooseBest：两遍结果取更干净的一遍', () => {
  const r = chooseBest([
    { text: 'PIease click the link', scale: 2 },
    { text: 'Please click the link', scale: 3 },
  ]);
  assert.strictEqual(r.best.scale, 3);
  assert.strictEqual(r.reason, 'better-pass');

  const r2 = chooseBest([
    { text: 'Click the link, it will fill in.', scale: 2 },
    { text: 'Click th e link, it will fill in.', scale: 3 },
  ]);
  assert.strictEqual(r2.best.scale, 2);
});

test('chooseBest：同分取靠前的候选（2x 更快）', () => {
  const r = chooseBest([
    { text: 'identical text', scale: 2 },
    { text: 'identical text', scale: 3 },
  ]);
  assert.strictEqual(r.best.scale, 2);
  assert.strictEqual(r.reason, 'first-pass');
});

test('chooseBest：单候选与全空', () => {
  const one = chooseBest([{ text: 'only one', scale: 2 }]);
  assert.strictEqual(one.best.scale, 2);
  assert.strictEqual(one.reason, 'single-pass');

  const none = chooseBest([{ text: '', scale: 2 }, { text: '   ', scale: 3 }]);
  assert.strictEqual(none.best, null);
  assert.strictEqual(none.reason, 'empty');
});

test('repairText：修正实测出现过的 i/l/O 混淆', () => {
  assert.strictEqual(repairText('PIease click the link').text, 'Please click the link');
  assert.strictEqual(repairText('SubtitIes line one').text, 'Subtitles line one');
  assert.strictEqual(repairText('Log in tO see').text, 'Log in to see');
  // 注意：JUmps / LOg 这类「连续大写开头」不靠修复规则，而是靠多遍识别选另一遍
  assert.strictEqual(hasCaseJump('JUmps'), true);
});

test('repairText：不破坏正常写法', () => {
  for (const s of [
    'Play on your iPhone today',
    'Open macOS settings now',
    'The USA and the UK',
    'Hello World, this is a test.',
    '欢迎使用桌面翻译助手',
  ]) {
    assert.strictEqual(repairText(s).text, s, s);
    assert.strictEqual(repairText(s).changed, false, s);
  }
});

// ---------------------------------------------------------------- 中文标点（用户反馈）

test('repairCjkPunctuation：去掉汉字间空格、半角标点转全角', () => {
  const raw = '请 点 击 保 存 按 钮 ， 然 后 继 续 。\n提 示 ： 请 勿 关 闭 窗 口 ！';
  const r = repairCjkPunctuation(raw);
  assert.strictEqual(r.text, '请点击保存按钮，然后继续。\n提示：请勿关闭窗口！');
  assert.strictEqual(r.changed, true);
});

test('repairCjkPunctuation：半角标点紧邻中文时转全角', () => {
  assert.strictEqual(repairCjkPunctuation('请点击保存按钮, 然后继续.').text, '请点击保存按钮，然后继续。');
  assert.strictEqual(repairCjkPunctuation('提示: 请勿关闭窗口!').text, '提示：请勿关闭窗口！');
  assert.strictEqual(repairCjkPunctuation('见说明(第3页)').text, '见说明（第3页）');
});

test('repairCjkPunctuation：中文旁的成对引号', () => {
  assert.strictEqual(repairCjkPunctuation('点击"保存"按钮').text, '点击“保存”按钮');
});

test('repairCjkPunctuation：不误伤英文、数字与中英混排', () => {
  for (const s of [
    'Hello World, this is a test.',
    '版本 v1.2 发布于 2026.10.30',
    'Use Excel 编辑此表格',
    'a, b, c',
  ]) {
    assert.strictEqual(repairCjkPunctuation(s).text, s, s);
  }
  // 中文与拉丁字母之间的空格要保留（否则读完像粘连）
  assert.strictEqual(repairCjkPunctuation('Use Excel 编辑 此 表 格').text, 'Use Excel 编辑此表格');
});

test('scoreText：中文里夹半角标点会被扣分（多遍择优用）', () => {
  assert.ok(scoreText('请点击保存按钮,然后继续').score > 0);
  assert.strictEqual(scoreText('请点击保存按钮，然后继续。').score, 0);
});

test('mergeLines：同结构时逐行取最干净的一行', () => {
  const r = mergeLines([
    { scale: 2, text: 'PIease click the link\nThis is fine.' },
    { scale: 3, text: 'Please click the link\nThis is a fme.' },
  ]);
  assert.strictEqual(r.reason, 'line-merge');
  assert.strictEqual(r.text, 'Please click the link\nThis is fine.');
  assert.strictEqual(r.lines[0].from, 3);
  assert.strictEqual(r.lines[1].from, 2);
});

test('mergeLines：行数不一致时退回整段择优', () => {
  const r = mergeLines([
    { scale: 2, text: 'PIease click\nsecond line' },
    { scale: 3, text: 'Please click the link' },
  ]);
  assert.strictEqual(r.reason, 'pass-better-pass');
  assert.strictEqual(r.text, 'Please click the link');
});

test('mergeLines：三遍投票能纠正单遍的错认', () => {
  const r = mergeLines([
    { scale: 2, text: '请点击保存按钮，然后继续。' },
    { scale: 3, text: '请点击保扌安钮，然后继续。' },
    { scale: 2, contrast: 30, text: '请点击保存按钮，然后继续。' },
  ]);
  assert.strictEqual(r.text, '请点击保存按钮，然后继续。');
});

test('mergeLines：漏字的那份让位给更完整的一份', () => {
  const r = mergeLines([
    { scale: 2, text: '小提示：可以新框选区域。' },
    { scale: 3, text: '小提示：可以重新框选区域。' },
  ]);
  assert.strictEqual(r.text, '小提示：可以重新框选区域。');
});

test('scoreText：重复标点、行首标点、被空格拆开的运算符都会被扣分', () => {
  assert.ok(scoreText('请点击保存按钮，，然后继续。').score > 0);
  assert.ok(scoreText('，然后继续。').score > 0);
  assert.ok(scoreText('快捷键 Ctrl + Shift + T').score > 0);
  assert.strictEqual(scoreText('快捷键 Ctrl+Shift+T').score, 0);
});

test('scoreText：差一个字母的界面术语算异常，正常英文词不算', () => {
  assert.ok(scoreText('快捷键 Ctri+Shift+T').score > 0);
  assert.ok(scoreText('快捷键 CtrI').score > 0);
  assert.strictEqual(scoreText('This is fine.').score, 0);
  assert.strictEqual(scoreText('iPhone and macOS').score, 0);
});

test('repairCjkPunctuation：合并重复标点、去掉行首标点、收紧运算符空格', () => {
  assert.strictEqual(repairCjkPunctuation('请点击保存按钮，，然后继续。').text, '请点击保存按钮，然后继续。');
  assert.strictEqual(repairCjkPunctuation('，然后继续。').text, '然后继续。');
  assert.strictEqual(repairCjkPunctuation('快捷键 Ctrl + Shift + T 可用').text, '快捷键 Ctrl+Shift+T 可用');
  // 中文里的「+」不能被收紧成半角连写，算式空格也要保留
  assert.strictEqual(repairCjkPunctuation('1 + 1 = 2').text, '1 + 1 = 2');
});

test('repairCjkPunctuation：中文旁的半角标点转全角，数字不受影响', () => {
  assert.strictEqual(repairCjkPunctuation('请点击保存按钮,然后继续.').text, '请点击保存按钮，然后继续。');
  assert.strictEqual(repairCjkPunctuation('版本 1.2 发布于 2026.10.31').text, '版本 1.2 发布于 2026.10.31');
  assert.strictEqual(repairCjkPunctuation('准确率 100 %,耗时 3.5 秒').text, '准确率 100%，耗时 3.5 秒');
});
