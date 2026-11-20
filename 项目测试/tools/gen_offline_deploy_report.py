#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 离线模型部署与验证报告.docx》"""
import os
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

OUT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "开发文档",
    "桌面翻译助手 离线模型部署与验证报告.docx"))


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

    h = doc.add_heading("桌面翻译助手 离线模型部署与验证报告", level=0)
    h.alignment = 1
    para(doc, "llama.cpp 运行时 + HY-MT1.5-1.8B GGUF 的落地、实测与缺陷修复", 12, True)
    para(doc, "版本：1.0.0（离线能力）    日期：2026-10-30    适用范围：项目代码 / 项目测试 / dist")
    para(doc, "对应需求：「帮我下载 llama-server.exe 和 HY-MT1.5-1.8B 的 GGUF 到推荐位置，"
              "并验证是否能够正常使用」")

    # 1
    doc.add_heading("一、结论速览", level=1)
    table(doc, [
        ["问题", "结果", "证据"],
        ["运行时是否就位", "是", "llama.cpp b12000（0.8.0-dev），52 个文件共 60.5 MB，"
                             "随包分发到 app\\resources\\runtime\\llama\\"],
        ["模型是否就位", "是", "HY-MT1.5-1.8B-Q4_K_M.gguf，1,133,080,512 B，魔数 GGUF 校验通过"],
        ["离线能否翻译", "能", "应用内经宿主桥调用：engine=离线模式，1127 / 1181 / 1222 ms，"
                           "译文正确（“点击‘保存’以继续。请点击链接以填写您的详细信息。”）"],
        ["是否需要联网", "不需要", "推理全程访问 127.0.0.1:8081，模型本地加载"],
        ["内存是否达标", "未达标", "llama-server 2044 MB + 宿主壳 4 进程 ≈ 2248 MB，"
                             "高于 N-02 的 1.5 GB 目标（Q4_K_M 的代价，见第八章）"],
        ["CORS 验收口径", "已修正", "--cors-origins 不返回 403，只控制 Access-Control-Allow-Origin 回显"],
    ])

    # 2
    doc.add_heading("二、下载来源与校验", level=1)
    para(doc, "运行时不走包管理器，直接取 GitHub Release 的 CPU 通用构建；模型走 ModelScope"
              "（本机 hosts 把 huggingface 指向 127.0.0.1 的本地代理，实测完全不可达）。")
    table(doc, [
        ["资产", "来源", "大小", "校验方式"],
        ["llama-b12000-bin-win-cpu-x64.zip",
         "github.com/ggml-org/llama.cpp/releases/download/b12000/",
         "24,548,752 B",
         "解压后 llama-server.exe --version 输出 build 12000 / commit 68d20b884"],
        ["HY-MT1.5-1.8B-Q4_K_M.gguf",
         "modelscope.cn/api/v1/models/Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF/repo?Revision=master&FilePath=…",
         "1,133,080,512 B（1080.6 MB）",
         "文件头 4 字节为 GGUF；llama-server 加载成功并返回 /props 的 n_ctx=2048"],
        ["（放弃）Hy-MT1.5-1.8B-2bit.gguf",
         "huggingface.co/tencent/Hy-MT1.5-1.8B-2bit-GGUF",
         "572.7 MB（仅下到 419,972,732 B）",
         "12 次断点续传均 0 字节进展 → 放弃，已删除半成品文件"],
    ])
    para(doc, "下载命令（本机必须带 --ssl-no-revoke，否则 schannel 校验吊销失败）：", 11, True)
    code(doc, "curl.exe --ssl-no-revoke -L -C - -o llama-cpu.zip \\\n"
              "  https://github.com/ggml-org/llama.cpp/releases/download/b12000/llama-b12000-bin-win-cpu-x64.zip")

    # 3
    doc.add_heading("三、放置位置（推荐位置）", level=1)
    table(doc, [
        ["内容", "路径", "说明"],
        ["运行时（构建期源）", "项目代码\\runtime\\llama\\", "打包脚本从这里复制"],
        ["运行时（交付产物）", "dist\\win-x64\\app\\resources\\runtime\\llama\\", "程序自动探测；无需配置路径"],
        ["模型（随包预置）", "dist\\win-x64\\userdata\\models\\HY-MT1.5-1.8B-Q4_K_M.gguf",
         "数据目录，取第一个 .gguf；不进 zip"],
        ["模型（源码调试）", "项目测试\\_runtime\\home\\models\\", "开发期 TRANSLATOR_HOME 指向此处"],
    ])
    para(doc, "自动探测顺序：运行时 = offline.serverPath → app\\resources\\runtime\\llama\\llama-server.exe → PATH；"
              "模型 = offline.modelPath → 数据目录 models\\ 下第一个 .gguf。", 10)

    # 4
    doc.add_heading("四、验证结果", level=1)
    para(doc, "4.1 运行时独立验证（不经过应用）", 11, True)
    table(doc, [
        ["项", "命令 / 接口", "结果"],
        ["启动参数", "llama-server -m <gguf> --host 127.0.0.1 --port 8081 -c 2048 -t 6 --cors-origins localhost",
         "启动成功，模型加载约 4 秒"],
        ["健康检查", "GET /health", "{\"status\":\"ok\"}"],
        ["一次翻译", "POST /v1/chat/completions（model=hy-mt）",
         "点击“保存”以继续操作。请点击链接来填写您的详细信息。 / 1211 ms / prompt 40 + completion 17 tokens"],
        ["常驻内存", "RSS", "2044 MB"],
    ])
    para(doc, "4.2 应用内验证（宿主桥 POST /v1/host/translate_text）", 11, True)
    table(doc, [
        ["分支", "engine 字段", "耗时", "译文"],
        ["联网（用户 DeepSeek API）", "Deepseek翻译api", "1078 / 2251 ms",
         "按“保存”继续。请点击链接填写您的详细信息。"],
        ["离线（关闭全部 API）", "离线模式（apiId=null）", "1127 / 1181 / 1222 ms",
         "点击“保存”以继续。请点击链接以填写您的详细信息。"],
    ])
    para(doc, "4.3 整机资源（llama-server + 宿主壳 4 个进程）", 11, True)
    table(doc, [
        ["进程", "内存", "备注"],
        ["llama-server.exe", "2044 MB", "Q4_K_M 模型 + 2048 上下文"],
        ["主进程 / GPU / 网络 / 渲染", "约 204 MB", "Electron 28.3.3"],
        ["合计", "约 2248 MB", "N-02 目标 1.5 GB（超 50%）"],
    ])

    # 5
    doc.add_heading("五、--cors-origins 实测（修正常见误解）", level=1)
    table(doc, [
        ["请求", "HTTP 状态", "Access-Control-Allow-Origin", "浏览器侧效果"],
        ["GET /health，Origin: https://evil.example", "200", "无", "非浏览器可读，浏览器拒绝"],
        ["GET /props，Origin: https://evil.example", "200", "无", "同上"],
        ["GET /props，Origin: http://127.0.0.1:5173", "200", "回显该 origin", "允许"],
        ["OPTIONS 预检，Origin: https://evil.example", "200", "无", "预检失败 → 真实请求被阻断"],
        ["OPTIONS 预检，Origin: http://127.0.0.1:5173", "200", "回显", "通过"],
    ])
    para(doc, "结论：llama.cpp 的 --cors-origins 采用“白名单外不回 ACAO”的实现，而不是返回 403。"
              "恶意网页的跨域读取仍被浏览器拦截（缺 ACAO 与预检失败），安全目标达成；"
              "但技术文档中「带 Origin: https://evil.example 请求应 403」的验收口径与本实现不符，已改为上面的实测口径。", 10)

    # 6
    doc.add_heading("六、本轮修复的缺陷", level=1)
    para(doc, "缺陷：配置里的上下文与线程数没有生效（始终 -c 4096 且无线程参数）", 11, True)
    bullet(doc, "现象：config.json 写入 contextSize=2048、threads=6，llama-server 命令行仍是 -c 4096 且无 -t。")
    bullet(doc, "根因：LlamaServerManager 在 TranslatorEngine 构造函数中创建，此时 store.load() 尚未执行，"
                "拿到的是默认 offline 配置；updateConfig 只挂在 store 的 change 事件上，冷启动不会触发。")
    bullet(doc, "修复：init() 中 store.load() 之后立即调用 llama.updateConfig(store.raw().offline) 与 "
                "loop.setInterval(store.raw().capture.intervalMs)；status() 暴露 contextSize / threads。")
    code(doc, "// src/core/index.js  init()\n"
              "const raw = this.store.raw();\n"
              "this.llama.updateConfig(raw.offline);\n"
              "this.loop.setInterval(raw.capture.intervalMs);")
    bullet(doc, "回归：新增 项目测试/unit/llama-config.test.js（2 用例）守住“配置必须在 init 后同步”；"
                "全量 16 个测试文件全部通过。")
    bullet(doc, "修复后实测：命令行含 -c 2048 -t 6，/props 的 n_ctx=2048，离线翻译 1181 ms。")

    # 7
    doc.add_heading("七、使用与排障", level=1)
    para(doc, "7.1 用户侧三步", 11, True)
    bullet(doc, "① 确认 dist\\win-x64\\userdata\\models\\ 下有 .gguf（本版本已预置 Q4_K_M）。")
    bullet(doc, "② 双击 桌面翻译助手.exe；浮窗引擎标识显示「离线模式」即已就绪（首次加载 1–4 秒）。")
    bullet(doc, "③ 断网后框选一段英文验证；如需切换模型：浮窗 ⚙ →「离线模型」→ 选择文件 → 启动。")
    para(doc, "7.2 排障表", 11, True)
    table(doc, [
        ["现象", "检查", "处理"],
        ["浮窗显示「离线模型未安装」", "userdata\\models\\ 是否为空；文件名是否 .gguf",
         "放入模型文件；或在设置页手动选择"],
        ["设置页显示「未找到 llama-server」", "app\\resources\\runtime\\llama\\llama-server.exe 是否存在",
         "重新解压发布包；或在设置页填写绝对路径"],
        ["端口 8081 被占用", "netstat -ano | findstr 8081", "设置页改端口（需与 offline.port 一致）"],
        ["加载很慢 / 内存吃紧", "任务管理器看 llama-server RSS", "关掉 PyCharm 等大程序；换 2-bit 模型；调小 contextSize"],
        ["联网分支一直失败", "设置页「测试连接」", "检查 BaseURL/模型名/Key；离线分支不受影响"],
    ])

    # 8
    doc.add_heading("八、已知差距与可选优化", level=1)
    table(doc, [
        ["项", "现状", "可选方案"],
        ["N-02 内存 ≤1.5 GB", "实测 2248 MB（Q4_K_M + 2048 上下文）",
         "换 2-bit GGUF（约 574 MB，llama-server 常驻可降到 ~1.2 GB）；代价是精度略降。"
         "1.25-bit 需自定义 STQ kernel，本版本不使用"],
        ["推理速度", "14 词英文 1.1–1.2 秒（6 线程 CPU）", "核显 496 MB 太小，GPU 卸载收益有限；"
                                              "可把线程数调到 8 再测"],
        ["首启下载", "本版本随包预置模型", "若改为在线分发：下载 + SHA256 校验 + 断点续传（M5-T4 原方案）"],
        ["多显示器 / 高分屏", "浮窗坐标已按显示器 bounds 换算", "未在双屏环境实测"],
    ])

    # 9
    doc.add_heading("九、变更记录", level=1)
    table(doc, [
        ["文件", "改动"],
        ["项目代码/src/core/index.js", "init() 中同步 llama 配置与轮询间隔"],
        ["项目代码/src/core/llama/server.js", "status() 增加 contextSize / threads"],
        ["项目代码/scripts/package-win.js", "复制 runtime/ 到 app/resources；zip 只含 exe + app + 使用说明"],
        ["项目代码/runtime/llama/", "新增 llama.cpp b12000 运行时（52 文件）"],
        ["项目测试/unit/llama-config.test.js", "新增 2 个用例"],
        ["项目代码/AGENTS.md", "版本基线 + 5 条陷阱 + 偏离表更新"],
        ["项目代码/README.md", "新增「离线翻译（已内置）」章节与 runtime/ 目录说明"],
    ])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("written:", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    build()
