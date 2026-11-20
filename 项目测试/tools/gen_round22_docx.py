# -*- coding: utf-8 -*-
"""生成《即译 第二十二轮记录（CPU 与内存优化）》.docx"""
from docx import Document
from docx.shared import Pt, RGBColor

OUT = r"D:\桌面翻译助手\开发文档\即译 第二十二轮记录（CPU 与内存优化）.docx"

doc = Document()

style = doc.styles["Normal"]
style.font.name = "Microsoft YaHei"
style.font.size = Pt(10.5)
style.paragraph_format.space_after = Pt(6)


def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.name = "Microsoft YaHei"
        run.font.color.rgb = RGBColor(0x1F, 0x35, 0x64)
    return p


def para(text, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    return p


def bullet(text):
    p = doc.add_paragraph(style="List Bullet")
    p.add_run(text)
    return p


def table(headers, rows):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    for i, name in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(name)
        run.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
    return t


# ---------- 封面 ----------
title = doc.add_heading("即译 第二十二轮记录", level=0)
for run in title.runs:
    run.font.name = "Microsoft YaHei"
sub = doc.add_paragraph()
r = sub.add_run("CPU 与内存优化：整屏回读、去重滞后、离线模型常驻")
r.font.size = Pt(12)
r.font.color.rgb = RGBColor(0x5A, 0x64, 0x78)

para("版本 v1.0.0 ｜ 记录日期 2026-11-18 ｜ 产物 dist\\win-x64（196.9 MB zip）")

# ---------- 1 ----------
h("1. 用户反馈与结论")

para("用户原话：", bold=True)
para("「帮我看看一下问题如何优化：1.我发现软件内存占用和cpu占用都有点太高了，"
     "cpu占用能到50%以上，内存能到1140mb」")

para("结论：CPU 高不是「编码效率」问题，而是三条结构性浪费叠加——", bold=True)
bullet("每一轮都按整屏物理分辨率回读桌面再裁剪，GPU 回读主导单轮成本；")
bullet("去重发生在 OCR 之后，而且翻译失败时不写缓存，静态画面每轮照样跑一遍 OCR；")
bullet("离线模型无条件常驻，静置就吃掉约 1.97 GB 内存。")

para("另外查清了一件事：用户把轮询间隔调到 300 ms 时，单轮约 200 ms 的固定开销正好"
     "让 CPU 顶在 50% 附近，所以「调到最快反而更卡」是必然结果，需要从单轮成本下手，"
     "而不是继续加档位。")

# ---------- 2 ----------
h("2. 优化前基线")

para("测量工具：新增 scripts/perf-probe.js（经 --perf-probe 驱动），"
     "用 app.getAppMetrics() 每 2 秒采样各进程 percentCPUUsage 与 workingSetSize。")

table(
    ["场景", "平均 CPU", "峰值 CPU", "内存", "说明"],
    [
        ["静置（无 API、无模型）", "0.4%", "—", "209 MB", "llama-server 未启动"],
        ["静置但 autostart 打开", "0%", "—", "1974 MB", "仅 llama-server 一项"],
        ["1 秒一轮，静态画面", "19.7%", "29.5%", "581 MB", "每轮都在重复 OCR"],
        ["0.3 秒一轮，静态画面", "41.9%", "49.9%", "—", "对应用户看到的 50%+"],
    ],
)

# ---------- 3 ----------
h("3. 三条根因与修法")

table(
    ["根因", "原实现", "修法"],
    [
        [
            "整屏回读",
            "capture/electron.js 每轮 desktopCapturer.getSources({thumbnailSize: 整屏}) 再裁剪",
            "新增 peekRegion()：480px 缩略图 + 32px 灰度签名（1 KB），先比签名再决定要不要截原图",
        ],
        [
            "去重滞后",
            "round.js 顺序为 截图 → OCR → 指纹去重 → 翻译；翻译失败不写缓存",
            "外层先算帧指纹，sameFrame() 命中直接复用上一轮整轮结果；成功与失败都缓存，force 不吃缓存",
        ],
        [
            "模型常驻",
            "offline.autostart 默认 true，开机即加载 1 GB GGUF",
            "默认改为 false（按需现拉）+ 空闲 10 分钟自动停（offline.idleStopMs）",
        ],
    ],
)

para("顺带修掉的两个真实缺陷：")
bullet("capture/index.js 没有把 peekRegion() / sameFrame() 透传出去，"
       "跳过逻辑一开始根本没生效（这也是首次复测仍是 42% 的原因）；")
bullet("ensureOfflineReady() 在 autostart=false 时直接早退，"
       "导致即便用户手动加载了模型也走不到离线通道。")

# ---------- 4 ----------
h("4. 改动清单")

table(
    ["文件", "改动"],
    [
        ["src/core/config/defaults.js", "offline.autostart 改 false；新增 offline.idleStopMs=600000"],
        ["src/core/config/store.js", "新增 offline 段校验（idleStopMs 0–3600000、autostart 布尔、端口、线程）"],
        ["src/llama/server.js", "touch() / armIdleTimer() / disarmIdleTimer()，启动与 waitReady 成功都记活跃时间"],
        ["src/core/index.js", "ensureOfflineReady() 去掉 autostart 早退，运行中返回前 touch()"],
        ["src/core/capture/electron.js", "peekRegion()（480px 缩略图 → 32px 灰度签名）+ sameFrame(a,b,tol)"],
        ["src/core/capture/index.js", "透传 peekRegion() / sameFrame()"],
        ["src/core/pipeline/round.js",
         "拆 executeRound（帧指纹、命中即复用、缓存失败）与 executeRoundOnce（原流程）"],
        ["src/core/ocr/rapid.js", "chooseLang() 先用上一轮模型试分（langHint），避免每轮跑三模型"],
        ["src/renderer/settings", "「离线模型 → 空闲卸载（分钟）」输入框 + 回填 + 监听"],
        ["src/main/main.js", "自检新增 5h) 帧指纹跳过（最多试 3 次取两帧相同签名）"],
    ],
)

# ---------- 5 ----------
h("5. 优化前后对比")

para("测量条件：--perf-probe=12 --perf-probe-region=40,40,600,160（固定桌面区域）。")

table(
    ["场景", "改前 CPU", "改后 CPU", "说明"],
    [
        ["0.3 秒一轮", "41.9% 均值 / 49.9% 峰值", "7.9% 均值 / 稳态 2.6–3.4%", "首轮仍要真识别，之后基本只 peek"],
        ["1 秒一轮", "19.7% 均值 / 29.5% 峰值", "1.0% 均值 / 1.4% 峰值", "画面不动时整轮跳过"],
        ["内存", "581 MB（另加 llama 1974 MB）", "546 MB（llama 默认不启动）", "模型按需加载、空闲自动卸载"],
        ["单轮耗时", "约 200 ms CPU", "跳过时 totalMs≈170（仅 peek）", "首轮 438–502 ms"],
    ],
)

para("需要说明的口径：", bold=True)
bullet("CPU 百分比来自 app.getAppMetrics().cpu.percentCPUUsage，是「占满一个核」的百分比；"
       "静态画面下的数字已接近空闲基线，剩余主要是窗口轮询与 120ms 光标命中检测。")
bullet("内存里的 llama-server 是独立进程，只在真正走离线时才会被拉起；空闲 10 分钟后自动退出。")

# ---------- 6 ----------
h("6. 验证与产物")

table(
    ["项目", "结果"],
    [
        ["单元 + 集成 + OCR（run-all.js）", "27 个文件，失败 0"],
        ["新增单元用例 frame-sig.test.js", "7 条全通过"],
        ["新增集成用例 frame-skip.test.js", "6 条全通过"],
        ["开发态自检 smoke.js", "ok=true，渲染错误 0，截图 16 张，frameSkip.skipped=true"],
        ["打包态自检", "ok=true，渲染错误 0，截图 13 张"],
        ["打包", "dist\\win-x64 + zip 196.9 MB（日/韩模型已在包内）"],
    ],
)

para("打包前若 app\\ 目录被占用，先「Stop-Process -Name jiyi-core」，否则 copy 会失败。")

# ---------- 7 ----------
h("7. 已知限制")

bullet("自动跳过只看「画面有没有变」：滚动字幕、视频画面每帧都不同，仍然要逐轮识别，"
       "此时 CPU 会回到识别本身的成本（约为改动前的 65%）。")
bullet("把字幕条调到 300 ms 仍是高负载用法；建议 500 ms 以上，静态画面几乎不耗 CPU。")
bullet("模型首次加载约 4–6 秒（1 GB GGUF 落盘读取），期间界面会显示「离线模型加载中…」。")

doc.save(OUT)
print("saved", OUT)
print("paras", len(doc.paragraphs), "tables", len(doc.tables))
