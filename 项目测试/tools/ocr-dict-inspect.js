'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const CODE_ROOT = path.resolve(__dirname, '..', '..', '项目代码');
const req = createRequire(path.join(CODE_ROOT, 'package.json'));
const ort = req('onnxruntime-node');

const MODELS = path.join(CODE_ROOT, 'runtime', 'ocr-rapid', 'models');

(async () => {
  for (const [name, dict, model] of [
    ['ch', 'ppocr_keys_v1.txt', 'ch_PP-OCRv4_rec_mobile.onnx'],
    ['japan', 'japan_dict.txt', 'japan_PP-OCRv4_rec_mobile.onnx'],
    ['korean', 'korean_dict.txt', 'korean_PP-OCRv4_rec_mobile.onnx'],
  ]) {
    const raw = fs.readFileSync(path.join(MODELS, dict), 'utf8');
    const lines = raw.split(/\r?\n/);
    const nonEmpty = lines.filter((l) => l.length > 0);
    const session = await ort.InferenceSession.create(fs.readFileSync(path.join(MODELS, model)));
    const out = session.outputNames[0];
    console.log(name, 'dictLines', lines.length, 'nonEmpty', nonEmpty.length,
      'lastNotEmpty', JSON.stringify(nonEmpty[nonEmpty.length - 1]),
      'endsWithNewline', /\n$/.test(raw), 'output', out);
    // 输出类别数：喂一个 1x3x48x320 的空张量看输出 shape
    const t = new ort.Tensor('float32', new Float32Array(1 * 3 * 48 * 320), [1, 3, 48, 320]);
    const feeds = {};
    feeds[session.inputNames[0]] = t;
    const r = await session.run(feeds);
    console.log('  classes =', r[out].dims[2], ' dict+1 =', nonEmpty.length + 1, ' dict+2 =', nonEmpty.length + 2);
  }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
