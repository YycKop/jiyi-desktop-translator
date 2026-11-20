'use strict';
/**
 * 背景图文件模块测试（第八轮缺陷修复回归）
 *
 * 对应用户反馈：「无法设置背景图，报错 设置背景图失败:Cannot read properties of
 * undefined (reading 'home')」——根因是取数据目录时用了并不存在的 engine.paths。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { prepare, freshHome } = require('../helpers/env');

prepare();

const themeFiles = require('../../项目代码/src/main/theme-files');

test('themeDir：在数据目录下创建 theme/', () => {
  const home = freshHome('theme-dir');
  process.env.TRANSLATOR_HOME = home;
  // paths 会缓存数据目录，重置后再取
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const dir = themeFiles.themeDir();
  assert.strictEqual(dir, path.join(home, 'theme'));
  assert.ok(fs.existsSync(dir), '主题目录应已创建');
  // 重复调用不应抛错
  assert.strictEqual(themeFiles.themeDir(), dir);
});

test('readThemeImage：读 PNG 为 data URL', () => {
  const home = freshHome('theme-read');
  process.env.TRANSLATOR_HOME = home;
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const dir = themeFiles.themeDir();
  const file = path.join(dir, 'bg-test.png');
  // 1×1 透明 PNG
  fs.writeFileSync(file, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ));

  const img = themeFiles.readThemeImage(file);
  assert.ok(img, '应能读到图片');
  assert.ok(img.dataUrl.startsWith('data:image/png;base64,'), img.dataUrl.slice(0, 40));
  assert.strictEqual(img.bytes > 0, true);
});

test('readThemeImage：非法输入返回 null（不抛错）', () => {
  assert.strictEqual(themeFiles.readThemeImage(''), null);
  assert.strictEqual(themeFiles.readThemeImage(null), null);
  assert.strictEqual(themeFiles.readThemeImage(path.join(__dirname, 'nope.png')), null);
});

test('readThemeImage：非图片扩展名被拒绝', () => {
  const home = freshHome('theme-ext');
  process.env.TRANSLATOR_HOME = home;
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const file = path.join(themeFiles.themeDir(), 'evil.txt');
  fs.writeFileSync(file, 'not an image');
  assert.strictEqual(themeFiles.readThemeImage(file), null);
});

test('importThemeImage：复制进 theme/ 并返回 data URL', () => {
  const home = freshHome('theme-import');
  process.env.TRANSLATOR_HOME = home;
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const src = path.join(home, 'picked.png');
  fs.writeFileSync(src, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ));

  const out = themeFiles.importThemeImage(src, 12345);
  assert.strictEqual(out.path, path.join(themeFiles.themeDir(), 'hud-12345.png'));
  assert.ok(fs.existsSync(out.path), '图片应被复制到主题目录');
  assert.ok(out.dataUrl && out.dataUrl.startsWith('data:image/png;base64,'));
});

test('importThemeImage：超限与格式错误给出明确错误码', () => {
  const home = freshHome('theme-bad');
  process.env.TRANSLATOR_HOME = home;
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const txt = path.join(home, 'x.txt');
  fs.writeFileSync(txt, 'hi');
  assert.throws(() => themeFiles.importThemeImage(txt), (e) => e.code === 'CONFIG_INVALID');

  const big = path.join(home, 'big.png');
  fs.writeFileSync(big, Buffer.alloc(themeFiles.MAX_THEME_BYTES + 1, 0));
  assert.throws(() => themeFiles.importThemeImage(big), /图片过大/);
});

test('resolveSurfaceImage：设置页留空时沿用浮窗图', () => {
  const home = freshHome('theme-surface');
  process.env.TRANSLATOR_HOME = home;
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const dir = themeFiles.themeDir();
  const hudFile = path.join(dir, 'hud-1.png');
  fs.writeFileSync(hudFile, Buffer.from('89504e470d0a1a0a', 'hex'));

  // 浮窗槽位
  const hud = themeFiles.resolveSurfaceImage({ bgImage: hudFile, settingsBgImage: '' }, 'hud');
  assert.ok(hud && hud.dataUrl.startsWith('data:image/png'));
  assert.strictEqual(hud.fallback, false);

  // 设置页槽位留空 → 回落浮窗图，并标记 fallback
  const setFallback = themeFiles.resolveSurfaceImage({ bgImage: hudFile, settingsBgImage: '' }, 'settings');
  assert.ok(setFallback && setFallback.fallback === true);
  assert.strictEqual(setFallback.path, hudFile);

  // 设置页有自己的图 → 用自己那张，不回落
  const setFile = path.join(dir, 'settings-1.png');
  fs.writeFileSync(setFile, Buffer.from('89504e470d0a1a0a', 'hex'));
  const setOwn = themeFiles.resolveSurfaceImage({ bgImage: hudFile, settingsBgImage: setFile }, 'settings');
  assert.strictEqual(setOwn.path, setFile);
  assert.strictEqual(setOwn.fallback, false);
});

test('removeThemeImage：只允许删除 theme/ 下的文件', () => {
  const home = freshHome('theme-remove');
  process.env.TRANSLATOR_HOME = home;
  const paths = require('../../项目代码/src/core/paths');
  paths.resetHomeCache();

  const dir = themeFiles.themeDir();
  const inside = path.join(dir, 'hud-9.png');
  fs.writeFileSync(inside, Buffer.from('x'));
  assert.strictEqual(themeFiles.removeThemeImage(inside), true);
  assert.strictEqual(fs.existsSync(inside), false);

  // 目录外的文件不能被删（防越权）
  const outside = path.join(home, 'keep.txt');
  fs.writeFileSync(outside, 'keep');
  assert.strictEqual(themeFiles.removeThemeImage(outside), false);
  assert.strictEqual(fs.existsSync(outside), true);
  // 空路径安全返回
  assert.strictEqual(themeFiles.removeThemeImage(''), false);
});
