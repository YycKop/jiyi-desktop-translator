// 只做视觉核对：把设置页标题栏按浅色主题渲染并截图（不启动完整应用、不读写用户配置）。
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'src', 'renderer', 'settings', 'index.html');
const OUT = path.resolve(ROOT, '..', '项目测试', 'reports', 'arttext', 'titlebar-light.png');

const LIGHT_VARS = {
  '--bg': '#f7f8fa',
  '--bg-elevated': '#ffffff',
  '--bg-elevated-veil': '#ffffff',
  '--bg-hover': '#eef1f6',
  '--fg': '#1f2430',
  '--fg-dim': '#5b6577',
  '--fg-faint': '#8b95a6',
  '--border': '#e2e6ee',
  '--accent': '#4c8dff'
};

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 720,
    height: 120,
    frame: false,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(PAGE);
  await win.webContents.executeJavaScript(
    `(() => {
       const root = document.documentElement;
       const vars = ${JSON.stringify(LIGHT_VARS)};
       for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
       root.dataset.theme = 'light';
       const bg = document.getElementById('bg-layer');
       if (bg) bg.hidden = true;
       document.body.style.background = '#f7f8fa';
       return true;
     })()`
  );
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 720, height: 48 });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('saved', OUT);
  win.destroy();
  app.quit();
});
