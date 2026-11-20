# -*- coding: utf-8 -*-
"""生成《即译 第二十一轮记录（字幕条交互·日韩识别·更密轮询）》.docx"""
import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十一轮记录（字幕条交互·日韩识别·更密轮询）.docx"

doc = Document()

style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(10.5)
style.paragraph_format.space_after = Pt(6)


def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.name = "Microsoft YaHei"
        run.font.color.rgb = RGBColor(0x1F, 0x35, 0x64)
    return p


def para(text, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    return p


def bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    p.add_run(text)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    for i, name in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(name)
        run.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = w
    return t


# ---------- 封面 ----------
title = doc.add_heading("即译 第二十一轮记录", level=0)
for run in title.runs:
    run.font.name = "Microsoft YaHei"
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.LEFT
r = sub.add_run("字幕条交互修通 · 长译文自动缩字 · 更密轮询档位 · 日/韩识别")
r.font.size = Pt(11)
r.font.color.rgb = RGBColor(0x44, 0x4A, 0x55)
para("版本 v1.0.0　|　日期 2026-11-18　|　产物 dist\\win-x64 与 即译-1.0.0-win-x64.zip（196.9 MB）")

# ---------- 1 需求 ----------
h("1. 本轮需求（用户原话）", 1)
para("“字幕模式还存在问题：")
para("1.字幕条动态调整大小的判断区域太小，鼠标很难点到拖动，而且存在鼠标松开还能拖动调整和鼠标移动快点就无法拖动字幕条位置的的情况")
para("2.字幕条的设置页点击暂停实时翻译后图标不变，而且收起和展开的位置应该放同一个地方方便用户操作，而不是现在右边点展开要去左边点收起")
para("3.字幕条显示译文时，如果译文较长展示不全，我希望能自动根据译文的长度调节字体大小来确保译文全部展示到字幕条中")
para("4.提供精度更高的实时翻译轮询时间间隔选择，提高实时翻译的效率")
para("5.我发现对日语和韩语文字的识别率很低，日语片假名平假名和韩文基本识别不出来”")

# ---------- 2 逐条改动 ----------
h("2. 逐条改动", 1)

h("2.1 拖动热区与松手判定", 2)
bullet("热区加宽：左右边缘 8px → 14px、底部 12px；提示线（拖动时可看到的 2px 亮条）加长加亮，鼠标靠近就变色。")
bullet("“松手后还能拖”：根因是拖动途中 pointerup 丢失（拖到窗口外松手、或系统吞掉事件）。现在 pointermove 里判断 e.buttons === 0 即视为松手，另加 window 级 pointerup / pointercancel / blur 三重兜底。")
bullet("“移动快就拖不动”：上一版在主进程轮询里加了“渲染进程 120ms 内有 move 就整轮跳过”的去抖，快速拖动时事件稀疏，反而一直跳过。现在渲染进程新鲜就以它为准，否则用真实光标的增量位移，且每轮以当前窗口几何为基准，避免跳变。")
bullet("主进程侧留最后一道闸：光标与事件同时静默 2.5 秒，判定 pointerup 丢失并主动收尾。")

h("2.2 暂停图标同步与收展同侧", 2)
bullet("图标不变：renderPause() 原来只写卡片模式的 #btn-pause，字幕控制区里的 #btn-sub-pause 从未被更新。现在两处一起写（图标、标题、active 状态）。")
bullet("收展同侧：.hud-rail 改成 flex-direction: row-reverse，toggle 永远贴最右，面板向左展开；删掉原来展开时旋转 180° 的规则（会和按钮里的文字箭头打架）。")

h("2.3 长译文自动缩字", 2)
bullet("fitSubtitleFont()：从用户设定字号开始，逐 1px 往下试到 12px，直到 scrollHeight <= clientHeight - 22 为止，保证整段译文落进字幕条。")
bullet("触发点：每轮新译文渲染后、切换浮窗模式时、窗口 resize 后；切回卡片模式会清掉内联字号，不影响普通浮窗。")

h("2.4 更密的轮询档位", 2)
bullet("设置页轮询间隔改为 300 / 500 / 800 / 1000 / 2000 / 3000 / 5000 毫秒七档（原最小 500）。")
bullet("store 的下限从 500ms 放宽到 200ms，与 loop.js 的 MIN_INTERVAL 常量对齐，避免“配置能写但引擎不认”。")

h("2.5 日/韩识别", 2)
bullet("新增 PP-OCRv4 日文与韩文识别模型（japan_PP-OCRv4_rec_mobile.onnx 9.75MB、korean_PP-OCRv4_rec_mobile.onnx 24.07MB）与字典，放在 runtime/ocr-rapid/models/；引擎改为多识别器（ch / japan / korean），按需懒加载。")
bullet("自动选语言：整块画面选一次（不是逐行选，否则混排截图会被打成大杂烩）。")
bullet("关键修正：只看置信度会把纯英文判成韩文（韩文模型读英文也有 0.995）。现改为“置信度 × 字形贴合度”：按语种统计输出里假名/谚文/汉字/拉丁字母的占比，剔掉标点干扰，完全不贴合时压到 35% 权重。")
bullet("CTC 置信度口径修正：只统计真正吐字的那几步，blank 步不再计入（否则读不出字的模型也显示 0.99）。")
bullet("设置页新增「识别语言」下拉：自动（中英优先，低分再试日/韩）/ 中英 / 日文 / 韩文。固定语言时只跑一个模型，更快。")

# ---------- 3 实测 ----------
h("3. 实测数据", 1)
para("识别语言选择（4 张合成分辨图，每张 2 行）", bold=True)
table(
    ["测试图", "auto 选中", "auto 命中", "固定 ch", "固定 japan", "固定 korean"],
    [
        ["jp-hiragana", "日文", "2/2", "0/2", "2/2", "0/2"],
        ["jp-mixed", "日文", "2/2", "1/2", "2/2", "0/2"],
        ["ko-hangul", "韩文", "2/2", "0/2", "0/2", "2/2"],
        ["ko-sentence", "韩文", "2/2", "0/2", "0/2", "2/2"],
    ],
)
para("")
para("字幕条自检（开发态与打包态一致）", bold=True)
table(
    ["断言", "结果"],
    [
        ["hudSubtitleRelease（松手后窗口不再跟随）", "热区 14px；宽度序列 [1920, 2200, 2200, 2200]"],
        ["hudSubtitlePauseSync（暂停图标两处同步）", "点击一次 → 两处均为 ⏸；再点一次 → 两处均为 ▶"],
        ["hudSubtitleRailSide（收展同侧）", "收起 / 展开时 toggle 右边缘坐标均为 2175（窗口宽 2200）"],
        ["hudSubtitleFit（长译文缩字）", "字号 28 → 25，文本完整放下（scrollH 66 ≤ boxH 90）"],
        ["hudSubtitleResize / ResizeY（宽高拖动）", "宽度 1800→1920、高度 96→164，均写回配置"],
        ["settingsIntervalDense / settingsOcrLang", "轮询 7 档（最小 300）；识别语言 4 档"],
    ],
)
para("")
para("识别耗时（单张 640×200，固定语言）：日文 36–42ms、韩文 29–74ms；auto 模式多两次采样推理，约 190–810ms。")

# ---------- 4 验证 ----------
h("4. 验证与产物", 1)
bullet("单元 + 集成 + OCR 精度：25 个测试文件、0 失败（新增日韩选语言、字形贴合度、CTC 吐字口径等用例）。")
bullet("开发态自检：ok=true，渲染错误 0，截图 16 张；checks 里仅 jumpList / trayAccepted 为 false（本机通知区域限制，非缺陷）。")
bullet("打包态自检：ok=true，13 张截图，hud 配置自检后正确还原（不再出现上一轮那种“状态污染”）。")
bullet("产物：dist\\win-x64（含日/韩模型）、dist\\即译-1.0.0-win-x64.zip（196.9 MB，比上一版 +34 MB 为两个模型）。")
bullet("许可：PP-OCRv4 模型为 Apache-2.0，发布脚本的「第三方组件与许可」已补第 9、10 条（PaddleOCR 模型来源、onnxruntime-node MIT），并注明只随包提供 win32-x64 原生库。")

# ---------- 5 已知限制 ----------
h("5. 已知限制", 1)
bullet("韩文模型本身不吐空格（字典含空格类但模型几乎不输出），韩文译文仍可直接翻译，但读起来偏紧凑；若需要分词可后续接空格预测，未在本轮引入。")
bullet("自动模式按整块画面选一次语言：同屏混排（如日中双语字幕同时在框内）会统一用主语言模型，次要语言字符可能识别不全。此时可在设置里固定语言。")
bullet("日/韩模型每帧多一次采样推理，auto 模式首帧约 0.2–0.8 秒；固定语言后回到 30–70ms。")
bullet("打包体积因新增两个模型增加到 196.9 MB。")

doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT), "bytes")
print("paragraphs", len(doc.paragraphs), "tables", len(doc.tables))
