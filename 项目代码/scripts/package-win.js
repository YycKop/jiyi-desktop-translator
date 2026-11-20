'use strict';
/**
 * 打包脚本（scripts/package-win.js）
 *
 * 目标：产出**免安装的可运行目录 + zip**，双击根目录的 `即译.exe` 即可启动。
 *
 * 为什么不直接产 .msi：安装包需要 electron-builder（新依赖，须先走限制书 CMD-02 的人工确认）；
 * 本脚本只用 Node 内置模块 + Windows 自带的 csc.exe（.NET Framework 4.8）+ PowerShell 压缩，零新依赖。
 *
 * 为什么外层要套一个 C# 启动器：
 *   部分 Windows 环境下 Chromium 初始化沙箱直接崩溃（退出码 0x80000003），用户表现就是
 *   「双击没反应」。而 `--no-sandbox` / `--disable-gpu` 这类降级开关必须是真实命令行参数
 *   （Electron 内部的 app.commandLine.appendSwitch 太晚，实测无效）。启动器负责首次正常启动、
 *   崩溃时自动以兼容参数重试一次，并把失败原因写进 userdata\launcher.log + 弹框提示。
 *
 * 产物结构：
 *   dist/win-x64/
 *     ├─ 即译.exe              （C# 启动器，双击入口）
 *     ├─ 使用说明.txt
 *     ├─ userdata/                    （首次启动后自动生成：配置/日志/密钥密文/Chromium profile）
 *     └─ app/
 *         ├─ jiyi-core.exe （electron.exe 改名）
 *         ├─ ...（Chromium 运行时文件）
 *         └─ resources/app/            （本项目源码，零第三方运行时依赖）
 *   dist/即译-<version>-win-x64.zip
 *
 * 用法：node scripts/package-win.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, '..', 'dist');
const OUT = path.join(DIST, 'win-x64');
const APP_DIR = path.join(OUT, 'app');
const APP_NAME = '即译';
const CORE_EXE = 'jiyi-core.exe';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** .NET Framework 自带的 C# 编译器（Windows 10/11 默认路径） */
const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 清理产物目录，但**保留 userdata/**（用户配置、日志、密钥密文都在里面）。
 * 打包是覆盖式更新，不能把用户数据一起删掉；同时用 maxRetries 扛住杀毒软件/句柄延迟释放。
 */
function cleanOutDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.toLowerCase() === 'userdata') {
      console.log('  保留 userdata/（用户配置与日志）');
      continue;
    }
    const target = path.join(dir, name);
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (e) {
      console.error(`无法删除 ${target}：${e.code || e.message}`);
      console.error('请先完全退出「即译」（含托盘图标），再重新执行打包。');
      process.exit(3);
    }
  }
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (filter && !filter(from, name)) continue;
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDir(from, to, filter);
    else fs.copyFileSync(from, to);
  }
}

/**
 * 打包 onnxruntime-node（ONNX 识别引擎的推理后端）。
 * pnpm 把依赖落成软链接，直接复制 node_modules/onnxruntime-node 会得到断链，
 * 所以从 .pnpm 里取真实目录，并按平台裁剪原生库（只留 Windows x64）。
 */
function copyOrtRuntime(appCodeDir) {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    console.warn('[warn] 未找到 node_modules/.pnpm，跳过 ONNX 运行时（识别引擎回退为系统 OCR）');
    return;
  }
  const pick = (prefix) => {
    const name = fs.readdirSync(pnpmDir).find((n) => n.startsWith(`${prefix}@`));
    if (!name) return null;
    const dir = path.join(pnpmDir, name, 'node_modules', prefix);
    return fs.existsSync(dir) ? dir : null;
  };
  const ortNode = pick('onnxruntime-node');
  const ortCommon = pick('onnxruntime-common');
  if (!ortNode) {
    console.warn('[warn] 未找到 onnxruntime-node，跳过 ONNX 运行时');
    return;
  }
  const destNodes = path.join(appCodeDir, 'node_modules');
  // 只保留 win32/x64 的原生库：其余平台合计约 180MB
  const binRoot = path.join(ortNode, 'bin');
  const abiDir = fs.existsSync(binRoot)
    ? fs.readdirSync(binRoot).find((d) => fs.existsSync(path.join(binRoot, d, 'win32', 'x64')))
    : null;
  const allowedBin = abiDir ? `bin/${abiDir}/win32/x64` : null;
  const keep = (from) => {
    const rel = path.relative(ortNode, from).split(path.sep).join('/');
    if (!rel.startsWith('bin/')) return true;
    if (!allowedBin) return false;
    return allowedBin.startsWith(rel) || rel.startsWith(`${allowedBin}/`);
  };
  console.log('复制 ONNX 运行时 node_modules/onnxruntime-node（仅 win32-x64）…');
  copyDir(ortNode, path.join(destNodes, 'onnxruntime-node'), keep);
  if (ortCommon) {
    copyDir(ortCommon, path.join(destNodes, 'onnxruntime-common'));
  } else {
    console.warn('[warn] 未找到 onnxruntime-common，ONNX 引擎可能无法加载');
  }
}

