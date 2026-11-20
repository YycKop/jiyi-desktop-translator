'use strict';
/**
 * IPC 契约一致性测试（环境配置清单第 3 节 / 第 4 节）
 *
 * 背景：沙箱化 preload 不能 require 本地文件，`src/preload/index.js` 内联了一份通道表。
 * 该复制品一旦与 `src/shared/ipc-channels.js` 漂移，就会出现「点击按钮毫无反应」的哑失败，
 * 因此在 CI/自检里做静态比对：三处（契约文件、preload、主进程 handler）必须一致。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', '项目代码', 'src');
const { CHANNELS } = require('../../项目代码/src/shared/ipc-channels');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** 只允许出现在主进程 → 渲染进程方向的通道（无需 handler） */
const SEND_ONLY = new Set([CHANNELS.EVENT, CHANNELS.HUD_RENDER, CHANNELS.BALL_STATE]);

test('通道命名统一为 domain:action（小写短横线）', () => {
  for (const [key, value] of Object.entries(CHANNELS)) {
    assert.match(value, /^[a-z]+:[a-z-]+$/, `${key} -> ${value}`);
  }
});

test('preload 内联通道表与契约文件完全一致', () => {
  const preload = read('preload/index.js');
  const block = preload.slice(preload.indexOf('const CH'), preload.indexOf('};', preload.indexOf('const CH')));
  assert.ok(block.length > 100, '应能找到 preload 中的 CH 表');

  const pairs = [...block.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(pairs.length >= Object.keys(CHANNELS).length, `preload 通道数偏少：${pairs.length}`);

  const preloadMap = new Map(pairs);
  for (const [key, value] of Object.entries(CHANNELS)) {
    assert.strictEqual(preloadMap.get(key), value, `preload 中 ${key} 与契约不一致`);
  }
  for (const [key, value] of preloadMap) {
    assert.strictEqual(CHANNELS[key], value, `preload 多出未登记的通道 ${key}`);
  }
});

test('主进程为每个双向通道都注册了 handler', () => {
  const ipc = read('main/ipc.js');
  const missing = Object.entries(CHANNELS)
    .filter(([key, value]) => !SEND_ONLY.has(value) && !ipc.includes(`CHANNELS.${key}`))
    .map(([key, value]) => `${key}(${value})`);
  assert.deepStrictEqual(missing, [], `缺少 handler：${missing.join(', ')}`);
});

test('主进程 IPC 错误一律转成 {ok:false,code,message}，不抛出原始异常', () => {
  const ipc = read('main/ipc.js');
  assert.ok(ipc.includes("ok: false"), '应返回结构化失败');
  assert.ok(/code:\s*\(e && e\.code\)/.test(ipc), '应带错误码');
  assert.ok(/message:\s*userMessage\(e\)/.test(ipc), '错误消息应经 userMessage 收敛');
  assert.ok(!/throw new Error\(`IPC/.test(ipc));
});

test('渲染进程不直接 require electron / node 模块（安全边界）', () => {
  const rendererDir = path.join(SRC, 'renderer');
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) files.push(full);
    }
  };
  walk(rendererDir);
  assert.ok(files.length >= 5);
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(code), `${path.basename(f)} 不得直接 require electron`);
    assert.ok(!/require\(\s*['"](fs|child_process|net)['"]\s*\)/.test(code), `${path.basename(f)} 不得直接使用 Node 能力`);
  }
});

test('渲染进程脚本都包在 IIFE 内（避免与 contextBridge 全局名冲突）', () => {
  const rendererDir = path.join(SRC, 'renderer');
  const scripts = ['hud/app.js', 'overlay/app.js', 'ball/app.js', 'settings/app.js', 'onboarding/app.js'];
  for (const rel of scripts) {
    const full = path.join(rendererDir, rel);
    if (!fs.existsSync(full)) continue;
    const code = fs.readFileSync(full, 'utf8');
    assert.ok(code.includes('IIFE-WRAP'), `${rel} 缺少 IIFE 包裹标记`);
  }
});

test('CSP 禁止内联脚本与内联样式属性', () => {
  const pages = ['renderer/hud/index.html', 'renderer/settings/index.html', 'renderer/onboarding/index.html', 'renderer/overlay/index.html', 'renderer/ball/index.html'];
  for (const rel of pages) {
    const html = read(rel);
    assert.ok(/Content-Security-Policy/.test(html), `${rel} 缺少 CSP`);
    assert.ok(!/<script>[\s\S]{20,}?<\/script>/.test(html), `${rel} 不得包含内联脚本`);
    const inlineStyle = [...html.matchAll(/<[^>]+\sstyle="[^"]*"/g)];
    assert.deepStrictEqual(inlineStyle.map((m) => m[0]), [], `${rel} 含 CSP 禁止的内联样式属性`);
  }
});
