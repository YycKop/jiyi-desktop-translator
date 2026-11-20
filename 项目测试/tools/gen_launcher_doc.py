"""生成《桌面翻译助手 V1 启动器与启动故障排查说明》docx。"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

OUT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_FILE = os.path.join(OUT_DIR, "开发文档", "桌面翻译助手 启动器与启动故障排查说明.docx")

FONT = "Microsoft YaHei"


def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def para(doc, text="", size=10.5, bold=False, color=None, align=None, space_after=6):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.4
    run = p.add_run(text)
    set_font(run, size, bold, color)
    return p


def bullet(doc, text, size=10.5):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.4
    run = p.add_run("· " + text)
    set_font(run, size)
    return p


def code(doc, lines):
    for line in lines:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Pt(18)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.2
        run = p.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(9)
        run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def heading(doc, text, level=1):
    h = doc.add_heading(level=level)
    run = h.add_run(text)
    set_font(run, 15 if level == 1 else 12.5, True, (0x1F, 0x3B, 0x73))
    return h


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, text in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(text)
        set_font(run, 9.5, True)
    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(str(text))
            set_font(run, 9)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Pt(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def main():
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = FONT
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    para(doc, "桌面翻译助手 V1 · 启动器与启动故障排查说明", 20, True, (0x1F, 0x3B, 0x73), WD_ALIGN_PARAGRAPH.CENTER, 4)
    para(doc, "版本 1.1 · 适用产物 dist/win-x64/桌面翻译助手.exe（C# 启动器）", 9.5, False, (0x66, 0x66, 0x66), WD_ALIGN_PARAGRAPH.CENTER, 14)

    heading(doc, "一、问题与结论摘要")
    para(doc, "问题：V1 首版交付后，用户反馈“双击软件没有反应”。现象为进程秒退、无任何界面与提示，"
              "任务栏无图标，%APPDATA% 下也没有生成任何数据目录。")
    para(doc, "结论：这不是功能缺陷，而是三处启动期问题叠加，全部已在本版修复：")
    bullet(doc, "① Chromium 初始化失败：在本机环境（Windows 10 19045 沙箱）下，Electron 不以 --no-sandbox 启动会立即以 "
                "0x80000003（STATUS_BREAKPOINT）退出，且 --disable-gpu、--user-data-dir 都无法绕过。")
    bullet(doc, "② 数据目录不可写：默认数据目录在 %APPDATA%\\desktop-translator，受限环境下 mkdir 报 EPERM，主进程启动即失败。")
    bullet(doc, "③ 子进程 stdio 管道死锁：从终端/CI 启动时继承了管道，Electron 持续写日志把管道写满，"
                "进程互相等待，窗口永远不显示——这是“看起来没反应”的最后一道障碍。")
    para(doc, "修复方案：打包产物根目录改为 C# 启动器（桌面翻译助手.exe），Electron 运行时移入 app/ 子目录；"
              "启动器负责清环境变量、注入数据目录、重定向 stdio 到日志文件，并在崩溃时自动以兼容参数重试一次。"
              "用户侧始终只需双击一个 exe。")

    heading(doc, "二、故障现象与退出码矩阵")
    para(doc, "诊断方法：用 .NET Process.Start 启动（不使用管道），读取退出码与 stderr；"
              "同时枚举窗口（class/title/visible/bounds）判断界面是否真的显示。实测矩阵如下：")
    table(
        doc,
        ["启动方式", "退出码", "结果解读"],
        [
            ["无参数（等价双击）", "0x80000003", "STATUS_BREAKPOINT：Chromium 初始化中断，窗口从未创建"],
            ["--disable-gpu", "0x80000003", "仅关 GPU 不够"],
            ["--user-data-dir=<可写目录>", "0x80000003", "仅改 profile 位置也不够"],
            ["--no-sandbox", "0xFFFF7003", "进入 JS 层，随后 mkdir C:\\Users\\...\\AppData\\Roaming\\desktop-translator 报 EPERM"],
            ["--no-sandbox --disable-gpu", "0", "成功启动（日志显示热键注册、宿主桥、托盘就绪）"],
            ["仅 JS appendSwitch('no-sandbox')", "0x80000003", "降级开关必须是真实命令行参数，JS 里设置太晚"],
            ["启动器 + stdio 继承管道", ">120s 无返回", "管道写满后死锁，窗口不显示"],
            ["启动器 + stdio 重定向到文件", "0", "窗口 660x520 正常显示，用户可见"],
        ],
        [150, 80, 260],
    )
    para(doc, "结论要点：--no-sandbox 必须作为真实命令行参数传入；降级逻辑只能由外部启动器完成，"
              "应用自身（main.js）在 Chromium 初始化之后才执行，无法自救。")

    heading(doc, "三、启动器设计（launcher/Launcher.cs）")
    para(doc, "启动器是一个 ~9KB 的单文件 C# WinForms 程序，由 Windows 自带的 csc.exe（.NET Framework 4.8，C# 5 语法）"
              "在打包时编译，零第三方依赖。职责如下：")
    table(
        doc,
        ["职责", "实现要点"],
        [
            ["定位核心程序", "app\\desktop-translator-core.exe；缺失时弹框提示“安装不完整”，不静默退出"],
            ["清理干扰变量", "移除父进程继承来的 ELECTRON_RUN_AS_NODE / ELECTRON_NO_ATTACH_CONSOLE，"
                            "否则 Electron 退化为纯 Node（报 bad option，退出码 9）"],
            ["注入数据目录", "EnvironmentVariables[\"DT_DATA_DIR\"] = <exe 目录>\\userdata，保证便携版数据留在程序目录"],
            ["固定 profile 位置", "启动参数追加 --user-data-dir=<userdata>\\electron-userdata"],
            ["吞掉子进程输出", "RedirectStandardOutput/Error → 追加写 userdata\\core.log（加锁），"
                              "既避免管道死锁，又给用户留下可反馈的日志"],
            ["崩溃自动重试", "退出码 ∈ {0x80000003, 0xC0000005, 0xC0000142} 且非兼容模式时，"
                            "写 userdata\\safe-mode.flag 并以 --no-sandbox --disable-gpu 再启动一次"],
            ["兼容模式记忆", "safe-mode.flag 存在则直接以兼容参数启动，避免每次首发都崩一次"],
            ["失败可见化", "仍失败则 MessageBox 提示并写 userdata\\launcher.log（含退出码、耗时、输出尾部）"],
            ["参数透传", "argv 原样透传，故 --smoke-test / --diag-windows 等诊断开关同样可用"],
        ],
        [110, 380],
    )
    para(doc, "关键代码片段（简化）：")
    code(
        doc,
        [
            "var psi = new ProcessStartInfo(core);",
            "psi.UseShellExecute = false;",
            "psi.RedirectStandardOutput = true;   // 必须：否则管道写满即死锁",
            "psi.RedirectStandardError  = true;",
            "psi.CreateNoWindow = true;",
            "psi.EnvironmentVariables.Remove(\"ELECTRON_RUN_AS_NODE\");",
            "psi.EnvironmentVariables[\"DT_DATA_DIR\"] = _dataDir;",
            "foreach (var a in args) psi.Arguments += Quote(a);",
        ],
    )

    heading(doc, "四、数据目录解析链")
    para(doc, "数据目录（配置、日志、密钥密文、Chromium profile、宿主桥文件）按以下顺序**逐个探测可写**后选用，"
              "结果缓存于进程内：")
    table(
        doc,
        ["优先级", "来源", "用途"],
        [
            ["1", "环境变量 TRANSLATOR_HOME", "开发与自动化测试（脚本指向 项目测试\\_runtime\\home）"],
            ["2", "环境变量 DT_DATA_DIR", "由启动器注入，便携版固定为 <程序目录>\\userdata"],
            ["3", "exe 同级 userdata\\", "直接运行核心 exe 时的便携位置"],
            ["4", "%APPDATA%\\desktop-translator", "常规安装位置"],
            ["5", "%TEMP%\\desktop-translator", "最后兜底，保证极端环境也能启动并留下日志"],
        ],
        [60, 180, 250],
    )
    para(doc, "探测方式：逐级 mkdir → 写入探针文件 → 删除探针 → 成功即采用；全部失败时退回临时目录并在界面提示。"
              "实现位于 项目代码/src/core/paths.js 的 resolveHome() / isWritable()。")

    heading(doc, "五、打包产物结构")
    code(
        doc,
        [
            "dist\\win-x64\\",
            "├─ 桌面翻译助手.exe          ← 双击这个（C# 启动器，8704 字节）",
            "├─ 使用说明.txt",
            "├─ app\\",
            "│   ├─ desktop-translator-core.exe   ← Electron 运行时（不要直接双击）",
            "│   ├─ resources\\app\\              ← 源码（66 个文件）",
            "│   └─ *.dll / *.pak / locales      ← Chromium 资源",
            "└─ userdata\\                        ← 首次运行生成：config.json / logs / bridge.json / core.log / launcher.log",
        ],
    )
    para(doc, "另产出 dist\\桌面翻译助手-1.0.0-win-x64.zip（约 102.7 MB，141 个条目，不含运行时生成的 userdata）。"
              "打包脚本：node 项目代码\\scripts\\package-win.js（每次构建先清空 dist\\win-x64，再组装、编译启动器、压缩）。")

    heading(doc, "六、验证结果")
    table(
        doc,
        ["验证项", "方法", "结果"],
        [
            ["首次双击（无任何参数）", "启动器 → 核心崩 0x80000003（77ms）→ 写 safe-mode.flag → 兼容模式重试", "成功启动"],
            ["窗口可见性", "EnumWindows 全桌面枚举", "Chrome_WidgetWin_1 visible=True 660x520「欢迎使用桌面翻译助手」"],
            ["数据落盘", "检查 userdata 目录", "config.json 1227B / bridge.json 169B / logs\\app.log / core.log / launcher.log"],
            ["自检套件", "node 项目测试\\run-all.js", "11 个文件、95 个用例全部通过（单元 67 + 集成 28）"],
            ["应用自检", "桌面翻译助手.exe --smoke-test", "退出码 0，ok=true，渲染错误 0，截图 6 张，托盘正常"],
            ["OCR 精度", "node --test 项目测试\\ocr-accuracy.test.js", "5 张合成图通过，中英印刷体相似度 ≥ 0.95（D1.3 达标）"],
        ],
        [110, 210, 170],
    )

    heading(doc, "七、用户排查手册（三步定位）")
    bullet(doc, "第一步：看 userdata\\launcher.log —— 记录每次尝试的时间、参数、退出码与耗时，"
                "有 safe-mode 重试也会写清；退出码 0x80000003/0xC0000005 即 Chromium 初始化类问题。")
    bullet(doc, "第二步：看 userdata\\core.log 与 userdata\\startup-error.log —— 前者是应用自身日志"
                "（只记操作类型、耗时与长度，不含原文/译文/Key），后者是主进程启动异常堆栈。")
    bullet(doc, "第三步：确认“进程在跑但没窗口”时，命令行执行 桌面翻译助手.exe --diag-windows，"
                "它会打印每个窗口的 title/url/visible/bounds 后退出；若提示“已经在运行”，到任务栏右下角 ^ 中找托盘图标。")

    heading(doc, "八、已知限制与后续")
    bullet(doc, "启动器以 Windows 自带 csc.exe 编译，产物未签名：首次运行可能出现 SmartScreen 提示“未知发布者”，"
                "需用户点击“更多信息 → 仍要运行”。正式发布应申请代码签名证书。")
    bullet(doc, "兼容模式（--no-sandbox --disable-gpu）会牺牲 Chromium 沙箱与 GPU 加速；这是受限环境的必要折中，"
                "普通用户机器通常首次即成功，不触发该分支。")
    bullet(doc, "当前为便携版 + zip；如需 .msi 安装包与开机自启，需引入 electron-builder（新依赖，须走 CMD-02 审批）。")
    bullet(doc, "后续可增加启动器健康检查（托盘图标是否创建成功、宿主桥是否监听）并在失败时自动重启应用。")

    heading(doc, "九、变更记录")
    table(
        doc,
        ["版本", "变更"],
        [
            ["1.0.0", "首版：Electron 28.3.3 宿主壳 + 浮窗/框选/托盘/设置/API 故障转移 + 系统 OCR + 宿主桥 + DSH 插件 + 95 个测试"],
            ["1.1（本文件）", "新增 C# 启动器与 app/ 运行时分层；数据目录探测链与 DT_DATA_DIR；stdio 重定向修死锁；"
                             "启动失败可见化（launcher.log / core.log / startup-error.log / --diag-windows）；托盘重建与通知去重"],
        ],
        [90, 400],
    )

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    doc.save(OUT_FILE)
    size = os.path.getsize(OUT_FILE)
    print("saved:", OUT_FILE)
    print("bytes:", size)
    print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables))


if __name__ == "__main__":
    main()
