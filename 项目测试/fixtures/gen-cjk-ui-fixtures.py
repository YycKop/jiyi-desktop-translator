# -*- coding: utf-8 -*-
"""生成"设置页提示文字"风格的合成图，用于复现小字号中文 OCR 误识。

用户反馈的原句（14px、暗底浅字、设置页「外观」里的说明文字）：
  「自动」= 深底浅字 / 浅底深字，点「跟随背景」可恢复
误识现象：动→目、文→（丢失）、景→昱

用法：python gen-cjk-ui-fixtures.py
输出：本目录下 ui-hint-14px.png / ui-hint-16px.png / ui-hint-light.png
"""

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

TEXT_LINES = [
    "「自动」= 深底浅字 / 浅底深字，",
    "点「跟随背景」可恢复",
]


def load_font(size):
    candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyh.ttf",
        r"C:\Windows\Fonts\simhei.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise RuntimeError("找不到中文字体（msyh.ttc / simhei.ttf）")


def render(path, fg, bg, size, width=460, height=110, x=16, y=28):
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    font = load_font(size)
    for i, line in enumerate(TEXT_LINES):
        draw.text((x, y + i * (size + 8)), line, font=font, fill=fg)
    img.save(path)
    print("saved:", path, "size:", os.path.getsize(path), "font:", size, "fg:", fg, "bg:", bg)


def main():
    # 与设置页 .hint 一致的配色（暗底浅字）
    render(os.path.join(HERE, "ui-hint-14px.png"), (0x8A, 0x93, 0xA3), (0x1A, 0x10, 0x16), 14)
    render(os.path.join(HERE, "ui-hint-16px.png"), (0x8A, 0x93, 0xA3), (0x1A, 0x10, 0x16), 16)
    # 浅底深字（同一段文字，验证相反极性）
    render(os.path.join(HERE, "ui-hint-light.png"), (0x60, 0x6A, 0x7B), (0xF4, 0xF6, 0xFB), 14)


if __name__ == "__main__":
    main()
