"""第十一轮补丁 C：自检补「输入翻译面板」与「任务栏跳转列表」断言。"""
import io
import os
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


# 1) 记录 setUserTasks 的返回值，供自检断言
patch(
    "function setupJumpList() {\n  const program = launcherPath();",
    "let jumpListOk = false;\n"
    "function setupJumpList() {\n"
    "  const program = launcherPath();",
    'jumplist: state var',
)
patch(
    "  try { app.setUserTasks(tasks); } catch (e) { /* 某些系统策略下不可用，不影响主流程 */ }",
    "  try { jumpListOk = app.setUserTasks(tasks); } catch (e) { /* 某些系统策略下不可用，不影响主流程 */ }\n"
    "  return jumpListOk;",
    'jumplist: capture result',
)

# 2) 自检：外观页之后插入输入翻译面板检查
INPUT_STEP = '''
  // 2c) 输入翻译面板（第十一轮需求 3）：界面存在 + 字数联动 + 清空复位
  try {
    settings.webContents.send(CHANNELS.EVENT, { type: 'settings-tab', payload: { tab: 'input' } });
    await sleep(500);
    const inputInfo = await settings.webContents.executeJavaScript(
      "(() => {" +
        "const pane = document.getElementById('pane-input');" +
        "const src = document.getElementById('input-source');" +
        "const cnt = document.getElementById('input-count');" +
        "if (!pane || !src) return { ok: false };" +
        "src.value = 'Hello input translation';" +
        "src.dispatchEvent(new Event('input', { bubbles: true }));" +
        "return { ok: true, count: cnt ? cnt.textContent : '', hasBtn: !!document.getElementById('btn-input-translate') };" +
      "})()",
      true
    );
    report.checks.inputPane = !!(inputInfo && inputInfo.ok && inputInfo.hasBtn);
    report.checks.inputCountSync = !!(inputInfo && String(inputInfo.count) === '23');
    await shoot(settings, '13-settings-input');
    await settings.webContents.executeJavaScript(
      "(() => { const b = document.getElementById('btn-input-clear'); if (b) b.click(); return true; })()",
      true
    );
  } catch (e) {
    rendererErrors.push({ kind: 'input', message: String(e && e.message) });
    report.checks.inputPane = false;
  }
'''
patch(
    "  // 3) 首次引导\n  const onboarding = ctrl.wm.openOnboarding();",
    INPUT_STEP + "\n  // 3) 首次引导\n  const onboarding = ctrl.wm.openOnboarding();",
    'smoke: input pane step',
)

# 3) 自检收尾汇总里带上 jumplist
patch(
    "  report.checks.hudCreated = !!(hud && !hud.isDestroyed());",
    "  report.checks.hudCreated = !!(hud && !hud.isDestroyed());\n"
    "  report.checks.jumpList = jumpListOk;",
    'smoke: jumplist check',
)

print('patched c')
