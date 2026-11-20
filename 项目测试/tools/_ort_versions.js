const https = require('https');
https.get('https://registry.npmmirror.com/onnxruntime-node', { headers: { 'User-Agent': 'x' } }, (res) => {
  let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => {
    const j = JSON.parse(d);
    const pick = ['1.19.2', '1.20.0', '1.20.1', '1.21.0', '1.22.0', '1.23.0', '1.24.0', '1.31.0'];
    for (const v of pick) {
      if (j.time && j.time[v]) console.log(v, j.time[v], 'tarball-size-hint:', (j.versions[v].dist && j.versions[v].dist.unpackedSize) || '?');
    }
  });
}).on('error', (e) => console.error('ERR', e.message));
