'use strict';
/**
 * 测试总入口（项目测试/run-all.js）
 *
 * 用法：
 *   node run-all.js              # 跑单元 + 集成测试
 *   node run-all.js --only=unit  # 只跑单元测试
 *   node run-all.js --only=integration
 *
 * 说明：使用 Node 内置 test runner（node --test），不引入任何第三方测试框架，
 * 符合限制书 DSH-02「新依赖须人工确认」的要求。子进程继承 TRANSLATOR_HOME，
 * 保证测试数据只落在项目目录内（FS-01）。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const HOME = path.join(ROOT, '_runtime', 'home');
fs.mkdirSync(HOME, { recursive: true });

const arg = process.argv.find((a) => a.startsWith('--only='));
const only = arg ? arg.split('=')[1] : 'all';

/** 递归收集 *.test.js（按目录名排序，输出稳定） */
function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const groups = [];
if (only === 'all' || only === 'unit') groups.push({ name: '单元测试', files: collect(path.join(ROOT, 'unit')) });
if (only === 'all' || only === 'integration') groups.push({ name: '集成测试', files: collect(path.join(ROOT, 'integration')) });
// OCR 精度测试需要真实调用系统 OCR（约 4~5 秒），历史上单独跑容易漏，
// 这里并入默认全量：--only=ocr 可只跑它。
if (only === 'all' || only === 'ocr') {
  const ocrFile = path.join(ROOT, 'ocr-accuracy.test.js');
  groups.push({ name: 'OCR 精度（真实系统 OCR）', files: fs.existsSync(ocrFile) ? [ocrFile] : [] });
}

if (!groups.length) {
  console.error(`未知的 --only 值：${only}（可选 unit / integration / ocr / all）`);
  process.exit(2);
}

const env = {
  ...process.env,
  TRANSLATOR_HOME: HOME,
  // 单元测试不依赖真实 Electron，禁止误用
  NODE_ENV: 'test',
};

let failed = 0;
let total = 0;

for (const group of groups) {
  if (!group.files.length) continue;
  console.log(`\n=== ${group.name}（${group.files.length} 个文件）===`);
  const res = spawnSync(process.execPath, ['--test', ...group.files], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  total += group.files.length;
  if (res.status !== 0) failed += 1;
}

console.log(`\n=== 汇总 ===`);
console.log(`测试文件：${total}，失败分组：${failed}`);

// FS-03：测试期间 OCR 会在 $PROJECT_ROOT/tmp 写临时 PNG，收尾统一清理，避免残留截图
const tmpDir = path.join(ROOT, '..', 'tmp');
let cleaned = 0;
try {
  if (fs.existsSync(tmpDir)) {
    for (const name of fs.readdirSync(tmpDir)) {
      if (!/^ocr-.*\.png$/i.test(name)) continue;
      fs.unlinkSync(path.join(tmpDir, name));
      cleaned += 1;
    }
  }
} catch (e) {
  console.warn(`清理临时截图失败：${e.message}`);
}
if (cleaned) console.log(`已清理临时截图：${cleaned} 个（tmp/）`);

if (failed) {
  console.error('测试未全部通过');
  process.exit(1);
}
console.log('全部通过');
