# -*- coding: utf-8 -*-
r"""生成《即译 第十五轮记录（ONNX 识别引擎接入·引擎切换）》并附加第十四轮 OCR 修复附记。

用法（需先加载 python-docx）：
    python 项目测试\tools\gen_round15_docx.py
输出：开发文档\即译 第十五轮记录（ONNX 识别引擎接入·引擎切换）.docx
"""
import datetime
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "开发文档", "即译 第十五轮记录（ONNX 识别引擎接入·引擎切换）.docx")

ACCENT = RGBColor(0x2B, 0x5C, 0xFF)
MUTED = RGBColor(0x6B, 0x72, 0x80)
OK = RGBColor(0x0B, 0x8A, 0x3E)
BAD = RGBColor(0xB4, 0x23, 0x18)


def set_font(run, name="微软雅黑", size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def h1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    set_font(p.add_run(text), size=15, bold=True, color=ACCENT)
    return p


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(9)
    p.paragraph_format.space_after = Pt(3)
    set_font(p.add_run(text), size=11.5, bold=True)
    return p


def para(doc, text, size=10.5, color=None, bold=None, space_after=4):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.45
    set_font(p.add_run(text), size=size, bold=bold, color=color)
    return p


def bullet(doc, text, size=10.5):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.4
    set_font(p.add_run(text), size=size)
    return p


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(10)
    p.paragraph_format.space_after = Pt(6)
    set_font(p.add_run(text), name="Consolas", size=9)
    return p


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, text in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_font(p.add_run(text), size=9.5, bold=True)
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cell = cells[i]
            cell.text = ""
            p = cell.paragraphs[0]
            if i > 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            text = str(value)
            color = None
            if text.startswith("+"):
                color = OK
            elif text.startswith("-"):
                color = BAD
            set_font(p.add_run(text), size=9.5, color=color)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Pt(w)
    return t


def build():
    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = Pt(56)
    sec.right_margin = Pt(56)
    sec.top_margin = Pt(48)
    sec.bottom_margin = Pt(48)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(title.add_run("即译 · 第十五轮记录"), size=19, bold=True, color=ACCENT)
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(sub.add_run("接入 ONNX 识别引擎 + 识别引擎可切换"), size=12, color=MUTED)
    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(
        meta.add_run("桌面翻译助手 V1 · 版本 1.0.0 · 生成于 " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M")),
        size=9,
        color=MUTED,
    )

    # ---------- 1 ----------
    h1(doc, "1. 本轮要解决的问题")
    para(doc, "上一轮把 Windows 自带 OCR（Windows.Media.Ocr）的标点与低对比度问题压到了极限，但有两类错误靠规则修不动：", size=10.5)
    bullet(doc, "同形字：窗→囗、技→枝、字→孑，字形差异小于任何阈值规则能判别的程度；")
    bullet(doc, "12–13px 小字：字的笔画只有 1–2 像素宽，系统 OCR 在放大后依然会把「动/文/景」认成「目//昱」。")
    para(
        doc,
        "因此本轮按用户指示「允许接入新的引擎解决识别问题，同时允许切换识别引擎」，把主力识别换成 ONNX 版 PP-OCRv4（RapidOCR 同款模型），"
        "Windows OCR 与 Tesseract 保留为兜底，并在设置页提供「识别引擎」下拉框。",
    )

    # ---------- 2 ----------
    h1(doc, "2. 新增依赖与体积")
    para(doc, "按 CMD-02 / DSH-02，新依赖先列清单再安装（已获用户批准）：", size=10.5)
    table(
        doc,
        ["包名", "版本", "用途", "安装体积", "打包后"],
        [
            ["onnxruntime-node", "1.22.0", "ONNX 推理运行时（原生模块）", "247 MB（六平台）", "56.9 MB（仅 win32-x64）"],
            ["PP-OCRv4 rec mobile", "—", "中文/英文行识别模型", "10.4 MB", "10.4 MB"],
            ["PP-OCRv4 det mobile", "—", "文本检测（本轮未接入，预留）", "4.5 MB", "4.5 MB"],
            ["ch_ppocr_mobile cls", "—", "方向分类（本轮未接入，预留）", "0.6 MB", "0.6 MB"],
            ["ppocr_keys_v1.txt", "—", "6623 字字典", "26 KB", "26 KB"],
        ],
        widths=[110, 70, 150, 90, 110],
    )
    para(
        doc,
        "说明：选 1.22.0 而不是最新的 1.31.1，是因为 1.31.1 发布不足 30 天，不满足依赖审查的「发布 > 30 天」规则；"
        "模型来自 ModelScope（本机 hosts 会把 huggingface/github 劫持到本地代理，无法稳定下载）。",
        space_after=6,
    )

    # ---------- 3 ----------
    h1(doc, "3. 引擎实现")
    h2(doc, "3.1 识别链路")
    para(doc, "不接检测模型（det），行切分自己做，链路更短、可调点更少：", space_after=4)
    code(
        doc,
        "PNG 解码(zlib) → 灰度 → 局部均值墨迹图(r=6) → 行/列投影切行\n"
        "→ 行高 48 等比缩放 → 归一化 [1,3,48,W] → PP-OCRv4 rec 推理\n"
        "→ CTC 解码(blank=0/去重/字典) → cleanLine(去行首行尾引号) → repairCjkPunctuation",
    )
    para(doc, "新增文件：`src/core/ocr/png.js`（纯 zlib 手写 PNG 解码）、`src/core/ocr/rapid.js`（约 340 行）、`src/core/ocr/index.js`（引擎注册与切换）。", size=10)

    h2(doc, "3.2 调参中修掉的四个真缺陷")
    table(
        doc,
        ["现象", "根因", "修法"],
        [
            ["带边框的截图被切成一行", "边框竖线让整幅图都有墨迹", "行阈值改为 max(3, 2%宽, 12%最大行墨迹)"],
            ["深色主题整行识别为空", "反相后仍用反相前极值做拉伸", "极性反转后重算 min/max"],
            ["前引号「被当成边框删掉", "列墨迹占比裁边误伤竖笔字", "放弃密度裁边，改在 cleanLine 剥引号"],
            ["照片底文字完全识别不出", "整幅图众数背景不适用于渐变/照片", "改局部均值墨迹图 + 整行对比拉伸"],
        ],
        widths=[120, 150, 190],
    )

    # ---------- 4 ----------
    h1(doc, "4. 识别引擎切换")
    para(doc, "设置 → 通用 → 识别引擎，四个选项：", space_after=4)
    table(
        doc,
        ["选项", "行为"],
        [
            ["自动（默认）", "按 rapid → winrt → tesseract 顺序探测，用第一个可用的"],
            ["ONNX（PP-OCRv4）", "固定用新引擎；不可用时直接报错，不静默降级"],
            ["Windows OCR", "固定用系统 OCR（旧主力，标点规则与多遍投票仍生效）"],
            ["Tesseract", "固定用 Tesseract（本机无 tesseract 二进制，会报告不可用）"],
        ],
        widths=[130, 330],
    )
    para(
        doc,
        "改动落在三处：`store.patch()` 白名单校验、`core/index.js` 初始化与 change 事件各同步一次 preferred、"
        "设置页下拉回填与提交；`pick()` 对已选引擎有缓存，切换时必须清空缓存，否则「改了不生效」。",
        space_after=6,
    )

    # ---------- 5 ----------
    h1(doc, "5. 实测数据")
    h2(doc, "5.1 合成图（16 张，中英/浅底/深底/小字/易混字符/中文标点）")
    table(
        doc,
        ["引擎", "最低相似度", "满分张数", "单图耗时"],
        [
            ["ONNX PP-OCRv4", "+1.0000", "16 / 16", "20–150 ms"],
            ["Windows OCR（上一轮最好成绩）", "0.8793", "—", "约 800 ms"],
        ],
        widths=[180, 110, 100, 110],
    )
    para(doc, "上一轮的 0.8793 与几个同形字错误（窗→囗、技→枝）在本轮全部消失，规则层（score.js）不再需要为它们兜底。", size=10)

    h2(doc, "5.2 照片底/半透明面板底（上一轮的难点）")
    table(
        doc,
        ["样本", "Windows OCR 上一轮", "ONNX 本轮"],
        [
            ["白字无面板 bg-white-20px", "0.9516", "+1.0000"],
            ["深字+70% 白面板 bg-panel-20px", "0.9677", "+0.9841"],
            ["浅灰字 bg-gray-20px", "0.9516", "+1.0000"],
            ["浅灰字 15px bg-gray-15px", "0.9677", "+1.0000"],
        ],
        widths=[210, 140, 110],
    )

    h2(doc, "5.3 打包产物自检（dist\\win-x64\\即译.exe --smoke-test）")
    table(
        doc,
        ["项目", "结果"],
        [
            ["ok / 渲染错误 / 截图", "true / 0 / 10"],
            ["ocr 探测器", "rapid=true, winrt=true, tesseract=false, mock=true"],
            ["当前选用引擎", "rapid（模型目录解析到 app\\resources\\runtime\\ocr-rapid\\models）"],
            ["自检断言", "全部 true（托盘接受=false 属本机环境限制）"],
        ],
        widths=[150, 310],
    )
    para(
        doc,
        "此外打包 zip 从上一版 126.1 MB 增至 166.9 MB，增量来自 ONNX 运行时（56.9 MB）与 OCR 模型（15.5 MB）。",
        space_after=6,
    )

    # ---------- 6 ----------
    h1(doc, "6. 验收命令")
    code(
        doc,
        "node 项目测试\\run-all.js            # 25 个文件全部通过（单元 17 / 集成 7 / OCR 1）\n"
        "node 项目测试\\run-all.js --only=ocr  # OCR 精度单独跑\n"
        "node 项目代码\\scripts\\smoke.js       # 开发态自检（含 OCR 引擎检查）\n"
        "node 项目代码\\scripts\\package-win.js # 重打包 dist\\win-x64 与 zip",
    )
    para(doc, "新增测试：`unit/rapid.test.js`（6 条，PNG 解码/切行/CTC）、`unit/store.test.js` 新增引擎白名单用例、`integration/ocr-engine.test.js`（6 条，顺序/切换/16 张合成图/4 张照片底图）。", size=10)

    # ---------- 7 ----------
    h1(doc, "7. 已知限制")
    bullet(doc, "Tesseract 仍不可用（本机没有 tesseract 二进制），因此「自动」实际是 rapid → winrt 两级；选项保留是为了换机后可立即启用。")
    bullet(doc, "det（文本检测）与 cls（方向分类）模型已随包分发但未接入：行切分仍假设「同一行文字高度接近」，多栏/竖排文本会切错。")
    bullet(doc, "12px 以下仍会掉字，这是模型分辨率的下限，不是规则问题；需要时可在切行后单独放大这类小行。")
    bullet(doc, "离线翻译、联网 API、去重、定时轮询等链路本轮未改动。")

    # ---------- 8 ----------
    h1(doc, "8. 附：第十四轮 OCR 修复（此前未单独出文档）")
    para(doc, "第十四轮针对「中文文本被莫名加标点/换成别的标点」「有背景图就识别不到」两条反馈，改了 6 处：", space_after=4)
    table(
        doc,
        ["改动", "位置", "作用"],
        [
            ["重复/行首标点检测", "ocr/score.js", "「，，」「，然后」判为低分，多遍里选更干净的那遍"],
            ["近形词检测", "ocr/score.js", "Ctri / Shift 等只对含大写字母的 token 判近形，避免误伤 fine→file"],
            ["数字/百分号/千分位", "repairCjkPunctuation", "3 ． 5 → 3.5、100 ％ → 100%"],
            ["运算符收紧", "repairCjkPunctuation", "仅两端为字母时合并，保住 1 + 1 = 2"],
            ["多遍投票", "mergeLines(voting)", "两遍以上一致的串优先，再按子序列补漏字"],
            ["对比度遍", "winrt.js DEFAULT_PASSES", "新增 2x + contrast 30，专治照片底低对比度"],
        ],
        widths=[110, 130, 220],
    )
    para(
        doc,
        "效果：照片底 4 张图从 0.9516/0.9677 提升到 0.9677–1.0000；标点重复、行首标点、快捷键被空格拆开三类问题在 OCR 精度测试里固化为断言。",
        space_after=6,
    )

    tail = doc.add_paragraph()
    tail.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(tail.add_run("—— 文档结束 ——"), size=9, color=MUTED)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("saved:", OUT)
    print("size:", os.path.getsize(OUT))


if __name__ == "__main__":
    build()
