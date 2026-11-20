const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'jiyi-check' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}
(async () => {
  for (const name of ['onnxruntime-node', 'rapidocr', 'onnxruntime-web', 'tesseract.js']) {
    const r = await get(`https://registry.npmmirror.com/${name}`);
    if (r.status !== 200) { console.log(name, 'HTTP', r.status); continue; }
    const j = JSON.parse(r.body);
    const latest = j['dist-tags'] && j['dist-tags'].latest;
    const info = (j.versions && j.versions[latest]) || {};
    const t = j.time && j.time[latest];
    const keys = Object.keys(j.versions || {}).length;
    console.log(`${name}\tlatest=${latest}\tversions=${keys}\tpublished=${t}\tdesc=${(info.description || '').slice(0, 60)}\tlicense=${info.license}`);
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
