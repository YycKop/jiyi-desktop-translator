# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第七轮修复记录（背景图·中文标点·拖拽手感·字体颜色）》。

用法：python gen_fix_round7_doc.py
"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "开发文档")
OUT_NAME = "桌面翻译助手 第七轮修复记录（背景图·中文标点·拖拽手感·字体颜色）.docx"

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
    style_run(p.add_run(text), size=16 if level == 1 else 13, bold=True, color=ACCENT)
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


def table(doc, header, rows):
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
    style_run(title.add_run("桌面翻译助手 V1 · 第七轮修复记录"), size=20, bold=True, color=ACCENT)
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_run(sub.add_run("背景图报错 · 中文标点识别 · 手柄拖拽手感 · 字体颜色"), size=11, color=MUTED)
    note(doc, "版本：1.0.0 ｜ 日期：2026-10-30 ｜ 构建：dist/win-x64（portable，尚未重新出发布包）")

    heading(doc, "一、用户反馈")
    para(doc, "用户在第六轮验收后提出 4 条问题（原话）：")
    bullets(
        doc,
        [
            "「无法设置背景图，报错设置背景图失败:Cannot read properties of undefined (reading 'home')」",
            "「对中文字和标点的识别率很低」",
            "「使用右下角手柄更改浮窗大小时移动稍快就无法拖动，有时松开鼠标也依旧能拖动」",
            "「增加字体颜色设置选项在外观设置处」",
        ],
    )
    para(doc, "用户同时要求：修改完先不要重新打发布压缩包，等验收后再通知打包。本轮只更新便携版目录，未生成 release 包。")

    heading(doc, "二、背景图报错")
    heading(doc, "2.1 根因", level=2)
    para(doc, "取数据目录时写成了 ctrl.engine.paths.home()，而 TranslatorEngine 并不对外暴露 paths，"
              "因此一进到这个函数就抛 TypeError（undefined 上读 home）。只有点「选择图片…」才会走到这段，"
              "所以「主题色/不透明度」都正常，唯独背景图必失败。")
    heading(doc, "2.2 修法", level=2)
    bullets(
        doc,
        [
            "把背景图的目录/大小/格式逻辑从 ipc.js 的闭包里抽成独立模块 src/main/theme-files.js"
            "（themeDir / readThemeImage / importThemeImage），只依赖 core/paths。",
            "ipc.js 只保留 IPC 编排：选图 → importThemeImage 复制进 <数据目录>/theme/ → 写配置 → 返回 data URL。",
            "抽出来的好处：这类「拿不到某对象」的低级错误可以被单元测试直接盯住，不必启动 GUI 才发现。",
        ],
    )
    heading(doc, "2.3 验证", level=2)
    table(
        doc,
        ["检查项", "结果"],
        [
            ["themeDir() 在建 home 下创建 theme/，重复调用不抛错", "✅ 单测通过"],
            ["readThemeImage() 读 PNG 返回 data:image/png;base64,…", "✅ 单测通过"],
            ["非图片扩展名 / 不存在的路径 / 空值 返回 null 而不抛错", "✅ 单测通过"],
            ["importThemeImage() 复制为 theme/bg-<时间戳>.png 并回传 data URL", "✅ 单测通过"],
            ["超过 8MB 与格式错误给出 CONFIG_INVALID", "✅ 单测通过"],
            ["端到端：导入背景图后浮窗 --theme-image 已下发（自检）", "✅ hudBgImageApplied=true"],
        ],
    )

    heading(doc, "三、中文与标点识别")
    heading(doc, "3.1 现象与原因", level=2)
    para(doc, "系统 OCR 对中文的识别能力不差，问题出在输出形态与标点：")
    bullets(
        doc,
        [
            "汉字之间被插入空格：「欢迎使用」→「欢 迎 使 用」（系统 OCR 按字返回词框，拼接时带空格）。",
            "中文标点被识别成半角：「，」→「 , 」、「。」→「 . 」、「：」→「 : 」、「！」→「 ! 」。",
            "标点前后还残留空格：「，然后」→「 ， 然 后」。",
            "个别同形字（口/囗、幕/墓）属字体级歧义，任何放大倍数都无法可靠纠正，不做自动改写。",
        ],
    )
    heading(doc, "3.2 三项改进", level=2)
    table(
        doc,
        ["改进", "做法", "目的"],
        [
            ["中文标点规范化", "repairCjkPunctuation()：半角→全角（，；：？！（））、含中文的括号整对转全角、中文后的 . → 。（避开 3.5 / v1.2）、成对引号转中文引号，最后去掉汉字与全角标点之间的空白", "输出「能直接念」的中文句子"],
            ["多遍逐行择优", "mergeLines()：2x 与 3x 两遍识别行数一致时，逐行比分数取更干净的一行（不再整段二选一）", "一行认错不再拖累整段"],
            ["标点参与打分", "scoreText() 新增 cjk-ascii-punct 惩罚项", "让「标点规范的那一遍」稳定胜出"],
        ],
    )
    note(doc, "顺序很重要：必须先转标点再收空格，否则「， 然后」会留下半角空格残渣。")
    heading(doc, "3.3 实测对照（同一张 26px 合成图）", level=2)
    table(
        doc,
        ["阶段", "输出", "字符数"],
        [
            ["修复前", "请点击保存按钮 ， 然后继续 。 / 提示 ： 请勿关闭窗囗 ！", "30"],
            ["修复后", "请点击保存按钮，然后继续。 / 提示：请勿关闭窗囗！", "24"],
        ],
    )
    para(doc, "注：唯一残留错误是「口→囗」的同形字，属字体歧义，不做猜测性改写。"
              "新增合成图 项目测试/fixtures/cjk-punct-640x200.png 与三条断言（汉字间不得有空格、"
              "中文里不得残留半角标点、全角标点后不得有空格），纳入 ocr-accuracy 全量回归。")

    heading(doc, "四、手柄拖拽手感")
    heading(doc, "4.1 根因", level=2)
    para(doc, "窗口只有 460×240 左右，光标快速移动会离开窗口范围；没拿到系统鼠标捕获时，"
              "窗口外的 mousemove 与 mouseup 都不会送达，于是「移动稍快就拖不动」「松手后仍在拖」。")
    heading(doc, "4.2 修法（双保险）", level=2)
    bullets(
        doc,
        [
            "渲染进程改用 Pointer Events + setPointerCapture：按下时捕获指针，之后即使光标跑出窗口，"
            "pointermove / pointerup 仍会送到手柄；另加 pointercancel、lostpointercapture、window.blur、"
            "visibilitychange 四个兜底，保证「松手一定结束」。",
            "主进程按真实光标 16ms 轮询尺寸（HudPointerWatcher.pause() 在拖拽期间暂停穿透切换），"
            "即使渲染进程丢事件也照样跟手。",
            "渲染进程的 move 与主进程轮询算的是同一个「基准尺寸 + 位移」，两者一致；事件先到立刻跟手，"
            "事件丢失由轮询补上。",
            "松手时把尺寸写进 hud.width / height，并把「高度自适应」落盘关掉，避免下一轮译文把高度弹回去。",
        ],
    )
    heading(doc, "4.3 验证", level=2)
    table(
        doc,
        ["检查", "结果"],
        [
            ["自检用真实输入事件（sendInputEvent）走 mouseDown → 8 次 mouseMove → mouseUp", "✅ 460×262 → 540×312"],
            ["自检结束把尺寸与 autoHeight 恢复原值（不污染用户配置）", "✅ hudResizeDelta 已记录前后值"],
            ["松手后拖拽状态结束（指针捕获 + 四个兜底事件）", "✅ 无「粘手」复现"],
        ],
    )

    heading(doc, "五、字体颜色")
    bullets(
        doc,
        [
            "配置新增 appearance.textColor（空字符串 = 跟随背景自动对比）。",
            "主题模块由它派生 --fg / --fg-dim / --fg-faint：自定义时按该颜色做透明度分层，不自定义时按背景深浅自动选深/浅字。",
            "外观页「背景色」旁新增「字体颜色」：取色器 + 当前值显示 + 「跟随背景」按钮。",
            "改动即时预览，松手 320ms 后落盘；浅色背景 + 深色字仍是默认的安全组合。",
        ],
    )
    table(
        doc,
        ["检查", "结果"],
        [
            ["设定 #ffd666 后浮窗 --fg", "✅ #ffd666"],
            ["再点「跟随背景」恢复", "✅ 回到 #e8ecf3（深色背景的自动字色）"],
            ["自检断言 hudTextColorApplied", "✅ true"],
        ],
    )

    heading(doc, "六、验证与产物")
    table(
        doc,
        ["项目", "命令", "结果"],
        [
            ["全量测试", "node 项目测试\\run-all.js", "18 个文件 / 146 个用例，0 失败"],
            ["单元", "--only=unit", "13 个文件 / 102 个用例"],
            ["集成", "--only=integration", "4 个文件 / 33 个用例"],
            ["OCR 精度", "--only=ocr", "11 个用例（9 张图 + 2 项汇总）全过"],
            ["Electron 自检", "node 项目代码\\scripts\\smoke.js", "ok=true、渲染错误 0、截图 8 张"],
            ["打包产物自检", "dist\\win-x64\\桌面翻译助手.exe --smoke-test", "exit=0、ok=true、全部 checks 为 true"],
        ],
    )
    para(doc, "新增/修改文件一览：")
    table(
        doc,
        ["文件", "变更"],
        [
            ["src/main/theme-files.js", "新增：主题目录、读图、导入（可单测）"],
            ["src/main/ipc.js", "背景图 handler 改为调用 theme-files；尺寸拖拽重写为 16ms 轮询 + 渲染事件双驱动"],
            ["src/main/hud-pointer.js", "新增 pause()/resume()，拖拽期间不切换穿透"],
            ["src/main/main.js", "拖拽期间暂停穿透；自检新增背景图/字体颜色/真实输入拖拽断言；自检产物在打包环境落到数据目录"],
            ["src/core/ocr/score.js", "新增 repairCjkPunctuation / mergeLines / cjk-ascii-punct 打分"],
            ["src/core/ocr/winrt.js", "多遍结果逐行合并、标点规范化"],
            ["src/core/config/defaults.js + store.js", "appearance.textColor 与校验"],
            ["src/renderer/shared/theme.js", "字体颜色入 palette"],
            ["src/renderer/hud/app.js", "手柄与标题栏改 Pointer Events + 取消捕获兜底"],
            ["src/renderer/settings/*", "「字体颜色」控件与「跟随背景」按钮"],
            ["项目测试/unit/theme-files.test.js", "新增 6 个用例"],
            ["项目测试/unit/score.test.js", "7 → 14 个用例"],
            ["项目测试/ocr-accuracy.test.js", "新增中文标点/空格三条断言 + 一张合成图"],
        ],
    )

    heading(doc, "七、已知限制")
    bullets(
        doc,
        [
            "同形字（口/囗、幕/墓）不做自动改写，改了反而可能错得更离谱。",
            "中文标点规范化只处理紧邻中文的标点；纯英文句子里的半角标点保持原样（英文本来就该用半角）。",
            "拖动时窗口高度会被钳制在 96–900，极端小屏上无法再拉大——这是为避免遮住整块屏幕。",
        ],
    )

    heading(doc, "八、变更记录")
    table(
        doc,
        ["时间", "内容"],
        [
            ["2026-10-30", "第七轮：背景图报错、中文标点、手柄拖拽、字体颜色；测试增至 146 用例；重新打包便携版（未出 release 包）"],
        ],
    )
    note(doc, "本文件由 项目测试/tools/gen_fix_round7_doc.py 生成。")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, OUT_NAME)
    doc.save(out)
    print("saved:", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
