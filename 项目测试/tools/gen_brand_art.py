"""生成「即译」标题栏艺术字（用户选定 A 糖果贴纸）。

输出 4 倍超采样的透明 PNG，供设置页/引导页标题栏按 CSS 高度缩放显示。
"""
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter

FONT = r"C:\Windows\Fonts\simhei.ttf"
TEXT = "即译"
TARGET_H = 104  # 显示高度 26px 的 4 倍
SS = 8          # 超采样倍数（相对显示尺寸）

OUT = r"D:\桌面翻译助手\项目代码\assets\brand.png"
PREVIEW = r"D:\桌面翻译助手\项目测试\reports\arttext\brand-preview.png"


def gradient(size, c1, c2):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img


def build():
    f = ImageFont.truetype(FONT, 132 * SS)
    probe = Image.new("L", (10, 10))
    box = ImageDraw.Draw(probe).textbbox((0, 0), TEXT, font=f)
    pad = 40 * SS
    size = (box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2)
    pos = (pad - box[0], pad - box[1])

    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).text(pos, TEXT, font=f, fill=255)

    # 白描边：约 5% 字高（小尺寸下再粗就吃掉字芯）
    stroke_w = 6 * SS
    stroke = Image.new("L", size, 0)
    ImageDraw.Draw(stroke).text(
        pos, TEXT, font=f, fill=255, stroke_width=stroke_w, stroke_fill=255
    )

    layers = []

    # 柔和投影：只偏移一点点，避免小尺寸下出现明显黑边
    sh_mask = Image.new("L", size, 0)
    sh_mask.paste(stroke, (0, 4 * SS))
    shadow = Image.new("RGBA", size, (28, 36, 84, 150))
    shadow.putalpha(sh_mask.filter(ImageFilter.GaussianBlur(2.4 * SS)))
    layers.append(shadow)

    # 白色描边层
    white = Image.new("RGBA", size, (255, 255, 255, 255))
    white.putalpha(stroke)
    layers.append(white)

    # 渐变填充：按字的包围盒铺满色域（否则只取到过渡色，看起来发白）
    bb = mask.getbbox()
    grad = gradient((bb[2] - bb[0], bb[3] - bb[1]), (255, 74, 140), (86, 118, 255))
    grad = grad.convert("RGBA")
    grad.putalpha(mask.crop(bb))
    fill = Image.new("RGBA", size, (0, 0, 0, 0))
    fill.paste(grad, (bb[0], bb[1]))
    layers.append(fill)

    # 顶部一道很淡的高光
    hi = Image.new("L", size, 0)
    hi_draw = ImageDraw.Draw(hi)
    hi_draw.rectangle(
        [0, 0, size[0], bb[1] + int((bb[3] - bb[1]) * 0.36)], fill=255
    )
    hi = hi.filter(ImageFilter.GaussianBlur(3 * SS))
    hi = Image.eval(hi, lambda v: int(v * 0.22))
    # 关键：高光必须只落在字身上，否则会在大片透明区留下一条灰色横带
    hi = ImageChops.multiply(hi, mask)
    hi_layer = Image.new("RGBA", size, (255, 255, 255, 255))
    hi_layer.putalpha(hi)
    layers.append(hi_layer)

    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    for layer in layers:
        canvas = Image.alpha_composite(canvas, layer)

    # 裁到内容边界，再缩到目标高度
    content = canvas.crop(canvas.getbbox())
    scale = TARGET_H / content.height
    art = content.resize(
        (max(1, int(round(content.width * scale))), TARGET_H), Image.LANCZOS
    )
    art.save(OUT)
    print("saved", OUT, art.size)

    # 预览：浅色/深色底各一行，右侧给出 22px / 24px 实际尺寸的 3 倍放大
    pad_x, pad_y = 16, 14
    row_h = TARGET_H + pad_y * 2
    pw = 24 + 160 + 24 + art.width * 3 + 20
    preview = Image.new("RGB", (pw, row_h * 2), (255, 255, 255))
    dr = ImageDraw.Draw(preview)
    dr.rectangle([0, row_h, pw, row_h * 2], fill=(26, 30, 40))
    for i, bgc in enumerate([(255, 255, 255), (26, 30, 40)]):
        preview.paste(art, (24, i * row_h + pad_y), art)
        big = art.resize((art.width * 3, art.height * 3), Image.NEAREST)
        preview.paste(big, (200, i * row_h + pad_y - 10), big)
    preview.save(PREVIEW)
    print("saved", PREVIEW, preview.size)


if __name__ == "__main__":
    build()
