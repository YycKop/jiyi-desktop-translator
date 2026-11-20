'use strict';
// 一次性诊断脚本：列出 ModelScope 仓库文件，并从 llama.cpp release 页面提取 Windows 资源名
const fs = require('fs');
const path = require('path');

const dir = __dirname;

function listModelScope(file) {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  const j = JSON.parse(raw);
  const files = (j.Data && j.Data.Files) || [];
  console.log('== ModelScope files:', files.length);
  for (const f of files) {
    const mb = (f.Size / 1048576).toFixed(1);
    console.log(`${String(mb).padStart(8)} MB  ${f.Path}  sha256=${(f.Sha256 || '').slice(0, 12)}`);
  }
}

function extractAssets(htmlFile) {
  const html = fs.readFileSync(path.join(dir, htmlFile), 'utf8');
  const names = new Set();
  const re = /\/ggml-org\/llama\.cpp\/releases\/download\/[^"']+\/([^"'/]+\.(?:zip|exe|tar\.gz))/g;
  let m;
  while ((m = re.exec(html))) names.add(decodeURIComponent(m[1]));
  const all = [...names].sort();
  console.log('== assets:', all.length);
  for (const n of all) {
    if (/win/i.test(n)) console.log('  WIN  ', n);
  }
  console.log('== (all, first 40)');
  for (const n of all.slice(0, 40)) console.log('  ', n);
}

const cmd = process.argv[2];
if (cmd === 'ms') listModelScope(process.argv[3]);
else if (cmd === 'assets') extractAssets(process.argv[3]);
else console.log('usage: ms <json> | assets <html>');
