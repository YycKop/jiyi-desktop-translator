'use strict';
// 临时探针：在当前桌面会话里试注册一批候选热键，输出可用者（用完即删）
const { app, globalShortcut } = require('electron');

const CANDIDATES = [
  'Control+Alt+P',
  'Control+Shift+Space',
  'Control+Alt+S',
  'Control+Alt+O',
  'Control+Alt+Z',
  'Control+Shift+F9',
  'Control+Alt+F10',
  'Control+Shift+P',
  'Control+Alt+T',
];

app.whenReady().then(() => {
  const rows = CANDIDATES.map((accel) => {
    let ok = false;
    try { ok = globalShortcut.register(accel, () => {}); } catch { ok = false; }
    return { accel, ok };
  });
  console.log('[probe] ' + JSON.stringify(rows));
  globalShortcut.unregisterAll();
  app.exit(0);
});
