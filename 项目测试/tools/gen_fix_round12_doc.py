# -*- coding: utf-8 -*-
"""第十二轮：同步 AGENTS.md / README.md / 项目测试 README，并生成 docx 记录。"""
import io
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = r'D:\桌面翻译助手'
CODE = os.path.join(ROOT, '项目代码')
DOCS = os.path.join(ROOT, '开发文档')

MISS = []


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def rep(p, old, new, label, count=1):
    t = read(p)
    if old not in t:
        MISS.append(label)
        print('MISS:', label)
        return
    write(p, t.replace(old, new, count))
    print('ok  :', label)


# ---------------- AGENTS.md ----------------
p_ag = os.path.join(CODE, 'AGENTS.md')
rep(p_ag, '| Electron |', '| 产品名 | 即译（jiyi） | 目录与可执行文件同名，数据目录仍为 desktop-translator |\n| Electron |', 'AGENTS version table')

rep(p_ag, '自检截图 13 张', '自检截图 13 张（第十二轮新增 `14-settings-titlebar-icon` 不适用，标题栏图标并入 `02-settings-general`）', 'AGENTS screenshots note')

rep(p_ag,
    '## 7. 技术偏离表',
    """### 第十二轮（改名「即译」·新图标·后台驻留·点击图标行为）

1. **改名只改显示层**：`app.setName('即译')`、窗口标题、`package.json` 的 `name/productName`、exe 名改成 `即译.exe`；但 `src/core/paths.js` 的 `APP_DIR_NAME='desktop-translator'`、`bridge.js` 的服务名、`secrets.js` 的 scrypt 盐串 `desktop-translator-v1` **一律不动**——它们是数据目录与密钥派生的一部分，改了用户已保存的配置和 API Key 就全部失效。
2. **图标白边**：先 `putalpha` 再 `LANCZOS` 缩放，会让透明区（白色）的 RGB 参与插值，边缘出现一圈白线；正确顺序是**先缩放到目标尺寸、再套圆角蒙版**（蒙版在 4 倍画布上绘制后缩小，抗锯齿更干净）。另外把裁切内缩 1.2%，顺带裁掉源图自带的浅色描边。
3. **关窗口 ≠ 退出**：`settings` 的 `close` 事件必须 `preventDefault()` + `win.hide()` + `setSkipTaskbar(true)`；若直接销毁，浮窗又 `skipTaskbar`，用户就再也找不到入口。
4. **托盘右键只留三项**（设置 / 输入翻译 / 退出）后，其它高频动作（暂停、轮询间隔、框选、日志目录）必须仍能在浮窗标题栏或设置页找到，否则等于把功能藏掉。
5. **自检断言不要依赖方向**：拖拽改变尺寸时宽高可能一增一减，断言写成「宽高都必须变大」会在用户改过尺寸后误报；应判「尺寸确实变化 ≥32px」。

## 7. 技术偏离表""",
    'AGENTS round12 pitfalls')

rep(p_ag,
    '| 双击入口 |',
    '| 产品名与图标 | 显示名统一「即译」，图标为用户提供的二次元插画（去水印 → 程序化圆角 → 多尺寸 png + ico），数据目录名保持 `desktop-translator` | 用户需求，且避免配置/密钥失效 |\n| 后台入口 | 关掉设置页与浮窗后不退出、任务栏不残留按钮，统一从托盘恢复；退出只走托盘右键、关于页或 `--quit` | 用户需求（原为最小化到任务栏） |\n| 双击入口 |',
    'AGENTS deviation rows')

# ---------------- README ----------------
p_rd = os.path.join(CODE, 'README.md')
t = read(p_rd)
t = t.replace('# 桌面翻译助手', '# 即译（桌面翻译助手）', 1)
write(p_rd, t)
print('ok  : README title')

rep(p_rd,
    '| 一键暂停',
    '| 后台驻留 | 关掉设置页与浮窗后程序仍在后台，任务栏不留按钮；托盘单击恢复，右键只有「设置 / 输入翻译 / 退出」 |\n| 点击图标行为 | 设置页「启动 → 点击图标时打开」可选设置页或译文浮窗（F-02 语义） |\n| 一键暂停',
    'README feature rows')

print('--- MISS:', MISS)

# ---------------- docx ----------------
doc = Document()
style = doc.styles['Normal']
style.font.name = '微软雅黑'
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')


def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for r in p.runs:
        r.font.name = '微软雅黑'
        r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    return p


def para(text, bold=False, size=None):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = bold
    if size:
        r.font.size = Pt(size)
    return p


def bullet(text):
    p = doc.add_paragraph(text, style='List Bullet')
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Light Grid Accent 1'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, x in enumerate(headers):
        hdr[i].text = ''
        r = hdr[i].paragraphs[0].add_run(x)
        r.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i, x in enumerate(row):
            cells[i].text = str(x)
    return t


title = doc.add_heading('即译 第十二轮修改记录（改名·二次元图标·后台驻留·输入入口）', level=0)
for r in title.runs:
    r.font.name = '微软雅黑'
    r._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

para('版本：1.0.0    日期：2026-10-31    范围：用户验收反馈的第四批需求（未出 release 发布包）')

h('一、本轮需求', 1)
for x in [
    '1. 使用用户提供的二次元插画作为软件图标（附图去掉 AI 生成水印与平台水印）。',
    '2. 软件更名为「即译」。',
    '3. 关掉设置页与浮窗后任务栏图标消失但程序不退出；从托盘图标恢复；托盘右键只有「设置 / 输入翻译 / 退出」三项。',
    '4. 设置页可选「点击图标时打开设置页还是浮窗」。',
    '5. 设置页标题栏把软件图标放在名称左边。',
]:
    bullet(x)

