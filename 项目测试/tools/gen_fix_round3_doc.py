#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第三轮缺陷修复记录.docx》

主题：浮窗按钮点不动（聚焦标志 focusable:false 导致 Windows 丢弃点击事件）。
全部数据来自本轮实测日志、WindowFromPoint 结果与 IPC 追踪，不含真实桌面内容或密钥。
"""
import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "开发文档", "桌面翻译助手 第三轮缺陷修复记录.docx")
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
    set_font(h.add_run("桌面翻译助手 V1\n第三轮缺陷修复记录"), 20, True, RGBColor(0x1F, 0x3A, 0x5F))
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(sub.add_run("版本 1.0.0 · 2026-10-29 · 覆盖源码与打包产物 dist/win-x64"), 9,
             False, RGBColor(0x66, 0x66, 0x66))

    doc.add_heading("一、反馈与结论", level=1)
    para(doc, "用户反馈：**浮窗上的按键无法点击**（复制、重译、收起、关闭四个按钮都没有反应）。")
    para(doc, "结论：这不是渲染进程的事件绑定问题，而是 Windows 层面把这些点击丢掉了。"
              "浮窗创建时使用了 `focusable: false`（`WS_EX_NOACTIVATE`），该标志下窗口能收到 `mousemove`，"
              "但 `mousedown / mouseup / click` 全部被丢弃——表现为「悬停有高亮、点下去没反应」。")

    doc.add_heading("二、根因定位过程", level=1)
    para(doc, "步骤 1：给 IPC 加追踪开关，确认「点击有没有到主进程」", bold=True)
    code(doc, "DT_IPC_LOG=1 时，每次 IPC 调用都写一行日志：\n"
              '{"scope":"core:ipc","msg":"IPC 调用","channel":"translate:once"}')
    para(doc, "实测点击「重译」后，日志里**只有** `hud:set-ignore`（渲染进程的 mousemove 触发），"
              "从来没有 `translate:once`。说明点击事件根本没到渲染进程，而不是 handler 写错。")

    para(doc, "步骤 2：用 WindowFromPoint 确认点击落到了哪个窗口", bold=True)
    table(doc, [
        ["检查项", "结果"],
        ["浮窗窗口", "class=Chrome_WidgetWin_1 title='译文浮窗' vis=True topmost=True layered=True"],
        ["穿透开启时扩展样式", "ex=0x08080028（NOACTIVATE + LAYERED + TOPMOST + TRANSPARENT）"],
        ["穿透关闭时扩展样式", "ex=0x08080008（TRANSPARENT 被清除，命中测试返回浮窗本身）"],
        ["坐标换算", "460×240 窗口内四个按钮中心：距右边 32px 起、间距 36px"],
    ])
    para(doc, "第一次点击失败的真实原因之一是**测试脚本坐标算错**（点在按钮之间的 6px 空隙里）；"
              "修正坐标后仍然收不到 click，才锁定到 `WS_EX_NOACTIVATE`。")

    para(doc, "步骤 3：对照实验——把 `focusable` 改成 true", bold=True)
    code(doc, "// src/main/windows.js（ensureHud）\n"
              "focusable: process.env.DT_HUD_NOACTIVATE !== '1',   // 默认 true\n"
              "// 显示仍然用 showInactive()，不抢目标窗口焦点\n"
              "if (!win.isVisible()) win.showInactive();")
    para(doc, "改后同一套点击脚本立刻产生 `translate:once`，随后是截图与 OCR 日志；"
              "点「关闭」产生 `hud:hide` 且窗口可见性由 True 变 False。")

    doc.add_heading("三、修复内容", level=1)
    bullet(doc, "`src/main/windows.js`：浮窗 `focusable` 默认改为 true；F-17（不抢焦点）改由 `showInactive()` 保证；"
                "`DT_HUD_NOACTIVATE=1` 保留旧的 focusable:false 行为用于复现对比。")
    bullet(doc, "新增 `src/main/hud-pointer.js`（`HudPointerWatcher`）：主进程每 120ms 读取真实光标位置，"
                "光标不在浮窗内 → 保持穿透；在浮窗内 → 用 `executeJavaScript` 在渲染进程里做 "
                "`elementFromPoint(...).closest('.interactive')` 命中判断，命中才关闭穿透。"
                "之所以放在主进程：透明无边框窗口在穿透态下，`forward: true` 的 mousemove 常常收不到，"
                "只靠渲染进程永远无法把穿透关掉。")
    bullet(doc, "`src/main/ipc.js`：新增 `DT_IPC_LOG=1` 追踪开关（默认关闭），并保留 `DT_HUD_ALWAYS_INTERACTIVE=1` "
                "（始终可点击、不做穿透）用于二分排查。")
    bullet(doc, "`src/main/main.js`：启动/停止 `HudPointerWatcher`；第二实例改为唤醒并聚焦已有窗口；"
                "已引导用户启动时给出 6 秒浮窗提示。")

    doc.add_heading("四、验证结果", level=1)
    table(doc, [
        ["场景", "验证手段", "结果"],
        ["源码模式（默认，穿透 + 轮询）", "hud-click.ps1 点击重译/关闭", "translate:once → 截图(electron) → OCR(winrt)；hud:hide；可见性 True→False"],
        ["源码模式（DT_HUD_ALWAYS_INTERACTIVE=1）", "同上", "translate:once；hud:hide"],
        ["打包产物 dist/win-x64", "启动器启动 + 同上", "capture/OCR 日志出现；点击关闭后 visibleAfterClose=False"],
        ["单元 + 集成测试", "node 项目测试\\run-all.js", "11 个文件 / 95 个用例，fail 0"],
    ])

    doc.add_heading("五、本轮新增的排查工具（项目测试/tools 与 _tools）", level=1)
    table(doc, [
        ["工具", "用途"],
        ["hud-show.js", "读 bridge.json → POST /v1/host/hud/show，把浮窗显示出来（也用于没有热键的自动化环境）"],
        ["poke.ps1", "在指定屏幕坐标模拟单击，并回报该点实际命中的窗口标题"],
        ["hit-test.ps1", "列出 Z 序前 40 个窗口 + WindowFromPoint 命中结果，判断「窗口被谁挡住 / 是否穿透」"],
        ["grab-window.ps1", "PrintWindow(PW_RENDERFULLCONTENT) 抓取窗口位图，用于确认按钮真实位置"],
        ["hud-click.ps1", "枚举浮窗 → 按实测坐标点击按钮 → 报告点击前后可见性"],
    ])
    para(doc, "这些脚本只操作本应用自己的窗口与合成内容，不采集真实桌面画面（符合 SCR-01/SCR-02）。")

    doc.add_heading("六、变更记录", level=1)
    table(doc, [
        ["日期", "变更", "影响文件"],
        ["2026-10-29", "浮窗 focusable 默认 true，不抢焦点改由 showInactive 保证", "src/main/windows.js"],
        ["2026-10-29", "新增主进程光标轮询穿透控制器", "src/main/hud-pointer.js（新增）、src/main/main.js"],
        ["2026-10-29", "新增 DT_IPC_LOG / DT_HUD_ALWAYS_INTERACTIVE 诊断开关", "src/main/ipc.js、src/main/main.js"],
        ["2026-10-29", "AGENTS.md 补充两条陷阱与一条技术偏离", "项目代码/AGENTS.md"],
    ])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("saved:", OUT)


if __name__ == "__main__":
    build()
