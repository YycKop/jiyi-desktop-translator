#!/usr/bin/env node
'use strict';
/**
 * 命令行入口（src/cli.js）
 *
 * 用途：无 GUI 环境下的自检、集成测试与运维排查。
 * 允许把 OCR 文本打印到终端（限制书 SCR-03 明确许可），但绝不写入网络或远程日志。
 *
 * 用法：
 *   node src/cli.js status
 *   node src/cli.js selftest
 *   node src/cli.js ocr --file <png>
 *   node src/cli.js translate --text "Hello" --to zh
 *   node src/cli.js round --x 100 --y 100 --w 200 --h 100
 *   node src/cli.js bridge --port 0
 */
const fs = require('fs');
const path = require('path');

const { TranslatorEngine, paths } = require('./core');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

async function withEngine(fn, opts = {}) {
  const engine = new TranslatorEngine({ console: false, ...opts });
  await engine.init();
  try {
    return await fn(engine);
  } finally {
    await engine.shutdown();
  }
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

const COMMANDS = {
  async status() {
    return withEngine(async (engine) => {
      const st = engine.status();
      print(st);
      return st;
    });
  },

  async selftest() {
    return withEngine(async (engine) => {
      const ocr = await engine.ocr.status();
      const capture = await engine.capture.status();
      const llama = engine.llama.status();
      const out = {
        dataDir: paths.home(),
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        ocr,
        capture,
        llama: { ...llama, modelFound: !!llama.modelPath, binary: path.basename(llama.binaryPath || '') },
        apis: engine.listApis().length,
        region: engine.getSelectionRegion(),
        memory: engine.status().memory,
      };
      print(out);
      return out;
    });
  },

  async ocr(args) {
    const file = args.file;
    if (!file || !fs.existsSync(file)) throw new Error('需要 --file <图片路径>');
    return withEngine(async (engine) => {
      const buffer = fs.readFileSync(file);
      const r = await engine.ocr.recognize({ buffer });
      // SCR-03：OCR 文本只输出到终端
      print({ ok: true, engine: r.engine, lang: r.lang, ms: r.ms, chars: (r.text || '').length, text: r.text });
      return r;
    }, { ocrEngine: args.engine || 'auto' });
  },

  async translate(args) {
    const text = args.text;
    if (!text) throw new Error('需要 --text "..."');
    return withEngine(async (engine) => {
      const r = await engine.translateText({ text, targetLang: args.to || 'zh', sourceLang: args.from || 'auto' });
      print({ ok: true, engine: r.engine, latencyMs: r.latencyMs, text: r.text });
      return r;
    });
  },

  async round(args) {
    const region = {
      x: Number(args.x ?? 100),
      y: Number(args.y ?? 100),
      width: Number(args.w ?? 200),
      height: Number(args.h ?? 100),
    };
    return withEngine(async (engine) => {
      const r = await engine.runRound({ regionOverride: region, trigger: 'cli', force: true });
      print(r);
      return r;
    }, { captureBackend: args.capture || 'auto' });
  },

  async bridge(args) {
    const engine = new TranslatorEngine({ console: false });
    await engine.init();
    const info = await engine.startBridge(Number(args.port || 0));
    print({ ok: true, port: info.port, bridgeFile: paths.bridgeFile() });
    const shutdown = async () => {
      await engine.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return new Promise(() => {});
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0] || 'status';
  const fn = COMMANDS[cmd];
  if (!fn) {
    process.stderr.write(`未知命令：${cmd}\n可用命令：${Object.keys(COMMANDS).join(', ')}\n`);
    process.exit(2);
  }
  try {
    await fn(args);
    if (cmd !== 'bridge') process.exit(0);
  } catch (e) {
    process.stderr.write(`[${e.code || 'ERROR'}] ${e.message}\n`);
    if (process.env.TRANSLATOR_DEBUG) process.stderr.write((e.stack || '') + '\n');
    process.exit(1);
  }
}

main();
