"""生成二次元风格图标（无第三方绘图依赖，仅 Pillow）。

设计要点（为什么这样做）：
- 32px 任务栏/托盘尺寸下细节会糊，所以只用**大色块 + 高对比**：紫粉渐变底、深发、亮眼、腮红。
- 底做成圆角方块并留透明边，Windows 任务栏/开始菜单按此形状显示，不会出现方形白角。
- 主体是 Q 版角色（大头小身），眼型大、有高光，属于典型二次元脸；配色避开纯黑纯白以便在深色/浅色任务栏都可见。
"""
from PIL import Image, ImageDraw, ImageFilter

OUT = r'D:\桌面翻译助手\项目代码\assets'
S = 1024          # 先大后缩，边缘更干净
PAD = 26          # 透明外边距

HAIR = (58, 40, 110, 255)
HAIR_HI = (122, 96, 214, 255)
SKIN = (255, 233, 221, 255)
SKIN_SHADE = (243, 205, 192, 255)
EYE_DARK = (34, 28, 64, 255)
IRIS_TOP = (128, 214, 255, 255)
IRIS_BOTTOM = (86, 106, 240, 255)
BLUSH = (255, 138, 168, 150)
MOUTH = (146, 62, 86, 255)
COLLAR = (255, 255, 255, 255)
RIBBON = (255, 120, 172, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def gradient_bg(size, c1, c2):
    """对角渐变（左上→右下）。"""
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * size)
            px[x, y] = lerp(c1, c2, t)
    return img


def squircle_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def ellipse(draw, box, fill):
    draw.ellipse(box, fill=fill)


