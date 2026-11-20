'use strict';
/**
 * 繁体/源语言前缀提示词实验（项目测试/tools/prompt-experiment.js）
 *
 * 目的：本地 HY-MT 模型对「Traditional Chinese」几乎不动手，
 * 试几种更明确的提示词，挑出能稳定产出繁体的一种。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const CODE = path.join(ROOT, '项目代码');
const HOME = path.join(ROOT, '项目测试', '_runtime', 'prompt-probe');
const MODEL = path.join(ROOT, 'dist', 'win-x64', 'userdata', 'models', 'HY-MT1.5-1.8B-Q4_K_M.gguf');
const BIN = path.join(ROOT, '项目代码', 'runtime', 'llama', 'llama-server.exe');

const SIMPLIFIED_HINTS = ['请', '击', '按', '钮', '继', '续', '们', '这', '个', '为', '说', '时', '间', '发', '现', '点'];

async function main() {
  process.env.TRANSLATOR_HOME = HOME;
  const { LlamaServerManager } = require(path.join(CODE, 'src', 'core', 'llama', 'server.js'));
  const { chatCompletion } = require(path.join(CODE, 'src', 'core', 'translate', 'openaiCompatible.js'));

  const llama = new LlamaServerManager({
    offline: {
      serverPath: BIN, modelPath: MODEL, port: 18083, contextSize: 2048, threads: 6,
      autostart: true, corsOrigins: 'localhost',
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  await llama.start();
  const ok = await llama.waitReady(90000);
  console.log('ready', ok);
  if (!ok) { await llama.stop(); return; }

  const text = '请点击保存按钮，然后继续。该用户已经登录，这个时间点无法修改。';
  const cases = [
    { name: 'A 当前用词 Traditional Chinese', system: 'You are a professional translator. Translate the user text into Traditional Chinese. Preserve line breaks. Output only the translated text, without explanation, quotes or notes.' },
    { name: 'B 强调只用繁体字', system: 'You are a professional translator. Translate the user text into Traditional Chinese (Taiwan). Use Traditional Chinese characters only — never output Simplified Chinese characters. Output only the translated text.' },
    { name: 'C 明确“转换”语义', system: 'Convert the user text into Traditional Chinese as written in Taiwan. Rewrite every Simplified Chinese character into its Traditional form (例如 请→請, 击→擊, 继续→繼續). Keep the meaning unchanged. Output only the converted text.' },
    { name: 'D 大陆→台湾说法', system: 'You are a professional translator. Translate the user text into Traditional Chinese used in Taiwan. Use Taiwan vocabulary (例如 按钮→按鈕, 用户→使用者, 时间→時間). Output only the translated text.' },
  ];

  for (const c of cases) {
    const started = Date.now();
    const r = await chatCompletion({
      baseUrl: llama.baseUrl, apiKey: '', model: 'hy-mt',
      messages: [{ role: 'system', content: c.system }, { role: 'user', content: text }],
      timeoutMs: 30000,
    });
    const out = r.text.trim();
    const hits = SIMPLIFIED_HINTS.filter((ch) => out.includes(ch));
    console.log(JSON.stringify({
      name: c.name, ms: Date.now() - started, same: out === text, simplifiedHits: hits, out,
    }));
  }

  // 源语言前缀是否干扰模型
  const prefixed = await chatCompletion({
    baseUrl: llama.baseUrl, apiKey: '', model: 'hy-mt',
    messages: [
      { role: 'system', content: 'You are a professional translator. Translate the user text into Simplified Chinese. Output only the translated text.' },
      { role: 'user', content: '[source language: en]\n请点击保存按钮，然后继续。' },
    ],
    timeoutMs: 30000,
  });
  console.log(JSON.stringify({ name: 'E 带 [source language: en] 前缀', out: prefixed.text.trim() }));

  const plain = await chatCompletion({
    baseUrl: llama.baseUrl, apiKey: '', model: 'hy-mt',
    messages: [
      { role: 'system', content: 'You are a professional translator. Translate the user text into Simplified Chinese. Output only the translated text.' },
      { role: 'user', content: '请点击保存按钮，然后继续。' },
    ],
    timeoutMs: 30000,
  });
  console.log(JSON.stringify({ name: 'F 无前缀', out: plain.text.trim() }));

  await llama.stop();
}

main().catch((e) => { console.error('[prompt-probe] failed:', e && e.message); process.exitCode = 1; });
