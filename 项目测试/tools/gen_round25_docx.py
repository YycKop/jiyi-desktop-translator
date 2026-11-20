"""生成《即译 第二十五轮记录》：悬浮球气泡菜单 / 二合一控制条 / 图标统一 / 原文按需展开。

运行：
  python 项目测试/tools/gen_round25_docx.py
输出：
  开发文档/即译 第二十五轮记录（气泡菜单·二合一控制条·原文按需）.docx
"""

import os
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "开发文档", "即译 第二十五轮记录（气泡菜单·二合一控制条·原文按需）.docx")

ACCENT = RGBColor(0x4C, 0x8D, 0xFF)
MUTED = RGBColor(0x6B, 0x72, 0x80)


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.color.rgb = ACCENT if level == 1 else RGBColor(0x22, 0x26, 0x30)
    return p


def para(doc, text, muted=False, size=10.5):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    if muted:
        run.font.color.rgb = MUTED
    return p


def bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        run = p.add_run(item)
        run.font.size = Pt(10.5)


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Light Grid Accent 1"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, cell in enumerate(t.rows[0].cells):
        cell.text = header[i]
        for p in cell.paragraphs:
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(10)
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
            for p in cells[i].paragraphs:
                for run in p.runs:
                    run.font.size = Pt(9.5)
    return t


doc = Document()
style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(10.5)

title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
trun = title.add_run("即译 · 第二十五轮记录")
trun.bold = True
trun.font.size = Pt(20)
trun.font.color.rgb = ACCENT

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
srun = sub.add_run("悬浮球气泡菜单 · 字幕条二合一控制 · 图标统一 · 原文按需展开")
srun.font.size = Pt(11)
srun.font.color.rgb = MUTED

meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
mrun = meta.add_run("版本 v1.0.0 ｜ 日期 2026-11-19 ｜ 产物 dist\\win-x64（196.9 MB zip）")
mrun.font.size = Pt(9)
mrun.font.color.rgb = MUTED

heading(doc, "1. 用户需求")
para(doc, "原文（第二十五轮反馈）：")
bullets(doc, [
    "悬浮球的样式目前不够美观，菜单弹出和收起会有黑框闪来闪去，把横条菜单弹出改成气泡浮现。",
    "把字幕条的拖动区域和设置区域二合一，放到字幕条正中上方，点击后向两侧扩展显示出设置菜单，点击不松开则可以拖动字幕条移动。",
    "浮窗的实时翻译的暂停和启动的图标都不统一，统一风格。",
    "修改卡片浮窗的原文内容显示，不再主动显示，点击左下角原文才展开原文记录。",
])

heading(doc, "2. 问题成因")
table(doc, ["现象", "成因"], [
    ["气泡/横条弹出时闪黑框",
     "透明窗口被 resize：44×44 的球窗每展开一次都要长成 300×44，Windows 在透明窗改变尺寸时会重绘底帧，闭包里的阴影与 backdrop-filter 又叠加了一层暗晕。"],
    ["设置区与拖动区分离、难以找到",
     "控制按钮在右上角胶囊里，拖动握把在顶部中间，二者相距很远且都要精确命中；用户反馈「右上角很难找」。"],
    ["暂停/启动图标不统一",
     "卡片用字符（▶ / ⏸），字幕条里也各写各的；且 `renderPause()` 只更新了卡片那个按钮，字幕条按钮停在旧图标。"],
    ["原文总是占地方",
     "卡片浮窗把原文固定渲染在译文下方，短译文时浪费高度，长原文时把译文挤出可视区。"],
    ["未选中时仍挂着边框和设置按钮",
     "收起态的 `.hud-dock` 仍带 `rgba(10,14,22,.62)` 底 + 1px 白边 + 0.72 不透明度，等于在画面上常驻一个小黑框。"],
    ["左右两侧拖动的语义不一致",
     "拖右边是「改宽」，拖左边被实现成「整体平移 + 改宽」的复合动作；主进程 `calcHudBounds()` 本身已保证右边缘守恒，问题出在渲染侧的指针事件与轮询叠加。"],
])

