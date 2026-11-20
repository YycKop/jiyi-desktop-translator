"""生成《即译 第二十七轮记录（拖动中丢失 pointer capture）.docx》。"""
from docx import Document
from docx.shared import Pt, RGBColor
import os

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十七轮记录（拖动手感：捕获丢失修复）.docx"

doc = Document()
st = doc.styles["Normal"]
st.font.name = "微软雅黑"
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia", "微软雅黑"
)


def para(text, bold=False, size=10.5):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = bold
    r.font.size = Pt(size)
    return p


def bullet(text):
    p = doc.add_paragraph(text, style="List Bullet")
    for r in p.runs:
        r.font.size = Pt(10.5)


def table(headers, rows):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = ""
        run = c.paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(str(v))
            run.font.size = Pt(9.5)


title = doc.add_heading("即译 · 第二十七轮记录", level=0)
for r in title.runs:
    r.font.color.rgb = RGBColor(0x1F, 0x2A, 0x44)
p = doc.add_paragraph()
r = p.add_run("字幕条拖动：快速移动丢失拖动状态")
r.bold = True
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(0x4C, 0x8D, 0xFF)
para("版本 v1.0.0 ｜ 日期 2026-11-19 ｜ 交付物：dist\\win-x64（197.0 MB zip）", size=9.5)

doc.add_heading("1. 问题现象", level=1)
para("用户反馈：字幕条的拖动如果鼠标移动快一点，就会「丢失拖动状态」——拖到一半窗口停住，"
     "手还按着但已经不再跟随。")

doc.add_heading("2. 根因", level=1)
para("旧实现把 pointer capture 的丢失当成「松手」处理：")
bullet("拖动的三条链路（字幕条边缘改尺寸、卡片标题栏移动、字幕条控制条移动）都在 "
       "`lostpointercapture` 上调用了 finish/endDrag。")
bullet("但拖动过程中窗口本身在变形：边缘热区跟着窗口移动，被捕获的元素位置随每帧改变，"
       "Chromium 会认定「捕获目标已不可用」而**隐式释放** pointer capture，并派发 "
       "`lostpointercapture`。")
bullet("于是鼠标一快、窗口一抖，浏览器就先替用户「松了手」，主进程随之结束 `HUD_RESIZE` / "
       "`HUD_DRAG`，后续移动不再生效。")

doc.add_heading("3. 修法", level=1)
table(
    ["层次", "旧行为", "新行为"],
    [
        ["捕获丢失", "直接 finish()", "只当降级：先 setPointerCapture 抢回，抢不到靠 document 级监听"],
        ["移动来源", "只监听节点上的 pointermove", "document 级 pointermove（capture 阶段）持续送坐标"],
        ["收尾条件", "pointerup / pointercancel / lostpointercapture",
         "pointerup / pointercancel / pointermove 且 buttons===0"],
        ["监听清理", "无（window 级常驻）", "finish 里成对 removeEventListener，避免累积"],
        ["影响范围", "仅边缘热区", "边缘热区 + 卡片标题栏 + 控制条拖动，三条链路一起改"],
    ],
)
para("主进程侧本来就是「按真实光标每 16ms 重算几何」的绝对锚点实现，只要渲染进程不误报松手，"
     "拖动就能连续跟手；2.5s 静默兜底仍保留，用于真正的 pointerup 丢失场景。")

doc.add_heading("4. 验证", level=1)
para("新增自检 `hudSubtitleCaptureLoss`：拖起右边缘 → 假光标 +80px → 人为派发 "
     "`lostpointercapture` → 再 +80px（在 document 上派发 pointermove）→ 断言宽度继续增长 → "
     "派发 pointerup → 断言冻结。")
table(
    ["阶段", "窗口宽度"],
    [
        ["拖动开始", "1400"],
        ["捕获丢失后第一次移动", "1480"],
        ["document 级继续移动", "1560"],
        ["pointerup 之后", "1560（冻结）"],
    ],
)
table(
    ["检查", "开发态", "打包态"],
    [
        ["hudSubtitleCaptureLoss", "ok=true", "ok=true"],
        ["其它 checks", "仅 jumpList / trayAccepted 为 false（本机环境限制）", "同左"],
        ["全量测试", "27 个文件 0 失败", "—"],
        ["冒烟截图", "17 张", "14 张"],
    ],
)

doc.add_heading("5. 顺带修掉的回归", level=1)
para("全量测试暴露出 `integration/ipc-contract.test.js` 的「CSP 禁止内联样式属性」用例失败："
     "第二十六轮给四个圆形气泡加的错开序号写成了 HTML 内联 `style=\"--i:0\"`。"
     "已改为渲染进程里 `node.style.setProperty('--i', i)`（CSSOM 不受 CSP 限制），动画效果不变。")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc.save(OUT)
print("saved", OUT, os.path.getsize(OUT), "bytes")
