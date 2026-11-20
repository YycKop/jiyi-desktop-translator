// 给自检增加托盘菜单项断言（第十二轮：右键只留 设置 / 输入翻译 / 退出）
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', '项目代码', 'src', 'main', 'main.js');
let s = fs.readFileSync(file, 'utf8');

const anchor = "  report.checks.trayCreated = !!(ctrl.tray && ctrl.tray.tray);";
const addition = anchor + `
  // 第十二轮：右键菜单必须只有 设置 / 输入翻译 / 退出 三项
  try {
    const menu = ctrl.tray && ctrl.tray.menu;
    report.checks.trayMenuItems = menu && Array.isArray(menu.items)
      ? menu.items.map((i) => String(i.label || '').replace(/…$/, '')).filter(Boolean)
      : [];
  } catch (e) {
    report.checks.trayMenuItems = [];
  }`;

if (!s.includes(anchor)) {
  console.log('MISS: trayCreated anchor');
  process.exit(1);
}
if (s.includes('trayMenuItems')) {
  console.log('SKIP: already patched');
  process.exit(0);
}
s = s.replace(anchor, addition);
fs.writeFileSync(file, s, 'utf8');
console.log('ok: trayMenuItems assertion added');
