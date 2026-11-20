'use strict';
/**
 * 日文 / 韩文识别探针（第二十一轮需求 5）。
 * 用法：node 项目测试\tools\ocr-multilang-check.js [lang]
 *   lang 省略时对比 auto / ch / japan / korean 四种设置
 */
const fs = require('fs');
const path = require('path');
const { RapidOcr } = require('../../项目代码/src/core/ocr/rapid');

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const MODELS = path.resolve(__dirname, '..', '..', '项目代码', 'runtime', 'ocr-rapid', 'models');

const CASES = [
  { file: 'jp-hiragana-640x200.png', expect: ['こんにちは', 'カタカナ'] },
  { file: 'jp-mixed-640x200.png', expect: ['日本語', 'カタカナ'] },
  { file: 'ko-hangul-640x200.png', expect: ['안녕하세요', '한국어'] },
  { file: 'ko-sentence-640x200.png', expect: ['한국어', '자막'] },
];

(async () => {
  const only = process.argv[2];
  const langs = only ? [only] : ['auto', 'ch', 'japan', 'korean'];
  const ocr = new RapidOcr({ modelsDir: MODELS });
  console.log('可用模型:', ocr.availableLangs().join(', '));
  for (const lang of langs) {
    console.log(`\n===== lang=${lang} =====`);
    for (const c of CASES) {
      const buf = fs.readFileSync(path.join(FIXTURES, c.file));
      const t0 = Date.now();
      try {
        const r = await ocr.recognize({ buffer: buf, lang });
        const hit = c.expect.filter((k) => r.text.includes(k));
        const lines = r.text.split('\n').filter(Boolean).join(' | ');
        console.log(`${c.file}  ${Date.now() - t0}ms  ${hit.length}/${c.expect.length}  [${r.lang}]`);
        console.log(`    ${lines}`);
        if (r.boxes) {
          const s = r.boxes.map((b) => `${b.lang}:${b.score}`).join(', ');
          console.log(`    逐行: ${s}`);
        }
      } catch (e) {
        console.log(`${c.file}  失败: ${e.message}`);
      }
    }
  }
})();
