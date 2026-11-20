"""第十一轮补丁 H：自检补「关闭设置只最小化」「关于页退出按钮」两条断言。"""
import io
import sys

M = r'D:\桌面翻译助手\项目代码\src\main\main.js'


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def patch(old, new, label):
    t = read(M)
    if old not in t:
        print('MISS:', label)
        sys.exit(2)
    if t.count(old) > 1:
        print('AMBIGUOUS:', label, t.count(old))
        sys.exit(2)
    write(M, t.replace(old, new))
    print('ok:', label)


patch(
    "    report.checks.inputPane = !!(inputInfo && inputInfo.ok && inputInfo.hasBtn);",
    "    report.checks.inputPane = !!(inputInfo && inputInfo.ok && inputInfo.hasBtn);\n"
    "    report.checks.quitButton = await settings.webContents.executeJavaScript(\"!!document.getElementById('btn-quit')\", true);",
    'smoke: quit button check',
)

STEP = '''
  // 2d) 关设置窗口只最小化到任务栏（第十一轮需求 2：后台入口不能消失）
  try {
    settings.close();
    await sleep(400);
    const s2 = ctrl.wm.wins.settings;
    report.checks.settingsCloseMinimizes = !!(s2 && !s2.isDestroyed() && s2.isMinimized());
    if (s2 && !s2.isDestroyed()) {
      s2.restore();
      s2.show();
    }
    await sleep(300);
  } catch (e) {
    rendererErrors.push({ kind: 'settings-close', message: String(e && e.message) });
    report.checks.settingsCloseMinimizes = false;
  }
'''
patch(
    "\n  // 3) 首次引导\n  const onboarding = ctrl.wm.openOnboarding();",
    STEP + "\n  // 3) 首次引导\n  const onboarding = ctrl.wm.openOnboarding();",
    'smoke: settings close minimizes',
)

print('patched h')
