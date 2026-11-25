"""生成 / 更新「即译 第二十八轮记录」docx。"""

import os
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十八轮记录（热键状态与图标居中）.docx"


def h(doc, text, size=14):
    p = doc.add_heading(text, level=1)
    for r in p.runs:
        r.font.size = Pt(size)
    return p


def para(doc, text, bold=False):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = bold
    return p


def table(doc, head, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(head))
    t.style = "Table Grid"
    for i, htext in enumerate(head):
        cell = t.rows[0].cells[i]
        cell.text = htext
        for pr in cell.paragraphs:
            for run in pr.runs:
                run.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = str(val)
    return t


doc = Document()
title = doc.add_heading("即译 · 第二十八轮记录", level=0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub = doc.add_paragraph("热键收起 / 暂停图标同步 / 图标居中 · 并发布 v1.0.1")
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER

para(doc, "版本 v1.0.1　|　日期 2026-11-21　|　产物 dist\\win-x64、dist\\即译-1.0.1-win-x64.zip、"
          "dist\\即译-1.0.1-portable-win-x64-nomodel.zip（212.3 MB）")

h(doc, "一、用户反馈与根因")
table(doc, ["编号", "现象", "根因", "修法"], [
    ["R-1", "热键收起后，再按热键显示的是浮窗（应当展开）",
     "toggleCollapse() 用「悬浮球是否可见」推断收起状态；悬浮球自第十九轮起常驻显示，"
     "于是永远判成「已收起」，只走 expand()",
     "改按 this.wm.hudVisible 判断：显示中→收起，否则→展开"],
    ["R-2", "热键/托盘暂停后，浮窗上的 ⏸/▶ 图标不变",
     "startLoop()/stopLoop() 只 refreshTray()，没有把 LOOP_STARTED/LOOP_STOPPED 事件发给窗口；"
     "HUD 其实一直在监听这两个事件",
     "两个方法里补 wm.emit(EVENTS.LOOP_STARTED/LOOP_STOPPED)"],
    ["R-3", "字幕条 ⏸ 图标偏左，与按钮背景不居中",
     "内联 SVG 是块级元素，button.icon 靠 text-align 居中，对块级子元素无效",
     "button.icon 改 display:inline-flex + align/justify center"],
])

h(doc, "二、改动清单")
table(doc, ["文件", "改动"], [
    ["src/main/main.js", "toggleCollapse() 判断依据改为 hudVisible；startLoop()/stopLoop() 广播循环状态"],
    ["src/renderer/hud/hud.css", "新增 .hud-head button.icon / .dock-side .icon 的 flex 居中规则"],
    ["src/main/main.js（自检）", "新增 hudHotkeyCollapse / hudHotkeyPauseSync / hudIconCentered 三条断言"],
    ["项目代码/package.json", "版本 1.0.0 → 1.0.1"],
    ["README.md / docs/使用说明.md / docs/开发说明.md", "下载文件名与版本号同步到 1.0.1，补 -AssetName 用法"],
    ["项目代码/AGENTS.md", "第 6 节新增「第二十八轮」5 条经验；版本基表注明最新补丁 1.0.1"],
])

h(doc, "三、验证")
table(doc, ["检查项", "开发态", "打包态"], [
    ["hudHotkeyCollapse", "收起后 hud=false，再按 hud=true", "同左"],
    ["hudHotkeyPauseSync", "主进程 toggleLoop 后两处 data-state 一致（paused→running→paused）", "同左"],
    ["hudIconCentered", "dx=0px / dy=0px", "同左"],
    ["全量测试", "27 个文件，失败 0", "—"],
    ["打包自检", "—", "ok=true、rendererErrors=0、截图 14"],
])

h(doc, "四、发布")
table(doc, ["项目", "内容"], [
    ["仓库", "https://github.com/YycKop/jiyi-desktop-translator（提交 65ca71d，334 文件 / 3.47 MB）"],
    ["发布页", "https://github.com/YycKop/jiyi-desktop-translator/releases/tag/v1.0.1"],
    ["资产", "jiyi-1.0.1-portable-win-x64-nomodel.zip，222,588,136 B（与本地构建逐字节一致）"],
    ["未发布的包", "含模型包约 1.2 GB：混元许可限制向欧盟/英国/韩国分发，仓库不提供，README 说明自行放置 GGUF"],
])

h(doc, "五、已知限制")
para(doc, "1. 本机 hosts 把 github.com 指向 127.0.0.1 的本地代理，浏览器/curl 直连 release 下载链接不可用，"
          "资产可下载性只能通过 API 元数据（state=uploaded、size 一致）确认；请在能访问 GitHub 的环境复验一次下载。")
para(doc, "2. 提交信息沿用发布脚本模板「即译 v1.0.0：源码、测试与使用文档」，未随 tag 变化；"
          "Release 标题与说明已按 v1.0.1 单独修正。")
para(doc, "3. 令牌只在命令行环境变量中传递，未写入任何文件；发布后建议轮换。")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT))
