# -*- coding: utf-8 -*-
"""生成多种预处理变体（锐化/自动对比度/灰度/放大），用于挑选 OCR 集成方案。

用法：python gen-sharpen-variants.py
"""

import os

from PIL import Image, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ui-hint-14px.png")


def main():
    base = Image.open(SRC).convert("RGB")
    variants = {
        "v-sharp.png": base.filter(ImageFilter.UnsharpMask(radius=1.2, percent=160, threshold=0)),
        "v-sharp2x.png": base.resize((base.width * 2, base.height * 2), Image.LANCZOS)
        .filter(ImageFilter.UnsharpMask(radius=2.0, percent=180, threshold=0)),
        "v-autocontrast.png": ImageOps.autocontrast(base, cutoff=1),
        "v-gray-sharp.png": ImageOps.autocontrast(base.convert("L"), cutoff=1).convert("RGB")
        .filter(ImageFilter.UnsharpMask(radius=1.2, percent=150, threshold=0)),
        "v-x25.png": base.resize((int(base.width * 2.5), int(base.height * 2.5)), Image.LANCZOS),
        "v-x4.png": base.resize((base.width * 4, base.height * 4), Image.LANCZOS),
    }
    for name, img in variants.items():
        path = os.path.join(HERE, name)
        img.save(path)
        print("saved:", name, img.size, os.path.getsize(path))


if __name__ == "__main__":
    main()
