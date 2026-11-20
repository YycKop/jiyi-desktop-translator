"""生成《即译 第二十轮记录（去黑边·字幕控制区修复·尺寸可调）》docx。"""
import os

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十轮记录（去黑边·字幕控制区·尺寸可调）.docx"

CJK = "Microsoft YaHei"
INK = RGBColor(0x1F, 0x27, 0x33)
MUTED = RGBColor(0x5A, 0x63, 0x72)


def setup(doc):
    st = doc.styles["Normal"]
    st.font.name = CJK
    st.font.size = Pt(10.5)
    st.font.color.rgb = INK
    st.element.rPr.rFonts.set(qn("w:eastAsia"), CJK)
    pf = st.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(6)
    pf.line_spacing = 1.35


def h1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(14)
    r.font.color.rgb = INK
    return p


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(11.5)
    return p


def para(doc, text, muted=False):
    p = doc.add_paragraph()
    r = p.add_run(text)
    if muted:
        r.font.color.rgb = MUTED
        r.font.size = Pt(9.5)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.add_run(text)
    return p


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    for i, cell in enumerate(t.rows[0].cells):
        cell.text = ""
        r = cell.paragraphs[0].add_run(header[i])
        r.bold = True
        r.font.size = Pt(10)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            r = cells[i].paragraphs[0].add_run(str(val))
            r.font.size = Pt(9.5)
    if widths:
        for i, w in enumerate(widths):
            if w is None:
                continue
            for row in t.rows:
                row.cells[i].width = w
    return t


doc = Document()
setup(doc)
doc.core_properties.title = "即译 第二十轮记录"
doc.core_properties.author = "即译开发组"

title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
tr = title.add_run("即译 · 第二十轮记录")
tr.bold = True
tr.font.size = Pt(20)
sub = doc.add_paragraph()
sr = sub.add_run("去掉透明窗黑边 · 修好字幕控制区点击 · 字幕条尺寸可调")
sr.font.size = Pt(11)
sr.font.color.rgb = MUTED
meta = doc.add_paragraph()
mr = meta.add_run("版本 v1.0.0 ｜ 日期 2026-11-17 ｜ 产物 dist\\win-x64（167.0 MB zip）")
mr.font.size = Pt(9.5)
mr.font.color.rgb = MUTED

h1(doc, "1. 用户反馈")
para(doc, "「目前还有问题：1.帮我去掉浮窗，悬浮球旁边的黑色阴影影响美观了 2.字幕设置区域点击没反应，"
          "没有显示出设置选项，无法收起和展开，而且也没办法动态调整显示区域大小」")
para(doc, "两条都属于上一轮（第十九轮）改动引入或遗留的问题，本轮全部定位到根因后修复，并补上能真正拦住它们的自检。",
     muted=True)

h1(doc, "2. 问题一：透明窗口的黑色阴影")
h2(doc, "2.1 阴影其实有两个来源")
para(doc, "上一轮只清掉了悬浮球自身的一层 CSS 投影，这次把两处都找齐了：")
table(doc, ["来源", "表现", "本轮处理"], [
    ["CSS 投影（`.hud` 的 `--hud-shadow`、`.ball-fan` 的 `0 8px 22px`）",
     "投影画在窗口内 8px 留白里，深色主题下就是卡片或面板外一圈黑", "两处均改为 `box-shadow: none`，层次感交给 1px 边框"],
    ["Windows DWM 系统投影",
     "透明窗在部分系统版本仍会被画一圈暗边，`hasShadow: false` 不生效", "创建窗口后再显式调用 `win.setHasShadow(false)`（浮窗与悬浮球各一次）"],
    ["`backdrop-filter: blur()`",
     "在透明窗口上会在圆角边缘糊出暗晕（尤其面板）", "面板与字幕控制区改用高不透明度底色，去掉 blur"],
], widths=[None, None, None])
h2(doc, "2.2 顺带修掉的细节")
bullet(doc, "悬浮球图标外圈自带一圈压暗的边缘像素，裁成圆形后看着也像黑边：图标放大 1.08 倍，让这圈落到圆外。")
bullet(doc, "字幕控制区原来 `opacity: .55` 且用模糊玻璃，现在改成 `.72` 的实底胶囊，既不再发黑也更容易看见。")
para(doc, "注：程序内截图（`capturePage`）只能拍到窗口内容，拍不到系统级投影，所以这一条的最终观感需要用户在真实桌面上确认。",
     muted=True)

