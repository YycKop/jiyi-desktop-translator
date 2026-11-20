"""二次元风格图标生成器 v2（Pillow，无其它依赖）。

比 v1 收敛的地方：
- 眼睛不再是"深色描边 + 白圈"，而是**实心虹膜 + 两点高光**，小尺寸下不会读成眼镜。
- 刘海只保留一整块平滑弧线 + 中间一个 V 形分叉，去掉碎三角（32px 会变成锯齿噪点）。
- 去掉横跨头顶的高光弧（512px 时像发箍，32px 时像一道脏线），改为发梢两处小高光。
"""
from PIL import Image, ImageDraw, ImageFilter

OUT = r'D:\桌面翻译助手\项目代码\assets'
S = 1024
PAD = 24

HAIR = (56, 38, 106, 255)
HAIR_DEEP = (44, 29, 84, 255)
HAIR_HI = (120, 94, 214, 255)
SKIN = (255, 233, 222, 255)
IRIS_TOP = (126, 210, 255, 255)
IRIS_BOTTOM = (74, 92, 232, 255)
LASH = (36, 26, 62, 255)
BLUSH = (255, 132, 164, 165)
MOUTH = (150, 64, 88, 255)
RIBBON = (255, 122, 176, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def grad(size, c1, c2):
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.55 + y * 0.45) / size
            px[x, y] = lerp(c1, c2, t)
    return img


def squircle(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def eye(img, cx, cy, w, h):
    """实心虹膜 + 两点高光；不画整圈描边，避免小尺寸像眼镜。"""
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
    d = ImageDraw.Draw(e)
    # 顶部压暗，眼睛有球感但不发白
    shade = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse([-w * 0.2, -h * 0.7, w * 1.2, h * 0.45], fill=(26, 20, 56, 165))
    e.paste(shade, (0, 0), mask)
    # 上睫毛：只压住上沿，不闭合
    d.chord([0, -h * 0.06, w - 1, h * 0.9], start=180, end=360, fill=LASH)
    # 高光
    gw = int(w * 0.36)
    d.ellipse([int(w * 0.14), int(h * 0.20), int(w * 0.14) + gw, int(h * 0.20) + gw], fill=(255, 255, 255, 248))
    sw = int(w * 0.17)
    d.ellipse([int(w * 0.54), int(h * 0.60), int(w * 0.54) + sw, int(h * 0.60) + sw], fill=(255, 255, 255, 205))
    img.alpha_composite(e, (cx - w // 2, cy - h // 2))


def build(size_out, simple=False):
    W = S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    bg = grad(W - PAD * 2, (126, 96, 255, 255), (255, 124, 180, 255))
    m = squircle(W - PAD * 2, int((W - PAD * 2) * 0.26))
    base = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    base.paste(bg, (PAD, PAD), m)
    img.alpha_composite(base)
    d = ImageDraw.Draw(img)
    cx = W // 2

    # 肩膀
    d.ellipse([cx - 270, int(W * 0.90), cx + 270, int(W * 1.22)], fill=(252, 252, 255, 255))
    d.ellipse([cx - 86, int(W * 0.92), cx + 86, int(W * 1.10)], fill=RIBBON)

    # 后发（宽圆角块，垂到画面底部）
    d.rounded_rectangle([cx - 246, int(W * 0.13), cx + 246, int(W * 1.0)],
                        radius=int(W * 0.22), fill=HAIR)
    # 脸
    d.ellipse([cx - 190, int(W * 0.22), cx + 190, int(W * 0.84)], fill=SKIN)
    # 刘海：一整块平滑弧线（chord）压到眉毛高度
    d.chord([cx - 214, int(W * 0.10), cx + 214, int(W * 0.66)], start=180, end=360, fill=HAIR)
    # 中间 V 形分叉（用背景色？不——用头发色画两片向上收的尖角，形成中分感）
    d.polygon([(cx - 4, int(W * 0.30)), (cx - 96, int(W * 0.46)), (cx - 6, int(W * 0.50))], fill=HAIR_DEEP)
    d.polygon([(cx + 4, int(W * 0.30)), (cx + 96, int(W * 0.46)), (cx + 6, int(W * 0.50))], fill=HAIR_DEEP)
    # 两侧鬓发
    d.polygon([(cx - 220, int(W * 0.32)), (cx - 154, int(W * 0.30)), (cx - 172, int(W * 0.90)), (cx - 240, int(W * 0.84))], fill=HAIR)
    d.polygon([(cx + 220, int(W * 0.32)), (cx + 154, int(W * 0.30)), (cx + 172, int(W * 0.90)), (cx + 240, int(W * 0.84))], fill=HAIR)
    # 发梢两处小高光
    hi = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.ellipse([cx - 214, int(W * 0.20), cx - 150, int(W * 0.27)], fill=HAIR_HI)
    hd.ellipse([cx + 150, int(W * 0.20), cx + 214, int(W * 0.27)], fill=HAIR_HI)
    img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(9)))

    if not simple:
        eye(img, cx - 84, int(W * 0.575), 118, 132)
        eye(img, cx + 84, int(W * 0.575), 118, 132)
    else:
        for ex in (cx - 84, cx + 84):
            d.ellipse([ex - 52, int(W * 0.525), ex + 52, int(W * 0.63)], fill=IRIS_BOTTOM)
            d.chord([ex - 52, int(W * 0.505), ex + 52, int(W * 0.585)], start=180, end=360, fill=LASH)
            d.ellipse([ex - 30, int(W * 0.535), ex - 4, int(W * 0.568)], fill=(255, 255, 255, 245))

    # 腮红
    bx = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bx)
    bd.ellipse([cx - 172, int(W * 0.625), cx - 98, int(W * 0.668)], fill=BLUSH)
    bd.ellipse([cx + 98, int(W * 0.625), cx + 172, int(W * 0.668)], fill=BLUSH)
    img.alpha_composite(bx.filter(ImageFilter.GaussianBlur(10)))

    d.ellipse([cx - 5, int(W * 0.652), cx + 5, int(W * 0.662)], fill=(231, 176, 166, 255))
    d.arc([cx - 22, int(W * 0.660), cx + 22, int(W * 0.700)], start=25, end=155, fill=MOUTH, width=7)

    for (sx, sy, r) in [(W * 0.80, W * 0.17, 12), (W * 0.20, W * 0.79, 8)]:
        d.ellipse([sx - r, sy - r * 3, sx + r, sy + r * 3], fill=(255, 255, 255, 205))
        d.ellipse([sx - r * 3, sy - r, sx + r * 3, sy + r], fill=(255, 255, 255, 205))

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
    # 预览：大图 + 实际小尺寸 + 托盘简化版
    prev = Image.new('RGBA', (740, 520), (30, 32, 38, 255))
    prev.alpha_composite(build(496), (12, 12))
    prev.alpha_composite(build(64), (536, 24))
    prev.alpha_composite(build(32), (536, 104))
    prev.alpha_composite(build(16), (536, 148))
    prev.alpha_composite(build(32, simple=True), (536, 180))
    prev.alpha_composite(build(16, simple=True), (536, 224))
    prev.save(rf'{OUT}\icon-preview.png')
    print('icons written')


if __name__ == '__main__':
    main()
