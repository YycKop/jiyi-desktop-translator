#!/usr/bin/env node
'use strict';

/**
 * 生成「可以直接发给别人」的发布包（分发版）。
 *
 * 与 package-win.js 的区别：
 *   package-win.js  构建本地便携版 dist/win-x64（含 userdata：本机配置、日志、模型、Chromium 配置）
 *   package-release 从便携版里**剥掉本机数据**，补上许可与说明文件，可选把离线模型一起打进去
 *
 * 用法：
 *   node scripts/package-release.js                 # 带离线模型，压缩成 zip
 *   node scripts/package-release.js --no-model      # 不带模型（体积小，接收方需联网 API）
 *   node scripts/package-release.js --no-zip        # 只生成目录
 *   node scripts/package-release.js --out=D:\xxx    # 自定义输出目录
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, '..', 'dist'); // 与 package-win.js 一致：工作区根下的 dist
const SRC = path.join(DIST, 'win-x64');
const VERSION = require(path.join(ROOT, 'package.json')).version;

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const withModel = !hasFlag('no-model');
const withZip = !hasFlag('no-zip');
const OUT = path.resolve(argOf('out', path.join(DIST, 'release')));
const FOLDER = `即译-${VERSION}-portable`;
const DEST = path.join(OUT, FOLDER);
const ZIP = path.join(DIST, `即译-${VERSION}-portable-win-x64${withModel ? '' : '-nomodel'}.zip`);

const MODEL_NAME = 'HY-MT1.5-1.8B-Q4_K_M.gguf';
const MODEL_SHA256 = '4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7';

// 只复制这些内容：运行必需，且不含本机数据
const ROOT_FILES = ['即译.exe', '使用说明.txt'];
const EXCLUDE_DIRS = new Set(['userdata']);

function log(...args) {
  console.log('[release]', ...args);
}

function copyTree(from, to, opts = {}) {
  const { skip = () => false } = opts;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (skip(src, entry.name, entry)) continue;
    if (entry.isDirectory()) copyTree(src, dst, opts);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function humanSize(bytes) {
  const mb = bytes / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

/** 腾讯 HY 许可要求的分发义务 */
function writeNotices() {
  // 3.d：必须随附含指定文字的 Notice 文件（原文照抄）
  writeText(path.join(DEST, 'NOTICE.txt'), [
    'Tencent HY is licensed under the Tencent HY Community License Agreement,',
    'Copyright © 2025 Tencent. All Rights Reserved.',
    'The trademark rights of "Tencent HY" are owned by Tencent or its affiliate.',
    '',
    '本软件内置的离线翻译模型（HY-MT1.5-1.8B，Q4_K_M GGUF）以上述许可分发。',
    '完整许可文本见同目录 licenses\\Tencent-HY-Community-License.txt。',
    '该模型文件由本项目原样分发，未做任何修改（来源：ModelScope Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF）。',
    '',
    '本软件与腾讯及其关联公司不存在任何关联、合作、赞助或背书关系；',
    '"Tencent HY" 商标归腾讯或其关联公司所有，本项目仅作事实性说明使用。',
    '',
    '本软件的分发者：______________________（请填写你的名字或组织）',
    '',
  ].join('\r\n'));

  writeText(path.join(DEST, 'licenses', '第三方组件与许可.txt'), [
    '第三方组件与许可（即译 ' + VERSION + '）',
    '================================================================',
    '',
    '1) 即译（本项目）：自研代码，无第三方运行时依赖（electron 仅构建期使用）。',
    '',
    '2) Electron ' + require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version
      + ' — MIT。完整文本见 app\\LICENSE。',
    '',
    '3) Chromium（Electron 内置）— BSD 3-Clause 及若干第三方许可。',
    '   完整清单见 app\\LICENSES.chromium.html（约 9 MB）。',
    '',
    '4) Node.js（Electron 内置运行时）— MIT。',
    '',
    '5) llama.cpp b12000 — MIT，Copyright (c) 2023-2024 The ggml authors。',
    '   完整文本见 licenses\\llama.cpp-LICENSE.txt。',
    '   二进制来源：github.com/ggml-org/llama.cpp/releases/tag/b12000（win-cpu-x64）。',
    '',
    '6) LLVM OpenMP runtime — Apache License 2.0 WITH LLVM-exception。',
    '   完整文本见 app\\resources\\runtime\\llama\\LICENSE-LLVM-OpenMP。',
    '',
    '7) HY-MT1.5-1.8B（GGUF 量化模型）— Tencent HY Community License Agreement。',
    '   完整文本见 licenses\\Tencent-HY-Community-License.txt，必需 Notice 见 NOTICE.txt。',
    '   关键义务（摘要，不构成法律意见）：',
    '     · 随附许可副本与 Notice 文件（本包已包含）；',
    '     · 不得暗示腾讯对本软件存在关联、赞助或背书；',
    '     · 仅在 Territory 内使用与分发 —— Territory 为全球范围，但**不含欧盟、英国、韩国**；',
    '     · 若月活用户超过 1 亿，需另行向腾讯申请许可；',
    '     · 不得用本模型的输出训练/改进其它 AI 模型。',
    '   模型文件：' + MODEL_NAME + '（' + humanSize(1133080512) + '），sha256 ' + MODEL_SHA256,
    '   本项目原样分发该文件，未做修改。',
    '',
    '8) 系统 API：Windows.Media.Ocr、Windows.Graphics.Capture、GDI+ —— 随 Windows 提供，不随本包分发。',
    '',
    '9) PP-OCRv4 识别模型（ch / japan / korean，PaddleOCR 官方发布）— Apache License 2.0。',
    '   来源：modelscope.cn/models/RapidAI/RapidOCR（PP-OCRv4 mobile det/rec + 日/韩 rec + 字典）。',
    '   许可全文：https://www.apache.org/licenses/LICENSE-2.0（本项目原样分发这些 onnx 与字典，未做修改）。',
    '',
    '10) onnxruntime-node 1.22.0（含 onnxruntime-common）— MIT，Microsoft。',
    '   只随包提供 win32-x64 原生二进制；许可全文：https://github.com/microsoft/onnxruntime/blob/main/LICENSE。',
    '',
  ].join('\r\n'));

  writeText(path.join(DEST, '首次使用说明.txt'), [
    '即译 ' + VERSION + '（免安装版）',
    '================================================================',
    '',
    '一、运行条件',
    '  · Windows 10 64 位（1809 及以上）或 Windows 11',
    '  · 内存 8 GB 以上（离线模型常驻约 2.2 GB，8 GB 机器建议关掉其它大程序）',
    '  · 磁盘：本目录约 ' + (withModel ? '1.4 GB' : '310 MB') + '（模型 ' + (withModel ? '已内置 1.08 GB' : '未内置') + '）',
    '  · 无需安装、无需管理员权限、不写注册表',
    '',
    '二、启动',
    '  1. 双击本目录下的「即译.exe」。',
    '  2. 首次启动会弹出「欢迎使用即译」引导：选目标语言 → 下一步 → 完成。',
    '  3. 若 Windows 弹出「已保护你的电脑」蓝色窗口：点「更多信息」→「仍要运行」。',
    '     （本程序未购买代码签名证书，SmartScreen 会对所有未签名程序这样提示，属正常现象。）',
    '  4. 启动后主界面是一个小浮窗（可能出现在屏幕右上角）；任务栏右下角 ^ 里是托盘图标。',
    '     看不到浮窗时：再双击一次「即译.exe」，会把设置窗口叫到前台。',
    '',
    '三、使用',
    '  · 框选翻译：Ctrl + Shift + T，拖一个矩形，松手即出现译文浮窗',
    '  · 重译当前区域：Ctrl + Shift + R      暂停/继续定时翻译：Ctrl + Shift + P（或浮窗 ⏸ 按钮、Esc）',
    '  · 隐藏/显示浮窗：Ctrl + Shift + Y      收起为悬浮球：Ctrl + Shift + U（点球展开）',
    '  · 设置：浮窗标题栏的 ⚙ 按钮，或托盘菜单「设置」',
    '  · 引擎标识显示在浮窗右下角：显示你的 API 名称表示联网翻译，显示「离线模式」表示本机模型翻译',
    '',
    '四、离线翻译（' + (withModel ? '本包已内置模型，开箱即用' : '本包未内置模型') + '）',
    withModel
      ? '  · 模型位于 app\\resources\\models\\' + MODEL_NAME + '，启动时自动加载（1~4 秒）。'
      : '  · 想用离线翻译：把 .gguf 模型放进 userdata\\models\\，或在设置页「离线模型」里选择文件。',
    '  · 想换成更省内存的 2-bit 模型：把新的 .gguf 放进 userdata\\models\\（数据目录优先于内置模型）。',
    '',
    '五、联网翻译（可选，可与离线混用）',
    '  · 设置 →「API 接口」→「添加接口」→ 选预设（DeepSeek/OpenAI/Claude/Gemini）→ 填 API Key → 验证并添加。',
    '  · 接口按顺序尝试，全部失败或超时才降级到离线模型；Key 以 AES-256-GCM 加密后保存在本机，界面只显示掩码。',
    '',
    '六、数据与卸载',
    '  · 所有配置、日志、密钥密文、模型都在本目录的 userdata\\ 下，不写系统目录。',
    '  · 卸载 = 直接删除整个文件夹（想保留配置就只删 app\\ 与 exe）。',
    '  · 出问题先看 userdata\\core.log、userdata\\launcher.log、userdata\\startup-error.log。',
    '',
    '七、许可',
    '  · 内置离线模型受 Tencent HY Community License 约束，使用/再分发前请阅读 NOTICE.txt 与 licenses\\ 目录。',
    '  · 不得将本软件分发到欧盟、英国、韩国地区。',
    '',
  ].join('\r\n'));
}

