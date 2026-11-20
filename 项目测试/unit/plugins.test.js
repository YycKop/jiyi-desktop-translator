'use strict';
/**
 * DSH 插件契约测试（环境配置清单第 4 节 PLG-01~05）
 *
 * 插件没有 DSH 运行时就跑不起来，因此这里用桩 fetch 验证三件事：
 * 1) 协议正确：请求打到宿主桥的哪个路径、是否带一次性令牌、body 结构对不对；
 * 2) 失败可读：宿主未启动时抛 HOST_UNAVAILABLE，参数非法时立刻拒绝；
 * 3) 打包合规：纯 JS、`dsh.bundle.patch` 指向存在的 `patches/bundle.yaml`。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const PLUGINS = ['dsh-plugin-screen-ocr', 'dsh-plugin-translate'];

// 先准备 bridge.json，再加载插件（插件每次调用都会重新读取该文件）
const HOME = path.join(REPO, '项目测试', '_runtime', 'plugin-home');
fs.mkdirSync(HOME, { recursive: true });
fs.writeFileSync(path.join(HOME, 'bridge.json'), JSON.stringify({
  port: 45678, token: 'test-token-abc', pid: 1, startedAt: new Date().toISOString(),
}), 'utf8');
process.env.TRANSLATOR_HOME = HOME;

const ocrPlugin = require(path.join(REPO, 'dsh-plugins', 'dsh-plugin-screen-ocr', 'lib', 'index.js'));
const trPlugin = require(path.join(REPO, 'dsh-plugins', 'dsh-plugin-translate', 'lib', 'index.js'));

/** 记录调用并返回固定响应 */
function stubFetch(payload, status = 200) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status < 300,
      status,
      text: async () => JSON.stringify(payload),
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('两个插件都导出 name/apply/tools', () => {
  for (const p of [ocrPlugin, trPlugin]) {
    assert.strictEqual(typeof p.name, 'string');
    assert.strictEqual(typeof p.apply, 'function');
    assert.ok(Array.isArray(p.tools) && p.tools.length === 1);
    assert.strictEqual(typeof p.tools[0].execute, 'function');
    assert.ok(p.tools[0].parameters && p.tools[0].parameters.type === 'object');
  }
  assert.deepStrictEqual(ocrPlugin.tools.map((t) => t.name), ['screen_ocr']);
  assert.deepStrictEqual(trPlugin.tools.map((t) => t.name), ['translate_text']);
});

test('apply 在缺少注册接口时不伪造 API，只返回工具定义', () => {
  const r = ocrPlugin.apply({});
  assert.strictEqual(r.registered, false);
  assert.strictEqual(r.tools.length, 1);

  const registered = [];
  const r2 = trPlugin.apply({ registerTool: (t) => registered.push(t) });
  assert.strictEqual(r2.registered, true);
  assert.strictEqual(r2.via, 'ctx.registerTool');
  assert.strictEqual(registered.length, 1);
});

test('screen_ocr 请求宿主桥 ocr_region，并携带一次性令牌', async () => {
  const { calls, restore } = stubFetch({ ok: true, text: '识别结果', engine: 'winrt', ms: 250 });
  try {
    const out = await ocrPlugin.tools[0].execute({ x: 10, y: 20, width: 200, height: 100 }, {});
    assert.strictEqual(out.text, '识别结果');
    assert.strictEqual(out.engine, 'winrt');
    assert.strictEqual(out.empty, false);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'http://127.0.0.1:45678/v1/host/ocr_region');
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.strictEqual(calls[0].init.headers['x-bridge-token'], 'test-token-abc');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { x: 10, y: 20, width: 200, height: 100 });
    assert.ok(calls[0].init.signal, '必须把取消信号传给 fetch（PLG-04）');
  } finally {
    restore();
  }
});

