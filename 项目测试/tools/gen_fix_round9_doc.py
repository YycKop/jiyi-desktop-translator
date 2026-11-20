# -*- coding: utf-8 -*-
"""生成第九轮修复记录 DOCX（小字号中文识别 · 外观分离与浮窗可读性）。

用法：python gen_fix_round9_doc.py
输出：开发文档/桌面翻译助手 第九轮修复记录（中文小字识别·外观分离·浮窗可读性）.docx
"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(ROOT, "开发文档")
OUT = os.path.join(OUT_DIR, "桌面翻译助手 第九轮修复记录（中文小字识别·外观分离·浮窗可读性）.docx")

FONT = "微软雅黑"


def setup(doc):
    style = doc.styles["Normal"]
    style.font.name = FONT
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    for i in range(1, 4):
        h = doc.styles["Heading %d" % i]
        h.font.name = FONT
        h.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        h.font.color.rgb = RGBColor(0x1F, 0x2A, 0x37)


def h(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    return p


def para(doc, text, bold=False, size=10.5, color=None):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return p


def bullets(doc, items):
    for it in items:
        p = doc.add_paragraph(style="List Bullet")
        p.add_run(it)


def table(doc, headers, rows, widths=None):
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
            run.font.size = Pt(9)
    if widths:
        for r in t.rows:
            for i, w in enumerate(widths):
                r.cells[i].width = w
    return t


def main():
    doc = Document()
    setup(doc)

    title = doc.add_heading("桌面翻译助手 · 第九轮修复记录", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para(doc, "小字号中文识别率 · 浮窗与设置页背景分离 · 浮窗可读性", size=11).alignment = WD_ALIGN_PARAGRAPH.CENTER
    para(doc, "版本：V1.0.0（第九轮迭代）　日期：2026-10-31　范围：项目代码 / 项目测试", size=9).alignment = WD_ALIGN_PARAGRAPH.CENTER

    # 一、用户反馈
    h(doc, "一、本轮用户反馈", 1)
    para(doc, "用户原文：", bold=True)
    para(
        doc,
        "1.中文的识别率有问题，像这段，影响译文与原文；「自动」= 深底浅字 / 浅底深字，点「跟随背景」可恢复，"
        "识别只能到跟字，然后自识别成目，原文的文没有识别到，跟随背景的景识别成昱"
        "；2.浮窗和设置页的背景设置分离，而且目前浮窗的透明度有问题，看不清浮窗按钮和文字",
    )
    para(doc, "拆解为两个可独立验证的问题：", bold=True)
    table(
        doc,
        ["编号", "现象", "复现条件"],
        [
            ["P1", "设置页 14px 提示行识别错字：动→目、文丢失、景→昱", "中文小字号 + 深底浅灰字（#8A93A3 on #1A1016）"],
            ["P2", "浮窗在背景图下按钮与译文看不清；两处背景设置无法分开", "背景图不透明度 0.64，浮窗 389×302"],
        ],
        [Pt(40), Pt(230), Pt(230)],
    )

    # 二、P1 根因
    h(doc, "二、P1：小字号中文误识的根因", 1)
    para(doc, "先用 Python(PIL) + 微软雅黑渲染出与设置页一致的合成图复现（项目测试/fixtures/ui-hint-14px.png 等三张），"
              "再逐一排除假设。结论：不是反色、不是倍数、不是对比度，而是小字号汉字的笔画粘连。", bold=False)
    table(
        doc,
        ["处理方式", "14px 输出", "相似度", "结论"],
        [
            ["2x 原始（改前默认）", "「自动」= 冻底浅字…", "0.96", "深→冻"],
            ["3x 原始", "「目动」…点「跟随芍景」", "0.92", "更差"],
            ["4x 原始", "「目动」…", "0.88", "最差"],
            ["暗底反色（2x/3x）", "仍「冻底」/「目动」", "0.94/0.90", "无帮助，错误位置平移"],
            ["自动对比度 20/40/60", "「冻底」/丢字", "≤0.96", "部分丢字，反而更糟"],
            ["USM 锐化 160 + 2x", "「自动」= 深底浅字 / 浅底深字，点「跟随背景」可恢复", "1.0000", "全部正确"],
        ],
        [Pt(120), Pt(210), Pt(60), Pt(120)],
    )
    para(doc, "实现要点：", bold=True)
    bullets(
        doc,
        [
            "锐化在 GDI+ 上手工实现（内联 C# 类 OcrPrep）：双三次放大 → 1/3 下采样再放大得近似高斯模糊 → out = src + amount*(src - blur) → 对比度拉伸。GDI+ 的 ColorMatrix 只能做对比度，做不了卷积。",
            "默认值写进 src/core/ocr/winrt.js：scale=2、sharpen=160；PowerShell 侧参数 -Sharpen/-Contrast，派生图 .prep.png 由 Node 侧 finally 删除（FS-03）。",
            "顺带修掉一个隐蔽 bug：scripts/winrt-ocr.ps1 保存后丢了 BOM，PS 5.1 按 ANSI 读，中文注释把下一行代码吞进注释（$ocrPath 为空却不报错）。现在该脚本注释全部改为纯 ASCII，并加 BOM 校验流程。",
        ],
    )

    h(doc, "三、P1 验证结果", 1)
    table(
        doc,
        ["合成图", "字号/配色", "修复前", "修复后", "耗时"],
        [
            ["ui-hint-14px.png", "14px 深底浅字", "动→目、文丢失、景→昱", "全部正确（1.0000）", "320ms"],
            ["ui-hint-16px.png", "16px 深底浅字", "偶发错字", "全部正确（1.0000）", "309ms"],
            ["ui-hint-light.png", "14px 浅底深字", "同类错字", "全部正确（1.0000）", "312ms"],
            ["原有 9 张合成图", "中/英/标点/深底", "全部通过", "全部通过（无回归）", "540–730ms"],
        ],
        [Pt(120), Pt(110), Pt(120), Pt(130), Pt(60)],
    )

    # 四、P2
    h(doc, "四、P2：背景分离与浮窗可读性", 1)
    para(doc, "1）两处可分离：新增 appearance.bgImageScope（both / settings / hud），"
              "Theme.apply(doc, raw, {dataUrl, surface}) 按表面过滤；设置页「外观 → 背景图 → 生效范围」可选。")
    para(doc, "2）浮窗可读性（四层保护）：")
    table(
        doc,
        ["措施", "参数", "作用"],
        [
            ["图片不透明度上限（仅浮窗）", "min(opacity, 0.55)", "浮窗是小尺寸阅读窗口，图片过实必然压字"],
            ["浮窗薄罩", "--hud-veil = 0.40 + opacity×0.35（≤0.82）", "图片越实、罩越厚，保证文字对比度 ≥4.5:1"],
            ["标题栏底片", "--hud-head-bg = rgba(bgElevated, 0.72)", "图标不会落在亮部背景上消失"],
            ["按钮底片 + 文字投影", "--bg-elevated-veil / --text-shadow", "按钮边界清晰，译文与原文都有描边阴影"],
        ],
        [Pt(150), Pt(190), Pt(170)],
    )
    para(doc, "3）顺带修正：.translation 曾把文字颜色写死为 #f2f5fa，导致「浅底深字」主题下译文不可见，"
              "现统一用 var(--fg)；设置页的 body::after 全屏罩与 .content 半透明底叠加会让用户照片只剩 5%，已去掉全屏罩。")

    # 五、验证
    h(doc, "五、回归与验收", 1)
    table(
        doc,
        ["命令", "结果"],
        [
            ["node 项目测试\\run-all.js", "20 个文件 / 174 用例，失败 0（单元 126 + 集成 34 + OCR 14）"],
            ["node 项目测试\\run-all.js --only=ocr", "14/14 通过（12 张合成图 + 2 个汇总断言）"],
            ["node 项目代码\\scripts\\smoke.js", "ok=true 渲染错误=0 截图=10 托盘=true"],
            ["node 项目代码\\scripts\\package-win.js", "dist\\win-x64 重新打包完成（启动器 9KB），zip 126.8 MB"],
        ],
        [Pt(210), Pt(300)],
    )
    para(doc, "自检截图：项目测试/reports/electron-smoke/09-settings-bg.png（设置页背景）、10-hud-bg.png（浮窗背景与按钮底片）。")

    # 六、文件变更
    h(doc, "六、文件变更", 1)
    table(
        doc,
        ["文件", "变更"],
        [
            ["项目代码/scripts/winrt-ocr.ps1", "重写：内联 C# OcrPrep（放大 + USM 锐化 + 对比度）；参数 -Scale/-Sharpen/-Contrast；注释改纯 ASCII"],
            ["项目代码/src/core/ocr/winrt.js", "默认 sharpen=160；-Sharpen 传参；删除 .prep.png；返回 sharpened/meanLuma"],
            ["项目代码/src/renderer/shared/theme.js", "bgImageScope、surface 过滤、浮窗图片上限、--hud-veil 联动、--hud-head-bg、--text-shadow、--bg-veil 0.52"],
            ["项目代码/src/core/config/defaults.js、store.js", "新增 appearance.bgImageScope 及取值校验"],
            ["项目代码/src/renderer/hud/hud.css、index.html、app.js", "标题栏/按钮底片、文字投影、译文颜色改用 var(--fg)、传 surface"],
            ["项目代码/src/renderer/settings/index.html、app.js、settings.css", "「生效范围」下拉、去掉全屏罩、传 surface"],
            ["项目测试/fixtures/", "gen-cjk-ui-fixtures.py + ui-hint-*.png×3；gen-bg-photo.py + bg-photo.png（照片感背景）"],
            ["项目测试/helpers/fixtures.js", "登记三张小字中文回归图（阈值 0.98）"],
            ["项目测试/unit/theme.test.js", "新增 bgImageScope 与浮窗罩层两条用例（共 8 例）"],
            ["项目测试/tools/ocr-cjk-check.js", "小字中文三图快速复测脚本"],
        ],
        [Pt(230), Pt(280)],
    )

    # 七、已知限制
    h(doc, "七、已知限制", 1)
    bullets(
        doc,
        [
            "同形字仍可能错（如 口→囗）：属于字形层面无法用规则安全纠正的情况，不做强行替换。",
            "艺术字体、极细字重、半透明文字仍可能低于 95%，OCR 无法保证。",
            "浮窗图片上限 0.55 是「阅读优先」的取舍：若希望浮窗更花哨，可选「仅设置页」用大图、浮窗保持纯色。",
        ],
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    doc.save(OUT)
    print("saved:", OUT, os.path.getsize(OUT))
    print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables))


if __name__ == "__main__":
    main()
