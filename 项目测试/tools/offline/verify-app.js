'use strict';
/**
 * 端到端验证：通过宿主桥让正在运行的应用做一次「离线翻译」。
 * 用法：node _dl/verify-app.js <bridge.json> [text] [targetLang]
 */
const fs = require('fs');
const http = require('http');

const [bridgeFile, text = 'Press Save to continue. Please click the link to fill in your details.', targetLang = 'zh'] =
  process.argv.slice(2);

if (!bridgeFile || !fs.existsSync(bridgeFile)) {
  console.error('bridge.json not found:', bridgeFile);
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));

function post(path, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'x-bridge-token': info.token,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { /* ignore */ }
          resolve({ status: res.statusCode, raw, parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('bridge port:', info.port, '| api:', info.api);
  const t0 = Date.now();
  const r = await post('/v1/host/translate_text', { text, targetLang, sourceLang: 'auto' });
  const ms = Date.now() - t0;
  console.log('status:', r.status, '| elapsed ms:', ms);
  console.log('body:', JSON.stringify(r.parsed, null, 2));
  if (!r.parsed || !r.parsed.ok) process.exit(2);
})();
