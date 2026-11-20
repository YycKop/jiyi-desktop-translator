'use strict';
/* 托盘创建能力探针：判断 Shell_NotifyIcon 失败是环境限制还是图标问题。 */
const fs = require('fs');
const path = require('path');
const { app, Tray, nativeImage } = require('electron');

const LOG = path.join(__dirname, 'tray-probe.log');
function log(msg) { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`, 'utf8'); }

log(`start pid=${process.pid}`);
app.setAppUserModelId('com.desktop.translator');
log('setAppUserModelId done');
app.whenReady().then(() => {
  log('whenReady ok');
  const assets = 'D:\\桌面翻译助手\\项目代码\\assets';
  const files = ['tray.png', 'tray@2x.png', 'app.png'];
  for (const name of files) {
    const file = path.join(assets, name);
    try {
      const img = nativeImage.createFromPath(file);
      log(`${name} exists=${fs.existsSync(file)} empty=${img.isEmpty()} size=${JSON.stringify(img.getSize())}`);
      const resized = img.resize({ width: 16, height: 16 });
      log(`${name} resized empty=${resized.isEmpty()} size=${JSON.stringify(resized.getSize())}`);
      const t = new Tray(resized);
      t.setToolTip('probe');
      log(`${name} Tray CREATED ok`);
      setTimeout(() => { try { t.destroy(); } catch (e) { log('destroy err ' + e.message); } app.exit(0); }, 1500);
      return;
    } catch (e) {
      log(`${name} Tray FAILED: ${e && e.message}`);
    }
  }
  app.exit(7);
}).catch((e) => { log('whenReady err ' + e.message); app.exit(8); });
