# -*- coding: utf-8 -*-
"""生成《即译 第二十三轮记录（字幕条拖拽重做·热区随尺寸缩放）》"""
import os
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

OUT_DIR = r"D:\桌面翻译助手\开发文档"
NAME = "即译 第二十三轮记录（字幕条拖拽重做·热区随尺寸缩放）.docx"

ACCENT = RGBColor(0x2B, 0x5C, 0xE8)
MUTED = RGBColor(0x5B, 0x63, 0x73)

doc = Document()

# 页面与基础样式
for s in doc.sections:
    s.left_margin = Cm(2.4)
    s.right_margin = Cm(2.4)
    s.top_margin = Cm(2.2)
    s.bottom_margin = Cm(2.2)

normal = doc.styles["Normal"]
normal.font.name = "Microsoft YaHei"
normal.font.size = Pt(10.5)
normal.paragraph_format.space_after = Pt(4)
normal.paragraph_format.line_spacing = 1.35


def h1(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(14)
    r.font.color.rgb = ACCENT
    return p


def para(text, muted=False, size=10.5):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(size)
    if muted:
        r.font.color.rgb = MUTED
    return p


def bullet(text, bold_head=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    if bold_head:
        r = p.add_run(bold_head)
        r.bold = True
    p.add_run(text)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, htext in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        r = cell.paragraphs[0].add_run(htext)
        r.bold = True
        r.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            r = cells[i].paragraphs[0].add_run(str(val))
            r.font.size = Pt(9.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    return t


# ---------------- 标题 ----------------
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
tr = title.add_run("即译 · 第二十三轮开发记录")
tr.bold = True
tr.font.size = Pt(20)

sub = doc.add_paragraph()
sr = sub.add_run("字幕条拖拽重做 · 热区随尺寸缩放 · 指示条可见性")
sr.font.size = Pt(11)
sr.font.color.rgb = MUTED

meta = doc.add_paragraph()
mr = meta.add_run("版本 v1.0.0 ｜ 日期 2026-11-18 ｜ 产物 dist\\win-x64（196.9 MB）与 dist\\即译-1.0.0-win-x64.zip")
mr.font.size = Pt(9)
mr.font.color.rgb = MUTED

# ---------------- 1 需求 ----------------
h1("1. 本轮需求（用户原话）")
para("字幕条的拖拽和调整还是有点问题：", muted=True)
for line in [
    "1. 字幕条上下调整的时候还是会出现之前的问题，而且从左往右调整大小可以流畅拖动，"
    "但是从右往左的会就是和上下调整一样有之前说的问题；",
    "2. 随着字幕条的变大可拖拽区域应该相应变大方便调整；",
    "3. 字幕条拖动移动的区域应该设置的明显一点，现在颜色太浅了，如果不设置字幕底衬有点看不清。",
]:
    bullet(line)

# ---------------- 2 根因 ----------------
h1("2. 根因：两套参照系互相打架")
para("上一轮把几何改成「主进程按光标算」，但渲染进程仍在用「事件坐标 − 按下坐标」算绝对位移，"
     "于是两条驱动各自累加。只有当窗口原点不动（拖右边缘）时，两者数值恰好一致，所以看起来正常。")
table(
    ["场景", "窗口原点", "两条驱动的数值", "观感"],
    [
        ["拖右边缘", "不动", "一致", "流畅（假象）"],
        ["拖左边缘（从右往左缩）", "x 跟着变", "渲染进程恒≈0 + 轮询在动 → 重复累加", "抖、跳、像卡住"],
        ["拖上下边缘", "高度变触发 rebase", "两路叠加", "抖、脱手"],
    ],
    widths=[4.2, 3.4, 6.0, 3.4],
)
para("修法：统一成 f(按下时的窗口几何, 当前屏幕光标) 这个幂等纯函数。"
     "主进程轮询与渲染进程上报送进来的是同一个绝对锚点，谁先算都只是「再算一遍」，不会互相放大。", muted=True)

# ---------------- 3 改动 ----------------
h1("3. 改动清单")
table(
    ["文件", "改动", "目的"],
    [
        ["src/main/ipc.js", "applyHudResize() 用绝对锚点（startCursor）重算；move 只当心跳；"
         "dragWindow() 同样改 16ms 轮询真实光标", "消除两套参照系的重复累加（需求 1）"],
        ["src/main/ipc.js", "HUD_RESIZE_TEST_MODE + testCursor（仅 --smoke-test 生效）", "让自检能驱动几何"],
        ["src/preload/index.js", "hud.drag / hud.resize 透传 opts.testCursor", "上一处漏传导致自检失效"],
        ["src/renderer/hud/app.js", "syncEdgeMetrics() 按窗口尺寸算 --edge-x/--edge-y/--grip-w/--grip-h", "热区随尺寸变大（需求 2）"],
        ["src/renderer/hud/hud.css", "热区宽度/高度用变量；指示条白条 + 暗描边、常显；"
         "底部横条左右各留 10% 铺开；顶部握把 64×18~160×34、0.62 不透明底 + 白边", "看得见、抓得住（需求 3）"],
    ],
    widths=[5.0, 8.0, 4.0],
)

# ---------------- 4 指标 ----------------
h1("4. 热区与握把随尺寸变化（自检实测）")
table(
    ["指标", "字幕条 1800×96", "字幕条 1920×164", "说明"],
    [
        ["左右热区宽 --edge-x", "40px", "40px", "按窗口宽 3% 取，夹到 16–40"],
        ["上下热区高 --edge-y", "15px", "26px", "按窗口高 16% 取，夹到 14–44"],
        ["底部热区实际高度", "15px", "26px", "整条底边都能拖"],
        ["顶部握把尺寸", "160×18", "160×31", "宽度按 14% 取（夹 64–160），高度按 19% 取（夹 18–34）"],
        ["握把不透明度", "0.85", "0.85", "底色 rgba(10,14,22,.62) + 1px 白边"],
    ],
    widths=[4.6, 3.6, 3.6, 6.6],
)

# ---------------- 5 验证 ----------------
h1("5. 验证")
table(
    ["检查项", "开发态", "打包态", "断言内容"],
    [
        ["hudSubtitleResize", "1800→1920", "1800→1920", "拖右边缘宽度增加并写入 subtitleWidth"],
        ["hudSubtitleResizeY", "96→164", "96→164", "拖底边高度增加并写入 subtitleHeight"],
        ["hudSubtitleEdgeScale", "true", "true", "放大后 edgeH、gripH 同步变大且握把不透明"],
        ["hudSubtitleRelease", "true", "true", "松手（buttons=0）后宽度立即冻结"],
        ["hudResize（卡片）", "460×262→540×312", "同左", "卡片右下角拖拽不受本次改动影响"],
        ["全量测试", "27 个文件 · 0 失败", "—", "含单元 17 / 集成 8 / OCR 1 等"],
    ],
    widths=[4.4, 3.6, 3.6, 6.6],
)
para("打包自检：ok=true、rendererErrors=[]、13 张截图；仅为 false 的仍是 jumpList 与 trayAccepted"
     "（本机通知区域限制，与前几轮一致）。", muted=True)

# ---------------- 6 经验 ----------------
h1("6. 本轮经验")
for head, body in [
    ("参照系统一 ", "：拖动/缩放的每一步都要用同一个纯函数算，主进程轮询与渲染事件只决定「谁先触发」，"
     "不能各自维护一套增量。判断「是否有问题」要看窗口原点是否移动——原点不动时两套算法会碰巧一致。"),
    ("自检的假光标要全链路透传 ", "：几何改成绝对锚点后，真实光标在自检里不动，必须靠 testCursor；"
     "而 preload 的白名单会静默丢掉未声明的字段，结果就是「检查红了但代码是对的」或反过来。"),
    ("热区尺寸走 CSS 变量 ", "：由渲染进程按窗口尺寸算好写进 --edge-x/--edge-y/--grip-w/--grip-h，"
     "样式表只读变量，字幕条变大后抓取面积自然变大。"),
    ("指示条要双色 ", "：纯白色半透明在浅底上几乎看不见，加一层暗描边（box-shadow 0 0 0 1px）才两种背景都清楚。"),
    ("自检先拉正基线 ", "：上一次自检被中断会残留 hud.mode='subtitle'，导致本轮 hudAutoHeight 假失败；"
     "开跑前固定 mode=card、autoHeight=true，跑完再整段还原用户快照。"),
]:
    p = doc.add_paragraph(style="List Bullet")
    r = p.add_run(head)
    r.bold = True
    p.add_run(body)

# ---------------- 7 使用说明 ----------------
h1("7. 使用说明")
bullet("字幕模式：拖左右边缘改宽度、拖底边改高度；顶部右侧灰色握把拖动可整体移动字幕条。")
bullet("指示条常显（半透明白 + 暗描边），悬停时变亮；不需要时可以关闭「字幕底衬」保持画面干净。")
bullet("设置页「浮窗 → 字幕宽度 / 字幕高度」填 0 表示自动；拖动后的尺寸会记住。")

os.makedirs(OUT_DIR, exist_ok=True)
out = os.path.join(OUT_DIR, NAME)
doc.save(out)
print("saved", out, os.path.getsize(out), "bytes")
print("paras", len(doc.paragraphs), "tables", len(doc.tables))
