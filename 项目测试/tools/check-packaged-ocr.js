/**
 * 校验打包产物里的 ONNX 识别链路：模型目录解析 + onnxruntime-node 加载 + 真实识别。
 * 只读 dist 里的文件，不写任何用户目录；日志只输出长度与命中判定，不打印识别全文。
 *
 * 用法：node 项目测试/tools/check-packaged-ocr.js [dist目录]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const dist = process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'win-x64');
const appDir = path.join(dist, 'app', 'resources', 'app');
const coreIndex = path.join(appDir, 'src', 'core', 'ocr', 'index.js');

if (!fs.existsSync(coreIndex)) {
  console.error(`找不到 ${coreIndex}`);
  process.exit(2);
}

const { OcrService, rapidModelsDir } = require(coreIndex);

(async () => {
  const models = rapidModelsDir();
  console.log('模型目录:', models);
  const files = fs.existsSync(models) ? fs.readdirSync(models) : [];
  console.log('模型文件:', files.join(', ') || '(空)');

  const svc = new OcrService({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const probes = await svc.probeAll();
  console.log('探测:', Object.keys(probes).map((k) => `${k}=${!!probes[k].ok}`).join('  '));
  const picked = (await svc.pick()).name;
  console.log('选用引擎:', picked);

  const fixture = path.join(__dirname, '..', 'fixtures', 'zh-en-640x200.png');
  if (!fs.existsSync(fixture)) {
    console.log('（没有合成图，跳过识别）');
    return;
  }
  const t0 = Date.now();
  const r = await svc.recognize({ buffer: fs.readFileSync(fixture) });
  const text = String(r.text || '');
  console.log(`识别: engine=${r.engine} ms=${Date.now() - t0} chars=${text.length}`);
  console.log('命中「桌面翻译助手」:', text.includes('桌面翻译助手'));
  console.log('命中「Hello World」:', text.includes('Hello World'));
  const ok = text.includes('桌面翻译助手') && text.includes('Hello World');
  console.log(ok ? 'PASS 打包产物识别链路正常' : 'FAIL 打包产物识别结果不正确');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e && e.message);
  process.exit(1);
});