function main() {
  if (!fs.existsSync(path.join(SRC, '即译.exe'))) {
    console.error(`[release] 找不到 ${SRC}\\即译.exe，请先运行 node scripts/package-win.js`);
    process.exit(2);
  }

  log(`清理输出：${DEST}`);
  if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  fs.mkdirSync(DEST, { recursive: true });

  log('复制运行时（排除 userdata / 临时目录）');
  copyTree(SRC, DEST, {
    skip: (src, name, entry) => {
      if (entry.isDirectory() && EXCLUDE_DIRS.has(name)) return true;
      if (name === 'tmp' && path.basename(path.dirname(src)) === 'resources') return true;
      if (entry.isFile() && /\.(log|bak|flag)$/i.test(name) && !name.includes('LICENSE')) return true;
      return false;
    },
  });
  for (const f of ROOT_FILES) {
    if (!fs.existsSync(path.join(DEST, f))) log(`警告：缺少 ${f}`);
  }

  // 干净的 userdata：不预置任何配置，首次运行走欢迎引导
  fs.mkdirSync(path.join(DEST, 'userdata', 'models'), { recursive: true });

  if (withModel) {
    const model = path.join(SRC, 'userdata', 'models', MODEL_NAME);
    const alt = path.join(SRC, 'userdata', 'models');
    const anyGguf = fs.existsSync(model)
      ? model
      : (fs.existsSync(alt) ? (fs.readdirSync(alt).find((f) => f.toLowerCase().endsWith('.gguf')) || '') : '');
    if (!anyGguf) {
      console.error(`[release] 未找到模型（${MODEL_NAME}），可加 --no-model 生成轻量包`);
      process.exit(3);
    }
    const target = path.join(DEST, 'app', 'resources', 'models', path.basename(anyGguf));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    log(`内置模型：${path.basename(anyGguf)}（${humanSize(fs.statSync(anyGguf).size)}）`);
    fs.copyFileSync(anyGguf, target);
  }

  log('复制许可文件');
  fs.mkdirSync(path.join(DEST, 'licenses'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'licenses'))) {
    fs.copyFileSync(path.join(ROOT, 'licenses', f), path.join(DEST, 'licenses', f));
  }
  writeNotices();

  const size = dirSize(DEST);
  log(`目录完成：${DEST}（${humanSize(size)}）`);

  if (!withZip) return;
  log('压缩 zip（1 GB 级模型用 Fastest 级，仍需要几分钟）');
  const t0 = Date.now();
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'zip-dir.ps1'),
    '-Src', DEST, '-Dest', ZIP,
  ], { stdio: 'inherit' });
  log(`zip 完成：${ZIP}（${humanSize(fs.statSync(ZIP).size)}，${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  log('提示：把 zip 或整个文件夹发给对方即可；对方解压后双击「即译.exe」。');
}

main();
