# -*- coding: utf-8 -*-
"""生成「即译」艺术字候选样式（第十六轮需求 2：先给样式再定稿）。

6 个候选，全部用 Pillow 在 4 倍画布上绘制后降采样，输出：
  项目测试/reports/arttext/style-A.png ... style-F.png  （透明底，可直接当图标用）
  项目测试/reports/arttext/styles.png                  （对照表：左浅底右深底）

用法：python 项目测试\\tools\\gen_arttext_samples.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "项目测试", "reports", "arttext")
FONTS = r"C:\Windows\Fonts"
TEXT = "即译"
SS = 4  # supersample

FONT_SANS_BOLD = os.path.join(FONTS, "simhei.ttf")
FONT_YAHEI_BOLD = os.path.join(FONTS, "msyhbd.ttc")
FONT_KAI = os.path.join(FONTS, "simkai.ttf")
FONT_LIGHT = os.path.join(FONTS, "Dengl.ttf")


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def text_size(draw, text, f, stroke_width=0):
    box = draw.textbbox((0, 0), text, font=f, stroke_width=stroke_width)
    return box[2] - box[0], box[3] - box[1], box


def make_mask(size, pos, text, f, stroke_width=0):
    canvas = Image.new("L", size, 0)
    ImageDraw.Draw(canvas).text(pos, text, font=f, fill=255, stroke_width=stroke_width, stroke_fill=255)
    return canvas


def gradient(size, c1, c2, diagonal=True):
    w, h = size
    img = Image.new("RGB", size, c1)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = ((x / max(1, w - 1)) + (y / max(1, h - 1))) / 2 if diagonal else (y / max(1, h - 1))
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
            )
    return img


def fill_gradient(mask, c1, c2, diagonal=True):
    """用渐变填充 mask 区域，返回 RGBA。

    渐变按 mask 的包围盒铺满（整段色域都落在字上），而不是按整张画布——
    否则字只占画布一小块，取到的只是渐变两端的过渡色，看起来发灰发白。
    """
    box = mask.getbbox()
    if not box:
        return Image.new("RGBA", mask.size, (0, 0, 0, 0))
    bw, bh = box[2] - box[0], box[3] - box[1]
    g = gradient((max(1, bw), max(1, bh)), c1, c2, diagonal).convert("RGBA")
    g.putalpha(mask.crop(box))
    layer = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    layer.paste(g, (box[0], box[1]))
    return layer


def solid(mask, color):
    layer = Image.new("RGBA", mask.size, color)
    layer.putalpha(mask)
    return layer


def drop_shadow(mask, offset, blur, color):
    sh = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    shifted = Image.new("L", mask.size, 0)
    shifted.paste(mask, offset)
    sh = Image.new("RGBA", mask.size, color)
    sh.putalpha(shifted.filter(ImageFilter.GaussianBlur(blur)))
    return sh


def compose(size, layers):
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    for layer in layers:
        out.alpha_composite(layer)
    return out


def trim(img, pad):
    box = img.getbbox()
    if not box:
        return img
    l, t, r, b = box
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(img.width, r + pad), min(img.height, b + pad)
    return img.crop((l, t, r, b))


def canvas(w=560, h=300):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def put_text(canvas_img, f, text=TEXT, y_center=True, dx=0):
    d = ImageDraw.Draw(canvas_img)
    tw, th, box = text_size(d, text, f)
    x = (canvas_img.width - tw) // 2 - box[0] + dx
    y = (canvas_img.height - th) // 2 - box[1] if y_center else 0
    return (x, y), (tw, th)


# ---------------------------------------------------------------- 样式 A 糖果贴纸

def style_a():
    size = (560 * SS, 300 * SS)
    f = font(FONT_SANS_BOLD, 132 * SS)
    mask = make_mask(size, (0, 0), "", f)  # placeholder
    d = ImageDraw.Draw(mask)
    pos, _ = put_text(mask, f)
    mask = make_mask(size, pos, TEXT, f)
    stroke = make_mask(size, pos, TEXT, f, stroke_width=11 * SS)

    layers = []
    layers.append(drop_shadow(stroke, (0, 10 * SS), 9 * SS, (24, 36, 88, 135)))
    layers.append(solid(stroke, (255, 255, 255, 255)))
    layers.append(fill_gradient(mask, (255, 88, 146), (96, 116, 255)))
    # 顶部高光
    hi = Image.new("L", size, 0)
    hi_mask = mask.crop((0, 0, size[0], size[1] // 2))
    hi.paste(hi_mask, (0, 0))
    layers.append(solid(hi.filter(ImageFilter.GaussianBlur(6 * SS)), (255, 255, 255, 70)))
    return trim(compose(size, layers), 14 * SS)


# ---------------------------------------------------------------- 样式 B 3D 挤出

def style_b():
    size = (560 * SS, 300 * SS)
    f = font(FONT_YAHEI_BOLD, 132 * SS, index=0)
    tmp = Image.new("L", size, 0)
    pos, _ = put_text(tmp, f)
    mask = make_mask(size, pos, TEXT, f)
    stroke = make_mask(size, pos, TEXT, f, stroke_width=8 * SS)

    layers = []
    steps = 9
    for i in range(steps, 0, -1):
        off = (i * 2 * SS, i * 3 * SS)
        m = Image.new("L", size, 0)
        m.paste(stroke, off)
        shade = int(40 + 20 * (steps - i) / steps)
        layers.append(solid(m, (26 + shade, 40 + shade, 90 + shade, 255)))
    layers.append(solid(stroke, (255, 255, 255, 255)))
    layers.append(fill_gradient(mask, (255, 206, 84), (255, 96, 140)))
    # 顶部一道窄高光（太宽会整块冲淡成白色）
    hl = Image.new("L", size, 0)
    hl_draw = ImageDraw.Draw(hl)
    bbox = mask.getbbox()
    if bbox:
        l, t, r, b = bbox
        hl_draw.polygon(
            [(l, t + int((b - t) * 0.34)), (l, t), (r, t), (l + int((r - l) * 0.36), t + int((b - t) * 0.34))],
            fill=255,
        )
    hl = Image.composite(hl, Image.new("L", size, 0), mask)
    layers.append(solid(hl.filter(ImageFilter.GaussianBlur(2 * SS)), (255, 255, 255, 70)))
    return trim(compose(size, layers), 16 * SS)


# ---------------------------------------------------------------- 样式 C 手写马克笔

def style_c():
    size = (560 * SS, 300 * SS)
    f = font(FONT_KAI, 138 * SS)
    tmp = Image.new("L", size, 0)
    pos, _ = put_text(tmp, f)
    mask = make_mask(size, pos, TEXT, f)
    # 轻微"墨迹"抖动：模糊后阈值化，边缘变得不那么规整
    rough = mask.filter(ImageFilter.GaussianBlur(1.6 * SS)).point(lambda v: 255 if v > 96 else 0)

    layers = []
    off_mask = Image.new("L", size, 0)
    off_mask.paste(rough, (4 * SS, 3 * SS))
    layers.append(solid(off_mask, (255, 92, 138, 120)))          # 双墨叠加
    layers.append(solid(rough, (46, 26, 60, 255)))
    out = compose(size, layers)
    out = out.rotate(-3, resample=Image.BICUBIC, expand=True)
    return trim(out, 14 * SS)


# ---------------------------------------------------------------- 样式 D 霓虹描边

def style_d():
    size = (560 * SS, 300 * SS)
    f = font(FONT_SANS_BOLD, 130 * SS)
    tmp = Image.new("L", size, 0)
    pos, _ = put_text(tmp, f)
    mask = make_mask(size, pos, TEXT, f)

    layers = []
    for blur, color in ((22 * SS, (60, 220, 255, 110)), (12 * SS, (150, 90, 255, 140)), (5 * SS, (255, 255, 255, 90))):
        glow = Image.new("RGBA", size, color)
        glow.putalpha(mask.filter(ImageFilter.GaussianBlur(blur)))
        layers.append(glow)
    layers.append(solid(mask, (245, 250, 255, 255)))
    inner = mask.filter(ImageFilter.GaussianBlur(2 * SS))
    layers.append(solid(Image.eval(inner, lambda v: int(v * 0.5)), (120, 230, 255, 255)))
    return trim(compose(size, layers), 24 * SS)


# ---------------------------------------------------------------- 样式 E 波点波普

def style_e():
    size = (560 * SS, 300 * SS)
    f = font(FONT_SANS_BOLD, 130 * SS)
    tmp = Image.new("L", size, 0)
    pos, _ = put_text(tmp, f)
    mask = make_mask(size, pos, TEXT, f)
    stroke = make_mask(size, pos, TEXT, f, stroke_width=9 * SS)

    # 波点图案
    pattern = Image.new("RGBA", size, (255, 236, 120, 255))
    pd = ImageDraw.Draw(pattern)
    step = 22 * SS
    rad = 6 * SS
    for yy in range(0, size[1] + step, step):
        for xx in range(0, size[0] + step, step):
            off = step // 2 if (yy // step) % 2 else 0
            pd.ellipse([xx + off - rad, yy - rad, xx + off + rad, yy + rad], fill=(255, 105, 140, 255))
    pattern.putalpha(mask)

    layers = []
    sh = Image.new("L", size, 0)
    sh.paste(stroke, (10 * SS, 12 * SS))
    layers.append(solid(sh, (34, 34, 40, 210)))
    layers.append(solid(stroke, (28, 26, 34, 255)))
    layers.append(pattern)
    out = compose(size, layers).rotate(-6, resample=Image.BICUBIC, expand=True)
    return trim(out, 14 * SS)


# ---------------------------------------------------------------- 样式 F 极简渐变

def style_f():
    size = (700 * SS, 300 * SS)
    f = font(FONT_LIGHT, 150 * SS)
    d = ImageDraw.Draw(Image.new("L", (10, 10)))
    tw, th, box = text_size(d, TEXT, f)
    gap = 26 * SS
    total = tw + gap
    x0 = (size[0] - total) // 2
    y0 = (size[1] - th) // 2 - box[1]

    mask = Image.new("L", size, 0)
    md = ImageDraw.Draw(mask)
    md.text((x0 - box[0], y0), TEXT[0], font=f, fill=255)
    second = text_size(d, TEXT[1], f)
    md.text((x0 - box[0] + tw + gap, y0), TEXT[1], font=f, fill=255)

    layers = []
    layers.append(fill_gradient(mask, (110, 200, 255), (190, 130, 255), diagonal=False))
    return trim(compose(size, layers), 10 * SS)


STYLES = [
    ("A", "糖果贴纸", "白色粗描边 + 粉蓝渐变 + 柔和投影，最「卡通」"),
    ("B", "3D 挤出", "立体厚度 + 高光，偏游戏标题"),
    ("C", "手写马克笔", "楷体手写、轻微倾斜，亲切随性"),
    ("D", "霓虹描边", "冷色发光，适合深色主题"),
    ("E", "波点波普", "图案填充 + 黑描边 + 倾斜，活泼"),
    ("F", "极简渐变", "细体大间距，克制现代"),
]


def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    funcs = {"A": style_a, "B": style_b, "C": style_c, "D": style_d, "E": style_e, "F": style_f}
    rendered = {}
    for key, name, _desc in STYLES:
        img = funcs[key]()
        # 输出按高度 64px 归一，方便直接当 UI 素材
        scale = 64 / (img.height / SS)
        out = img.resize((max(1, int(img.width / SS * scale)), int(img.height / SS * scale)), Image.LANCZOS)
        path = os.path.join(OUT_DIR, "style-%s.png" % key)
        out.save(path)
        rendered[key] = out
        print("saved", path, out.size)

    # ---------- 对照表 ----------
    tile_w, tile_h = 640, 210
    pad = 16
    label_w = 236
    rows = len(STYLES)
    sheet_w = pad + tile_w + 12 + label_w
    sheet_h = 76 + rows * (tile_h + 12) + 8
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (255, 255, 255, 255))
    sd = ImageDraw.Draw(sheet)
    title_f = font(FONT_YAHEI_BOLD, 28, index=0)
    label_f = font(FONT_YAHEI_BOLD, 24, index=0)
    desc_f = font(FONT_YAHEI_BOLD, 16, index=0)
    sd.text((pad + 4, 20), "即译 · 艺术字候选（左＝浅色背景，右＝深色背景）", font=title_f, fill=(30, 34, 44))

    for idx, (key, name, desc) in enumerate(STYLES):
        x = pad
        y = 72 + idx * (tile_h + 12)
        half = tile_w // 2
        if key == "D":
            sd.rectangle([x, y, x + tile_w, y + tile_h], fill=(20, 24, 33, 255))
            slots = [(x, tile_w)]
        else:
            sd.rectangle([x, y, x + half, y + tile_h], fill=(246, 247, 251, 255))
            sd.rectangle([x + half, y, x + tile_w, y + tile_h], fill=(20, 24, 33, 255))
            slots = [(x, half), (x + half, half)]
        img = rendered[key]
        for ox, slot_w in slots:
            scale = min((slot_w - 52) / img.width, (tile_h - 44) / img.height, 2.2)
            art = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
            ax = ox + (slot_w - art.width) // 2
            ay = y + (tile_h - art.height) // 2
            sheet.alpha_composite(art, (ax, ay))
        sd.rectangle([x, y, x + tile_w, y + tile_h], outline=(214, 219, 230, 255), width=2)
        # 标签
        lx = x + tile_w + 16
        sd.text((lx, y + 8), key, font=label_f, fill=(43, 92, 255))
        sd.text((lx + 26, y + 8), name, font=label_f, fill=(30, 34, 44))
        for i in range(0, len(desc), 10):
            sd.text((lx, y + 46 + i // 10 * 22), desc[i:i + 10], font=desc_f, fill=(110, 118, 132))

    sheet = sheet.convert("RGB")
    path = os.path.join(OUT_DIR, "styles.png")
    sheet.save(path, quality=95)
    print("saved", path, sheet.size)


if __name__ == "__main__":
    build()
