# AGENTS.md — 桌面翻译助手（宿主壳 + 插件的协作约定）

> 本文件是 AI 开发代理进入本仓库的第一入口。**动手前必须读完本文件与
> `SECURITY_CONSTRAINTS.md`**，后者是硬约束，违反即终止会话。

## 1. 版本基线（ENV-03：版本号写在这里）

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| 桌面翻译助手 | 1.0.0 | 本仓库实现的第一版（V1） |
| 产品名 | 即译（jiyi） | 目录与可执行文件同名，数据目录仍为 desktop-translator |
| Electron | 28.3.3（锁定，无 `^`/`~`） | 宿主壳运行时；45.x 在本机沙箱内崩溃，详见第 7 节 |
| Node.js | 24.21.0（构建期） | 仅用于脚本与测试；运行时不依赖系统 Node |
| 打包目标 | Windows x64（WebView2 不需要，Electron 自带 Chromium） | `scripts/package-win.js` |
| DSH 插件 | 自研，`dsh-plugin-screen-ocr` / `dsh-plugin-translate` | 见 `dsh-plugins/`；引用 `@deepseek-ai/dsh-*` 时必须写死完整版本号 |
| llama.cpp | b12000（`llama-b12000-bin-win-cpu-x64.zip`，24,548,752 B） | 离线推理运行时，随包放 `runtime/llama/`（60.5 MB / 52 文件） |
| 离线模型 | HY-MT1.5-1.8B **Q4_K_M**（1,080.6 MB，GGUF） | 放数据目录 `userdata/models/`，自动探测第一个 `.gguf`；内存实测约 2.2 GB |

版本号变更必须同时更新：本表、`项目代码/package.json`、`开发文档/` 中对应的验收记录。

## 2. 项目结构（插件路径 / 宿主壳路径 / IPC 契约位置）

```
D:\桌面翻译助手\
├── 开发文档\                原始需求与技术文档（只读，不再修改）
├── 项目代码\                ← 宿主壳（Electron）主体
│   ├── src\main\            主进程：main.js / windows.js / tray.js / hotkeys.js / ipc.js / position.js
│   ├── src\preload\         预加载：唯一暴露 window.api 的地方
│   ├── src\renderer\        渲染进程：hud（浮窗）/ overlay（框选）/ ball（悬浮球）/ settings / onboarding
│   ├── src\core\            与 Electron 无关的纯 Node 逻辑（可在无 GUI 环境单测）
│   │   ├── capture\         截图：electron / gdi / mock 三种后端
│   │   ├── ocr\             OCR：winrt（系统）/ tesseract / mock
│   │   ├── translate\       翻译：openaiCompatible / chain（主备降级）/ hunyuanLocal（离线）
│   │   ├── config\          配置存储与默认值
│   │   ├── security\        密钥加密（AES-256-GCM + 机器指纹派生）
│   │   ├── host\            宿主桥（127.0.0.1 HTTP，供 DSH 插件调用）
│   │   ├── pipeline\        单轮编排 round.js 与定时循环 loop.js
│   │   └── metrics\         内存与性能采样（N-02-R1）
│   ├── src\shared\          **主进程与渲染进程共用的契约**：ipc-channels.js、accelerator.js
│   ├── scripts\             启动/自检/打包/OCR/截图辅助脚本
│   ├── launcher\            C# 启动器源码（Launcher.cs），打包时由 csc.exe 编成根目录 exe
│   └── assets\              托盘与图标资源
├── dsh-plugins\             ← DSH 侧插件（可选启用）
│   ├── dsh-plugin-screen-ocr\{package.json, patches\bundle.yaml, lib\index.js}
│   └── dsh-plugin-translate\ {package.json, patches\bundle.yaml, lib\index.js}
└── 项目测试\                测试资产、合成图、报告
```

**IPC 契约唯一位置**：`项目代码/src/shared/ipc-channels.js`。
新增通道 = 三处同改：契约文件 → `src/main/ipc.js` 注册 handler → `src/preload/index.js` 暴露。
`项目测试/integration/ipc-contract.test.js` 会静态比对三处是否一致，漂移即测试失败。

## 3. 关键约束（写代码前必读）

1. **截图必须经 IPC 委托宿主壳**：渲染进程与 DSH 插件**都不得**直接调用 `desktopCapturer` / GDI / 任何截屏 API。
   - 渲染进程 → `window.api.translate.run()` → 主进程 → `src/core/capture/*`
   - 插件 → `POST http://127.0.0.1:<port>/v1/host/capture_region`（端口与一次性令牌见 `bridge.json`）
2. **翻译调用顺序由 `general.priority` 决定**：在线优先（默认）= 联网 API（按用户排序，最多 2 个，主 5s/备 3s）→
   全失败才降级离线混元；离线优先 = 离线模型 → 失败再走联网 API。两条通道始终可用，`fallback` 只依据
   **失败/超时**，不评估译文质量（F-05a）。
3. **`lib/index.js` 必须是纯 JS**：插件不得提交未编译的 TypeScript（PLG-01）；`package.json` 必须声明
   `dsh.bundle.patch` 指向 `patches/bundle.yaml`（PLG-02/03，无改动也要写 `[]`）；`execute` 必须响应 `exec.signal`（PLG-04）。
4. **DSH 源码与构建产物只读**（REV-001 DSH-05）：不得修改 `node_modules/@deepseek-ai/dsh-*`，不得用
   `patch-package`/`postinstall` 打补丁；接口不足时优先用宿主桥 IPC 绕行，其次调整插件方案，最后才提 issue。
5. **密钥永不落明文**：只在 `secrets.items[apiId]` 存 `v1:<iv|tag|ct>` 密文；日志、错误消息、IPC 返回值一律掩码
   `sk-****`；渲染进程只能拿到 `keyMasked`。
6. **`npm/pnpm install` 新依赖必须先人工确认**（CMD-02/DSH-02）：列包名+版本+用途，检查 typosquatting、
   周下载量 > 1000、发布 > 30 天、无已知漏洞。当前依赖只有 `electron`。
7. **测试必须用合成图像**，不得把真实桌面截图放进仓库（SCR-01/SCR-02）；调试截图只允许放 `tmp/` 且用完删除（FS-03）。

## 4. 限制书摘要（三条不可越线）

1. **只写项目目录**：任何文件读写限于 `D:\桌面翻译助手\` 及子目录；禁止触碰用户主目录、AppData、系统目录。
2. **不外发用户内容**：OCR 原文与译文只允许发往用户自己配置的 API 端点，或本机 `127.0.0.1:8081`（离线模型）；
   禁止任何遥测、统计上报、崩溃上报。
3. **高风险代码人工审查**：网络请求构造、文件写入、加解密、凭据传递、子进程启动、权限申请，
   每处都要能一句话说清"发到哪、存到哪、谁能读到"。

完整清单见 `SECURITY_CONSTRAINTS.md`（含逐条自查表 C-01~C-07）。

## 5. 验收命令（改完代码至少跑这三条）

```powershell
# 1) 单元 + 集成 + OCR 精度（21 个文件 / 179 个用例：单元 128 + 集成 37 + OCR 14，零第三方依赖）
#    第十一轮新增：输入翻译面板（界面/字数联动/IPC 通道就绪）、交互图标、设置页关闭＝最小化；
#    自检断言新增 inputPane / inputCountSync / quitButton / settingsCloseMinimizes。
node 项目测试\run-all.js

# 2) 只跑 OCR 精度（D1.3：中英印刷体 ≥ 95%，需要真实系统 OCR，约 5 秒）
node 项目测试\run-all.js --only=ocr

# 3) Electron 应用自检（托盘/浮窗/设置/遮罩/悬浮球/悬浮球点击/暂停按钮/主题/尺寸，写截图与 report.json）
node 项目代码\scripts\smoke.js

