// 自检里的托盘菜单断言改用 TrayController.menuLabels()
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', '项目代码', 'src', 'main', 'main.js');
let s = fs.readFileSync(file, 'utf8');

const oldBlock = `  // 第十二轮：右键菜单必须只有 设置 / 输入翻译 / 退出 三项
  try {
    const menu = ctrl.tray && ctrl.tray.menu;
    report.checks.trayMenuItems = menu && Array.isArray(menu.items)
      ? menu.items.map((i) => String(i.label || '').replace(/…$/, '')).filter(Boolean)
      : [];
  } catch (e) {
    report.checks.trayMenuItems = [];
  }`;

const newBlock = `  // 第十二轮：右键菜单必须只有 设置 / 输入翻译 / 退出 三项
  try {
    report.checks.trayMenuItems = ctrl.tray && typeof ctrl.tray.menuLabels === 'function'
      ? ctrl.tray.menuLabels()
      : [];
  } catch (e) {
    report.checks.trayMenuItems = [];
  }`;

if (!s.includes(oldBlock)) {
  console.log('MISS: trayMenuItems block');
  process.exit(1);
}
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(file, s, 'utf8');
console.log('ok: trayMenuItems uses menuLabels()');
