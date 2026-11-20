# -*- coding: utf-8 -*-
"""把悬浮球截图合成到浅/深两种背景上放大预览（证明没有黑色投影）。"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "项目测试", "reports", "electron-smoke", "06-ball.png")
OUT = os.path.join(ROOT, "项目测试", "reports", "arttext", "ball-preview.png")

ball = Image.open(SRC).convert("RGBA")
scale = 3
big = ball.resize((ball.width * scale, ball.height * scale), Image.LANCZOS)

pad = 26
w = big.width * 2 + pad * 3
h = big.height + pad * 2
sheet = Image.new("RGB", (w, h), (255, 255, 255))
left = Image.new("RGB", (big.width + pad, h), (246, 247, 251))
right = Image.new("RGB", (big.width + pad, h), (20, 24, 33))
sheet.paste(left, (0, 0))
sheet.paste(right, (w - left.width, 0))
sheet.paste(big, (pad // 2 + 6, pad // 2), big)
sheet.paste(big, (w - left.width + pad // 2 + 6, pad // 2), big)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT)
print("saved", OUT, sheet.size)
