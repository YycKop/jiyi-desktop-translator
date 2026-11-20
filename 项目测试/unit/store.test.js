'use strict';
/**
 * 配置存储单元测试（F-05/F-08/F-09、M4-T1/M4-T2、KEY-02/KEY-04）
 *
 * 覆盖：默认值生成、Base URL 校验、API 卡片增删改排序、密钥加密落盘、
 * 配置补丁的字段隔离（secrets/apis 不可由外部写入）、框选区域校验、损坏配置归档。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { freshHome } = require('../helpers/env');
const { ConfigStore } = require('../../项目代码/src/core/config/store');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };

function makeStore() {
  const dir = freshHome('store');
  const file = path.join(dir, 'config.json');
  const store = new ConfigStore({ file, logger: silentLogger });
  store.load();
  return { store, dir, file };
}

test('load 生成默认配置并落盘，含随机 salt', () => {
  const { store, file } = makeStore();
  assert.ok(fs.existsSync(file), '配置文件应被写入');
  const cfg = store.raw();
  assert.strictEqual(cfg.general.targetLang, 'zh');
  assert.strictEqual(cfg.capture.intervalMs, 2000);
  assert.strictEqual(cfg.capture.mode, 'interval');
  assert.strictEqual(cfg.network.primaryTimeoutMs, 5000);
  assert.strictEqual(cfg.network.maxApiAttempts, 2);
  assert.ok(cfg.secrets.salt && cfg.secrets.salt.length > 10, '应生成加密盐');
  assert.strictEqual(store.publicView().secrets, undefined, '对外视图不得包含 secrets 段');
});

test('addApi 校验 Base URL 与模型名', () => {
  const { store } = makeStore();
  assert.throws(() => store.addApi({ name: 'bad', baseUrl: 'ftp://x', model: 'm' }), /http/i);
  assert.throws(() => store.addApi({ name: 'bad', baseUrl: 'https://x.test/v1', model: '' }), /模型/);
  const api = store.addApi({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
  assert.ok(api.id);
  assert.strictEqual(api.enabled, true);
  assert.strictEqual(api.order, 0);
});

test('密钥加密保存：文件不含明文，读取可还原，列表只给掩码', () => {
  const { store, file } = makeStore();
  const api = store.addApi({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
  const plaintext = 'sk-unit-test-abcdefgh1234';
  const masked = store.setApiSecret(api.id, plaintext);

  assert.strictEqual(masked, 'sk-****1234');
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes(plaintext), '配置文件绝不能出现明文密钥（KEY-04）');
  assert.ok(onDisk.includes('v1:'), '应以 v1: 前缀的密文形式保存');

  assert.strictEqual(store.getApiSecret(api.id), plaintext, '内部应能解密还原');
  const listed = store.listApis().find((a) => a.id === api.id);
  assert.strictEqual(listed.hasKey, true);
  assert.ok(!JSON.stringify(listed).includes(plaintext), '列表视图不得泄漏明文');
});

test('reorderApis 按传入顺序重排并重写 order', () => {
  const { store } = makeStore();
  const a = store.addApi({ name: 'A', baseUrl: 'https://a.test/v1', model: 'a' });
  const b = store.addApi({ name: 'B', baseUrl: 'https://b.test/v1', model: 'b' });
  const c = store.addApi({ name: 'C', baseUrl: 'https://c.test/v1', model: 'c' });

  store.reorderApis([c.id, a.id, b.id]);
  assert.deepStrictEqual(store.listApis().map((x) => x.name), ['C', 'A', 'B']);
  assert.deepStrictEqual(store.listApis().map((x) => x.order), [0, 1, 2]);
  assert.deepStrictEqual(store.getEnabledApisOrdered().map((x) => x.name), ['C', 'A', 'B']);
});

test('禁用与删除 API 后不再进入候选链', () => {
  const { store } = makeStore();
  const a = store.addApi({ name: 'A', baseUrl: 'https://a.test/v1', model: 'a' });
  store.addApi({ name: 'B', baseUrl: 'https://b.test/v1', model: 'b' });
  store.updateApi(a.id, { enabled: false });
  assert.deepStrictEqual(store.getEnabledApisOrdered().map((x) => x.name), ['B']);

  store.removeApi(a.id);
  assert.deepStrictEqual(store.listApis().map((x) => x.name), ['B']);
  assert.strictEqual(store.listApis()[0].order, 0, '删除后应重排序号');
});

test('patch 忽略 secrets 与 apis 字段，并钳制数值范围', () => {
  const { store } = makeStore();
  store.addApi({ name: 'A', baseUrl: 'https://a.test/v1', model: 'a' });
  const before = store.listApis().length;

  const view = store.patch({
    secrets: { salt: 'hacked', items: { x: 'y' } },
    apis: [{ id: 'fake', name: 'fake' }],
    capture: { intervalMs: 5 },
    network: { maxApiAttempts: 99 },
  });

  assert.ok(view, 'patch 应返回对外视图');
  assert.strictEqual(store.listApis().length, before, '外部不可通过 patch 改写 apis');
  assert.notStrictEqual(store.raw().secrets.salt, 'hacked', 'secrets 段必须被忽略');
  assert.strictEqual(store.raw().capture.intervalMs, 200, '间隔下限 200ms（与 loop.js 的 MIN_INTERVAL 对齐）');
  assert.strictEqual(store.raw().network.maxApiAttempts, 5, '尝试次数上限 5');
});

test('框选区域校验：非数字与过小区域都被拒绝', () => {
  const { store } = makeStore();
  assert.throws(() => store.patch({ capture: { lastSelection: { x: 'a', y: 0, width: 10, height: 10 } } }), /数字/);
  assert.throws(() => store.patch({ capture: { lastSelection: { x: 0, y: 0, width: 2, height: 2 } } }), /过小/);
  const view = store.patch({ capture: { lastSelection: { x: 10, y: 20, width: 200, height: 100 } } });
  assert.deepStrictEqual(view.capture.lastSelection, { x: 10, y: 20, width: 200, height: 100 });
});

test('配置损坏时归档为 .broken-* 并回到默认值', () => {
  const { dir } = makeStore();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{ this is not json', 'utf8');

  const store = new ConfigStore({ file, logger: silentLogger });
  const cfg = store.load();
  assert.strictEqual(cfg.general.targetLang, 'zh');
  const broken = fs.readdirSync(dir).filter((f) => f.includes('.broken-'));
  assert.strictEqual(broken.length, 1, '损坏的配置应被归档而非丢弃');
});

test('getPresets 返回预置模板且附带默认系统提示', () => {
  const { store } = makeStore();
  const presets = store.getPresets();
  assert.ok(presets.length >= 4);
  const deepseek = presets.find((p) => p.id === 'deepseek');
  assert.strictEqual(deepseek.baseUrl, 'https://api.deepseek.com/v1');
  assert.ok(presets.every((p) => typeof p.systemPrompt === 'string' && p.systemPrompt.length > 10));
});

test('识别引擎默认 auto，且只接受白名单值', () => {
  const { store, file } = makeStore();
  assert.strictEqual(store.raw().ocr.engine, 'auto', '默认应跟随自动选择');

  for (const engine of ['rapid', 'winrt', 'tesseract']) {
    const view = store.patch({ ocr: { engine } });
    assert.strictEqual(view.ocr.engine, engine);
  }

  // 非法值不报错，静默回落 auto（设置页下拉只有四个选项，防手改配置崩掉启动）
  const fallback = store.patch({ ocr: { engine: 'paddle' } });
  assert.strictEqual(fallback.ocr.engine, 'auto');

  // 重启后仍能读回用户选择
  store.patch({ ocr: { engine: 'winrt' } });
  const again = new ConfigStore({ file, logger: silentLogger });
  again.load();
  assert.strictEqual(again.raw().ocr.engine, 'winrt');
});

/* ---------------------------------------------- 第十八轮：优先级与字幕模式 */

