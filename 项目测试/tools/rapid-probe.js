'use strict';
/**
 * RapidOCR(ONNX) 引擎的精度探针：对合成图逐张识别并与期望文本比对。
 * 用法：node 项目测试/tools/rapid-probe.js [图名过滤]
 */
const fs = require('fs');
const path = require('path');
const { RapidOcr } = require('../../项目代码/src/core/ocr/rapid');
const fixtures = require('../helpers/fixtures');

const TEST_ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(TEST_ROOT, 'fixtures');
const MODELS = path.join(TEST_ROOT, '..', '项目代码', 'runtime', 'ocr-rapid', 'models');

function normalize(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[n];
}

function similarity(expected, actual) {
  const a = normalize(expected);
  const b = normalize(actual);
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

(async () => {
  const filter = process.argv[2] || '';
  const ocr = new RapidOcr({ modelsDir: MODELS });
  const probe = await ocr.probe();
  console.log('probe:', JSON.stringify(probe));
  if (!probe.ok) process.exit(2);

  let pass = 0;
  let total = 0;
  // fixtures.FIXTURES 是「文件名 → 期望」的对象（不是数组）
  const entries = Object.entries(fixtures.FIXTURES || {}).map(([file, meta]) => ({ file, ...meta }));
  for (const f of entries) {
    if (filter && !f.file.includes(filter)) continue;
    const file = path.join(FIXTURE_DIR, f.file);
    if (!fs.existsSync(file)) { console.log('skip(missing)', f.file); continue; }
    const buffer = fs.readFileSync(file);
    try {
      const r = await ocr.recognize({ buffer });
      const sim = similarity(f.expected, r.text);
      total += 1;
      if (sim >= (f.minSimilarity || 0.95)) pass += 1;
      const flag = sim >= 0.99 ? 'OK  ' : sim >= (f.minSimilarity || 0.95) ? 'PASS' : 'FAIL';
      console.log(`${flag} ${f.file}  sim=${sim.toFixed(4)}  lines=${r.lineCount}  ms=${r.ms}`);
      if (sim < 1) {
        console.log('   expect:', f.expected.replace(/\n/g, ' | '));
        console.log('   actual:', r.text.replace(/\n/g, ' | '));
      }
    } catch (e) {
      total += 1;
      console.log(`ERR  ${f.file}: ${e && e.message}`);
    }
  }
  console.log(`\n=== ${pass}/${total} 达标`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });
