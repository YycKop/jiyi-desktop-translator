"""生成《桌面翻译助手 M5 场景交付与模型分发说明.docx》。

用法：python gen_m5_doc.py
输出：D:\\桌面翻译助手\\开发文档\\桌面翻译助手 M5 场景交付与模型分发说明.docx

对应文档：《M1-M5阶段细节书》M5 的 D5.1~D5.5 与任务 M5-T1~M5-T4。
"""
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = r"D:\桌面翻译助手"
OUT = os.path.join(ROOT, "开发文档", "桌面翻译助手 M5 场景交付与模型分发说明.docx")

DOC = Document()

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


def table(headers, rows):
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


# ---------- 标题 ----------
title = DOC.add_heading("桌面翻译助手 M5 场景交付与模型分发说明", level=0)
for run in title.runs:
    run.font.name = "微软雅黑"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

para("文档编号：DTA-M5-DELIVERY-001　　版本：v1.0　　日期：2026-10-28", size=9)
para(
    "本文档对应《M1-M5阶段细节书》M5 阶段的 D5.1~D5.5 与 M5-T1~M5-T4，说明场景测试方案、"
    "安装包形态、离线模型分发策略与首次启动流程，并如实标注在当前开发环境（无游戏、"
    "无法访问 HuggingFace）下已完成与待实机验证的部分。",
    size=10,
)

# ---------- 一、M5 交付项现状 ----------
h("一、M5 交付项现状", 1)
table(
    ["编号", "细节书要求", "状态", "证据 / 说明"],
    [
        [
            "D5.1",
            "至少 2 款无边框窗口化游戏的测试报告",
            "部分完成",
            "测试用例与预期结果见第三节；本机无游戏客户端与独占全屏环境，"
            "已用同等的窗口层能力自检替代：透明置顶浮窗（screen-saver 层级）、"
            "点击穿透、托盘热键触发，均通过 Electron 自检（ok=true）。",
        ],
        [
            "D5.2",
            "全屏视频置顶 + 字幕翻译",
            "代码具备，待实机验证",
            "浮窗以 setAlwaysOnTop(true, 'screen-saver') 并每 5 秒重申（main.js startHudReassert）；"
            "默认位置支持「框选区域上方」（M5-T2），定时间隔可选 1 秒。",
        ],
        [
            "D5.3",
            "Windows 安装包（.msi/.exe），双击安装 + 首次引导",
            "已交付（portable 形态）",
            r"dist\win-x64\桌面翻译助手.exe 与 dist\桌面翻译助手-1.0.0-win-x64.zip（102.7 MB），"
            "解压即用、无需安装；首次启动自动进入引导页（M5-T4）。"
            "electron-builder 出 .msi 属新增依赖，按 CMD-02 需先审批，故 V1 未纳入。",
        ],
        [
            "D5.4",
            "macOS .dmg（若含）",
            "不适用",
            "V1 目标平台为 Windows x64；代码中 macOS 分支保留（trafficLightPosition 等）但未构建。",
        ],
        [
            "D5.5",
            "模型分发策略文档",
            "已完成",
            "见本文第四节：来源与量化、完整性校验、断点续传、国内镜像、跳过分支与本地服务参数。",
        ],
    ],
)

