# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 第八轮修复记录（繁体与语言互译·设置页背景同步·浮窗背景图裁切）》。

用法：python gen_fix_round8_doc.py
"""

import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "开发文档")
OUT_NAME = "桌面翻译助手 第八轮修复记录（繁体与语言互译·设置页背景同步·浮窗背景图裁切）.docx"

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
    style_run(title.add_run("桌面翻译助手 V1 · 第八轮修复记录"), size=20, bold=True, color=ACCENT)
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_run(sub.add_run("繁体与语言互译 · 设置页背景同步 · 浮窗背景图裁切"), size=11, color=MUTED)
    note(doc, "版本：1.0.0 ｜ 日期：2026-10-30 ｜ 构建：dist/win-x64（portable，尚未重新出发布包）")

    heading(doc, "一、用户反馈")
    para(doc, "用户在第七轮验收后提出 4 条问题（原话）：")
    bullets(
        doc,
        [
            "「目前目标语言设置中文繁体或者英文，都没办法翻译出来」",
            "「设置页面也支持背景设置，提供设置页面和翻译也背景同步」",
            "「浮窗页的背景图运行设置边框和圆角，与浮窗的样式统一」",
            "「校验你提供的目标语言和源语言互相翻译，看看有哪些还不支持，尝试修复」",
        ],
    )
    note(doc, "本轮同样按上一轮要求只更新便携版 dist/win-x64，未生成 release 发布压缩包。")

    heading(doc, "二、为什么繁体/英文「翻译不出来」")
    heading(doc, "2.1 现场数据", level=2)
    para(doc, "读取用户数据目录的 config.json：目标语言 zh-TW、源语言 auto、唯一的联网 API（DeepSeek）"
              "处于「未启用」，离线模型 autostart 打开。也就是说用户实际走的是本地 1.8B 小模型，"
              "而不是我们以为的联网翻译。")
    heading(doc, "2.2 两个独立原因", level=2)
    table(
        doc,
        ["现象", "根因", "证据"],
        [
            ["改成繁体/英文后仍显示旧译文，看起来「没翻」",
             "去重只比对源文本，不看目标语言；屏幕文字没变就复用上一轮译文并标「未变化」",
             "round.js 原逻辑：lastSourceHash 相同即 return lastTranslation"],
            ["繁体确实没翻出来（模型原样回吐简体）",
             "1.8B 小模型对「Translate into Traditional Chinese」这类指令不敏感，4 种提示词里 3 种无效",
             "连跑 4 组 system prompt：A/B/D 输出与原文完全一致，仅 C（逐字转换指令）生效"],
            ["改成英文也失败",
             "同一段中文源文本 + 旧的「无需翻译」短路 + 去重复用，三者叠加",
             "去掉语言维度去重后 en 目标恢复正常"],
        ],
    )

    heading(doc, "三、修复方案")
    heading(doc, "3.1 去重加入语言维度", level=2)
    bullets(
        doc,
        [
            "round.js 计算 langKey = 源语言>目标语言，参与「是否复用上一轮」的判断；语言变了就一定重新翻译。",
            "三处写回（去重命中 / 缓存命中 / 新翻译）都同步 state.lastLangKey。",
        ],
    )
    heading(doc, "3.2 繁体走确定性转换，不花模型的时间与钱", level=2)
    bullets(
        doc,
        [
            "新增 core/translate/traditional-table.js：由 OpenCC STCharacters 生成的单字简→繁表，2712 条（16,921 B）。",
            "新增 core/translate/traditional.js：toTraditional / shouldConvert / ensureTraditional，"
            "带 targetLang 守卫（只有目标是繁体时才转换），并做「转换后简体字必须减少」的自检。",
            "链路接在 chain.js 的两处成功分支：不管结果是联网模型还是离线模型给的，只要目标是繁体，"
            "就再兜一次转换——离线小模型回吐简体时也能得到繁体。",
            "同时把 TRADITIONAL_HINT 写进 system prompt，让模型先自己尽量往繁体和台湾用语靠。",
        ],
    )
    heading(doc, "3.3 「无需翻译」短路", level=2)
    bullets(
        doc,
        [
            "新增 translate/textlang.js：判断一段文字像中文还是英文（含假名/谚文时不算中文）。",
            "round.js 增加 detectShortcut：原文已是目标语言 → 直接返回原文（engine=无需翻译）；"
            "目标是繁体且原文是中文 → 就地转换（engine=繁体转换）。两条都不调用模型，耗时 0。",
            "TranslatorEngine.translateText()（插件/宿主桥入口）用同一套规则，保证两条入口行为一致。",
        ],
    )
    heading(doc, "3.4 源语言提示挪到 system", level=2)
    para(doc, "实测把 [source language: en] 前缀写进 user 正文时，小模型会把前缀一起抄进译文"
              "（甚至输出「[Source language: English]  \\nHello world…」）。改为写进 system prompt 末尾，"
              "user 正文保持原文不动。")

    heading(doc, "四、语言互译矩阵实测")
    para(doc, "用真实离线模型（HY-MT1.5-1.8B Q4_K_M）跑 9 种目标语言 × 2 段文本 + 3 组显式源语言，"
              "脚本 项目测试/tools/lang-matrix.js，结果写入 项目测试/reports/lang-matrix.json。")
    table(
        doc,
        ["语言对", "结果", "备注"],
        [
            ["zh → zh", "✅ 直接返回原文", "无需翻译（0ms）"],
            ["zh → zh-TW", "✅ 繁体正确", "内置转换表，0ms；繁体残留简体 0/2"],
            ["en → zh", "✅ 简体", "修复 targetLang 守卫前曾被误转繁体"],
            ["en → zh-TW", "✅ 繁体", "模型 + 兜底转换"],
            ["zh → en", "✅", "约 0.9s"],
            ["zh → ja / ko / fr / de / es / ru", "✅", "各约 0.8–1.2s"],
            ["合计", "21 组 0 失败", "ECHO（译文等同原文）0 例"],
        ],
    )
    note(doc, "注：34 种语言全部走同一套「主备 API → 离线模型」链路，语言表见 core/translate/languages.js；"
              "本轮逐对验证的是用户实际会用的高频组合与全部中文变体。")

    heading(doc, "五、设置页背景同步（需求 2）")
    bullets(
        doc,
        [
            "设置页新增与浮窗同一套 .bg-layer 图层，图片、透明度、填充方式复用 --theme-image* 变量。",
            "标题栏/侧栏改为半透明底色（--bg-elevated-veil），否则实色面板会把图片完全盖住。",
            "内容区没有实色面板，图片会压住文字：在图层之上再盖一层与背景同色的薄罩"
            "（body::after + .content 的半透明底），保证「看得见图、也读得清字」。",
            "提示文案改为「背景图会同时应用到浮窗和这个设置窗口（同一份外观配置）」。",
        ],
    )
    table(
        doc,
        ["自检断言", "含义", "结果"],
        [
            ["settingsBgImage.hasImage", "documentElement 上 --has-image=1", "true"],
            ["settingsBgImage.layerBg", "图层拿到 url(data:image…)", "✅"],
            ["settingsBgImageApplied", "设置页背景图生效", "true"],
            ["09-settings-bg.png", "截图留证（图上文字仍可读）", "✅"],
        ],
    )

    heading(doc, "六、浮窗背景图裁切与可读性（需求 3）")
    bullets(
        doc,
        [
            "背景图图层原来挂在 body 上（fixed），浮窗圆角是卡片自己的，图会溢出成直角。"
            "现在把 .bg-layer 移进 .hud 卡片内部（第一个子元素），用 border-radius: inherit 一起被裁切。",
            "遮罩不能写在 .bg-layer::after：该元素带 opacity，罩子会被一起淡化（实测图仍然刺眼）。"
            "改为独立 .bg-veil 图层，颜色取 --hud-veil。",
            "实测取样：加罩前卡片平均亮度约 101（浅色图把卡片照亮），加罩后约 54，白字对比度恢复到可读区间。",
        ],
    )
    table(
        doc,
        ["自检断言", "含义", "结果"],
        [
            ["hudBgImage.nested", ".hud > .bg-layer 成立（能被圆角裁切）", "true"],
            ["hudBgImage.radius", "卡片圆角 12px", "12px"],
            ["hudBgImage.veil", "薄罩 display/color/opacity", "block|rgba(18,21,28,0.58)|1"],
            ["hudBgImageClipped", "裁切断言", "true"],
            ["10-hud-bg.png", "截图留证（图在圆角内、文字清楚）", "✅"],
        ],
    )

    heading(doc, "七、验证与产物")
    table(
        doc,
        ["检查项", "命令 / 文件", "结果"],
        [
            ["单元测试", "node 项目测试\\run-all.js --only=unit", "15 文件 / 124 用例全部通过"],
            ["集成测试", "同上 --only=integration", "4 文件 / 34 用例全部通过"],
            ["OCR 精度", "同上 --only=ocr", "9 图 11 用例通过"],
            ["全量", "node 项目测试\\run-all.js", "20 文件 / 169 用例，失败 0"],
            ["Electron 自检", "node 项目代码\\scripts\\smoke.js", "ok=true、渲染错误 0、截图 10 张、托盘 true"],
            ["语言矩阵", "node 项目测试\\tools\\lang-matrix.js", "21 组 0 失败"],
            ["便携版", "dist\\win-x64", "已更新（未出 release 压缩包）"],
        ],
    )
    para(doc, "本轮修复的真实缺陷汇总：")
    table(
        doc,
        ["#", "缺陷", "影响", "修法"],
        [
            ["1", "去重不看目标语言", "改语言后一直显示旧译文", "langKey 参与去重"],
            ["2", "离线小模型不执行繁体指令", "繁体目标输出仍是简体", "内置转换表兜底 + 提示词加强"],
            ["3", "ensureTraditional 缺 targetLang 守卫", "英文→简体中文被转成繁体", "加入 isTraditionalTarget 判断"],
            ["4", "源语言前缀写进 user 正文", "小模型把前缀抄进译文", "挪到 system prompt"],
            ["5", "executeJavaScript 注入串内嵌模板插值", "主进程 SyntaxError，整个应用加载失败", "改用字符串拼接"],
            ["6", "背景图图层挂在 body 上", "浮窗图溢出直角、遮罩失效", "移入卡片内 + 独立 .bg-veil"],
            ["7", "设置页无背景图层", "设置页与浮窗风格不一致", "共用 .bg-layer 与主题变量"],
        ],
    )

    heading(doc, "八、已知限制")
    bullets(
        doc,
        [
            "内置简繁表是「单字表」：词级差异（软体/软件、档案/文件）仍按字转换，属可接受近似。",
            "繁简转换不处理地区用词差异（如「土豆/马铃薯」），这类需要模型而非查表。",
            "离线 1.8B 模型对小语种长句质量仍弱于联网大模型；有 API Key 时优先联网。",
            "自检环境里热键注册会失败（用户实例占用了相同组合），属环境因素，不影响功能。",
        ],
    )

    heading(doc, "九、变更记录")
    table(
        doc,
        ["文件", "变更"],
        [
            ["src/core/pipeline/round.js", "langKey 去重、detectShortcut 短路、繁体转换接入"],
            ["src/core/translate/chain.js", "成功分支接 ensureTraditional(带 targetLang)"],
            ["src/core/translate/prompt.js", "源语言进 system、繁体提示、去掉 user 前缀"],
            ["src/core/translate/traditional.js（新）", "繁简判定与转换"],
            ["src/core/translate/traditional-table.js（新）", "2712 条单字简→繁表"],
            ["src/core/translate/textlang.js（新）", "中/英文字形态判断"],
            ["src/core/index.js", "translateText 走同一套短路规则"],
            ["src/renderer/shared/theme.js", "--bg-veil/--hud-veil/--has-image 等变量与图层显隐"],
            ["src/renderer/hud/*", "背景图移入卡片、新增 .bg-veil、外观变量接入"],
            ["src/renderer/settings/*", "背景图层、半透明栏、内容区薄罩、文案"],
            ["src/main/main.js", "自检新增 hudBgImageClipped / settingsBgImageApplied 与两张截图"],
            ["项目测试/unit/traditional.test.js（新）", "15 用例"],
            ["项目测试/unit/shortcut.test.js（新）", "8 用例"],
            ["项目测试/tools/lang-matrix.js（新）", "语言互译矩阵实测"],
            ["AGENTS.md / README.md / 项目测试/README.md", "统计口径、语言链路陷阱、功能表"],
        ],
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, OUT_NAME)
    doc.save(out)
    size = os.path.getsize(out)
    paras = len(doc.paragraphs)
    tables = len(doc.tables)
    print("saved:", out)
    print("bytes:", size, "paragraphs:", paras, "tables:", tables)


if __name__ == "__main__":
    main()
