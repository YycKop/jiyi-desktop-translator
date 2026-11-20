"""生成《即译 第十九轮记录（提示主题化·悬浮球面板·字幕条控制区）》docx。"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

OUT_DIR = r"D:\桌面翻译助手\开发文档"
OUT = os.path.join(OUT_DIR, "即译 第十九轮记录（提示主题化·悬浮球面板·字幕条控制区）.docx")

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
r = title.add_run("即译 · 第十九轮记录")
r.bold = True
r.font.size = Pt(20)
r.font.name = "Microsoft YaHei"
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run("通知提示主题化 · 悬浮球常驻与悬停面板 · 字幕条右侧控制区与宽度拖拽")
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(0x55, 0x5F, 0x75)
meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = meta.add_run("版本 v1.0.0　|　日期 2026-11-17　|　产物 dist\\win-x64 + zip 167.0 MB（内测包，非 release）")
r.font.size = Pt(9)
r.font.color.rgb = RGBColor(0x7A, 0x83, 0x96)

h("1. 需求与实现对照", 1)
table(
    ["#", "用户需求", "实现方式"],
    [
        ["1", "切换翻译优先级的通知黑底黑字，希望通知与主题色统一",
         "去掉 .toast 里写死的深色背景，改用主题变量 bg-elevated / fg，并补 ok / err / warn 语义色"],
        ["2", "字幕模式很难找到右上角的设置区域，希望放到右侧并可收起展开",
         "新增右侧 .hud-rail：收起态 22px 窄竖条（opacity .55），点 ‹ 展开成 142px 按钮组；顶部只留 46×16 拖动握把"],
        ["3", "字幕窗口长度不能拖动调整",
         "HUD_RESIZE 支持 axis:x + edge:left/right；左右各 8px 热区，松手写回 hud.subtitleWidth"],
        ["4", "悬浮球没有显示；希望恢复并做成悬停浮现选项",
         "general.ballEnabled 默认 true，启动即常驻；悬停时窗口从 44px 长到 300px，露出 设置/输入/浮窗/退出 四项"],
    ],
    widths=[1.0, 6.4, 9.6],
)

h("2. 关键改动", 1)
table(
    ["文件", "改动要点"],
    [
        ["src/renderer/shared/theme.js", "palette() 增加 ok / err / warn，apply() 下发 --ok / --err / --warn"],
        ["src/renderer/shared/base.css", ".toast 走变量；.toast.ok/.err/.warn 用语义色描边"],
        ["src/core/config/defaults.js", "general.priority、general.ballEnabled(true)、hud.mode / subtitle* 默认值"],
        ["src/core/config/store.js", "优先级白名单、ballEnabled 归一、字幕字号/宽度/位置钳制"],
        ["src/main/windows.js", "BALL_FAN_WIDTH=300；setBallExpanded() 保持球不动、按两侧空间选 panel-left/right；setHudSize 支持 maxWidth 与 x"],
        ["src/main/ipc.js", "HUD_RESIZE 支持 axis/edge；字幕模式持久化 subtitleWidth；轮询在 700ms 内有 pointermove 时让位"],
        ["src/main/main.js", "ensureBallVisible / syncBallFromConfig / setBallHover / ballAction；字幕宽度变化即时套用；自检新增 5g 段"],
        ["src/renderer/ball/*", "HTML 增加悬停面板；CSS 玻璃胶囊 + panel-right 反向；app.js 悬停开合、点击派发"],
        ["src/renderer/hud/*", "index.html 增加 .hud-rail 与左右热区；hud.css 字幕模式控制区/握把；app.js 接线与边缘拖拽"],
        ["src/renderer/settings/*", "新增「悬浮球」开关、「字幕宽度」输入，随模式显隐"],
        ["src/preload/index.js", "api.ball.hover/action/onState；api.hud.resize 支持 axis/edge"],
    ],
    widths=[5.6, 11.4],
)

h("3. 实测数据", 1)
table(
    ["检查项", "开发态", "打包态", "判定"],
    [
        ["悬浮球常驻 ballVisible", "true", "true", "球一启动就在，不再等托盘失败"],
        ["悬停展开 ballHover", "44 → 300 → 44px，fan 显示", "同左", "球位置不动，面板向屏幕内侧展开"],
        ["字幕右侧控制区 hudSubtitleRail", "收起 22px / 展开 142px，距右边 18px", "同左", "满足「右侧 + 可收起展开」"],
        ["字幕宽度拖拽 hudSubtitleResize", "1800 → 1920px，持久化 subtitleWidth=1920", "同左", "左右边缘都能拖，松手记住"],
        ["提示条主题 settingsToastTheme", "bg rgb(37,40,46) / fg rgb(232,236,243)", "bg rgb(223,240,232) / fg rgb(22,24,29)", "随主题变化，不再是黑底黑字"],
        ["字幕模式 hudSubtitleMode", "true", "true", "细长透明 + 正文穿透保持不回归"],
        ["单元/集成测试", "25 个文件全部通过", "—", "无回归"],
    ],
    widths=[5.4, 4.4, 4.2, 4.0],
)

h("4. 使用说明", 1)
bullet("悬浮球：默认在桌面右侧常驻。鼠标移上去 → 左侧滑出「设置 / 输入 / 浮窗 / 退出」；点任一项即执行并收回。单击球仍按「点击图标时打开」的配置打开设置页或浮窗，拖动可换位置。")
bullet("想关掉悬浮球：设置 → 通用 → 启动 → 悬浮球，把开关关掉即可（本机通知区域不接受新图标，关掉后请用再次双击 exe 或任务栏进入）。")
bullet("字幕条控制区：视频 / 游戏模式下，右侧有一条窄竖条，点一下展开 ⚙ ⧉ ⏸ — × 五个按钮；鼠标移开自动收起，不挡画面。顶部 46×16 的小握把用来拖动窗口位置。")
bullet("字幕条宽度：把鼠标移到字幕条最左 / 最右边缘，光标变成左右箭头后拖动即可；也可以在设置 → 通用 → 浮窗 → 字幕宽度里填像素（0 = 自动，约屏幕 86%）。")

h("5. 验证命令", 1)
para("node 项目测试\\run-all.js            # 25 个文件全部通过", size=9.5)
para("node 项目代码\\scripts\\smoke.js      # ok=true 渲染错误=0 截图=16", size=9.5)
para("node 项目代码\\scripts\\package-win.js # 产出 dist\\win-x64 与 zip", size=9.5)
para("即译.exe --smoke-test（打包态）      # ok=true，13 张截图，checks 仅 jumpList/trayAccepted 为 false（本机环境限制）", size=9.5)

h("6. 已知限制", 1)
bullet("本机通知区域不接受新图标（原生 WinForms 亦然），托盘图标时有时无，所以悬浮球承担了常驻入口的角色。")
bullet("悬浮球面板展开宽度固定 300px（球 44 + 面板 256）；屏幕边缘空间不足时会朝另一侧展开，极窄屏可能被裁一点。")
bullet("字幕条高度固定 96px（可在设置里改 subtitleHeight，但正文最多 3 行，超出会截断）。")

doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT))
print("paras", len(doc.paragraphs), "tables", len(doc.tables))
