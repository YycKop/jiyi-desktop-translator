"""生成「即译」标题字标（平面圆润风，参照用户提供的图）。

输出两套颜色：
  assets/wordmark-light.png  —— 深色标题栏用（浅色字）
  assets/wordmark-dark.png   —— 浅色标题栏用（深色字）

做法：8 倍超采样绘制 → 轻微模糊 + 阈值把笔画转角磨圆 → 缩到 4 倍显示尺寸。
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

TEXT = "即译"
TARGET_H = 96          # 显示高度 24px 的 4 倍
SS = 8                 # 超采样倍数
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\simhei.ttf",  # 黑体：笔画粗、字腔分明
    r"C:\Windows\Fonts\msyhbd.ttc",  # 微软雅黑 Bold
    r"C:\Windows\Fonts\Dengb.ttf",
]
ASSETS = r"D:\桌面翻译助手\项目代码\assets"
PREVIEW = r"D:\桌面翻译助手\项目测试\reports\arttext\wordmark-preview.png"

DARK_INK = (43, 52, 69)      # #2B3445，浅底用
LIGHT_INK = (233, 237, 245)  # #E9EDF5，深底用


def build_mask(font_path):
    f = ImageFont.truetype(font_path, 120 * SS)
    # 逐字排布：参考图两字之间的间距比默认字距略大一点
    metrics = [f.getbbox(ch) for ch in TEXT]
    widths = [b[2] - b[0] for b in metrics]
    gap = int(7 * SS)
    pad = 8 * SS
    total_w = sum(widths) + gap * (len(TEXT) - 1)
    top = min(b[1] for b in metrics)
    bottom = max(b[3] for b in metrics)
    size = (total_w + pad * 2, bottom - top + pad * 2)
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    x = pad
    for ch, box, w in zip(TEXT, metrics, widths):
        # 只补偿一点点描边：黑体本身就粗，再加粗会把字腔糊死
        draw.text(
            (x - box[0], pad - top),
            ch,
            font=f,
            fill=255,
            stroke_width=2 * SS,
            stroke_fill=255,
        )
        x += w + gap
    # 磨圆转角：模糊后二值化，笔画端点与内角都会变圆润
    mask = mask.filter(ImageFilter.GaussianBlur(1.2 * SS))
    mask = mask.point(lambda v: 255 if v >= 127 else 0)
    return mask


def tint(mask, color):
    img = Image.new("RGBA", mask.size, color + (255,))
    img.putalpha(mask)
    return img


def scale_to(img, height):
    w = max(1, int(round(img.width * height / img.height)))
    return img.resize((w, height), Image.LANCZOS)


def main():
    font_path = next(p for p in FONT_CANDIDATES if os.path.exists(p))
    mask = build_mask(font_path)
    light = tint(mask, LIGHT_INK)
    dark = tint(mask, DARK_INK)

    light_small = scale_to(light, TARGET_H)
    dark_small = scale_to(dark, TARGET_H)
    light_small.save(os.path.join(ASSETS, "wordmark-light.png"))
    dark_small.save(os.path.join(ASSETS, "wordmark-dark.png"))
    print("saved wordmark", light_small.size, "font", os.path.basename(font_path))

    # 预览：模拟标题栏（深色/浅色）+ 参考图对照
    pad = 14
    bar_h = 38 * 3
    row_h = bar_h + pad * 2
    w = light_small.width * 3 + 380
    sheet = Image.new("RGB", (w, row_h * 2 + 40), (240, 242, 246))
    dr = ImageDraw.Draw(sheet)
    small_font = ImageFont.truetype(font_path, 10 * 3)
    for i, (bg, ink_img, fg, sub) in enumerate(
        [
            ((26, 30, 40), light_small.resize((light_small.width * 3, light_small.height * 3), Image.LANCZOS), (232, 236, 243), (154, 167, 189)),
            ((247, 248, 250), dark_small.resize((dark_small.width * 3, dark_small.height * 3), Image.LANCZOS), (43, 52, 69), (120, 130, 148)),
        ]
    ):
        y0 = 20 + i * row_h
        dr.rectangle([0, y0, w, y0 + bar_h], fill=bg)
        sheet.paste(ink_img, (24, y0 + (bar_h - ink_img.height) // 2), ink_img)
        dr.text((24 + ink_img.width + 12, y0 + bar_h // 2 - 8), "即时翻译，沟通无界", font=small_font, fill=sub)
        dr.text((w - 150, y0 + bar_h // 2 - 8), "v1     —     ✕", font=small_font, fill=fg)
    sheet.save(PREVIEW)
    print("saved", PREVIEW, sheet.size)


if __name__ == "__main__":
    main()
