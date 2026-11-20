"""生成《即译 第二十六轮记录（悬浮球圆形气泡）.docx》。

用法：python gen_round26_docx.py
输出：D:\桌面翻译助手\开发文档\即译 第二十六轮记录（悬浮球圆形气泡）.docx
"""
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
import os

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十六轮记录（悬浮球圆形气泡）.docx"

doc = Document()

# 全局字体
style = doc.styles["Normal"]
style.font.name = "微软雅黑"
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia", "微软雅黑"
)


def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.color.rgb = RGBColor(0x1F, 0x2A, 0x44)
    return p


def para(text, bold=False, size=10.5, color=None):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return p


def bullet(text):
    p = doc.add_paragraph(text, style="List Bullet")
    for run in p.runs:
        run.font.size = Pt(10.5)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    for i, text in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(text)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(str(text))
            run.font.size = Pt(9.5)
    return t


# ---------------- 封面信息 ----------------
title = doc.add_heading("即译 · 第二十六轮记录", level=0)
for run in title.runs:
    run.font.color.rgb = RGBColor(0x1F, 0x2A, 0x44)
p = doc.add_paragraph()
run = p.add_run("悬浮球改为圆形气泡环绕")
run.bold = True
run.font.size = Pt(12)
run.font.color.rgb = RGBColor(0x4C, 0x8D, 0xFF)

para("版本 v1.0.0 ｜ 日期 2026-11-19 ｜ 交付物：dist\\win-x64（196.9 MB zip）", size=9.5)

# ---------------- 1 需求 ----------------
h("1. 本轮需求", 1)
para("用户原话：")
quote = doc.add_paragraph()
quote.paragraph_format.left_indent = Pt(18)
r = quote.add_run("我希望悬浮球弹出的应该像苹果系统那种圆形小气泡，每个选项一个气泡围绕在悬浮球旁边")
r.italic = True
r.font.size = Pt(10.5)

para("对照上一轮的实现（一个 150px 宽的竖排长条面板），本轮把菜单形态整体换掉：")
bullet("每个选项独立成一个 38px 圆形气泡，沿半径 74px 的圆弧围绕悬浮球排布。")
bullet("气泡只显示图标，鼠标悬停时才在气泡外侧浮出文字标签（设置 / 输入翻译 / 显示浮窗 / 退出即译）。")
bullet("弧形方向跟随球在屏幕上的位置：贴右边往左上长，贴左边往右上长，居中则向上张开。")

# ---------------- 2 设计 ----------------
h("2. 实现方案", 1)
para("窗口固定 200×200，永不 resize（避免透明窗改尺寸重绘出黑框），球贴在窗口的一个角上，气泡落在窗口内部。")
table(
    ["项目", "取值", "说明"],
    [
        ["窗口尺寸", "200 × 200", "固定不变，只切内容显隐"],
        ["球尺寸", "44 × 44", "图标裁圆，无投影"],
        ["气泡尺寸", "38 × 38", "border-radius:50%"],
        ["环绕半径", "74 px", "球心到气泡中心"],
        ["贴右（side=left）", "178,178 / 180°–270°", "往左上扇开"],
        ["贴左（side=right）", "22,178 / 270°–360°", "往右上扇开"],
        ["居中（side=center）", "100,178 / 215°–325°", "向上对称张开"],
        ["弹出动画", "scale(.55)→1 + opacity，错开 22ms", "气泡依次冒出"],
    ],
)

para("坐标只在主进程算一次：windows.js 的 BALL_LAYOUTS 按极角给出每个气泡的 left/top，"
     "随 ball:state 一起下发给渲染进程，渲染进程只负责把元素摆到这些位置上，两边不各算一套。")

# ---------------- 3 关键改动 ----------------
h("3. 关键改动", 1)
table(
    ["文件", "改动"],
    [
        ["src/main/windows.js",
         "新增 BALL_LAYOUTS / ballSideFor() / ballWorkArea() / ballLayout()；"
         "ballWindowPosition()、ballPointOf()、ballClientRect() 改为按 layout 计算；"
         "新增 refreshBallSide()，球被拖走后重算方向并保持球不动"],
        ["src/main/ipc.js", "stopHudDrag() 在目标是球窗口时调用 refreshBallSide()"],
        ["src/main/main.js", "setBallHover() 一并下发 layout；自检扩展 circleOk 与 ballEdgeFlip"],
        ["src/renderer/ball/index.html", "四个圆形 button.bubble（内联 SVG：齿轮/键盘/窗口/电源）+ 悬停标签"],
        ["src/renderer/ball/ball.css", "圆形玻璃气泡、按 --i 错开的弹出动画、按 data-side 决定标签挂左还是挂右"],
        ["src/renderer/ball/app.js", "applyLayout(layout) 落位球与气泡，onState 收到 layout 就重排"],
    ],
)

para("边界情况：")
bullet("球拖到屏幕另一侧后，refreshBallSide() 会重算 side；若方向变了，先用 setPosition 保持球原地，再广播新 layout。")
bullet("窗口贴近屏幕边缘时，200×200 的窗口会被屏幕裁掉一部分；球的位置按 layout 反推，实际球仍在光标处（不会跳）。")
bullet("气泡隐藏时整块容器 pointer-events:none，穿透由主进程 ball-pointer.js 按光标位置切换，与上一轮一致。")

# ---------------- 4 验证 ----------------
h("4. 验证", 1)
table(
    ["检查项", "结果"],
    [
        ["ballHover（4 个气泡几何）",
         "四个 38×38、border-radius:50%、到球心距离全为 74px（极差 0）、opacity 1；窗口 200×200 前后不变"],
        ["circleOk", "true"],
        ["ballEdgeFlip（贴左边界翻转）", "side=right、DOM data-side=right、球左边缘 2px、ok=true"],
        ["开发态 smoke", "ok=true 渲染错误=0 截图=17；除 jumpList / trayAccepted（本机环境限制）外全部 true"],
        ["打包态 smoke", "ok=true 渲染错误=0 截图=14；ballHover / ballEdgeFlip 均 true"],
        ["全量测试", "27 个文件、0 失败"],
    ],
)

# ---------------- 5 已知限制 ----------------
h("5. 已知限制", 1)
bullet("气泡文字标签在悬停时浮出，触摸屏/无鼠标场景看不到文字，只能靠图标识别。")
bullet("窗口尺寸固定 200×200，球贴到屏幕最右侧时窗口左侧留白会盖在桌面上（透明、不挡操作，但会占用一块 200×200 的透明区域）。")
bullet("同时打开多个圆气泡需要 200×200 的窗口，若显示器缩放 150% 以上，气泡间距在视觉上会更紧（逻辑像素不变）。")

# ---------------- 6 产物 ----------------
h("6. 产物", 1)
table(
    ["路径", "说明"],
    [
        ["dist\\win-x64\\即译.exe", "免安装程序（含日韩 OCR 模型、ONNX 运行时）"],
        ["dist\\即译-1.0.0-win-x64.zip", "内测压缩包（196.9 MB）"],
        ["开发文档\\即译 第二十六轮记录（悬浮球圆形气泡）.docx", "本文件"],
        ["项目测试\\reports\\electron-smoke\\15-ball-fan.png", "圆形气泡截图"],
    ],
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT), "bytes")
print("paras", len(doc.paragraphs), "tables", len(doc.tables))
