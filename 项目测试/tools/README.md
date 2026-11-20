# tools/ —— 开发辅助脚本

这些脚本不是产品运行时的一部分，只在开发/测试/交付时手工调用。

| 文件 | 用途 |
| --- | --- |
| `docx_extract.py` | 把 `开发文档/` 里的 docx 转成纯文本（段落 + 表格），输出到 `doc-text/` |
| `gen_v1_report.py` | 生成 `开发文档/桌面翻译助手 V1 实现说明与验收报告.docx` |
| `gen-icons.ps1` | 用 System.Drawing 生成托盘/应用图标（`assets/tray.png` 等） |
| `wrap-iife.js` | 给渲染脚本套 IIFE（避免与 contextBridge 全局名冲突，幂等） |
| `add-bom.ps1` | 给含中文的 `.ps1` 补 UTF-8 BOM（PowerShell 5.1 否则按 ANSI 读） |
| `probe_ocr.ps1` | 单独验证 Windows.Media.Ocr 是否可用 |
| `install-electron.ps1` / `install-electron-version.ps1` 等 | 安装/切换 Electron 版本（走 npmmirror 镜像） |
| `doc-text/` | 上述 docx 的纯文本快照，便于检索与 diff |

## 约定

- 所有 `.ps1` 一律**纯 ASCII**（中文提示改用参数传入），否则先用 `add-bom.ps1` 补 BOM。
- 脚本只读写项目目录内的文件；生成的临时图片落在 `tmp/` 并随即删除（限制书 FS-03）。
