"""生成《即译 第二十九轮记录（macOS / Linux 版本）》.docx"""

import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十九轮记录（macOS Linux 版本）.docx"

doc = Document()
style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(10.5)


def h(text, level=1):
    doc.add_heading(text, level=level)


def p(text, bold=False):
    para = doc.add_paragraph()
    run = para.add_run(text)
    run.bold = bold
    return para


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    for i, htext in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(htext)
        run.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = str(val)
    doc.add_paragraph()
    return t


h("即译 · 第二十九轮记录", 0)
p("macOS / Linux 版本：交叉打包、平台适配与发布")
p("版本 v1.1.0 | 完成 2026-11-25 | 产物 dist\\release（macOS×2、Linux×1）+ Windows 1.1.0")

h("一、需求", 1)
p("用户要求：「现在只有 Windows 版本，我想要推出 Mac 和 Linux 版本，你可以实现吗，"
  "如果可以为我提供 Mac 版本和 Linux 版本并上传到 github。」")

h("二、可行性判断", 1)
p("可以。Electron 的跨平台形态允许在 Windows 上「交叉组装」其他平台的包：")
table(
    ["要素", "做法"],
    [
        ["运行时", "从 npmmirror 直接下载官方 electron-v28.3.3-{darwin-arm64,darwin-x64,linux-x64}.zip"],
        ["应用负载", "复用打包好的 src/ + assets/ + licenses/ + NOTICE.txt + package.json"],
        ["原生依赖", "onnxruntime-node 自带六平台原生库，按目标平台裁剪 bin/napi-*/<plat>/<arch>"],
        ["OCR 模型", "PP-OCRv4 中/日/韩 ONNX 与字典随包（48 MB，平台无关）"],
        ["离线推理", "llama.cpp 二进制按平台不同，发布包不含；文档说明自行放置"],
    ],
)
p("局限：本机只有 Windows，无法真机验证，必须在文档与发布说明里如实标注。")

h("三、代码适配（平台差异）", 1)
table(
    ["位置", "问题", "改法"],
    [
        ["main.js 菜单", "Menu.setApplicationMenu(null) 在 macOS 上会让 ⌘Q/⌘C/⌘V 全部失效",
         "新增 applyApplicationMenu()：mac 建最小应用菜单（关于/设置 ⌘, /隐藏/退出 + 编辑 + 窗口角色）"],
        ["main.js 生命周期", "macOS 点 Dock 图标时无窗口可显示", "新增 app.on('activate') → 打开设置窗口"],
        ["llama/server.js", "非 Windows 找不到 llama-server 时抛 ENOENT，用户看到莫名 NPE",
         "按平台抛「当前平台未包含离线运行时：请把 llama-server 放到 runtime/llama/ 或改用联网 API」"],
        ["OCR / 截图 / 原生调用", "WinRT OCR、GDI 截图、PowerShell 仅 Windows",
         "已有平台守卫（ps.js / winrt.js / capture/win32.js）自动回落 ONNX OCR 与 desktopCapturer，无需改动"],
    ],
)

h("四、交叉打包器（scripts/build-cross.py）", 1)
p("新增 570 行 Python 脚本，仅用标准库，--target mac-x64|mac-arm64|linux-x64|all。")
table(
    ["平台", "结构", "关键处理"],
    [
        ["macOS", "即译.app/Contents/{MacOS/即译, Frameworks, Resources/app, Resources/runtime}",
         "Electron.app 改名、二进制改名、Info.plist 改写（Bundle ID com.jiyi.translator、图标、版本）、"
         "Helper 的 com.github.Electron 全部替换、ic07/ic08/ic09 三档 icns、保留 14 个符号链接"],
        ["Linux", "即译/（根目录）+ resources/{app,runtime} + 即译.sh + 即译.desktop + jiyi.png",
         "electron→即译、chrome-sandbox 4755、随包启动脚本带 --no-sandbox、.desktop 用 LF"],
    ],
)

