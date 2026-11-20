'use strict';
/**
 * 性能探针（scripts/perf-probe.js）
 *
 * 启动真实的 Electron 应用，跑一段定时翻译（默认 1 秒一轮、20 秒），
 * 采集 CPU 与内存峰值后退出。用于回归「CPU 占用过高 / 内存占用过高」这类问题：
 *   node scripts/perf-probe.js [秒数] [间隔ms]
 *
 * 与 smoke.js 的区别：smoke 验证功能是否正常，本脚本只测资源占用，不写截图。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
const seconds = String(Math.max(6, Math.min(120, Number(process.argv[2]) || 20)));
const interval = String(Math.max(200, Number(process.argv[3]) || 1000));

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('[perf] 未找到 electron，请先在 项目代码 目录安装依赖');
  process.exit(1);
}

const homeDir = path.join(WORKSPACE, 'tmp', `perf-home-${Date.now()}`);
fs.mkdirSync(homeDir, { recursive: true });
const outPath = path.join(homeDir, 'perf.out.log');
const errPath = path.join(homeDir, 'perf.err.log');
const outFd = fs.openSync(outPath, 'w');
const errFd = fs.openSync(errPath, 'w');

const args = [
  ROOT,
  `--perf-probe=${seconds}`,
  `--perf-probe-interval=${interval}`,
  '--no-sandbox',
  '--disable-gpu',
  `--user-data-dir=${path.join(homeDir, 'electron-userdata')}`,
];
// 可选：--region=x,y,w,h（挑一块静止区域，测出来的才是稳态开销）
const regionArg = process.argv.find((a) => a.startsWith('--region='));
if (regionArg) args.splice(2, 0, `--perf-probe-region=${regionArg.split('=')[1]}`);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.DT_DATA_DIR = homeDir;
env.TRANSLATOR_HOME = homeDir;

console.log(`[perf] 启动 ${electronPath}（${seconds}s / 每 ${interval}ms 一轮）`);
const child = spawn(electronPath, args, { stdio: ['ignore', outFd, errFd], env, windowsHide: false });

child.on('error', (e) => {
  console.error('[perf] 启动失败：' + e.message);
  process.exit(1);
});

child.on('exit', (code) => {
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  const stdout = fs.readFileSync(outPath, 'utf8');
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const perf = lines.find((l) => l.startsWith('[perf] '));
  const errorLog = fs.existsSync(path.join(homeDir, 'logs', 'core.log'))
    ? fs.readFileSync(path.join(homeDir, 'logs', 'core.log'), 'utf8') : '';
  console.log(`[perf] exit=${code}`);
  if (perf) {
    console.log(perf.replace('[perf] ', ''));
  } else {
    console.log('[perf] 未拿到结果，stdout 尾部：');
    console.log(lines.slice(-12).join('\n'));
    console.log('[perf] stderr 尾部：');
    console.log(fs.readFileSync(errPath, 'utf8').split(/\r?\n/).slice(-8).join('\n'));
  }
  const roundLines = errorLog.split(/\r?\n/).filter((l) => l.includes('OCR 完成') || l.includes('文本未变化'));
  console.log(`[perf] 日志里成功轮数=${roundLines.filter((l) => l.includes('OCR 完成')).length}，同文本复用=${roundLines.filter((l) => l.includes('文本未变化')).length}`);
  process.exit(code === 0 ? 0 : 1);
});
