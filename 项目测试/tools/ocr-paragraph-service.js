// 第十三轮验证：整段中文图走「正式链路」（OcrService.recognize → winrt 多遍 + 择优 + 收敛），
// 输出与真值的相似度，确认"框里文字识别不全"的问题已缓解。
'use strict';

const fs = require('fs');
const path = require('path');

const TEST_ROOT = path.join(__dirname, '..');
process.env.TRANSLATOR_HOME = path.join(TEST_ROOT, '_runtime', 'home');

const { OcrService } = require(path.join(TEST_ROOT, '..', '项目代码', 'src', 'core', 'ocr', 'index.js'));
const { createLogger } = require(path.join(TEST_ROOT, '..', '项目代码', 'src', 'core', 'log.js'));

const FIX = path.join(TEST_ROOT, 'fixtures');
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

const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

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

const sim = (a, b) => {
  const x = squash(a); const y = squash(b);
  if (!x.length || !y.length) return 0;
  return 1 - lev(x, y) / Math.max(x.length, y.length);
};

(async () => {
  const ocr = new OcrService({ logger: createLogger({ level: 'error', console: false }) });
  const rows = [];
  for (const c of CASES) {
    const buffer = fs.readFileSync(path.join(FIX, c.file));
    const r = await ocr.recognize({ buffer });
    const expected = c.lines.join('\n');
    const lines = String(r.text || '').split('\n').filter((l) => l.trim());
    rows.push({
      file: c.file,
      expectLines: c.lines.length,
      gotLines: lines.length,
      sim: sim(r.text, expected),
      chars: squash(r.text).length,
      expectChars: squash(expected).length,
      ms: r.ms,
      chosen: r.chosenScale,
      reason: r.reason,
      text: r.text,
    });
    console.log(`${c.file.padEnd(20)} lines=${lines.length}/${c.lines.length} chars=${squash(r.text).length}/${squash(expected).length} sim=${sim(r.text, expected).toFixed(4)} ms=${r.ms} chosen=${r.chosenScale} reason=${r.reason}`);
  }
  fs.writeFileSync(path.join(TEST_ROOT, 'reports', 'ocr-paragraph-service.json'), JSON.stringify(rows, null, 2), 'utf8');
  console.log('\n--- 文本明细 ---');
  for (const r of rows) console.log(`\n[${r.file}]\n${r.text}`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