# ---------- 二、窗口层能力（场景测试的技术前提） ----------
h("二、窗口层能力（场景测试的技术前提）", 1)
para("游戏与视频场景能否显示浮窗，取决于以下四项窗口能力，已在代码与自检中逐项落实：")
table(
    ["能力", "实现方式", "验证情况"],
    [
        [
            "始终置顶（含全屏视频）",
            "transparent + alwaysOnTop + setAlwaysOnTop(true,'screen-saver')，每 5s 重申一次",
            "自检截图确认浮窗在最上层；screen-saver 层级可覆盖普通全屏窗口",
        ],
        [
            "不抢焦点",
            "HUD 窗口 focusable:false + setIgnoreMouseEvents 默认穿透；显示时不调用 focus()",
            "Electron 自检中 HUD 从未获得焦点（窗口参数保证）",
        ],
        [
            "点击穿透",
            "光标命中 .interactive 控件时才 setIgnoreMouseEvents(false)，否则 (true,{forward:true})",
            "M3-T2 逻辑已实现并由 120ms 轮询兜底；渲染进程单测与 IPC 契约测试覆盖",
        ],
        [
            "不占任务栏",
            "skipTaskbar:true；托盘驻留；关闭窗口不退出进程",
            "自检确认托盘图标存在、窗口未出现在任务栏",
        ],
    ],
)
para(
    "说明：REV-001 的 M5-T1-R1 已明确「独占全屏游戏下热键可能失败」属 Windows 平台已知限制，"
    "不作验收硬门槛；产品侧通过用户文档建议将游戏设置为「无边框窗口化」。",
    size=9.5,
)

# ---------- 三、场景测试用例 ----------
h("三、场景测试用例（可交付给测试人员执行）", 1)
table(
    ["用例", "场景", "步骤", "预期结果"],
    [
        [
            "G-01",
            "游戏以管理员权限运行",
            "以管理员启动游戏 → 启动翻译助手（普通权限）→ 按热键框选",
            "取词失败不判缺陷；托盘与设置页提示「检测到目标窗口以管理员权限运行，"
            "翻译助手需以相同权限启动才能正常取词」（REV-001 G-01）",
        ],
        [
            "G-02",
            "热键冲突",
            "先占用 Ctrl+Shift+T（如被其他软件注册）→ 启动翻译助手",
            "启动后弹出提示「热键被占用，请前往设置修改」；"
            "设置页「热键」可按下新组合键重新捕获并保存（M3-T4 / REV-001 G-02）",
        ],
        [
            "G-03",
            "管理员模式下的穿透",
            "助手置为管理员权限 → 在游戏内移动鼠标经过浮窗",
            "浮窗保持点击穿透，光标控制游戏正常；仅悬停到浮窗按钮时恢复交互",
        ],
        [
            "G-04",
            "无边框窗口化游戏",
            "游戏设为窗口化（无边框）→ 框选对话/任务文本 → 开启定时轮询（2s）",
            "浮窗显示译文且不被游戏画面遮挡；帧率无可感知下降（不注入进程、仅屏幕采集）",
        ],
        [
            "V-01",
            "全屏视频字幕",
            "全屏播放外语视频 → 框选字幕区域 → 浮窗位置设为「上方」→ 间隔 1s",
            "浮窗固定于字幕上方不遮挡字幕；译文随字幕刷新；视频不暂停、不退出全屏",
        ],
        [
            "V-02",
            "全屏视频下的穿透",
            "播放视频时点击浮窗以外的区域",
            "点击直达播放器（播放/暂停可用），未被浮窗拦截",
        ],
    ],
)

# ---------- 四、模型分发与首次启动 ----------
h("四、离线模型分发与首次启动策略（D5.5）", 1)
h("4.1 模型选型与量化", 2)
table(
    ["项", "取值", "依据"],
    [
        ["基座模型", "HY-MT1.5-1.8B（33 语种）", "需求书 F-04"],
        ["首选量化", "2-bit GGUF（约 574 MB）", "技术文档修正版 §1（M1-T5 修正），标准 llama.cpp 主干可直接加载"],
        ["备选量化", "1.25-bit GGUF（约 440 MB）", "同上；需自定义 STQ kernel + llama.cpp PR #22836 分支，V1 不作为默认"],
        ["默认端口", "127.0.0.1:8081", "M1-T4 / 限制书 CMD-04 唯一允许的本地翻译端点"],
        ["安全参数", "--cors-origins localhost", "SEC-CORS-01：防恶意网页 CSRF 本地服务"],
        ["上下文", "-c 4096", "单次框选文本量远小于此，留足余量"],
    ],
)

