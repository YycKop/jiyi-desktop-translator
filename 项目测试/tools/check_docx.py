# -*- coding: utf-8 -*-
import glob
import sys

import docx

path = glob.glob(r"D:\桌面翻译助手\开发文档\*第十五轮*.docx")[0]
d = docx.Document(path)
out = []
out.append(path)
for p in d.paragraphs[:10]:
    if p.text.strip():
        out.append("P: " + p.text.strip())
for i, t in enumerate(d.tables):
    out.append("T%d header=%s" % (i, " | ".join(c.text for c in t.rows[0].cells)))
out.append("paras=%d tables=%d" % (len(d.paragraphs), len(d.tables)))
data = "\n".join(out)
with open(r"D:\桌面翻译助手\项目测试\_runtime\docx-check.txt", "w", encoding="utf-8") as fh:
    fh.write(data)
print("written", len(data))
