# -*- coding: utf-8 -*-
"""第十二轮 B：修正两处 MISS（设置窗口 close→hide、launchAction 校验）+ 其余前端与脚本改动。"""
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


# ── 1. 设置窗口 close → hide（任务栏按钮随之消失）────────────────────────
rep(path('src', 'main', 'windows.js'),
    """    // 第十一轮需求 2：点 × / 关闭窗口只最小化到任务栏，不销毁窗口。
    // 原因：浮窗 skipTaskbar、托盘在某些环境注册不上，销毁设置窗口后用户就没有入口了。
    // 只有「退出程序」（托盘菜单 / 关于页按钮 / JumpList）才会置 _allowClose 真正关闭。
    win.on('close', (e) => {
      if (this._allowClose) return;
      e.preventDefault();
      win.minimize();
      this._emitSettingsVisibility(false);
    });""",
    """    // 第十二轮需求 1：关掉设置页与浮窗后「任务栏图标消失，但软件不退出」。
    // 隐藏窗口（hide）比最小化更符合预期——隐藏窗口不会在任务栏留按钮；
    // 再次打开走托盘图标 / 再次双击 exe，退出只走「托盘 → 退出」/ 关于页按钮 / --quit。
    win.on('close', (e) => {
      if (this._allowClose) return;
      e.preventDefault();
      win.hide();
      win.setSkipTaskbar(true);
      this._emitSettingsVisibility(false);
    });""",
    'windows.js close → hide')

# ── 2. launchAction 校验 ─────────────────────────────────────────────────
rep(path('src', 'core', 'config', 'store.js'),
    """    if (next.capture) {
      next.capture.intervalMs = Math.min(60000, Math.max(500, Number(next.capture.intervalMs) || 2000));
    }""",
    """    if (next.capture) {
      next.capture.intervalMs = Math.min(60000, Math.max(500, Number(next.capture.intervalMs) || 2000));
    }
    if (next.general) {
      // 点击 exe / 托盘左键的行为：只允许两种（第十二轮需求 2）
      if (next.general.launchAction !== 'hud') next.general.launchAction = 'settings';
    }""",
    'store launchAction clamp')

# ── 3. main.js：托盘动作 + 点击 exe 行为 + 启动分支 ──────────────────────
p_main = path('src', 'main', 'main.js')
rep(p_main,
    """    // 首次启动引导（M5-T4）
    if (!this.engine.getConfig().onboarded) {
      this.wm.openOnboarding();
    } else if (!process.argv.includes('--smoke-test') && !process.argv.includes('--diag-windows')) {
      // 已经完成引导的用户再次双击时，之前表现为「什么都没发生」（纯托盘驻留，无任何窗口）。
      // 这里给一个短暂的「已就绪」浮窗作为启动反馈，6 秒后自动收起，不打扰后续操作。
      this.showLaunchHint();
    }""",
    """    // 首次启动引导（M5-T4）
    const quietArgs = ['--smoke-test', '--diag-windows', '--open-settings', '--open-input', '--translate-once', '--quit'];
    if (!this.engine.getConfig().onboarded) {
      this.wm.openOnboarding();
    } else if (!process.argv.some((a) => quietArgs.includes(a))) {
      // 第十二轮需求 2：点击 exe 打开什么由设置页决定（默认打开设置页）
      this.openLaunchTarget();
    }""",
    'main.js startup branch')

rep(p_main,
    "  /** 启动反馈：显示一条提示浮窗，若期间没有新翻译则 6 秒后自动隐藏 */",
    """  /**
   * 「点击 exe / 托盘左键」要打开的窗口（第十二轮需求 2）。
   * 配置项 general.launchAction：'settings'（默认）或 'hud'。
   */
  openLaunchTarget() {
    const action = (this.engine.getConfig().general || {}).launchAction === 'hud' ? 'hud' : 'settings';
    if (action === 'hud') {
      this.showLaunchHint();
      return 'hud';
    }
    this.wm.openSettings('general');
    return 'settings';
  }

  /** 托盘左键：按 launchAction 显示；已经显示则收起（避免「点了没反应」） */
  toggleMainWindow() {
    const action = (this.engine.getConfig().general || {}).launchAction === 'hud' ? 'hud' : 'settings';
    if (action === 'hud') {
      this.toggleHud();
      return;
    }
    const shown = this.wm.toggleSettings('general');
    this.logger.info('托盘切换主窗口', { shown });
  }

  /** 启动反馈：显示一条提示浮窗，若期间没有新翻译则 6 秒后自动隐藏 */""",
    'main.js openLaunchTarget/toggleMainWindow')

print('--- part 2 done, MISS:', MISS)
