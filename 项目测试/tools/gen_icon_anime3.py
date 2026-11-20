"""二次元风格图标 v3：极简 Q 版脸，专为 16–32px 可辨性优化。

取舍：
- 眼大（占脸宽 1/4 以上）、位置偏下，是 Q 版最关键的识别特征；小图里只有眼睛和嘴能看清。
- 头发用「圆角帽子 + 两侧圆角长发」，没有碎发/挑染，避免缩小时变成噪点。
- 去掉所有闭合描边（会读成眼镜/面罩），只用色块对比与一处高光。
"""
from PIL import Image, ImageDraw, ImageFilter

OUT = r'D:\桌面翻译助手\项目代码\assets'
S = 1024
PAD = 24

HAIR = (58, 40, 108, 255)
HAIR_HI = (122, 96, 214, 255)
SKIN = (255, 233, 222, 255)
IRIS_TOP = (134, 214, 255, 255)
IRIS_BOTTOM = (72, 90, 232, 255)
LASH = (38, 28, 64, 255)
BLUSH = (255, 132, 164, 170)
MOUTH = (152, 66, 90, 255)
BOW = (255, 116, 174, 255)
WHITE = (253, 253, 255, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def grad(size, c1, c2):
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = lerp(c1, c2, (x * 0.5 + y * 0.5) / size)
    return img


def squircle(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def big_eye(img, cx, cy, w, h):
    e = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)
    iris = Image.new('RGBA', (w, h))
    px = iris.load()
    for y in range(h):
        col = lerp(IRIS_TOP, IRIS_BOTTOM, y / max(1, h - 1))
        for x in range(w):
            px[x, y] = col
    e.paste(iris, (0, 0), mask)
    # 眼白只留一条（二次元眼白很少），用白色底再加虹膜更简洁
    d = ImageDraw.Draw(e)
    # 上眼睑（细弧，只盖住上 35%）
    d.chord([-w * 0.04, -h * 0.10, w * 1.04, h * 0.86], start=180, end=360, fill=LASH)
    # 高光：左上大、右下小
    gw = int(w * 0.38)
    d.ellipse([int(w * 0.14), int(h * 0.24), int(w * 0.14) + gw, int(h * 0.24) + gw], fill=(255, 255, 255, 250))
    sw = int(w * 0.18)
    d.ellipse([int(w * 0.52), int(h * 0.62), int(w * 0.52) + sw, int(h * 0.62) + sw], fill=(255, 255, 255, 210))
    img.alpha_composite(e, (cx - w // 2, cy - h // 2))


def build(size_out, simple=False):
    W = S
    cx = W // 2
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    bg = grad(W - PAD * 2, (124, 94, 255, 255), (255, 126, 182, 255))
    base = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    base.paste(bg, (PAD, PAD), squircle(W - PAD * 2, int((W - PAD * 2) * 0.26)))
    img.alpha_composite(base)
    d = ImageDraw.Draw(img)

    # 肩膀（浅色横带，只要一点点）
    d.ellipse([cx - 280, int(W * 0.93), cx + 280, int(W * 1.24)], fill=WHITE)
    d.ellipse([cx - 78, int(W * 0.95), cx + 78, int(W * 1.12)], fill=BOW)

    # 头发：两侧长发（圆角）+ 头顶帽
    d.rounded_rectangle([cx - 268, int(W * 0.20), cx - 150, int(W * 1.02)], radius=int(W * 0.10), fill=HAIR)
    d.rounded_rectangle([cx + 150, int(W * 0.20), cx + 268, int(W * 1.02)], radius=int(W * 0.10), fill=HAIR)
    d.rounded_rectangle([cx - 268, int(W * 0.14), cx + 268, int(W * 0.50)], radius=int(W * 0.19), fill=HAIR)

    # 脸（大而圆）
    d.ellipse([cx - 196, int(W * 0.19), cx + 196, int(W * 0.835)], fill=SKIN)
    # 刘海压在脸上：只到眉毛（0.47）
    d.rounded_rectangle([cx - 210, int(W * 0.14), cx + 210, int(W * 0.475)], radius=int(W * 0.16), fill=HAIR)
    # 刘海两侧的圆角收尾，让它不像一块方布
    d.ellipse([cx - 206, int(W * 0.375), cx - 128, int(W * 0.505)], fill=HAIR)
    d.ellipse([cx + 128, int(W * 0.375), cx + 206, int(W * 0.505)], fill=HAIR)

        # 不再加任何跨额头的亮带：在 512px 像胶带、32px 像脏点，去掉最干净。

    # 眼睛（大）
    if not simple:
        big_eye(img, cx - 96, int(W * 0.575), 148, 170)
        big_eye(img, cx + 96, int(W * 0.575), 148, 170)
    else:
        for ex in (cx - 96, cx + 96):
            d.ellipse([ex - 68, int(W * 0.495), ex + 68, int(W * 0.645)], fill=IRIS_BOTTOM)
            d.chord([ex - 70, int(W * 0.475), ex + 70, int(W * 0.585)], start=180, end=360, fill=LASH)
            d.ellipse([ex - 44, int(W * 0.515), ex - 8, int(W * 0.562)], fill=(255, 255, 255, 245))

    # 腮红
    bx = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bx)
    bd.ellipse([cx - 184, int(W * 0.655), cx - 104, int(W * 0.700)], fill=BLUSH)
    bd.ellipse([cx + 104, int(W * 0.655), cx + 184, int(W * 0.700)], fill=BLUSH)
    img.alpha_composite(bx.filter(ImageFilter.GaussianBlur(11)))

    # 嘴（小弧），位于两颊中间偏下
    d.arc([cx - 30, int(W * 0.700), cx + 30, int(W * 0.748)], start=20, end=160, fill=MOUTH, width=9)

    # 星光
    for (sx, sy, r) in [(W * 0.81, W * 0.16, 13), (W * 0.19, W * 0.80, 9)]:
        d.ellipse([sx - r, sy - r * 3, sx + r, sy + r * 3], fill=(255, 255, 255, 210))
        d.ellipse([sx - r * 3, sy - r, sx + r * 3, sy + r], fill=(255, 255, 255, 210))

    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out.paste(img, (0, 0), squircle(W, int(W * 0.26)))
    out = out.crop((PAD - 4, PAD - 4, W - PAD + 4, W - PAD + 4))
    return out.resize((size_out, size_out), Image.LANCZOS)


def main():
    big = build(512)
    big.save(rf'{OUT}\icon-anime.png')
    for size, name in [(256, 'app.png'), (64, 'app-64.png'), (32, 'app-32.png'), (16, 'app-16.png')]:
        build(size).save(rf'{OUT}\{name}')
    build(32, simple=True).save(rf'{OUT}\tray.png')
    build(64, simple=True).save(rf'{OUT}\tray@2x.png')
    big.save(rf'{OUT}\app.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    prev = Image.new('RGBA', (740, 520), (30, 32, 38, 255))
    prev.alpha_composite(build(496), (12, 12))
    prev.alpha_composite(build(64), (536, 24))
    prev.alpha_composite(build(32), (536, 104))
    prev.alpha_composite(build(16), (536, 148))
    prev.alpha_composite(build(32, simple=True), (536, 184))
    prev.alpha_composite(build(16, simple=True), (536, 228))
    prev.save(rf'{OUT}\icon-preview.png')
    print('icons written')


if __name__ == '__main__':
    main()
