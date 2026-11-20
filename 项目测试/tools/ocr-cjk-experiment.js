'use strict';
/**
 * 小字号中文 OCR 对比实验
 * 目的：复现用户反馈（动→目、文字丢失、景→昱），验证「自动反色 + 多倍率 + 逐字投票」是否有效。
 * 用法：node 项目测试/tools/ocr-cjk-experiment.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'cjk-exp');
fs.mkdirSync(process.env.TRANSLATOR_HOME, { recursive: true });

const P = path.join(ROOT, '项目代码', 'src');
const { recognize } = require(path.join(P, 'core', 'ocr', 'winrt.js'));

const FIX = path.join(ROOT, '项目测试', 'fixtures');

const CASES = [
  { file: 'ui-hint-14px.png', expect: '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复' },
  { file: 'ui-hint-16px.png', expect: '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复' },
  { file: 'ui-hint-light.png', expect: '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复' },
];

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

function norm(s) {
  return String(s || '').replace(/\s+/g, '');
}

function sim(a, b) {
  const x = norm(a);
  const y = norm(b);
  const max = Math.max(x.length, y.length) || 1;
  return (max - levenshtein(x, y)) / max;
}

const VARIANTS = [
  { label: '2x 原始', scale: 2, autoPolarity: false },
  { label: '3x 原始', scale: 3, autoPolarity: false },
  { label: '2x 自动反色', scale: 2, autoPolarity: true },
  { label: '3x 自动反色', scale: 3, autoPolarity: true },
  { label: '4x 自动反色', scale: 4, autoPolarity: true },
  { label: '3x 反色+对比40', scale: 3, autoPolarity: true, contrast: 40 },
];

(async () => {
  const report = [];
  for (const c of CASES) {
    const buf = fs.readFileSync(path.join(FIX, c.file));
    const rows = [];
    for (const v of VARIANTS) {
      let out;
      try {
        out = await recognize({ buffer: buf, scale: v.scale, autoPolarity: v.autoPolarity, contrast: v.contrast || 0 });
      } catch (e) {
        rows.push({ variant: v.label, error: e.message });
        continue;
      }
      rows.push({
        variant: v.label,
        ms: out.ms,
        inverted: out.inverted,
        meanLuma: out.meanLuma,
        similarity: Number(sim(out.text, c.expect).toFixed(4)),
        text: out.text,
      });
    }
    rows.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    report.push({ file: c.file, expect: c.expect, rows });
    console.log('\n== ' + c.file + ' ==');
    console.log('expect: ' + JSON.stringify(c.expect));
    for (const r of rows) {
      console.log(
        `  ${String(r.similarity).padEnd(6)} ${String(r.variant).padEnd(16)} ${String(r.ms).padStart(4)}ms inverted=${r.inverted} ` +
          JSON.stringify(r.text)
      );
    }
  }
  const outFile = path.join(ROOT, '项目测试', 'reports', 'ocr-cjk-experiment.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nreport ->', outFile);
})();
