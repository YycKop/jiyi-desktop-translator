'use strict';
/**
 * D1.3 验收：区域 OCR 对中英文印刷体的识别率 ≥95%
 *
 * 运行：node --test 项目测试
 * 用量：合成测试图（SCR-02），不触碰真实桌面内容；
 *      OCR 原文只写入终端与 项目测试/reports/ocr-accuracy.json（禁止外发，SCR-03）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { prepare, TEST_ROOT } = require('./helpers/env');

prepare();

const fixtures = require('./helpers/fixtures');
const sim = require('./helpers/text-similarity');
const { createLogger } = require('../项目代码/src/core/log');
const { OcrService } = require('../项目代码/src/core/ocr');

const REPORTS_DIR = path.join(TEST_ROOT, 'reports');
const report = { generatedAt: new Date().toISOString(), engine: null, cases: [], ok: false };

function makeOcr() {
  const logger = createLogger({ level: 'error', console: false });
  return new OcrService({ logger });
}

test('OCR 引擎可用（winrt 或 tesseract）', async () => {
  const ocr = makeOcr();
  const picked = await ocr.pick();
  report.engine = picked && picked.name;
  assert.ok(picked && picked.name, `没有可用 OCR 引擎：${JSON.stringify(await ocr.status())}`);
});

test('合成图识别率达标', async (t) => {
  const ocr = makeOcr();
  await ocr.pick();
  let allOk = true;

  for (const item of fixtures.list()) {
    assert.ok(fs.existsSync(item.file), `缺少测试图 ${item.name}，请先运行 项目测试/fixtures/gen-fixtures.ps1`);

    // eslint-disable-next-line no-await-in-loop
    await t.test(item.name, async () => {
      const buffer = fs.readFileSync(item.file);
      const started = Date.now();
      const result = await ocr.recognize({ buffer });
      const elapsed = Date.now() - started;
      const score = sim.similarity(result.text, item.expected);
      const diff = sim.diffSummary(result.text, item.expected);

      report.cases.push({
        file: item.name,
        description: item.description,
        kind: item.kind,
        engine: result.engine,
        lang: result.lang,
        ocrMs: result.ms,
        totalMs: elapsed,
        chars: (result.text || '').length,
        similarity: Number(score.toFixed(4)),
        minSimilarity: item.minSimilarity,
        pass: score >= item.minSimilarity,
        text: result.text,
        expected: item.expected,
        diff,
      });

      if (score < item.minSimilarity) allOk = false;
      // 延迟上限：单张区域 OCR 应远低于 3s（N-01 离线 ≤3s，还需留给翻译）
      assert.ok(elapsed < 10000, `${item.name} OCR 耗时过长：${elapsed}ms`);
      // 中文标点回归（用户反馈「中文字和标点识别率低」）：中文里不得残留半角标点，
      // 汉字之间也不应出现空格（WinRT 的原始输出是「欢 迎 使 用 ， 然 后」）。
      if (item.checkCjkPunct) {
        const text = String(result.text || '');
        assert.ok(
          !/[\u4e00-\u9fff]\s*[,;:?!]|[,;:?!]\s*[\u4e00-\u9fff]/.test(text),
          `${item.name} 中文里残留半角标点：${JSON.stringify(text)}`,
        );
        assert.ok(
          !/[\u4e00-\u9fff][ \t\u3000]+[\u4e00-\u9fff]/.test(text),
          `${item.name} 汉字之间残留空格：${JSON.stringify(text)}`,
        );
        assert.ok(
          !/[，。：！？][ \t\u3000]+[\u4e00-\u9fff]/.test(text),
          `${item.name} 全角标点后残留空格：${JSON.stringify(text)}`,
        );
      }
      // 数字回归（用户反馈「识别不全」里最容易被忽略的一类）：
      // WinRT 在中文语境下会把 3.5 输出成「3 ． 5」，把 100% 输出成「100 ％」。
      if (item.checkDigits) {
        const text = String(result.text || '');
        assert.ok(!/\d\s*[．。·]\s*\d/.test(text), `${item.name} 数字里的小数点被认成全角：${JSON.stringify(text)}`);
        assert.ok(!/[％%]/.test(text.replace(/％/g, '%')) || !/\d[ \t]+[％%]/.test(text), `${item.name} 百分号前残留空格：${JSON.stringify(text)}`);
      }
      assert.ok(
        score >= item.minSimilarity,
        `${item.name} 识别率 ${(score * 100).toFixed(2)}% < ${(item.minSimilarity * 100).toFixed(0)}%` +
          `（期望 "${diff.expectedSlice}" 实际 "${diff.actualSlice}"）`,
      );
    });
  }

  report.ok = allOk;
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, 'ocr-accuracy.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
});