h('二、图标处理（去白边）', 1)
para('用户素材为 2048×2048 的二次元插画（白发蓝眼少女 + 「文/A」气泡），左上角带「AI生成」、底部带「小红书号」水印。处理流程如下：')
table(['步骤', '做法', '说明'], [
    ['1. 去水印', '左上平移复制同色渐变；底部中值滤波 + 降采样低通 + 羽化蒙版贴回', '只做局部修补，不改主体；直接矩形贴回会留方形糊块'],
    ['2. 找边界', '按非白像素扫描，测得 bounds=(60,105,1927,1942)、圆角半径 480', '半径取 min(宽,高)×0.26，与画面一致'],
    ['3. 先缩放', '正图按目标尺寸 LANCZOS 缩放（此时仍不透明）', '关键：先缩放再加透明'],
    ['4. 再套蒙版', '4 倍画布画圆角矩形 → 缩放成抗锯齿蒙版 → putalpha，内缩 1.2%', '修掉用户反馈的白边；内缩同时裁掉源图浅色描边'],
    ['5. 输出', '512/256/128/64/48/32/16 PNG + 32/64 托盘（脸部特写）+ 多尺寸 ico', '窗口图标用 png，exe 图标用 ico（csc /win32icon）'],
])
para('踩坑：最初先 putalpha 再缩放，透明区的白色 RGB 参与插值，图标边缘出现一圈白线——这就是用户看到的白边；调整顺序后消失。', bold=True)

h('三、改名与数据目录', 1)
para('显示层全部改成「即译」：app.setName、窗口标题（即译 · 设置/框选/浮窗/首次使用）、package.json 的 name 与 productName、启动器 exe 名（即译.exe）、设为任务栏/托盘提示。')
para('有意保持不变：数据目录 desktop-translator、宿主桥服务名、密钥派生盐串 desktop-translator-v1。原因：它们是用户配置与已存 API Key 的一部分，改了就等于让老用户丢掉全部设置。')

h('四、后台驻留与退出', 1)
table(['行为', '实现', '验证'], [
    ['关闭设置页', 'close 事件 preventDefault + hide + setSkipTaskbar(true)', '自检 settingsCloseHides=true'],
    ['关闭浮窗', '原有 hide 逻辑，窗口本身 skipTaskbar', '浮窗关闭后任务栏无残留'],
    ['恢复入口', '托盘单击（按配置打开设置页或浮窗）、再次双击 exe、托盘右键「设置」', '第二实例唤醒了主窗口'],
    ['彻底退出', '托盘右键「退出」/ 设置页「关于 → 退出程序」/ 命令行 --quit', '自检 quitButton=true'],
    ['右键菜单', '只有 设置 / 输入翻译 / 退出 三项', '自检 trayMenuItems=["设置","输入翻译","退出"]'],
])

h('五、点击图标行为', 1)
para('设置页「通用 → 启动 → 点击图标时打开」新增下拉：设置页（默认）/ 译文浮窗，写入 general.launchAction（store 校验白名单）。托盘单击与第二次启动都按该配置执行。')

h('六、验证结果', 1)
table(['项目', '结果'], [
    ['全量测试', '21 个文件 / 179 个用例，失败 0'],
    ['开发态自检', 'ok=true 渲染错误=0 截图=13 托盘=true'],
    ['打包产物自检', 'exit=0、ok=true、errs=0、shots=10'],
    ['新增断言', 'settingsCloseHides / trayMenuItems / inputPane / inputCountSync / quitButton 全部通过'],
    ['exe 图标', 'ExtractAssociatedIcon 抽出 32×32 为二次元图标'],
    ['打包', 'dist/win-x64（启动器 153 KB）+ dist/即译-1.0.0-win-x64.zip（127.6 MB）'],
])

h('七、已知限制', 1)
for x in [
    'JumpList（任务栏右键跳转列表）在免安装形态下仍不可用：Windows 要求带 AUMID 的快捷方式，portable 版没有安装快捷方式；自检 jumpList=false 属预期。',
    '托盘图标在本机会话里注册不稳定（系统通知区域繁忙），已用「延迟三次重挂」缓解；若仍未出现，用再次双击 exe 或设置页入口。',
    '离线模型内存约 2.2 GB（Q4_K_M），高于 N-02 目标 1.5 GB，可用 2-bit 量化降到约 1.1 GB。',
]:
    bullet(x)

h('八、变更记录', 1)
table(['文件', '改动'], [
    ['项目测试/tools/gen_icon_jiyi.py', '新增：去水印、边界测量、先缩放后套圆角、多尺寸 png/ico、预览拼图'],
    ['项目代码/assets/*', 'icon-anime.png、app.png、app-16/32/48/64/128、tray.png、tray@2x.png、app.ico、icon-preview.png'],
    ['src/main/main.js', 'app.setName、openLaunchTarget/toggleMainWindow、静默参数白名单、--quit/--input、自检断言'],
    ['src/main/windows.js', '窗口标题、APP_ICON、设置页 hide+setSkipTaskbar、openSettings(skipTaskbar:false)'],
    ['src/main/tray.js', '右键只留三项、menuLabels()、单击/双击恢复窗口'],
    ['src/renderer/settings/*', '标题栏图标、启动小节下拉、输入翻译页（第十一轮）'],
    ['scripts/package-win.js', 'APP_NAME=即译、核心 exe=jiyi-core.exe、/win32icon 嵌入 app.ico'],
    ['launcher/Launcher.cs', '核心程序名与弹框文案改为即译'],
])

out = os.path.join(DOCS, '即译 第十二轮修改记录（改名·二次元图标·后台驻留·输入入口）.docx')
doc.save(out)
print('docx saved:', out, os.path.getsize(out), 'B', len(doc.paragraphs), 'paragraphs', len(doc.tables), 'tables')
