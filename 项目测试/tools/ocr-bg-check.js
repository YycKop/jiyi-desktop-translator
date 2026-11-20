'use strict';
/**
 * 背景图文字识别精度检查（项目测试/fixtures/bg-*.png）。
 *
 * 这些图是"文字压在照片上"的场景，用来验证：
 *   · 低对比度也能识别完整行（不漏字）
 *   · 标点不丢、不重复、不被替换
 *   · 英文快捷键不被空格拆开（Ctrl+Shift+T）
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'home');

const { recognizeMulti } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'winrt.js'));
const { repairCjkPunctuation } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'score.js'));

const EXPECTED = [
  '请点击保存按钮，然后继续。',
  '如果没有响应，请稍后再试；也可以联系客服！',
  '小提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
].join('\n');

const CASES = [
  { name: 'bg-white-20px.png', min: 0.98 },
  { name: 'bg-panel-20px.png', min: 0.98 },
  { name: 'bg-gray-20px.png', min: 0.98 },
  { name: 'bg-gray-15px.png', min: 0.9 },
];

function norm(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  const max = Math.max(x.length, y.length);
  if (!max) return 1;
  return 1 - lev(x, y) / max;
}

async function main() {
  const fixDir = path.join(ROOT, '项目测试', 'fixtures');
  let failed = 0;
  for (const c of CASES) {
    const file = path.join(fixDir, c.name);
    if (!fs.existsSync(file)) {
      console.log(`SKIP ${c.name}（文件不存在）`);
      continue;
    }
    const buffer = fs.readFileSync(file);
    const r = await recognizeMulti({ buffer, langs: ['zh-Hans-CN', 'en-US'], passes: undefined });
    const text = repairCjkPunctuation(r.text).text;
    const sim = similarity(text, EXPECTED);
    const punctOk = !/[，。、；：！？]{2}/.test(text) && !/(^|\n)[，。、；：！？]/.test(text);
    const asciiOk = !/[A-Za-z]\s+[+\-*/=<>]\s+[A-Za-z]/.test(text);
    const pass = sim >= c.min && punctOk && asciiOk;
    if (!pass) failed += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${c.name} sim=${sim.toFixed(4)} punct=${punctOk} ascii=${asciiOk} ms=${r.ms}`);
    if (!pass) {
      console.log('  识别：', JSON.stringify(text));
      console.log('  期望：', JSON.stringify(EXPECTED));
    }
  }
  console.log(failed ? `失败 ${failed} 张` : '全部通过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
