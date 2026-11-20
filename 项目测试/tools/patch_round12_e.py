# -*- coding: utf-8 -*-
"""第十二轮 E：清掉残留的旧名字（package.json / 引导页 / 启动器弹框 / 发布脚本）。"""
import io
import json
import os

ROOT = r'D:\桌面翻译助手'
CODE = os.path.join(ROOT, '项目代码')

MISS = []


def path(*parts):
    return os.path.join(CODE, *parts)


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def rep(p, old, new, label, count=0):
    t = read(p)
    if old not in t:
        MISS.append(label)
        print('MISS:', label)
        return
    write(p, t.replace(old, new) if count == 0 else t.replace(old, new, count))
    print('ok  :', label)


# 1. package.json：去重 productName，改描述
pkg_path = path('package.json')
raw = read(pkg_path)
obj = json.loads(raw)
obj['name'] = 'jiyi'
obj['productName'] = '即译'
obj['description'] = '即译 —— 屏幕取词翻译助手（Electron 宿主壳 + Node 编排引擎，本地 OCR、联网 API 与离线模型双通道）'
write(pkg_path, json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
print('ok  : package.json rewritten', sorted(k for k in obj if k in ('name', 'productName')))

# 2. 引导页文案
p_ob = path('src', 'renderer', 'onboarding', 'index.html')
rep(p_ob, '<title>欢迎使用桌面翻译助手</title>', '<title>欢迎使用即译</title>', 'onboarding title')
rep(p_ob, '<span class="brand">桌面翻译助手</span>', '<span class="brand">即译</span>', 'onboarding brand')
rep(p_ob, '桌面翻译助手', '即译', 'onboarding body text')

# 3. 启动器弹框
p_l = path('launcher', 'Launcher.cs')
rep(p_l, '/// 桌面翻译助手启动器。', '/// 即译（jiyi）启动器。', 'launcher doc comment')
rep(p_l, '"桌面翻译助手启动失败（退出码 0x{0:X8}）。\\n\\n"', '"即译启动失败（退出码 0x{0:X8}）。\\n\\n"', 'launcher fail title')
rep(p_l, 'MessageBox.Show(message, "桌面翻译助手", MessageBoxButtons.OK, MessageBoxIcon.Error);',
    'MessageBox.Show(message, "即译", MessageBoxButtons.OK, MessageBoxIcon.Error);', 'launcher messagebox')

# 4. 发布脚本文件名
p_rel = path('scripts', 'package-release.js')
rep(p_rel, '桌面翻译助手', '即译', 'package-release names', 0)

print('--- part 5 done, MISS:', MISS)