h("五、打包过程中修掉的四个缺陷", 1)
table(
    ["缺陷", "现象", "根因与修法"],
    [
        ["ORT 目录裁剪按叶子名", "Linux 包里没有 libonnxruntime.so.1",
         "bin/napi-v6/linux 这一层被当作无关目录整个剪掉；改为按允许路径前缀判断（allowed 与 rel 互为前缀）"],
        ["ZipInfo.from_file() 覆盖压缩设置", "mac 包 305 MB，压缩率 0%",
         "from_file 自带 ZIP_STORED 且优先级高于 ZipFile(..., ZIP_DEFLATED)；显式设置 zi.compress_type"],
        ["Windows 无 unix 权限位", "tar 里全是 0666、zip 里可执行文件无 755，Linux/mac 上无法启动",
         "tar 用 TarInfo 显式 0755/0644/4755；zip 用 external_attr；mac 按路径推断可执行文件"],
        [".desktop 被写成 CRLF", "个别桌面环境把 \\r 带进 Exec，启动项失效",
         "open(..., newline='\\n') 显式 LF"],
    ],
)

h("六、产物", 1)
table(
    ["文件", "大小", "说明"],
    [
        ["即译-1.1.0-macos-arm64.zip", "144.0 MB", "Apple Silicon；416 条目、14 符号链接、即译 755"],
        ["即译-1.1.0-macos-x64.zip", "150.1 MB", "Intel"],
        ["即译-1.1.0-linux-x64.tar.gz", "153.5 MB", "430 条目；即译 755、chrome-sandbox 4755、即译.sh 755"],
        ["即译-1.1.0-portable-win-x64-nomodel.zip", "212.3 MB", "Windows 1.1.0 同步重建"],
        ["即译-1.1.0-win-x64.zip", "197.0 MB", "Windows 开发态包（含 app/ 目录）"],
    ],
)

h("七、验证", 1)
table(
    ["项目", "结果"],
    [
        ["全量测试 run-all.js", "27 个文件、0 失败"],
        ["Windows 打包态自检", "ok=true、rendererErrors=[]、14 张截图，仅 jumpList/trayAccepted 为 false（环境限制）"],
        ["Linux 包结构", "430 条目；即译 755、chrome-sandbox 4755、ORT linux/x64 库齐全、无 win32/darwin 残留"],
        ["macOS 包结构", "Info.plist 的 CFBundleExecutable/Name/Identifier/版本/图标均正确；"
                     "macOS Helper 的 Bundle ID 已改；ORT 只含 darwin/<arch>；无其他平台残留"],
        ["真机运行", "未验证（无 macOS / Linux 机器），已在 README 与发布说明中标注"],
    ],
)

h("八、已知限制", 1)
table(
    ["限制", "说明"],
    [
        ["未签名 / 未公证", "macOS 首次需右键→打开，或 xattr -dr com.apple.quarantine；Windows 触发 SmartScreen"],
        ["Linux 沙箱", "解压后 chrome-sandbox 非 root 所有，随包脚本带 --no-sandbox；恢复方式见说明"],
        ["Wayland", "全局热键与置顶受限，建议 X11 或 XWayland"],
        ["离线翻译", "三平台均需自备对应平台 llama-server 与 GGUF 模型"],
        ["分发许可", "模型为混元社区许可，不得分发到欧盟/英国/韩国，故三个包均不含模型"],
    ],
)

h("九、使用与产物位置", 1)
p("· 源码改动：src/main/main.js、src/core/llama/server.js、scripts/build-cross.py（新增）、package.json（1.1.0）")
p("· 文档：README.md（三平台下载表 + 首次打开说明）、docs/使用说明.md、docs/开发说明.md")
p("· 发布：gh-publish.ps1 增加 -ExtraAsset，可一次上传 Windows/macOS/Linux 四个资产")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT), "bytes;", len(doc.paragraphs), "paras", len(doc.tables), "tables")