# 4) 打包免安装版（产出 D:\桌面翻译助手\dist\win-x64 与 zip）
node 项目代码\scripts\package-win.js
```

预期：`全部通过` / `ok=true 渲染错误=0 截图=14 托盘=true`，且 `report.json` 里
`ballClickExpands / pauseButton / resumeButton / settingsToggle / hudAutoHeight / hudResize / hudThemeApplied /
hudTextColorApplied / hudBgImageApplied / hudBgImageClipped / settingsBgImageApplied / hudReadableApplied /
hudSubtitleMode / settingsPriority / settingsHudMode` 均为 `true`（打包产物没有测试图时背景图相关的三项按"跳过"记 true）。
自检产物在 `项目测试/reports/electron-smoke/`（打包产物没有测试目录时落在 `<数据目录>/smoke/`）。

## 6. 开发期环境陷阱（本机已踩）

- **Electron 的 userData 必须放工作区**：本机（Windows 10 19045 沙箱）Chromium profile 落在 `C:\Users\...`
  会以 `0xC0000005` 崩溃，落在 `D:\桌面翻译助手\...` 正常。`scripts/launch.js` 与 `scripts/smoke.js`
  会自动注入 `--user-data-dir=<工作区>`。
- **GUI 子进程的输出必须是文件**：把 `electron.exe` 的 stdout 接进管道会 `0x80000003` 崩溃；
  自检脚本用文件句柄接 `run.log` / `run.err.log`。
- **父进程的 `ELECTRON_RUN_AS_NODE=1` 必须删除**，否则 `electron.exe` 退化为纯 Node，
  `require('electron').app` 为 undefined。
- **PowerShell 脚本含中文必须存成 UTF-8 with BOM**，否则 Windows PowerShell 5.1 按 ANSI 解析报
  `The string is missing the terminator`。
- **渲染进程不要写 `const api = window.api`**：`contextBridge` 暴露的 `api` 是不可配置全局属性，
  经典 `<script>` 的 `const api` 会抛 `Identifier 'api' has already been declared`。渲染脚本统一用 IIFE 包裹。
- **CSP `style-src 'self'` 禁止 HTML 内联 `style="..."` 属性**（CSSOM 设置不受限），样式类写在 `shared/base.css`。
- **双击没反应 = Chromium 以 `0x80000003` 秒退**：本机无 `--no-sandbox` 时 Electron 启动即崩（`--disable-gpu`
  与 `--user-data-dir` 都救不回来，`app.commandLine.appendSwitch('no-sandbox')` 也太晚）。
  因此打包产物根目录是 **C# 启动器**（`launcher/Launcher.cs`），它负责首次正常启动、崩溃后写
  `userdata\safe-mode.flag` 并用 `--no-sandbox --disable-gpu` 重试一次；用户侧永远只需双击。
- **启动器必须吞掉子进程 stdio**：核心程序的 stdout/stderr 重定向到 `userdata\core.log`。
  把 GUI 子进程的 stdout 接到管道（终端、CI、MCP 工具）会把管道写满并卡死整个应用。
- **数据目录顺序**：`TRANSLATOR_HOME` → `DT_DATA_DIR`（启动器注入）→ exe 同级 `userdata\` → `%APPDATA%` → 临时目录，
  每级都先探测可写。排查「打不开」先看 `userdata\launcher.log`、`userdata\core.log`、`userdata\startup-error.log`。
- **窗口诊断**：`桌面翻译助手.exe --diag-windows`（或 `node scripts/launch.js --diag-windows`）会打印每个窗口的
  `visible/bounds/url` 后退出，用来确认「进程在跑但看不到窗口」。
- **WinRT OCR 不能用 `StorageFile.GetFileFromPathAsync` 读临时文件**：由 Electron 派生的子进程里 WinRT 文件代理会抛
  `UnauthorizedAccessException「该项目没有位于应用程序可以访问的位置」`（同一脚本从系统 node 派生却正常）。
  `scripts/winrt-ocr.ps1` 已改为「读字节 → `InMemoryRandomAccessStream` + `DataWriter` → `BitmapDecoder`」。
  `Await-Op` 必须展开 `InnerException`，否则只能看到「发生一个或多个错误」。
- **已完成引导的用户再次双击，必须给出可见反馈**：纯托盘应用默认什么都不显示，用户会判定"打不开"。
  `bootstrap()` 在 `onboarded === true` 时调用 `showLaunchHint()`（浮窗提示 6 秒后自动收起），
  `second-instance` 事件调用 `raiseVisibleWindow()`（引导页 → 设置页 → 浮窗，逐个 `show + focus + moveTop`）。
- **打包必须保留 `userdata/`**：`scripts/package-win.js` 只清理 `app/` 与根目录文件，
  否则用户配置、日志、密钥密文会被覆盖安装删掉（且运行中的文件会 `EPERM`）。
- **`focusable: false` 的浮窗收不到任何点击**：Windows 10 + Electron 28 + `transparent` + `skipTaskbar`
  时，`WS_EX_NOACTIVATE` 窗口能收到 `mousemove`，但 `mousedown/mouseup/click` 全部丢弃，
  表现为"浮窗上的按钮点不动"（日志里只有 `hud:set-ignore`，没有 `translate:once`）。
  修法：浮窗设 `focusable: true`，靠 **`showInactive()`** 保证不抢焦点（F-17），
  点击穿透仍由 `src/main/hud-pointer.js` 的主进程光标轮询负责（F-14）。
  `DT_HUD_NOACTIVATE=1` 可回到旧行为用于对比复现。
- **透传模式下 forwarded mousemove 不可靠**：`setIgnoreMouseEvents(true, { forward: true })`
  在透明无边框窗口上实测常常收不到转发事件，只靠渲染进程永远无法关闭穿透。
  因此穿透状态以主进程轮询为准（`HudPointerWatcher`，120ms，`elementFromPoint` 命中 `.interactive`
  才允许点击），渲染进程的请求只作为补充。
- **托盘图标在本机会话里注册不上（环境限制，不是代码缺陷）**：用最小化 Electron 探针 A/B 对比
  `Shell_TrayWnd\TrayNotifyWnd\SysPager\ToolbarWindow32` 与 `NotifyIconOverflowWindow\ToolbarWindow32`
  的 `TB_BUTTONCOUNT`，启动前后按钮数**完全不变**（2 / 9），且 `tray.getBounds()` 恒为 `0,0,0,0`
  （探针与本应用表现一致）。所以**不要用 `getBounds()` 判断成败**（`_probeBounds` 只记 debug），
  也不要在验收里把"托盘可见"当硬指标。真实桌面环境需另测。
- **设置入口必须多于托盘一个**（用户实测「没有进入设置页面的入口」）：现在有 4 条路径——
  ① 浮窗标题栏 `⚙`（`#btn-settings` → `api.settings.open('general')`）；
  ② **再次双击 exe**（`second-instance` → `raiseVisibleWindow()` 直接打开设置窗口）；
  ③ 托盘双击/右键菜单；④ `--open-settings` 命令行参数（可做成桌面快捷方式）。
  改动任一路径时，`src/renderer/hud/index.html`、`hud/app.js`、`main.js`、`tray.js`、`package-win.js`
  的使用说明要同步。
- **悬浮球同样不能用 `focusable: false`**：`ensureBall()` 原先也是 `focusable:false`，用户反馈「点球没反应、
  也拖不动」——与浮窗同源（`WS_EX_NOACTIVATE` 丢弃 `mousedown`）。现为 `focusable: true` + `acceptFirstMouse: true`
  + `showInactive()`；`DT_BALL_NOACTIVATE=1` 可复现旧行为。自检里用 `report.json.checks.ballClickExpands` 守住。
