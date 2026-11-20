"""生成第十一轮修复记录 docx（Python 3 + python-docx）。

内容：二次元图标 / 任务栏驻留与退出 / 输入翻译 / 验证数据 / 已知限制 / 变更记录。
"""
import io
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

OUT = r'D:\桌面翻译助手\开发文档\桌面翻译助手 第十一轮新增功能（二次元图标·任务栏驻留·输入翻译）.docx'

FONT = '微软雅黑'


def setup(doc):
    st = doc.styles['Normal']
    st.font.name = FONT
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)


def h(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    for r in p.runs:
        r.font.name = FONT
        r.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
        r.font.color.rgb = RGBColor(0x1F, 0x2A, 0x37)
    return p


def para(doc, text, bold=False):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = bold
    r.font.name = FONT
    r.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    return p


def bullets(doc, items):
    for it in items:
        p = doc.add_paragraph(style='List Bullet')
        r = p.add_run(it)
        r.font.name = FONT
        r.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, htext in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ''
        run = cell.paragraphs[0].add_run(htext)
        run.bold = True
        run.font.size = Pt(9.5)
        run.font.name = FONT
        run.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            run = cells[i].paragraphs[0].add_run(str(val))
            run.font.size = Pt(9.5)
            run.font.name = FONT
            run.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    if widths:
        for r in t.rows:
            for i, w in enumerate(widths):
                r.cells[i].width = w
    return t


def main():
    doc = Document()
    setup(doc)

    title = doc.add_heading('桌面翻译助手 · 第十一轮新增功能记录', level=0)
    for r in title.runs:
        r.font.name = FONT
        r.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run('版本 1.0.0 · 2026-10-31 · 对应需求 m05905')
    r.font.size = Pt(9)
    r.font.color.rgb = RGBColor(0x66, 0x6F, 0x7E)
    r.font.name = FONT
    r.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)

    h(doc, '一、本轮需求', 1)
    para(doc, '用户原文（m05905）：目前的效果不错了，还有三个需求帮忙解决一下：'
              '1.为我的翻译助手软件设计一个偏二次元的软件图标并应用；'
              '2.点击设置页关闭关闭浮窗后，软件在后台应用那可以点击图标打开，'
              '在后台应用那右键选择退出才真正退出软件；3.增加一个输入翻译功能，在设置页或者浮窗可以输入。')
    para(doc, '本轮约定：仍然不生成 release 发布压缩包，只更新便携版 dist\\win-x64 供验收。')

    h(doc, '二、二次元图标', 1)
    para(doc, '图标由 Pillow 脚本程序化生成（项目测试/tools/gen_icon_anime3.py），不引入新依赖、不含第三方素材，'
              '避免版权问题。设计要素：紫粉对角渐变圆角方块 + Q 版面部 + 实心渐变蓝瞳 + 两侧长发。')
    table(doc, ['产出文件', '尺寸', '用途'], [
        ['assets/icon-anime.png', '512×512', '源图（设计稿）'],
        ['assets/app.png', '256×256', '窗口图标（任务栏 / Alt+Tab）'],
        ['assets/app-64/32/16.png', '64/32/16', '多尺寸预览与快捷方式'],
        ['assets/tray.png · tray@2x.png', '32 / 64', '托盘（简化眼型，小尺寸更清晰）'],
        ['assets/app.ico', '16~256 多尺寸', 'exe 文件图标（csc /win32icon）'],
    ], widths=None)
    para(doc, '应用位置：')
    bullets(doc, [
        '窗口图标：src/main/windows.js 统一注入 icon: APP_ICON（浮窗、悬浮球、设置、引导、框选 5 个窗口）。',
        'exe 图标：scripts/package-win.js 编译启动器时加 /win32icon:assets/app.ico（启动器由 9KB 增至 63KB）。',
        '托盘图标：src/main/tray.js 继续使用 assets/tray.png（32px）。',
    ])
    para(doc, '设计迭代（均已留档）：v1 用了闭合眼圈描边，512px 像戴眼镜、32px 只剩两个黑圈；'
              'v2 把眼睛做成实心渐变，但刘海是碎三角形，缩到 32px 变噪点；'
              'v3 去掉描边与碎发、改为「帽形头发 + 两侧圆角长发」，16px 仍能看出人形。')

    h(doc, '三、任务栏驻留与「真正退出」', 1)
    para(doc, '问题：浮窗与悬浮球都是 skipTaskbar，托盘图标在本机环境又注册不上（A/B 实测 TB_BUTTONCOUNT 前后不变），'
              '于是用户关掉设置窗口后彻底失去入口——正对应「软件在后台应用那可以点击图标打开」。')
    para(doc, '处理方式（三条互补）：')
    table(doc, ['能力', '实现', '说明'], [
        ['任务栏常驻', '设置窗口 skipTaskbar: false（原本已如此）', '任务栏一直有图标'],
        ['关闭 ≠ 退出', 'win.on("close") → preventDefault + minimize', '点 ×、Alt+F4、任务栏「关闭窗口」都只是最小化'],
        ['显式退出', '关于页「退出程序」+ 托盘「退出」+ --quit + 跳转列表', '只有这些会真正结束进程'],
        ['重新打开', '点任务栏图标还原设置窗口；再次双击 exe 走 second-instance 唤窗', '不依赖托盘是否可见'],
    ])
    para(doc, '退出放行：新增 WindowManager.prepareQuit()，AppController.quit() 里先置 _allowClose 再 app.quit()，'
              '否则 close 拦截逻辑会把退出也拦住。')
    para(doc, '任务栏右键菜单（JumpList）：main.js 的 setupJumpList() 注入四条任务——打开设置、输入翻译、'
              '立即翻译上次区域、退出程序；program 指向启动器而不是 app\\core.exe，避免缺 --no-sandbox 秒退。'
              '已知限制：Electron 的 app.setUserTasks 要求 AUMID 由带 AUMID 的快捷方式注册，'
              '本项目是 portable 目录、未安装快捷方式，实测返回 false（开发态与打包态一致），'
              '因此这四条任务在未安装快捷方式前不会出现在右键菜单里；重新打开与退出的能力由上面三条兜底。')

    h(doc, '四、输入翻译', 1)
    para(doc, '新增设置页「输入翻译」页签（#pane-input）：输入/粘贴文字 → Ctrl+Enter 或按钮翻译 → 译文区可直接复制。'
              '链路复用 engine.translateText，与浮窗完全一致（联网 API 主备 → 离线模型降级），目标语言读 general.targetLang。')
    table(doc, ['要素', '实现'], [
        ['入口', '设置页侧栏「输入翻译」；托盘菜单「输入翻译…」；任务栏跳转列表；--open-input'],
        ['快捷键', 'Ctrl+Enter 触发翻译（页面内）'],
        ['字数统计', '#input-count 实时联动（自检断言 23 字符）'],
        ['结果展示', '#input-result 白名单 textContent 写入，带 .placeholder 空态'],
        ['复制', 'navigator.clipboard.writeText，失败提示手动选中'],
        ['状态行', '完成 · 引擎 · 毫秒（无需翻译时额外标注）'],
        ['安全', '不截图、不落盘、不外传；仅走用户已配置的端点'],
    ])

    h(doc, '五、验证', 1)
    table(doc, ['检查项', '结果'], [
        ['node 项目测试\\run-all.js', '21 个文件 / 179 个用例，失败 0'],
        ['node 项目代码\\scripts\\smoke.js', 'ok=true 渲染错误=0 截图=13 托盘=true'],
        ['report.checks.inputPane', 'true'],
        ['report.checks.inputCountSync', 'true（输入 23 字符 → 显示 23）'],
        ['report.checks.quitButton', 'true（关于页退出按钮存在）'],
        ['report.checks.settingsCloseMinimizes', 'true（close 后窗口仍在且 isMinimized）'],
        ['report.checks.jumpList', 'false（portable 未注册 AUMID 快捷方式，见第三章）'],
        ['打包产物 --smoke-test', 'exit=0，ok=true，errs=0，截图 10 张（无测试图的项跳过）'],
        ['exe 图标', 'ExtractAssociatedIcon → 32×32 二次元图标（项目测试/reports/exe-icon.png）'],
        ['zip', 'dist\\桌面翻译助手-1.0.0-win-x64.zip（127.1 MB）'],
    ])

    h(doc, '六、已知限制', 1)
    bullets(doc, [
        'JumpList 在 portable 形态下不出现（需要安装快捷方式携带 AUMID）；重新打开与退出已由任务栏按钮、'
        '关于页按钮、托盘菜单、--quit 覆盖。',
        '托盘图标在本机会话始终注册不上（环境限制，非代码缺陷），真实桌面需另测。',
        '输入翻译暂不支持「选择源语言」，统一走自动检测 + 通用页的目标语言，避免两处状态不一致。',
        '图标为程序化绘制的简洁二次元风，未提供多套主题切换。',
    ])

    h(doc, '七、变更记录', 1)
    table(doc, ['文件', '改动'], [
        ['项目代码/assets/*（新增 9 个）', 'icon-anime.png / app.png / app-64/32/16.png / tray.png / tray@2x.png / app.ico / icon-preview.png'],
        ['src/main/windows.js', '5 个窗口注入 icon: APP_ICON；设置窗口 close → 最小化；新增 prepareQuit()'],
        ['src/main/main.js', '模块级 setupJumpList()/launcherPath()（AUMID 提前注册）；--quit/--open-input/--translate-once；quit() 调 prepareQuit；自检加 inputPane/inputCountSync/quitButton/settingsCloseMinimizes/jumpList'],
        ['src/main/tray.js', '设置子菜单新增「输入翻译…」'],
        ['src/renderer/settings/index.html', '新增「输入翻译」页签与面板；关于页「退出程序」按钮'],
        ['src/renderer/settings/app.js', '输入翻译逻辑（translateInput/updateInputCount/renderInputTarget）、退出按钮、页签钩子'],
        ['src/renderer/settings/settings.css', '输入翻译面板样式'],
        ['scripts/package-win.js', 'csc 编译启动器时加 /win32icon:assets/app.ico'],
        ['项目测试/tools/*（新增）', 'gen_icon_anime3.py（图标生成）、check-smoke-report.js（读自检报告）、patch_round11_*.py（本轮补丁留档）'],
        ['项目代码/AGENTS.md', '第 5 节口径与断言、第 6 节第十一轮 5 条陷阱'],
        ['项目代码/README.md · 项目测试/README.md', '功能表新增「输入翻译」「任务栏驻留」两行'],
    ])

    doc.save(OUT)
    size = os.path.getsize(OUT)
    print('saved:', OUT, size, 'bytes')
    print('paragraphs:', len(doc.paragraphs), 'tables:', len(doc.tables))


if __name__ == '__main__':
    main()
