# -*- coding: utf-8 -*-
"""第十二轮 C：前端（设置页图标/点击行为下拉/标题）+ 打包脚本 + 启动器 + 文档。"""
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


# ── 1. 托盘动作接上 toggleMainWindow ─────────────────────────────────────
rep(path('src', 'main', 'main.js'),
    "      actions: {\n        toggleHud: () => this.toggleHud(),",
    "      actions: {\n        toggleMainWindow: () => this.toggleMainWindow(),\n        toggleHud: () => this.toggleHud(),",
    'main.js tray actions')

# ── 2. 设置页：标题、左侧图标、点击行为下拉 ──────────────────────────────
p_html = path('src', 'renderer', 'settings', 'index.html')
rep(p_html, '<title>桌面翻译助手 - 设置</title>', '<title>即译 · 设置</title>', 'settings title')
rep(p_html,
    """  <header class="titlebar drag-region">
    <span class="brand">桌面翻译助手</span>""",
    """  <header class="titlebar drag-region">
    <img class="app-icon" src="../../assets/app.png" alt="即译" />
    <span class="brand">即译</span>""",
    'settings titlebar icon')

# 通用页：点击 exe 行为（需求 2）
rep(p_html,
    """            <label class="field">
              <span class="label">轮询间隔</span>""",
    """            <label class="field">
              <span class="label">点击图标时打开</span>
              <select id="launch-action">
                <option value="settings">设置页</option>
                <option value="hud">译文浮窗</option>
              </select>
              <span class="hint">双击 exe、托盘左键都按这个设置打开；退出请用「关于 → 退出程序」</span>
            </label>

            <label class="field">
              <span class="label">轮询间隔</span>""",
    'settings launchAction field')

# ── 3. 设置页脚本：读写 launchAction ─────────────────────────────────────
p_app = path('src', 'renderer', 'settings', 'app.js')
rep(p_app,
    "  function renderGeneral() {",
    "  const launchAction = el('launch-action');\n\n  function renderGeneral() {",
    'settings app launch-action ref')

t = read(p_app)
if "launchAction" in t and "launch-action" in t:
    # 在 renderGeneral 里回填值
    import re
    m = re.search(r"  function renderGeneral\(\) \{\n", t)
    if m:
        t = (t[:m.end()] +
             "    if (launchAction) launchAction.value = (state.cfg.general.launchAction === 'hud') ? 'hud' : 'settings';\n" +
             t[m.end():])
        write(p_app, t)
        print('ok  : settings app renderGeneral fill')
    else:
        MISS.append('settings app renderGeneral fill')
        print('MISS: settings app renderGeneral fill')
else:
    MISS.append('settings app renderGeneral fill')
    print('MISS: settings app renderGeneral fill')

rep(p_app,
    "  function bindGeneral() {",
    """  function bindGeneral() {
    if (launchAction) {
      launchAction.addEventListener('change', () => {
        patchConfig({ general: { launchAction: launchAction.value === 'hud' ? 'hud' : 'settings' } });
        toast(launchAction.value === 'hud' ? '以后点击图标会打开译文浮窗' : '以后点击图标会打开设置页');
      });
    }""",
    'settings app bind launch-action')

# ── 4. 样式：标题栏图标 ─────────────────────────────────────────────────
p_css = path('src', 'renderer', 'settings', 'settings.css')
t = read(p_css)
if '.app-icon' not in t:
    t += """
/* 标题栏左侧的应用图标（第十二轮需求 3：图标放在软件名称左边） */
.titlebar .app-icon {
  width: 18px;
  height: 18px;
  margin-right: 8px;
  border-radius: 5px;
  flex: 0 0 auto;
  -webkit-user-drag: none;
}
"""
    write(p_css, t)
    print('ok  : settings.css app-icon')
else:
    print('skip: settings.css app-icon')

# ── 5. 其它窗口标题 ─────────────────────────────────────────────────────
for rel, old, new, label in [
    ('src/renderer/hud/index.html', '<title>桌面翻译助手</title>', '<title>即译 · 浮窗</title>', 'hud title'),
    ('src/renderer/onboarding/index.html', '<title>桌面翻译助手</title>', '<title>即译 · 首次使用</title>', 'onboarding title'),
]:
    p = path(*rel.split('/'))
    if old in read(p):
        rep(p, old, new, label)
    else:
        print('skip:', label)

# ── 6. 打包脚本与启动器：文件名改「即译」 ────────────────────────────────
p_pkg = path('scripts', 'package-win.js')
rep(p_pkg, "'桌面翻译助手.exe'", "'即译.exe'", 'package-win launcher exe', 0)
rep(p_pkg, 'desktop-translator-core.exe', 'jiyi-core.exe', 'package-win core exe', 0)
rep(p_pkg, '桌面翻译助手-', '即译-', 'package-win zip name', 0)
rep(p_pkg, "'使用说明.txt'", "'使用说明.txt'", 'package-win readme name', 0)

p_launcher = path('launcher', 'Launcher.cs')
rep(p_launcher, 'desktop-translator-core.exe', 'jiyi-core.exe', 'launcher core exe', 0)

print('--- part 3 done, MISS:', MISS)
