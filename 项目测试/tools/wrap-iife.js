'use strict';
/**
 * 一次性脚本：把渲染进程 app.js 包进 IIFE。
 *
 * 原因：contextBridge.exposeInMainWorld('api', ...) 在 window 上创建的是
 * 不可配置属性，而经典 <script> 中 `const api = window.api;` 属于全局词法声明，
 * 规范要求 HasRestrictedGlobalProperty 命中时抛 SyntaxError:
 * "Identifier 'api' has already been declared"，导致整页脚本不执行。
 * 包进 IIFE 后 api 变成函数作用域内的局部变量，与全局属性互不冲突。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '项目代码', 'src', 'renderer');
const targets = ['hud', 'overlay', 'ball', 'settings', 'onboarding'];

for (const name of targets) {
  const file = path.join(ROOT, name, 'app.js');
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('/* IIFE-WRAP */')) {
    console.log(`skip ${name}（已包裹）`);
    continue;
  }
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.trim() === "'use strict';");
  if (idx < 0) { console.log(`skip ${name}（未找到 use strict）`); continue; }
  // 在 'use strict'; 之后插入 IIFE 起始，函数体整体缩进保持不变（JS 不敏感）
  lines.splice(idx + 1, 0, '/* IIFE-WRAP: 避免与 contextBridge 暴露的不可配置全局 api 冲突 */', '(() => {');
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  out += '})();\n';
  fs.writeFileSync(file, out, 'utf8');
  console.log(`wrapped ${name}/app.js`);
}
