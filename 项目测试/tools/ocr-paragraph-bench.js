// 第十三轮基准：对「整段中文」合成图遍历预处理参数，按字准率排序。
// 目的：找到小字中文最稳的放大倍数/锐化/对比度组合，而不是拍脑袋定 2x+160。
'use strict';

const fs = require('fs');
const path = require('path');
const { runPowerShellFile } = require(path.join(__dirname, '..', '..', '项目代码', 'src', 'core', 'native', 'ps.js'));

const FIX = path.join(__dirname, '..', 'fixtures');
const OUT = path.join(__dirname, '..', 'reports');

const CASES = [
  {
    file: 'para-dark-15px.png',
    lines: [
      '请先点击「保存」按钮，然后等待同步完成。',
      '如果提示网络错误，请检查代理设置后重试。',
      '本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。',
      '注意：关闭窗口不会退出程序，程序会继续在后台运行。',
      '更多帮助请查看使用说明，或联系技术支持。',
    ],
  },
  {
    file: 'para-light-15px.png',
    lines: [
      '请先点击「保存」按钮，然后等待同步完成。',
      '如果提示网络错误，请检查代理设置后重试。',
      '本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。',
      '注意：关闭窗口不会退出程序，程序会继续在后台运行。',
      '更多帮助请查看使用说明，或联系技术支持。',
    ],
  },
  {
    file: 'para-dark-16px.png',
    lines: [
      '点击「开始」按钮后，系统会自动扫描并识别选区文字。',
      '识别结果会显示在浮窗中，可以复制或再次翻译。',
      '若译文不准确，可以切换目标语言或调整框选区域。',
    ],
  },
  {
    file: 'para-gray-14px.png',
    lines: [
      '提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
      '浮窗右下角的小三角可以调整窗口大小。',
      '按 Esc 键会暂停定时轮询。',
    ],
  },
];

const VARIANTS = [];
for (const scale of [2, 3, 4]) {
  for (const sharpen of [0, 120, 160, 240]) {
    for (const contrast of [0, 20]) {
      VARIANTS.push({ scale, sharpen, contrast });
    }
  }
}

const CACHE = path.join(__dirname, '..', '_runtime', 'ocr-cache');
if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

const squash = (s) => String(s || '')
  .replace(/\s+/g, '')
  .replace(/[，。、；：？！「」“”‘’（）]/g, (m) => m)
  .replace(/[％]/g, '%')
  .toLowerCase();

function lev(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(text, expected) {
  const a = squash(text);
  const b = squash(expected);
  if (!a.length || !b.length) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

(async () => {
  const rows = [];
  for (const c of CASES) {
    const expected = c.lines.join('\n');
    for (const v of VARIANTS) {
      const img = path.join(FIX, c.file);
      const out = path.join(OUT, `bench-${c.file}-${v.scale}-${v.sharpen}-${v.contrast}.json`);
      await runPowerShellFile('winrt-ocr.ps1', [
        '-ImagePath', img, '-OutPath', out, '-Lang', 'zh-Hans-CN,en-US',
        '-Scale', String(v.scale), '-Sharpen', String(v.sharpen), '-Contrast', String(v.contrast),
        '-CacheDir', CACHE,
      ], { timeoutMs: 60000 });
      let data = null;
      try { data = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { data = null; }
      if (fs.existsSync(out)) fs.unlinkSync(out);
      const text = data ? data.text : '';
      rows.push({ file: c.file, ...v, ms: data && data.ms, sim: similarity(text, expected), text });
    }
  }
  fs.writeFileSync(path.join(OUT, 'ocr-paragraph-bench.json'), JSON.stringify(rows, null, 2), 'utf8');

  const bySim = rows.slice().sort((x, y) => y.sim - x.sim);
  console.log('=== 全局前 12 ===');
  for (const r of bySim.slice(0, 12)) {
    console.log(`${r.file.padEnd(20)} s=${r.scale} sh=${String(r.sharpen).padEnd(3)} c=${String(r.contrast).padEnd(2)} sim=${r.sim.toFixed(4)} ms=${r.ms}`);
  }
  console.log('\n=== 每组最佳 ===');
  for (const c of CASES) {
    const best = rows.filter((r) => r.file === c.file).sort((x, y) => y.sim - x.sim)[0];
    console.log(`${c.file.padEnd(20)} best s=${best.scale} sh=${best.sharpen} c=${best.contrast} sim=${best.sim.toFixed(4)}`);
  }
  const avg = {};
  for (const r of rows) {
    const k = `s${r.scale}-sh${r.sharpen}-c${r.contrast}`;
    avg[k] = avg[k] || [];
    avg[k].push(r.sim);
  }
  console.log('\n=== 参数组合平均分 ===');
  Object.keys(avg)
    .map((k) => ({ k, v: avg[k].reduce((a, b) => a + b, 0) / avg[k].length }))
    .sort((a, b) => b.v - a.v)
    .forEach((x) => console.log(`${x.k.padEnd(18)} ${x.v.toFixed(4)}`));
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
