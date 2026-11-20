# -*- coding: utf-8 -*-
"""第十三/十四轮附录（修正版）：托盘注册取证 + 悬浮球兜底入口 + 小字二值化实验。"""
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DOCS = os.path.join(ROOT, '开发文档')
ACCENT = RGBColor(0x4C, 0x8D, 0xFF)


def make_doc():
    doc = Document()
    style = doc.styles['Normal']
    style.font.name = '微软雅黑'
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

    def h(text, level=1):
        p = doc.add_heading(text, level=level)
        for run in p.runs:
            run.font.color.rgb = ACCENT
            run.font.name = '微软雅黑'
            run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        return p

    def para(text, bold=False, size=None):
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.bold = bold
        if size:
            run.font.size = Pt(size)
        run.font.name = '微软雅黑'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        return p

    def bullet(text):
        p = doc.add_paragraph(text, style='List Bullet')
        for run in p.runs:
            run.font.name = '微软雅黑'
            run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        return p

    def table(headers, rows):
        t = doc.add_table(rows=1, cols=len(headers))
        t.style = 'Light Grid Accent 1'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, text in enumerate(headers):
            cell = t.rows[0].cells[i]
            cell.text = ''
            run = cell.paragraphs[0].add_run(text)
            run.bold = True
            run.font.size = Pt(9.5)
            run.font.name = '微软雅黑'
            run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        for row in rows:
            cells = t.add_row().cells
            for i, value in enumerate(row):
                cells[i].text = ''
                run = cells[i].paragraphs[0].add_run(str(value))
                run.font.size = Pt(9)
                run.font.name = '微软雅黑'
                run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
        doc.add_paragraph()

    title = doc.add_heading('即译 附录：托盘注册取证、悬浮球兜底入口与小字实验', level=0)
    for run in title.runs:
        run.font.color.rgb = ACCENT
        run.font.name = '微软雅黑'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    para('版本 1.0.0 · 取证时间 2026-10-31（含对前一版结论的更正）', size=9)

    h('一、更正：通知区域不是空的，是「新图标加不进去」')
    para('前一版附录曾判断"通知区域为空"，该结论有误并已更正。原因是我第一版计数工具把 64 位'
         '窗口句柄声明成了 32 位 int，句柄被截断后 SendMessage 发给了错误窗口，所以读到的按钮数恒为 0。'
         '改用 IntPtr 后实测如下（应用未运行时）：', bold=True)
    table(['通知区域工具栏', '按钮数', '说明'], [
        ['系统升级的通知区域', '0', '旧机制，本机未使用'],
        ['用户提示通知区域（直接显示）', '3', '任务栏上直接可见的 3 个图标'],
        ['溢出通知区域（^ 弹出面板）', '21', '点开 ^ 能看到 21 个图标'],
    ])
    para('所以你说"^ 里还有其他应用的图标"是对的：系统通知区域工作正常，已有 21 + 3 个图标。'
         '问题只在"我们的新图标进不去"。', bold=True)

    h('二、取证：我们的图标确实没有被系统接受')
    table(['验证项', '做法', '结果'], [
        ['计数对比（A/B）', '应用运行前 / 运行后各统计一次工具栏按钮数',
         '两次都是 3 / 21，无新增'],
        ['托盘状态自查', '应用内 tray.status()：判 getBounds().width > 0', 'accepted=false（bounds 0,0,0,0）'],
        ['原生 WinForms 探针', '独立进程 NotifyIcon.Visible = true，另起窗口采样计数', '计数不变，图标未出现'],
        ['直接调用 Shell_NotifyIcon', '自建消息窗口 + NIM_ADD（含 GUID 身份重试）', '未成功注册，日志在 reports/tray-native-probe.log'],
    ])
    para('结论：在这台机器的当前 Windows 会话里，由我们启动的进程无法把新图标放进通知区域——'
         '换原生 WinForms、换直接调 Shell_NotifyIcon 都一样，因此不是 Electron 的问题，也不是图标文件的问题'
         '（图标本身 256×256 多尺寸 ico，exe 抽图正常）。', bold=True)

    h('三、兜底方案：悬浮球就是常驻入口（已实现）')
    para('既然通知区域进不去，就不能把"再次打开软件"的唯一入口挂在托盘上。本轮改成：', bold=True)
    bullet('启动时若托盘未被系统接受，自动把主窗口收起并显示悬浮球（日志会打「托盘图标未被系统接受，改用悬浮球作为常驻入口」）。')
    bullet('悬浮球左键：按设置页「点击图标时打开」执行——打开设置页，或显示译文浮窗（与托盘左键同一套语义，且不做"再点一次收起"，避免点了没反应）。')
    bullet('悬浮球右键：弹出与托盘右键一致的菜单——设置… / 输入翻译… / 显示译文浮窗 / 退出即译，其中「退出即译」才是真正退出。')
    bullet('设置页「关于」页仍保留托盘状态显示与「重新挂载托盘图标」按钮；若某次系统接受了图标，关闭设置页就会恢复成"隐藏到托盘"。')
    para('实测：设置页右键菜单四项全部弹出、点击生效（见截图 reports/ball-menu2.png）。')

    h('四、小字号中文：二值化实验为负结果')
    para('假设 ClearType 的彩色描边影响小字识别，做了 2 倍放大 + 灰度 + 自动对比度 + Otsu 二值化的对比：', bold=True)
    table(['图片', '二值化结果', '判定'], [
        ['ui-hint-14px', '「自动」→「占动」、「点」→「占」', '无改善'],
        ['para-gray-14px', '「轮询」→「轮词」，句号变「·」', '变差'],
        ['para-dark-15px', '「检查」→「检杳」，128 拆成「1 28」，3.5 变「3·5」', '明显变差'],
        ['small-360x90', '全对', '持平'],
    ])
    para('结论：二值化会吃掉标点、拆散数字，小字号中文反而更差 → 保留现方案（多遍识别 2x/3x 不锐化 + 2x 锐化、'
         '逐行择优、标点与数字修复），不回退。', bold=True)

    h('五、小字号当前边界')
    table(['字号', '中英印刷体相似度', '行覆盖', '备注'], [
        ['16px 及以上', '0.95 – 1.00', '100%', '稳定可用'],
        ['15px', '0.93 – 0.97', '100%', '偶尔同形字（窗/囗、技/枝）'],
        ['14px', '0.87 – 0.95', '100%', '同形字与标点偶尔出错'],
        ['12–13px', '< 0.85', '可能丢行', 'WinRT 引擎在该字号下的固有限制'],
    ])
    para('要下探到 12–13px 需更换识别引擎（RapidOCR / PaddleOCR + onnxruntime），属新增依赖，'
         '按 CMD-02/DSH-02 需先审批（包名、版本、体积与模型来源）。在此之前：把界面字体调大一号、'
         '或框选时贴紧文字行，效果最好。')

    out = os.path.join(DOCS, '即译 附录（托盘取证·悬浮球入口·小字实验）.docx')
    doc.save(out)
    print('docx:', os.path.basename(out), os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    os.makedirs(DOCS, exist_ok=True)
    make_doc()
