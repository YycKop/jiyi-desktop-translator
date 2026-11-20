#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第四轮修复记录：设置入口与托盘排查.docx》"""
import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "..", "..", "开发文档",
                                   "桌面翻译助手 第四轮修复记录（设置入口与托盘）.docx"))


def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = "微软雅黑"
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    if color:
        run.font.color.rgb = color


def para(doc, text, size=10.5, bold=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.35
    set_font(p.add_run(text), size, bold)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(text), 10)
    return p


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    set_font(p.add_run(text), 9)
    p.runs[0].font.name = "Consolas"
    p.runs[0]._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")


def table(doc, rows):
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = "Table Grid"
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            c = t.cell(i, j)
            c.text = ""
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            set_font(p.add_run(str(cell)), 9, bold=(i == 0))


def build():
    doc = Document()
    doc.styles["Normal"].font.name = "微软雅黑"
    doc.styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    h = doc.add_paragraph()
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(h.add_run("桌面翻译助手 V1\n第四轮修复记录：设置入口与托盘排查"), 19, True,
             RGBColor(0x1F, 0x3A, 0x5F))
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(sub.add_run("版本 1.0.0 · 2026-10-29 · 覆盖源码与 dist/win-x64 打包产物"), 9,
             False, RGBColor(0x66, 0x66, 0x66))

    doc.add_heading("一、用户反馈与结论", level=1)
    para(doc, "反馈：「浮窗可以拖动、按钮可以点了，但依旧没有打开设置页面，托盘图标也没有显示，没有进入设置页面的入口。」")
    para(doc, "结论分两部分：")
    bullet(doc, "设置窗口本身没有坏：用 `--open-settings` 启动、以及点击浮窗 ⚙ 后，"
                "窗口 `桌面翻译助手 - 设置`（780×620）立即出现并正确渲染（见第五节截图）。"
                "真正的问题是**入口只有托盘菜单一个**，而托盘图标不可见。")
    bullet(doc, "托盘图标在这台机器的当前 Windows 会话里**根本没有注册进通知区域**，"
                "与代码无关：用最小化 Electron 探针做 A/B 对比，测试前后通知区域按钮数完全不变。")

    doc.add_heading("二、托盘排查（A/B 证据）", level=1)
    para(doc, "方法：用 `Shell_TrayWnd → TrayNotifyWnd → SysPager → ToolbarWindow32` 的 "
              "`TB_BUTTONCOUNT`（0x0418）统计可见区图标数，对 `NotifyIconOverflowWindow → ToolbarWindow32` "
              "统计溢出区（^）图标数；分别在「应用未运行」「应用运行中」两次采样。")
    table(doc, [
        ["采样时刻", "可见区按钮数", "溢出区按钮数"],
        ["应用未运行（基线）", "2", "9"],
        ["应用运行 12 秒后", "2", "9"],
        ["最小化 Electron 探针运行中", "2", "9"],
    ])
    para(doc, "补充证据：")
    bullet(doc, "`tray.getBounds()` 在探针与本应用中恒为 `{x:0,y:0,width:0,height:0}`，"
                "即使按 Electron 文档创建成功也如此 → **不能用它判断图标是否可见**。")
    bullet(doc, "Chromium 也没有输出 `Unable to create status tray icon`（stderr 已重定向到 `userdata\\core.log`），"
                "说明 `Shell_NotifyIcon` 调用没有报错，但图标未进入通知区域。")
    bullet(doc, "结论：本会话（远程/自动化桌面）对 `Shell_NotifyIcon` 有额外限制；"
                "真实用户桌面需单独复测，不能把「托盘可见」写成验收硬指标。")

    doc.add_heading("三、修复内容：把「入口」做成四条", level=1)
    table(doc, [
        ["入口", "实现位置", "说明"],
        ["① 浮窗标题栏 ⚙", "`src/renderer/hud/index.html`（`#btn-settings`）+ `hud/app.js`",
         "调用 `api.settings.open('general')`；标题栏一并更新了提示文案"],
        ["② 再次双击 exe", "`src/main/main.js` `raiseVisibleWindow()`",
         "程序已在运行时双击，直接打开设置窗口（不再只弹小浮窗）"],
        ["③ 托盘双击 / 右键菜单", "`src/main/tray.js`",
         "新增 `double-click → 设置`；右键菜单保留「设置」子菜单（通用/API/热键/离线模型/关于）"],
        ["④ 命令行参数", "`src/main/main.js`（`--open-settings`）",
         "可做桌面快捷方式：`桌面翻译助手.exe --open-settings`"],
    ])
    para(doc, "顺带修掉的问题：")
    bullet(doc, "`tray.js` 的 `getBounds()` 探测原本会误报「图标未出现」并在日志里刷 warn，"
                "现降为 `debug`，不再触发额外重挂（依据见第二节）。")
    bullet(doc, "托盘重挂从「只重试 1 次」改为 `REASSERT_DELAYS = [1500, 6000, 20000]` 三次，"
                "覆盖 Explorer 繁忙/重启场景；图标尺寸由 16×16 改为 32×32（Windows 推荐值）。")
    bullet(doc, "引导页第 4 步与 `使用说明.txt` 补充「三种打开设置的方式」与「托盘图标可能在 ^ 里」。")

    doc.add_heading("四、验证", level=1)
    table(doc, [
        ["用例", "手段", "结果"],
        ["点浮窗 ⚙ 打开设置", "屏幕坐标点击（right-176px, top+17px）+ 枚举窗口", "出现 `桌面翻译助手 - 设置` 780×620"],
        ["再次双击 exe 打开设置", "第二次 `cmd /c start` 启动", "`第二实例唤醒了主窗口 {shown:true}`，设置窗口出现"],
        ["--open-settings", "`桌面翻译助手.exe --open-settings`", "启动即打开设置窗口"],
        ["设置页渲染", "`PrintWindow` 抓图", "5 个页签 + 翻译/浮窗/轮询表单 + 「上次框选 700,282 612×84」全部正确"],
        ["单元 + 集成测试", "`node 项目测试\\run-all.js`", "11 文件 / 95 用例，fail 0"],
    ])

    doc.add_heading("五、界面截图（自检产物）", level=1)
    para(doc, "浮窗（新增 ⚙ 为标题栏第一个按钮）：`项目测试/reports/hud-final.png`")
    para(doc, "设置窗口（点 ⚙ 后打开）：`项目测试/reports/settings-final.png`")
    para(doc, "截图均为本应用自身窗口的 `PrintWindow` 抓取，仅包含应用 UI 与合成测试文本，"
              "不含真实桌面内容（SCR-02）。")

    doc.add_heading("六、变更记录", level=1)
    table(doc, [
        ["日期", "变更", "文件"],
        ["2026-10-29", "浮窗新增 ⚙ 设置按钮与提示文案", "hud/index.html、hud/app.js"],
        ["2026-10-29", "第二实例直接打开设置窗口", "src/main/main.js"],
        ["2026-10-29", "托盘：双击开设置、32×32 图标、三次重挂、getBounds 降为 debug", "src/main/tray.js"],
        ["2026-10-29", "新增 --open-settings 参数", "src/main/main.js"],
        ["2026-10-29", "引导页/使用说明补充入口说明", "onboarding/index.html、scripts/package-win.js"],
        ["2026-10-29", "AGENTS.md 第 6 节新增托盘环境限制与入口清单", "项目代码/AGENTS.md"],
    ])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("saved:", OUT)


if __name__ == "__main__":
    build()
