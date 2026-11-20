'use strict';
/**
 * 一次性配置脚本：把离线模型接入便携版数据目录的 config.json
 * 用法：node _dl/patch-offline-config.js <configFile> <serverExe> <gguf>
 */
const fs = require('fs');
const path = require('path');

const [cfgFile, serverExe, gguf] = process.argv.slice(2);
if (!cfgFile || !serverExe || !gguf) {
  console.error('usage: node patch-offline-config.js <config.json> <llama-server.exe> <model.gguf>');
  process.exit(1);
}

if (!fs.existsSync(serverExe)) { console.error('server not found:', serverExe); process.exit(1); }
if (!fs.existsSync(gguf)) { console.error('model not found:', gguf); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
raw.offline = {
  ...(raw.offline || {}),
  serverPath: path.resolve(serverExe),
  modelPath: path.resolve(gguf),
  host: '127.0.0.1',
  port: 8081,
  contextSize: 4096,
  threads: 6,
  gpuLayers: 0,
  autostart: true,
  corsOrigins: 'localhost',
  modelName: 'hy-mt',
  timeoutMs: 20000,
};

// 目标语言确定为中文（与首次引导默认一致）
raw.general = { ...(raw.general || {}), targetLang: 'zh', sourceLang: 'auto' };
raw.capture = { ...(raw.capture || {}), mode: 'manual', intervalMs: 2000 };

fs.writeFileSync(cfgFile + '.bak', JSON.stringify(raw, null, 2), 'utf8');
fs.writeFileSync(cfgFile, JSON.stringify(raw, null, 2), 'utf8');
console.log('patched:', cfgFile);
console.log('  offline.serverPath =', raw.offline.serverPath);
console.log('  offline.modelPath  =', raw.offline.modelPath, `(${(fs.statSync(gguf).size / 1048576).toFixed(1)} MB)`);
console.log('  offline.threads    =', raw.offline.threads, '| contextSize:', raw.offline.contextSize, '| autostart:', raw.offline.autostart);
