# 即译（桌面翻译助手）（Desktop Translator Assistant）V1.0.0

在屏幕任意位置框选一段文字，浮窗即刻给出译文。翻译可选**联网 API**（任意 OpenAI 兼容服务，Key 由你自己填写）
或**本地离线模型**（llama.cpp + 混元 GGUF），联网失败自动降级，全程不上传屏幕内容。

- 宿主壳：Electron 28.3.3（锁定版本）
- 核心层：纯 Node，无 GUI 依赖，可脱离 Electron 单测
- OCR：Windows.Media.Ocr（系统内置，2x+3x 多遍识别择优），Tesseract 兜底
- 测试：15 个文件 / 116 个用例，零第三方测试依赖

## 快速开始

```powershell
cd 项目代码
node scripts/launch.js          # 启动（开发态数据目录在 项目测试\_runtime\home）
node scripts/smoke.js           # 应用自检：起窗口 → 截图 → 写 report.json
```

打包免安装版：

```powershell
node scripts/package-win.js     # 产出 dist/win-x64/ 与 zip
```

## 主要功能

| 能力 | 说明 |
| --- | --- |
| 框选翻译 | 默认热键 `Ctrl+Shift+T`，拖拽框选矩形，自动记住坐标 |
| 定时轮询 | 托盘切换 暂停/1s/2s/5s，同一区域持续取词（指纹去重 + 10 分钟译文缓存，不重复调用 API） |
| 后台驻留 | 关掉设置页与浮窗后程序仍在后台，任务栏不留按钮；托盘单击恢复，右键只有「设置 / 输入翻译 / 退出」 |
| 点击图标行为 | 设置页「启动 → 点击图标时打开」可选设置页或译文浮窗（F-02 语义） |
| 一键暂停 | 浮窗 `⏸` 按钮、`Esc`、热键 `Ctrl+Alt+S`、托盘顶层菜单，随时停掉正在跑的翻译 |
| 浮窗 | 半透明、无边框、始终置顶、默认点击穿透（悬停按钮才响应）、可收起为悬浮球（单击展开、拖动移动） |
| 识别精度 | 2x+3x 多遍识别后按「异常形状」打分**逐行择优**，修复 i/l、O/0 混淆（`PIease→Please`、`tO→to`）与中文标点（`, → ，`、`汉字间空格 → 去掉`） ｜ 小字号默认 USM 锐化（160%），14px 设置页文字也能整行认对 |
| 多 API 主备链 | 卡片式管理，拖动排序、启用开关、测试连接；按序串行，主 5s/备 3s，**只看失败/超时才切换** |
| 离线降级 | 联网全失败 → 本地 llama-server；浮窗底部显示「引擎：离线模式」 |
| 密钥安全 | AES-256-GCM + 机器指纹派生密钥，配置文件只有 `v1:` 密文，界面只显示 `sk-****abcd` |
| 多语言互译 | 34 种语言两两互译；中→中和「无需翻译」直接返回原文，**中→中文繁体走内置单字转换表（2712 条，零延迟不花钱）**，其余走模型 |
| 输入翻译 | 设置页「输入翻译」页签：粘贴/输入文字 → Ctrl+Enter 或按钮翻译，与浮窗共用同一套 API 与离线模型，可直接复制译文 |
| 任务栏驻留 | 关闭设置窗口只最小化到任务栏（图标即入口），退出请用「关于 → 退出程序」、托盘「退出」或 `--quit` |
| 外观自定义 | 设置页「外观」：主题色、背景色、**字体颜色（可跟随背景）**、不透明度、背景模糊、圆角、背景图（铺满/完整/平铺），带实时预览；浮窗背景图按卡片圆角裁切 |
| 两处背景图 | **浮窗与设置页各自一张图、各自一条不透明度**（设置页留空时沿用浮窗那张）；浮窗侧自动限制图片不透明度、加深罩层、按钮加底片，文字与按钮始终清晰不随图片变淡 |
| 浮窗自由尺寸 | 右下角拖拽（主进程 16ms 轮询 + 指针捕获，快速移动也不掉）、或填宽高（280–1200 × 96–900）；可开「高度自适应译文」 |
| 设置一键开关 | 浮窗标题栏 ⚙，点一次打开设置，再点一次关闭（按钮会高亮显示当前状态） |
| 热键自定义 | 设置页「按下新组合键」直接捕获，冲突会提示（不硬编码） |
| 首次引导 | 选目标语言 →（可选）离线模型 →（可选）配置 API |

## 目录

```
项目代码/
├── src/main/      主进程（窗口、托盘、热键、IPC、定位）
├── src/preload/   window.api 边界
├── src/renderer/  hud / overlay / ball / settings / onboarding
├── src/core/      截图、OCR、翻译链、配置、密钥、宿主桥、轮询、性能采样
├── src/shared/    IPC 通道与热键格式（主/渲染共用契约）
├── scripts/       launch / smoke / package-win / OCR 与截图辅助
├── launcher/      C# 启动器（打包时编成根目录 exe，负责启动与兼容模式重试）
├── runtime/llama/ llama.cpp 运行时（llama-server.exe，打包时复制进 app/resources/runtime/）
└── assets/        托盘与图标
```

## 离线翻译（已内置）

`runtime/llama/llama-server.exe`（llama.cpp b12000）随包分发，模型放数据目录 `models\` 即可：

1. 把 `*.gguf` 放进 `桌面翻译助手\userdata\models\`（本版本已预置 `HY-MT1.5-1.8B-Q4_K_M.gguf`，1.08 GB）。
2. 首次启动后程序会自动拉起离线模型（`offline.autostart`），浮窗引擎标识显示「离线模式」。
3. 也可手动管理：浮窗 `⚙` →「离线模型」→ 选择模型文件 / 启动 / 停止 / 线程数 / 端口。
4. 验证：断开网络后框选一段英文，译文出现且引擎显示「离线模式」。

实测（Ryzen 5 5600GT / 16 GB）：模型加载 1–3 秒，一段 14 词的英文≈1.1–1.2 秒；
`llama-server` 常驻约 2.0 GB，加上宿主壳 4 个进程共约 2.2 GB。
想进一步压低内存可换 1.8B 的 2-bit GGUF（约 574 MB），把文件放进同一目录即可（程序取第一个 `.gguf`）。

自动探测顺序：`offline.serverPath` → `app\resources\runtime\llama\llama-server.exe` → PATH；
模型：`offline.modelPath` → `userdata\models\` 下第一个 `.gguf`。

## 安全与合规

- 只采集框选区域，不截全屏、不做后台或定时截屏
- 出网仅两类：你填写的 API 端点和本机 `127.0.0.1:8081`
- 无遥测、无崩溃上报；日志只记长度与耗时，不记原文/译文/Key
- 详见 `SECURITY_CONSTRAINTS.md`（含 C-01~C-07 自查表）与 `AGENTS.md`

## 数据位置

| 内容 | 路径（便携版） | 路径（安装到其他位置时） |
| --- | --- | --- |
| 配置（含密钥密文） | `桌面翻译助手\userdata\config.json` | `%APPDATA%\desktop-translator\config.json` |
| 日志 | `桌面翻译助手\userdata\logs\app.log` | `%APPDATA%\desktop-translator\logs\app.log` |
| 离线模型 | `桌面翻译助手\userdata\models\*.gguf` | `%APPDATA%\desktop-translator\models\*.gguf` |
| 宿主桥信息 | `桌面翻译助手\userdata\bridge.json`（含一次性令牌，每次启动变化） | `%APPDATA%\desktop-translator\bridge.json` |
| 启动诊断 | `userdata\launcher.log`、`userdata\core.log`、`userdata\startup-error.log` | 同左，位于回落目录下 |

数据目录按 `TRANSLATOR_HOME` → `DT_DATA_DIR`（启动器自动注入）→ exe 同级 `userdata\` → `%APPDATA%\desktop-translator`
→ 临时目录的顺序，**逐个探测可写**后选用；开发/测试期脚本默认指向 `项目测试\_runtime\home`。

## 双击没反应怎么办

1. 打开程序目录下的 `userdata\launcher.log`，看最后一次尝试的退出码：
   - `0` 正常退出；`0x80000003`/`0xC0000005` 表示 Chromium 初始化失败（启动器会自动写 `safe-mode.flag`
     并用 `--no-sandbox --disable-gpu` 重试一次）
2. 看 `userdata\core.log`（应用自身日志）与 `userdata\startup-error.log`（主进程启动异常堆栈）。
3. 想确认"进程在跑但没有窗口"，可命令行执行 `桌面翻译助手.exe --diag-windows`，它会打印每个窗口的
   `visible/bounds/url` 后退出。
4. 若提示"已经在运行"，说明已有一个实例：到任务栏右下角 `^` 里找托盘图标（蓝色方块 + 白色 T）。

| 托盘图标自检 | 关于页显示托盘状态，可一键「重新挂载托盘图标」；托盘不可用时关闭设置页改为最小化，保证仍有入口 |

## 已知限制

- 独占全屏的商用游戏可能无法显示置顶浮窗（建议游戏切"无边框窗口化"）
- 14px 以下小字 OCR 精度下降（系统 OCR 分辨率限制）
- 在设置了 `ELECTRON_RUN_AS_NODE=1` 的终端里直接运行 `app\desktop-translator-core.exe` 会退化成 Node（报 `bad option`），
  该变量是部分 AI 开发环境自带的；通过根目录 `桌面翻译助手.exe`（C# 启动器）启动时启动器会主动清除该变量，正常双击不受影响
- 本机（Windows 10 沙箱）Electron 首次启动需要 `--no-sandbox` 才能初始化，启动器已内置"失败→兼容模式重试"逻辑；
  若你所在机器正常，首次启动不会触发重试，也不会留下 `safe-mode.flag`
- 离线模型内存约 2.2 GB（Q4_K_M + 4K 上下文），高于需求书 N-02 的 1.5 GB 目标；可改上下文为 2048 或换 2-bit 模型

## 打包

`node scripts/package-win.js` 产出 `D:\桌面翻译助手\dist\win-x64\`（portable，双击根目录 `桌面翻译助手.exe` 即用）
与 `D:\桌面翻译助手\dist\桌面翻译助手-1.0.0-win-x64.zip`。产物目录结构：

```
dist\win-x64\
├── 桌面翻译助手.exe         ← 双击这个（C# 启动器：清 ELECTRON_* 变量、注入数据目录、崩溃自动重试）
├── 使用说明.txt
├── app\
│   ├── desktop-translator-core.exe   ← Electron 运行时（不要直接双击）
│   └── resources\app\               ← 源码
└── userdata\                        ← 首次运行生成：config.json / logs / bridge.json / core.log
```

## 分发（分享给别人）

**`dist\win-x64` 不能直接外发**：它的 `userdata\` 里有开发机的配置（API 条目 + 密钥密文 + 盐）、屏幕框选坐标、
日志、宿主桥令牌、7.8 MB Chromium 配置和 `safe-mode.flag`。分享请走发布脚本：

```powershell
node scripts\package-win.js                      # 先构建本机便携版
node scripts\package-release.js                  # 含离线模型的发布包 + zip（约 1.2 GB）
node scripts\package-release.js --no-model --out=..\dist\release-nomodel   # 轻量包（约 140 MB zip）
node 项目测试\tools\verify-release.js <发布包目录>  # 换目录 + 空数据目录自检
```

发布包 = `dist\release\桌面翻译助手-1.0.0-portable\`，结构与本机便携版一致，但：

- `userdata\` 被整体剥离并重建为空目录（首次运行走欢迎引导，没有任何凭据残留）
- 离线模型放到 `app\resources\models\`（内置位置，数据目录不可写时也能找到）
- 增加 `NOTICE.txt`、`licenses\`（腾讯 HY 许可原文 + llama.cpp MIT + 第三方组件清单）、`首次使用说明.txt`

许可义务（Tencent HY Community License）：随附许可副本与 NOTICE、**不得分发到欧盟/英国/韩国**、
不得暗示腾讯背书、月活 > 1 亿需另行申请。详见 `开发文档\桌面翻译助手 分发与合规说明.docx`。
