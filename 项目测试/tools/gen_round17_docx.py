"""生成《即译 第十七轮记录（标题字标改版）》docx。"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

OUT_DIR = r"D:\桌面翻译助手\开发文档"
OUT = os.path.join(OUT_DIR, "即译 第十七轮记录（标题字标改版）.docx")

doc = Document()
style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(
    __import__("docx.oxml.ns", fromlist=["qn"]).qn("w:eastAsia"), "Microsoft YaHei"
)
for section in doc.sections:
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.2)
    section.left_margin = Cm(2.4)
    section.right_margin = Cm(2.4)


def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.name = "Microsoft YaHei"
        run.font.color.rgb = RGBColor(0x1F, 0x2A, 0x44)
    return p


def para(text, bold=False, size=10.5, space_after=6):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.35
    return p


def bullet(text):
    p = doc.add_paragraph(text, style="List Bullet")
    for run in p.runs:
        run.font.size = Pt(10.5)
    p.paragraph_format.space_after = Pt(3)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, name in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(name)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(str(val))
            run.font.size = Pt(9.5)
            cells[i].paragraphs[0].paragraph_format.space_after = Pt(2)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    return t


title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = title.add_run("即译 · 第十七轮记录")
r.bold = True
r.font.size = Pt(20)
r.font.name = "Microsoft YaHei"
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run("标题字标改版：平面圆润 + 副标语")
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(0x55, 0x5F, 0x75)
meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = meta.add_run("版本 v1.0.0　|　日期 2026-11-04　|　产物 dist\\win-x64（zip 166.9 MB）")
r.font.size = Pt(9)
r.font.color.rgb = RGBColor(0x77, 0x80, 0x92)
doc.add_paragraph()

h("1. 本轮需求", 1)
para(
    "用户提供了一张参考字标图：深墨色、笔画粗、转角圆润的「即译」二字，下方一行浅灰副标语「即时翻译，沟通无界」，"
    "并要求“软件标题改成类似我提供的图片这样的”。"
)
para(
    "结论：上一轮的「糖果贴纸」描边+渐变风格与参考图方向相反（参考图是平面、无描边、无渐变、字重更重），"
    "改为平面圆润字标 + 副标语。"
)

h("2. 实现方式", 1)
table(
    ["项目", "做法"],
    [
        ["素材生成", "项目测试/tools/gen_wordmark.py：黑体 8 倍超采样 → 逐字排布（字距 7×SS）→ 高斯模糊 1.2×SS + 阈值 127 磨圆转角 → 缩到 96px 高（显示 24px 的 4 倍）"],
        ["深浅主题", "输出两套：wordmark-light.png（#E9EDF5，深色标题栏）与 wordmark-dark.png（#2B3445，浅色标题栏）"],
        ["切换方式", "CSS 按 :root[data-theme=\"light\"] 切换两张 <img>，不依赖 JS"],
        ["副标语", "纯文本 span.brand-tagline，10.5px、--fg-faint、字距 0.08em，前置 1px 分隔线（::before，无额外 DOM）"],
        ["布局", "标题栏 flex：图标 20px → 字标 24px → 分隔线 → 副标语 → 版本号 → 关闭按钮；窗口宽度 < 520px 时隐藏副标语"],
        ["落地页面", "settings/index.html、onboarding/index.html 与各自 CSS（两页样式保持一致）"],
    ],
    widths=[3.4, 13.0],
)

h("3. 与上一轮相比的取舍", 1)
table(
    ["维度", "第十六轮（糖果贴纸）", "第十七轮（本轮）"],
    [
        ["字形处理", "白粗描边 + 粉蓝渐变 + 投影", "单色、无描边、无投影，靠字重与圆角"],
        ["观感", "卡通贴纸，抢眼", "平面品牌字标，克制"],
        ["与参考图一致性", "低", "高（粗笔画、圆润转角、带副标语）"],
        ["素材数量", "1 张", "2 张（深浅主题各一）"],
        ["旧素材", "assets/brand.png 与 gen_brand_art.py 保留在仓库，但已不被引用", "—"],
    ],
    widths=[3.2, 6.6, 6.6],
)

h("4. 调参过程", 1)
bullet("第 1 版：等线 Bold 直接绘制 + 模糊 2.2×SS —— 笔画偏细，和参考图的粗字重不符。")
bullet("第 2 版：改为描边 4×SS —— 笔画糊死，字腔（口、讠内部）几乎闭合。")
bullet("第 3 版：换黑体、描边 1×SS、模糊 1.6×SS —— 字腔恢复，但整体仍偏细。")
bullet("定稿：黑体 + 描边 2×SS + 模糊 1.2×SS，显示高度 24px，与参考图的字重/圆角最接近。")

h("5. 验证", 1)
table(
    ["验证项", "命令/来源", "结果"],
    [
        ["开发态自检", "node 项目代码\\scripts\\smoke.js", "ok=true 渲染错误=0 截图=13 托盘=true"],
        ["打包态自检", "即译.exe --smoke-test → userdata\\smoke\\report.json", "ok=True，rendererErrors=0，checks 仅有 jumpList / trayAccepted 为 false（本机环境限制）"],
        ["OCR", "report.json.ocr", "picked=rapid，probes.rapid=true"],
        ["浅色主题", "node 项目代码\\scripts\\light-preview.js（独立窗口渲染）", "浅底深字正常，副标语与分隔线显示正常"],
        ["打包", "node 项目代码\\scripts\\package-win.js", "dist\\win-x64 重新生成，zip 166.9 MB"],
    ],
    widths=[3.0, 8.0, 6.4],
)
para(
    "截图证据：项目测试/reports/arttext/titlebar-zoom.png（深色主题标题栏放大）、"
    "titlebar-light.png（浅色主题）、项目测试/reports/electron-smoke/02-settings-general.png。",
    size=9.5,
)

h("6. 已知限制", 1)
bullet("本机没有圆体字库（幼圆/思源黑体圆等），圆润感来自“模糊 + 阈值”对角点的磨圆，笔画末端仍保留黑体特征。")
bullet("字标是位图，字号固定；若将来要换成矢量或随字号缩放，需另做 SVG。")
bullet("标题栏高度 38px，字标 24px 已接近上限；再加大会挤压副标语与关闭按钮。")

doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT))