- **OCR 不要固定单一放大倍数**：实测同一张图 2x/3x 各有胜负（2x 把 `Please` 认成 `PIease`、3x 把 `the` 拆成 `th e`）。
  `winrt.recognizeMulti()` 并行跑 2x+3x，用 `core/ocr/score.js` 的异常形状打分（`case-jump`/`single-letter`/
  `symbol-line`/`digit-in-word`）选更干净的一遍，再用 `repairText()` 收敛残留的 `PIease→Please`、`tO→to`。
  调参只改 `score.js`，别在校验里写死某张图的期望字符串。
- **去重不能用精确哈希**：OCR 每轮会抖 1~2 个字符，哈希一变就当新文本 → 定时轮询对同一段文字反复调用付费 API。
  现在用 `core/translate/fingerprint.js`：先归一化（去空白标点、i/l/1/| 归一、O/0 归一、`rn→m`、小写），
  再按相似度 ≥ `general.dedupeSimilarity`（默认 0.98）判为同一段；另有 `general.cacheTtlMs`（默认 10 分钟）
  的译文缓存，来回切换不重复请求。实测 4 轮抖动文本只请求 1 次（`integration/dedupe.test.js`）。
- **外观走 CSS 变量，不要在组件里写死颜色**：`src/renderer/shared/theme.js`（UMD，`window.TranslatorTheme`）把
  主题色/背景色/不透明度/模糊/圆角/背景图算成 20 个变量写到 `documentElement`
  （`--hud-bg / --hud-blur / --hud-radius / --accent* / --bg* / --fg* / --border* / --theme-image*`），
  `hud.css`、`settings.css`、`base.css` 只引用变量。写死 `#10131a` 这类颜色会让主题失效
  （自检 `report.json.checks.hudTheme` 守住变量是否下发）。浅色背景要自动切深色文字——
  由 `theme.palette()` 的 `isLight()` 判断，不要各处自己判断。
- **背景图只允许绝对路径**：`appearance.bgImage` 由 `store.patch()` 校验（相对路径直接清空，防目录穿越），
  选图后复制进数据目录 `theme/`，渲染进程通过 `api.theme.getImage()` 拿 data URL（上限 8MB，仅图片扩展名）。
- **设置按钮是「开/关」而不是「开」**：`api.settings.toggle()`（主进程 `wm.toggleSettings()`）按 `isVisible()`
  决定显隐，并在 `show/hide/closed` 时广播 `settings-visibility`，浮窗据此给按钮加 `.active`。
  用户明确要求「再点一次关闭设置页」。
- **浮窗尺寸范围 280–1200 × 96–900**：`windows.setHudSize()` 内统一钳制（设置页输入、右下角拖拽、
  自动高度三条路径共用）。「高度自适应」不能用 `body.scrollHeight` 直接量——窗口已定高时它会被拉满；
  要先临时把 `.hud{height:auto}` + `.hud-body{flex:0 0 auto}` 再读，读完还原（见 `hud/app.js` 的
  `scheduleAutoHeight`）。手动拖动过大小后要关掉 `autoHeight`，否则下一轮译文又会把高度弹回去。
- **暂停热键实测冲突**：`Ctrl+Shift+P`、`Ctrl+Alt+P` 在本机都被其它程序占用
  （`globalShortcut.register` 返回 false），现默认 `Ctrl+Alt+S`；`store._migrate()` 会把老配置里的这两个
  旧默认值改写成新默认（用户自定义过的组合键不动）。
- **一键暂停必须有多入口**：浮窗 `⏸/▶` 按钮、`Esc`、热键 `CommandOrControl+Alt+S`（`hotkeys.pause`）、
  托盘顶层「暂停/开始定时翻译」。新增动作要同步 `src/shared/accelerator.js` 的 `ACTIONS`/`ACTION_LABELS`、
  `defaults.js` 的 `hotkeys`、`main.js` 的 handlers、`tray.js` 菜单与 `unit/accelerator.test.js` 的断言。
- **配置加载顺序**：`LlamaServerManager` 在 `TranslatorEngine` 构造函数里创建，那时 `store.load()` 还没跑，
  拿到的是默认 `offline`（`-c 4096`、无线程、端口 8081）。`init()` 里 load 之后必须
  `this.llama.updateConfig(this.store.raw().offline)` 并 `this.loop.setInterval(...)` 再同步一次，
  否则用户设置的上下文/线程/端口被默认值覆盖（`unit/llama-config.test.js` 守着这条）。
- **离线运行时随包分发**：llama.cpp 二进制放 `项目代码/runtime/llama/`（构建期由 `package-win.js`
  复制到 `app/resources/runtime/`），模型 `.gguf` 放数据目录 `userdata/models/`。
  打包 zip **只含** `桌面翻译助手.exe`、`app/`、`使用说明.txt`——`userdata/` 是用户数据（含 1GB 级模型），
  进压缩包会让 zip 从 127MB 涨到 1.2GB。
- **本机网络：hosts 把 huggingface/github 全部指向 127.0.0.1**（本地 TLS 代理）：`curl` 必须加
  `--ssl-no-revoke`，且代理不稳定 → 下载模型优先 `modelscope.cn`（实测 1.2MB/s、支持 Range），
  llama.cpp 资产名已变为 `llama-bXXXXX-bin-win-cpu-x64.zip`（老的 `-bin-win-avx2-x64.zip` 不存在了）。
- **`llama-server` 的 `--cors-origins` 不做 403**：实测 origin 不在白名单时只是**不返回
  `Access-Control-Allow-Origin`**（HTTP 200），浏览器仍会因预检缺 ACAO 而阻断真实请求；
  文档里不要写「应返回 403」这种与本实现不符的验收口径。
- **对外分发必须走 `scripts/package-release.js`，不能直接发 `dist/win-x64`**：
  `dist/win-x64/userdata` 里有开发机的 `config.json`（`apis[]` 条目 + `secrets.items{}` 密钥密文 + `secrets.salt`）、
  `capture.lastSelection`（开发机屏幕坐标）、`logs/`、`bridge.json`（一次性令牌）、
  `electron-userdata/`（7.8 MB Chromium 配置）、`safe-mode.flag`（本机兼容模式标记）。
  发布脚本会剥离整个 `userdata/` 并新建空的 `userdata/models/`，首次运行为默认配置（`onboarded=false`）。
- **内置模型放 `app/resources/models/`，不要放 `userdata/models/`**：数据目录写不进去（比如装到
  `C:\Program Files`）时 `resolveHome()` 会回落到 `%APPDATA%`，此时内置模型就找不到了。
  `LlamaServerManager.resolveModel()` 的查找顺序是「`offline.modelPath` → 数据目录 `models/` →
  `PROJECT_ROOT/models/`」，两处都命中数据目录优先（用户可覆盖内置模型）。
- **模型随包分发有许可义务**（Tencent HY Community License）：必须随附
  `licenses/Tencent-HY-Community-License.txt`（许可副本）+ `NOTICE.txt`（指定 Notice 原文，
  见 `package-release.js` 的 `writeNotices()`）；**不得分发到欧盟、英国、韩国**；不得暗示腾讯背书；
  月活超 1 亿需另行申请。改发布脚本时别把这三个文件弄丢。
- **首次启动就要能离线翻译**：`main.js` 的自动启动条件是「`offline.autostart` 且 `resolveModel()` 有值」，
  不再因 `onboarded=false` 跳过；`pipeline/round.js` 在无联网候选时先 `ensureOfflineReady()`，
  `TranslatorEngine.translateText()` 同样处理——否则用户引导完第一次框选会看到「离线模型未安装」。
- **未签名 exe 一定会触发 SmartScreen**：发布说明里要写「更多信息 → 仍要运行」，
  否则对方会以为程序有毒；也没有自动更新与崩溃上报（刻意为之，符合 LOG-01/LOG-03）。


