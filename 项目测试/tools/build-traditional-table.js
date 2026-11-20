'use strict';
/**
 * 由 OpenCC 的 STCharacters.txt 生成简体→繁体单字映射表。
 *
 * 用法：node 项目测试/tools/build-traditional-table.js <STCharacters.txt>
 * 产物：项目代码/src/core/translate/traditional-table.js
 *
 * 只保留「单字」条目（多字短语交给模型处理），一行里取第一个候选，
 * 这样可以在模型没做转换时做一次确定性的兜底转换。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const src = process.argv[2];
if (!src) {
  console.error('用法：node build-traditional-table.js <STCharacters.txt>');
  process.exit(1);
}

const CJK = /^[\u3400-\u4dbf\u4e00-\u9fff]$/;
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const map = new Map();
let scanned = 0;
for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const parts = line.split(/\t|\s{2,}/);
  if (parts.length < 2) continue;
  const simp = parts[0].trim();
  // 只收 BMP 内的单个汉字：生成的文件用「两个等长字符串」存映射，
  // 一旦混入逗号补充平面的字符（UTF-16 两个码元）下标就会错位。
  if (!CJK.test(simp)) continue;
  const first = parts[1].trim().split(/\s+/)[0];
  if (!first || first === simp) continue;
  if (!CJK.test(first)) continue;
  map.set(simp, first);
  scanned += 1;
}
console.log('扫描行:', lines.length, '命中单字:', scanned, '去重后:', map.size);

const keys = [...map.keys()].sort();
const from = keys.join('');
const to = keys.map((k) => map.get(k)).join('');

const out = `'use strict';
/**
 * 简体→繁体单字映射（core/translate/traditional-table.js）
 *
 * 数据来源：OpenCC 的 STCharacters.txt（Apache-2.0），只取单字条目、每行第一个候选。
 * 由 项目测试/tools/build-traditional-table.js 生成，请勿手改。
 *
 * 用途：目标语言是繁体中文时，若模型原样返回简体（本地小模型常见），
 * 用它做一次确定性字符转换，保证用户一定看到繁体输出。
 */

const FROM = '${from}';
const TO = '${to}';

const MAP = new Map();
for (let i = 0; i < FROM.length; i += 1) MAP.set(FROM[i], TO[i]);

module.exports = { MAP, FROM, TO, SIZE: MAP.size };
`;
const target = path.join(ROOT, '项目代码', 'src', 'core', 'translate', 'traditional-table.js');
fs.writeFileSync(target, out, 'utf8');
console.log('单字映射条数:', map.size, '→', target, fs.statSync(target).size, 'bytes');