h1(doc, "3. 问题二：字幕控制区点了没反应")
h2(doc, "3.1 根因链")
para(doc, "字幕模式为了让点击穿透到下层游戏窗口，把 `.hud` 与 `.hud-body` 都设成 `pointer-events: none`，"
          "再由主进程 120ms 轮询光标位置、用 `document.elementFromPoint()` 判断是否命中 `.interactive`，"
          "命中才临时关闭穿透。控制区 `.hud-rail` 与边缘热区 `.hud-edge` 虽然在 DOM 里、也带着 `.interactive`，"
          "但**没有显式恢复 `pointer-events: auto`**，于是：")
bullet(doc, "`elementFromPoint()` 命中的是空白 → 主进程继续维持穿透 → 真实鼠标点击落到游戏窗口上，按钮毫无反应；")
bullet(doc, "而测试里用 `element.click()` 是程序化触发，不经过命中测试，所以旧断言全绿。")
h2(doc, "3.2 修法")
bullet(doc, "`.hud-rail`、`.hud-rail .icon`、`.rail-toggle`、`.hud-edge` 全部显式 `pointer-events: auto`。")
bullet(doc, "删掉 `mouseleave` 自动收起——指针从按钮挪向边缘时会先触发它，面板在点击落地前就收了，表现同样是「点了没反应」；"
            "现在只由 ‹ / › 按钮收展。")
bullet(doc, "按钮加大到 24×26、展开后控制区宽 158px，收起态仍有 28px 可点。")
h2(doc, "3.3 新增的回归断言")
para(doc, "自检不再「点一下看状态」，而是直接断言命中：在控制区中心与三条热区上各调用一次 `elementFromPoint()`，"
          "要求结果落在对应元素内且带 `.interactive`——与主进程判定穿透的判据完全一致。")

h1(doc, "4. 字幕条尺寸可调")
table(doc, ["方向", "操作", "实现", "持久化"], [
    ["宽度", "拖左右边缘（8px 热区）", "`HUD_RESIZE` 的 `axis:'x'` + `edge:'left'|'right'`，拖左边时右边固定", "`hud.subtitleWidth`"],
    ["高度", "拖底部横条（7px 热区）", "`axis:'y'`，顶边固定、高度随光标走，钳制 64–400px", "`hud.subtitleHeight`"],
    ["精确值", "设置页「浮窗式 → 字幕宽度 / 字幕高度」", "0 = 自动（宽约屏幕 86%、高 96px）", "同上"],
], widths=[None, None, None, None])
para(doc, "为支持高度小于 96px，`windows.setHudSize()` 新增 `minHeight` 参数（卡片模式仍按 96–900 钳制）。", muted=True)

h1(doc, "5. 验证")
table(doc, ["检查项", "开发态", "打包态"], [
    ["`hudSubtitleHit`（控制区与三条热区可命中）", "true", "true"],
    ["`hudSubtitleResize`（拖右边缘）", "1800 → 1920px，写入 1920", "同左"],
    ["`hudSubtitleResizeY`（拖底边）", "96 → 164px，写入 164", "同左"],
    ["`hudSubtitleRail`（收起/展开）", "28px ↔ 158px，距右 20px", "同左"],
    ["`ballVisible` / `ballHover`", "true；44 → 300 → 44px", "同左"],
    ["全量测试 `node 项目测试\\run-all.js`", "25 个文件，失败 0", "—"],
    ["打包态自检", "—", "`ok=true`，`rendererErrors=[]`，13 张截图"],
], widths=[None, None, None])
para(doc, "打包态 `checks` 中仅 `jumpList` 与 `trayAccepted` 为 false，属本机通知区域与 portable 形态的已知限制，已在第七节记录。",
     muted=True)

h1(doc, "6. 产物")
bullet(doc, r"程序：`D:\桌面翻译助手\dist\win-x64\`（启动器 + app + runtime + 使用说明）")
bullet(doc, r"内测包：`D:\桌面翻译助手\dist\即译-1.0.0-win-x64.zip`（167.0 MB，不含 userdata）")
bullet(doc, r"截图：`项目测试\reports\electron-smoke\`（01-hud、14-hud-subtitle、15-ball-fan、16-hud-subtitle-rail 等）")
bullet(doc, r"经验：`项目代码\AGENTS.md` 第 6 节「第二十轮」4 条")

h1(doc, "7. 已知限制")
bullet(doc, "托盘图标在本机会话注册不上（系统层面拒绝），应用已用悬浮球作为常驻入口，行为符合预期。")
bullet(doc, "系统级窗口投影无法用程序内截图验证，需在真实桌面确认；若仍有残留，可再叠加 `--force-color-profile` 等参数排查显卡合成路径。")
bullet(doc, "字幕条高度上限 400px：再高就不是「字幕条」而是面板了，需要更大的显示区域请用卡片模式。")

doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT), "paras", len(doc.paragraphs), "tables", len(doc.tables))
