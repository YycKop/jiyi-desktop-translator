# -*- coding: utf-8 -*-
"""生成「灰度 + Otsu 二值化」的 2x 变体，用来验证清晰度小字是否更吃二值化（ClearType 彩边）。"""
import os
import sys

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, '..', 'fixtures')
OUT = os.path.join(HERE, '..', '_runtime', 'binary')

TARGETS = [
    'ui-hint-14px.png',
    'small-360x90.png',
    'para-gray-14px.png',
    'para-dark-15px.png',
    'para-dark-16px.png',
    'en-480x120.png',
]


def otsu(gray):
    hist = gray.histogram()[:256]
    total = sum(hist)
    sum_all = sum(i * hist[i] for i in range(256))
    sum_b = 0.0
    w_b = 0
    best = (0.0, 127)
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best[0]:
            best = (var, t)
    return best[1]


def make(src_path, dst_path, scale=2, invert_auto=True):
    im = Image.open(src_path).convert('RGB')
    w, h = im.size
    im = im.resize((w * scale, h * scale), Image.LANCZOS)
    gray = ImageOps.grayscale(im)
    gray = ImageOps.autocontrast(gray, cutoff=1)
    t = otsu(gray)
    # 深底浅字：自动判断（取四角平均亮度），必要时反色，统一成「白底黑字」
    corners = [gray.getpixel((0, 0)), gray.getpixel((gray.width - 1, 0)),
               gray.getpixel((0, gray.height - 1)), gray.getpixel((gray.width - 1, gray.height - 1))]
    dark_bg = sum(corners) / 4 < 128
    if invert_auto and dark_bg:
        gray = ImageOps.invert(gray)
        t = 255 - t
    binary = gray.point(lambda v: 0 if v < t else 255, mode='L')
    binary.convert('RGB').save(dst_path)
    return t, dark_bg


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in TARGETS:
        src = os.path.join(FIX, name)
        if not os.path.exists(src):
            print('skip (missing):', name)
            continue
        dst = os.path.join(OUT, name.replace('.png', '-bin.png'))
        t, dark = make(src, dst)
        print('%-24s threshold=%-4d dark_bg=%-5s -> %s' % (name, t, dark, os.path.basename(dst)))


if __name__ == '__main__':
    main()
