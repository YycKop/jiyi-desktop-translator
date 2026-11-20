# -*- coding: utf-8 -*-
"""第十三轮（设置页图标 / 整段中文识别 / 托盘图标）文档更新与记录生成。

用法：python patch_round13_docs.py
产出：
  - 项目代码/AGENTS.md 第 6 节追加 4 条陷阱
  - 项目代码/README.md 功能表补「托盘图标自检」
  - 项目测试/README.md 用例口径更新
  - 开发文档/即译 第十三轮修复记录（设置页图标·整段中文识别·托盘图标）.docx
"""
import os
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CODE = os.path.join(ROOT, '项目代码')
DOCS = os.path.join(ROOT, '开发文档')
ACCENT = RGBColor(0x4C, 0x8D, 0xFF)


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('written:', os.path.relpath(path, ROOT), len(text), 'chars')


def patch_agents():
    path = os.path.join(CODE, 'AGENTS.md')
    text = read(path)
    anchor = '### 第十一轮'
    if anchor not in text:
        print('AGENTS: 未找到第十一轮锚点，跳过')
        return
    block = """### 第十三轮（设置页图标 / 整段中文识别 / 托盘图标）

- 设置页标题栏图标路径要按 **`src/renderer/settings/`** 起算：`../../../assets/app.png`（少退一级就 404），同时给该页 CSP 的 `img-src` 补 `file:`。
- 整段中文正文**不要开 USM 锐化**：实测 2x 不锐化 0.9404/0.9554，2x+160 只有 0.9286，锐化会把「技」认成「枝」。默认多遍识别固定 `[{2,0},{3,0},{2,160}]`，短文本（≤60 字）优先锐化那一遍，长文本优先不锐化那一遍。
- WinRT 在中文语境会把 `3.5` 输出成 `3 ． 5`、`100%` 输出成 `100 ％`：`repairCjkPunctuation` 必须补数字/百分号/千分位规则，否则会被标点规则改成 `3。5` 之类的怪串。
- 托盘图标注册失败时（本机通知区域连原生 WinForms `NotifyIcon` 都不接受）：必须有「状态自检 + 手动重挂」入口，并且**托盘不可用时关闭设置页改为最小化**，否则用户关掉窗口后既没托盘也没任务栏按钮，只能再双击 exe。

"""
    idx = text.index(anchor)
    end = text.find('\n### ', idx + len(anchor))
    if end == -1:
        end = len(text)
    text = text[:end] + '\n' + block + text[end:].lstrip('\n')
    write(path, text)


def patch_readme():
    path = os.path.join(CODE, 'README.md')
    text = read(path)
    if '托盘图标自检' in text:
        print('README: 已包含托盘图标自检说明')
        return
    anchor = '## 已知限制'
    row = '| 托盘图标自检 | 关于页显示托盘状态，可一键「重新挂载托盘图标」；托盘不可用时关闭设置页改为最小化，保证仍有入口 |\n\n'
    if anchor in text:
        text = text.replace(anchor, row + anchor, 1)
    else:
        text += '\n' + row
    write(path, text)


