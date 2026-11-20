#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 离线翻译配置指南（本机 AMD Ryzen 5 5600GT）.docx》"""
import os
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

OUT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "开发文档",
    "桌面翻译助手 离线翻译配置指南.docx"))


def set_font(run, size=10.5, bold=False):
    run.font.name = "微软雅黑"
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")


def para(doc, text, size=10.5, bold=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.35
    set_font(p.add_run(text), size, bold)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(text), 10)
    return p


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Pt(18)
    set_font(p.add_run(text), 9)
    p.runs[0].font.name = "Consolas"
    p.runs[0]._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")


def table(doc, rows):
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = "Table Grid"
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            c = t.cell(i, j)
            c.text = ""
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            set_font(p.add_run(str(cell)), 9, bold=(i == 0))


def build():
    doc = Document()

    h = doc.add_heading("桌面翻译助手 · 离线翻译配置指南", level=0)
    h.alignment = 1
    para(doc, "适用配置：AMD Ryzen 5 5600GT（6 核 12 线程 / AVX2）· 16 GB 内存 · 477 GB SSD · 无独立显卡",
         10, True)
    para(doc, "版本：V1.0.0    日期：2026-10-30    对应需求：F-04 / F-06 / N-02 / M1-T5 / M5-T4")

    # 一
    doc.add_heading("一、结论：可以，而且不需要独立显卡", level=1)
    para(doc, "这台机器的关键指标恰好落在离线翻译的「舒适区」：")
    table(doc, [
        ["项目", "你的配置", "离线翻译要求", "是否满足"],
        ["CPU", "Ryzen 5 5600GT（Zen3，6C/12T，AVX2）", "支持 AVX2 的 x64 CPU", "✅ 满足"],
        ["内存", "16 GB（当前可用 15.4 GB）", "模型 + 服务常驻 ≈ 1.0~1.5 GB", "✅ 满足（需关掉部分大程序）"],
        ["显卡", "Radeon 集成显卡（496 MB 共享）", "非必需，CPU 推理即可", "✅ 不依赖"],
        ["硬盘", "477 GB SSD", "模型 0.5~1.1 GB", "✅ 充足"],
    ])
    para(doc, "模型是「混元 HY-MT1.5-1.8B」的 GGUF 量化版，1.8B 参数很小，2-bit 量化后仅 574 MB，"
              "纯 CPU 推理即可达到「一句话 1~3 秒」的可用速度，与 N-01「离线 ≤3 秒」的目标一致。"
              "集成显卡不需要用、也不建议用：llama.cpp 在 Windows 上没有针对这代锐龙核显的可用加速后端，"
              "设置显存层数反而更容易出错。")

    # 二
    doc.add_heading("二、操作步骤（约 15 分钟）", level=1)

    para(doc, "第 1 步：准备两个文件", 11, True)
    table(doc, [
        ["文件", "从哪来", "放哪", "大小"],
        ["llama-server.exe", "llama.cpp 官方 release：选 llama-bXXXX-bin-win-avx2-x64.zip（5600GT 支持 AVX2，不支持 AVX512）",
         "任意目录，例如 D:\\llama\\llama-server.exe", "约 100 MB（含 DLL）"],
        ["HY-MT1.5-1.8B 的 GGUF", "HuggingFace 搜「HY-MT1.5-1.8B GGUF」（国内可用 hf-mirror.com 镜像）",
         "推荐 <安装目录>\\userdata\\models\\ 下", "2-bit ≈ 574 MB"],
    ])
    bullet(doc, "量化选择：2-bit（≈574 MB，推荐，速度与质量平衡）；Q4_K_M（≈1.1 GB，质量最好但更慢）；"
                "1.25-bit（≈440 MB）需要专门的 STQ kernel 与定制 llama.cpp 分支，普通 release 不支持，不建议首选。")
    bullet(doc, "下载后建议校验文件大小与 sha256；不要从网盘/论坛的不明 .exe 下载 llama-server，"
                "它会被本软件以子进程方式启动，来源必须可信。")
    bullet(doc, "llama.cpp 压缩包解压后**整个目录一起保留**（里面还有 ggml.dll、llama.dll 等），不要只拷贝 exe。")

    para(doc, "第 2 步：在软件里填路径", 11, True)
    para(doc, "打开浮窗标题栏 ⚙ → 左侧「离线模型」页：")
    bullet(doc, "「llama-server 路径」填完整路径，例如 D:\\llama\\llama-server.exe（留空则自动找 runtime\\llama\\llama-server.exe）。")
    bullet(doc, "点「选择 GGUF 模型…」，选中下载的 .gguf 文件（路径会自动保存，下次启动沿用）。")
    bullet(doc, "端口保持 8081（仅监听 127.0.0.1，并强制 CORS 白名单，SEC-CORS-01）。")
    bullet(doc, "「线程数」填 6（= 物理核心数）；不确定就留空，由 llama.cpp 自动判断。")
    bullet(doc, "可选：勾选「随应用启动」，以后开机启动软件就会自动拉起离线服务。")

    para(doc, "第 3 步：启动并确认就绪", 11, True)
    bullet(doc, "点「启动服务」，状态会先显示「运行中（加载模型…）」，通常 3~15 秒后变成「运行中（就绪）」。")
    bullet(doc, "「服务地址」显示 http://127.0.0.1:8081 即为正常。")
    bullet(doc, "启动失败时点「刷新状态」，并查看日志：<安装目录>\\userdata\\logs\\llama.log。")

    para(doc, "第 4 步：验证离线真的可用", 11, True)
    bullet(doc, "① 断网测试：禁用网络适配器或拔网线 → 按 Ctrl+Shift+T 框选一段英文 → 浮窗仍能出中文译文。")
    bullet(doc, "② 引擎标识：浮窗底部会显示「引擎：离线模式」（可在设置里关掉这行小字）。")
    bullet(doc, "③ 命令行验证（无需联网）：")
    code(doc, 'curl http://127.0.0.1:8081/health\n'
              '→ {"status":"ok"}\n\n'
              'curl -X POST http://127.0.0.1:8081/v1/chat/completions -H "Content-Type: application/json" '
              '-d "{\\"model\\":\\"hy-mt\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":'
              '\\"Translate to Chinese, output only the translation: Hello world\\"}],\\"temperature\\":0}"')
    bullet(doc, "④ 若配置了联网 API，主用失败/超时后才降级到离线（F-05a 只按失败或超时判定，不评估质量）。")

    # 三
    doc.add_heading("三、性能与资源占用预期", level=1)
    table(doc, [
        ["指标", "2-bit（574 MB）", "Q4_K_M（1.1 GB）"],
        ["CPU 生成速度", "约 15~30 token/s", "约 8~15 token/s"],
        ["50 token 译文耗时", "1.5~3.5 s", "3~6 s"],
        ["单轮总耗时（含截图+OCR）", "约 2~4 s", "约 4~7 s"],
        ["llama-server 常驻内存", "约 0.9~1.2 GB", "约 1.4~1.8 GB"],
        ["是否满足 N-02（≤1.5 GB）", "✅ 满足", "⚠ 边缘，可能超标"],
    ])
    para(doc, "注意：本机当前（编写本指南时）只剩约 1.5 GB 物理可用内存，被 PyCharm（1.7 GB）、"
              "浏览器、飞书等占用。加载模型前请关掉这些大程序，否则 llama-server 会被系统换页到硬盘，"
              "速度反而掉到 1/3。建议加载模型时保留 ≥3 GB 空闲内存。")

    # 四
    doc.add_heading("四、常见问题排查", level=1)
    table(doc, [
        ["现象", "原因", "处理"],
        ["状态显示「缺少 llama-server」", "路径没填 / 目录没解压全", "重新填绝对路径；确认 exe 同目录有 ggml.dll、llama.dll"],
        ["一直「加载模型…」不结束", "模型文件损坏、GGUF 版本比 llama.cpp 新、内存不足", "换新 release 的 llama.cpp；校验 sha256；关掉大程序"],
        ["启动瞬间退出", "端口被占用 / 路径含特殊字符", "端口改 8082 再试；把模型放到简单英文路径下"],
        ["翻译返回「离线模型未安装，请配置联网 API 或下载模型」", "模型路径失效或被移动", "设置页重新选择 .gguf"],
        ["速度慢（>10 s）", "内存换页 / 线程数过高 / 用了 Q4_K_M", "关大程序；线程数设 6；换 2-bit"],
        ["显存报错或崩溃", "设置了 gpuLayers > 0", "保持显存层数为 0（核显无可用加速后端）"],
        ["识别不到文字", "与离线模型无关", "OCR 精度问题，见《第五轮修复记录》：框选紧贴文字、字号 ≥16px"],
    ])

    # 五
    doc.add_heading("五、费用与隐私", level=1)
    bullet(doc, "离线模式零调用费：模型在本机跑，不产生任何 API 费用，适合长时间字幕/游戏场景。")
    bullet(doc, "隐私：截图只取框选区域，OCR 与推理全部本地完成，不出网、不写原文到日志（N-04 / LOG-01）。")
    bullet(doc, "建议策略：把离线的 2-bit 模型当作「保底」，同时配置一个便宜的联网 API 作主用；"
                "联网失败或超时才走离线，两者自动切换（F-05a / F-06）。")
    bullet(doc, "费用控制：默认开启「文字未变化时跳过重复翻译」+ 10 分钟译文缓存，OCR 抖动不会重复计费。")

    # 六
    doc.add_heading("六、一页速查", level=1)
    code(doc, "1. 解压 llama.cpp → D:\\llama\\llama-server.exe（同目录保留 dll）\n"
              "2. 下载模型 → D:\\...\\userdata\\models\\*.gguf（2-bit，574MB）\n"
              "3. 浮窗 ⚙ → 离线模型 → 填 llama-server 路径 → 选择 GGUF → 线程 6 → 启动服务\n"
              "4. 状态「运行中（就绪）」+ 服务地址 http://127.0.0.1:8081 = 成功\n"
              "5. 断网框选一句话，浮窗出现「引擎：离线模式」= 真离线\n"
              "6. 出问题看 <安装目录>\\userdata\\logs\\llama.log")

    doc.add_heading("七、变更记录", level=1)
    table(doc, [
        ["版本", "日期", "内容"],
        ["1.0", "2026-10-30", "首版：针对 AMD Ryzen 5 5600GT / 16GB / 无独显的离线翻译配置指导"],
    ])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("written:", OUT)
    print("size:", os.path.getsize(OUT))


if __name__ == "__main__":
    build()
