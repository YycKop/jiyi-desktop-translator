#!/usr/bin/env node
'use strict';

/**
 * 验证发布包在“另一台机器”上的行为（换一个目录、干净数据目录）。
 *   node 项目测试/tools/verify-release.js <releaseDir>
 * 做的事：启动发布包 → 等宿主桥就绪 → 用干净的配置走一次离线翻译 → 检查配置/模型/运行时路径 → 收尾
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const APP = process.argv[2] || 'D:\\桌面翻译助手\\项目测试\\_share_test\\桌面翻译助手';
const DATA = path.join(APP, 'userdata');
const BRIDGE = path.join(DATA, 'bridge.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) { console.log('[verify]', ...a); }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function killApp() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-Process -Name 'desktop-translator-core','桌面翻译助手' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*_share_test*' } | Stop-Process -Force",
    ], { stdio: 'ignore' });
  } catch { /* ignore */ }
}

async function main() {
  if (!fs.existsSync(path.join(APP, '桌面翻译助手.exe'))) {
    console.error('找不到发布包：', APP);
    process.exit(2);
  }
  killApp();
  for (const f of ['bridge.json', 'config.json']) {
    const p = path.join(DATA, f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  log('启动', path.join(APP, '桌面翻译助手.exe'));
  const child = spawn(path.join(APP, '桌面翻译助手.exe'), [], {
    cwd: APP, detached: true, stdio: 'ignore', windowsHide: false,
  });
  child.unref();

  log('等待宿主桥（最多 90 秒，首次要加载 1 GB 模型）…');
  const t0 = Date.now();
  let info = null;
  while (Date.now() - t0 < 90000) {
    await sleep(1000);
    info = readJson(BRIDGE);
    if (info && info.port && info.token) break;
  }
  if (!info) {
    console.error('宿主桥没有起来');
    process.exit(3);
  }
  log(`宿主桥就绪 port=${info.port}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  const cfg = readJson(path.join(DATA, 'config.json')) || {};
  log('首次运行配置：onboarded =', cfg.onboarded, '| apis =', (cfg.apis || []).length,
    '| secrets.items =', Object.keys((cfg.secrets || {}).items || {}).length);
  const status = await fetch(`http://127.0.0.1:${info.port}/v1/host/status`, {
    headers: { 'x-bridge-token': info.token },
  }).then((r) => r.json());
  log('status.llama =', JSON.stringify(status.llama));

  const text = process.argv[3] || 'Please click the link to fill in your details.';
  const t1 = Date.now();
  const res = await fetch(`http://127.0.0.1:${info.port}/v1/host/translate_text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': info.token },
    body: JSON.stringify({ text, targetLang: 'zh', sourceLang: 'en' }),
  }).then((r) => r.json());
  log(`翻译用时 ${Date.now() - t1} ms →`, JSON.stringify(res));

  log('收尾：停止发布包进程（模型内存较大）');
  killApp();
  await sleep(500);
  const cfgAfter = readJson(path.join(DATA, 'config.json')) || {};
  log('onboarded(收盘后) =', cfgAfter.onboarded);
  process.exit(res && res.ok ? 0 : 4);
}

main().catch((e) => { console.error(e); process.exit(1); });
