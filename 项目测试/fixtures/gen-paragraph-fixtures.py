# -*- coding: utf-8 -*-
"""第十三轮：生成"整段中文"合成图，用于复现「框里文字识别不全」。

像素规格贴近真实取词场景：15~16px 正文、浅底深字与深底浅字各一组，
包含中文标点、中英混排、数字与百分比，方便比对「丢行 / 丢字 / 乱码」。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = r"C:\Windows\Fonts\msyh.ttc"

CASES = [
    ("para-dark-15px.png", (720, 210), "#E8ECF3", "#1A1016", 15, [
        "请先点击「保存」按钮，然后等待同步完成。",
        "如果提示网络错误，请检查代理设置后重试。",
        "本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。",
        "注意：关闭窗口不会退出程序，程序会继续在后台运行。",
        "更多帮助请查看使用说明，或联系技术支持。",
    ]),
    ("para-light-15px.png", (720, 210), "#2B3038", "#F6F8FC", 15, [
        "请先点击「保存」按钮，然后等待同步完成。",
        "如果提示网络错误，请检查代理设置后重试。",
        "本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。",
        "注意：关闭窗口不会退出程序，程序会继续在后台运行。",
        "更多帮助请查看使用说明，或联系技术支持。",
    ]),
    ("para-dark-16px.png", (760, 230), "#E8ECF3", "#141821", 16, [
        "点击「开始」按钮后，系统会自动扫描并识别选区文字。",
        "识别结果会显示在浮窗中，可以复制或再次翻译。",
        "若译文不准确，可以切换目标语言或调整框选区域。",
    ]),
    ("para-gray-14px.png", (760, 160), "#6C7486", "#20242E", 14, [
        "提示：快捷键 Ctrl+Shift+T 可以重新框选区域。",
        "浮窗右下角的小三角可以调整窗口大小。",
        "按 Esc 键会暂停定时轮询。",
    ]),
]


def render(name, size, fg, bg, px, lines):
    font = ImageFont.truetype(FONT, px)
    img = Image.new("RGB", size, bg)
    draw = ImageDraw.Draw(img)
    y = 12
    step = int(px * 1.9)
    for line in lines:
        draw.text((14, y), line, font=font, fill=fg)
        y += step
    out = os.path.join(HERE, name)
    img.save(out)
    print("saved: %s %dx%d lines=%d" % (out, size[0], size[1], len(lines)))


def main():
    for case in CASES:
        render(*case)


if __name__ == "__main__":
    main()
