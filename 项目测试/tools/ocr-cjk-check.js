'use strict';
/**
 * 小字号中文提示文字识别率复测（用户反馈：动→目、文字丢失、景→昱）
 * 用法：node 项目测试/tools/ocr-cjk-check.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'cjk-check');
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

(async () => {
  let fail = 0;
  for (const file of ['ui-hint-14px.png', 'ui-hint-16px.png', 'ui-hint-light.png']) {
    const buf = fs.readFileSync(path.join(FIX, file));
    const out = await recognize({ buffer: buf });
    const s = sim(out.text, EXPECT);
    const ok = s >= 0.98;
    if (!ok) fail += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${file.padEnd(20)} sim=${s.toFixed(4)} ${out.ms}ms ${JSON.stringify(out.text)}`);
  }
  process.exit(fail ? 1 : 0);
})();