heading(doc, "3. 改动明细")
table(doc, ["文件", "改动"], [
    ["src/main/windows.js",
     "球窗口固定 150×202（`BALL_WIN_W/H`），球居底部；`setBallExpanded()` 只切状态不再 resize；新增 `ballWindowPosition/ballPointOf/ballClientRect/setBallIgnoreMouse`。"],
    ["src/main/ball-pointer.js（新增）",
     "90ms 轮询光标：在球上 → 关穿透并展开；已展开且指针还在窗口内 → 保持；否则开穿透并收起。把「悬停判定」从渲染进程搬到主进程，避免透明窗收不到 mouseenter。"],
    ["src/renderer/ball/*",
     "竖排气泡菜单（设置/输入翻译/显示浮窗/退出即译）、`data-open` 控制淡入与 `scale(.96)→1`、`::after` 小尖角指向球；移除全部 `box-shadow` 与 `backdrop-filter`。"],
    ["src/renderer/hud/index.html",
     "`.hud-rail` 换成 `.hud-dock#dock`（左：设置/复制，中：`.dock-handle` 握把，右：暂停/收起/关闭）；暂停按钮两处都改为内联 SVG（`.ico-play` / `.ico-pause`）。"],
    ["src/renderer/hud/app.js",
     "`toggleDock()` + 握把 pointer 手势（<3px 抬起＝展开/收起，≥3px＝`hud.drag()` 移动窗口）；`renderPause()` 只写 `data-state`；原文渲染改为 `state.sourceVisible` 控制。"],
    ["src/renderer/hud/hud.css",
     "`.hud-dock` 收起态全透明（opacity .62、无边无底），hover/expanded 才给深色胶囊；`.dock-grip` 白字 + 双层黑描边；顶部 `.hud-head` 在字幕模式 `display:none`。"],
    ["src/main/main.js",
     "自检新增/改写：`hudSubtitleRail`（居中向两侧涨、中心不漂）、`hudSubtitleHit`、`hudSourceToggle`（默认收起→点开→再点收起，并校验入口在页脚左下 30% 内）、`ballHover`（气泡透明度 + 窗口尺寸稳定）。"],
])

heading(doc, "4. 验证数据（开发态 smoke）")
table(doc, ["检查项", "结果"], [
    ["整体", "ok=true，rendererErrors=0，截图 17 张"],
    ["hudSubtitleRail", "收起 46px / 展开 180px，左右各涨 67px，中心偏移 0px"],
    ["hudSubtitleHit", "dock 与三条边缘热区 `elementFromPoint` 均命中且带 `.interactive`"],
    ["hudSubtitleRelease", "拖左边缘：x 380→310、宽 1400→1470、右边缘恒为 1780；`buttons:0` 后宽度冻结"],
    ["hudSourceToggle", "默认 `wrapVisible=false`、按钮在页脚内（leftRatio 0.04）；点开变「原文 ▾」并显示原文，再点收起"],
    ["ballHover", "窗口 150×202 前后不变；气泡 open=true、opacity=1；移出 open=false、opacity=0"],
    ["hudSubtitlePauseSync", "两处按钮 data-state 同步切换（等待 2600ms 覆盖异步 IPC）"],
    ["全量测试", "node 项目测试\\run-all.js → 27 个文件，失败 0"],
])

heading(doc, "5. 打包态验证")
table(doc, ["项目", "结果"], [
    ["dist\\win-x64", "重建完成；zip 196.9 MB（含 onnxruntime + 中/日/韩 OCR 模型）"],
    ["即译.exe --smoke-test", "ok=true、rendererErrors=0、截图 14 张"],
    ["其余 false", "jumpList / trayAccepted —— 本机通知区域与 JumpList 的已知限制，非代码缺陷"],
])

heading(doc, "6. 使用说明")
bullets(doc, [
    "悬浮球：鼠标移到球上，球上方浮出竖排气泡菜单；移开自动收起，全程窗口尺寸不变，不会闪黑框。",
    "字幕条：顶部正中一个淡淡的握把 —— 单击展开/收起两侧按钮，按住拖动则移动整条字幕。",
    "左右边缘拖动只改宽度：拖左边是左边缘伸缩、右边缘不动；拖右边同理。底部热区改高度。",
    "卡片浮窗：译文下方不再强制展示原文；左下角「原文 ▸」点开显示，「原文 ▾」再点收起。",
])

heading(doc, "7. 已知限制")
bullets(doc, [
    "气泡菜单靠 90ms 光标轮询判定悬停，快速掠过时可能来不及展开（继续移动就会展开）。",
    "字幕条收起态刻意不加底色，握把用白字 + 黑描边保证可读；若在纯白画面上仍觉得淡，可开启「字幕底衬」。",
    "原文展开状态只在本次运行内保持，重启后回到收起态（配置项 `hud.showSource` 默认 false）。",
])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT), "bytes")
