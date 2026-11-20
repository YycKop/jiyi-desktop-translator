"""第十一轮补丁 F：关闭设置页只最小化到任务栏（后台入口），并加「退出程序」按钮。

用户需求（m05905 第 2 条）：关掉浮窗/设置后，软件要能在任务栏图标那里点开，
右键「退出」才真正结束。原实现 SETTINGS_CLOSE→win.close() 会销毁窗口，
而浮窗是 skipTaskbar、托盘在本机又注册不上，于是用户彻底失去入口。
"""
import io
import sys

ROOT = r'D:\桌面翻译助手\项目代码\src'


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def patch(path, old, new, label):
    t = read(path)
    if old not in t:
        print('MISS:', label)
        sys.exit(2)
    if t.count(old) > 1:
        print('AMBIGUOUS:', label, t.count(old))
        sys.exit(2)
    write(path, t.replace(old, new))
    print('ok:', label)


W = ROOT + r'\main\windows.js'
M = ROOT + r'\main\main.js'
H = ROOT + r'\renderer\settings\index.html'
J = ROOT + r'\renderer\settings\app.js'

# 1) 设置窗口：close → 最小化（除非正在退出）
patch(
    W,
    "    win.on('closed', () => {\n      this.wins.settings = null;\n      this._emitSettingsVisibility(false);\n    });",
    "    // 第十一轮需求 2：点 × / 关闭窗口只最小化到任务栏，不销毁窗口。\n"
    "    // 原因：浮窗 skipTaskbar、托盘在某些环境注册不上，销毁设置窗口后用户就没有入口了。\n"
    "    // 只有「退出程序」（托盘菜单 / 关于页按钮 / JumpList）才会置 _allowClose 真正关闭。\n"
    "    win.on('close', (e) => {\n"
    "      if (this._allowClose) return;\n"
    "      e.preventDefault();\n"
    "      win.minimize();\n"
    "      this._emitSettingsVisibility(false);\n"
    "    });\n"
    "    win.on('closed', () => {\n"
    "      this.wins.settings = null;\n"
    "      this._emitSettingsVisibility(false);\n"
    "    });",
    'windows: settings close -> minimize',
)

patch(
    W,
    "  /** 设置窗口当前是否可见 */",
    "  /** 退出前放行窗口关闭（否则 close 事件会被最小化逻辑拦下） */\n"
    "  prepareQuit() {\n"
    "    this._allowClose = true;\n"
    "  }\n"
    "\n"
    "  /** 设置窗口当前是否可见 */",
    'windows: prepareQuit',
)

# 2) quit 前放行
patch(
    M,
    "    this.quitting = true;\n    this.stopHudReassert();",
    "    this.quitting = true;\n"
    "    try { this.wm.prepareQuit(); } catch (e) { /* 忽略 */ }\n"
    "    this.stopHudReassert();",
    'main: prepareQuit in quit',
)

# 3) 关于页「退出程序」按钮
patch(
    H,
    '          <button id="btn-open-logs" class="btn">打开日志目录</button>',
    '          <button id="btn-open-logs" class="btn">打开日志目录</button>\n'
    '          <button id="btn-quit" class="btn">退出程序</button>',
    'html: quit button',
)

patch(
    J,
    "  if ($('btn-input-translate')) $('btn-input-translate').addEventListener('click', translateInput);",
    "  if ($('btn-input-translate')) $('btn-input-translate').addEventListener('click', translateInput);\n"
    "  // 退出程序（任务栏驻留时的显式出口）\n"
    "  if ($('btn-quit')) {\n"
    "    $('btn-quit').addEventListener('click', async () => {\n"
    "      setInputStatus('');\n"
    "      try { await api.quit(); } catch (e) { toast('退出失败：' + ((e && e.message) || '未知错误'), 'err'); }\n"
    "    });\n"
    "  }",
    'js: quit button handler',
)

print('patched f')
