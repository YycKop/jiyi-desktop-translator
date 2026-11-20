// 第十三轮探针：同一张图用不同预处理参数各跑一遍，比较识别到的行数/字数。
// 目的：定位「框里文字识别不全」是预处理（锐化/放大）导致丢行，还是引擎本身。
'use strict';

const path = require('path');
const { runPowerShellFile } = require(path.join(__dirname, '..', '..', '项目代码', 'src', 'core', 'native', 'ps.js'));

const ROOT = path.join(__dirname, '..', '..', '项目代码');
const FIX = path.join(__dirname, '..', 'fixtures');
const OUT = path.join(__dirname, '..', 'reports');
const fs = require('fs');

const CASES = [
  { file: 'para-dark-15px.png', expect: 5 },
  { file: 'para-light-15px.png', expect: 5 },
  { file: 'para-dark-16px.png', expect: 3 },
  { file: 'para-gray-14px.png', expect: 3 },
];

const VARIANTS = [
  { scale: 2, sharpen: 0 },
  { scale: 2, sharpen: 120 },
  { scale: 2, sharpen: 160 },
  { scale: 3, sharpen: 0 },
  { scale: 3, sharpen: 160 },
];

function countLines(text) {
  return String(text || '').split('\n').filter((l) => l.trim()).length;
}

(async () => {
  const results = [];
  for (const c of CASES) {
    const img = path.join(FIX, c.file);
    for (const v of VARIANTS) {
      const out = path.join(OUT, `ocr-para-${c.file}-${v.scale}-${v.sharpen}.json`);
      const r = await runPowerShellFile('winrt-ocr.ps1', [
        '-ImagePath', img, '-OutPath', out,
        '-Lang', 'zh-Hans-CN,en-US',
        '-Scale', String(v.scale), '-Sharpen', String(v.sharpen),
      ], { timeoutMs: 60000 });
      let data = null;
      try { data = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* ignore */ }
      if (fs.existsSync(out)) fs.unlinkSync(out);
      const text = data ? data.text : '';
      results.push({
        file: c.file, expect: c.expect, scale: v.scale, sharpen: v.sharpen,
        ok: !!(data && data.ok), lines: countLines(text), chars: String(text).replace(/\s/g, '').length,
        ms: data && data.ms, text,
      });
    }
  }
  fs.writeFileSync(path.join(OUT, 'ocr-paragraph-matrix.json'), JSON.stringify(results, null, 2), 'utf8');

  for (const r of results) {
    const flag = r.lines < r.expect ? '<<LOST' : '';
    console.log(`${r.file.padEnd(22)} s=${r.scale} sh=${String(r.sharpen).padEnd(3)} lines=${r.lines}/${r.expect} chars=${r.chars} ms=${r.ms} ${flag}`);
  }
  console.log('\n--- 明细（sharpen=160, scale=2） ---');
  for (const r of results.filter((x) => x.scale === 2 && x.sharpen === 160)) {
    console.log(`\n[${r.file}]`);
    console.log(r.text);
  }
})().catch((e) => {
  console.error('probe failed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
