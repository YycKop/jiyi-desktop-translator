import sys

from PIL import Image
from PIL import ImageGrab

# Find the floating ball (circle painted with the accent gradient) by colour centroid,
# then report its centre so a click script can target it.
ACcent_min = (60, 110, 200)
ACCENT_max = (130, 190, 255)


def main():
    im = ImageGrab.grab(bbox=(0, 0, 1920, 1080)).convert('RGB')
    w, h = im.size
    px = im.load()
    pts = []
    # only look at the right third and middle band: the ball rests near the right edge
    for y in range(0, h, 2):
        for x in range(int(w * 0.6), w, 2):
            r, g, b = px[x, y]
            if ACcent_min[0] <= r <= ACCENT_max[0] and ACcent_min[1] <= g <= ACCENT_max[1] and ACcent_min[2] <= b <= ACCENT_max[2]:
                pts.append((x, y))
    if not pts:
        print('BALL not found')
        return 1
    # cluster: take the densest 60x60 window
    best = None
    for cx, cy in pts[::max(1, len(pts) // 400)]:
        inside = [p for p in pts if abs(p[0] - cx) <= 30 and abs(p[1] - cy) <= 30]
        if best is None or len(inside) > best[0]:
            best = (len(inside), sum(p[0] for p in inside) // len(inside), sum(p[1] for p in inside) // len(inside))
    print('BALL center=%d,%d hits=%d' % (best[1], best[2], best[0]))
    im.save(r'D:\桌面翻译助手\项目测试\reports\locate-ball.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
