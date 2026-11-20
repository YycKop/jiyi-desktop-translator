# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第六轮修复记录（外观自定义·设置开关·浮窗尺寸）》。

用法：python gen_fix_round6_doc.py
输出：D:\桌面翻译助手\开发文档\桌面翻译助手 第六轮修复记录（外观自定义·设置开关·浮窗尺寸）.docx
"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "开发文档")
OUT_NAME = "桌面翻译助手 第六轮修复记录（外观自定义·设置开关·浮窗尺寸）.docx"

FONT = "微软雅黑"
ACCENT = RGBColor(0x2F, 0x6F, 0xED)
MUTED = RGBColor(0x60, 0x6A, 0x7B)


def style_run(run, size=10.5, bold=False, color=None):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def heading(doc, text, level=1):
    p = doc.add_heading(level=level)
    run = p.add_run(text)
    style_run(run, size=16 if level == 1 else 13, bold=True, color=ACCENT)
    return p


def para(doc, text, size=10.5, bold=False, color=None, space_after=6):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    style_run(p.add_run(text), size=size, bold=bold, color=color)
    return p


def bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        style_run(p.add_run(item), size=10)


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, text in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ""
        style_run(cell.paragraphs[0].add_run(text), size=10, bold=True)
    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            style_run(cells[i].paragraphs[0].add_run(str(text)), size=9.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = w
    doc.add_paragraph()
    return t


def note(doc, text):
    p = doc.add_paragraph()
    style_run(p.add_run(text), size=9, color=MUTED)


def main():
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = FONT
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_run(title.add_run("桌面翻译助手 V1 · 第六轮修复记录"), size=20, bold=True, color=ACCENT)
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_run(sub.add_run("外观自定义 · 设置页一键开关 · 浮窗自由尺寸"), size=11, color=MUTED)
    note(doc, "版本：1.0.0 ｜ 日期：2026-10-30 ｜ 适用构建：dist/win-x64（portable）")

    heading(doc, "一、用户反馈与结论")
    para(doc, "用户提出三条优化需求（原话）：")
    bullets(
        doc,
        [
            "「设置页面和浮窗风格希望能由用户自定义，可以设置透明度、主题色、背景图等」",
            "「希望浮窗点设置打开设置页后，再点一次能够关闭设置页」",
            "「目前浮窗显示的大小不能灵活调整，希望能实现灵活调整，让译文显示更自然」",
        ],
    )
    para(doc, "结论：三条需求全部实现，并且都做成了“用户可调 + 立即生效 + 落盘持久化”。")
    table(
        doc,
        ["需求", "实现方式", "验收证据"],
        [
            ["外观自定义", "新增「外观」设置页：主题色/背景色取色器 + 6 组预设 + 不透明度/背景模糊/圆角滑块 + 背景图（本地选图、复制进数据目录、填充方式）+ 实时预览卡", "截图 07-settings-appearance.png；report.json 的 hudTheme/hudThemeApplied"],
            ["设置页一键开关", "⚙ 改为 toggle：可见则隐藏、隐藏则打开；按钮高亮表示当前已打开", "report.json 的 settingsToggle = true"],
            ["浮窗自由尺寸", "右下角拖拽手柄 + 设置页填宽高（280–1200 × 96–900）+ 高度自适应译文开关", "report.json 的 hudResize=true、hudAutoHeight=true，resize 前后 460×262 → 540×312"],
        ],
    )

    heading(doc, "二、外观自定义的实现")
    para(doc, "设计要点：颜色与尺寸不做成“每处硬编码”，而是由一份主题配置算出整套 CSS 变量，浮窗与设置页共用同一套。")
    heading(doc, "2.1 配置项（core/config/defaults.js）", level=2)
    table(
        doc,
        ["字段", "默认值", "说明"],
        [
            ["appearance.accent", "#4c8dff", "主题色：按钮、徽章、滑块、焦点边框"],
            ["appearance.background", "#12151c", "卡片背景基色（配合不透明度合成半透明）"],
            ["appearance.opacity", "0.84", "卡片不透明度 0.3–1"],
            ["appearance.blur", "12", "背景模糊 0–30px（backdrop-filter）"],
            ["appearance.radius", "12", "圆角 0–28px"],
            ["appearance.bgImage", "（空）", "背景图绝对路径，由主进程复制进数据目录 theme/"],
            ["appearance.bgImageOpacity", "0.35", "背景图不透明度 0–1"],
            ["appearance.bgImageFit", "cover", "填充方式 cover / contain / tile"],
        ],
    )
    heading(doc, "2.2 变量下发（src/renderer/shared/theme.js）", level=2)
    para(doc, "UMD 模块，主进程与渲染进程都能用；apply() 把主题算成 20 个变量写到 documentElement：")
    bullets(
        doc,
        [
            "--accent / --accent-strong / --accent-soft / --accent-border：主题色及其派生色",
            "--bg / --bg-elevated / --bg-hover / --fg / --fg-dim / --fg-faint / --border / --border-strong：中性色阶",
            "--radius / --hud-bg / --hud-blur / --hud-radius / --hud-shadow：浮窗专用",
            "--theme-image / --theme-image-size / --theme-image-repeat / --theme-image-opacity：背景图",
        ],
    )
    para(doc, "浅色背景（如预设“浅色”#f4f6fb）会自动切换深色文字与深色边框，判断集中在 palette() 的 isLight()，组件里不再各自判断。")
    heading(doc, "2.3 配置校验（core/config/store.js）", level=2)
    bullets(
        doc,
        [
            "颜色必须是 #RGB 或 #RRGGBB，非法值回落默认，避免用户手填脏数据导致界面变空。",
            "数值统一钳制：opacity 0.3–1、blur 0–30、radius 0–28、bgImageOpacity 0–1、fit 仅三种枚举。",
            "背景图只接受绝对路径，相对路径直接清空（防止目录穿越读到项目外文件）。",
        ],
    )
    heading(doc, "2.4 背景图的落地方式", level=2)
    para(doc, "用户点「选择图片…」→ 主进程 dialog 选图 → 复制到 <数据目录>/theme/bg-<时间戳>.<ext> → 配置里记绝对路径；渲染进程通过 api.theme.getImage() 拿到 data URL 后作为 CSS 变量下发。限制：单张 ≤ 8MB，仅 png/jpg/jpeg/webp/gif/bmp，图片不上传任何服务器。")

    heading(doc, "三、设置页一键开关")
    bullets(
        doc,
        [
            "主进程新增 wm.toggleSettings(tab)：按 settings.isVisible() 决定 hide() 还是 openSettings()，返回切换后的可见状态。",
            "IPC 新增 settings:toggle；preload 暴露 api.settings.toggle(tab)。",
            "设置窗口在 show / hide / closed 时广播事件 settings-visibility，浮窗收到后给 ⚙ 按钮加 .active 类。",
            "浮窗按钮的 title 会随状态变成「打开设置页」/「关闭设置页」，按钮背景高亮提示“当前已打开”。",
            "再次双击 exe（second-instance）与托盘双击仍直接打开设置页，行为保持不变。",
        ],
    )

    heading(doc, "四、浮窗自由尺寸")
    heading(doc, "4.1 三条调整路径共用一套钳制", level=2)
    table(
        doc,
        ["路径", "入口", "说明"],
        [
            ["拖拽右下角", "浮窗内 .hud-resize 手柄（悬停显形）", "mousedown → 主进程按屏幕坐标搬移窗口，松手落盘"],
            ["设置页填数值", "通用 → 浮窗尺寸（宽 × 高）", "输入即生效，范围 280–1200 × 96–900"],
            ["高度自适应", "通用 →「高度自适应译文」开关", "译文行数变化后自动调整高度，范围 96–900"],
        ],
    )
    heading(doc, "4.2 高度自适应的实现细节", level=2)
    para(doc, "不能直接读 body.scrollHeight：窗口已有固定高度时，body 会被拉伸到窗口高度，量出来永远是当前高度（首版因此总停在 300px）。现在改为临时把 .hud{height:auto} + .hud-body{flex:0 0 auto} 再读 scrollHeight，读完立即还原，并把结果通过 api.hud.autoHeight() 交给主进程 setHudSize()。")
    para(doc, "另外：手动拖动过尺寸后会自动关闭「高度自适应」（否则下一轮译文又会把高度弹回去），用户可在设置页重新打开。")
    heading(doc, "4.3 实测", level=2)
    table(
        doc,
        ["场景", "调整前", "调整后"],
        [
            ["拖拽右下角 +80×+50", "460 × 262", "540 × 312"],
            ["6 行长译文（自适应）", "460 × 240（默认）", "460 × 262（刚好贴合内容）"],
            ["设置页填 520 × 300", "460 × 262", "520 × 300"],
        ],
    )

    heading(doc, "五、验证结果")
    table(
        doc,
        ["项目", "命令", "结果"],
        [
            ["单元 + 集成 + OCR 全量", "node 项目测试\\run-all.js", "17 个文件 / 132 个用例，0 失败"],
            ["仅单元", "node 项目测试\\run-all.js --only=unit", "12 个文件 / 89 个用例通过"],
            ["仅集成", "node 项目测试\\run-all.js --only=integration", "4 个文件 / 33 个用例通过"],
            ["OCR 精度", "node 项目测试\\run-all.js --only=ocr", "10 个用例通过（8 张合成图 + 2 项汇总）"],
            ["Electron 自检", "node 项目代码\\scripts\\smoke.js", "ok=true 渲染错误=0 截图=8 托盘=true"],
            ["打包产物自检", "dist\\win-x64\\桌面翻译助手.exe --smoke-test", "exit=0、ok=true、全部 checks 为 true"],
        ],
    )
    para(doc, "report.json 新增断言（全部 true）：settingsToggle、hudAutoHeight、hudResize、hudTheme、hudThemeApplied、appearancePane。")

    heading(doc, "六、回归风险与已知限制")
    bullets(
        doc,
        [
            "背景模糊（backdrop-filter）在部分核显驱动上会让透明窗口闪烁；如遇到可在设置页把「背景模糊」调到 0。",
            "背景图较大（>4MB）时切换主题有约 100–200ms 的卡顿，图片只在切换时读一次，不影响翻译主流程。",
            "高度自适应在极端小字号（11px）下可能差 1–2px，属正常取整误差。",
            "浮窗尺寸上限 1200×900 是为了避免遮住整块屏幕（需求书“不遮挡屏幕内容”）。",
        ],
    )

    heading(doc, "七、变更记录")
    table(
        doc,
        ["文件", "变更"],
        [
            ["core/config/defaults.js", "新增 appearance 整组默认值；hud 新增 width/height/autoHeight"],
            ["core/config/store.js", "新增外观字段校验与钳制；hud 尺寸/字号范围校验"],
            ["shared/ipc-channels.js", "新增 hud:resize、hud:autoheight、settings:toggle、theme:*；EVENTS 新增 settings-visibility"],
            ["preload/index.js", "暴露 hud.resize、hud.autoHeight、settings.toggle、theme.*"],
            ["main/windows.js", "新增 settingsVisible/toggleSettings/setHudSize 与可见性广播"],
            ["main/ipc.js", "新增 resize/autoheight/toggle/pickImage/clearImage/getImage 五组 handler"],
            ["main/main.js", "showHud 按配置尺寸建窗并下发主题；自检新增 5 项外观/尺寸断言"],
            ["renderer/shared/theme.js", "**新增文件**：主题计算与 CSS 变量下发"],
            ["renderer/hud/*", "背景图层、右下角手柄、⚙ 切换、主题应用、自动高度"],
            ["renderer/settings/*", "新增「外观」tab 与完整控件、实时预览、尺寸输入"],
            ["项目测试/unit/theme.test.js", "**新增文件**：主题与配置钳制 6 个用例"],
        ],
    )
    note(doc, "本文件由 项目测试/tools/gen_fix_round6_doc.py 生成，改动实现后可重新生成。")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, OUT_NAME)
    doc.save(out)
    print("saved:", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
