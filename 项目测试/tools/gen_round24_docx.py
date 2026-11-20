"""生成《即译 第二十四轮记录（字幕条热区收敛·设置区解耦）.docx》。"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十四轮记录（字幕条热区收敛·设置区解耦）.docx"

ACCENT = RGBColor(0x2F, 0x6F, 0xED)
MUTED = RGBColor(0x6B, 0x72, 0x80)


def style_doc(doc):
    normal = doc.styles["Normal"]
    normal.font.name = "微软雅黑"
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.35


def heading(doc, text, level=1):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(15 if level == 1 else 11.5)
    run.font.color.rgb = ACCENT if level == 1 else RGBColor(0x1F, 0x2A, 0x44)
    p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(4)
    return p


def para(doc, text, muted=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    if muted:
        run.font.size = Pt(9)
        run.font.color.rgb = MUTED
    return p


def bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.add_run(item)
        p.paragraph_format.space_after = Pt(2)


def table(doc, headers, rows):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for cell, text in zip(t.rows[0].cells, headers):
        cell.text = ""
        run = cell.paragraphs[0].add_run(text)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for cell, text in zip(cells, row):
            cell.text = ""
            run = cell.paragraphs[0].add_run(str(text))
            run.font.size = Pt(9.5)
    doc.add_paragraph()
    return t


def main():
    doc = Document()
    style_doc(doc)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("即译 · 第二十四轮记录")
    run.bold = True
    run.font.size = Pt(20)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = sub.add_run("字幕条热区收敛 · 设置区与改尺寸热区解耦")
    run.font.size = Pt(11)
    run.font.color.rgb = MUTED

    para(doc, "版本 v1.0.0 ｜ 日期 2026-11-18 ｜ 产物 dist\\win-x64（196.9 MB zip）", muted=True)

    heading(doc, "1. 本轮用户反馈")
    para(
        doc,
        "“字幕条的设置区域和右侧调整拖动区域有重叠导致点击设置有点难，"
        "而且调整拖动区域的颜色有点太明显了，而且下侧的拖动条太大了应该小点。”",
        muted=True,
    )
    table(
        doc,
        ["反馈", "成因", "处理"],
        [
            ["点设置很难", "右侧热区宽 40px，控制区胶囊右边缘距窗口右边仅 13px，28px 宽的胶囊有 20px 压在热区里；",
             "控制区改为让开热区往内缩，并提到热区之上的一层"],
            ["拖动区颜色太明显", "指示条 4px 宽、0.55 不透明，白条在浅底上像装饰条",
             "3px 宽、0.3 不透明，加一圈 1px 暗描边保证浅底也可见"],
            ["下侧拖动条太大", "底部指示条左右各留 10%，几乎贯通整条",
             "改居中定长，宽度取窗口宽的 22%（120–320px）"],
        ],
    )
    para(
        doc,
        "说明：控制区与热区原本是同一层上的两个元素，热区又是透明的整块覆盖，"
        "所以“看起来是按钮、点下去是热区”。这轮不是把热区变窄（那会让拖动更难抓），"
        "而是把两个可交互区域的边界拉开——热区保持厚度，控制区整体内缩。",
    )

    heading(doc, "2. 改动明细")
    table(
        doc,
        ["文件", "改动"],
        [
            ["src/renderer/hud/hud.css",
             ".hud-rail 改为 right: calc(var(--edge-x) + 14px)、z-index:8；"
             "字幕模式握把 .hud-head 同样内缩 8px；指示条 3px / opacity .3 + 暗描边；"
             "底边指示条改居中定长（--bottom-bar-len）"],
            ["src/renderer/hud/app.js",
             "syncEdgeMetrics() 里把 bar 固定 3px、compute --bottom-bar-len = clamp(w*22%, 120, 320)"],
            ["src/main/main.js",
             "自检断言 hudSubtitleRailSide 从“距右边 ≤30px”改为“30–90px”（设计上就是往里让）；"
             "基线 patch 追加 subtitleWidth/Height=0、subtitlePoint=null"],
        ],
    )

    heading(doc, "3. 验证")
    table(
        doc,
        ["检查", "开发态", "打包态"],
        [
            ["smoke.js", "ok=true、渲染错误 0、截图 16", "ok=true、errs=0、截图 13"],
            ["hudSubtitleRail", "收起 2133 / 展开 2133（窗口右边界 2200）", "同上"],
            ["hudSubtitleHit", "true（elementFromPoint 命中控制区与三条热区）", "true"],
            ["hudSubtitleEdgeScale", "edgeX=40、edgeY=26、edgeH=26、gripW=160、gripH=31、gripOpacity=0.85、gripSolid=true", "同左"],
            ["jumpList / trayAccepted", "false（本机环境限制，非代码问题）", "false"],
        ],
    )
    para(doc, "全量测试：node 项目测试\\run-all.js → 27 个文件全部通过。")

    heading(doc, "4. 已知取舍")
    bullets(
        doc,
        [
            "控制区往里让了 54px，右侧留出一条“改宽度”的专用通道；如果窗口很窄（<600px），控制区会与译文重叠，此时可先拖宽再操作。",
            "指示条变淡后，浅色背景上主要靠那圈 1px 暗描边提示位置；如果仍觉得看不见，可在设置里开启「字幕底衬」。",
            "底边指示条只表示“这条边能拖”，实际可抓区域仍是整条 12–44px 高的热区。",
        ],
    )

    heading(doc, "5. 产物")
    bullets(
        doc,
        [
            r"程序：dist\win-x64\即译.exe（含 runtime 与 ONNX 模型）",
            r"内测包：dist\即译-1.0.0-win-x64.zip（196.9 MB）",
            r"记录：开发文档\即译 第二十四轮记录（字幕条热区收敛·设置区解耦）.docx",
            r"经验：项目代码\AGENTS.md 第 6 节「第二十四轮」",
        ],
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("saved", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