function findCsc() {
  for (const p of CSC_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

/** 编译 C# 启动器；失败时回退为「exe 直接放根目录」的旧结构，保证仍有产物 */
function buildLauncher() {
  const csc = findCsc();
  const src = path.join(ROOT, 'launcher', 'Launcher.cs');
  if (!csc || !fs.existsSync(src)) {
    console.warn('[warn] 未找到 csc.exe 或 launcher/Launcher.cs，跳过启动器（将直接使用 Electron 可执行文件）');
    return false;
  }
  const out = path.join(OUT, `${APP_NAME}.exe`);
  // 二次元图标：.ico 由 项目测试/tools/gen_icon_anime3.py 生成，任务栏/资源管理器都用它
  const ico = path.join(ROOT, 'assets', 'app.ico');
  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${out}`,
    '/r:System.Windows.Forms.dll',
    '/r:System.dll',
  ];
  if (fs.existsSync(ico)) args.push(`/win32icon:${ico}`);
  args.push(src);
  console.log('编译启动器…');
  const r = spawnSync(csc, args, { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    console.warn('[warn] 启动器编译失败：', (r.stderr || r.stdout || '').trim());
    return false;
  }
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  启动器 OK（${kb} KB）`);
  return true;
}

function main() {
  const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronDist)) {
    console.error('找不到 Electron 运行时，请先在 项目代码 目录安装依赖（pnpm add -D electron）');
    process.exit(2);
  }

  console.log(`清理 ${OUT}（保留 userdata/）`);
  cleanOutDir(OUT);
  fs.mkdirSync(APP_DIR, { recursive: true });

  console.log('复制 Electron 运行时到 app/ …');
  copyDir(electronDist, APP_DIR);

  // electron.exe → jiyi-core.exe（Chromium 依赖 exe 同目录资源，必须同目录改名）
  const exeSrc = path.join(APP_DIR, 'electron.exe');
  const exeCore = path.join(APP_DIR, CORE_EXE);
  if (fs.existsSync(exeSrc)) fs.renameSync(exeSrc, exeCore);
  else console.warn(`[warn] 未找到 ${exeSrc}`);

  console.log('复制应用源码…');
  const appCodeDir = path.join(APP_DIR, 'resources', 'app');
  fs.mkdirSync(appCodeDir, { recursive: true });
  for (const entry of ['src', 'assets', 'scripts', 'package.json', 'AGENTS.md', 'SECURITY_CONSTRAINTS.md', 'README.md']) {
    const from = path.join(ROOT, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(appCodeDir, entry);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }

  // 离线推理运行时（llama.cpp）：存在则一并打包；缺失不影响联网翻译
  const runtimeSrc = path.join(ROOT, 'runtime');
  if (fs.existsSync(runtimeSrc)) {
    console.log('复制离线推理运行时 runtime/ …');
    copyDir(runtimeSrc, path.join(APP_DIR, 'resources', 'runtime'));
  } else {
    console.log('未找到 项目代码/runtime（跳过离线运行时；联网翻译不受影响）');
  }

  copyOrtRuntime(appCodeDir);

  // 生产环境不需要 node_modules（核心逻辑零依赖），但 Electron 需要 package.json 的 main
  const prodPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    private: true,
  };
  fs.writeFileSync(path.join(appCodeDir, 'package.json'), `${JSON.stringify(prodPkg, null, 2)}\n`, 'utf8');

  const withLauncher = buildLauncher();
  if (!withLauncher) {
    // 回退：把核心 exe 复制到根目录，用户直接双击（兼容模式下需手动加参数）
    if (fs.existsSync(exeCore)) fs.copyFileSync(exeCore, path.join(OUT, `${APP_NAME}.exe`));
    // 没有启动器时，用 cmd 脚本兜底提供一个"兼容模式启动"入口
    fs.writeFileSync(path.join(OUT, '兼容模式启动.cmd'), [
      '@echo off',
      'cd /d "%~dp0app"',
      `start "" "${CORE_EXE}" --no-sandbox --disable-gpu --user-data-dir="%~dp0userdata\\electron-userdata"`,
      '',
    ].join('\r\n'), 'utf8');
  }

  console.log('写启动说明…');
  fs.writeFileSync(path.join(OUT, '使用说明.txt'), [
    `${APP_NAME} ${pkg.version}`,
    '',
    '1. 双击「' + APP_NAME + '.exe」启动，程序会驻留在系统托盘（右下角，可能被折叠在 ^ 里）。',
    '2. 首次启动会打开引导页：选择目标语言 → （可选）选择离线模型 → （可选）配置联网 API。',
    '3. 默认热键：Ctrl+Shift+T 框选翻译区域；Ctrl+Shift+R 立即重译上次区域。',
    '4. 打开设置有三种方式（任一可用）：',
    '     a) 点浮窗标题栏左起第一个按钮 ⚙；',
    '     b) 程序已在运行时，**再次双击「' + APP_NAME + '.exe」**，会直接打开设置窗口；',
    '     c) 右键托盘图标 →「设置」（图标可能被收进 ^ 溢出区，可拖到常显区域）。',
    '5. 也可以给「' + APP_NAME + '.exe」建一个带参数 --open-settings 的桌面快捷方式，双击即开设置。',
    '6. 离线翻译（可选）：程序自带 llama.cpp 运行时（app\\resources\\runtime\\llama\\llama-server.exe），',
    '   只需把 GGUF 模型放进 userdata\\models\\ 目录（文件名随意，扩展名 .gguf），',
    '   然后点 ⚙ →「离线模型」→「启动离线模型」；也可在该页手动选择模型文件与线程数。',
    '   没有模型时，断网状态下会在浮窗提示「离线模型未安装」。',
    '7. 一键暂停：浮窗标题栏 ▶/⏸ 按钮、Ctrl+Shift+P，或托盘菜单「暂停定时翻译」。',
    '',
    '说明：本目录为免安装版（portable），可整体移动到任意位置；删除目录即完全卸载。',
    '数据目录：本目录下的 userdata\\（配置、日志、密钥密文，不含明文 Key）。',
    '  - 若本目录不可写（例如放进 C:\\Program Files），会自动改用 %APPDATA%\\desktop-translator。',
    '  - 启动异常时查看 userdata\\launcher.log 与 userdata\\startup-error.log。',
    '',
    '打不开时怎么办：',
    '  - 双击后没有任何反应 → 稍等 3 秒；若仍无窗口，检查任务栏托盘图标（可能在 ^ 里）。',
    '  - 启动器会自动尝试兼容模式；若仍失败会弹出错误对话框，请把 userdata\\launcher.log 发给开发者。',
    '',
  ].join('\r\n'), 'utf8');

  console.log('压缩 zip…');
  const zipPath = path.join(DIST, `${APP_NAME}-${pkg.version}-win-x64.zip`);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  // 只打包运行所需内容：userdata/ 属于用户数据（配置、日志、1GB 级模型），不进压缩包
  const zipEntries = [
    path.join(OUT, `${APP_NAME}.exe`),
    path.join(OUT, 'app'),
    path.join(OUT, '使用说明.txt'),
  ].filter((p) => fs.existsSync(p));
  const ps = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Compress-Archive -Path ${zipEntries.map((p) => `'${p}'`).join(',')} -DestinationPath '${zipPath}' -Force`,
  ], { stdio: 'inherit' });
  if (ps.status !== 0) {
    console.warn('压缩失败（不影响目录产物），可手动压缩：', OUT);
  }

  console.log(`\n完成：${OUT}`);
  if (fs.existsSync(zipPath)) {
    const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    console.log(`压缩包：${zipPath}（${sizeMb} MB）`);
  }
}

main();
