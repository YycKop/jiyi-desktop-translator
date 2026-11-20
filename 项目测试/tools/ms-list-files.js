'use strict';
/**
 * 查询 ModelScope 仓库文件列表（用来定位 OCR 模型文件的真实路径）。
 * 用法：node 项目测试/tools/ms-list-files.js <owner/repo> [关键字]
 */
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'jiyi-check', Accept: 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  const repo = process.argv[2] || 'RapidAI/RapidOCR';
  const kw = (process.argv[3] || '').toLowerCase();
  const urls = [
    `https://modelscope.cn/api/v1/models/${repo}/repo/files?Revision=master&Recursive=true`,
    `https://modelscope.cn/api/v1/models/${repo}/repo/files?Revision=master`,
  ];
  for (const u of urls) {
    const r = await get(u);
    if (r.status !== 200) {
      console.log('HTTP', r.status, u);
      continue;
    }
    let j;
    try { j = JSON.parse(r.body); } catch { console.log('非 JSON:', r.body.slice(0, 120)); continue; }
    const list = (j.Data && (j.Data.Files || j.Data)) || [];
    const flat = Array.isArray(list) ? list : [];
    console.log(`共 ${flat.length} 项：`);
    for (const f of flat) {
      const p = f.Path || f.path || f.Name || '';
      const size = f.Size || f.size || 0;
      if (!kw || String(p).toLowerCase().includes(kw)) console.log(`  ${p}  ${size}`);
    }
    return;
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
