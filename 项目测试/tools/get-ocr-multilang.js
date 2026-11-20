'use strict';
/**
 * 下载 PP-OCRv4 日语 / 韩语识别模型与字典（第二十一轮需求 5）。
 * 源：ModelScope RapidAI/RapidOCR（master）。resolve 接口会 302 到 CDN，需要跟跳转。
 * 用法：node 项目测试\tools\get-ocr-multilang.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DEST = path.resolve(__dirname, '..', '..', '项目代码', 'runtime', 'ocr-rapid', 'models');
const BASE = 'https://modelscope.cn/models/RapidAI/RapidOCR/resolve/master/';

const FILES = [
  ['onnx/PP-OCRv4/rec/japan_PP-OCRv4_rec_mobile.onnx', 'japan_PP-OCRv4_rec_mobile.onnx', 9000000],
  ['paddle/PP-OCRv4/rec/japan_PP-OCRv4_rec_mobile/japan_dict.txt', 'japan_dict.txt', 10000],
  ['onnx/PP-OCRv4/rec/korean_PP-OCRv4_rec_mobile.onnx', 'korean_PP-OCRv4_rec_mobile.onnx', 20000000],
  ['paddle/PP-OCRv4/rec/korean_PP-OCRv4_rec_mobile/korean_dict.txt', 'korean_dict.txt', 10000],
];

function fetchFollow(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) { reject(new Error('重定向过多')); return; }
        const next = new URL(res.headers.location, url).toString();
        fetchFollow(next, dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (code >= 400) { res.resume(); reject(new Error(`HTTP ${code}`)); return; }
      const fd = fs.openSync(dest, 'w');
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; fs.writeSync(fd, chunk); });
      res.on('end', () => { fs.closeSync(fd); resolve(bytes); });
      res.on('error', (e) => { try { fs.closeSync(fd); } catch { /* ignore */ } reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  for (const [remote, name, minBytes] of FILES) {
    const dest = path.join(DEST, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size >= minBytes) {
      console.log(`跳过 ${name}（已存在 ${fs.statSync(dest).size} B）`);
      continue;
    }
    const url = BASE + remote.split('/').map(encodeURIComponent).join('/');
    let size = 0;
    for (let i = 0; i < 4; i += 1) {
      try {
        size = await fetchFollow(url, dest);
        if (size >= minBytes) break;
        console.log(`  ${name} 只拿到 ${size} B，重试`);
      } catch (e) {
        console.log(`  ${name} 失败：${e.message}`);
      }
    }
    if (size < minBytes) {
      console.error(`${name} 下载不完整（${size} B < ${minBytes} B）`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${name}  ${size} B`);
  }
})();
