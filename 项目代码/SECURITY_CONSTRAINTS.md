# SECURITY_CONSTRAINTS.md — 限制书落地与签署

本文件是《桌面翻译助手 AI 开发敏感操作限制书（SEC-CONSTRAINTS-001）》在代码仓库中的落地记录。
**任何 AI 代理或开发者在本仓库动手前必须读完本文件**；与 `AGENTS.md` 冲突时以本文件为准。

- 项目：桌面翻译助手（Desktop Translator Assistant）V1.0.0
- 仓库根：`D:\桌面翻译助手\`
- 记录日期：2026-10-28
- 会话权限：`workspace-write` + `ask`（PERM-01；未使用 `danger-full-access` 进行任何项目文件操作，PERM-02）

## 1. 硬约束与代码落点对照

| 条款 | 要求 | 本仓库如何满足 |
| --- | --- | --- |
| FS-01 | 只读写 `$PROJECT_ROOT` 及子目录 | 所有可写路径集中在 `src/core/paths.js`：`home()` 默认 `%APPDATA%\desktop-translator`，**测试/开发期由 `TRANSLATOR_HOME` 重定向到 `项目测试\_runtime\home`**；日志、模型、性能报告、临时截图全部经由该模块 |
| FS-02 | 不读写用户主目录、系统目录、AppData、`.ssh`、`.aws`、`.env` | 代码中无任何硬编码的用户目录路径；`paths.js` 只拼装 5 个受控子目录；仓库内无 `.env` 文件 |
| FS-03 | 调试截图只放 `tmp/` 且用完删除 | `paths.tmpDir()` = `$PROJECT_ROOT/tmp`；`src/core/capture/*`、`src/core/ocr/winrt.js` 写完即 `unlink`（含 `*.scaled.png`）；`项目测试/fixtures/` 中的图片是**生成**的合成图，不是截屏 |
| FS-04 | 禁止 `rm -rf` / `del /s /q` / 格式化 | 无任何递归删除调用；`safeUnlink()` 只删单个临时文件；仓库脚本中无 `rm -rf`、`Remove-Item -Recurse -Force` |
| CMD-01 | 禁止危险系统命令、改注册表/服务 | 唯一注册表读取是 `security/secrets.js` 里 **只读** 的 `MachineGuid`（`reg query`），用于派生本机加密密钥；无写入、无删除 |
| CMD-02 | 新依赖须人工确认 | 运行时依赖仅 `electron@28.3.3`（用户已确认 Electron 方案）；测试用 Node 内置 `node:test`；无其它 npm 包 |
| CMD-04 | 只向指定端点发数据 | 出网请求只有两处：用户自配的 OpenAI 兼容 `baseUrl`（`translate/openaiCompatible.js`）与 `http://127.0.0.1:8081`（离线 llama-server）；宿主桥只监听 `127.0.0.1` |
| KEY-01/02 | 不读取、不硬编码真实 Key | 代码与文档中无任何真实密钥；测试用 `sk-unit-test-…` / `sk-live-abcdef` 等明显伪造值 |
| KEY-03 | Key 不进日志/错误/遥测 | `core/log.js` 的 `redact()` 把 `sk-xxxx` 替换为 `sk-****`；`host/bridge.js` 的 `describeError()` 二次掩码并截断 200 字符；单测 `chain.test.js`「密钥只出现在 Authorization 头」断言错误对象序列化后不含明文 |
| KEY-04 | Key 内存解密、不明文落盘、不发非用户端点 | `security/secrets.js` 用 `AES-256-GCM`，密钥由 `scrypt(machineId, salt)` 派生；`secrets.items[id] = "v1:<iv|tag|ct>"`；渲染进程只看 `keyMasked`（`sk-****abcd`）；`store.test.js` 断言配置文件不含明文 |
| SCR-01 | 只采集框选区域 | `capture/electron.js` 与 `capture/win32.js` 都只接受 `{x,y,width,height}`，无全屏/定时/后台截屏；定时轮询是"按间隔重新采集同一框选区域"，间隔 ≥ 500ms |
| SCR-02 | 测试截图必须合成 | `项目测试/fixtures/gen-fixtures.ps1` 生成纯色底 + 渲染文字的 5 张图；OCR 用例读取文件而非屏幕 |
| SCR-03 | OCR 文本不外发 | 只在内存中流转：截图 → OCR → 用户端点或本地 8081；不写外部日志、不做统计 |
| LOG-01/02 | 日志不含原文/译文/Key | `log.js` 只记 `textMeta(text)`（`{len, sha8}`）；`pipeline/round.js` 日志记 `charsIn/charsOut/engine/耗时`，不记内容 |
| LOG-03 | 无遥测 | 代码中无任何上报 SDK、无 `fetch` 到统计域名；`app.setAppUserModelId` 之外无系统级注册 |
| DSH-01/03 | 只用本项目自研插件、禁幻觉包 | `dsh-plugins/` 两个插件均为本仓库自研；`package.json` 中未声明任何不存在的 `@deepseek-ai/dsh-*` 依赖 |
| DSH-05 / REV-001 | DSH 源码与构建产物只读 | 未修改 `node_modules/@deepseek-ai/*`；无 `patch-package`、无 `postinstall` |
| PLG-01~05 | 插件纯 JS / `dsh.bundle.patch` / `bundle.yaml` 存在 / 响应 `exec.signal` / `--dump-config` 验证 | 两个插件 `lib/index.js` 为纯 CommonJS；`package.json` 含 `dsh.bundle.patch`；`patches/bundle.yaml` 内容为 `[]`；工具 `execute` 接受并转发 `exec.signal` |

## 2. 高风险代码审查记录（限制书第 8 节）

| 位置 | 风险类型 | 审查结论 |
| --- | --- | --- |
| `src/core/translate/openaiCompatible.js:83-94` | 网络请求构造 | URL 只由用户配置的 `baseUrl` 拼接 `/chat/completions`；只加 `Authorization: Bearer <key>` 与 `Content-Type`；请求体只有 `model/messages/temperature/stream`；超时用 `AbortController` |
| `src/core/translate/hunyuanLocal.js:16-20` | 网络请求构造 | 硬编码 `127.0.0.1`，不可被配置改成远程地址（`host` 仅用于本地端口调试） |
| `src/core/host/bridge.js:106-210` | 本地服务暴露 | 仅 `127.0.0.1` 监听；一次性随机令牌（`randomBytes(24)`）+ 常量时间比较；Origin 白名单；请求体上限 256KB；不记录正文；错误响应二次掩码 |
| `src/core/security/secrets.js` | 加解密 / 凭据传递 | 密钥派生用 `scrypt`（N=16384,r=8,p=1）；`AES-256-GCM`；明文只在 `store.getApiSecret()` 与 `chain.translate()` 之间以参数传递，不落盘、不入日志、不出 IPC |
| `src/core/capture/win32.js`、`scripts/capture-region.ps1` | 子进程启动 | 参数以数组形式传递（无字符串拼接、无 shell 注入面）；只截指定矩形；PNG 写 tmp 后立即删除 |
| `src/core/paths.js` | 文件写入 | 写入目录固定为 5 个受控子目录；`ensureDir` 幂等；无用户可控路径拼接 |
| `src/main/main.js:31-40` | 路径/开关 | `app.setPath('userData')` 仅在 `TRANSLATOR_HOME` 显式设置时生效；`DT_NO_SANDBOX`/`DT_DISABLE_GPU` 仅测试期使用，打包后不设置 |

## 3. 交付前自查（C-01 ~ C-07）

| 编号 | 检查项 | 结果 |
| --- | --- | --- |
| C-01 | 无硬编码凭据（含占位符形式的真实值） | ✅ 通过（全文搜索 `sk-` 仅命中测试伪造值与掩码逻辑） |
| C-02 | 无向用户未指定端点的请求 | ✅ 通过（仅用户 `baseUrl` 与 `127.0.0.1:8081`） |
| C-03 | 日志无敏感内容 | ✅ 通过（`redact` + `textMeta`，单测覆盖） |
| C-04 | 依赖已审查 | ✅ 通过（仅 `electron@28.3.3`） |
| C-05 | 截图临时文件已清理 | ✅ 通过（`tmp/` 写后即删，含放大图） |
| C-06 | 权限申请与 F-09/F-10 一致 | ✅ 通过（截屏仅由框选/轮询触发，无开机自启、无后台权限申请） |
| C-07 | 例外记录全部关闭 | ✅ 无未关闭例外（见下节，本仓库无任何例外申请） |

## 4. 例外记录

本仓库**没有任何**安全例外申请。若将来需要，必须：

1. 在 `security/exceptions/` 下新建 `<日期>-<主题>.md`，写明条款编号、理由、影响范围、有效期；
2. 由项目负责人书面批准（记录批准人与时间）；
3. 批准前不得执行该操作；到期后要么改为合规实现，要么续批。

## 5. 违规处理

一旦发现违反上述任一硬约束：

1. 立即终止当前 AI 会话；
2. `git diff` 复核全部改动（本仓库尚无 git 时以文件时间戳与 `项目测试/tools` 脚本记录为准）；
3. 若涉及密钥外泄，立即轮换对应 Key；
4. 在 `security/incidents.md` 记录时间、条款、影响、处置与改进项。

## 6. 签署

| 角色 | 状态 | 说明 |
| --- | --- | --- |
| AI 开发会话（DSH, workspace-write + ask） | 已确认并遵守 | 本文件逐条对照代码，无未关闭例外 |
| 项目负责人 | 待确认 | 请在本文件末尾追加确认行：`已确认：<姓名> <日期>` |
