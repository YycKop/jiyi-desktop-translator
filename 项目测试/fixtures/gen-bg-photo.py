# -*- coding: utf-8 -*-
"""生成一张"照片感"的背景图，用于自检里验证外观（纯合成，无真实内容，符合 SCR-02）。

用法：python gen-bg-photo.py
输出：本目录下 bg-photo.png（1200x800 渐变 + 柔和光斑）
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "bg-photo.png")

W, H = 1200, 800


def main():
    img = Image.new("RGB", (W, H), (30, 44, 82))
    draw = ImageDraw.Draw(img)
    # 竖向渐变：深蓝 -> 紫 -> 暖橙
    for y in range(H):
        t = y / (H - 1)
        if t < 0.55:
            k = t / 0.55
            r = int(30 + (96 - 30) * k)
            g = int(44 + (58 - 44) * k)
            b = int(82 + (120 - 82) * k)
        else:
            k = (t - 0.55) / 0.45
            r = int(96 + (214 - 96) * k)
            g = int(58 + (126 - 58) * k)
            b = int(120 + (96 - 120) * k)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    blobs = Image.new("RGB", (W, H), (0, 0, 0))
    bd = ImageDraw.Draw(blobs)
    specs = [
        (300, 250, 320, (255, 214, 140)),
        (860, 200, 260, (140, 214, 255)),
        (620, 640, 380, (255, 150, 190)),
    ]
    for cx, cy, rad, color in specs:
        bd.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=color)
    blobs = blobs.filter(ImageFilter.GaussianBlur(150))
    img = Image.blend(img, blobs, 0.45)

    # 轻微暗角，模拟照片
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    for i in range(60):
        a = int(2.2 * i)
        vd.ellipse([-i * 12, -i * 12, W + i * 12, H + i * 12], outline=255 - a)
    vd.ellipse([80, 80, W - 80, H - 80], fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(60))
    dark = Image.new("RGB", (W, H), (8, 10, 18))
    img = Image.composite(img, dark, vignette)

    img.save(OUT)
    print("saved:", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
