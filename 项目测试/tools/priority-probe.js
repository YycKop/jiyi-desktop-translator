'use strict';
/**
 * 真实离线模型下的「离线优先」端到端探针（第十八轮需求 1/2）。
 *
 * 用打包产物的数据目录（里面已经有 1 GB 的 .gguf 与用户配置）跑一次真实翻译：
 *   1) priority=offline + 离线可用 → 引擎必须是「离线模式」，且不发起联网请求；
 *   2) 把离线端口改成没人监听的 18081、priority=offline 且配了一个假的在线 API
 *      → 应自动改走在线通道（这里用一个本地桩冒充网关，不碰真实服务、不消耗额度）。
 *
 * 运行：node 项目测试\tools\priority-probe.js
 */
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, '项目代码', 'src', 'core');

// 数据目录指向打包产物的 userdata（含模型与配置），不污染开发目录
process.env.TRANSLATOR_HOME = path.join(ROOT, 'dist', 'win-x64', 'userdata');

const { TranslatorEngine } = require(path.join(CORE, 'index.js'));

function startStubGateway(port) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      hits.push({ url: req.url, model: (() => { try { return JSON.parse(raw).model; } catch { return ''; } })() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '在线桩返回的译文' } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, hits }));
  });
}

async function main() {
  const model = path.join(process.env.TRANSLATOR_HOME, 'models');
  const gguf = fs.existsSync(model) ? fs.readdirSync(model).filter((f) => f.endsWith('.gguf')) : [];
  console.log(`[probe] 数据目录=${process.env.TRANSLATOR_HOME}`);
  console.log(`[probe] 模型=${gguf.join(',') || '(无)'}`);

  const engine = new TranslatorEngine();
  await engine.init();
  const out = {};

  // ---------------- 1) 离线优先：离线可用时应直接命中离线 ----------------
  engine.store.patch({ general: { priority: 'offline', targetLang: 'zh' }, network: { maxApiAttempts: 2 } });
  const t0 = Date.now();
  await engine.ensureOfflineReady();
  out.readyMs = Date.now() - t0;
  try {
    const r1 = await engine.translateText({ text: 'Hello, how are you?', targetLang: 'zh', sourceLang: 'auto' });
    out.offlineFirst = { engine: r1.engine, stage: r1.stage, fallback: r1.fallback, text: r1.text, ms: r1.latencyMs };
    out.offlineFirstOk = r1.engine === '离线模式' && r1.fallback === false;
  } catch (e) {
    out.offlineFirst = { error: e.code || e.message };
    out.offlineFirstOk = false;
  }

  // ---------------- 2) 离线不可用时回落到在线 ----------------
  const stub = await startStubGateway(18099);
  const prevOffline = JSON.parse(JSON.stringify(engine.store.raw().offline || {}));
  engine.store.patch({ offline: { port: 18081 } }, { silent: true });
  engine.store.addApi({
    name: '探针桩',
    baseUrl: 'http://127.0.0.1:18099/v1',
    model: 'stub-model',
    apiKey: 'sk-probe-123456',
    enabled: true,
  });
  engine.llama.updateConfig(engine.store.raw().offline);
  try {
    const apiId = engine.store.raw().apis[engine.store.raw().apis.length - 1].id;
    const r2 = await engine.translateText({ text: 'Hello again', targetLang: 'zh', sourceLang: 'auto' });
    out.fallbackToOnline = {
      engine: r2.engine, stage: r2.stage, fallback: r2.fallback, text: r2.text,
      stages: (r2.attempts || []).map((a) => a.stage),
    };
    out.fallbackOk = r2.stage === 'online' && r2.fallback === true && stub.hits.length > 0;
    engine.store.removeApi(apiId);
  } catch (e) {
    out.fallbackToOnline = { error: e.code || e.message, userMessage: e.userMessage };
    out.fallbackOk = false;
  } finally {
    engine.store.patch({ offline: prevOffline }, { silent: true });
    engine.llama.updateConfig(engine.store.raw().offline);
    await new Promise((r) => stub.server.close(r));
  }

  out.pass = !!(out.offlineFirstOk && out.fallbackOk);
  console.log(JSON.stringify(out, null, 2));
  try { engine.llama.stop(); } catch { /* 忽略 */ }
  process.exit(out.pass ? 0 : 1);
}

main().catch((e) => {
  console.error('[probe] 失败', e && e.stack);
  process.exit(2);
});