- **语言链路有两条容易踩的坑**（第八轮）：① `ensureTraditional()` 必须带 `targetLang` 守卫，
  否则「英文→简体中文」会被强行转成繁体；② `[source language: X]` 不能塞进 user 正文，
  小模型会把它一起抄进译文，源语言要写进 system prompt。
- **注入 `executeJavaScript` 的字符串里禁止再写 `${}` 模板插值**：外层是模板字符串时会在主进程
  提前求值，直接 `SyntaxError: missing ) after argument list` 让整个应用加载失败（`main.js` 899 行踩过）。
- **去重 key 必须含语言**：用户改了目标语言但屏幕文字没变时，只比对文本会一直复用旧译文
  （表现为「设置成繁体/英文却翻译不出来」），`round.js` 用 `langKey` 参与判断。
- **背景图裁切靠层级位置**：浮窗的背景图图层必须放在 `.hud` 卡片内部（`.bg-layer` 是卡片第一个子元素），
  靠 `border-radius: inherit` 被裁切；放到 `body` 下就变成直角、压不住圆角。
- **背景图上要再盖一层薄罩**：用户挑的照片颜色不可控，浅色图会把半透明卡片照亮到读不清字。
  浮窗用 `.bg-veil`（`--hud-veil`，随图片不透明度联动）；设置页靠 `.content` / `.titlebar` / `.sidebar`
  各自的半透明表面（`--bg-veil` / `--bg-elevated-veil`）——**不要再叠全屏 `body::after` 罩**，
  两层罩会把用户照片压到几乎看不见（第九轮实测只剩 5%）。罩子不能放进 `.bg-layer`
  （该元素带 `opacity`，会把罩子一起淡化）。

### 第九轮（中文小字识别 + 外观分离）
- **小字号中文 OCR 靠 USM 锐化，不靠倍数也不靠反色**：14px「动/文/景」被认成「目/（丢失）/昱」，实测 2x/3x/4x、反色、对比度拉伸全都不行，`sharpen=160`（GDI+ 手写 3x3 近似高斯 + unsharp mask）后完全正确（`src/core/ocr/winrt.js` 默认值，PowerShell 侧内联 C# `OcrPrep`）。不要为了"简单"把它关掉。
- **`scripts/winrt-ocr.ps1` 的注释必须纯 ASCII**：PS 5.1 无 BOM 时按 ANSI 读文件，中文注释会把下一行代码吞进注释（表现为「变量莫名是空的」，不报错）。每次编辑该文件后跑一次 BOM 校验。
- **浮窗背景图必须限流**：`shared/theme.js` 对 `surface==="hud"` 把图片不透明度上限压到 0.55，并用 `--hud-veil = 0.40 + opacity*0.35` 叠罩；标题栏/按钮另加底片与文字投影。用户反馈过"看不清浮窗按钮和文字"。
- **两处背景图各自独立**（第十轮，取代第九轮的「生效范围」三选一）：`appearance.bgImage` + `bgImageOpacity` 属浮窗，`appearance.settingsBgImage` + `settingsBgImageOpacity` 属设置页；设置页槽位留空时 `theme-files.resolveSurfaceImage()` 回落浮窗那张并带 `fallback:true`。渲染侧 `Theme.apply(doc, raw, {dataUrl, surface})` 只按 `surface` 取不透明度，不再做范围过滤——`dataUrl` 由调用方按表面取（浮窗 `api.theme.getImage('hud')`，设置页 `('settings')`）。旧配置里的 `bgImageScope` 由 `store._migrate()` 迁移后删除。
- **绝对定位的装饰层会盖住未定位的内容**（第十轮）：`.hud` 里的 `.bg-layer` / `.bg-veil` 是 `position:absolute`，而 `.hud-head/.hud-body/.hud-foot` 原本是普通流，于是「图片不透明度」一调高，罩层就压到文字和按钮上，看起来像"文字也变透明了"。修法是给三个区块 `position: relative; z-index: 1`，并新增自检 `hudReadableApplied`（`bodyZ>=1 && headZ>=1 && textOpacity==='1'`）。
- **OCR 预处理必须有降级链**：`scripts/winrt-ocr.ps1` 的 `Initialize-Prep` 依次尝试「加载缓存的 `OcrPrep.dll` → 编译并落盘 → 纯内存编译」，全失败时退回 `Resize-Only`（纯 GDI+ 缩放）并输出 `prepFallback:true`；`OcrService.recognize()` 捕获异常时清空 `_picked`/`_probeCache`，下一轮重新探测。这样偶发的 C# 编译失败不会再被报成「系统 OCR 语言包未安装」。`-NoPrep` 开关专供测试走回退路径（`integration/ocr-fallback.test.js` 守三条：DLL 复用、回退仍出文本、错误信息不许是「发生一个或多个错误」）。
- **`.translation` 等文字颜色一律用 `var(--fg)`**：曾经写死 `#f2f5fa`，导致"浅底深字"主题下译文不可见。


### 第十一轮（二次元图标 + 任务栏驻留 + 输入翻译）

- **窗口图标与 exe 图标是两套东西**：窗口图标走 `BrowserWindow({ icon: assets/app.png })`（窗口工厂里统一加），
  exe 图标走 csc 的 `/win32icon:assets/app.ico`；只改一个会出现「任务栏好看、资源管理器难看」。
- **`app.setUserTasks` 需要 AUMID 在 ready 前注册**，且真实生效要求快捷方式带 AUMID；
  开发者态（electron.exe）恒返回 false，属预期，不要据此判定功能坏掉。
- **关闭设置窗口不能 close**：浮窗 `skipTaskbar`、托盘在部分环境注册不上，`win.close()` 会让用户彻底失去入口。
  现在统一 `close → preventDefault + minimize`，退出走 `wm.prepareQuit()` 放行（`AppController.quit()` 里调用）。
- **`app.on('ready')` 钩子别用类方法做锚点**：`app.on('window-all-closed', ...)` 在类里也有一份同名注册，
  打在方法体内的 ready 钩子既不会执行、还会让模块作用域的函数不可见（本轮踩过：`setupJumpList is not defined`）。
- **输入翻译不要另起链路**：直接复用 `engine.translateText`（联网主备 → 离线降级），
  否则配额/降级行为会和浮窗不一致；目标语言统一读 `general.targetLang`，不要复制一份状态。


### 第十三轮（设置页图标 / 整段中文识别 / 托盘图标）

- 设置页标题栏图标路径要按 **`src/renderer/settings/`** 起算：`../../../assets/app.png`（少退一级就 404），同时给该页 CSP 的 `img-src` 补 `file:`。
- 整段中文正文**不要开 USM 锐化**：实测 2x 不锐化 0.9404/0.9554，2x+160 只有 0.9286，锐化会把「技」认成「枝」。默认多遍识别固定 `[{2,0},{3,0},{2,160}]`，短文本（≤60 字）优先锐化那一遍，长文本优先不锐化那一遍。
- WinRT 在中文语境会把 `3.5` 输出成 `3 ． 5`、`100%` 输出成 `100 ％`：`repairCjkPunctuation` 必须补数字/百分号/千分位规则，否则会被标点规则改成 `3。5` 之类的怪串。
- 托盘图标注册失败时（本机通知区域连原生 WinForms `NotifyIcon` 都不接受）：必须有「状态自检 + 手动重挂」入口，并且**托盘不可用时关闭设置页改为最小化**，否则用户关掉窗口后既没托盘也没任务栏按钮，只能再双击 exe。

### 第十二轮（改名「即译」· 二次元图标 · 后台驻留 · 输入入口）

- **改名只改显示层**：`app.setName` / 窗口标题 / `package.json` 的 `name`+`productName` / exe 名（`即译.exe`）都可以改，
  但 `src/core/paths.js` 的 `APP_DIR_NAME = "desktop-translator"`、`host/bridge.js` 的服务名、
  `security/secrets.js` 的 scrypt 盐串 `desktop-translator-v1` **一律不动**——它们属于数据目录与密钥派生，
  改了等于让老用户丢掉全部配置与 API Key。
