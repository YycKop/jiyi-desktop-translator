"""生成第十轮修复记录 docx（背景图透明度连带文字变淡 / 两处背景分离 / OCR 偶发不可用）。"""
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, '开发文档', '桌面翻译助手 第十轮修复记录（文字随透明度变淡·两处背景分离·OCR 偶发不可用）.docx')

ACCENT = RGBColor(0x2F, 0x6B, 0xE0)
GREY = RGBColor(0x5A, 0x61, 0x6B)

doc = Document()


def set_font(run, size=10.5, bold=False, color=None):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = '微软雅黑'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    if color is not None:
        run.font.color.rgb = color


def para(text, size=10.5, bold=False, color=None, space=6, first=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space)
    run = p.add_run(text)
    set_font(run, size, bold, color)
    if first:
        p.paragraph_format.first_line_indent = None
    return p


def heading(text, level=1):
    size = 16 if level == 1 else 13
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text)
    set_font(run, size, True, ACCENT if level == 1 else None)
    return p


def bullets(items, size=10.5):
    for it in items:
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(it)
        set_font(run, size)


def table(header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ''
        run = cell.paragraphs[0].add_run(h)
        set_font(run, 9.5, True)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            run = cells[i].paragraphs[0].add_run(str(val))
            set_font(run, 9.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = w
    doc.add_paragraph()
    return t


# ── 标题 ─────────────────────────────────────────────────────────────────────
title = doc.add_paragraph()
title.alignment = 1
set_font(title.add_run('桌面翻译助手 第十轮修复记录'), 20, True, ACCENT)
sub = doc.add_paragraph()
sub.alignment = 1
set_font(sub.add_run('文字/按钮随背景图透明度变淡 · 设置页与浮窗背景分别设置 · OCR 偶发报「引擎不可用」'), 10.5, False, GREY)
para('版本：V1.0.0 · 日期：2026-10-31 · 对照反馈：用户第十轮验收意见', 9.5, False, GREY, space=14)

# ── 1 问题与结论 ─────────────────────────────────────────────────────────────
heading('一、本轮反馈与结论')
para('用户原话：「1.设置图片透明度会把浮窗的文字和按钮等也一起透明了，应该保持文字和按钮等元素始终清晰可见；2.我要的是能够分别设置设置页和浮窗的背景，现在是设置设置页就不能设置浮窗的；3.现在识别文字报错，浮窗显示 OCR 引擎不可用，请检查系统 OCR 语言包。」')
table(
    ['编号', '现象', '根因', '处理'],
    [
        ['1', '调高背景图不透明度后，浮窗文字与按钮一起变淡', '背景图层与薄罩层是绝对定位，而内容区块是普通流，罩层压在了内容之上', '内容区块抬到 z-index:1；新增自检项，把不透明度拉满后断言文字仍为 100% 不透明'],
        ['2', '只能二选一：设了设置页就不能设浮窗', '上一轮做成「生效范围」单张图三选一，与用户期望的「各自一张」不符', '拆成两个独立槽位（含各自不透明度），设置页留空时沿用浮窗那张'],
        ['3', '偶发提示「OCR 引擎不可用，请检查系统 OCR 语言包」', '多遍识别会并发启动两个 PowerShell，各自编译内联 C#；偶发编译失败被当成「引擎不可用」', '预处理加三级降级链并缓存 DLL；识别失败时重置引擎缓存；日志补原始错误'],
    ],
    widths=[Pt(28), Pt(120), Pt(150), Pt(150)],
)

# ── 2 文字与按钮 ─────────────────────────────────────────────────────────────
heading('二、问题一：文字与按钮不随图片透明度变淡')
heading('2.1 定位过程', 2)
bullets([
    '现象只在「图片不透明度」调高时出现，调低就恢复；「浮窗不透明度」与「字体颜色」都正常。',
    '检查层级发现：`.bg-layer`（背景图）与 `.bg-veil`（薄罩）都是 `position: absolute`，而 `.hud-head` / `.hud-body` / `.hud-foot` 没有任何 `position`。',
    '按 CSS 绘制顺序，绝对定位元素绘制在未定位的普通流内容之上——于是罩层压在文字与按钮上，看起来像「文字也变透明了」。',
])
heading('2.2 修改内容', 2)
table(
    ['文件', '改动'],
    [
        ['src/renderer/hud/hud.css', '新增 `.hud-head, .hud-body, .hud-foot { position: relative; z-index: 1; }`，并写明原因'],
        ['src/main/main.js（自检）', '把 `bgImageOpacity` 拉到 0.95，采集 `--hud-veil`、内容层 `z-index`、文字 `opacity/color/textShadow`、按钮底色，断言文字层级 ≥1 且完全不透明；新增截图 `11-hud-bg-strong.png`'],
    ],
    widths=[Pt(170), Pt(280)],
)
heading('2.3 验收数据（自检 report.json）', 2)
table(
    ['项目', '结果'],
    [
        ['hudReadableApplied', 'true'],
        ['内容层 / 标题栏 z-index', '1 / 1'],
        ['文字不透明度', '1（完全不透明）'],
        ['文字颜色', 'rgb(232, 236, 243)（默认主题的 --fg）'],
        ['文字投影', 'rgba(0, 0, 0, 0.6) 0 1px 2px（浅色照片上仍清晰）'],
        ['按钮底色', 'rgba(37, 40, 46, 0.86)（半透明底片 + 描边）'],
        ['薄罩', 'rgba(18, 21, 28, 0.593)（随图片不透明度联动，但永远在文字之下）'],
    ],
    widths=[Pt(150), Pt(300)],
)

# ── 3 两处背景分离 ───────────────────────────────────────────────────────────
heading('三、问题二：设置页与浮窗背景分别设置')
para('上一轮做成「生效范围：浮窗与设置页 / 仅设置页 / 仅浮窗」，本质是一张图加一个开关，用户要的是两张图各自存在。本轮改为两个独立槽位。')
heading('3.1 配置结构变化', 2)
table(
    ['字段', '归属', '说明'],
    [
        ['appearance.bgImage', '浮窗', '绝对路径，选图后复制进数据目录 theme/hud-<时间戳>.<扩展名>'],
        ['appearance.bgImageOpacity', '浮窗', '0~1；渲染侧对浮窗再压到 0.55 上限，保证可读性'],
        ['appearance.settingsBgImage', '设置页', '绝对路径，theme/settings-<时间戳>.<扩展名>'],
        ['appearance.settingsBgImageOpacity', '设置页', '0~1，独立于浮窗'],
        ['appearance.bgImageScope', '已废弃', 'store._migrate() 迁移后删除：旧配置 scope=settings 时把图搬到设置页槽位'],
    ],
    widths=[Pt(170), Pt(50), Pt(230)],
)
heading('3.2 代码改动', 2)
table(
    ['文件', '改动'],
    [
        ['src/core/config/defaults.js', '删除 bgImageScope，新增 settingsBgImage / settingsBgImageOpacity'],
        ['src/core/config/store.js', '校验两条绝对路径与两个不透明度区间；_migrate() 处理旧配置'],
        ['src/main/theme-files.js', '新增 importThemeImage(src, stamp, prefix)、removeThemeImage(file)（只允许删 theme/ 下文件）、resolveSurfaceImage(appearance, surface)（设置页留空回落浮窗图）'],
        ['src/main/ipc.js', '三个主题图通道改为按 payload.target 路由到对应槽位'],
        ['src/preload/index.js', 'theme.pickImage/clearImage/getImage(target)'],
        ['src/renderer/shared/theme.js', 'imageStyle(raw, dataUrl, surface) 按表面取不透明度；apply() 不再按范围过滤'],
        ['src/renderer/settings/index.html', '「背景图」拆成「浮窗背景图」「设置页背景图」两个槽位（各自选择/清除/不透明度），删除「生效范围」下拉'],
        ['src/renderer/settings/app.js', 'renderAppearance/applyTheme/syncThemeImage 双槽位化；bindImageSlot() 统一绑定'],
        ['src/renderer/hud/app.js', '取图改 getImage(hud)'],
    ],
    widths=[Pt(170), Pt(280)],
)
heading('3.3 验收', 2)
table(
    ['检查项', '结果'],
    [
        ['surfaceImagesIndependent', 'hud-1793417175328.png / settings-1793417175330.png，independent=true'],
        ['hudBgImageApplied / hudBgImageClipped', 'true / true（图仍在卡片内、按圆角裁切）'],
        ['settingsBgImageApplied', 'true（设置页图层显示自己的图）'],
        ['screenshot', '09-settings-bg.png、10-hud-bg.png、11-hud-bg-strong.png、12-settings-appearance-bg.png'],
    ],
    widths=[Pt(170), Pt(280)],
)

# ── 4 OCR ────────────────────────────────────────────────────────────────────
heading('四、问题三：OCR 偶发「引擎不可用」')
heading('4.1 为什么是「偶发」', 2)
bullets([
    '脚本单独运行完全正常：打包产物里的 winrt-ocr.ps1 直接跑返回 ok=true、sharpened=true、约 387ms。',
    '多遍识别会并发启动两个 PowerShell 进程，各自用 `Add-Type` 编译同一份内联 C#；机器繁忙或首次编译时偶发失败。',
    '失败被 `OcrService.pick()` 当成「引擎探测失败」，最终抛出 OCR_UNAVAILABLE，界面显示「请检查系统 OCR 语言包」。',
])
heading('4.2 三级降级链', 2)
table(
    ['层级', '策略', '说明'],
    [
        ['① 缓存', '加载 <数据目录>/cache/OcrPrep.dll', '一次编译，后续所有识别复用，避免并发重复编译'],
        ['② 编译落盘', 'Add-Type -TypeDefinition -OutputAssembly', '首次运行编译并写入缓存目录'],
        ['③ 内存编译', 'Add-Type -TypeDefinition', '缓存目录不可写时仍然可用'],
        ['④ 纯 GDI+ 缩放', 'Resize-Only', '以上都失败也能放大图片送 OCR，输出 prepFallback=true 并跳过锐化'],
    ],
    widths=[Pt(70), Pt(180), Pt(200)],
)
heading('4.3 其他加固', 2)
bullets([
    '`OcrService.recognize()` 捕获异常时清空 `_picked` 与 `_probeCache`，下一轮重新探测，避免一次失败被永久记住。',
    '`round.js` 的失败日志补 `reason` 字段（错误摘要，不含识别文本），便于用户反馈时定位。',
    '`winrt-ocr.ps1` 注释全部改为 ASCII 并确认文件无 BOM（此前一次编辑丢 BOM 导致中文注释吞掉下一行代码）。',
    '新增测试开关 `-NoPrep`，让自动化测试能稳定走到回退分支。',
])
heading('4.4 新增测试（项目测试/integration/ocr-fallback.test.js）', 2)
table(
    ['用例', '断言'],
    [
        ['缓存复用', '首次生成 OcrPrep.dll；第二次不重复编译；两次识别文本一致'],
        ['回退仍可用', '-NoPrep 时 ok=true、prepFallback=true、sharpened=false，且仍识别出文本'],
        ['错误可读', '图片不存在时 error 不为空，且不允许出现「发生一个或多个错误」'],
    ],
    widths=[Pt(110), Pt(340)],
)

# ── 5 回归 ──────────────────────────────────────────────────────────────────
heading('五、回归与产物')
table(
    ['命令', '结果'],
    [
        ['node 项目测试\\run-all.js', '21 个文件 / 179 个用例，失败分组 0（单元 128 + 集成 37 + OCR 14）'],
        ['node --test 项目测试\\ocr-accuracy.test.js', '14 / 14 通过（12 张合成图 + 汇总断言）'],
        ['node 项目代码\\scripts\\smoke.js', 'ok=true、渲染错误 0、截图 12 张、托盘 true；hudReadableApplied / surfaceImagesIndependent 均 true'],
        ['打包产物 --smoke-test', 'exit=0、ok=true、errs=0（无测试图时背景图相关项按跳过记 true）'],
        ['node 项目代码\\scripts\\package-win.js', 'dist\\win-x64 + zip 126.8 MB（按用户要求未生成 release 发布包）'],
    ],
    widths=[Pt(180), Pt(270)],
)
para('自检截图（项目测试/reports/electron-smoke/）：01-hud、02-settings-general、03-settings-apis、07-settings-appearance、12-settings-appearance-bg、04-onboarding、05-overlay、06-ball、08-hud-tall、09-settings-bg、10-hud-bg、11-hud-bg-strong。')

# ── 6 已知限制 ──────────────────────────────────────────────────────────────
heading('六、已知限制与说明')
bullets([
    '浮窗侧图片不透明度上限固定 0.55：即使设置页已调到 100%，浮窗仍会自动收敛，避免译文读不清（用户可在此基础上继续调低）。',
    '背景图仅支持 png/jpg/jpeg/webp/gif/bmp，单张上限 8MB，超过会提示并拒绝；图片会被复制进数据目录，不引用原始路径。',
    '设置页留空沿用浮窗图属于「回落」而非「同步」：之后改浮窗图，设置页也会跟着变；想固定不同图片，给设置页单独选一张即可。',
    'OCR 的「同形字」仍无法可靠纠正（例：口/囗、幕/墓），这类错误属于字形层面，需靠上下文模型，本轮未处理。',
    '托盘图标在开发机当前会话中无法注册（已用最小化探针 A/B 证实是环境限制），设置入口因此提供四条路径（浮窗 ⚙ / 再次双击 / 托盘 / --open-settings）。',
])

# ── 7 变更记录 ──────────────────────────────────────────────────────────────
heading('七、变更记录')
table(
    ['文件', '说明'],
    [
        ['src/core/config/defaults.js', '外观配置拆两个背景图槽位'],
        ['src/core/config/store.js', '校验与旧配置迁移'],
        ['src/main/theme-files.js', '按表面取图、安全删除、带前缀导入'],
        ['src/main/ipc.js', '主题图三个通道带 target'],
        ['src/preload/index.js', 'theme.* 带 target'],
        ['src/renderer/shared/theme.js', 'imageStyle 按表面取不透明度'],
        ['src/renderer/hud/hud.css', '内容区块 z-index:1（文字不再被罩层压住）'],
        ['src/renderer/hud/app.js', '取浮窗图'],
        ['src/renderer/settings/index.html / .css / app.js', '双槽位界面与逻辑'],
        ['src/core/ocr/index.js', '识别失败重置引擎缓存'],
        ['src/core/ocr/winrt.js', '传 -CacheDir、返回 prepFallback'],
        ['src/core/pipeline/round.js', '失败日志补 reason'],
        ['scripts/winrt-ocr.ps1', '三级降级链 + -NoPrep + 纯 ASCII'],
        ['src/main/main.js', '自检新增 hudReadable / surfaceImagesIndependent / 12 号截图'],
        ['项目测试/integration/ocr-fallback.test.js', '新增 3 个用例'],
        ['项目测试/unit/theme.test.js、theme-files.test.js', '改写/新增用例'],
        ['项目代码/AGENTS.md、README.md、项目测试/README.md', '口径与陷阱同步（21 文件 / 179 用例、截图 12 张）'],
    ],
    widths=[Pt(220), Pt(230)],
)

doc.save(OUT)
print('saved', OUT, os.path.getsize(OUT))
