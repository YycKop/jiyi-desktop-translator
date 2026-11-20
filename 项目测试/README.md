# 桌面翻译助手 · 项目测试说明

本目录是「桌面翻译助手」V1 的全部测试资产与测试文档。测试只使用 Node 内置 test runner
（`node --test`）与 Node 内置模块，**不引入任何第三方测试依赖**（限制书 DSH-02）。

## 目录结构

```
项目测试/
├── run-all.js                  总入口（聚合 单元 + 集成 + OCR 精度）
├── unit/                       单元测试（纯函数 / 单模块）
│   ├── store.test.js           配置存储：默认值、校验、API 卡片增删改排序、密钥加密落盘
│   ├── secrets.test.js         AES-256-GCM 加解密、掩码、篡改检测、常量时间比较
│   ├── prompt.test.js          提示词/文本清洗（含 OCR 汉字间空格折叠）
│   ├── chain.test.js           翻译调用链：主用→备用→离线降级、超时、取消、密钥不外泄
│   ├── loop.test.js            定时轮询引擎：节拍、防叠加、异常不中断
│   ├── position.test.js        浮窗定位：右侧/左侧/上/下、夹取、多显示器
│   ├── accelerator.test.js     热键规范化（设置页捕获与主进程注册必须同格式）
│   ├── fingerprint.test.js     文本指纹：i/l、O/0 归一、相似度、去重阈值、缓存键
│   ├── score.test.js           OCR 打分择优与 repairText（PIease→Please、tO→to）
│   └── plugins.test.js         DSH 插件协议、错误处理与打包合规（PLG-01~03）
├── integration/                集成测试（多模块协作 / 子进程 / HTTP）
│   ├── pipeline.test.js        单轮编排：截图→OCR→去重→翻译→结果映射
│   ├── dedupe.test.js          OCR 抖动不重复计费、真实变化重译、force 绕过、译文缓存
│   ├── bridge.test.js          宿主桥安全：仅本机、令牌鉴权、Origin 403、体积上限
│   └── ipc-contract.test.js    IPC 契约三方一致性 + 渲染进程安全边界 + CSP
├── ocr-accuracy.test.js        OCR 精度验收（Windows.Media.Ocr，16 张合成图，含 i/l 混淆与中文标点回归）
├── fixtures/                   测试用合成图（白/深底 + 渲染文字，不含真实桌面内容）
├── tools/                      开发辅助脚本（docx 提取、报告生成、图标生成、IIFE 包裹、OCR 倍数实验等）
├── helpers/                    测试辅助：环境隔离、文本相似度、图片清单
├── reports/                    测试产物（OCR 精度报告、倍数实验、Electron 自检截图与日志）
└── _runtime/                   测试期数据目录（TRANSLATOR_HOME，可随时删除）
```

## 运行方式

```powershell
# 1) 全量测试（单元 + 集成 + OCR 精度，22 个文件 / 187 个用例（第十一轮起自检断言含输入翻译面板与关闭最小化））
node 项目测试\run-all.js

# 2) 只跑某一组
node 项目测试\run-all.js --only=unit
node 项目测试\run-all.js --only=integration
node 项目测试\run-all.js --only=ocr

# 3) Electron 应用自检（启动真实窗口、截图、写报告）
node 项目代码\scripts\smoke.js
```

> 测试期间请确保 `TRANSLATOR_HOME` 指向项目目录内（`run-all.js` 与 `smoke.js` 已自动注入
> `项目测试\_runtime\home`）。这既满足限制书 FS-01「只写项目目录」，也避免污染真实用户配置。

## 通过标准（V1 验收口径）

| 测试项 | 通过标准 | 当前结果 |
| --- | --- | --- |
| 单元测试（15 个文件 / 126 个用例） | 全部通过 | ✅ 124/124 |
| 集成测试（4 个文件 / 34 个用例） | 全部通过 | ✅ 34/34 |
| OCR 精度（D1.3，中英印刷体） | 字符相似度 ≥ 0.95（16px 字幕图允许 ≥ 0.90） | ✅ 9/9（8 张 1.0，字幕图 0.9524） |
| 悬浮球 / 暂停按钮（回归） | 单击展开、暂停生效、再点恢复 | ✅ 自检 `ballClickExpands/pauseButton/resumeButton=true` |
| 主题 / 尺寸 / 背景图 / 字体颜色（回归） | 主题变量下发、拖拽改变尺寸、背景图与字色生效 | ✅ 自检 `hudThemeApplied/hudResize/hudBgImageApplied/hudTextColorApplied=true` |
| 背景图同步与裁切（回归） | 设置页与浮窗用同一张图、浮窗图被卡片圆角裁切、图上有可读薄罩 | ✅ 自检 `hudBgImageClipped/settingsBgImageApplied=true` |
| 语言互译（第八轮） | 34 种语言两两互译；中→中直接返回原文、中→繁体走内置转换表 | ✅ `unit/traditional.test.js`(15) + `unit/shortcut.test.js`(8) + `integration/pipeline.test.js` |
| Electron 自检（托盘/浮窗/设置/外观/遮罩/悬浮球/尺寸/背景图） | `ok=true`、渲染错误 0、截图 10 张 | ✅ 通过 |
| 单轮耗时（D1.6，200×100 区域） | ≤ 3s（离线）；联网 ≤ 2s（N-01） | OCR 多遍约 0.5s，详见自检日志 |
| 密钥安全（KEY-04/F-08） | 配置文件中无明文、界面仅掩码 | ✅ 用例断言文件不含明文 |

## 测试数据与隐私约束

- `fixtures/` 中的图片全部由 `gen-fixtures.ps1` 生成（纯色底 + GDI 渲染文字），**不含任何真实桌面内容**（SCR-02）。
- 测试不截取全屏、不做后台或定时截屏；OCR 用例读取的是图片文件，不是屏幕（SCR-01）。
- 测试报告中不写入 OCR 原文全文、译文全文或任何密钥（LOG-02）。

## 重新生成合成测试图
```powershell
# 注意：脚本含中文，必须以 UTF-8 BOM 保存后运行
powershell -NoProfile -ExecutionPolicy Bypass -File 项目测试\fixtures\gen-fixtures.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File 项目测试\fixtures\gen-il-fixtures.ps1
```

生成 5 张基础图：`zh-en-640x200.png`、`en-480x120.png`、`zh-480x140.png`、
`dark-640x160.png`、`small-360x90.png`；外加 3 张 i/l 混淆回归图
（`il-640x160.png`、`il-small-480x90.png`、`il-dark-560x120.png`）。

若字号小于 14px，系统 OCR 精度会明显下降（已实测：14px 时「幕」被误识别为「墓」），
这是 Windows OCR 的已知边界。i/l、O/0 混淆已由「多遍识别择优 + `repairText`」收敛，
实验数据见 `reports/ocr-scale-experiment.json`。
