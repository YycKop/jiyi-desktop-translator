'use strict';
/**
 * 反色对照实验：同一段中文，比较「原图」与「预先把暗底浅字反色成深字浅底」两组的识别相似度。
 * 用法：node 项目测试/tools/ocr-invert-compare.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'invert-exp');
fs.mkdirSync(process.env.TRANSLATOR_HOME, { recursive: true });

const { recognize } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'winrt.js'));

const FIX = path.join(ROOT, '项目测试', 'fixtures');
const EXPECT = '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复';

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

const norm = (s) => String(s || '').replace(/\s+/g, '');
const sim = (a, b) => {
  const x = norm(a); const y = norm(b);
  const max = Math.max(x.length, y.length) || 1;
  return (max - levenshtein(x, y)) / max;
};

const CASES = [
  ['ui-hint-14px.png', '14px 原图（暗底浅字）'],
  ['ui-hint-14px-inv.png', '14px 反色（深字浅底）'],
  ['ui-hint-16px.png', '16px 原图（暗底浅字）'],
  ['ui-hint-16px-inv.png', '16px 反色（深字浅底）'],
  ['ui-hint-light.png', '14px 浅底深字（原图）'],
];

(async () => {
  for (const [file, label] of CASES) {
    const full = path.join(FIX, file);
    if (!fs.existsSync(full)) { console.log('missing', file); continue; }
    const buf = fs.readFileSync(full);
    for (const scale of [2, 3]) {
      const out = await recognize({ buffer: buf, scale });
      console.log(
        `${label.padEnd(22)} ${scale}x  sim=${sim(out.text, EXPECT).toFixed(4)}  ${out.ms}ms  ${JSON.stringify(out.text)}`
      );
    }
  }
})();