- **图标白边是缩放顺序问题**：先 `putalpha` 再 `LANCZOS` 缩放，会让透明区（白）的 RGB 参与插值，边缘出现一圈白线。
  正确顺序是**先缩放到目标尺寸、再套圆角蒙版**（蒙版在 4 倍画布绘制后缩小，抗锯齿更干净），并把裁切内缩 1.2%，
  顺带裁掉源图自带的浅色描边（生成器 `项目测试/tools/gen_icon_jiyi.py`）。
- **关窗口 != 退出**：设置窗口的 `close` 必须 `preventDefault()` + `hide()` + `setSkipTaskbar(true)`；
  直接销毁会让用户同时失去浮窗（`skipTaskbar`）与托盘（部分环境注册不上）两个入口。
- **托盘右键只留三项（设置 / 输入翻译 / 退出）之后**，暂停、轮询间隔、框选、日志目录这些动作必须仍能在浮窗标题栏
  或设置页找到，否则等于把功能藏掉；新增动作要同步 `tray.menuLabels()` 的自检断言。
- **自检断言不要依赖拖拽方向**：宽高可能一增一减，写成「宽高都必须变大」会在用户改过尺寸后误报，
  应判「尺寸变化 >= 32px」（本轮 `hudResize` 就是这样从打包态 false 修成 true 的）。
- **OCR 标点事故的修法**：重复标点（`，，`）、行首标点（`，然后`）、被空格拆开的运算符（`Ctrl + Shift + T`）都会进 `scoreText()` 的黑名单（`dup-punct` / `lead-punct` / `ascii-space`），同时由 `repairCjkPunctuation()` 收敛。运算符收紧只在「两端都是字母」时生效，否则 `1 + 1 = 2` 会被连成 `1+1=2`。
- **低对比度文字（照片/半透明浮层）必须有一遍对比度拉伸**：`DEFAULT_PASSES` 里除 2x/3x 不锐化、2x 锐化外，额外跑 2x + `contrast=30`；实测 `bg-gray-20px` 的 `CtrI`→`Ctrl`、漏掉的「重」也能补回来。**只加对比度、不要锐化**——照片底上锐化会把笔画撕开（`按钮`→`扌安钮`）。
- **多遍合并要先投票再比长度**：同一行被两遍以上认成同一个串就以它为准（投票），票数相同时才用「子序列/更长」规则补漏字。短文本（≤60 字符）关掉投票、按锐化优先的顺序取首遍，否则提示行反而会选到别的遍的近似结果。

### 第十五轮（接入 ONNX 识别引擎 + 引擎切换）

- **`onnxruntime-node` 不能直接传中文路径**：`InferenceSession.create('D:\\桌面翻译助手\\…\\ch_PP-OCRv4_rec_mobile.onnx')` 会报
  `Load model … failed. File doesn't exist`（文件明明在）。必须先 `fs.readFileSync` 再传 `Buffer`，
  本机已封在 `src/core/ocr/rapid.js` 里，任何新模型加载都照这个来。
- **模型目录不能只按 `paths.PROJECT_ROOT` 拼**：`PROJECT_ROOT` 是工作区根（`D:\桌面翻译助手`），
  而运行时在 `项目代码/runtime/`，打包后在 `resources/runtime/`。`ocr/index.js` 的 `rapidModelsDir()`
  按「`__dirname` 向上三级 → 向上四级 → `PROJECT_ROOT/项目代码` → `PROJECT_ROOT` → 数据目录」依次探测。
  新增运行时可复用这套顺序，别硬编码。
- **pnpm 装的原生模块打包必须落成真实目录**：`node_modules/onnxruntime-node` 是软链，直接 copy 会得到断链；
  `onnxruntime-common` 只在 `.pnpm/onnxruntime-node@<ver>/node_modules/` 下，从项目根 `require.resolve` 根本找不到。
  `scripts/package-win.js` 的 `copyOrtRuntime()` 从 `.pnpm` 取真实目录，并**只保留 `bin/napi-v*/win32/x64`**
  （六平台原生库合计 ~236MB，裁剪后 56.9MB）。
- **两侧极性都要重算极值**：深色主题下整行反相后，如果还用反相前的 min/max 做对比拉伸，整行会被压成纯白、识别为空。
  局部均值墨迹图（半径 6）+ 反相后重算极值，才能同时吃下白底和照片底。
- **别按「列墨迹占比高」裁边框**：`「` 这类竖笔会占满行高，裁剪会把前引号当边框删掉；宁可让模型输出再在
  `cleanLine()` 里剥行首/行尾的引号括号。
- **打包自检产物绝不能落进 `resources/`**：`runSmokeTest()` 原来按「`项目测试/` 是否存在」决定落盘位置，
  一旦打包产物里已有一份就会被续写。现在固定用 `app.isPackaged` 判定：开发态写 `项目测试/reports/`，
  打包态一律写 `<数据目录>/smoke/`。
- **`capturePage()` 偶尔返回空图**：窗口还没画出第一帧时截图是 0 字节，自检要 `isEmpty()` 重试一次，
  否则报告里会混进空截图而检查全绿。
- **引擎切换要同时改三处，否则「改了不生效」**：`store.patch` 的白名单校验、`core/index.js` 的 `setPreferred`
  （初始化 + `change` 事件各一次）、设置页下拉的回填与提交。`pick()` 里对已选引擎做了缓存，
  切引擎时必须清 `_picked` 与 `_probeCache`。

### 第十六轮（外观：卡通艺术字 + 悬浮球改图标）

- **小尺寸窗口里不要给主体加 `box-shadow`**：悬浮球窗口只有 44px，`#ball` 的 `0 6px 16px rgba(0,0,0,.45)`
  投影会被窗口边缘裁掉，只剩右侧一条黑边——看着像"球旁边挂了个黑框"。透明小窗一律用 `border-radius +
  overflow:hidden` 裁图标，投影交给图标自身的 alpha。
- **艺术字素材按"显示高度的 4 倍"出图**：`assets/brand.png` = 26px × 4 = 104px 高，CSS 里 `height:26px`。
  直接按 1x 出图会被浏览器缩放糊掉，按 4x 出再缩，白描边才不会断。
- **描边宽度按字高取比，别按画布比例**：候选稿用 `stroke=11×SS` 在 132px 字高下好看，缩到 26px 显示时
  白边会吃掉字芯、整块糊白；定稿改成 `6×SS`（≈字高 5%）才对。
- **渐变填充要按 `mask.getbbox()` 铺满色域**：按整张画布铺会因为字只占画布一小块而只取到过渡色，字发白。
- **透明区不能有非零 alpha**：高光层若用"整条矩形 + 高斯模糊"，会在透明区留下一条 `alpha=56` 的灰带，
  截图里就是标题栏文字后面的灰方块。必须 `ImageChops.multiply(hi, mask)` 把高光裁到字身上。
- **改含中文的 py/ps1 文件不要用 PowerShell 字符串重写**：`(Get-Content -Raw) -replace ... | Set-Content`
  会把 UTF-8 中文注释按 ANSI 读坏，甚至吞掉换行（曾把 `sh = Image.new(...)` 吞进注释里，运行报
  `NameError: name 'sh' is not defined`）。要改就整文件重写，或用 `edit` 工具。

### 第十七轮（标题字标改版）

- **标题栏字标一律出「4 倍图 + 两套颜色」**：`assets/wordmark-light.png`（深色栏用）与
  `assets/wordmark-dark.png`（浅色栏用），CSS 用 `:root[data-theme="light"]` 切 `display`。
  不要用 `filter: invert()` 省事——反色会把 `#2B3445` 变成脏蓝灰，与设计稿对不上。
