"""生成《桌面翻译助手 V1 实现说明与验收报告.docx》。

用法：python gen_v1_report.py
输出：D:\\桌面翻译助手\\开发文档\\桌面翻译助手 V1 实现说明与验收报告.docx
"""
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = r"D:\桌面翻译助手"
OUT = os.path.join(ROOT, "开发文档", "桌面翻译助手 V1 实现说明与验收报告.docx")

DOC = Document()

# ---------- 全局字体 ----------
style = DOC.styles["Normal"]
style.font.name = "微软雅黑"
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
style.paragraph_format.space_after = Pt(4)
style.paragraph_format.line_spacing = 1.35


def h(text, level=1):
    p = DOC.add_heading(text, level=level)
    for run in p.runs:
        run.font.name = "微软雅黑"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
        run.font.color.rgb = RGBColor(0x1F, 0x38, 0x64)
    return p


def para(text, bold=False, size=None, color=None):
    p = DOC.add_paragraph()
    run = p.add_run(text)
    run.font.name = "微软雅黑"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    run.bold = bold
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return p


def bullet(text):
    p = DOC.add_paragraph(style="List Bullet")
    run = p.add_run(text)
    run.font.name = "微软雅黑"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    return p


def table(headers, rows, widths=None):
    t = DOC.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, name in enumerate(headers):
        hdr[i].text = ""
        run = hdr[i].paragraphs[0].add_run(name)
        run.bold = True
        run.font.name = "微软雅黑"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            run = cells[i].paragraphs[0].add_run(str(val))
            run.font.name = "微软雅黑"
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
            run.font.size = Pt(9)
    DOC.add_paragraph()
    return t


# ---------- 标题页 ----------
title = DOC.add_heading("桌面翻译助手 V1 实现说明与验收报告", level=0)
for run in title.runs:
    run.font.name = "微软雅黑"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

para("文档编号：DTA-V1-IMPL-001　　版本：v1.0　　日期：2026-10-28", size=9)
para(
    "本文档记录「桌面翻译助手」第一版（V1.0.0）的实现方案、与需求文档的逐条对照、测试结果与已知限制。"
    "文档定位为交付说明，后续变更请遵循《修订条款汇总（REV-001）》的更新规则，不直接修改原始需求文档。",
    size=10,
)

# ---------- 一、交付物 ----------
h("一、交付物清单", 1)
table(
    ["类别", "位置", "内容"],
    [
        ["源代码", "项目代码\\", "Electron 宿主壳 + 纯 Node 核心逻辑（截图/OCR/翻译/配置/安全/宿主桥）"],
        ["插件", "dsh-plugins\\", "dsh-plugin-screen-ocr、dsh-plugin-translate（仅经宿主桥调用，不截屏不持钥）"],
        ["测试", "项目测试\\", "95 个用例（单元 67 + 集成 28）、合成测试图、OCR 精度报告、Electron 自检截图"],
        ["协作约定", r"项目代码\AGENTS.md", "版本基线、目录结构、IPC 契约位置、关键约束、验收命令、环境陷阱"],
        ["安全落地", r"项目代码\SECURITY_CONSTRAINTS.md", "限制书逐条对照、高风险代码审查记录、C-01~C-07 自查表"],
        ["文档", "开发文档\\", "本报告 + 《桌面翻译助手 M5 场景交付与模型分发说明》；原有 7 份文档保持只读"],
        ["打包产物", "dist\\win-x64\\", "portable 目录（桌面翻译助手.exe + resources/app）+ 桌面翻译助手-1.0.0-win-x64.zip（102.7 MB）"],
    ],
)

