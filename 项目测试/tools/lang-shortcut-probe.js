'use strict';
/**
 * 「原文已是目标语言」短路逻辑探针（不需要启动模型，秒级）
 * 用法：node 项目测试/tools/lang-shortcut-probe.js
 */
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
const CODE = path.join(ROOT, '项目代码');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'lang-shortcut');

const { executeRound } = require(path.join(CODE, 'src', 'core', 'pipeline', 'round.js'));
const { createLogger } = require(path.join(CODE, 'src', 'core', 'log.js'));

const logger = createLogger({ level: 'error', console: false });

function mockDeps({ ocrText, targetLang, sourceLang = 'auto', apis = [] }) {
  const config = {
    version: 1,
    general: {
      uiLanguage: 'zh', targetLang, sourceLang, dedupeEnabled: true, minRetranslateMs: 0, dedupeSimilarity: 0.98,
    },
    capture: { mode: 'manual', intervalMs: 2000, lastSelection: { x: 10, y: 10, width: 200, height: 100 } },
    network: { primaryTimeoutMs: 5000, backupTimeoutMs: 3000, maxApiAttempts: 2 },
    offline: { port: 8081, host: '127.0.0.1', timeoutMs: 10000, contextSize: 2048, threads: 6 },
  };
  return {
    logger,
    store: {
      raw: () => config,
      getEnabledApisOrdered: () => apis,
      getApiSecret: () => '',
    },
    capture: { captureRegion: async () => ({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), width: 200, height: 100, ms: 1 }) },
    ocr: { recognize: async () => ({ text: ocrText, engine: 'mock', ms: 1 }) },
    llama: { status: () => ({ running: false, ready: false }), health: async () => ({ ok: false }), resolveModel: () => '' },
  };
}

const ZH = '请点击保存按钮，然后继续。';
const EN = 'Click the save button to continue.';

const cases = [
  {
    name: '中文→中文：跳过模型，直接返回原文',
    deps: mockDeps({ ocrText: ZH, targetLang: 'zh' }),
    expect: { ok: true, engine: '无需翻译', text: ZH, shortcut: true },
  },
  {
    name: '中文→繁体：字形转换，不走模型',
    deps: mockDeps({ ocrText: ZH, targetLang: 'zh-TW' }),
    expect: { ok: true, engine: '繁体转换', text: '請點擊保存按鈕，然後繼續。', shortcut: true },
  },
  {
    name: '英文→英文：跳过模型',
    deps: mockDeps({ ocrText: EN, targetLang: 'en' }),
    expect: { ok: true, engine: '无需翻译', text: EN, shortcut: true },
  },
  {
    name: '日文（含假名）→中文：不得短路',
    deps: mockDeps({ ocrText: '保存ボタンをクリックしてください。', targetLang: 'zh' }),
    expect: { ok: false },
  },
  {
    name: '英文→中文：不得短路（需要真实翻译）',
    deps: mockDeps({ ocrText: EN, targetLang: 'zh' }),
    expect: { ok: false },
  },
];

(async () => {
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const state = {};
    let res;
    try {
      res = await executeRound(c.deps, state, { trigger: 'probe' });
    } catch (e) {
      res = { ok: false, thrown: e.message };
    }
    try {
      if (c.expect.ok) {
        assert.strictEqual(res.ok, true, `ok 应为 true，实际 ${JSON.stringify(res).slice(0, 160)}`);
        if (c.expect.engine) assert.strictEqual(res.engine, c.expect.engine);
        if (c.expect.text) assert.strictEqual(res.translatedText, c.expect.text);
        if (c.expect.shortcut) assert.strictEqual(res.shortcut, true);
      } else {
        assert.strictEqual(res.ok, false, `ok 应为 false，实际 ${JSON.stringify(res).slice(0, 160)}`);
      }
      pass += 1;
      console.log(`  ✔ ${c.name}`);
    } catch (e) {
      fail += 1;
      console.log(`  ✖ ${c.name}\n      ${e.message}`);
    }
  }
  console.log(`\n短路逻辑：${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
})();
