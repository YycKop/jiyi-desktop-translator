'use strict';
/**
 * Electron 启动器（scripts/launch.js）
 *
 * 作用：不依赖 node_modules/.bin 的 shell 包装，直接解析 electron 可执行文件路径并转发参数，
 * 保证 Windows 下 `node scripts/launch.js [--dev|--smoke-test]` 一定能跑起来。
 */
const { spawn } = require('child_process');
const path = require('path');

let electronPath;
try {
  // electron 包的 main 导出即为可执行文件绝对路径
  electronPath = require('electron');
} catch (e) {
  console.error('[launch] 未找到 electron 依赖，请先在 项目代码 目录执行 pnpm install');
  process.exit(1);
}

const appDir = path.resolve(__dirname, '..');
const args = [appDir, ...process.argv.slice(2)];

// 关键：若父进程（如某些 IDE / 托管运行时）设置了 ELECTRON_RUN_AS_NODE，
// electron.exe 会退化成纯 Node，导致 require('electron').app 为 undefined。
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

// ---- 开发/测试专用数据目录（仅本启动器生效，打包后的 app 仍使用 %APPDATA%）----
// 由 DSH 等沙箱化运行时启动时，子进程对 C 盘没有写权限：Chromium 会把
// 用户数据目录建在 %APPDATA% 下并直接崩溃（fail-fast），因此开发态统一
// 把数据目录与 Chromium profile 指向项目测试目录。
const devHome = path.resolve(appDir, '..', '项目测试', '_runtime', 'home');
if (!env.TRANSLATOR_HOME) env.TRANSLATOR_HOME = devHome;
if (!args.some((a) => String(a).startsWith('--user-data-dir'))) {
  args.push(`--user-data-dir=${path.join(env.TRANSLATOR_HOME, 'electron-userdata')}`);
}
if (!env.DT_NO_SANDBOX) env.DT_NO_SANDBOX = '1';
if (!env.DT_DISABLE_GPU) env.DT_DISABLE_GPU = '1';

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code === null ? 1 : code);
});
child.on('error', (e) => {
  console.error('[launch] 启动失败：' + e.message);
  process.exit(1);
});
