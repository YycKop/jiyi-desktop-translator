"""生成《即译 第十八轮记录（离线/在线双通道·字幕模式）》docx。"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

OUT_DIR = r"D:\桌面翻译助手\开发文档"
OUT = os.path.join(OUT_DIR, "即译 第十八轮记录（双通道翻译·字幕模式）.docx")

doc = Document()
normal = doc.styles["Normal"]
normal.font.name = "Microsoft YaHei"
normal.font.size = Pt(10.5)
normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
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


def para(text, size=10.5, bold=False, space_after=6):
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
r = title.add_run("即译 · 第十八轮记录")
r.bold = True
r.font.size = Pt(20)
r.font.name = "Microsoft YaHei"
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run("离线 / 在线双通道翻译 · 视频与游戏字幕模式")
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(0x55, 0x5F, 0x75)
meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = meta.add_run("版本 v1.0.0　|　日期 2026-11-17　|　产物 dist\\win-x64（zip 167.0 MB）")
r.font.size = Pt(9)
r.font.color.rgb = RGBColor(0x77, 0x80, 0x92)
doc.add_paragraph()

h("1. 本轮需求", 1)
para("用户提出三条需求，原文如下：")
para("「1.同时启用在线api和离线模型，提供设置是离线优先还是在线优先」", size=10)
para("「2.使用离线模型翻译优先，当离线翻译失败时如果有启动在线api则用在线翻译完成翻译」", size=10)
para("「3.我想再优化一下浮窗，提供视频和游戏模式，在于减少浮窗对画面的遮挡，像游戏字幕一般就是一个对话框了，"
     "再加一个对话框就看不到游戏画面了，最好是细长浮窗然后透明但字体清晰可见」", size=10)

h("2. 双通道与优先级", 1)
para("过去是「联网失败才降级离线」的单向链，现在两条通道始终可用，由 general.priority 决定先试哪一条，"
     "优先那条整条失败后自动换另一条，并在结果里标记是否兜底。")
table(
    ["配置", "尝试顺序", "结果标记"],
    [
        ["general.priority = online（默认）", "联网 API（主 5s / 备 3s）→ 离线模型", "离线成功时 stage=offline、fallback=true"],
        ["general.priority = offline", "离线模型 → 联网 API（主 5s / 备 3s）", "在线成功时 stage=online、fallback=true"],
        ["优先级通道未就绪（如模型未安装）", "直接走另一条通道，不报错", "同上，attempts 里只有另一条的记录"],
        ["两条都失败", "—", "TRANSLATE_ALL_FAILED + 按组合给出可读提示"],
        ["用户主动取消", "立即中止", "ABORTED，不再降级"],
    ],
    widths=[5.2, 6.4, 5.0],
)
para("实现位置：core/translate/chain.js 的 translate() 把两条通道拆成 runOnline()/runOffline()，"
     "按 priority 生成 order 数组串行执行；core/pipeline/round.js 与 core/index.js 在离线优先时先 "
     "ensureOfflineReady() 再调用，避免第一次框选直接判失败。每次尝试都带 stage 字段，"
     "浮窗底部仍显示最终引擎名（离线时显示「离线模式」）。")

h("3. 真实模型验证", 1)
para("用项目测试/tools/priority-probe.js 指向 dist\\win-x64\\userdata（含真实 1.08 GB GGUF 与用户 API），"
     "第二段故意把离线端口改成无人监听的 18081，并挂一个本地桩网关冒充在线 API（不消耗真实额度）：")
table(
    ["场景", "结果", "耗时"],
    [
        ["离线优先 + 模型就绪，输入 Hello, how are you?", "引擎「离线模式」，stage=offline，fallback=false，译文「你好，你最近怎么样？」", "模型就绪 4.6 s；单次翻译 855 ms"],
        ["离线优先 + 离线不可用（端口 18081）", "自动落到 stage=online，fallback=true，译文由桩网关返回", "—"],
    ],
    widths=[6.6, 8.0, 3.0],
)

h("4. 顺带修掉的两个缺陷", 1)
para("① 离线模型在开发态与打包态都起不来（本轮实测暴露）。", bold=True)
para("llama/server.js 只用 paths.PROJECT_ROOT（工作区根）拼 runtime/llama，而二进制实际在 "
     "项目代码/runtime/llama（开发）与 app\\resources\\runtime\\llama（打包），两边各差一级，"
     "启动必然 ENOENT。修法：core/paths.js 新增 resourceRoot()（打包 = process.resourcesPath，"
     "开发 = 项目代码），llama/server.js 与 ocr/index.js 都改用它作为首选候选目录，旧的两种布局保留兜底。")
para("② 设置页「字幕字号 / 字幕底衬」在卡片模式下没有隐藏。", bold=True)
para("代码用 node.hidden 切换，但 .field{display:flex} 是作者样式，会盖掉浏览器默认的 [hidden]{display:none}。"
     "修法：shared/base.css 全局加 [hidden]{display:none !important}。")
para("③ 自检会把浮窗配置留在被改过的状态。", bold=True)
para("拖拽尺寸的检查会把 autoHeight 关掉并改宽高，于是下一次自检的 hudAutoHeight 随机失败。"
     "修法：runSmokeTest() 开始时快照整段 hud 配置，报告落盘前整段还原。")

h("5. 视频 / 游戏字幕模式", 1)
table(
    ["项目", "卡片模式（原有）", "字幕模式（新增）"],
    [
        ["窗口尺寸", "460×262，可拖拽", "默认 1800×96（屏幕宽 86%，上限 1800；最小高 96），仍可拖拽"],
        ["默认位置", "按设置（区域旁 / 上方 / 右下）", "屏幕底部居中，距任务栏 120px，位置会记住（hud.subtitlePoint）"],
        ["背景", "半透明卡片 + 圆角 + 投影", "完全透明，无边框无投影；可选「字幕底衬」加一层极淡渐变"],
        ["文字", "跟随主题字色，14–20px", "纯白 600 字重，三重黑色投影 + 0.5px 描边，字号 12–48 可调（默认 24）"],
        ["可点击区域", "整窗（标题栏可拖、正文可选词）", "只有右上角小胶囊（悬停才显形）可点/可拖，其余区域鼠标穿透到游戏"],
        ["隐藏的元素", "—", "状态点、标题、引擎徽章、复制、收起、原文、历史、页脚、右下角拖拽柄"],
    ],
    widths=[3.2, 6.6, 7.0],
)
para("穿透实现沿用主进程的 HudPointerWatcher：轮询光标 → elementFromPoint → 命中 .interactive 才允许点击，"
     "因此字幕模式下点击正文会直接落到下层游戏窗口，不再需要额外的「置顶但穿透」特判。")

h("6. 验证", 1)
table(
    ["验证项", "命令 / 来源", "结果"],
    [
        ["全量测试", "node 项目测试\\run-all.js", "25 个测试文件、0 失败（新增 5 条链路用例 + 2 条配置用例 + 3 条流水线用例）"],
        ["真实离线链路", "node 项目测试\\tools\\priority-probe.js", "pass=true（离线优先命中 + 离线失败转在线）"],
        ["开发态自检", "node 项目代码\\scripts\\smoke.js", "ok=true 渲染错误=0 截图=14；hudSubtitleMode=true"],
        ["打包态自检", "即译.exe --smoke-test", "ok=True errs=0 shots=11；hudSubtitleMode=true、hudAutoHeight=true；仅 jumpList/trayAccepted 为 false（本机环境限制）"],
        ["打包", "node 项目代码\\scripts\\package-win.js", "dist\\win-x64 重新生成，zip 167.0 MB"],
    ],
    widths=[3.4, 6.4, 8.2],
)

h("7. 已知限制", 1)
bullet("离线优先下，冷启动第一次翻译要等模型加载（实测 4.6 s，最大等 45 s）；期间浮窗显示「准备离线模型…」。")
bullet("字幕模式隐藏了引擎徽章，用户要看当前用的是离线还是在线，需切回卡片模式或看日志。")
bullet("纯白文字在极亮画面（雪景、白底网页）上对比度仍不如加底衬；设置里有「字幕底衬」开关可临时打开。")
bullet("字幕窗口固定高 96px，超长译文最多显示 3 行后截断（卡片模式可自动加高）。")

doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT))
