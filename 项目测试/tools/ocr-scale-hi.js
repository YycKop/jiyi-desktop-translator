// 第十三轮：再往高倍数找找上限（3x 之后是否还有收益）
'use strict';

const fs = require('fs');
const path = require('path');
const { runPowerShellFile } = require(path.join(__dirname, '..', '..', '项目代码', 'src', 'core', 'native', 'ps.js'));

const FIX = path.join(__dirname, '..', 'fixtures');
const OUT = path.join(__dirname, '..', 'reports');
const CACHE = path.join(__dirname, '..', '_runtime', 'ocr-cache');

const CASES = [
  ['para-dark-15px.png', [
    '请先点击「保存」按钮，然后等待同步完成。',
    '如果提示网络错误，请检查代理设置后重试。',
    '本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。',
    '注意：关闭窗口不会退出程序，程序会继续在后台运行。',
    '更多帮助请查看使用说明，或联系技术支持。']],
  ['para-gray-14px.png', [
    '提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
    '浮窗右下角的小三角可以调整窗口大小。',
    '按 Esc 键会暂停定时轮询。']],
];

const squash = (s) => String(s || '').replace(/\s+/g, '').reduce ? '' : String(s || '').replace(/\s+/g, '').toLowerCase();
function lev(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = []; for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => {
  const x = squash(a); const y = squash(b);
  return (!x.length || !y.length) ? 0 : 1 - lev(x, y) / Math.max(x.length, y.length);
};

(async () => {
  const rows = [];
  for (const [file, expectedLines] of CASES) {
    const expected = expectedLines.join('\n');
    for (const scale of [2, 2.5, 3, 3.5, 4, 5, 6]) {
      for (const sharpen of [0, 160]) {
        const out = path.join(OUT, `hi-${file}-${scale}-${sharpen}.json`);
        await runPowerShellFile('winrt-ocr.ps1', [
          '-ImagePath', path.join(FIX, file), '-OutPath', out, '-Lang', 'zh-Hans-CN,en-US',
          '-Scale', String(scale), '-Sharpen', String(sharpen), '-CacheDir', CACHE,
        ], { timeoutMs: 60000 });
        let data = null;
        try { data = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { data = null; }
        if (fs.existsSync(out)) fs.unlinkSync(out);
        if (!data || !data.ok) { rows.push({ file, scale, sharpen, sim: 0, ms: null, text: '(fail)' }); continue; }
        rows.push({ file, scale, sharpen, sim: sim(data.text, expected), ms: data.ms, text: data.text });
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'ocr-scale-hi.json'), JSON.stringify(rows, null, 2), 'utf8');
  rows.sort((a, b) => b.sim - a.sim);
  for (const r of rows) console.log(`${r.file.padEnd(20)} s=${String(r.scale).padEnd(3)} sh=${String(r.sharpen).padEnd(3)} sim=${r.sim.toFixed(4)} ms=${r.ms}`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