test('translate_text 请求宿主桥 translate_text 并回传引擎标识', async () => {
  const { calls, restore } = stubFetch({ ok: true, text: '你好', engine: '离线模式', latencyMs: 180 });
  try {
    const out = await trPlugin.tools[0].execute({ text: 'Hello', targetLang: 'zh' }, {});
    assert.strictEqual(out.text, '你好');
    assert.strictEqual(out.engine, '离线模式');
    assert.strictEqual(calls[0].url, 'http://127.0.0.1:45678/v1/host/translate_text');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { text: 'Hello', targetLang: 'zh', sourceLang: 'auto' });
  } finally {
    restore();
  }
});

test('参数非法时立即失败，不发起请求', async () => {
  const { calls, restore } = stubFetch({ ok: true });
  try {
    await assert.rejects(() => ocrPlugin.tools[0].execute({ x: 0, y: 0, width: 2, height: 100 }, {}), /区域过小/);
    await assert.rejects(() => ocrPlugin.tools[0].execute({ x: 'a', y: 0, width: 10, height: 10 }, {}), /必须都是数字/);
    await assert.rejects(() => trPlugin.tools[0].execute({ text: '  ', targetLang: 'zh' }, {}), /不能为空/);
    await assert.rejects(() => trPlugin.tools[0].execute({ text: 'x'.repeat(20001), targetLang: 'zh' }, {}), /过长/);
    assert.strictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('宿主桥报错时抛带 code 的错误，且不含令牌', async () => {
  const { restore } = stubFetch({ ok: false, code: 'BRIDGE_UNAUTHORIZED', error: '未授权' }, 401);
  try {
    await assert.rejects(
      () => trPlugin.tools[0].execute({ text: 'hi', targetLang: 'zh' }, {}),
      (e) => e.code === 'BRIDGE_UNAUTHORIZED' && !String(e.message).includes('test-token-abc'),
    );
  } finally {
    restore();
  }
});

test('宿主壳未启动时抛 HOST_UNAVAILABLE', async () => {
  const saved = process.env.TRANSLATOR_HOME;
  process.env.TRANSLATOR_HOME = path.join(HOME, 'not-exist');
  try {
    // 插件还会尝试开发期路径与 APPDATA；开发期路径此时不存在，若 APPDATA 恰好有文件则跳过该断言
    const info = ocrPlugin.readBridgeInfo();
    if (info) return; // 环境里存在真实 bridge.json，跳过（不误判）
    await assert.rejects(
      () => ocrPlugin.tools[0].execute({ x: 0, y: 0, width: 10, height: 10 }, {}),
      (e) => e.code === 'HOST_UNAVAILABLE',
    );
  } finally {
    process.env.TRANSLATOR_HOME = saved;
  }
});

test('打包合规：纯 JS + dsh.bundle.patch + bundle.yaml 存在（PLG-01~03）', () => {
  for (const name of PLUGINS) {
    const dir = path.join(REPO, 'dsh-plugins', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

    assert.ok(pkg.main.endsWith('.js'), `${name} 入口必须是 JS`);
    assert.ok(!/\.ts$/.test(pkg.main), `${name} 不得以 TS 为入口`);
    assert.ok(fs.existsSync(path.join(dir, 'lib', 'index.js')), `${name} 缺少 lib/index.js`);

    assert.ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, `${name} 缺少 dsh.bundle.patch`);
    const patchFile = path.join(dir, pkg.dsh.bundle.patch);
    assert.ok(fs.existsSync(patchFile), `${name} 的 patches/bundle.yaml 不存在`);
    const content = fs.readFileSync(patchFile, 'utf8').trim();
    assert.strictEqual(content, '[]', `${name} 的 bundle.yaml 应为空数组（仅注册工具，不改运行时）`);

    // 不得声明本仓库不存在的 @deepseek-ai/dsh-* 依赖（DSH-03 禁幻觉包）
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const dep of Object.keys(deps)) {
      assert.ok(!dep.startsWith('@deepseek-ai/'), `${name} 不应声明未安装的 DSH 内部包：${dep}`);
    }
  }
});
