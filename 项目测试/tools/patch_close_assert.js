// 更新自检断言：
// 1) 设置窗口关闭后应该是「隐藏到后台」（不是最小化），任务栏按钮随之消失；
// 2) 自检报告里打印托盘菜单项。
const fs = require('fs');
const path = require('path');

const code = path.join(__dirname, '..', '..', '项目代码');
const mainFile = path.join(code, 'src', 'main', 'main.js');
let s = fs.readFileSync(mainFile, 'utf8');

const oldBlock = `  // 2d) 关设置窗口只最小化到任务栏（第十一轮需求 2：后台入口不能消失）
  try {
    settings.close();
    await sleep(400);
    const s2 = ctrl.wm.wins.settings;
    report.checks.settingsCloseMinimizes = !!(s2 && !s2.isDestroyed() && s2.isMinimized());
    if (s2 && !s2.isDestroyed()) {
      s2.restore();
      s2.show();
    }
    await sleep(300);
  } catch (e) {
    rendererErrors.push({ kind: 'settings-close', message: String(e && e.message) });
    report.checks.settingsCloseMinimizes = false;
  }`;

const newBlock = `  // 2d) 关设置窗口 → 隐藏到后台（第十二轮需求：关掉后任务栏按钮消失，但进程不退出）
  try {
    settings.close();
    await sleep(400);
    const s2 = ctrl.wm.wins.settings;
    report.checks.settingsCloseHides = !!(s2 && !s2.isDestroyed() && !s2.isVisible());
    if (s2 && !s2.isDestroyed()) {
      s2.show();
    }
    await sleep(300);
  } catch (e) {
    rendererErrors.push({ kind: 'settings-close', message: String(e && e.message) });
    report.checks.settingsCloseHides = false;
  }`;

if (!s.includes(oldBlock)) {
  console.log('MISS: settings close block');
  process.exit(1);
}
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(mainFile, s, 'utf8');
console.log('ok: settings close assertion -> settingsCloseHides');

// 报告打印脚本：补托盘菜单项
const chk = path.join(__dirname, 'check-smoke-report.js');
let c = fs.readFileSync(chk, 'utf8');
if (!c.includes('trayMenuItems')) {
  c = c.replace(
    "'hudReadableApplied'",
    "'hudReadableApplied', 'settingsCloseHides', 'trayMenuItems'"
  );
  fs.writeFileSync(chk, c, 'utf8');
  console.log('ok: check-smoke-report keys updated');
} else {
  console.log('SKIP: check-smoke-report already ok');
}