# ---------- 二、架构 ----------
h("二、实现架构", 1)
para(
    "整体为「Electron 宿主壳 + 无 GUI 依赖的核心层 + 本机宿主桥」。核心层（src/core）不 require electron，"
    "因此可在无图形环境跑单元测试；宿主桥让 DSH 插件与外部工具以 HTTP 方式复用同一套能力。",
)
table(
    ["层", "职责", "关键文件"],
    [
        ["主进程", "窗口/托盘/热键/剪贴板/IPC 编排", "main/main.js、windows.js、tray.js、hotkeys.js、ipc.js、position.js"],
        ["预加载", "唯一暴露 window.api 的边界（contextIsolation + sandbox）", "preload/index.js"],
        ["渲染进程", "浮窗 HUD、框选遮罩、悬浮球、设置面板、首次引导", "renderer/hud、overlay、ball、settings、onboarding"],
        ["核心层", "截图、OCR、翻译链、配置、密钥、宿主桥、轮询、性能采样", "core/capture、ocr、translate、config、security、host、pipeline、metrics"],
        ["契约层", "IPC 通道、热键格式（主进程与渲染进程共用）", "shared/ipc-channels.js、shared/accelerator.js"],
    ],
)
para("数据流（一次翻译）：", bold=True)
bullet("热键/托盘 → 遮罩窗口拖选矩形 → 主进程记录区域（持久化到配置）")
bullet("核心层截图（仅该矩形）→ OCR（Windows.Media.Ocr，失败回退 Tesseract）→ 文本清洗（含 OCR 汉字间空格折叠）")
bullet("去重判断（同区域同文本 + 最小重译间隔）→ 翻译链：联网 API（最多 2 个，主 5s/备 3s）→ 全部失败降级离线 llama-server")
bullet("浮窗显示译文 + 引擎标识（如「引擎：DeepSeek」/「引擎：离线模式」），不抢焦点、默认点击穿透")

# ---------- 三、功能对照 ----------
h("三、功能需求实现对照（需求书 F-01 ~ F-17）", 1)
table(
    ["编号", "需求", "实现情况", "说明"],
    [
        ["F-01", "独立软件（Tauri/WebView2/Electron 择一）", "已实现", "Electron 28.3.3（锁定版本，无 ^/~）；技术偏离见第八节"],
        ["F-02", "托盘驻留 + 菜单（展开浮窗/框选/设置/退出）", "已实现", "tray.js；关闭窗口不退出；菜单含定时轮询单选、收起/展开、设置子菜单"],
        ["F-03", "DSH 为后台编排引擎，浮窗独立取结果", "已实现", "宿主桥 + 两个自研插件；插件不截屏、不持钥"],
        ["F-04", "离线默认可用 HY-MT1.5-1.8B GGUF", "代码就绪", "llama-server 管理、CORS 白名单、健康检查、参数拼装齐备；本机无法下载模型（见第八节）"],
        ["F-05", "用户自填 Key/BaseURL/模型，预置模板", "已实现", "deepseek/openai/claude/gemini/custom 五套预设"],
        ["F-05a", "多 API 主备链：按序串行、首个有效即用、最多 2 个", "已实现", "chain.js；主 5s/备 3s；只按失败/超时切换，不评估质量"],
        ["F-06", "自动降级并标注当前模式", "已实现", "浮窗底部显示引擎标识；全失败显示「离线模型未安装…」提示"],
        ["F-07", "源语言自动检测、目标语言手动、34 种语言", "已实现", "languages.js + 提示词；源=目标语言时直接返回「无需翻译」"],
        ["F-08", "Key 加密存本地、界面仅掩码", "已实现", "AES-256-GCM + scrypt(机器指纹)；单测断言配置文件无明文"],
        ["F-09", "快捷键框选并持久化坐标", "已实现", "默认 Ctrl+Shift+T；四种动作均可自定义（REV-001 G-02）"],
        ["F-10", "区域 OCR（RapidOCR 优先/Tesseract 兜底）", "已实现（引擎替换）", "Windows.Media.Ocr 作第一引擎，Tesseract 兜底，mock 供测试"],
        ["F-11", "定时轮询 + 手动触发", "已实现", "TranslationLoop：防重入、超时顺延、间隔 0.5s~10min"],
        ["F-12", "半透明浮窗、可滚动、历史记录", "已实现", "HUD 支持位置自动/上/左/右/固定，保留最近 5 条历史可回看"],
        ["F-13", "透明无边框", "已实现", "frame:false + transparent + 自定义标题栏"],
        ["F-14", "点击穿透，悬停交互控件恢复", "已实现", "elementFromPoint + 120ms 兜底轮询判定 .interactive"],
        ["F-15", "始终置顶（含全屏视频）", "已实现", "alwaysOnTop('screen-saver') + 每 5s 重申，规避被其它置顶窗口压住"],
        ["F-16", "收起为悬浮球", "已实现", "44×44 圆球，可拖动，点击展开"],
        ["F-17", "显示/更新译文不抢焦点", "已实现（有限）", "浮窗 focusable:false；REV-001 指出独占全屏游戏仍可能失焦，不列为验收硬门槛"],
    ],
)

