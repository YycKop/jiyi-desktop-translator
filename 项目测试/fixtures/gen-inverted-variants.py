# -*- coding: utf-8 -*-
"""生成"反色版"对照图，验证反色是否提升暗底浅字的中文识别率。

用法：python gen-inverted-variants.py
输出：ui-hint-14px-inv.png / ui-hint-16px-inv.png
"""

import os

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    for name in ("ui-hint-14px.png", "ui-hint-16px.png"):
        src = os.path.join(HERE, name)
        if not os.path.exists(src):
            print("skip (missing):", name)
            continue
        img = Image.open(src).convert("RGB")
        out = ImageOps.invert(img)
        path = os.path.join(HERE, name.replace(".png", "-inv.png"))
        out.save(path)
        print("saved:", path, os.path.getsize(path))


if __name__ == "__main__":
    main()
