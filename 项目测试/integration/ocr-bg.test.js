'use strict';
/**
 * 文字压在照片背景上的识别回归（项目测试/fixtures/bg-*.png）。
 *
 * 对应用户反馈的两类问题：
 *   1. "文字有背景图片就容易识别不到" —— 低对比度下必须逐行完整，不能漏字；
 *   2. "莫名加标点 / 原标点被换成别的" —— 不能出现重复标点、行首标点，
 *      也不能把 `Ctrl+Shift+T` 拆成 `Ctrl + Shift + T`。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { prepare } = require('../helpers/env');

prepare();

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, '项目测试', 'fixtures');
const { OcrService } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'index.js'));
const { repairCjkPunctuation } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'score.js'));
const { createLogger } = require(path.join(ROOT, '项目代码', 'src', 'core', 'log.js'));

const EXPECTED = [
  '请点击保存按钮，然后继续。',
  '如果没有响应，请稍后再试；也可以联系客服！',
  '小提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
].join('\n');

const CASES = [
  { name: 'bg-white-20px.png', min: 0.98, label: '白字压在照片上（无面板）' },
  { name: 'bg-panel-20px.png', min: 0.98, label: '深色字 + 半透明白面板' },
  { name: 'bg-gray-20px.png', min: 0.98, label: '浅灰字压在照片上（低对比）' },
  { name: 'bg-gray-15px.png', min: 0.9, label: '15px 浅灰字（最难）' },
];

function norm(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
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
  return max ? 1 - lev(x, y) / max : 1;
}

test('背景图上的中文：逐行完整、标点正确', async () => {
  const logger = createLogger({ level: 'error', console: false });
  const ocr = new OcrService({ logger });
  const details = [];
  for (const c of CASES) {
    const file = path.join(FIX, c.name);
    if (!fs.existsSync(file)) {
      assert.fail(`缺少合成图：${c.name}（先跑 项目测试/fixtures/gen-bg-text-fixtures.py）`);
    }
    const r = await ocr.recognize({ buffer: fs.readFileSync(file) });
    const text = repairCjkPunctuation(r.text).text;
    const sim = similarity(text, EXPECTED);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    details.push({ name: c.name, sim: Number(sim.toFixed(4)), lines: lines.length });

    assert.ok(sim >= c.min, `${c.label} 相似度 ${sim.toFixed(4)} < ${c.min}；识别结果：${JSON.stringify(text)}`);
    assert.strictEqual(lines.length, 3, `${c.label} 行数应为 3，实际 ${lines.length}：${JSON.stringify(text)}`);
    // 标点事故：不允许重复标点、不允许行首挂标点
    assert.ok(!/[，。、；：！？]{2}/.test(text), `${c.label} 出现重复标点：${JSON.stringify(text)}`);
    assert.ok(!/(^|\n)\s*[，。、；：！？]/.test(text), `${c.label} 出现行首标点：${JSON.stringify(text)}`);
    // 英文快捷键不能被空格拆开
    assert.ok(!/[A-Za-z]\s+[+\-*/=<>]\s+[A-Za-z]/.test(text), `${c.label} 快捷键被空格拆开：${JSON.stringify(text)}`);
    // 中文字符之间不应该有空格
    assert.ok(!/[\u4e00-\u9fff]\s+[\u4e00-\u9fff]/.test(text), `${c.label} 汉字间出现空格：${JSON.stringify(text)}`);
  }
  test.diagnostic?.(JSON.stringify(details));
});