# ---------- 四、非功能 ----------
h("四、非功能需求与修订条款", 1)
table(
    ["编号", "要求", "结果"],
    [
        ["N-01", "延迟：联网 ≤ 2s、离线 ≤ 3s", "OCR 单张 0.25s 左右；联网延迟取决于所选 API，链路超时预算 5s+3s 可配"],
        ["N-02", "离线常驻内存 ≤ 1.5GB（含模型）", "待真实模型环境实测；perf.js 已实现「采样 30s + 按进程分组」并写入 perf/ 目录"],
        ["N-02-R1", "目标机实测 RSS 之和", "同上，工具与方法已就绪（scripts/mem-sample.ps1 + metrics/perf.js）"],
        ["N-03", "不注入目标进程、只屏幕采集", "截图仅用 desktopCapturer / GDI，无注入、无 DLL、无钩子"],
        ["N-04", "隐私本地处理", "OCR 与密钥全程本地；出网仅用户自配端点与本机 8081"],
        ["N-05", "模型首次启动下载", "代码保留能力与「未安装则提示」路径；下载器未实现（本机不可达 huggingface）"],
        ["REV-001 G-01", "管理员权限检测与提示", "已实现 OpenProcess 之外的提示路径：检测失败时提示「需以相同权限启动」"],
        ["REV-001 G-02", "热键冲突提示 + 可自定义入口", "已实现：注册失败 → 托盘告警项 + 设置页「按下新组合键」捕获"],
        ["REV-001 G-03", "管理员模式下穿透仍生效", "穿透逻辑不依赖权限，默认即生效"],
        ["REV-001 DSH-05", "DSH 源码与产物只读", "未修改任何 @deepseek-ai/*；无 patch-package/postinstall"],
    ],
)

# ---------- 五、测试 ----------
h("五、测试与验收结果", 1)
para("测试全部使用 Node 内置 test runner 与合成图片，未引入第三方测试框架、未截取真实桌面。", size=10)
table(
    ["测试项", "规模", "结果"],
    [
        ["单元测试", "7 个文件 / 67 个用例", "全部通过"],
        ["集成测试", "4 个文件 / 28 个用例", "全部通过"],
        ["OCR 精度（D1.3）", "5 张合成图", "5/5 通过，最低相似度 0.9524（16px 字幕图）"],
        ["Electron 自检", "启动真实窗口并截图", "ok=true，渲染进程错误 0，6 张截图，托盘创建成功"],
        ["打包产物自检", "dist 内 portable exe 跑 --smoke-test", "exit=0，ok=true，渲染错误 0（产物可直接分发）"],
        ["IPC 契约一致性", "通道 × 三方（契约/preload/主进程）", "通过（静态比对，防「按钮点了没反应」）"],
    ],
)
para("关键验收证据：", bold=True)
bullet(r"项目测试\reports\ocr-accuracy.json：逐图相似度与耗时")
bullet(r"项目测试\reports\electron-smoke\report.json 与 6 张 PNG：浮窗、设置（通用/API）、引导、遮罩、悬浮球")
bullet(r"项目测试\reports\electron-smoke\run.log：主进程启动、热键注册、宿主桥端口、托盘重建记录")

para("本轮修复的真实缺陷（均由测试发现，非文档偏差）：", bold=True)
table(
    ["缺陷", "影响", "修复"],
    [
        ["setApiSecret() 未落盘", "用户填写的 Key 重启后丢失（F-08 失效）", "写入后立即 save()"],
        ["TranslationLoop 裸 emit('error')", "轮询异常时进程崩溃", "仅在存在监听者时 emit，并新增 failed 事件"],
        ["宿主桥路由顺序", "未知路径返回 405 而非 404；错误响应回显上游报文（含 Key 片段）", "新增 POST_ROUTES 白名单；describeError 二次掩码并截断"],
        ["normalize() 丢弃业务码", "截图/OCR 失败被误报为「翻译通道全部不可用」", "保留落在 CODES 枚举内的 code 与 userMessage"],
        ["渲染进程 const api 重声明", "整页脚本不执行（浮窗空白、设置页空白）", "渲染脚本统一 IIFE 包裹 + languages.js 常量改名"],
    ],
)