- **小尺寸中文想「圆润」只能磨角**：本机没有圆体字库（幼圆/思源黑体圆都没有），
  `gen_wordmark.py` 用「高斯模糊 + 阈值二值化」把笔画端点与内角磨圆；描边超过 `1.5×SS` 会把字腔
  （口、讠内部）糊死，实测 `4×SS` 时「即」的两个口几乎闭合。
- **副标语的分隔线用 `::before` 画**，不要插额外 DOM——标题栏是 flex + 拖拽区，
  多一个空 `<span>` 要额外维护 `no-drag` 与间距规则。
- **又一次被 PowerShell 重写中文文件坑到**：`-replace` 改 `light-preview.js` 后路径里的 `项目测试`
  变成 `椤圭洰娴嬭瘯`，脚本直接跑挂。含中文的 `.js/.py/.ps1` 只用 `write` / `edit` 改。

### 第十八轮（离线/在线双通道 + 字幕模式）

- **双通道靠 `priority` 排序，不是"关掉另一条"**：`general.priority` 只决定 `order` 是
  `['online','offline']` 还是反过来，优先那条整条失败才换另一条，结果带 `stage` / `fallback`。
  新增通道要同时改 `chain.js`（`runX` + `lanes`）、`core/index.js`、`pipeline/round.js`
  （离线优先时先 `ensureOfflineReady()`），只改一处会出现"设置改了不生效"。
- **runtime 目录一律用 `paths.resourceRoot()`**：开发态 = `项目代码`，打包态 = `app\resources`；
  `PROJECT_ROOT` 是工作区根，两边都差一级。曾经 `llama-server` 因此在开发态与打包态同时 ENOENT，
  表现为"离线翻译整体不可用"，而错误只写进 `core.log`。
- **失败提示沿用需求书措辞**：联网失败 + 离线未就绪必须给 `LOCAL_NOT_READY_MSG`
  （"离线模型未安装，请配置联网 API 或下载模型"），`unit/chain.test.js` 与
  `integration/pipeline.test.js` 都按这句话断言。
- **`node.hidden` 会被作者样式盖掉**：`.field{display:flex}` 的优先级高于浏览器默认
  `[hidden]{display:none}`，`shared/base.css` 里那条 `[hidden]{display:none !important}` 不能删，
  否则设置页字段显隐不生效（第十八轮字幕字段曾一直显示）。
- **自检必须整段快照/还原 `hud` 配置**：拖拽尺寸的检查会关掉 `autoHeight` 并改宽高，
  不还原就会让下一次自检的 `hudAutoHeight` 随机失败（打包态踩过）。
- **字幕模式的交互边界**：`.hud` 与 `.hud-body` 都是 `pointer-events:none`，只有 `.hud-head`
  （右上角胶囊，默认 `opacity:.16`）可点可拖；穿透由主进程 `HudPointerWatcher` 按 `.interactive`
  判定，所以正文点击会落到下层游戏窗口。
- **字幕窗口高度别超过 140px**：自检 `hudSubtitleMode` 按
  `height<=140 && width>=640 && bodyPointer==='none' && text-shadow 非空 && font-size>=26` 判定，
  改样式要同步这条阈值。

### 第十九轮（通知主题化 + 悬浮球悬停面板 + 字幕条控制区/宽度）

- **弹窗提示不要写死颜色**：`.toast` 原来把 `rgba(26,31,41,.96)` 当背景，浅色主题下继承到深色文字，
  就是用户看到的"黑底黑字"。现在背景取 `var(--bg-elevated)`、文字取 `var(--fg)`，
  语义色用 `var(--ok/--err/--warn)`（由 `shared/theme.js` 的 `palette()` 下发）。
  以后新增浮层组件一律走变量，别写死 rgba。
- **悬浮球现在默认常驻**（`general.ballEnabled`，默认 true）：本机通知区域拒绝注册，
  原来"只在收起浮窗时冒出来"等于没有入口。启动时 `ensureBallVisible()` 直接显示，
  设置页「启动 → 悬浮球」可关；配置变化由 `syncBallFromConfig()` 增删。
- **悬浮球展开时球不能动**：`wm.setBallExpanded()` 只把窗口向屏幕内侧长出去
  （44 → 300 宽），球留在贴边那一端；面板朝左还是朝右由两侧可用空间决定，
  结果通过 `ball:state` 下发给渲染进程切换 `.panel-right`。
  若反过来"窗口从左上角长"，用户会看到球自己被挤走。
- **字幕模式的控制区在右侧**：顶部细条只留 46×16 的拖动握把（`⠿`），
  其余按钮收进 `.hud-rail`（默认 22px 宽、`opacity:.55`，点 ‹ 展开成 142px，
  鼠标移开自动收起）。渲染进程通过 `btn-<name>.click()` 复用卡片模式的同一批处理函数，
  避免两套逻辑走散。
- **字幕条宽度拖拽 = 只改 X 轴**：`HUD_RESIZE` 的 `axis:'x'` + `edge:'left'|'right'`，
  左边缘拖动时窗口右边固定、`x` 跟着变；松手写回 `hud.subtitleWidth`（0 = 自动）。
  `setHudSize` 因此要接受 `maxWidth`（字幕模式允许到工作区宽度）和 `x`。
- **主进程轮询只在"事件断了"时兜底**：拖动时渲染进程持续发 `pointermove`，
  若 16ms 轮询同时改尺寸，两者会互相拉扯（合成事件测试里表现为"拖了又弹回去"）。
  现在 `tickHudResize()` 遇到 700ms 内有 `pointermove` 就跳过，只负责事件丢失后的补位。

### 第二十轮（去掉黑边 + 字幕控制区真正可点 + 可调高度）

- **透明窗口上的"黑边"有两个来源，两个都要治**：
  ① CSS 投影（`.hud` 的 `var(--hud-shadow)`、`.ball-fan` 的 `0 8px 22px`）画在窗口内 8px 留白里，
  深色主题下就是卡片/面板外一圈黑；
  ② Windows DWM 给透明窗画的系统投影，`hasShadow:false` 在部分版本不生效。
  现在两条都清掉：CSS 里 `box-shadow:none`（层次感交给 1px 边框），
  创建窗口后再 `win.setHasShadow(false)`。**透明窗口上也不要 `backdrop-filter`**，
  它同样会在边缘糊出暗晕——用高不透明度底色代替。
- **字幕模式下 `.hud` 是 `pointer-events:none`，子元素必须显式恢复**：
  `.hud-rail` / `.hud-rail .icon` / `.hud-edge` 都要 `pointer-events:auto`。
  否则 `document.elementFromPoint` 命不中它们 → `hud-pointer.js` 判定为空白 → 保持穿透 →
  真实鼠标点不动（这就是用户说的"点击没反应"；`.click()` 却照样能触发，所以旧断言全绿）。
  现在自检用 `elementFromPoint` 直接断言控制区与三条热区"能命中且带 `.interactive`"。
- **控制区只由按钮收展，不要 `mouseleave` 自动收起**：指针从按钮挪到边缘时会先触发
  `mouseleave`，面板在点击落地前就收起来了，表现同样是"点了没反应"。
- **字幕条三个方向都可调**：左右边缘 `axis:'x'` 改宽度（写 `hud.subtitleWidth`），
  底部横条 `axis:'y'` 改高度（写 `hud.subtitleHeight`，64–400px）。
  `setHudSize` 新增 `minHeight`，因为 `axis:'y'` 需要能压到 96 以下；主进程轮询同样只在
  `pointermove` 断流 700ms 后才补位。

### 第二十一轮（字幕条交互修通 + 日韩识别 + 更密轮询）

