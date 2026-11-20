#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第五轮修复记录：悬浮球·识别精度·一键暂停·重复计费.docx》"""
import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml.ns import qn

OUT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "开发文档",
    "桌面翻译助手 第五轮修复记录（悬浮球·识别精度·一键暂停·重复计费）.docx"))


def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = "微软雅黑"
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    if color:
        run.font.color.rgb = color


def para(doc, text, size=10.5, bold=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.35
    set_font(p.add_run(text), size, bold)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(text), 10)
    return p


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    set_font(p.add_run(text), 9)
    p.runs[0].font.name = "Consolas"
    p.runs[0]._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")


def table(doc, rows):
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = "Table Grid"
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            c = t.cell(i, j)
            c.text = ""
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            set_font(p.add_run(str(cell)), 9, bold=(i == 0))


def build():
    doc = Document()

    h = doc.add_heading("桌面翻译助手 第五轮修复记录", level=0)
    h.alignment = 1
    para(doc, "悬浮球不可用 · 识别精度（i/l 混淆）· 一键暂停 · 重复计费", 12, True)
    para(doc, "版本：1.0.0（第五轮）    日期：2026-10-30    适用范围：项目代码 / 项目测试")
    para(doc, "对应反馈：「1.点击悬浮球没有反应，也无法拖动；2.文字识别准确率有点低，出现把 i 看成 l 的情况；"
              "3.想取消当前翻译还要去设置面板，太麻烦；4.识别不准导致多次轮询对相同文本重复调用 API，花销增多」")

    # 1
    doc.add_heading("一、结论速览", level=1)
    table(doc, [
        ["问题", "根因", "修复", "验证"],
        ["悬浮球点不动/拖不动",
         "ensureBall() 同样使用了 focusable:false，Windows 丢弃该窗口的 mousedown/mouseup/click",
         "改为 focusable:true + acceptFirstMouse:true，仍用 showInactive() 不抢焦点",
         "smoke 新增 checks.ballClickExpands=true"],
        ["i 被识别成 l（精度低）",
         "单一放大倍数下 OCR 各有胜负：2x 把 Please 认成 PIease，3x 会把 the 拆成 th e",
         "多遍识别（2x+3x 并行）+ 异常形状打分择优 + repairText 收敛残留混淆",
         "8 张合成图全部达标；il-* 三张由 0.98 提升到 1.0"],
        ["取消翻译要进设置",
         "暂停能力只在设置面板/tray 子菜单暴露，浮窗上没有入口",
         "浮窗 ⏸/▶ 按钮 + Esc + 热键 Ctrl+Shift+P + 托盘顶层菜单",
         "smoke 新增 pauseButton / resumeButton=true"],
        ["同一段文字重复调用 API",
         "去重用精确哈希，OCR 抖一个字符就换哈希 → 每轮都请求；且无译文缓存",
         "归一化指纹 + 相似度阈值（0.98）判同 + 10 分钟译文缓存",
         "4 轮抖动文本只请求 1 次（dedupe.test.js）"],
    ])

    # 2
    doc.add_heading("二、缺陷 1：悬浮球不可用", level=1)
    para(doc, "现象与证据", 11, True)
    bullet(doc, "用户反馈：单击悬浮球不展开浮窗，按住也无法移动。")
    bullet(doc, "排查：浮窗上一轮修过同一问题（focusable:false 导致点击被丢弃）；检查 ensureBall() 发现"
                "同样是 focusable:false + skipTaskbar + transparent，属于同一类窗口。")
    bullet(doc, "结论：WS_EX_NOACTIVATE 窗口只收到 mousemove，mousedown/mouseup/click 被系统丢弃，"
                "而悬浮球的渲染逻辑依赖 mousedown → mouseup 的位移判定，因此既不能点也不能拖。")
    para(doc, "修复", 11, True)
    code(doc, "// src/main/windows.js  ensureBall()\n"
              "focusable: process.env.DT_BALL_NOACTIVATE !== '1',\n"
              "acceptFirstMouse: true,   // 首次点击即生效，避免第一下只激活窗口")
    para(doc, "渲染层无需改动：位移 <4px 视为点击 → api.hud.expand()，>4px 逐帧 api.window.drag('move')。"
              "不抢焦点仍由 showBall() 的 showInactive() 保证（F-17）。")

    # 3
    doc.add_heading("三、缺陷 2：识别精度（i 被识别成 l）", level=1)
    para(doc, "3.1 实验：放大倍数不存在「通吃」值", 11, True)
    para(doc, "用同一批合成图分别在 2x / 3x / 4x 下识别（Windows.Media.Ocr，Segoe UI 渲染），"
              "结果（→ 表示该倍数下的错误）：")
    table(doc, [
        ["测试图", "2x", "3x", "4x"],
        ["il-640x160（20px）", "PIease →0.9841", "全对 1.0", "全对 1.0"],
        ["il-small-480x90（16px）", "全对 1.0", "Click th e link →断词", "Click th e link"],
        ["il-dark-560x120（18px 深底）", "Log in tO →1.0", "LO g in tO → 更低分", "LO g in t0 →0.9667"],
        ["en-480x120（22px）", "JUmps → 大小写错", "全对 1.0", "brown fo × →0.9722"],
        ["small-360x90（16px 中文）", "字 墓 第 一 行", "同上", "字 幕 第 一 行（英文变 SubtitIes）"],
    ])
    para(doc, "结论：**没有任何单一倍数在所有图上都最好**，所以不能靠「换一个倍数」解决，必须多遍识别后择优。")

    para(doc, "3.2 方案：多遍识别 + 异常形状打分 + 定向修复", 11, True)
    bullet(doc, "并行识别：winrt.recognizeMulti() 同时跑 2x 与 3x（Promise.allSettled，单遍失败不影响整体），"
                "总耗时 456~531 ms，仍在 N-01「离线 ≤3s」预算内。")
    bullet(doc, "打分：core/ocr/score.js 只惩罚 OCR 典型错误形状——case-jump（PIease/JUmps/LOg/SubtitIes）、"
                "single-letter（孤立的 g/e 等）、symbol-line（纯符号行）、digit-in-word；同分取靠前的 2x（更快）。")
    bullet(doc, "修复：repairText() 只做三条窄规则——`(大写)I+小写 → 大写l`、`小写I+小写 → 小写l`、"
                "`词尾突然大写 → 转小写`（tO→to）。不动 iPhone / macOS / USA 这类正常写法（有单测守住）。")
    bullet(doc, "不依赖词典、不联网、不新增依赖（符合 DSH-02 与 N-04 隐私要求）。")

    para(doc, "3.3 前后对比", 11, True)
    table(doc, [
        ["测试图", "修复前", "修复后", "相似度"],
        ["il-640x160", "PIease click the link…", "Please click the link to fill in your details.", "0.9841 → 1.0"],
        ["il-dark-560x120", "Log in tO see your profile settings.", "Log in to see your profile settings.", "1.0 → 1.0（错字已修）"],
        ["en-480x120", "The quick brown fox / JUmps over…", "The quick brown fox / jumps over…", "0.9722 → 1.0"],
        ["small-360x90", "Subtitles / 字 墓 第 一 行", "Subtitles / 字 墓 第 一 行", "0.9524（中文同形字，属字体渲染限制）"],
    ])
    para(doc, "小字号（14~16px）仍是精度下降区，已在用户文档中注明；建议框选时略微放宽区域或使用更大字号。")

    # 4
    doc.add_heading("四、缺陷 3：一键取消当前翻译", level=1)
    table(doc, [
        ["入口", "位置", "说明"],
        ["浮窗 ⏸ / ▶", "标题栏（⚙ 左侧）", "点击即暂停；暂停会 abort 正在进行的这一轮"],
        ["Esc 键", "浮窗内", "等价于暂停，符合「随手一按就停」"],
        ["热键", "CommandOrControl+Shift+P", "可在设置 → 热键里改成自定义组合（REV-001 G-02 要求不得硬编码）"],
        ["托盘菜单", "顶层「暂停定时翻译 / 开始定时翻译」", "原来藏在「定时轮询」子菜单里，现已提升为顶层项"],
    ])
    para(doc, "实现要点：浮窗上的状态以主进程为准（点击时先 api.status() 校准，再切换），"
              "避免托盘/热键改过状态后浮窗按钮变成反向操作。")

    # 5
    doc.add_heading("五、缺陷 4：同一段文字重复调用付费接口", level=1)
    para(doc, "5.1 根因")
    bullet(doc, "旧逻辑：`state.lastSourceHash === hashText(sourceText)`，即**精确哈希**。")
    bullet(doc, "OCR 每轮会抖 1~2 个字符（i/l、O/0、少一个标点），哈希随之一变，去重立即失效。")
    bullet(doc, "定时轮询 2 秒一轮 → 同一段字幕每分钟最多 30 次请求，费用随抖动线性放大。")
    para(doc, "5.2 修复：归一化指纹 + 相似度 + 译文缓存")
    code(doc, "// src/core/translate/fingerprint.js\n"
              "normalizeForCompare: 去空白与标点 → 小写 → i/l/1/| 归一为 i → O/0 归一为 o → rn→m\n"
              "isSameContent(prev, next, {threshold: 0.98}): 归一等价或编辑距离相似度 ≥ 阈值即视为同一段")
    bullet(doc, "去重：`general.dedupeEnabled` 时，若本轮原文与上一轮判为同一段，直接复用上次译文并标 `unchanged:true`。")
    bullet(doc, "缓存：`general.cacheTtlMs`（默认 10 分钟，最多 50 条）按「目标语言 + 归一化原文」缓存译文，"
                "来回切换同一段文字不再请求接口。")
    bullet(doc, "`force`（用户点 ⟳ 重新翻译）永远绕过去重与缓存，保证手动刷新一定拿到新译文。")
    table(doc, [
        ["场景", "修复前", "修复后"],
        ["4 轮 OCR 抖动文本（Please/PIease/it wiII…）", "4 次 API 调用", "**1 次**（后三轮 unchanged）"],
        ["A→B→A 来回切换", "3 次调用", "2 次（第三轮缓存命中）"],
        ["内容确实变化", "1 次", "1 次（判为不同段）"],
        ["手动 ⟳", "1 次", "1 次（force 生效）"],
    ])

    # 6
    doc.add_heading("六、验证", level=1)
    table(doc, [
        ["项目", "结果"],
        ["单元 + 集成 + OCR 精度（`node 项目测试\\run-all.js`）", "15 个文件 / 116 个用例，失败 0"],
        ["新增测试", "fingerprint.test.js(7)、score.test.js(7)、dedupe.test.js(5)；ocr-accuracy 增加 3 张 il-* 图"],
        ["Electron 自检（`node 项目代码\\scripts\\smoke.js`）", "ok=true、渲染错误=0、截图 6 张、ballClickExpands/pauseButton/resumeButton 均 true"],
        ["打包（`node 项目代码\\scripts\\package-win.js`）", "dist\\win-x64（启动器 9 KB）+ zip（约 103 MB）"],
        ["打包产物自检", "exit=0，[smoke] ok=true，rendererErrors=0"],
    ])

    # 7
    doc.add_heading("七、改动文件清单", level=1)
    table(doc, [
        ["文件", "改动"],
        ["src/main/windows.js", "ensureBall() 改 focusable:true / acceptFirstMouse；DT_BALL_NOACTIVATE 开关"],
        ["src/core/ocr/score.js", "新增：scoreText / chooseBest / hasCaseJump / repairText"],
        ["src/core/ocr/winrt.js", "新增 recognizeMulti()；recognize() 出口统一走 repairText()"],
        ["src/core/ocr/index.js", "OcrService.recognize 默认多遍；status() 改为同步快照"],
        ["src/core/translate/fingerprint.js", "新增：归一化指纹、编辑距离相似度、cacheKey"],
        ["src/core/pipeline/round.js", "去重改指纹相似度；新增译文缓存与过期淘汰"],
        ["src/renderer/hud/index.html / app.js", "新增 #btn-pause（⏸/▶）、Esc 暂停、状态以主进程为准"],
        ["src/shared/accelerator.js", "ACTIONS 增加 pause，ACTION_LABELS 文案"],
        ["src/core/config/defaults.js", "hotkeys.pause = CommandOrControl+Shift+P"],
        ["src/main/main.js", "toggleLoop()；热键/tray 动作接线；smoke 增加球点击与暂停断言"],
        ["src/main/tray.js", "顶层「暂停/开始定时翻译」"],
        ["项目测试/fixtures/gen-il-fixtures.ps1", "新增 3 张 i/l 混淆回归图"],
        ["项目测试/tools/ocr-experiment.js", "倍数实验脚本（输出 reports/ocr-scale-experiment.json）"],
        ["项目测试/run-all.js", "并入 OCR 精度组，支持 --only=ocr"],
    ])

    # 8
    doc.add_heading("八、用户操作提示", level=1)
    bullet(doc, "悬浮球：单击展开浮窗，按住拖动可移动；收起用浮窗标题栏的「—」。")
    bullet(doc, "停止翻译：浮窗 ⏸ 按钮或 Esc，也可以按 Ctrl+Shift+P（可在 设置 → 热键 修改）。")
    bullet(doc, "识别不准时：① 框选区域尽量紧贴文字；② 设置里把浮窗字号调大不影响识别，"
                "真正影响的是屏幕上原文字号，14px 以下是已知下降区；③ 手动 ⟳ 可强制重新识别与翻译。")
    bullet(doc, "费用控制：默认开启「文字未变化时跳过重复翻译」，并用 10 分钟译文缓存；"
                "如需每次强制请求，点 ⟳ 即可单次绕过。")

    doc.add_heading("九、变更记录", level=1)
    table(doc, [
        ["版本", "日期", "内容"],
        ["1.0.0-r5", "2026-10-30", "修复悬浮球不可用、提升 OCR 精度（多遍识别+修复）、新增一键暂停四处入口、去重改指纹+译文缓存"],
    ])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("written:", OUT)
    print("size:", os.path.getsize(OUT))


if __name__ == "__main__":
    build()