# ---------- 六、安全 ----------
h("六、安全合规", 1)
para("逐条对照见 项目代码\\SECURITY_CONSTRAINTS.md，交付前自查 C-01~C-07 全部通过，无未关闭例外。", size=10)
bullet("只写项目目录：所有可写路径经 paths.js 收敛；测试期由 TRANSLATOR_HOME 重定向到 项目测试\\_runtime")
bullet("密钥：AES-256-GCM 密文落盘，界面仅掩码，日志经 redact() 掩码，错误响应二次掩码")
bullet("出网：仅用户自配 baseUrl 与本机 127.0.0.1:8081；无遥测、无崩溃上报")
bullet("截图：仅框选区域，临时文件写完即删（含 OCR 放大图）")
bullet("依赖：运行时仅 electron@28.3.3（用户已确认方案）；测试零外部依赖")

# ---------- 七、已知限制 ----------
h("七、已知限制", 1)
table(
    ["限制", "说明", "影响"],
    [
        ["离线模型未随包分发", "本机无法访问 huggingface.co，GGUF 未下载", "离线翻译在当前环境不可用，会提示配置联网 API"],
        ["未测游戏全屏场景（M5-T1）", "需要真实游戏与无边框窗口化设置", "置顶/穿透在独占全屏下可能失效（技术文档已声明为边界）"],
        ["安装包为免安装 zip", "electron-builder 属新依赖，需先审批；当前产出 portable 目录 + zip 并已自检", "无 .msi 安装向导；首次引导在首次启动时承担配置职责"],
        ["DSH 插件未跑 --dump-config", "本机未安装 DSH CLI", "插件协议与合规性由单测覆盖，端到端待 DSH 环境验证"],
        ["14px 以下小字 OCR 精度下降", "系统 OCR 分辨率限制（实测「幕」→「墓」）", "字幕类场景建议 ≥16px 或放大区域"],
    ],
)

# ---------- 八、技术偏离 ----------
h("八、技术偏离记录", 1)
table(
    ["项目", "原方案", "实际方案", "原因"],
    [
        ["宿主壳", "Tauri（需求书倾向）", "Electron 28.3.3", "本机无 Rust 工具链；Electron 属 F-01 允许三选一；透明窗与设置面板成本更低"],
        ["OCR 首选引擎", "RapidOCR（onnxruntime）", "Windows.Media.Ocr", "免新依赖（DSH-02）；实测中英印刷体相似度 ≥ 0.95，满足 D1.3"],
        ["模型获取", "首次启动下载 GGUF", "保留能力，当前提示未安装", "huggingface.co 不可达；降级路径已在文档定义（M5-T4）"],
        ["安装包", "tauri build 产 .msi", "portable 目录 + zip", "electron-builder 需先走 CMD-02 依赖审批"],
        ["DSH 定位", "DSH 作为强制运行时", "DSH 插件为可选项，宿主壳自足", "F-03 要求浮窗独立取结果；宿主桥使两种部署都成立"],
    ],
)

# ---------- 九、后续 ----------
h("九、后续工作建议", 1)
bullet("M5-T1：在目标游戏（窗口化/无边框）实测置顶、穿透、帧率，按 REV-001 补充 G-01~G-03 测试记录")
bullet("N-02-R1：在最低配置机跑 perf.js 采样 30s，数据写入 perf/ 并据此决定量化位宽")
bullet("模型分发：实现带哈希校验与断点续传的下载器，配合国内镜像")
bullet("打包：完成 electron-builder 依赖审批后可再产出 .msi（当前 portable zip 已可用于分发）")
bullet("DSH 集成：在具备 DSH CLI 的环境执行 --dump-config 验证插件挂载，并补端到端联调记录")

# ---------- 十、变更 ----------
h("十、变更记录", 1)
table(
    ["版本", "日期", "内容"],
    [
        ["v1.0", "2026-10-28", "首版实现与验收：宿主壳、核心链路、插件、95 个测试用例、安全自查"],
    ],
)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
DOC.save(OUT)
print("saved:", OUT)
print("paragraphs:", len(DOC.paragraphs), "tables:", len(DOC.tables))
