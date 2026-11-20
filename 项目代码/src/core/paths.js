'use strict';
/**
 * 统一路径解析（core/paths.js）
 *
 * 目录约定：
 *  - 应用数据（配置、日志、模型）：用户数据目录，不写入代码目录
 *  - 调试截图临时文件：$PROJECT_ROOT/tmp/（FS-03），单次使用后立即删除
 *  - 性能实测记录：$PROJECT_ROOT/perf/（REV-001 N-02-R1）
 *
 * 数据目录解析顺序（resolveHome）：
 *  1. TRANSLATOR_HOME 环境变量（测试/开发隔离用）
 *  2. 便携模式：可执行文件同级 `userdata/`（免安装包默认，用户可整体拷贝迁移）
 *  3. %APPDATA%\desktop-translator（系统安装场景）
 *  4. 系统临时目录下的 desktop-translator（最后兜底，保证任何环境都能启动）
 *
 * 之所以做成「逐级探测可写」而不是硬编码 %APPDATA%：部分受限环境（企业策略、
 * 只读用户配置、沙箱）下 Chromium 无法在 %APPDATA% 建立 profile，会导致程序
 * 启动即退出且没有任何提示。逐级回退可保证「双击就能用」。
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const APP_DIR_NAME = 'desktop-translator';

/** 代码仓库根目录（D:\桌面翻译助手） */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * 程序所在根目录：
 *  - 已打包（存在 process.resourcesPath 且 app 已打包）：exe 所在目录
 *  - 开发态：代码仓库根目录
 */
function appRoot() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) return path.dirname(process.execPath);
  } catch { /* 非 Electron 环境（单元测试）走下面的分支 */ }
  return PROJECT_ROOT;
}

/**
 * 随包分发的运行时资源根目录（`runtime/llama`、`runtime/ocr-rapid` 所在的层级）：
 *  - 打包态：`app\resources`（package-win.js 把 runtime/ 复制到这里，与 `app\` 同级）
 *  - 开发态：`项目代码`（仓库里 runtime/ 就在这一层，而不是工作区根）
 * 曾经这里直接用 PROJECT_ROOT，导致「开发态与打包态各差一级」，llama-server 永远找不到。
 */
function resourceRoot() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged && process.resourcesPath) return process.resourcesPath;
  } catch { /* 非 Electron 环境走下面的分支 */ }
  return path.resolve(__dirname, '..', '..');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 探测目录是否真的可写（mkdir + 写探针 + 删除探针） */
function isWritable(dir) {
  try {
    ensureDir(dir);
    const probe = path.join(dir, `.w-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

let cachedHome = null;
let cachedSource = null;

/** 解析并缓存应用数据目录（附带命中的来源，便于日志与排查） */
function resolveHome() {
  if (cachedHome) return cachedHome;

  const custom = process.env.TRANSLATOR_HOME;
  if (custom && custom.trim()) {
    const dir = path.resolve(custom.trim());
    ensureDir(dir);
    cachedHome = dir;
    cachedSource = 'env:TRANSLATOR_HOME';
    return cachedHome;
  }

  // 启动器显式指定（打包产物的根目录 userdata\），优先于按 exe 位置推导
  const launcherDir = process.env.DT_DATA_DIR;
  if (launcherDir && launcherDir.trim()) {
    const dir = path.resolve(launcherDir.trim());
    if (isWritable(dir)) {
      cachedHome = dir;
      cachedSource = 'env:DT_DATA_DIR';
      return cachedHome;
    }
  }

  const candidates = [path.join(appRoot(), 'userdata')];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, APP_DIR_NAME));
  if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME));
  } else {
    candidates.push(path.join(os.homedir(), '.config', APP_DIR_NAME));
  }
  candidates.push(path.join(os.tmpdir(), APP_DIR_NAME));

  for (const dir of candidates) {
    if (isWritable(dir)) {
      cachedHome = dir;
      cachedSource = dir.startsWith(os.tmpdir()) ? 'fallback:tmp' : 'auto';
      return cachedHome;
    }
  }

  // 理论上到不了这里；仍然给出一个确定路径，让调用方的错误信息可读
  cachedHome = path.join(os.tmpdir(), APP_DIR_NAME);
  cachedSource = 'fallback:tmp-unverified';
  return cachedHome;
}

/** 命中来源（'env:TRANSLATOR_HOME' | 'auto' | 'fallback:tmp' …），用于启动日志 */
function homeSource() {
  resolveHome();
  return cachedSource;
}

/** 仅测试用：清空缓存，让下一次调用重新探测 */
function resetHomeCache() {
  cachedHome = null;
  cachedSource = null;
}

const paths = {
  APP_DIR_NAME,
  PROJECT_ROOT,
  appRoot,
  resourceRoot,
  ensureDir,
  isWritable,
  resolveHome,
  homeSource,
  resetHomeCache,
  home: () => resolveHome(),
  configFile: () => path.join(resolveHome(), 'config.json'),
  logsDir: () => path.join(resolveHome(), 'logs'),
  modelsDir: () => path.join(resolveHome(), 'models'),
  /** Electron/Chromium 的 profile 目录：与数据目录放在一起，保证可写 */
  userDataDir: () => path.join(resolveHome(), 'electron-userdata'),
  /** 启动失败的兜底记录（写不进日志系统时使用） */
  startupErrorFile: () => path.join(resolveHome(), 'startup-error.log'),
  /** FS-03：调试截图临时目录固定在项目内 */
  tmpDir: () => path.join(PROJECT_ROOT, 'tmp'),
  perfDir: () => path.join(PROJECT_ROOT, 'perf'),
  /** 宿主壳 ↔ DSH 插件的桥接描述文件（仅存放端口与一次性令牌，不含任何用户密钥） */
  bridgeFile: () => path.join(resolveHome(), 'bridge.json'),
  llmLogFile: () => path.join(resolveHome(), 'logs', 'llama-server.log'),
  ensure: {
    home: () => ensureDir(resolveHome()),
    logs: () => ensureDir(path.join(resolveHome(), 'logs')),
    models: () => ensureDir(path.join(resolveHome(), 'models')),
    tmp: () => ensureDir(path.join(PROJECT_ROOT, 'tmp')),
    perf: () => ensureDir(path.join(PROJECT_ROOT, 'perf')),
  },
};

module.exports = paths;
