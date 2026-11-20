"""第十一轮补丁：二次元图标应用 + 任务栏驻留/跳转列表 + 输入翻译面板。

每个替换都带断言，锚点丢失会立刻报错，不会静默跳过。
"""
import io
import os
import sys

ROOT = r'D:\桌面翻译助手\项目代码'
SRC = os.path.join(ROOT, 'src')


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def patch(path, old, new, label):
    t = read(path)
    if old not in t:
        print('MISS:', label, '->', path)
        sys.exit(2)
    if t.count(old) > 1:
        print('AMBIGUOUS(%d):' % t.count(old), label)
        sys.exit(2)
    write(path, t.replace(old, new))
    print('ok:', label)


# ── 1. 窗口图标 ──────────────────────────────────────────────────────────────
W = os.path.join(SRC, 'main', 'windows.js')
patch(
    W,
    "const RENDERER_DIR = path.join(__dirname, '..', 'renderer');",
    "const RENDERER_DIR = path.join(__dirname, '..', 'renderer');\n"
    "// 二次元风格图标（assets/app.png，256px）。Windows 任务栏/Alt+Tab 取窗口 icon，\n"
    "// 打包后的 exe 图标由 launcher 的 /win32icon 决定，两者用同一份素材。\n"
    "const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'app.png');",
    'windows: app icon const',
)
t = read(W)
n = t.count("      show: false,\n")
if n < 4:
    print('window count unexpected:', n)
    sys.exit(2)
t = t.replace("      show: false,\n", "      show: false,\n      icon: APP_ICON,\n")
write(W, t)
print('ok: windows: icon on %d windows' % n)

# ── 2. 任务栏跳转列表 + 命令行入口 ──────────────────────────────────────────
M = os.path.join(SRC, 'main', 'main.js')
patch(
    M,
    "app.setAppUserModelId(APP_ID);",
    "app.setAppUserModelId(APP_ID);\n"
    "// 任务栏右键菜单（JumpList）。用户要求「关掉浮窗后还能从任务栏点开、右键退出才真的退出」，\n"
    "// 这里给出重新打开设置/输入翻译/立即翻译/退出四条命令。\n"
    "// 注意 program 用启动器（打包结构：app\\core.exe 的上一级），否则 JumpList 直接拉起 core\n"
    "// 会缺少 --no-sandbox 而秒退。\n"
    "function launcherPath() {\n"
    "  const guess = path.join(path.dirname(process.execPath), '..', '桌面翻译助手.exe');\n"
    "  try { if (fs.existsSync(guess)) return guess; } catch { /* 忽略 */ }\n"
    "  return process.execPath;\n"
    "}\n"
    "function setupJumpList() {\n"
    "  const program = launcherPath();\n"
    "  const tasks = [\n"
    "    { program, arguments: '--open-settings', title: '打开设置', description: '打开外观、API 与离线模型设置', iconPath: APP_ICON_PATH, iconIndex: 0 },\n"
    "    { program, arguments: '--open-input', title: '输入翻译', description: '打开输入翻译面板', iconPath: APP_ICON_PATH, iconIndex: 0 },\n"
    "    { program, arguments: '--translate-once', title: '立即翻译上次区域', description: '重新识别并翻译上一次框选的区域', iconPath: APP_ICON_PATH, iconIndex: 0 },\n"
    "    { program, arguments: '--quit', title: '退出程序', description: '完全退出（关闭浮窗只是隐藏到后台）', iconPath: APP_ICON_PATH, iconIndex: 0 },\n"
    "  ];\n"
    "  try { app.setUserTasks(tasks); } catch (e) { /* 某些系统策略下不可用，不影响主流程 */ }\n"
    "}\n"
    "const APP_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'app.png');",
    'main: jumplist',
)

# --quit / --open-input / --translate-once 参数
patch(
    M,
    "    if (process.argv.includes('--open-settings')) {",
    "    if (process.argv.includes('--quit')) {\n"
    "      ctrl.logger.info('收到 --quit，直接退出（任务栏右键菜单）');\n"
    "      ctrl.quit('jumplist');\n"
    "      return;\n"
    "    }\n"
    "    if (process.argv.includes('--open-input')) {\n"
    "      ctrl.wm.openSettings('input');\n"
    "      return;\n"
    "    }\n"
    "    if (process.argv.includes('--translate-once')) {\n"
    "      ctrl.translateLast();\n"
    "      return;\n"
    "    }\n"
    "    if (process.argv.includes('--open-settings')) {",
    'main: cli args',
)

# 启动时注册跳转列表（放在 setAppUserModelId 之后、whenReady 之前）
patch(
    M,
    "app.on('window-all-closed', (e) => {",
    "app.on('ready', () => {\n"
    "  try { setupJumpList(); } catch (e) { /* 忽略 */ }\n"
    "});\n\n"
    "app.on('window-all-closed', (e) => {",
    'main: register jumplist',
)

# ── 3. 托盘菜单：输入翻译 ───────────────────────────────────────────────────
T = os.path.join(SRC, 'main', 'tray.js')
patch(
    T,
    "        { label: '通用设置…', click: () => this.actions.openSettings('general') },",
    "        { label: '通用设置…', click: () => this.actions.openSettings('general') },\n"
    "        { label: '输入翻译…', click: () => this.actions.openSettings('input') },",
    'tray: input menu item',
)

print('patched')
