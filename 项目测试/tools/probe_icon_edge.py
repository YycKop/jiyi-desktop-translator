"""探查源图边缘：找出白色描边的宽度与颜色，决定裁切内缩量。"""
from PIL import Image

im = Image.open(r'D:\桌面翻译助手\项目测试\_runtime\icon-src.webp').convert('RGB')
w, h = im.size
print('size', im.size)
y = h // 2
px = im.load()
print('--- 中线左侧 0..40px ---')
for x in range(55, 95):
    print(x, px[x, y])
print('--- 中线右侧 尾部 ---')
for x in range(w - 95, w - 55):
    print(x, px[x, y])
