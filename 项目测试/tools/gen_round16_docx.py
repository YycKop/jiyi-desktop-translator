"""生成《即译 第十六轮记录（卡通艺术字·悬浮球图标）》docx。"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

OUT_DIR = r"D:\桌面翻译助手\开发文档"
OUT = os.path.join(OUT_DIR, "即译 第十六轮记录（卡通艺术字·悬浮球图标）.docx")

doc = Document()

# 基础样式
style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(
    __import__("docx.oxml.ns", fromlist=["qn"]).qn("w:eastAsia"), "Microsoft YaHei"
)

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


def para(text, bold=False, size=10.5, space_after=6):
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
    hdr = t.rows[0].cells
    for i, name in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        run = p.add_run(name)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            run = p.add_run(str(val))
            run.font.size = Pt(9.5)
            p.paragraph_format.space_after = Pt(2)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    return t


# ---------- 标题 ----------
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = title.add_run("即译 · 第十六轮记录")
r.bold = True
r.font.size = Pt(20)
r.font.name = "Microsoft YaHei"
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run("卡通艺术字 · 悬浮球改图标 · 标题栏间距")
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(0x55, 0x5F, 0x75)

meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = meta.add_run("版本 v1.0.0　|　日期 2026-10-31　|　产物 dist\\win-x64（166.9 MB zip）")
r.font.size = Pt(9)
r.font.color.rgb = RGBColor(0x77, 0x80, 0x92)

doc.add_paragraph()

# ---------- 1. 需求 ----------
h("1. 本轮需求（用户原话）", 1)
para(
    "“我还有些外观需求帮我修改一下：1.把悬浮球的样子也改成图标，并去掉悬浮球旁边的黑色阴影；"
    "2.设置页的软件名字和图标的间距有点大，而且软件名字的样式太普通，应该设置卡通风格的艺术字，"
    "你可以先提供几个样式给我选择然后再设置这个艺术字。”"
)
para(
    "拆成三项：① 悬浮球用产品图标、去掉旁边黑边；② 收缩标题栏图标与名称的间距；"
    "③ 软件名换成卡通艺术字（先出候选、由用户选定后再落地）。"
)

# ---------- 2. 悬浮球 ----------
h("2. 悬浮球：改成图标并去掉黑边", 1)
para("现象与原因", bold=True, space_after=2)
bullet("悬浮球窗口只有 44×44 物理像素，之前球体上叠了 box-shadow: 0 6px 16px rgba(0,0,0,.45)。")
bullet("透明窗口的边缘会把这层投影裁掉，只剩贴着球体的一圈暗色——用户看到的就是“球旁边一条黑阴影”。")
para("改法", bold=True, space_after=2)
table(
    ["文件", "改动"],
    [
        ["src/renderer/ball/index.html", "球心文字 <span>译</span> → <img id=\"ball-icon\" src=\"../../../assets/app.png\">"],
        ["src/renderer/ball/ball.css", "删除 box-shadow；#ball{L2px 内缩, 40px 圆, overflow:hidden}；图标 object-fit:cover + border-radius:inherit"],
        ["src/renderer/ball/ball.css", "悬停只做轻微放大与提亮；忙碌态脉冲改用主题色描边，不再用黑色投影"],
        ["src/main/windows.js", "ensureBall() 保持 hasShadow:false / focusable:true / showInactive()（不改交互逻辑）"],
    ],
    widths=[5.6, 10.6],
)
para(
    "说明：球体视觉完全由图标自身的不透明像素决定，窗口不再绘制任何投影，因此不存在“被裁一半的阴影”。",
    space_after=8,
)

# ---------- 3. 标题栏间距 ----------
h("3. 标题栏：图标与名称的间距", 1)
table(
    ["项目", "改动前", "改动后"],
    [
        ["标题栏 flex 间距", "10px", "6px"],
        ["图标尺寸", "18px，额外 margin-right 8px", "20px，无额外外边距"],
        ["引导页标题栏", "只有文字名称", "与设置页一致：图标 + 艺术字"],
    ],
    widths=[4.2, 6.4, 5.6],
)

# ---------- 4. 艺术字 ----------
h("4. 卡通艺术字", 1)
para("4.1 候选样张（用户从中选定 A）", bold=True, space_after=2)
table(
    ["编号", "名称", "做法", "观感"],
    [
        ["A", "糖果贴纸", "白粗描边 + 粉蓝渐变填充 + 柔和投影", "最卡通，与二次元图标同源"],
        ["B", "3D 挤出", "多层错位挤出 + 白色正面 + 顶部高光", "立体，偏游戏标题"],
        ["C", "手写马克笔", "楷体 + 倾斜 + 双墨叠加", "亲切随意"],
        ["D", "霓虹描边", "深底 + 冷色发光 + 细字", "只适合深色主题"],
        ["E", "波点波普", "图案填充 + 黑描边 + 倾斜", "活泼抢眼"],
        ["F", "极简渐变", "细体 + 大字距 + 渐变", "克制现代"],
    ],
    widths=[1.4, 3.0, 7.2, 4.6],
)
para(
    "候选样张：项目测试/reports/arttext/styles.png（浅底/深底各一行，字体只有本机 simhei / msyhbd / simkai / Dengl 四种，"
    "卡通感靠描边、渐变、立体与图案实现）。",
    size=9.5,
    space_after=8,
)

para("4.2 定稿实现", bold=True, space_after=2)
bullet("素材：项目测试/tools/gen_brand_art.py（Pillow，8 倍超采样）→ 项目代码/assets/brand.png（194×104，透明底）。")
bullet("尺寸策略：按“显示高度的 4 倍”出图（26px × 4），CSS 里 height:26px，缩小时白描边不会断。")
bullet("描边宽度 6×SS（约字高 5%）：候选稿用 11×SS 在 132px 字高下好看，缩到 26px 会把字芯糊白。")
bullet("渐变按 mask 包围盒铺满色域；高光层用 ImageChops.multiply 裁到字身上。")
bullet("落地：settings/index.html 与 onboarding/index.html 用 <img class=\"brand-art\">；两页 CSS 均设 .brand-art{height:26px;width:auto}。")

para("4.3 这一轮修掉的三个渲染缺陷", bold=True, space_after=2)
table(
    ["现象", "根因", "修法"],
    [
        ["字发白、看不出粉蓝渐变", "渐变按整张画布铺，字只覆盖一小块，取到的是过渡色", "按 mask.getbbox() 铺满字身包围盒"],
        ["缩到 22–26px 后整块糊白", "描边按 1x 字高比例设定（11×SS）", "改为 6×SS（≈字高 5%）"],
        ["标题栏文字后面出现灰色方块", "高光条是整条矩形 + 高斯模糊，在透明区留下 alpha=56", "ImageChops.multiply(hi, mask) 把高光裁进字身"],
    ],
    widths=[4.6, 7.0, 6.6],
)

# ---------- 5. 验证 ----------
h("5. 验证结果", 1)
table(
    ["验证项", "命令/来源", "结果"],
    [
        ["开发态自检", "node 项目代码\\scripts\\smoke.js", "ok=true 渲染错误=0 截图=13 托盘=true"],
        ["打包态自检", "即译.exe --smoke-test → userdata\\smoke\\report.json", "ok=true，rendererErrors=[]，除 trayAccepted / jumpList 外 checks 全 true"],
        ["OCR 引擎", "report.json.ocr", "preferred=auto，picked=rapid，probes rapid/winrt/mock=true，tesseract=false"],
        ["全量测试", "node 项目测试\\run-all.js", "25 个文件全部通过（单元 17 / 集成 7 / OCR 1）"],
        ["打包", "node 项目代码\\scripts\\package-win.js", "dist\\win-x64 重新生成，zip 166.9 MB"],
    ],
    widths=[3.4, 7.6, 7.2],
)
para(
    "截图证据：项目测试/reports/electron-smoke/（02-settings-general.png、04-onboarding.png、06-ball.png），"
    "标题栏放大对照见项目测试/reports/arttext/titlebar-zoom.png，"
    "悬浮球对照见项目测试/reports/arttext/ball-preview.png。",
    size=9.5,
)

# ---------- 6. 已知限制 ----------
h("6. 已知限制", 1)
bullet("本机可用中文字体只有黑体、雅黑、楷体、等线四种，无法做更圆润的卡通字形（如幼圆/琥珀体）。")
bullet("艺术字是位图，不随系统字体设置变化；如需换风格，改 gen_brand_art.py 重新生成即可。")
bullet("26px 显示高度下细节有限，再缩小（如 20px）白描边会开始吃掉字芯，不建议继续压。")

doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT))
