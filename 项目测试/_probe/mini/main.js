'use strict';
// 最小化 Electron 探针 v2：定位崩溃点（日志逐步落盘，崩溃前的最后一行即为崩溃位置）
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'probe2.log');
try { fs.unlinkSync(out); } catch { /* 首次不存在 */ }
const line = (s) => { try { fs.appendFileSync(out, s + '\n', 'utf8'); } catch { /* ignore */ } };

line('01 start');
const electron = require('electron');
line('02 require ok, has app=' + !!(electron && electron.app));
if (!electron.app) process.exit(8);

const { app, BrowserWindow, screen } = electron;
const useOffscreen = process.argv.includes('--offscreen');

try {
  app.disableHardwareAcceleration();
  line('03 hardware acceleration disabled');
} catch (e) { line('03 disableHardwareAcceleration failed: ' + e.message); }

app.on('window-all-closed', () => {});
process.on('uncaughtException', (e) => { line('!! uncaught: ' + e.message); });

line('04 registering whenReady');
app.whenReady().then(async () => {
  line('05 whenReady resolved');
  try {
    const displays = screen.getAllDisplays();
    line('06 displays=' + JSON.stringify(displays.map((d) => d.bounds)));
  } catch (e) { line('06 screen failed: ' + e.message); }

  line('07 creating BrowserWindow');
  let win;
  try {
    win = new BrowserWindow({
      width: 320, height: 200, show: false,
      webPreferences: { offscreen: useOffscreen, sandbox: false },
    });
    line('08 BrowserWindow created');
  } catch (e) {
    line('08 BrowserWindow failed: ' + e.message);
    app.exit(4);
    return;
  }

  win.webContents.on('did-finish-load', () => {
    line('10 did-finish-load');
    win.webContents.capturePage().then((img) => {
      fs.writeFileSync(path.join(__dirname, 'probe2.png'), img.toPNG());
      line('11 capture ok');
      app.exit(0);
    }).catch((e) => { line('11 capture fail: ' + e.message); app.exit(3); });
  });

  line('09 loading html');
  win.loadURL('data:text/html,<h1 style="font-family:sans-serif">probe2</h1>');
}).catch((e) => {
  line('05 whenReady failed: ' + e.message);
  process.exit(7);
});

setTimeout(() => { line('!! timeout 20s'); app.exit(9); }, 20000);
