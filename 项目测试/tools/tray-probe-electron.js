'use strict';
/**
 * 托盘探针（第十三轮排查用）：确认「Shell 到底有没有接受我们的图标」。
 *
 * 只做四件事：建隐藏窗口 → 用 assets/app.ico 建 Tray → 3 秒后报告
 * getBounds / isDestroyed → 再 destroy 并报告。全程写 stdout，由外部脚本落文件读取。
 * 运行：electron.exe <此文件所在目录>（需要 package.json，或直接 electron tray-probe-electron.js）
 */
const path = require('path');
const { app, BrowserWindow, Tray, nativeImage } = require('electron');

const ASSETS = process.argv[2] || path.join(__dirname, '..', '..', 'assets');
const log = (msg, extra) => {
  console.log(`[probe] ${msg}` + (extra ? ' ' + JSON.stringify(extra) : ''));
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 120 });
  await win.loadURL('data:text/html,<h1>tray probe</h1>');

  const icoPath = path.join(ASSETS, 'app.ico');
  const pngPath = path.join(ASSETS, 'app-32.png');
  const fs = require('fs');
  log('assets', { ico: fs.existsSync(icoPath), png: fs.existsSync(pngPath) });

  const ico = nativeImage.createFromPath(icoPath);
  log('ico image', { empty: ico.isEmpty(), size: ico.getSize(), scaleFactors: ico.getScaleFactors() });
  const png = nativeImage.createFromPath(pngPath);
  log('png image', { empty: png.isEmpty(), size: png.getSize() });

  const tray = new Tray(ico.isEmpty() ? png : ico);
  tray.setToolTip('即译 · 托盘探针');
  tray.setContextMenu(require('electron').Menu.buildFromTemplate([
    { label: '探针菜单项' },
    { type: 'separator' },
    { label: '退出探针', click: () => app.exit(0) },
  ]));
  log('tray created', { bounds: tray.getBounds(), destroyed: tray.isDestroyed() });

  setTimeout(() => {
    log('after 1s', { bounds: tray.getBounds() });
  }, 1000);
  setTimeout(() => {
    log('after 3s', { bounds: tray.getBounds(), destroyed: tray.isDestroyed() });
  }, 3000);
  setTimeout(() => {
    tray.destroy();
    log('destroyed, exiting');
    setTimeout(() => app.exit(0), 400);
  }, 5000);
});

app.on('window-all-closed', () => { /* 保持运行直到定时退出 */ });