- **"松手后还在拖"多半是 `pointerup` 丢了**：拖动实现里同时判 `e.buttons === 0`
  （`pointermove` 里带 0 就是松手），再加 window 级 `pointerup/pointercancel/blur` 兜底，
  并在主进程侧留 `HUD_RESIZE_STALE_MS = 2500` 的最后一道闸。
- **"鼠标移动快就拖不动"是去抖写反了**：上一版在"渲染进程最近 120ms 内有 move"时整轮跳过，
  快速拖动时事件稀疏反而一直跳过。现在渲染进程新鲜就以它为准，否则用真实光标的**增量**位移，
  并且每轮都以当前窗口几何为基准，不会跳变。
- **收起/展开必须同一个位置**：`.hud-rail` 用 `flex-direction: row-reverse`，
  toggle 恒贴最右、面板向左长；不要再用 rotate 翻转箭头（会和按钮里的文字箭头打架）。
- **字幕模式暂停图标要同步两处**：卡片 `#btn-pause` 与字幕 `#btn-sub-pause` 都由
  `renderPause()` 一起写，只改一个就是用户看到的"点了图标不变"。
- **长译文自动缩字**：`fitSubtitleFont()` 从配置字号逐 1px 试到 12px，
  以 `scrollHeight <= clientHeight - 22` 为终止条件；`renderCurrent()` / 切换模式 / 窗口 resize 三处触发。
- **自动选 OCR 语言不能只看置信度**：韩文模型读纯英文也有 0.99 的自信。
  得分 = 置信度 × 字形贴合度（`scriptRatio` 按语种统计假名/谚文/汉字/拉丁占比，**剔除标点符号**），
  并且对**整块画面**选一次语言而不是逐行选——逐行会把中日韩混排打成大杂烩。
- **CTC 置信度只统计真正吐字的那几步**：把 blank 步算进去，读不出字的模型也会显示 0.99。
- 自检写 PointerEvent 要带 `buttons: 1`；`store.patch(..., { silent: true })` 不会触发
  `config-changed`（等于改了不生效），验证链路要走近真实路径。

### 第二十二轮（CPU 与内存优化）

- **每轮整屏回读是 CPU 大头**：`desktopCapturer.getSources({thumbnailSize: 整屏物理分辨率})`
  会把整屏拉回来再裁剪，滚动字幕/视频场景下每轮都付这份钱。改成先 `peekRegion()`
  拿 480px 缩略图算 32px 灰度签名，再决定要不要截原图（`capture/electron.js`）。
- **去重必须前移到截图之前**：原来 `round.js` 是「截图 → OCR → 去重 → 翻译」，
  静态画面白跑一遍 OCR。现在外层先比帧指纹，命中直接复用上一轮整轮结果；
  **翻译失败也要写缓存**，否则失败那轮之后每一轮都会重试。
- **新增能力要记得在 `capture/index.js` 透传**：`peekRegion()`/`sameFrame()` 只加在 electron 后端、
  没挂到服务对象上，跳过逻辑等于没写（表现为"改了还是 42%"）。
- **`offline.autostart=false` 不等于"禁用离线"**：`ensureOfflineReady()` 不能因为 autostart 关闭就早退，
  那只该表示"开机不预加载"。用户手动加载/首次调用仍要能把模型拉起来。
- **模型常驻要有空闲卸载**：`offline.idleStopMs`（默认 10 分钟）+ `llama.touch()`/`armIdleTimer()`，
  1 GB GGUF 常驻 1.97 GB 是用户抱怨「内存 1140MB」的主要来源。
- **测量走 `--perf-probe`**：`scripts/perf-probe.js` 用 `app.getAppMetrics()` 采样各进程
  `cpu.percentCPUUsage` 与 `workingSetSize`；报数时说明这是"单核百分比"，
  否则用户会拿任务管理器的多核百分比对不上。
- **自动选 OCR 语言要带 hint**：`chooseLang()` 先用上一轮选中的模型试分，
  达到 `AUTO_RETRY_SCORE` 就不再跑另外两个模型，省一拍推理。

### 第二十三轮（字幕条拖拽重做 + 热区随尺寸缩放）

- **拖动/缩放必须统一参照系**：主进程轮询每次都把基准 rebase 成当前窗口几何，而渲染进程
  还在用「事件坐标 − start 坐标」算绝对位移 → 两条驱动重复累加。表现是"拖右边缘正常、
  拖左边缘和上下就抖/拖不动"，因为只有拖右边缘时窗口原点不动、两边数值恰好一致。
  现在统一成 `f(start 时的窗口几何, 当前屏幕光标)` 这个**幂等纯函数**，谁先算都一样。
- **`testCursor` 是自检的唯一入口**：几何改成绝对锚点后，真实光标在自检里不动 → 位移恒 0。
  主进程在 `--smoke-test` 下接受渲染进程传来的假光标，**但 preload 必须透传 `opts`**——
  这次 `hud.drag/hud.resize` 的签名没带 `opts`，导致 `testCursor` 被丢掉，检查假绿/假红。
- **热区厚度按窗口尺寸算**：`--edge-x = clamp(w*3%, 16, 40)`、`--edge-y = clamp(h*16%, 14, 44)`、
  `--grip-w/h` 同理，渲染进程在 `resize` 时重算；字幕条放大后能抓的地方自动变大。
- **指示条要"浅底深底都看得见"**：白条 + `box-shadow` 暗描边（双色），别只靠半透明白；
  底部横条铺开（左右各留 10%）比居中一小段更能表达"整条边都能拖"。
- **自检先拉正基线**：上一次自检被中断会残留 `hud.mode='subtitle'`，让
  `hudAutoHeight`/`hudSubtitleMode` 假失败。开跑前先把 `mode:'card'`、`autoHeight:true`、
  **`subtitleWidth/subtitleHeight/subtitlePoint` 归零**设好（拖动检查会把宽高写进配置），
  跑完仍整段还原用户快照；同时 `stopHudResize` 会写回 `subtitleWidth/Height`，
  还原必须放在所有拖动检查之后（这一点已经在流程里保证）。

### 第二十四轮（字幕条热区与设置区的边界）

- **设置区必须让开右侧改尺寸热区**：`.hud-rail` 用 `right: calc(var(--edge-x) + 14px)` 往内缩，
  并给 `z-index:8`（热区是 6）。否则 28px 宽的胶囊有 20px 落在 40px 的右侧热区里，
  鼠标点 ⚙ 时命中的是热区，表现就是"点设置很难"。
- **拖动握把同理**：`body.mode-subtitle .hud-head` 也 `right: calc(var(--edge-x) + 8px)`，
  贴边拖会变成"改宽度"而不是"挪窗口"。
- **视觉提示要"够看但不抢"**：热区仍然是厚的（14–44px，好抓），但可见指示条改为
  3px 宽、`opacity:.3`、`box-shadow: 0 0 0 1px rgba(0,0,0,.22)`；底边提示条从"左右各留 10%"
  改成居中 `clamp(宽*22%, 120, 320)`，用户反馈整条铺开"太大了"。
- **自检断言要跟着设计改**：`hudSubtitleRailSide` 原来断言"toggle 贴最右（距边 ≤30px）"，
  现在设计就是往里让 54px，断言改成"距右边 30–90px"。

### 第二十五轮（气泡菜单 + 二合一控制条 + 原文按需）

- **透明窗不要靠 resize 做弹出动画**：球窗口每次都长高会长出黑框（透明窗改尺寸会重绘底帧，
  再叠 `box-shadow`/`backdrop-filter` 更明显）。现在窗口固定 150×202，气泡用
  `opacity + transform` 淡入；`setBallExpanded()` 只切状态，**绝不 resize**。
- **透明窗收不到悬停事件**：气泡是否展开由主进程 `ball-pointer.js` 90ms 轮询光标决定
  （在球上→关穿透+展开；展开后仍在窗口内→保持；否则→开穿透+收起），渲染进程只负责画。
