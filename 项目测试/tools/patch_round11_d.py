"""第十一轮补丁 D：把 JumpList 相关代码从 bootstrap() 内挪到模块作用域。

上一版误插进 async bootstrap()，导致：
  - runSmokeTest 里 `jumpListOk` 未定义（ReferenceError，自检直接失败）
  - 模块级 `app.on('ready')` 里调用 setupJumpList 也是 undefined（被 try 吞掉，功能静默失效）
"""
import io
import sys

M = r'D:\桌面翻译助手\项目代码\src\main\main.js'


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


t = read(M)

INNER = """// 任务栏右键菜单（JumpList）。用户要求「关掉浮窗后还能从任务栏点开、右键退出才真的退出」，
// 这里给出重新打开设置/输入翻译/立即翻译/退出四条命令。
// 注意 program 用启动器（打包结构：app\\core.exe 的上一级），否则 JumpList 直接拉起 core
// 会缺少 --no-sandbox 而秒退。
function launcherPath() {
  const guess = path.join(path.dirname(process.execPath), '..', '桌面翻译助手.exe');
  try { if (fs.existsSync(guess)) return guess; } catch { /* 忽略 */ }
  return process.execPath;
}
let jumpListOk = false;
function setupJumpList() {
  const program = launcherPath();
  const tasks = [
    { program, arguments: '--open-settings', title: '打开设置', description: '打开外观、API 与离线模型设置', iconPath: APP_ICON_PATH, iconIndex: 0 },
    { program, arguments: '--open-input', title: '输入翻译', description: '打开输入翻译面板', iconPath: APP_ICON_PATH, iconIndex: 0 },
    { program, arguments: '--translate-once', title: '立即翻译上次区域', description: '重新识别并翻译上一次框选的区域', iconPath: APP_ICON_PATH, iconIndex: 0 },
    { program, arguments: '--quit', title: '退出程序', description: '完全退出（关闭浮窗只是隐藏到后台）', iconPath: APP_ICON_PATH, iconIndex: 0 },
  ];
  try { jumpListOk = app.setUserTasks(tasks); } catch (e) { /* 某些系统策略下不可用，不影响主流程 */ }
  return jumpListOk;
}
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'app.png');"""

if INNER not in t:
    print('MISS: inner block')
    sys.exit(2)
t = t.replace(INNER, '', 1)

# bootstrap 里补一次调用（窗口图标、任务栏菜单都在 ready 之后注册）
t = t.replace(
    "  async bootstrap() {\n    app.setAppUserModelId(APP_ID);",
    "  async bootstrap() {\n    app.setAppUserModelId(APP_ID);\n    setupJumpList();",
    1,
)

MODULE_BLOCK = """// ---------------------------------------------------------------- 任务栏
// Windows 任务栏右键菜单（JumpList）：关闭浮窗只是隐藏到后台，用户随时可以从
// 任务栏图标重新打开设置/输入翻译，只有「退出程序」才真正结束进程。
// program 指向启动器（app\\core.exe 的上一级），否则 JumpList 直接拉起 core
// 会缺少 --no-sandbox 而在本机秒退。
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'app.png');
let jumpListOk = false;
function launcherPath() {
  const guess = path.join(path.dirname(process.execPath), '..', '桌面翻译助手.exe');
  try {
    if (fs.existsSync(guess)) return guess;
  } catch (e) { /* 忽略：找不到就用当前可执行文件 */ }
  return process.execPath;
}
function setupJumpList() {
  const program = launcherPath();
  const tasks = [
    { program, arguments: '--open-settings', title: '打开设置', description: '外观、API 与离线模型设置', iconPath: APP_ICON_PATH, iconIndex: 0 },
    { program, arguments: '--open-input', title: '输入翻译', description: '打开输入翻译面板', iconPath: APP_ICON_PATH, iconIndex: 0 },
    { program, arguments: '--translate-once', title: '立即翻译上次区域', description: '重新识别并翻译上一次框选的区域', iconPath: APP_ICON_PATH, iconIndex: 0 },
    { program, arguments: '--quit', title: '退出程序', description: '真正退出（关闭浮窗只是隐藏到后台）', iconPath: APP_ICON_PATH, iconIndex: 0 },
  ];
  try {
    jumpListOk = app.setUserTasks(tasks);
  } catch (e) {
    jumpListOk = false;
  }
  return jumpListOk;
}

app.on('ready', () => {"""

t = t.replace("app.on('ready', () => {", MODULE_BLOCK, 1)
write(M, t)
print('ok: moved jumplist to module scope')
