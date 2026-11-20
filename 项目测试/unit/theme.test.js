'use strict';
/**
 * 外观自定义（需求 1 / 需求 3）单元测试
 *
 * 覆盖：
 *  - 渲染进程共享主题模块 TranslatorTheme（纯函数 + apply 写 CSS 变量）
 *  - 配置侧钳制：主题色非法回落、透明度/模糊/圆角越界收敛、浮窗尺寸钳制、背景图相对路径被拒
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { prepare } = require('../helpers/env');
prepare();

const ROOT = path.resolve(__dirname, '..', '..', '项目代码');
const Theme = require(path.join(ROOT, 'src', 'renderer', 'shared', 'theme.js'));
const { ConfigStore } = require(path.join(ROOT, 'src', 'core', 'config', 'store.js'));
const { createLogger } = require(path.join(ROOT, 'src', 'core', 'log.js'));

const logger = createLogger({ level: 'error', console: false });

function tmpStore(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-theme-' + tag + '-'));
  const file = path.join(dir, 'config.json');
  const store = new ConfigStore({ file, logger });
  store.load();
  return { store, file, dir };
}

test('theme.normalize 收敛越界值并回落非法颜色', () => {
  const a = Theme.normalize({
    accent: 'red; background: url(x)', // 非法
    background: '#FFF', // 合法三色
    opacity: 5,
    blur: -3,
    radius: 99,
    bgImageOpacity: -1,
    bgImageFit: 'weird',
  });
  assert.strictEqual(a.accent, Theme.DEFAULTS.accent);
  assert.strictEqual(a.background, '#ffffff');
  assert.strictEqual(a.opacity, 1);
  assert.strictEqual(a.blur, 0);
  assert.strictEqual(a.radius, 28);
  assert.strictEqual(a.bgImageOpacity, 0);
  assert.strictEqual(a.bgImageFit, 'cover');
});

test('theme.palette 浅色背景自动切深色文字', () => {
  const light = Theme.palette({ background: '#f4f6fb' });
  assert.strictEqual(light.light, true);
  assert.strictEqual(light.fg, '#16181d');
  const dark = Theme.palette({ background: '#12151c' });
  assert.strictEqual(dark.light, false);
  assert.match(dark.fg, /^#e8ecf3$/i);
  // 卡片背景色随不透明度变化
  assert.match(dark.hudBg, /^rgba\(18, 21, 28, 0\.840\)$/);
});

test('theme.apply 把主题写进 CSS 变量', () => {
  const vars = {};
  const fakeDoc = {
    documentElement: {
      style: { setProperty: (k, v) => { vars[k] = v; } },
      dataset: {},
    },
  };
  const p = Theme.apply(fakeDoc, { accent: '#a97bff', background: '#141220', opacity: 0.6, blur: 8, radius: 18 }, { dataUrl: 'data:image/png;base64,AAA' });
  assert.strictEqual(vars['--accent'], '#a97bff');
  assert.strictEqual(vars['--bg'], '#141220');
  assert.strictEqual(vars['--hud-blur'], '8px');
  assert.strictEqual(vars['--hud-radius'], '18px');
  assert.match(vars['--hud-bg'], /rgba\(20, 18, 32, 0\.600\)/);
  assert.match(vars['--theme-image'], /^url\("data:image\/png;base64,AAA"\)$/);
  assert.strictEqual(vars['--has-image'], '1');
  assert.match(vars['--bg-veil'], /^rgba\(20, 18, 32, 0\.520\)$/);
  assert.match(vars['--bg-elevated-veil'], /^rgba\(/);
  assert.strictEqual(fakeDoc.documentElement.dataset.theme, 'dark');
  assert.strictEqual(fakeDoc.documentElement.dataset.hasImage, '1');
  assert.strictEqual(p.light, false);
});

test('theme.imageStyle 支持铺满/完整/平铺', () => {
  const url = 'data:image/png;base64,QQ==';
  assert.strictEqual(Theme.imageStyle({ bgImageFit: 'cover' }, url).size, 'cover');
  assert.strictEqual(Theme.imageStyle({ bgImageFit: 'contain' }, url).size, 'contain');
  const tile = Theme.imageStyle({ bgImageFit: 'tile' }, url);
  assert.strictEqual(tile.size, 'auto');
  assert.strictEqual(tile.repeat, 'repeat');
  assert.strictEqual(Theme.imageStyle({}, '').image, 'none');
});

test('store.patch 钳制外观与浮窗尺寸', () => {
  const { store } = tmpStore('patch');
  const view = store.patch({
    appearance: { accent: 'not-a-color', background: '#000000', opacity: 2, blur: 99, radius: -5, bgImageOpacity: 3, bgImage: 'relative/path.png' },
    hud: { width: 5, height: 5000, fontSize: 99, opacity: 9, autoHeight: false },
  });
  assert.strictEqual(view.appearance.accent, '#4c8dff');
  assert.strictEqual(view.appearance.background, '#000000');
  assert.strictEqual(view.appearance.opacity, 1);
  assert.strictEqual(view.appearance.blur, 30);
  assert.strictEqual(view.appearance.radius, 0);
  assert.strictEqual(view.appearance.bgImageOpacity, 1);
  // 相对路径不允许（防止被拿去做任意路径读取）
  assert.strictEqual(view.appearance.bgImage, '');
  assert.strictEqual(view.hud.width, 280);
  assert.strictEqual(view.hud.height, 900);
  assert.strictEqual(view.hud.fontSize, 28);
  assert.strictEqual(view.hud.opacity, 1);
  assert.strictEqual(view.hud.autoHeight, false);
});

test('store.patch 保存绝对路径背景图并落盘', () => {
  const { store, file } = tmpStore('bg');
  const bg = path.join(path.dirname(file), 'theme', 'bg.png');
  store.patch({ appearance: { bgImage: bg } });
  assert.strictEqual(store.publicView().appearance.bgImage, bg);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(onDisk.appearance.bgImage, bg);
  // 清空后回到空串
  store.patch({ appearance: { bgImage: '' } });
  assert.strictEqual(store.publicView().appearance.bgImage, '');
});

test('两处背景图各自独立：浮窗槽位与设置页槽位互不影响', () => {
  const url = 'data:image/png;base64,AA';
  const raw = {
    bgImage: 'D:\\data\\theme\\hud.png',
    bgImageOpacity: 0.6,
    settingsBgImage: 'D:\\data\\theme\\settings.png',
    settingsBgImageOpacity: 0.2,
  };
  const a = Theme.normalize(raw);
  // 两边都各自有图，且不透明度分别取自自己的槽位
  assert.strictEqual(Theme.imageStyle(a, url, 'hud').opacity, 0.6);
  assert.strictEqual(Theme.imageStyle(a, url, 'settings').opacity, 0.2);

  // 设置页只设自己的图时，浮窗侧即便没有图也能各走各的
  const onlySettings = Theme.normalize({ settingsBgImage: 'D:\\data\\theme\\s.png' });
  const d1 = makeFakeDoc();
  Theme.apply(d1, onlySettings, { dataUrl: url, surface: 'settings' });
  assert.match(d1.documentElement.style.props['--theme-image'], /^url\(/);
  const d2 = makeFakeDoc();
  Theme.apply(d2, onlySettings, { dataUrl: '', surface: 'hud' });
  assert.strictEqual(d2.documentElement.style.props['--theme-image'], 'none');
  assert.strictEqual(d2.documentElement.dataset.hasImage, '0');

  // 旧的「生效范围」字段已废弃
  assert.strictEqual(Theme.normalize({ bgImageScope: 'hud' }).bgImageScope, undefined);
});

test('浮窗罩层随图片不透明度加深，保证按钮与文字可读', () => {
  const low = makeFakeDoc();
  Theme.apply(low, { bgImage: '/x/bg.png', bgImageOpacity: 0.1 }, { dataUrl: 'data:image/png;base64,AA', surface: 'hud' });
  const high = makeFakeDoc();
  Theme.apply(high, { bgImage: '/x/bg.png', bgImageOpacity: 1 }, { dataUrl: 'data:image/png;base64,AA', surface: 'hud' });
  const alpha = (doc) => Number(/rgba\([^)]*?([\d.]+)\)$/.exec(doc.documentElement.style.props['--hud-veil'])[1]);
  assert.ok(alpha(high) > alpha(low), '图片越透明罩层应越厚');
  assert.ok(alpha(high) <= 0.86);
  // 标题栏底片与文字投影必须下发，否则背景图下图标会"消失"
  assert.ok(high.documentElement.style.props['--hud-head-bg']);
  assert.ok(high.documentElement.style.props['--text-shadow']);
});

/** 极简假 document，只为 Theme.apply 写入 CSS 变量与 dataset */
function makeFakeDoc() {
  const els = [];
  return {
    documentElement: { style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, dataset: {} },
    querySelectorAll: () => els,
  };
}

