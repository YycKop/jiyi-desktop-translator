# -*- coding: utf-8 -*-
"""第十二轮 D：补齐剩余锚点（启动行为下拉 / 脚本读写 / 打包名称常量）。"""
import io
import os

ROOT = r'D:\桌面翻译助手'
CODE = os.path.join(ROOT, '项目代码')


def path(*parts):
    return os.path.join(CODE, *parts)


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


MISS = []


def rep(p, old, new, label, count=0):
    t = read(p)
    if old not in t:
        MISS.append(label)
        print('MISS:', label)
        return
    write(p, t.replace(old, new) if count == 0 else t.replace(old, new, count))
    print('ok  :', label)


# 1. 设置页：新增「启动」小节（点击图标时打开什么）
rep(path('src', 'renderer', 'settings', 'index.html'),
    """        <h2>轮询</h2>""",
    """        <h2>启动</h2>
        <div class="grid2">
          <label class="field">
            <span>点击图标时打开</span>
            <select id="launch-action">
              <option value="settings">设置页</option>
              <option value="hud">译文浮窗</option>
            </select>
          </label>
          <div class="field">
            <span>后台与退出</span>
            <p class="hint">关掉设置页与浮窗后任务栏图标消失，但程序仍在后台；点托盘图标可再次打开。
              彻底退出请用「关于 → 退出程序」，或在托盘图标上右键选择「退出」。</p>
          </div>
        </div>

        <h2>轮询</h2>""",
    'index.html launch section')

rep(path('src', 'renderer', 'settings', 'app.js'),
    "  $('source-lang').value = cfg.general.sourceLang;",
    "  $('source-lang').value = cfg.general.sourceLang;\n"
    "  $('launch-action').value = cfg.general.launchAction === 'hud' ? 'hud' : 'settings';",
    'app.js render launch-action')

rep(path('src', 'renderer', 'settings', 'app.js'),
    "  $('interval').addEventListener('change', (e) => patchConfig({ capture: { intervalMs: Number(e.target.value) } }));",
    "  $('interval').addEventListener('change', (e) => patchConfig({ capture: { intervalMs: Number(e.target.value) } }));\n"
    "  $('launch-action').addEventListener('change', (e) => {\n"
    "    const hud = e.target.value === 'hud';\n"
    "    patchConfig({ general: { launchAction: hud ? 'hud' : 'settings' } });\n"
    "    toast(hud ? '以后点击图标会打开译文浮窗' : '以后点击图标会打开设置页');\n"
    "  });",
    'app.js bind launch-action')

# 2. 打包脚本：应用名常量 + 使用说明
p_pkg = path('scripts', 'package-win.js')
rep(p_pkg, "const APP_NAME = '桌面翻译助手';", "const APP_NAME = '即译';", 'package-win APP_NAME')
rep(p_pkg, '桌面翻译助手', '即译', 'package-win remaining name', 0)

print('--- part 4 done, MISS:', MISS)
