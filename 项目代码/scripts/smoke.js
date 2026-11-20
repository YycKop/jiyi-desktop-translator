'use strict';
/**
 * 自检启动器（scripts/smoke.js）
 *
 * 为什么单独写一个而不是 `node scripts/launch.js --smoke-test`：
 * 本机的 Chromium/Electron 只有在 stdio 指向**文件**（而非管道/控制台）时才能稳定启动，
 * 若把 GUI 进程的 stdout 接进 PowerShell 管道会以 0x80000003 直接崩溃。
 * 因此自检统一把子进程输出写入 reports/electron-smoke/*.log 再回显末尾若干行。
 *
 * 退出码：0 = 自检通过；1 = 自检不通过；其它 = Electron 进程异常退出码。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const appDir = path.resolve(__dirname, '..');
const projectRoot = path.resolve(appDir, '..');
const reportDir = path.join(projectRoot, '项目测试', 'reports', 'electron-smoke');
const homeDir = path.join(projectRoot, '项目测试', '_runtime', 'home');
fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('[smoke] 未找到 electron，请先在 项目代码 目录安装依赖');
  process.exit(1);
}

const reportFile = path.join(reportDir, 'report.json');
try { fs.unlinkSync(reportFile); } catch { /* 首次运行没有旧报告 */ }

const outLog = path.join(reportDir, 'run.log');
const errLog = path.join(reportDir, 'run.err.log');
const outFd = fs.openSync(outLog, 'w');
const errFd = fs.openSync(errLog, 'w');

const args = [
  appDir,
  '--smoke-test',
  '--no-sandbox',
  '--disable-gpu',
  `--user-data-dir=${path.join(homeDir, 'electron-userdata')}`,
];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.TRANSLATOR_HOME = process.env.TRANSLATOR_HOME || homeDir;
env.DT_NO_SANDBOX = '1';
env.DT_DISABLE_GPU = '1';

console.log(`[smoke] 启动 ${electronPath}`);
const child = spawn(electronPath, args, { stdio: ['ignore', outFd, errFd], env, windowsHide: false });

child.on('error', (e) => {
  console.error('[smoke] 启动失败：' + e.message);
  process.exit(1);
});

child.on('exit', (code) => {
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  const tail = (file, n) => {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-n);
  };
  console.log('[smoke] exit=' + code);
  console.log('[smoke] ---- stdout(尾部) ----');
  tail(outLog, 12).forEach((l) => console.log('  ' + l));
  const errs = tail(errLog, 12);
  if (errs.length) {
    console.log('[smoke] ---- stderr(尾部) ----');
    errs.forEach((l) => console.log('  ' + l));
  }
  if (!fs.existsSync(reportFile)) {
    console.error('[smoke] 未生成 report.json（进程可能在启动阶段退出）');
    process.exit(code === 0 ? 1 : (code || 1));
  }
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const errCount = (report.rendererErrors || []).length;
  console.log(`[smoke] ok=${report.ok} 渲染错误=${errCount} 截图=${(report.shots || []).length} 托盘=${report.checks && report.checks.trayCreated}`);
  if (errCount) {
    for (const e of report.rendererErrors.slice(0, 10)) {
      console.log(`  - [${e.kind}] ${String(e.message).slice(0, 160)} @ ${e.source}:${e.line}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
});
