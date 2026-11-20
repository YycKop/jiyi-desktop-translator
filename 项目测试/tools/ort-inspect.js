'use strict';
/** 检查 ONNX 模型的输入/输出签名（用于确认预处理与解码参数）。 */
const path = require('path');
const ort = require('D:/桌面翻译助手/项目代码/node_modules/onnxruntime-node');

const dir = 'D:/桌面翻译助手/项目代码/runtime/ocr-rapid/models';

(async () => {
  for (const name of ['ch_PP-OCRv4_det_mobile.onnx', 'ch_PP-OCRv4_rec_mobile.onnx', 'ch_ppocr_mobile_v2.0_cls_mobile.onnx']) {
    // 注意：ORT 原生层对含中文的路径会报 "File doesn't exist"，因此统一传 Buffer。
    const buf = require('fs').readFileSync(path.join(dir, name));
    const s = await ort.InferenceSession.create(buf);
    console.log('=== ' + name);
    for (const i of s.inputNames) {
      const meta = s.inputMetadata ? s.inputMetadata[i] : null;
      console.log('  in :', i, meta ? JSON.stringify(meta) : '');
    }
    for (const o of s.outputNames) {
      const meta = s.outputMetadata ? s.outputMetadata[o] : null;
      console.log('  out:', o, meta ? JSON.stringify(meta) : '');
    }
  }
  const keys = require('fs').readFileSync(path.join(dir, 'ppocr_keys_v1.txt'), 'utf8').split(/\r?\n/);
  console.log('=== dict lines:', keys.length, 'last:', JSON.stringify(keys[keys.length - 1]), 'first:', JSON.stringify(keys[0]));
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
