'use strict';
/**
 * 语言互译矩阵探针（需求 4）
 *
 * 跑真实离线模型，覆盖「中文/英文原文 → 9 种目标语言」共 18 组，
 * 另外跑 3 组显式指定源语言的组合，输出是否成功、是否原样返回、耗时。
 *
 * 用法：node 项目测试/tools/lang-matrix.js [--port=18082] [--json=out.json]
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const CODE = path.join(ROOT, '项目代码');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'lang-matrix');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const PORT = Number(arg('port', '18082'));
const JSON_OUT = arg('json', '');

const MODEL = path.join(ROOT, 'dist', 'win-x64', 'userdata', 'models', 'HY-MT1.5-1.8B-Q4_K_M.gguf');
const BIN = path.join(CODE, 'runtime', 'llama', 'llama-server.exe');

const { TranslatorEngine } = require(path.join(CODE, 'src', 'core'));

const SAMPLES = {
  zh: '请点击保存按钮，然后继续。该用户已经登录，此时间点无法修改。',
  en: 'Click the save button to continue. The user is already logged in.',
};

const TARGETS = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

/** 繁简判断：出现简体专有字即为「仍是简体」 */
const { countSimplified } = require(path.join(CODE, 'src', 'core', 'translate', 'traditional'));

async function main() {
  const engine = new TranslatorEngine({ appVersion: 'matrix' });
  engine.logger = engine.logger;
  await engine.init();

  console.log('[matrix] 数据目录 =', process.env.TRANSLATOR_HOME);
  console.log('[matrix] 模型 =', MODEL, fs.existsSync(MODEL) ? '(存在)' : '(缺失!)');
  console.log('[matrix] 运行时 =', BIN, fs.existsSync(BIN) ? '(存在)' : '(缺失!)');

  const rows = [];
  try {
    engine.patchConfig({
      offline: {
        serverPath: BIN,
        modelPath: MODEL,
        port: PORT,
        host: '127.0.0.1',
        contextSize: 2048,
        threads: 6,
        autostart: true,
      },
    });
    const ready = await engine.ensureOfflineReady(120000);
    console.log('[matrix] 离线模型就绪 =', ready);
    if (!ready) throw new Error('离线模型未就绪，无法测试');

    for (const [srcLang, text] of Object.entries(SAMPLES)) {
      for (const target of TARGETS) {
        const t0 = Date.now();
        let rec = { source: srcLang, target, declaredSource: 'auto' };
        try {
          const res = await engine.translateText({ text, targetLang: target, sourceLang: 'auto' });
          rec = {
            ...rec,
            ok: true,
            engine: res.engine,
            ms: Date.now() - t0,
            out: res.text,
            echo: String(res.text || '').trim() === text.trim(),
            simpLeft: countSimplified(res.text),
          };
        } catch (e) {
          rec = { ...rec, ok: false, ms: Date.now() - t0, code: e.code, message: e.message };
        }
        rows.push(rec);
        const flag = rec.ok ? (rec.echo ? 'ECHO' : 'ok') : `FAIL(${rec.code})`;
        console.log(`[matrix] ${srcLang} -> ${target.padEnd(5)} ${flag.padEnd(18)} ${rec.ms}ms  ${String(rec.out || rec.message || '').slice(0, 60).replace(/\n/g, ' / ')}`);
      }
    }

    // 显式源语言的三组（验证 sourceLang 不再污染译文）
    const explicit = [
      { text: SAMPLES.zh, sourceLang: 'zh', targetLang: 'en' },
      { text: SAMPLES.en, sourceLang: 'en', targetLang: 'zh' },
      { text: SAMPLES.zh, sourceLang: 'zh', targetLang: 'ja' },
    ];
    for (const c of explicit) {
      const t0 = Date.now();
      let rec = { source: c.sourceLang, target: c.targetLang, declaredSource: c.sourceLang };
      try {
        const res = await engine.translateText({ text: c.text, targetLang: c.targetLang, sourceLang: c.sourceLang });
        rec = { ...rec, ok: true, engine: res.engine, ms: Date.now() - t0, out: res.text, echo: String(res.text || '').trim() === c.text.trim() };
      } catch (e) {
        rec = { ...rec, ok: false, ms: Date.now() - t0, code: e.code, message: e.message };
      }
      rows.push(rec);
      console.log(`[matrix] ${c.sourceLang}(${'-'}) -> ${c.targetLang.padEnd(5)} ${rec.ok ? (rec.echo ? 'ECHO' : 'ok') : `FAIL(${rec.code})`} ${rec.ms}ms  ${String(rec.out || '').slice(0, 60).replace(/\n/g, ' / ')}`);
    }

    // 汇总
    const total = rows.length;
    const echo = rows.filter((r) => r.echo).length;
    const failed = rows.filter((r) => !r.ok).length;
    const zhTw = rows.filter((r) => r.target === 'zh-TW');
    const zhTwBad = zhTw.filter((r) => !r.ok || (r.simpLeft || 0) >= 3 || (r.source === 'zh' && r.simpLeft > 0));
    console.log(`\n[matrix] 汇总：共 ${total} 组，失败 ${failed}，原样返回 ${echo}，繁体残留简体 ${zhTwBad.length}/${zhTw.length}`);
    if (zhTwBad.length) {
      for (const r of zhTwBad) console.log(`  · 繁体异常 ${r.source}->${r.target}: simpLeft=${r.simpLeft} ${String(r.out || '').slice(0, 50)}`);
    }

    if (JSON_OUT) {
      fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), model: MODEL, rows }, null, 2), 'utf8');
      console.log('[matrix] 明细已写入', JSON_OUT);
    }
  } finally {
    try { await engine.shutdown(); } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('[matrix] fatal', e && e.stack || e);
  process.exit(2);
});
