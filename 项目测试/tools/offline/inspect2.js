'use strict';
// 读取 llama.cpp release JSON，打印 Windows 资产；并读取 ModelScope 搜索结果
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const mode = process.argv[2];

if (mode === 'release') {
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'llama-release.json'), 'utf8'));
  console.log('tag:', j.tag_name, '| published:', j.published_at);
  const win = (j.assets || []).filter((a) => /win/i.test(a.name));
  for (const a of win) {
    console.log(`${(a.size / 1048576).toFixed(0).padStart(5)} MB  ${a.name}\n         ${a.browser_download_url}`);
  }
} else if (mode === 'search') {
  const raw = fs.readFileSync(path.join(dir, process.argv[3]), 'utf8');
  const j = JSON.parse(raw);
  const data = j.Data || j.data || {};
  const models = data.Models || data.models || (Array.isArray(data) ? data : []);
  console.log('models:', models.length);
  for (const m of models) {
    console.log(`  ${m.Path || m.path || m.Name || m.name}  ★${m.Stars || m.stars || 0}`);
  }
} else {
  console.log('usage: node inspect2.js release | search <file>');
}
