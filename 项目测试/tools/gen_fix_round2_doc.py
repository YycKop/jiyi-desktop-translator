#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第二轮缺陷修复记录.docx》

内容全部来自本轮实测日志与退出码证据，不含任何真实桌面内容或密钥。
"""
import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "开发文档", "桌面翻译助手 第二轮缺陷修复记录.docx")
OUT = os.path.abspath(OUT)


def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = "微软雅黑"
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    if color:
        run.font.color.rgb = color


def para(doc, text, size=10.5, bold=False, space_after=4, color=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.35
    set_font(p.add_run(text), size, bold, color)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(text), 10)
    return p


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    run.font.name = "Consolas"
    run.font.size = Pt(9)
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")


def table(doc, rows, widths=None):
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = "Table Grid"
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            c = t.cell(i, j)
            c.text = ""
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            set_font(p.add_run(str(cell)), 9, bold=(i == 0))
            if widths:
                c.width = widths[j]
    return t


def build():
    doc = Document()
    doc.styles["Normal"].font.name = "微软雅黑"
    doc.styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    h = doc.add_paragraph()
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(h.add_run("桌面翻译助手 V1\n第二轮缺陷修复记录"), 20, True, RGBColor(0x1F, 0x3A, 0x5F))
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(sub.add_run("版本 1.0.0 · 2026-10-29 · 覆盖打包产物 dist/win-x64"), 9,
             False, RGBColor(0x66, 0x66, 0x66))

    doc.add_heading("一、本轮反馈与处理结论", level=1)
    para(doc, "用户反馈：双击启动后看不到「欢迎使用桌面翻译助手」窗口、托盘区没有图标、也没有首次引导；"
              "用 Ctrl+Shift+T 框选后浮窗提示「OCR 引擎不可用，请检查系统 OCR 语言包」。")
    para(doc, "经日志与退出码定位，这是两个**互相独立**的缺陷，均与「语言包缺失」无关：")
    bullet(doc, "缺陷 A（功能性）：打包环境里 WinRT OCR 读图被文件代理拒绝，导致 OCR 引擎探测失败，"
                "所有翻译轮次都以 OCR_UNAVAILABLE 结束。")
    bullet(doc, "缺陷 B（可用性）：应用是纯托盘常驻程序，已完成首次引导的用户再次双击时没有任何可见反馈；"
                "若已有实例在运行，后来的进程只会弹出一个小浮窗然后秒退，用户看到的就是「点了没反应」。")

    doc.add_heading("二、缺陷 A：OCR 引擎不可用", level=1)
    para(doc, "现象与证据", bold=True)
    code(doc, '[WARN][core:round] 单轮翻译失败 {"code":"OCR_UNAVAILABLE","ms":1014}\n'
              "selftest → ocr.engines.winrt = { ok: false, reason: '使用\"1\"个参数调用\"Wait\"时发生异常' }")
    para(doc, "根因定位过程", bold=True)
    para(doc, "① 先给 PowerShell 桥接函数 Await-Op 加 InnerException 展开，拿到真实错误：")
    code(doc, "await=StorageFile | << AggregateException: 发生一个或多个错误。\n"
              "<< UnauthorizedAccessException: 拒绝访问。无法访问指定的文件或文件夹。\n"
              "   该项目没有位于应用程序可以访问的位置（包括应用程序数据文件夹…）")
    para(doc, "② 对照实验（同一脚本、同一张合成图）：")
    table(doc, [
        ["运行方式", "结果"],
        ["手工在 PowerShell 里跑 winrt-ocr.ps1（项目代码目录 / 打包目录）", "ok=true，正确识别中英文"],
        ["系统 Node 24 通过 ps.js 派生 powershell", "ok=true"],
        ["Electron 自带 Node 18（ELECTRON_RUN_AS_NODE）派生 powershell", "ok=false，StorageFile 拒绝访问"],
        ["GUI 应用内（打包产物）", "ok=false，同上"],
    ])
    para(doc, "结论：脚本、OCR 语言包、图片都没有问题；是本机环境下**由 Electron 派生的子进程**里，"
              "WinRT 的 StorageFile 文件代理拒绝读取临时文件（即使该文件就在应用自己的数据目录里）。")
    para(doc, "修复", bold=True)
    bullet(doc, "scripts/winrt-ocr.ps1 弃用 StorageFile.GetFileFromPathAsync + OpenAsync，"
                "改为「System.IO.File 读字节 → InMemoryRandomAccessStream + DataWriter.StoreAsync → "
                "BitmapDecoder.CreateAsync(stream)」，完全绕开文件代理。")
    bullet(doc, "Await-Op 捕获后逐层展开 InnerException 链，抛 await=<类型> | <原因>，不再只有「发生一个或多个错误」。")
    bullet(doc, "该 .ps1 含中文注释，保存时保持 UTF-8 with BOM（Windows PowerShell 5.1 按 ANSI 解析会报错）。")
    para(doc, "验证", bold=True)
    code(doc, "selftest        → winrt: { ok: true, lang: 'zh-Hans-CN', ms: 184 }\n"
              "cli.js ocr      → { ok: true, engine: 'winrt', chars: 48,\n"
              "                     text: '欢 迎 使 用 桌 面 翻 译 助 手 / Hello World, this is a test.' }")
    para(doc, "（文本里的字间空格由 core/translate/prompt.js 的 collapseCjkSpaces 在进入翻译前折叠。）")

    doc.add_heading("三、缺陷 B：双击没有可见反馈", level=1)
    para(doc, "现象与证据", bold=True)
    table(doc, [
        ["观察点", "实测结果"],
        ["launcher.log", "多次点击均为「已处于兼容模式」+ 核心程序退出 code=0x00000000，耗时 291–492 ms"],
        ["core.log", "后启动的实例热键全部注册失败（被前面的实例占用），随后进程退出"],
        ["进程快照", "首次启动的实例（含启动器/主进程/GPU/网络/渲染子进程）一直存活"],
        ["startup-error.log", "不存在（说明没有触发启动失败分支）"],
        ["config.json", "onboarded = true（首次引导早已完成）"],
    ])
    para(doc, "根因", bold=True)
    para(doc, "① 已完成引导后，bootstrap() 不再打开任何窗口，程序是纯托盘常驻——对用户而言「什么都没发生」；")
    para(doc, "② 再次双击时新进程撞上单实例锁，只 showMessageBoxSync 提示后退出，"
              "已运行的实例仅弹出一个小浮窗（focusable:false、透明、位置不显眼），用户不会注意到。")
    para(doc, "修复", bold=True)
    bullet(doc, "main.js 新增 showLaunchHint()：onboarded === true 时显示「已就绪 · 按 Ctrl+Shift+T 框选区域，"
                "或右键托盘图标打开菜单」，6 秒后自动收起；若期间已产出翻译则保留浮窗。")
    bullet(doc, "新增 raiseVisibleWindow()：second-instance 事件按「首次引导 → 设置页 → 浮窗」顺序 "
                "show + focus + moveTop，并让托盘弹一次气泡；同时写日志 第二实例唤醒了主窗口 {shown:true}。")
    bullet(doc, "单实例分支原写 app.quit()，但 **ready 之前 quit() 是空操作**，进程会继续跑完 bootstrap"
                "（日志里能看到第二个实例又重新注册热键、重开宿主桥），直到 ready 后才被延迟退出。"
                "改为 app.exit(0)，并在 whenReady 开头加 if (!gotLock) return; 兜底。")
    bullet(doc, "打包脚本 package-win.js 改为只清理 app/ 与根目录文件，**保留 userdata/**（配置、日志、密钥密文），"
                "并用 maxRetries 抗住句柄延迟释放；删除失败时明确提示先退出程序。")
    para(doc, "验证", bold=True)
    table(doc, [
        ["验证项", "结果"],
        ["首次双击（onboarded=true）", "tasklist 显示窗口标题「译文浮窗」，6 秒后自动隐藏"],
        ["托盘图标", "core.log：托盘图标已重新挂载"],
        ["全局热键", "select/refresh/toggleHud/collapse 四个全部注册成功"],
        ["第二次双击", "core.log：第二实例唤醒了主窗口 {\"shown\":true}，新进程随即退出（不再静默）"],
        ["重复双击不产生第二个实例", "tasklist 中 desktop-translator-core.exe 进程数保持 4 个（主进程 + GPU/网络/渲染）"],
        ["宿主桥", "核心引擎初始化完成 → 宿主桥已启动 {port: 9958}"],
    ])

    doc.add_heading("四、回归测试", level=1)
    table(doc, [
        ["测试", "命令", "结果"],
        ["单元 + 集成", "node 项目测试\\run-all.js", "11 个文件 / 95 个用例，fail 0"],
        ["OCR 精度（D1.3）", "node --test 项目测试\\ocr-accuracy.test.js", "5 张合成图 pass 7 / fail 0"],
        ["应用自检", "node 项目代码\\scripts\\smoke.js", "ok=true，渲染错误 0，截图 6，托盘 true"],
        ["打包", "node 项目代码\\scripts\\package-win.js", "dist/win-x64 + zip（102.7 MB），启动器 9 KB"],
    ])

    doc.add_heading("五、用户侧排查手册（三步）", level=1)
    para(doc, "1）双击后没反应：先看 dist\\win-x64\\userdata\\launcher.log，最后一行会写明核心程序退出码。"
              "0x80000003 表示走了兼容模式（正常，启动器会自动重试）。")
    para(doc, "2）有进程但看不到窗口：执行 桌面翻译助手.exe --diag-windows，会打印每个窗口的 visible/bounds/url；"
              "已完成引导的情况下启动会先出现 6 秒的「已就绪」浮窗。")
    para(doc, "3）翻译报错：看 userdata\\core.log 中的 [core:round] 行，code 为 OCR_UNAVAILABLE / "
              "TRANSLATE_ALL_FAILED / MODEL_MISSING 分别对应 OCR、联网接口、离线模型三类问题。")

    doc.add_heading("六、变更记录", level=1)
    table(doc, [
        ["文件", "变更"],
        ["项目代码/scripts/winrt-ocr.ps1", "改用 InMemoryRandomAccessStream 读图；Await-Op 展开 InnerException"],
        ["项目代码/src/main/main.js", "新增 showLaunchHint / raiseVisibleWindow；second-instance 唤醒并记日志"],
        ["项目代码/scripts/package-win.js", "打包保留 userdata/，清理带回重试与明确错误提示"],
        ["项目代码/AGENTS.md", "第 6 节补充 3 条陷阱（WinRT 文件代理、启动可见反馈、打包保留数据）"],
        ["开发文档/本文件", "新增本轮修复记录"],
    ])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("已生成：", OUT)
    print("大小：", round(os.path.getsize(OUT) / 1024, 1), "KB")


if __name__ == "__main__":
    build()
