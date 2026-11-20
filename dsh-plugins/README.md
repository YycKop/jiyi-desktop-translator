# dsh-plugins — DSH 侧插件（可选）

桌面翻译助手的核心能力在宿主壳（Electron）里。DSH 作为可选的"后台编排引擎"时，
通过以下两个自研插件调用宿主能力 —— **插件不截屏、不持有 API Key**，只经本机宿主桥转发。

```
DSH ──(tool: screen_ocr)──────► 宿主桥 POST /v1/host/ocr_region ──► 宿主壳截图+OCR
    └─(tool: translate_text)──► 宿主桥 POST /v1/host/translate_text ──► 联网API → 离线模型
```

## 目录

```
dsh-plugins/
├── dsh-plugin-screen-ocr/{package.json, patches/bundle.yaml, lib/index.js}
└── dsh-plugin-translate/ {package.json, patches/bundle.yaml, lib/index.js}
```

## 合规要点（环境配置清单第 4 节 PLG-01~05）

| 规则 | 落地 |
| --- | --- |
| PLG-01 `lib/index.js` 必须纯 JS | 两个插件都是手写 CommonJS，无 TS 源码、无构建步骤 |
| PLG-02 `package.json` 声明 `dsh.bundle.patch` | 均指向 `patches/bundle.yaml` |
| PLG-03 `patches/bundle.yaml` 必须存在 | 内容为 `[]`（不改运行时行为，只注册工具） |
| PLG-04 `execute` 响应 `exec.signal` | `callHost()` 里 `AbortSignal.any([signal, timeout])` 传给 `fetch` |
| PLG-05 验证 | `dsh --profile <sandbox> --dump-config`（需已安装 DSH CLI；本仓库未安装，未执行） |

## 运行前提

1. 宿主壳已启动（托盘常驻），宿主桥在 `127.0.0.1` 上监听随机端口；
2. 插件能读到 `bridge.json`（含 `port` 与一次性 `token`）。查找顺序：
   - `$TRANSLATOR_HOME/bridge.json`
   - `<仓库>/项目测试/_runtime/home/bridge.json`（开发期）
   - `%APPDATA%/desktop-translator/bridge.json`（正式安装）

## 本地自测（不依赖 DSH 运行时）

```powershell
# 用桩件验证插件协议与错误处理
node --test 项目测试\unit\plugins.test.js
```

## 已知限制

- `bridge.json` 的令牌每次启动都会变，插件在每次调用时**重新读取**，因此宿主重启后无需重载插件。
- 宿主壳未启动时工具会抛 `HOST_UNAVAILABLE`，提示"请先启动助手"，不会静默失败。
- 插件的工具注册入口做了能力探测（`ctx.registerTool` / `ctx.tools.register` / `ctx.tool`），
  三种都不存在时不会伪造 API，而是把工具定义原样返回，交由上层挂载。
