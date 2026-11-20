// 在 AGENTS.md 第 6 节末尾追加「第十二轮」陷阱块（行级 splice，避免 here-string 转义事故）
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', '项目代码', 'AGENTS.md');
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

if (lines.some((l) => l.includes('第十二轮（改名'))) {
  console.log('SKIP: already patched');
  process.exit(0);
}

const anchorIdx = lines.findIndex((l) => l.startsWith('## 7. '));
if (anchorIdx < 0) {
  console.log('MISS: heading ## 7.');
  process.exit(1);
}

const block = [
  '',
  '### 第十二轮（改名「即译」· 二次元图标 · 后台驻留 · 输入入口）',
  '',
  '- **改名只改显示层**：`app.setName` / 窗口标题 / `package.json` 的 `name`+`productName` / exe 名（`即译.exe`）都可以改，',
  '  但 `src/core/paths.js` 的 `APP_DIR_NAME = "desktop-translator"`、`host/bridge.js` 的服务名、',
  '  `security/secrets.js` 的 scrypt 盐串 `desktop-translator-v1` **一律不动**——它们属于数据目录与密钥派生，',
  '  改了等于让老用户丢掉全部配置与 API Key。',
  '- **图标白边是缩放顺序问题**：先 `putalpha` 再 `LANCZOS` 缩放，会让透明区（白）的 RGB 参与插值，边缘出现一圈白线。',
  '  正确顺序是**先缩放到目标尺寸、再套圆角蒙版**（蒙版在 4 倍画布绘制后缩小，抗锯齿更干净），并把裁切内缩 1.2%，',
  '  顺带裁掉源图自带的浅色描边（生成器 `项目测试/tools/gen_icon_jiyi.py`）。',
  '- **关窗口 != 退出**：设置窗口的 `close` 必须 `preventDefault()` + `hide()` + `setSkipTaskbar(true)`；',
  '  直接销毁会让用户同时失去浮窗（`skipTaskbar`）与托盘（部分环境注册不上）两个入口。',
  '- **托盘右键只留三项（设置 / 输入翻译 / 退出）之后**，暂停、轮询间隔、框选、日志目录这些动作必须仍能在浮窗标题栏',
  '  或设置页找到，否则等于把功能藏掉；新增动作要同步 `tray.menuLabels()` 的自检断言。',
  '- **自检断言不要依赖拖拽方向**：宽高可能一增一减，写成「宽高都必须变大」会在用户改过尺寸后误报，',
  '  应判「尺寸变化 >= 32px」（本轮 `hudResize` 就是这样从打包态 false 修成 true 的）。',
];

lines.splice(anchorIdx, 0, ...block);
fs.writeFileSync(file, lines.join('\n'), 'utf8');
console.log('ok: inserted lines before line ' + (anchorIdx + 1));