def draw_eye(img, cx, cy, w, h):
    """二次元大眼：整只眼填虹膜渐变 + 深色描边 + 两处高光 + 上睫毛。"""
    eye = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)

    iris = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = iris.load()
    for y in range(h):
        col = lerp(IRIS_TOP, IRIS_BOTTOM, y / max(1, h - 1))
        for x in range(w):
            px[x, y] = col
    eye.paste(iris, (0, 0), mask)

    ed = ImageDraw.Draw(eye)
    shade = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse([-w * 0.1, -h * 0.55, w * 1.1, h * 0.42], fill=(24, 20, 52, 150))
    eye.paste(shade, (0, 0), mask)
    ed.ellipse([1, 1, w - 2, h - 2], outline=EYE_DARK, width=max(3, int(w * 0.07)))
    gw = int(w * 0.34)
    ed.ellipse([int(w * 0.16), int(h * 0.16), int(w * 0.16) + gw, int(h * 0.16) + gw], fill=(255, 255, 255, 246))
    sw = int(w * 0.16)
    ed.ellipse([int(w * 0.56), int(h * 0.58), int(w * 0.56) + sw, int(h * 0.58) + sw], fill=(255, 255, 255, 210))
    ed.arc([-w * 0.02, -h * 0.10, w * 1.02, h * 0.62], start=185, end=355, fill=EYE_DARK, width=max(4, int(h * 0.10)))
    img.alpha_composite(eye, (cx - w // 2, cy - h // 2))

def build(size_out, simple=False):
    W = S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    bg = gradient_bg(W - PAD * 2, (124, 92, 255, 255), (255, 122, 178, 255))
    mask = squircle_mask(W - PAD * 2, int((W - PAD * 2) * 0.26))
    base = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    base.paste(bg, (PAD, PAD), mask)
    img.alpha_composite(base)

    d = ImageDraw.Draw(img)
    cx = W // 2
    # 身体：只露底部一条肩线，不要大面积白色（会像"胡子"）
    d.ellipse([cx - 250, int(W * 0.86), cx + 250, int(W * 1.18)], fill=(252, 252, 255, 255))
    d.ellipse([cx - 96, int(W * 0.88), cx + 96, int(W * 1.06)], fill=RIBBON)

    # 后发：覆盖头部两侧并垂到底部
    d.rounded_rectangle([cx - 250, int(W * 0.15), cx + 250, int(W * 0.99)],
                        radius=int(W * 0.20), fill=HAIR)
    # 脸（圆一点，Q 版）
    d.ellipse([cx - 196, int(W * 0.21), cx + 196, int(W * 0.82)], fill=SKIN)
    # 刘海：上方发帽 + 底部用一排叠圆做柔和波浪（不用尖三角，避免"锯齿露皮肤"）
    d.chord([cx - 208, int(W * 0.13), cx + 208, int(W * 0.60)], start=180, end=360, fill=HAIR)
    for dx in (-168, -104, -40, 24, 88, 152):
        r = 54
        d.ellipse([cx + dx - r, int(W * 0.36), cx + dx + r, int(W * 0.36) + 2 * r], fill=HAIR)
    # 两撮挑起的碎发（只到眉毛上方，不遮眼）
    d.polygon([(cx - 150, int(W * 0.40)), (cx - 96, int(W * 0.36)), (cx - 72, int(W * 0.50))], fill=HAIR)
    d.polygon([(cx + 150, int(W * 0.40)), (cx + 96, int(W * 0.36)), (cx + 72, int(W * 0.50))], fill=HAIR)
    # 两侧鬓发（垂到下巴下方）
    d.polygon([(cx - 214, int(W * 0.30)), (cx - 150, int(W * 0.28)), (cx - 168, int(W * 0.86)), (cx - 232, int(W * 0.80))], fill=HAIR)
    d.polygon([(cx + 214, int(W * 0.30)), (cx + 150, int(W * 0.28)), (cx + 168, int(W * 0.86)), (cx + 232, int(W * 0.80))], fill=HAIR)
    # 发丝高光：一条弧形亮带（不是圆坨）
    hi = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.arc([cx - 168, int(W * 0.17), cx + 168, int(W * 0.54)], start=205, end=335, fill=HAIR_HI, width=26)
    img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(6)))

    # 眼睛
    if not simple:
        draw_eye(img, cx - 88, int(W * 0.535), 132, 150)
        draw_eye(img, cx + 88, int(W * 0.535), 132, 150)
    else:
        for ex in (cx - 88, cx + 88):
            d.ellipse([ex - 54, int(W * 0.48), ex + 54, int(W * 0.60)], fill=EYE_DARK)
            d.ellipse([ex - 30, int(W * 0.492), ex - 2, int(W * 0.525)], fill=(255, 255, 255, 245))

    # 腮红
    bx = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bx)
    bd.ellipse([cx - 168, int(W * 0.585), cx - 96, int(W * 0.63)], fill=BLUSH)
    bd.ellipse([cx + 96, int(W * 0.585), cx + 168, int(W * 0.63)], fill=BLUSH)
    img.alpha_composite(bx.filter(ImageFilter.GaussianBlur(11)))

    # 鼻子（一个小点）与嘴（小弧）
    d.ellipse([cx - 6, int(W * 0.607), cx + 6, int(W * 0.618)], fill=(231, 176, 166, 255))
    d.arc([cx - 22, int(W * 0.615), cx + 22, int(W * 0.655)], start=25, end=155, fill=MOUTH, width=8)

    # 一点星光点缀
    for (sx, sy, r) in [(W * 0.80, W * 0.19, 13), (W * 0.19, W * 0.79, 9)]:
        d.ellipse([sx - r, sy - r * 3, sx + r, sy + r * 3], fill=(255, 255, 255, 200))
        d.ellipse([sx - r * 3, sy - r, sx + r * 3, sy + r], fill=(255, 255, 255, 200))

    final_mask = squircle_mask(W, int(W * 0.26))
    out_img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out_img.paste(img, (0, 0), final_mask)
    out_img = out_img.crop((PAD - 6, PAD - 6, W - PAD + 6, W - PAD + 6))
    return out_img.resize((size_out, size_out), Image.LANCZOS)


def main():
    big = build(512)
    big.save(rf'{OUT}\icon-anime.png')
    for size, name in [(256, 'app.png'), (64, 'app-64.png'), (32, 'app-32.png'), (16, 'app-16.png')]:
        build(size).save(rf'{OUT}\{name}')
    # 托盘：32/64，用简化眼型保证小尺寸可辨
    build(32, simple=True).save(rf'{OUT}\tray.png')
    build(64, simple=True).save(rf'{OUT}\tray@2x.png')
    # 多尺寸 ico（Windows 会按 DPI 选）
    big.save(rf'{OUT}\app.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('icons written')


if __name__ == '__main__':
    main()
