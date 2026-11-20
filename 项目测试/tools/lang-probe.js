'use strict';
/**
 * 语言矩阵探针（项目测试/tools/lang-probe.js）
 *
 * 目的：直接调用 TranslatorEngine.translateText，对若干 (源语言, 目标语言) 组合
 * 打印引擎、耗时与译文，用来复现「目标语言设为繁体/英语却翻译不出来」。
 *
 * 用法：node 项目测试/tools/lang-probe.js [--home=<数据目录>] [--text=...] [--pairs=zh>en,en>zh]
 * 说明：默认使用项目内的临时数据目录，不读写用户的真实配置；离线模型用真实 GGUF。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');           // D:\桌面翻译助手
const CODE = path.join(ROOT, '项目代码');
const HOME = path.join(ROOT, '项目测试', '_runtime', 'lang-probe');
const MODEL = path.join(ROOT, 'dist', 'win-x64', 'userdata', 'models', 'HY-MT1.5-1.8B-Q4_K_M.gguf');
const BIN = path.join(ROOT, '项目代码', 'runtime', 'llama', 'llama-server.exe');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  process.env.TRANSLATOR_HOME = arg('home', HOME);
  fs.mkdirSync(process.env.TRANSLATOR_HOME, { recursive: true });

  const { TranslatorEngine } = require(path.join(CODE, 'src', 'core', 'index.js'));
  const engine = new TranslatorEngine({ appVersion: 'probe' });
  engine.init();

  const cfg = engine.getConfig();
  // 探测环境：只开离线，避免把测试文本发到外部 API
  engine.patchConfig({
    apis: undefined,
    general: { sourceLang: 'auto', dedupeEnabled: false },
    offline: { serverPath: BIN, modelPath: MODEL, autostart: true, port: 18081, contextSize: 2048, threads: 6 },
  });
  void cfg;

  const text = arg('text', '请点击保存按钮，然后继续。');
  const pairsArg = arg('pairs', 'auto>zh-TW,auto>en,zh>en,en>zh,zh>zh-TW,en>zh-TW,ja>zh');
  const pairs = pairsArg.split(',').map((p) => p.split('>'));

  const ready = await engine.ensureOfflineReady(90000);
  console.log('offlineReady=', ready, 'llama=', JSON.stringify(engine.status().llama));

  for (const [sourceLang, targetLang] of pairs) {
    const started = Date.now();
    try {
      const r = await engine.translateText({ text, targetLang, sourceLang });
      console.log(JSON.stringify({
        pair: sourceLang + '>' + targetLang,
        ok: true,
        engine: r.engine,
        ms: Date.now() - started,
        text: r.text,
      }));
    } catch (e) {
      console.log(JSON.stringify({
        pair: sourceLang + '>' + targetLang,
        ok: false,
        ms: Date.now() - started,
        code: e.code || e.name,
        message: e.message,
        userMessage: e.userMessage,
      }));
    }
  }

  await engine.shutdown();
}

main().catch((e) => {
  console.error('[probe] failed:', e && e.message);
  process.exitCode = 1;
});
