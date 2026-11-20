'use strict';
/**
 * 离线模型配置加载回归测试。
 * 背景：LlamaServerManager 在 TranslatorEngine 构造函数里创建，那时 store 还没 load()，
 * 拿到的是默认 offline 配置；init() 里必须再同步一次，否则用户设置的
 * 端口/线程/上下文会被默认值覆盖（曾出现 `-c 4096` 盖掉用户的 2048）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { prepare, freshHome } = require('../helpers/env');

prepare();
const { TranslatorEngine } = require('../../项目代码/src/core/index');
const paths = require('../../项目代码/src/core/paths');

function makeEngine(home, offline, extra = {}) {
  process.env.TRANSLATOR_HOME = home;
  paths.resetHomeCache();
  const configFile = path.join(home, 'config.json');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({
    version: 1,
    onboarded: true,
    general: { targetLang: 'zh', sourceLang: 'auto' },
    capture: { mode: 'manual', intervalMs: 5000 },
    offline,
    apis: [],
    ...extra,
  }, null, 2), 'utf8');
  return new TranslatorEngine({ appVersion: 'test', configFile, console: false, logLevel: 'error' });
}

test('init() 后离线模型使用配置文件里的端口/线程/上下文', async () => {
  const home = freshHome('llama-config');
  const engine = makeEngine(home, {
    port: 18081, host: '127.0.0.1', contextSize: 2048, threads: 6, gpuLayers: 0, corsOrigins: 'localhost',
  });
  await engine.init();

  const st = engine.llama.status();
  assert.strictEqual(st.port, 18081, '端口应来自配置而非默认 8081');
  assert.strictEqual(st.contextSize, 2048, '上下文应来自配置而非默认 4096');

  const args = engine.llama.buildArgs().join(' ');
  assert.match(args, /-c 2048/);
  assert.match(args, /-t 6/);
  assert.match(args, /--port 18081/);
  assert.strictEqual(engine.loop.intervalMs, 5000, '轮询间隔应来自配置');

  await engine.shutdown();
});

test('配置热更新后离线参数随之变化', async () => {
  const home = freshHome('llama-config-change');
  const engine = makeEngine(home, { port: 18082, contextSize: 4096, threads: 4 });
  await engine.init();
  assert.strictEqual(engine.llama.status().contextSize, 4096);

  engine.patchConfig({ offline: { contextSize: 1024, threads: 2 } });
  const st = engine.llama.status();
  assert.strictEqual(st.contextSize, 1024, '配置热更新后上下文应变化');
  assert.match(engine.llama.buildArgs().join(' '), /-t 2/);

  await engine.shutdown();
});