def patch_test_readme():
    path = os.path.join(ROOT, '项目测试', 'README.md')
    text = read(path)
    text = text.replace('22 个文件 / 179 个用例', '22 个文件 / 187 个用例')
    text = text.replace('21 个文件 / 179 个用例', '22 个文件 / 187 个用例')
    text = text.replace('21 文件 / 179 用例', '22 文件 / 187 用例')
    text = text.replace('OCR 14 个用例', 'OCR 18 个用例')
    text = text.replace('12 张合成图', '16 张合成图')
    text = text.replace('13 张合成图', '16 张合成图')
    write(path, text)


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

    def table(headers, rows, widths=None):
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
        return t

    title = doc.add_heading('即译 第十三轮修复记录', level=0)
    for run in title.runs:
        run.font.color.rgb = ACCENT
        run.font.name = '微软雅黑'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    para('设置页图标 · 整段中文识别 · 托盘图标（版本 1.0.0，2026-10-31）', size=9)

    h('一、用户反馈')
    para('1. 设置页面软件图标没有正常显示。')
    para('2. 中文识别又出问题了，不能正常识别框里全部的文字。')
    para('3. 目前软件打开还没有在任务栏的隐藏图标 ^ 里显示软件图标。'.replace('^', '^'))

    h('二、设置页图标不显示')
    para('根因：相对路径少退一级。', bold=True)
    table(['位置', '错误写法', '正确写法', '后果'], [
        ['src/renderer/settings/index.html', '../../assets/app.png', '../../../assets/app.png', '解析到 src/assets/，404 后显示裂图'],
        ['该页 CSP', "img-src 'self' data:", "img-src 'self' data: file:", 'file:// 页面下图片被策略拦掉'],
    ])
    para('验证：重新打包后在 dist\\win-x64 版设置页截图可见标题栏左侧图标正常显示（见 03-settings-apis.png）。')

    h('三、整段中文识别不全')
    para('三段根因，逐个修掉：', bold=True)
    table(['#', '现象', '根因', '修法'], [
        ['1', '4 张整段图全部只出 111 字、且锐化参数怎么调都一样', 'winrt-ocr.ps1 的 Initialize-Prep 在无 -CacheDir 时直接 return，C# 预处理从未生效', '改为无缓存目录时先尝试内存编译，失败才降级 Resize-Only'],
        ['2', '整段正文错字多（技→枝、扌支）', 'USM 锐化放大笔画毛刺，对小字号整段是帮倒忙', '默认多遍识别固定 2x/3x 不锐化 + 2x 锐化三遍，按文本长度决定优先哪一遍，再逐行择优'],
        ['3', '3.5 变 3 ． 5、100% 变 100 ％', '标点收敛规则把小数点当句号', '补数字/百分号/千分位三条规则'],
    ])
    para('实测对比（相似度，越高越好）：', bold=True)
    table(['图片', '修复前', '修复后', '行数'], [
        ['para-dark-15px.png（5 行）', '0.9554（丢行风险）', '0.9643', '5/5'],
        ['para-light-15px.png（5 行）', '0.9732', '0.9464', '5/5'],
        ['para-dark-16px.png（3 行）', '0.9857', '0.9714', '3/3'],
        ['para-gray-14px.png（3 行）', '0.8793', '0.8793', '3/3'],
    ])
    para('说明：单张相似度在中英混排 + 同形字（窗/囗、语/浯）下有小幅波动，但不再出现"整段少字/丢行"，'
         '且数字与标点全部正确；4 张图均 100% 行覆盖。14–15px 灰字仍属 WinRT 已知下降区。')

    h('四、托盘图标不可见')
    para('结论：本机通知区域（shell）不接受新图标，非应用代码缺陷。', bold=True)
    bullet('Electron 侧：Tray 创建成功但 getBounds 恒为空，日志无 "Unable to create status tray icon"。')
    bullet('原生侧：另写 C# 探针（Application.Run + NotifyIcon）同样注册不上，通知区域按钮数始终 0。')
    bullet('因此改为「可自证 + 可自修 + 有兜底」：关于页显示托盘状态、提供「重新挂载托盘图标」按钮；'
           '托盘确实不可用时，关闭设置页从「隐藏」退化为「最小化」，保留任务栏入口。')
    table(['改动', '位置', '说明'], [
        ['托盘状态/重挂 IPC', 'src/shared/ipc-channels.js、src/main/ipc.js、src/preload/index.js', 'app:tray-status / app:tray-retry'],
        ['托盘自检与重挂', 'src/main/tray.js', 'status()、retryNow()，.ico 优先（多 DPI 档）'],
        ['关于页入口', 'src/renderer/settings/index.html、app.js', '状态文案 + 「重新挂载托盘图标」按钮'],
        ['关闭兜底', 'src/main/windows.js、src/main/main.js', 'wm.onTrayAccepted 决定 hide / minimize'],
    ])

    h('五、验证')
    table(['项目', '结果'], [
        ['全量测试', '22 个文件 / 187 个用例，失败 0'],
        ['OCR 精度', '18 个用例全过（16 张合成图，含 4 张整段中文）'],
        ['开发态自检', 'ok=true、渲染错误 0、截图 13 张、托盘已创建'],
        ['打包产物自检', 'exit=0、ok=true、errs=0、checks 全 true（jumpList 除外）'],
        ['打包产物', 'dist\\win-x64（启动器 153 KB）+ 即译-1.0.0-win-x64.zip（127.6 MB）'],
    ])

    h('六、已知限制')
    bullet('通知区域图标：本机环境注册不上，需要用户侧「重启资源管理器」后点「重新挂载托盘图标」；程序已用任务栏最小化兜底。')
    bullet('14px 以下灰色小字仍是 WinRT 引擎的精度上限，残余为同形字错误，可通过放大界面字号改善。')
    bullet('JumpList（任务栏右键菜单）在便携版无 AUMID 快捷方式时不生效，属预期。')

    h('七、变更记录')
    table(['日期', '版本', '内容'], [
        ['2026-10-31', '1.0.0+13', '设置页图标路径与 CSP 修正；OCR 预处理三级降级、多遍识别默认值、数字标点规则；托盘状态自检/重挂与关闭兜底'],
    ])

    out = os.path.join(DOCS, '即译 第十三轮修复记录（设置页图标·整段中文识别·托盘图标）.docx')
    doc.save(out)
    print('docx:', os.path.basename(out), os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    os.makedirs(DOCS, exist_ok=True)
    patch_agents()
    patch_readme()
    patch_test_readme()
    make_doc()
    print('done')
