#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《桌面翻译助手 分发与合规说明.docx》"""
import os
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

OUT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "开发文档",
    "桌面翻译助手 分发与合规说明.docx"))


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

    h = doc.add_heading("桌面翻译助手 分发与合规说明", level=0)
    h.alignment = 1
    para(doc, "把 V1 打包成可分享给别人（含离线翻译）的分发包：需要剥离什么、补什么、遵守什么", 12, True)
    para(doc, "版本：1.0.0    日期：2026-10-30    适用范围：dist 发布包 / 项目代码 scripts")
    para(doc, "对应问题：「目前这个版本可以直接分享给别人使用吗，包含离线模型支持离线翻译」")

    # 1
    doc.add_heading("一、结论", level=1)
    table(doc, [
        ["问题", "结论", "说明"],
        ["当前 dist\\win-x64 能直接发给别人吗", "不能", "里面带着开发机的 API 条目与密钥密文、屏幕坐标、日志、"
                                                "7.8 MB Chromium 配置、safe-mode 标记；而且模型在 userdata 里，"
                                                "zip 里没有"],
        ["执行发布流程后能吗", "能", "dist\\release\\桌面翻译助手-1.0.0-portable（1.36 GB，含模型）"
                                "与对应 zip；已剥离全部本机数据并补齐许可/说明文件"],
        ["离线翻译是否开箱即用", "是", "模型随包放在 app\\resources\\models\\，首次启动自动加载，"
                                 "无需联网、无需手动选模型"],
        ["需要对方做什么", "解压 + 允许 SmartScreen", "未签名程序的常规提示；无需安装、无需管理员权限"],
    ])

    # 2
    doc.add_heading("二、为什么不能直接分享开发机上的文件夹", level=1)
    para(doc, "用 项目测试/tools/inspect-distribution.py 对 dist\\win-x64\\userdata 做了检查，发现以下内容"
              "不能对外：", 10)
    table(doc, [
        ["内容", "位置", "风险"],
        ["API 条目 + 密钥密文 + 盐", "config.json 的 apis[] 与 secrets.items{}",
         "密文由本机 MachineGuid 派生，换机解不开，但仍属于凭据材料，绝不能外发"],
        ["屏幕框选坐标", "config.json 的 capture.lastSelection（如 802,440,415×53）",
         "暴露开发机屏幕分辨率与使用位置，无意义且不专业"],
        ["首次引导标记", "config.json 的 onboarded=true",
         "对方看不到欢迎引导，会以为程序坏了"],
        ["日志", "userdata\\logs\\app.log、llama-server.log、core.log、launcher.log",
         "含本机绝对路径、端口、运行历史"],
        ["宿主桥令牌", "userdata\\bridge.json", "含本次启动的一次性令牌与端口"],
        ["Chromium 配置", "userdata\\electron-userdata（7.8 MB）", "缓存/会话数据，体积与隐私双重问题"],
        ["兼容模式标记", "userdata\\safe-mode.flag", "本机专用（无 --no-sandbox 必崩），会让对方一开始就跑兼容模式"],
    ])

    # 3
    doc.add_heading("三、发布包做了什么", level=1)
    para(doc, "新增脚本 项目代码/scripts/package-release.js（零依赖），从 dist\\win-x64 复制运行时，"
              "并按下面的规则改造：", 10)
    table(doc, [
        ["动作", "内容"],
        ["剥离", "整个 userdata\\（配置、日志、密钥、Chromium 配置、safe-mode 标记、bridge.json）、"
               "app\\resources\\tmp\\、根目录 *.log/*.bak/*.flag"],
        ["重建", "空的 userdata\\models\\（用户自己放模型的位置），首次运行由程序生成默认配置（onboarded=false）"],
        ["内置模型", "可选（默认包含）：把 GGUF 复制到 app\\resources\\models\\；程序优先读数据目录，"
                 "读不到再读内置目录（src/core/llama/server.js 的 resolveModel）"],
        ["许可文件", "NOTICE.txt（腾讯 HY 许可要求的 Notice 原文）、licenses\\Tencent-HY-Community-License.txt、"
                 "licenses\\llama.cpp-LICENSE.txt、licenses\\第三方组件与许可.txt"],
        ["说明文件", "首次使用说明.txt（运行条件、SmartScreen、快捷键、离线说明、卸载方式）"],
        ["压缩", "Compress-Archive（Fastest 级）；含模型包与不含模型包分开命名"],
    ])
    table(doc, [
        ["产物", "体积", "适用场景"],
        ["dist\\release\\桌面翻译助手-1.0.0-portable\\", "1.36 GB", "直接拷 U 盘/网盘目录"],
        ["dist\\桌面翻译助手-1.0.0-portable-win-x64.zip", "约 1.2 GB（1,260,603,675 B）",
         "含离线模型，发给需要离线翻译的人"],
        ["dist\\桌面翻译助手-1.0.0-portable-win-x64-nomodel.zip", "约 140 MB（146,877,270 B）",
         "只用联网 API 的人，让对方自己配 Key"],
    ])

    # 4
    doc.add_heading("四、接收方需要什么", level=1)
    table(doc, [
        ["项", "要求", "说明"],
        ["系统", "Windows 10 64 位 1809+ / Windows 11", "Electron 28 的最低要求"],
        ["内存", "8 GB 起（推荐 16 GB）", "离线模型常驻约 2.0–2.4 GB"],
        ["磁盘", "1.4 GB（含模型）/ 312 MB（不含）", "解压后占用"],
        ["权限", "普通用户即可", "不写注册表、不装服务；数据都在程序目录 userdata\\"],
        ["网络", "可选", "不配 API 也能用离线翻译；配了则优先联网、失败降级离线"],
        ["首次拦截", "SmartScreen「已保护你的电脑」", "点「更多信息」→「仍要运行」；因为未购买代码签名证书"],
    ])

    # 5
    doc.add_heading("五、许可与合规（必须随包一起给）", level=1)
    table(doc, [
        ["组件", "许可", "分发义务"],
        ["桌面翻译助手（自研）", "项目自有", "无"],
        ["Electron 28.3.3", "MIT", "随附 LICENSE（已在 app\\LICENSE）"],
        ["Chromium", "BSD-3-Clause 等", "随附 LICENSES.chromium.html（已在 app\\ 下，9 MB）"],
        ["Node.js 18（内置）", "MIT", "同上"],
        ["llama.cpp b12000", "MIT（Copyright © 2023-2024 The ggml authors）",
         "随附 licenses\\llama.cpp-LICENSE.txt"],
        ["LLVM OpenMP runtime", "Apache-2.0 WITH LLVM-exception", "已随二进制带 LICENSE-LLVM-OpenMP"],
        ["HY-MT1.5-1.8B 模型", "Tencent HY Community License", "见下方清单"],
    ])
    para(doc, "腾讯 HY 社区许可的四条硬性义务：", 11, True)
    bullet(doc, "① 随附许可副本（licenses\\Tencent-HY-Community-License.txt，16 KB 原文）；")
    bullet(doc, "② 随附指定文字的 Notice 文件（NOTICE.txt），原文如下：")
    code(doc, "Tencent HY is licensed under the Tencent HY Community License Agreement,\n"
              "Copyright (c) 2025 Tencent. All Rights Reserved.\n"
              "The trademark rights of \"Tencent HY\" are owned by Tencent or its affiliate.")
    bullet(doc, "③ 地域限制 —— 只能在 Territory 内使用与分发，Territory 明确排除欧盟、英国、韩国；")
    bullet(doc, "④ 不得暗示腾讯与本软件存在关联、赞助或背书；月活超 1 亿需另行向腾讯申请许可；"
                "不得用模型输出训练/改进其它 AI 模型。")
    para(doc, "另外：模型文件本项目原样分发未做修改（来源 ModelScope Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF，"
              "sha256 4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7）。"
              "NOTICE.txt 末尾留了「分发者」空行，转手前请填上自己的名字/组织。", 10)

    # 6
    doc.add_heading("六、验证记录（把发布包当“别人的机器”跑）", level=1)
    para(doc, "验证脚本 项目测试/tools/verify-release.js：把发布包整目录复制到另一个路径，"
              "删掉 bridge.json/config.json，用真实 exe 启动，走宿主桥调用翻译。实测输出：", 10)
    table(doc, [
        ["检查项", "结果"],
        ["首次运行配置", "onboarded=false（会走欢迎引导）、apis=0、secrets.items=0（无任何凭据残留）"],
        ["运行时自动探测", "binaryPath=…\\app\\resources\\runtime\\llama\\llama-server.exe"],
        ["模型自动探测", "modelPath=…\\app\\resources\\models\\HY-MT1.5-1.8B-Q4_K_M.gguf（内置目录命中）"],
        ["离线模型自动启动", "running=true，pid 已分配，无需用户操作"],
        ["首次翻译（含等模型就绪）", "1859 ms，engine=离线模式，译文「请点击链接以填写您的详细信息。」"],
        ["后续翻译", "788 ms（同一进程内，模型已在内存）"],
    ])

    # 7
    doc.add_heading("七、怎么生成 / 再发布", level=1)
    code(doc, "node scripts\\package-win.js              # 先构建本机便携版 dist\\win-x64\n"
              "node scripts\\package-release.js         # 生成含模型发布包 + zip\n"
              "node scripts\\package-release.js --no-model --out=..\\dist\\release-nomodel  # 轻量包\n"
              "node 项目测试\\tools\\verify-release.js <发布包目录>   # 隔离目录自检")
    para(doc, "每次改代码后必须先 package-win 再 package-release，否则发布包里是旧代码。", 10)

    # 8
    doc.add_heading("八、已知限制（分享前请如实告知对方）", level=1)
    bullet(doc, "未做代码签名：首次运行一定会有 SmartScreen 提示，企业环境可能被策略直接拦截。")
    bullet(doc, "OCR 依赖系统 OCR 语言包：本机只有 zh-Hans-CN 一个识别语言，识别其它语种（如日文）会退化；"
                "换机器后可用语言取决于对方系统。")
    bullet(doc, "内存占用偏高：Q4_K_M + 4K 上下文约 2.2–2.4 GB；想更省可在设置页把上下文改为 2048 或换 2-bit 模型。")
    bullet(doc, "无自动更新、无崩溃上报（刻意为之，符合限制书 LOG-01/LOG-03）；出问题需要对方把 userdata\\ 下的日志发回来。")
    bullet(doc, "不支持欧盟/英国/韩国地区分发（模型许可的地域限制）。")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("written:", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    build()