- **拖动区与设置区合一时，用位移阈值区分"点"与"拖"**：`pointerdown` 后位移 <3px 抬起＝切换展开，
  ≥3px＝`hud.drag()` 移动窗口；同一套阈值在悬浮球点击上也用过。
- **暂停图标只写 `data-state`**：卡片与字幕条各有按钮，`renderPause()` 只切 `running/paused`，
  图标显隐交给 CSS（`.ico-play`/`.ico-pause`）。之前一处用字符一处用图标、且只更新了一个按钮。
- **原文默认收起**：`renderCurrent()` 里 `sourceWrap.hidden = !(hasSource && state.sourceVisible)`，
  入口放在 `.hud-foot` 最左（`leftRatio ≤ 0.3`），自检 `hudSourceToggle` 验证"默认隐藏→点开→再点收起"。
- **自检截图要等过渡**：展开有 160ms 过渡，`shoot()` 前 `await sleep(280)`，否则拍到
  "按钮已出现、底色未淡入"的中间帧（看起来像样式没生效）。
- **PS 的 `.Replace()` 会吃掉反引号**：用 PowerShell 往 JS 里插 `executeJavaScript(\`…\`)` 时，
  反引号被当转义符，得到 `window is not defined`；这类改动一律用 `edit`/`write` 工具。

### 第二十六轮（悬浮球圆形气泡）

- **环形菜单的坐标只算一次**：`windows.js` 的 `BALL_LAYOUTS` 按极角给出每个气泡的 `left/top`，
  主进程算完随 `ball:state` 一起下发，渲染进程只负责落位——两边各算一套必然漂移。
- **弧线方向要跟着球的屏幕位置走**：`ballSideFor(point)` 用可用边距判断 `left/right/center`
  （贴右边→往左上长），窗口固定 200×200 永不 resize，球贴在对应角落。
- **球被拖走后必须重算方向**：`dragWindow` 结束时调 `refreshBallSide()`，若换了方向要
  `setPosition` 保持球原地，再广播新 layout（否则拖到左边缘后气泡仍从右侧顶出屏幕）。
- **自检要验几何而不是"有 4 个元素"**：`circleOk` 断言四个气泡 38×38、`border-radius:50%`、
  到球心距离都≈74px 且极差 ≤2；`ballEdgeFlip` 把窗口推到屏幕最左断言 `side` 翻成 `right`。
- **`getBounds()` 会取到中间态**：`showHud()` 的 resize 是异步的，刚切换模式就取 bounds 可能读到
  上一轮的尺寸（曾得到 945×549）。要么把期望几何显式 `setBounds` 后等一拍，要么在断言里标注
  "几何以截图/后续阶段为准"——不要用一次采样给模式判定。
- **别用 `edit` 改带模板字符串的自检块**：一次误删 `(() => {` 包裹，直接让
  `executeJavaScript` 抛 `Script failed to execute`，`checks` 整段缺失；改完立刻 grep 回读确认。

### 第二十七轮（拖动中丢失 pointer capture）

- **`lostpointercapture` 不是松手**：拖动时窗口本身在变形，被捕获的元素位置随之变化，
  Chromium 会**隐式释放** pointer capture 并派发 `lostpointercapture`。以前把它当松手直接收尾，
  于是「鼠标一快、窗口一抖，拖动就断」（用户原话：移动快点会丢失拖动状态）。
  现在捕获丢了只当降级：先试 `setPointerCapture(pid)` 抢回来，抢不到就靠 **document 级
  `pointermove/pointerup/pointercancel`（capture 阶段）**继续送坐标；只有真正的
  `pointerup`、`pointercancel`、或 `pointermove` 里 `buttons === 0` 才收尾。
- **三条拖动链路要一起改**：字幕条左右/底边热区（`bindEdgeResize`）、卡片标题栏拖动、
  字幕条控制条拖动（dock-handle）。只修一条，用户换个地方拖还是会断。
- **document 级监听必须在收尾时摘掉**：`finish/endDrag` 里成对 `removeEventListener`，
  否则每次拖动都叠一层，几百次后一次移动会发几百条 IPC。
- **自检要能人为制造"捕获丢失"**：`hudSubtitleCaptureLoss` 先拖起来 → 设假光标 +80px →
  派发 `lostpointercapture` → 再 +80px（`document` 上派发 pointermove）→ 断言宽度继续增长，
  最后 `pointerup` 后冻结。实测 1400 → 1480 → 1560 → 冻结 1560。
- **CSP 测试会盯 HTML 内联 `style`**：气泡错开序号 `--i` 不能写成 `style="--i:0"`，
  要在 JS 里 `node.style.setProperty('--i', i)`（CSSOM 不受 CSP 限制）。
  这条一直躺在 `integration/ipc-contract.test.js` 里，别等发版才发现。

## 7. 已记录的技术偏离（需在文档中保持一致）

| 偏离点 | 原方案 | 实际方案 | 原因 |
| --- | --- | --- | --- |
| 浮窗可聚焦 | M2-T2 规定 `focusable: false` | **`focusable: true` + `showInactive()`** | 实测 `focusable:false` 时 Windows 丢弃全部点击事件，按钮不可用；不抢焦点改由 `showInactive()` 保证 |
| 宿主壳 | Tauri（需求书倾向） | **Electron 28.3.3** | 本机无 Rust 工具链；Electron 属 F-01 允许三选一，透明窗与设置面板实现成本更低 |
| OCR 首选 | RapidOCR（onnxruntime） | **ONNX PP-OCRv4（`onnxruntime-node` + 自研行切分）为首选**，Windows OCR 与 Tesseract 依次兜底 | 第十五轮实测：16 张合成图 ONNX 全部 1.0000，Windows OCR 最好 0.8793；照片底图 ONNX 4/4 达标，单图 20–150ms（系统 OCR 约 800ms）。新增依赖 `onnxruntime-node@1.22.0` 已获用户批准，运行时只裁到 win32-x64（56.9MB） |
| 离线模型 | 首次启动下载 GGUF（M5-T4） | **已内置运行时 + 预置模型**：`runtime/llama/`（llama.cpp b12000）随包分发，`userdata/models/HY-MT1.5-1.8B-Q4_K_M.gguf`（ModelScope 取得） | 本机 hosts 代理使 huggingface 极不稳定（2-bit 573 MB 多次断流），改用 ModelScope 的 Q4_K_M；内存实测约 2.2 GB（N-02 目标 1.5 GB，已在第五份报告里如实记录） |
| 安装包 | `tauri build` 产 .msi | **portable 目录 + zip**（`scripts/package-win.js`） | `electron-builder` 属新依赖，需先走 CMD-02 审批 |
| 后台入口 | 托盘图标常驻（F-02） | **任务栏常驻 + 关闭即最小化 + 显式退出**：设置窗口 `skipTaskbar: false`，`close` 改为最小化；退出只走关于页「退出程序」/ 托盘退出 / `--quit` / JumpList | 本机托盘注册不稳定、`app.setUserTasks` 在 portable 形态返回 false，若只依赖托盘，用户关掉窗口后就没有入口 |
| 产品名与图标 | 显示名统一「即译」，图标为用户提供的二次元插画（去水印 → 程序化圆角 → 多尺寸 png + ico），数据目录名保持 `desktop-translator` | 用户需求，且避免配置/密钥失效 |
| 后台入口 | 关掉设置页与浮窗后不退出、任务栏不残留按钮，统一从托盘恢复；退出只走托盘右键、关于页或 `--quit` | 用户需求（原为最小化到任务栏） |
| 双击入口 | 直接运行 `electron.exe` 改名后的 exe | **C# 启动器（csc.exe 编译）+ `app\` 运行时目录** | 本机 Electron 无 `--no-sandbox` 必崩，需要启动器自动重试兼容模式 |
