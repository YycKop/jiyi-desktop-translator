'use strict';
/**
 * 背景图文字 + 中文标点 的识别对比探针。
 *
 * 用法：node 项目测试/tools/ocr-bg-probe.js [fixture...]
 * 输出每张图的多遍识别结果（含各遍原始文本），用来判断是"丢字"还是"标点错乱"。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'home');

const { recognizeMulti } = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'winrt.js'));

const FIX = path.join(ROOT, '项目测试', 'fixtures');
const DEFAULT = ['bg-white-20px.png', 'bg-panel-20px.png', 'bg-gray-20px.png'];

async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  for (const name of names) {
    const file = path.join(FIX, name);
    if (!fs.existsSync(file)) {
      console.log(`跳过（不存在）: ${name}`);
      continue;
    }
    const buffer = fs.readFileSync(file);
    console.log(`\n=== ${name} ===`);
    try {
      const r = await recognizeMulti({ buffer, langs: ['zh-Hans-CN'], scales: [2, 3] });
      console.log(`chosen=${r.chosenScale} reason=${r.reason} ms=${r.ms}`);
      console.log('--- 多遍合并结果 ---');
      console.log(r.text);
      for (const s of r.scaleSeries || []) {
        console.log(`--- pass scale=${s.scale} score=${s.score} ms=${s.ms} ---`);
        console.log(s.text);
      }
    } catch (e) {
      console.log(`识别失败: ${e.code || ''} ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
