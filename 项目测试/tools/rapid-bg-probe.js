'use strict';
/** 背景图合成图在 rapid 引擎下的表现（对比 winrt 的 0.95–0.98）。 */
const fs = require('fs');
const path = require('path');
const { RapidOcr } = require('../../项目代码/src/core/ocr/rapid');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');
const MODELS = path.join(__dirname, '..', '..', '项目代码', 'runtime', 'ocr-rapid', 'models');

const EXPECTED = [
  '请点击保存按钮，然后继续。',
  '如果没有响应，请稍后再试；也可以联系客服！',
  '小提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
].join('\n');

const FILES = ['bg-white-20px.png', 'bg-panel-20px.png', 'bg-gray-20px.png', 'bg-gray-15px.png'];

function normalize(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = curr; curr = t;
  }
  return prev[n];
}
function sim(a, b) {
  const x = normalize(a); const y = normalize(b);
  return 1 - lev(x, y) / Math.max(x.length, y.length, 1);
}

(async () => {
  const ocr = new RapidOcr({ modelsDir: MODELS });
  console.log('probe:', JSON.stringify(await ocr.probe()));
  for (const file of FILES) {
    const full = path.join(FIXTURE_DIR, file);
    if (!fs.existsSync(full)) { console.log('missing', file); continue; }
    const r = await ocr.recognize({ buffer: fs.readFileSync(full) });
    const s = sim(EXPECTED, r.text);
    console.log(`${s >= 0.99 ? 'OK  ' : s >= 0.95 ? 'PASS' : 'FAIL'} ${file} sim=${s.toFixed(4)} lines=${r.lineCount} ms=${r.ms}`);
    if (s < 1) {
      console.log('  expect:', EXPECTED.replace(/\n/g, ' | '));
      console.log('  actual:', r.text.replace(/\n/g, ' | '));
    }
  }
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });
