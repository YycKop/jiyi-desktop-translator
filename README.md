# 即译 · 桌面翻译助手

> 在屏幕上框一段字，浮窗立刻给出译文。**可选联网 API，也可以完全离线**（本机 GGUF 模型），
> 截图只取你框的那一块，屏幕内容不外传。

![浮窗](docs/images/hud.png)

一个 Windows 桌面小工具，专治「游戏 / 视频 / 图片 / 报错弹窗里的字复制不了」。

- 框选即翻译：`Ctrl+Shift+T` 拖一个矩形，松手出译文
- 字幕条模式：细长透明条，只留描边文字，尽量不挡游戏画面，可拖边缘改宽高
- 离线可用：内置 llama.cpp 运行时，配好 GGUF 就能断网翻译
- 联网可换：任意 OpenAI 兼容接口（DeepSeek / OpenAI / 通义 / 自建网关），Key 加密存在本机
- 识别：ONNX PP-OCRv4（中英 / 日 / 韩）+ Windows 内置 OCR 兜底，标点与中英混排做了专门收敛

## 下载

到 [Releases](../../releases) 页面下载 `即译-1.0.0-portable-win-x64-nomodel.zip`，解压后双击 `即译.exe`。

| 包 | 大小 | 说明 |
| --- | --- | --- |
| `...-nomodel.zip` | ≈ 212 MB | 不含离线模型；可用联网 API，想离线再按下面「离线模型」自行放模型 |
| `...-portable-win-x64.zip` | ≈ 1.2 GB | 含 HY-MT1.5-1.8B-Q4_K_M，开箱即可离线（**受模型许可限制，见「许可」**） |

> 为什么默认提供不含模型的包：内置模型是腾讯混元社区许可，**不得分发到欧盟 / 英国 / 韩国**，
> 公开仓库挂全球可下载的包会与该许可冲突。需要离线时请自己在本地获取模型（见下）。

## 快速开始

1. 解压，双击 `即译.exe`。首次启动会有引导：选目标语言 → 下一步 → 完成。
2. 若出现「Windows 已保护你的电脑」：`更多信息` → `仍要运行`（未签名程序的正常提示）。
3. 按 `Ctrl+Shift+T`，在屏幕上拖一个矩形，松手即可看到译文浮窗。

常用热键（可在设置页改）：

| 动作 | 默认热键 |
| --- | --- |
| 框选翻译 | `Ctrl+Shift+T` |
| 重译上次区域 | `Ctrl+Shift+R` |
| 暂停 / 继续定时翻译 | `Ctrl+Shift+P` 或浮窗 `⏸`、`Esc` |
| 显示 / 隐藏浮窗 | `Ctrl+Shift+Y` |
| 收起为悬浮球 | `Ctrl+Shift+U` |

完整说明见 [docs/使用说明.md](docs/使用说明.md)。

## 界面

| 译文浮窗（原文默认收起） | 字幕条模式（视频 / 游戏） |
| --- | --- |
| ![浮窗](docs/images/hud-source.png) | ![字幕条](docs/images/hud-subtitle.png) |

| 设置 · 通用 | 设置 · 外观 |
| --- | --- |
| ![设置](docs/images/settings-general.png) | ![外观](docs/images/settings-appearance.png) |

悬浮球：鼠标移上去，选项以圆形气泡绕球展开。

![悬浮球](docs/images/ball-bubbles.png)

## 离线模型（可选）

1. 到 ModelScope 下载 `HY-MT1.5-1.8B-Q4_K_M.gguf`（Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF）。
2. 放进程序目录的 `userdata\models\`（没有就新建）。
3. 设置页「离线模型」里能看到它即可；引擎标识显示「离线模式」代表走本机模型。

没有模型时也可以用：设置 →「API 接口」→ 添加一个 OpenAI 兼容接口，填 Key 就能联网翻译。

## 从源码构建

需要 Node.js 24+、pnpm，以及 Windows 自带的 `csc.exe`（.NET Framework 4）。

```powershell
cd 项目代码
pnpm install
node scripts/launch.js          # 开发态启动
node scripts/smoke.js           # 应用自检（截图 + report.json）
node scripts/package-win.js     # 产出 dist\win-x64 与免安装 zip
node scripts/package-release.js --no-model   # 产出可对外分发的发布包
node 项目测试\run-all.js        # 全量测试（单元 / 集成 / OCR 精度）
```

架构与开发约定见 [项目代码/README.md](项目代码/README.md) 与 [项目代码/AGENTS.md](项目代码/AGENTS.md)。

## 隐私

- 截图只发生在你框选的矩形内，不上传、不落盘、不留日志正文。
- 联网翻译只把**识别出的文字**发给你自己配置的接口；没有任何遥测 / 统计 / 崩溃上报。
- 配置文件 `userdata\config.json`，API Key 以 AES-256-GCM 加密（机器指纹派生），界面只显示掩码。

## 已知限制

- 托盘图标在部分 Windows 会话里注册不上（系统通知区域限制），此时会自动显示悬浮球作为常驻入口。
- 未签名 exe 会触发 SmartScreen。
- 韩文识别模型不吐空格；自动识别语言对「中日韩混排同一屏」会取主导语言。
- 内存：离线模型常驻约 2.0–2.2 GB（空闲 10 分钟自动卸载，可关）。

## 许可

- 本项目代码：见仓库内各文件的说明；第三方组件与许可清单见发布包 `licenses\第三方组件与许可.txt`。
- **内置离线模型 HY-MT1.5-1.8B**：Tencent HY Community License。分发时须随附许可副本与 NOTICE；
  不得暗示腾讯背书；**不得分发到欧盟 / 英国 / 韩国**；月活超 1 亿需另行申请。
- OCR 模型（PP-OCRv4，Apache-2.0）、onnxruntime（MIT）、llama.cpp（MIT）、Electron（MIT）见许可清单。
