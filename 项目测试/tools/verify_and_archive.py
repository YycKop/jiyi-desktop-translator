#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验报告结构，并把 _dl 下的辅助脚本归档到 项目测试/tools/offline/。"""
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DOCX = os.path.join(ROOT, "开发文档", "桌面翻译助手 离线模型部署与验证报告.docx")

from docx import Document  # noqa: E402

doc = Document(DOCX)
heads = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading")]
print("size:", os.path.getsize(DOCX))
print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables))
print("headings(%d):" % len(heads))
for h in heads:
    print("  -", h)

# 归档
src = os.path.join(ROOT, "_dl")
dst = os.path.join(ROOT, "项目测试", "tools", "offline")
os.makedirs(dst, exist_ok=True)
keep = ["patch-offline-config.js", "toggle-apis.js", "verify-app.js",
        "test-llama.ps1", "probe-cors.ps1", "probe-ctx.js", "inspect.js", "inspect2.js"]
moved = []
for name in keep:
    s = os.path.join(src, name)
    if os.path.exists(s):
        shutil.copy2(s, os.path.join(dst, name))
        moved.append(name)
print("archived:", moved)

# 删除下载残留（逐文件，声明路径）
removed = []
for name in ["llama-cpu.zip", "hf2bit.log", "llama-cpu.log"]:
    p = os.path.join(src, name)
    if os.path.exists(p):
        os.remove(p)
        removed.append((name, p))
print("removed:", [n for n, _ in removed])
left = os.listdir(src) if os.path.isdir(src) else []
print("left in _dl:", left)