test('翻译优先级默认 online，且只接受 online / offline', () => {
  const { store } = makeStore();
  assert.strictEqual(store.raw().general.priority, 'online', '默认与第十五轮之前的降级顺序一致');

  assert.strictEqual(store.patch({ general: { priority: 'offline' } }).general.priority, 'offline');
  assert.strictEqual(store.patch({ general: { priority: 'online' } }).general.priority, 'online');
  // 手改配置写错值不该让启动链坏掉
  assert.strictEqual(store.patch({ general: { priority: 'fastest' } }).general.priority, 'online');
});

test('浮窗模式默认 card，字幕参数被钳制到合理范围', () => {
  const { store } = makeStore();
  assert.strictEqual(store.raw().hud.mode, 'card', '老用户升级后仍是卡片模式');

  assert.strictEqual(store.patch({ hud: { mode: 'subtitle' } }).hud.mode, 'subtitle');
  assert.strictEqual(store.patch({ hud: { mode: 'mini' } }).hud.mode, 'card', '非法模式回落卡片');

  assert.strictEqual(store.patch({ hud: { subtitleFontSize: 999 } }).hud.subtitleFontSize, 48);
  assert.strictEqual(store.patch({ hud: { subtitleFontSize: 2 } }).hud.subtitleFontSize, 12);
  assert.strictEqual(store.patch({ hud: { subtitleWidth: 5000 } }).hud.subtitleWidth, 2400);
  assert.strictEqual(store.patch({ hud: { subtitleHeight: 9 } }).hud.subtitleHeight, 64, '手填高度至少 64px');
  assert.strictEqual(store.patch({ hud: { subtitleHeight: 0 } }).hud.subtitleHeight, 0, '0 = 自动');
  assert.deepStrictEqual(
    store.patch({ hud: { subtitlePoint: { x: 100.6, y: 40.2 } } }).hud.subtitlePoint,
    { x: 101, y: 40 },
    '坐标取整，避免亚像素抖动',
  );
  assert.strictEqual(store.patch({ hud: { subtitlePoint: { x: 'left' } } }).hud.subtitlePoint, null);
  assert.strictEqual(store.patch({ hud: { subtitleBackdrop: true } }).hud.subtitleBackdrop, true);
});
