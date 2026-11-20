'use strict';
/**
 * rapid 引擎的纯函数单测：PNG 解码、切行、CTC 解码。
 * 不加载 ONNX 会话（模型推理由集成测试覆盖），保证单测秒级完成。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { decodePng } = require('../../项目代码/src/core/ocr/png');
const { findLines, ctcDecode, scriptRatio, languageScore, LANG_ALIASES } = require('../../项目代码/src/core/ocr/rapid');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'zh-en-640x200.png');

test('decodePng 解出正确的尺寸与像素', () => {
  const img = decodePng(fs.readFileSync(FIXTURE));
  assert.equal(img.width, 640);
  assert.equal(img.height, 200);
  assert.equal(img.data.length, 640 * 200 * 4);

  // 白底：左上角应是亮色
  const corner = img.data[0] + img.data[1] + img.data[2];
  assert.ok(corner > 600, `左上角应为白底，实际 ${corner}`);

  // 文字行区域内应出现暗像素（说明真的解码出了内容）
  let dark = 0;
  for (let y = 20; y < 120; y += 1) {
    for (let x = 20; x < 620; x += 1) {
      const p = (y * img.width + x) * 4;
      if (img.data[p] < 120) dark += 1;
    }
  }
  assert.ok(dark > 500, `文字区域暗像素过少：${dark}`);
});

test('decodePng 拒绝非 PNG 输入', () => {
  assert.throws(() => decodePng(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), /不是 PNG/);
});

test('findLines 按行投影切出两条文本带', () => {
  const width = 200;
  const height = 80;
  const gray = new Float32Array(width * height).fill(255);
  const paint = (y0, y1) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = 10; x < 150; x += 1) {
        if ((x + y) % 4 !== 0) gray[y * width + x] = 20;
      }
    }
  };
  paint(10, 24);
  paint(45, 59);

  const boxes = findLines(gray, width, height);
  assert.equal(boxes.length, 2, `应切出 2 行，实际 ${boxes.length}`);
  // 墨迹图用「局部均值」判定，行边缘会被半径 6 的窗口向外扩一点，因此只断言覆盖关系
  assert.ok(boxes[0].y0 <= 12 && boxes[0].y1 >= 22, `第一行覆盖范围 ${boxes[0].y0}-${boxes[0].y1}`);
  assert.ok(boxes[1].y0 <= 47 && boxes[1].y1 >= 57, `第二行覆盖范围 ${boxes[1].y0}-${boxes[1].y1}`);
  assert.ok(boxes[0].x0 <= 12 && boxes[0].x1 >= 148, '列边界应覆盖文字范围');
});

test('findLines 在空白图上不产生行', () => {
  const width = 120;
  const height = 60;
  const gray = new Float32Array(width * height).fill(250);
  assert.deepEqual(findLines(gray, width, height), []);
});

test('ctcDecode 去空白、去重、按字典映射', () => {
  // classes = 字典 3 + blank + 空格 = 5
  const keys = ['A', 'B', 'C'];
  const steps = 5;
  const classes = 5;
  const data = new Float32Array(steps * classes);
  const put = (t, c) => { data[t * classes + c] = 1; };
  put(0, 1); // A
  put(1, 0); // blank
  put(2, 2); // B
  put(3, 2); // 重复 B → 丢弃
  put(4, 4); // 空格
  const out = ctcDecode({ dims: [1, steps, classes], data }, keys);
  assert.equal(out, 'AB ');
});

test('ctcDecode 支持带空格的字典（classes = 字典+2）', () => {
  const keys = ['中', '文'];
  const steps = 3;
  const classes = 4;
  const data = new Float32Array(steps * classes);
  data[0 * classes + 1] = 1; // 中
  data[1 * classes + 3] = 1; // 空格（字典长度+1）
  data[2 * classes + 2] = 1; // 文
  assert.equal(ctcDecode({ dims: [1, steps, classes], data }, keys), '中 文');
});

test('scriptRatio 按语种统计字形比例', () => {
  assert.equal(scriptRatio('hello world', 'ch'), 1, '英文在中文模型里算命中');
  assert.equal(scriptRatio('hello world', 'korean'), 0, '英文在韩文模型里不算命中');
  assert.equal(scriptRatio('안녕하세요', 'korean'), 1);
  assert.equal(scriptRatio('안녕하세요', 'japan'), 0);
  assert.equal(scriptRatio('こんにちは世界', 'japan'), 1);
  assert.equal(scriptRatio('', 'ch'), 0, '空文本记 0');
});

test('languageScore 让英文字幕留在中国模型', () => {
  // 韩文模型读英文也很"自信"（0.995），但字形贴不上，加权后必须低于中文模型
  const korean = languageScore(0.995, 'Please click the link to fill in', 'korean');
  const chinese = languageScore(0.96, 'Please click the link to fill in', 'ch');
  assert.ok(chinese > korean, `中文 ${chinese.toFixed(3)} 应高于韩文 ${korean.toFixed(3)}`);

  // 反过来：日文在日文模型下应当赢过中文模型
  const jp = languageScore(0.99, 'こんにちは、世界。', 'japan');
  const cn = languageScore(0.99, '日本語の取', 'ch');
  assert.ok(jp > cn, `日文 ${jp.toFixed(3)} 应高于中文 ${cn.toFixed(3)}`);
});

test('LANG_ALIASES 覆盖设置页里的语言值', () => {
  // auto 由 chooseLang 提前拦截，落到别名表时按中英处理
  assert.equal(LANG_ALIASES.auto, 'ch');
  assert.equal(LANG_ALIASES.ch, 'ch');
  assert.equal(LANG_ALIASES.ja, 'japan');
  assert.equal(LANG_ALIASES.japan, 'japan');
  assert.equal(LANG_ALIASES.ko, 'korean');
  assert.equal(LANG_ALIASES.korean, 'korean');
});
