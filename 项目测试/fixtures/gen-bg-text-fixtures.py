# -*- coding: utf-8 -*-
"""生成「文字叠在照片背景上」的合成图，用来复现"有背景图就识别不到"和中文标点错乱。"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BG = os.path.join(HERE, 'bg-photo.png')
FONT = r'C:\Windows\Fonts\msyh.ttc'

LINES = [
    '请点击保存按钮，然后继续。',
    '如果没有响应，请稍后再试；也可以联系客服！',
    '小提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
]


def draw_lines(draw, lines, font, fill, xy, spacing=12):
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += font.size + spacing


def build(name, text_color, panel_alpha=None, font_size=20, size=(760, 260)):
    base = Image.open(BG).convert('RGB').resize(size, Image.LANCZOS).convert('RGBA')
    if panel_alpha is not None:
        overlay = Image.new('RGBA', size, (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        odraw.rounded_rectangle([16, 16, size[0] - 16, size[1] - 16], radius=12,
                                fill=(255, 255, 255, panel_alpha))
        base = Image.alpha_composite(base, overlay)
    draw = ImageDraw.Draw(base)
    font = ImageFont.truetype(FONT, font_size)
    draw_lines(draw, LINES, font, text_color, (40, 34))
    out = base.convert('RGB')
    path = os.path.join(HERE, name)
    out.save(path)
    return path


def main():
    made = [
        # 1) 白字直接压在照片上（无面板）
        build('bg-white-20px.png', (255, 255, 255), panel_alpha=None, font_size=20),
        # 2) 深色字 + 70% 白色面板（常见弹窗）
        build('bg-panel-20px.png', (28, 32, 40), panel_alpha=178, font_size=20),
        # 3) 低对比浅灰字压在照片上（模拟半透明浮层里的提示行）
        build('bg-gray-20px.png', (205, 210, 220), panel_alpha=None, font_size=20),
        # 4) 小字 + 低对比（最难的组合）
        build('bg-gray-15px.png', (198, 204, 214), panel_alpha=None, font_size=15, size=(700, 200)),
    ]
    for p in made:
        print('saved', os.path.basename(p), os.path.getsize(p), 'bytes')


if __name__ == '__main__':
    main()
