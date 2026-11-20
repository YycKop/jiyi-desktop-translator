"""第十一轮补丁 E：把误插进 registerShortcutsGuard() 的 JumpList 代码搬到模块顶部。

起因：补丁 A 用 `app.on('window-all-closed', ...)` 作锚点，命中的是类方法体内的同名注册，
于是 ready 钩子 + JumpList 代码整体落到了方法里，模块作用域的 bootstrap 看不到 setupJumpList。
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

STRAY = """    // ---------------------------------------------------------------- 任务栏
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

app.on('ready', () => {
  try { setupJumpList(); } catch (e) { /* 忽略 */ }
});

"""

if STRAY not in t:
    print('MISS: stray block')
    sys.exit(2)
t = t.replace(STRAY, '', 1)

MODULE_BLOCK = """
// ---------------------------------------------------------------- 任务栏
// Windows 任务栏右键菜单（JumpList）：关闭设置/浮窗只是隐藏到后台，用户随时能从
// 任务栏图标重新打开设置或输入翻译，只有「退出程序」才真正结束进程。
// program 指向启动器（打包结构里 app\\core.exe 的上一级），否则 JumpList 直接拉起
// core 会缺少 --no-sandbox 在本机秒退。
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
"""

anchor = "const APP_ID = 'com.desktoptranslator.app';"
if anchor not in t:
    print('MISS: app id anchor')
    sys.exit(2)
t = t.replace(anchor, anchor + '\n' + MODULE_BLOCK, 1)

write(M, t)
print('ok: jumplist block moved to module scope (after APP_ID)')
