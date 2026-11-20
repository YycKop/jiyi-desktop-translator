'use strict';
/**
 * 离线实验：比较不同缩放/预处理下的 OCR 结果，用字符相似度打分。
 * 仅本地运行，不联网（SCR-03）。
 *
 * 用法：node 项目测试/tools/ocr-experiment.js
 */
process.env.TRANSLATOR_HOME = process.env.TRANSLATOR_HOME
  || 'D:\\桌面翻译助手\\项目测试\\_runtime\\home';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { recognize } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'winrt.js'));

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function sim(a, b) {
  const x = String(a || '').replace(/\s+/g, '').toLowerCase();
  const y = String(b || '').replace(/\s+/g, '').toLowerCase();
  if (!x.length && !y.length) return 1;
  return 1 - lev(x, y) / Math.max(x.length, y.length);
}

const CASES = [
  { file: 'il-640x160.png', expect: 'Please click the link to fill in your details. This is a little list of items.' },
  { file: 'il-small-480x90.png', expect: 'Click the link, it will fill in.' },
  { file: 'il-dark-560x120.png', expect: 'Log in to see your profile settings.' },
  { file: 'small-360x90.png', expect: 'Subtitles line one 字幕第一行' },
  { file: 'en-480x120.png', expect: 'The quick brown fox jumps over the lazy dog.' },
];

const SCALES = [2, 3, 4];

(async () => {
  const out = [];
  for (const c of CASES) {
    const file = path.join(ROOT, '项目测试', 'fixtures', c.file);
    if (!fs.existsSync(file)) continue;
    const buffer = fs.readFileSync(file);
    for (const scale of SCALES) {
      const t0 = Date.now();
      let text = '';
      let ms = 0;
      try {
        const r = await recognize({ buffer, scale });
        text = r.text;
        ms = r.ms;
      } catch (e) {
        text = `ERR ${e.message}`;
      }
      const score = sim(text, c.expect);
      out.push({ file: c.file, scale, score: Number(score.toFixed(4)), ms, text });
      console.log(`${c.file}  scale=${scale}  score=${score.toFixed(4)}  ${ms}ms  → ${text.replace(/\n/g, ' ⏎ ')}`);
    }
  }

  const best = {};
  for (const r of out) {
    if (!best[r.file] || r.score > best[r.file].score) best[r.file] = r;
  }
  console.log('\n最佳 scale：');
  for (const [f, r] of Object.entries(best)) console.log(`  ${f}: scale=${r.scale} score=${r.score}`);
  fs.writeFileSync(path.join(ROOT, '项目测试', 'reports', 'ocr-scale-experiment.json'),
    JSON.stringify(out, null, 2), 'utf8');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
