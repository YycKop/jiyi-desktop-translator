"""把字幕条截图叠到照片背景上，检查"透明但字清晰"的实际观感。"""
from PIL import Image

SHOT = r"D:\桌面翻译助手\项目测试\reports\electron-smoke\14-hud-subtitle.png"
BG = r"D:\桌面翻译助手\项目测试\fixtures\bg-photo.png"
OUT = r"D:\桌面翻译助手\项目测试\reports\arttext\subtitle-on-photo.png"

shot = Image.open(SHOT).convert("RGBA")
bg = Image.open(BG).convert("RGBA").resize((shot.width, shot.height), Image.LANCZOS)
merged = Image.alpha_composite(bg, shot)
merged = merged.resize((shot.width // 2, shot.height // 2), Image.LANCZOS)
merged.save(OUT)
print("saved", OUT, merged.size)