h("4.2 分发方式", 2)
bullet("安装包不含模型（N-05 / M5-T3）：zip 与 portable 目录只含宿主壳、源码、llama-server 可执行文件。")
bullet(
    "首次启动引导第二步提供「选择本地 GGUF」与「跳过」两条路径"
    "（src/renderer/onboarding/app.js → api.model.pick() → 写回 offline.modelPath）。"
)
bullet(
    "自动下载（后续版本）：直连 HuggingFace 或国内镜像（ModelScope / hf-mirror），"
    "要求 SHA-256 校验通过后才落盘、支持断点续传、失败可重试；下载器尚未实现，"
    "当前版本只支持本地文件选择。"
)
bullet(
    "跳过后的降级：浮窗显示「离线模型未安装，请配置联网 API 或下载模型」"
    "（chain.js 的 LOCAL_NOT_READY_MSG），联网 API 仍可正常使用（M5-T4）。"
)

h("4.3 模型文件放置与识别规则", 2)
table(
    ["位置", "规则"],
    [
        [r"%APPDATA%\desktop-translator\models\*.gguf", "首选：取目录下第一个 .gguf 作为默认模型"],
        ["设置页「离线模型 → 选择模型文件」", "手动指定绝对路径，写入 offline.modelPath，优先级最高"],
        ["llama-server 可执行文件", r"runtime\llama\llama-server.exe 或设置页指定 offline.serverPath"],
    ],
)
para(
    "启动顺序：应用启动 → 若 offline.autostart 且模型存在 → 启动 llama-server → GET /health 就绪 → "
    "翻译链在联网 API 全部失败后使用离线分支（engine 显示为「离线模式」）。",
    size=9.5,
)

# ---------- 五、安装与运行 ----------
h("五、安装、运行与卸载", 1)
table(
    ["项", "说明"],
    [
        ["运行", r"解压 zip → 双击 dist\win-x64\桌面翻译助手.exe"],
        ["首次启动", "自动弹出引导页：目标语言 → 离线模型（可跳过）→ 联网 API（可跳过）→ 完成"],
        ["数据位置", r"%APPDATA%\desktop-translator\（config.json、secrets（加密后）、logs\、models\）"],
        ["日志", r"%APPDATA%\desktop-translator\logs\app.log（不含 OCR 原文/译文全文与密钥，LOG-02）"],
        ["卸载", "删除程序目录 + 删除上述数据目录；不写注册表、不装服务、不创建计划任务（CMD-01）"],
        ["网络", "仅出站访问用户自己配置的 API 端点；离线模式只访问 127.0.0.1:8081；无任何遥测"],
    ],
)

# ---------- 六、已知限制与后续计划 ----------
h("六、已知限制与后续计划", 1)
bullet("独占全屏游戏可能无法显示浮窗或热键失效（Windows 权限隔离，REV-001 M5-T1-R1 已豁免）。")
bullet("管理员权限的目标窗口需要同等权限的助手进程才能取词，产品仅提示不自动提权。")
bullet("OCR 对艺术字体、极小字号（≤14px）精度下降；已通过 2 倍放大缓解，实测 16px 以上稳定。")
bullet("本开发环境无法访问 HuggingFace，离线链路只做了「未安装即提示」的降级验证，端到端未实机跑通。")
bullet("正式安装包（.msi/.exe 安装器）与模型下载器需先完成依赖审批（electron-builder 等），列入 V1.1。")

# ---------- 七、变更记录 ----------
h("七、变更记录", 1)
table(
    ["版本", "日期", "变更内容"],
    [
        ["v1.0", "2026-10-28", "首次编写：M5 交付项现状、窗口层能力、场景用例、模型分发策略、安装与限制"],
    ],
)

DOC.save(OUT)
print("saved:", OUT)
print("paragraphs:", len(DOC.paragraphs), "tables:", len(DOC.tables))
