'use strict';
/**
 * 变体对照 + 逐字投票实验：找出能让小字号中文识别正确的组合。
 * 用法：node 项目测试/tools/ocr-vote-experiment.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'vote-exp');
fs.mkdirSync(process.env.TRANSLATOR_HOME, { recursive: true });

const { recognize } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'winrt.js'));

const FIX = path.join(ROOT, '项目测试', 'fixtures');
const EXPECT = '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复';

const FILES = [
  ['ui-hint-14px.png', 2],
  ['ui-hint-14px.png', 3],
  ['ui-hint-14px.png', 4],
  ['v-sharp.png', 2],
  ['v-sharp.png', 3],
  ['v-sharp2x.png', 1],
  ['v-sharp2x.png', 2],
  ['v-autocontrast.png', 2],
  ['v-gray-sharp.png', 2],
  ['v-x25.png', 1],
  ['v-x4.png', 1],
];

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

/** 逐字投票：只对长度一致的候选做位置级投票，票数相同则取先出现的候选 */
function vote(texts) {
  const clean = texts.filter((t) => t && t.length);
  if (!clean.length) return '';
  const len = clean[0].length;
  if (!clean.every((t) => t.length === len)) return clean[0];
  let out = '';
  for (let i = 0; i < len; i += 1) {
    const counts = new Map();
    for (const t of clean) {
      const ch = t[i];
      counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    let bestCh = clean[0][i];
    let bestN = -1;
    for (const [ch, n] of counts) {
      if (n > bestN) { bestN = n; bestCh = ch; }
    }
    out += bestCh;
  }
  return out;
}

(async () => {
  const results = [];
  for (const [file, scale] of FILES) {
    const full = path.join(FIX, file);
    if (!fs.existsSync(full)) { console.log('missing', file); continue; }
    const buf = fs.readFileSync(full);
    const out = await recognize({ buffer: buf, scale });
    const s = sim(out.text, EXPECT);
    results.push({ label: `${file} ${scale}x`, text: out.text, sim: Number(s.toFixed(4)), ms: out.ms });
    console.log(`${String(s.toFixed(4)).padEnd(7)} ${(file + ' ' + scale + 'x').padEnd(24)} ${out.ms}ms ${JSON.stringify(out.text)}`);
  }

  // 只用「长度与最常见长度一致」的候选做投票
  const votes = vote(results.map((r) => r.text.replace(/\s+/g, '')));
  console.log('\nvote(all)   sim=' + sim(votes, EXPECT).toFixed(4) + '  ' + JSON.stringify(votes));

  // 两两投票：看看哪一对能救回来
  let best = null;
  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      const v = vote([results[i].text.replace(/\s+/g, ''), results[j].text.replace(/\s+/g, '')]);
      const s = sim(v, EXPECT);
      if (!best || s > best.sim) best = { sim: s, pair: [results[i].label, results[j].label], text: v };
    }
  }
  console.log('best pair   sim=' + (best ? best.sim.toFixed(4) : 'n/a') + '  ' + (best ? best.pair.join(' + ') : ''));
  console.log('best text   ' + JSON.stringify(best ? best.text : ''));
})();
