"""由用户提供的 AI 生成图制作应用图标（即译）。

步骤：
1) 去掉图上两处水印（左上「AI生成」、底部「小红书号」）——只做局部修补，不改变画面主体；
2) 自动测量圆角方形的边界与圆角半径，裁出正图；
3) 生成带透明圆角的多尺寸 PNG、托盘图标（裁脸特写）、多尺寸 ico；
4) 输出拼图预览便于肉眼确认。

**关键顺序**：先把不透明的正图缩放到目标尺寸，再套圆角蒙版。反过来（先 putalpha 再
LANCZOS 缩放）会让透明区的 RGB 参与插值，图标边缘出现一圈白边。

用法：python gen_icon_jiyi.py [--src 源图] [--out 输出目录] [--preview] [--inset 0.008]
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFilter

SRC_DEFAULT = r'D:\桌面翻译助手\项目测试\_runtime\icon-src.webp'
OUT_DEFAULT = r'D:\桌面翻译助手\项目代码\assets'


def load_rgba(path):
    im = Image.open(path)
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    return im


def is_bg(px, tol=18):
    r, g, b, a = px
    return a > 200 and r > 255 - tol and g > 255 - tol and b > 255 - tol


def clean_watermarks(im):
    """局部修补两处水印。坐标按 2048 基准，按实际尺寸等比缩放。"""
    w, h = im.size
    k = w / 2048.0
    out = im.copy()

    def rect(x0, y0, x1, y1):
        return (int(x0 * k), int(y0 * k), int(x1 * k), int(y1 * k))

    # 1) 左上「AI生成」：右侧同高度是干净的同色渐变，直接平移复制
    dx0, dy0, dx1, dy1 = rect(60, 70, 340, 175)
    pw, ph = dx1 - dx0, dy1 - dy0
    patch = out.crop((dx0 + 420, dy0 - 10, dx0 + 420 + pw, dy0 - 10 + ph))
    out.paste(patch, (dx0, dy0))

    # 2) 底部「小红书号」：位于白色衣服上。中值滤波去细笔画，再降采样再放大做低通，
    #    最后用羽化蒙版贴回——直接矩形贴回会留下明显的方形糊块。
    for bx0, by0, bx1, by1 in (rect(855, 1845, 1215, 1975),):
        region = out.crop((bx0, by0, bx1, by1))
        region = region.filter(ImageFilter.MedianFilter(size=15))
        rw, rh = region.size
        smooth = region.resize((max(2, rw // 10), max(2, rh // 10)), Image.BILINEAR)
        smooth = smooth.resize((rw, rh), Image.BICUBIC)
        smooth = smooth.filter(ImageFilter.GaussianBlur(radius=2))
        fea = Image.new('L', (rw, rh), 255).filter(ImageFilter.GaussianBlur(radius=max(3, rw // 22)))
        out.paste(smooth, (bx0, by0), fea)

    return out


def find_art_bounds(im):
    """找圆角方形的边界与圆角半径（基于非白像素）。"""
    w, h = im.size
    px = im.load()
    step = max(1, w // 400)

    def row_left(y):
        for x in range(0, w, step):
            if not is_bg(px[x, y]):
                return x
        return None

    def row_right(y):
        for x in range(w - 1, -1, -step):
            if not is_bg(px[x, y]):
                return x
        return None

    top = None
    for y in range(0, h, step):
        if row_left(y) is not None:
            top = y
            break
    bottom = None
    for y in range(h - 1, -1, -step):
        if row_left(y) is not None:
            bottom = y
            break

    lefts = []
    for y in range(top, bottom + 1, step):
        l = row_left(y)
        if l is not None:
            lefts.append((y, l))
    x0 = min(l for _, l in lefts)

    rights = []
    for y in range(top, bottom + 1, step):
        r = row_right(y)
        if r is not None:
            rights.append(r)
    x1 = max(rights)

    top_left = row_left(top) or x0
    radius = max(0, top_left - x0)
    return (x0, top, x1, bottom), radius


def rounded_mask(size, radius, inset=0, ss=4):
    """在 ss 倍画布上画圆角矩形再缩小，得到干净的抗锯齿蒙版。"""
    big = size * ss
    mask = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(mask)
    i = int(round(inset * ss))
    r = max(0, int(round(radius * ss)))
    d.rounded_rectangle((i, i, big - 1 - i, big - 1 - i), radius=r, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def compose(square_rgb, size, ratio, inset_px):
    """把正图缩放到 size 再套透明圆角（先缩放后加透明，避免白边）。"""
    img = square_rgb.resize((size, size), Image.LANCZOS).convert('RGBA')
    src = float(square_rgb.size[0])
    inset = inset_px * size / src
    radius = ratio * size - inset
    img.putalpha(rounded_mask(size, max(0.0, radius), max(0.0, inset)))
    return img


def build(im, out_dir, preview=False, inset_ratio=0.008):
    art = clean_watermarks(im)
    (x0, y0, x1, y1), r = find_art_bounds(art)
    side = min(x1 - x0, y1 - y0)
    print('bounds:', (x0, y0, x1, y1), 'radius:', r, 'side:', side)

    square_rgb = art.crop((x0, y0, x0 + side, y0 + side)).convert('RGB')
    ratio = r / float(side)
    # 源图圆角边缘自带一圈很浅的描边，内缩一点裁掉，同时避免白边
    inset_px = max(2, int(round(side * inset_ratio)))

    os.makedirs(out_dir, exist_ok=True)
    saved = []

    def save(img, name):
        path = os.path.join(out_dir, name)
        img.save(path)
        saved.append((name, img.size, os.path.getsize(path)))
        return path

    def icon_at(size):
        return compose(square_rgb, size, ratio, inset_px)

    big = icon_at(512)
    save(big, 'icon-anime.png')
    save(icon_at(256), 'app.png')
    for s in (128, 64, 48, 32, 16):
        save(icon_at(s), 'app-%d.png' % s)

    # 托盘：裁脸特写（保留头发与眼睛），小尺寸下更容易辨认
    fw = int(side * 0.52)
    fx = x0 + int(side * 0.30)
    fy = y0 + int(side * 0.46)
    face_rgb = art.crop((fx, fy, fx + fw, fy + fw)).convert('RGB')

    def face_at(size):
        img = face_rgb.resize((size, size), Image.LANCZOS).convert('RGBA')
        img.putalpha(rounded_mask(size, size * 0.5))
        return img

    save(face_at(32), 'tray.png')
    save(face_at(64), 'tray@2x.png')

    # ico：多尺寸，复用同一套合成结果，保证与 png 完全一致
    ico = os.path.join(out_dir, 'app.ico')
    icon_at(256).save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    saved.append(('app.ico', (256, 256), os.path.getsize(ico)))

    if preview:
        canvas = Image.new('RGBA', (760, 300), (24, 26, 32, 255))
        canvas.alpha_composite(big.resize((240, 240), Image.LANCZOS), (24, 30))
        x = 300
        for s in (64, 48, 32, 16):
            canvas.alpha_composite(icon_at(s), (x, 40))
            x += s + 18
        x = 300
        for s in (64, 32):
            canvas.alpha_composite(face_at(s), (x, 140))
            x += s + 18
        canvas.save(os.path.join(out_dir, 'icon-preview.png'))
        saved.append(('icon-preview.png', canvas.size,
                      os.path.getsize(os.path.join(out_dir, 'icon-preview.png'))))

    for name, size, nbytes in saved:
        print('  %-18s %-10s %7d B' % (name, '%dx%d' % size, nbytes))
    return saved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=SRC_DEFAULT)
    ap.add_argument('--out', default=OUT_DEFAULT)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--inset', type=float, default=0.008)
    a = ap.parse_args()
    im = load_rgba(a.src)
    print('source:', im.size, im.mode)
    build(im, a.out, a.preview, a.inset)


if __name__ == '__main__':
    main()
