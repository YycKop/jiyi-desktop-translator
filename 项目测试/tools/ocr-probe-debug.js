'use strict';
/**
 * 直接调用 OCR 探针，复现「OCR 引擎不可用」。
 * 用法：node 项目测试/tools/ocr-probe-debug.js
 */

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.env.TRANSLATOR_HOME = path.join(ROOT, '项目测试', '_runtime', 'probe-debug');
require('fs').mkdirSync(process.env.TRANSLATOR_HOME, { recursive: true });

const winrt = require(path.join(ROOT, '项目代码', 'src', 'core', 'ocr', 'winrt.js'));

(async () => {
  try {
    const r = await winrt.probe();
    console.log('probe ok:', JSON.stringify(r));
  } catch (e) {
    console.log('probe FAILED:', e.code || '', e.message, JSON.stringify(e.details || {}));
  }
})();
