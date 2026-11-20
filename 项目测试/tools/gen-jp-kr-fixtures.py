"""生成日文/韩文识别测试图（合成图，不含真实截图，符合 SCR-03）。"""
import os

from PIL import Image, ImageDraw, ImageFont

OUT = r"D:\桌面翻译助手\项目测试\fixtures"

CASES = [
    ("jp-hiragana-640x200.png", r"C:\Windows\Fonts\YuGothR.ttc", 34, [
        "こんにちは、世界。",
        "カタカナのテストです。",
    ]),
    ("jp-mixed-640x200.png", r"C:\Windows\Fonts\YuGothR.ttc", 32, [
        "日本語のテキストを読み取ります",
        "漢字とひらがなとカタカナ",
    ]),
    ("ko-hangul-640x200.png", r"C:\Windows\Fonts\malgun.ttf", 34, [
        "안녕하세요 세계",
        "한국어 테스트입니다.",
    ]),
    ("ko-sentence-640x200.png", r"C:\Windows\Fonts\malgunbd.ttf", 30, [
        "이 문장을 한국어로 인식합니다",
        "자막 번역 테스트",
    ]),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, font_path, size, lines in CASES:
        img = Image.new("RGB", (640, 200), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        font = ImageFont.truetype(font_path, size)
        y = 34
        for line in lines:
            draw.text((36, y), line, font=font, fill=(20, 20, 24))
            y += size + 24
        path = os.path.join(OUT, name)
        img.save(path)
        print(name, os.path.getsize(path), "B")


if __name__ == "__main__":
    main()
