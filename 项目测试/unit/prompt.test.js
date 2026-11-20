'use strict';
/**
 * 提示词与文本清洗单元测试（F-07、M1-T4、M4-T4）
 *
 * 重点覆盖 OCR 实战发现的「汉字之间被插入空格」问题：
 * Windows OCR 常输出「欢 迎 使 用」，必须在送翻译前折叠，否则译文质量明显下降。
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  buildSystemPrompt, buildMessages, cleanTranslation, normalizeSourceText, collapseCjkSpaces,
  LOCAL_SYSTEM_PROMPT,
} = require('../../项目代码/src/core/translate/prompt');

test('buildSystemPrompt 替换 {target} 占位符', () => {
  const sys = buildSystemPrompt('Translate the user text into {target}.', 'ja');
  assert.ok(sys.includes('日语') || sys.toLowerCase().includes('japanese'), sys);
  assert.ok(!sys.includes('{target}'));
});

test('buildSystemPrompt 无占位符时追加目标语言说明', () => {
  const sys = buildSystemPrompt('You are a translator.', 'en');
  assert.ok(sys.startsWith('You are a translator.'));
  assert.ok(/Target language:/.test(sys));
});

test('buildSystemPrompt 空模板回落到默认提示', () => {
  const sys = buildSystemPrompt('', 'zh');
  assert.ok(sys.length > 10);
});

test('buildMessages 把源语言标注放进 system，user 正文保持原文不动', () => {
  // 曾经的实现把「[source language: xx]」塞进 user 正文，小模型会把这一行
  // 一起抄进译文（实测），所以改为写进 system prompt。
  const msgs = buildMessages({ text: 'Hello', targetLang: 'zh', sourceLang: 'en' });
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'system');
  assert.strictEqual(msgs[1].role, 'user');
  assert.strictEqual(msgs[1].content, 'Hello');
  assert.match(msgs[0].content, /Source language: \S+/i);
});

test('buildMessages 在 auto 源语言时不标注源语言', () => {
  const msgs = buildMessages({ text: 'Hello', targetLang: 'zh', sourceLang: 'auto' });
  assert.strictEqual(msgs[1].content, 'Hello');
  assert.ok(!/source language/i.test(msgs[0].content));
});

test('目标为繁体时 system prompt 追加逐字转换指令', () => {
  const msgs = buildMessages({ text: '请点击保存', targetLang: 'zh-TW', sourceLang: 'auto' });
  assert.match(msgs[0].content, /Traditional Chinese/i);
  assert.match(msgs[0].content, /请→請/);
});

test('本地离线提示词就是文档要求的那句话', () => {
  assert.ok(LOCAL_SYSTEM_PROMPT.includes('You are a translator'));
  assert.ok(LOCAL_SYSTEM_PROMPT.includes('Output only the translated text'));
});

test('cleanTranslation 去掉「译文：」前缀与包裹引号', () => {
  assert.strictEqual(cleanTranslation('译文：你好世界'), '你好世界');
  assert.strictEqual(cleanTranslation('translation: Hello world'), 'Hello world');
  assert.strictEqual(cleanTranslation('“你好”'), '你好');
  assert.strictEqual(cleanTranslation('<译文>\n你好\n</译文>'), '你好');
  assert.strictEqual(cleanTranslation('   '), '');
});

test('cleanTranslation 保留内部引号与段落结构', () => {
  const raw = '他说：“你好”。\n\n\n第二段';
  const out = cleanTranslation(raw);
  assert.strictEqual(out, '他说：“你好”。\n\n第二段');
});

test('collapseCjkSpaces 折叠汉字间空格', () => {
  assert.strictEqual(collapseCjkSpaces('欢 迎 使 用 桌 面'), '欢迎使用桌面');
  assert.strictEqual(collapseCjkSpaces('字 幕 第 一 行'), '字幕第一行');
  assert.strictEqual(collapseCjkSpaces('日本語 の テスト'), '日本語のテスト');
});

test('collapseCjkSpaces 保留中英之间的必要空格', () => {
  assert.strictEqual(collapseCjkSpaces('使用 Excel 编辑'), '使用 Excel 编辑');
  assert.strictEqual(collapseCjkSpaces('Hello World'), 'Hello World');
});

test('normalizeSourceText 组合：折叠空格 + 去零宽字符 + 行首尾裁剪', () => {
  const raw = '\u200b 欢 迎 使 用\u00a0\n\n\n Hello World  ';
  const out = normalizeSourceText(raw);
  assert.ok(out.startsWith('欢迎使用'));
  assert.ok(out.includes('Hello World'));
  assert.ok(!out.includes('\u200b'));
  assert.ok(!out.includes('\u00a0'));
});

test('normalizeSourceText 处理空输入', () => {
  assert.strictEqual(normalizeSourceText(''), '');
  assert.strictEqual(normalizeSourceText(null), '');
  assert.strictEqual(normalizeSourceText(undefined), '');
});
