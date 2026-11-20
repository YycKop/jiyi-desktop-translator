'use strict';
/** 临时开关配置文件里的联网 API（用于验证离线分支）：node _dl/toggle-apis.js <config.json> on|off */
const fs = require('fs');
const [file, mode] = process.argv.slice(2);
if (!file || !['on', 'off'].includes(mode)) {
  console.error('usage: node toggle-apis.js <config.json> on|off');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.apis = (cfg.apis || []).map((a) => ({ ...a, enabled: mode === 'on' }));
fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
console.log(`apis=${cfg.apis.length} enabled=${mode === 'on'}`);
for (const a of cfg.apis) console.log(`  - ${a.name} | ${a.model} | enabled=${a.enabled}`);
