# -*- coding: utf-8 -*-
"""第十二轮：改名为「即译」+ 新图标 + 托盘三项菜单 + 任务栏隐藏 + 点击行为可配置。

全部改动带断言，锚点未命中会显式打印 MISS，方便回滚定位。
"""
import io
import os
import re

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
    """count=0 表示替换全部。"""
    t = read(p)
    if old not in t:
        MISS.append(label)
        print('MISS:', label)
        return
    t2 = t.replace(old, new) if count == 0 else t.replace(old, new, count)
    write(p, t2)
    print('ok  :', label)


def rep_block(p, start_marker, end_marker, new_block, label):
    t = read(p)
    i = t.find(start_marker)
    j = t.find(end_marker, i + len(start_marker)) if i >= 0 else -1
    if i < 0 or j < 0:
        MISS.append(label)
        print('MISS:', label)
        return
    j += len(end_marker)
    write(p, t[:i] + new_block + t[j:])
    print('ok  :', label)


# ── 1. 应用名与图标 ────────────────────────────────────────────────────────
rep(path('package.json'), '"name": "desktop-translator"', '"name": "jiyi"', 'package.json name')
t = read(path('package.json'))
if '"productName"' not in t:
    t = t.replace('"name": "jiyi",', '"name": "jiyi",\n  "productName": "即译",', 1)
    write(path('package.json'), t)
print('ok  : package.json productName')

# main.js：AUMID 之后立即设置应用名（影响 app.getName()、托盘提示、窗口标题回退值）
rep(path('src', 'main', 'main.js'),
    "try { app.setAppUserModelId(APP_ID); } catch (e) { /* 忽略：个别系统策略下不可用 */ }",
    "try { app.setAppUserModelId(APP_ID); } catch (e) { /* 忽略：个别系统策略下不可用 */ }\n"
    "// 应用名（第十二轮改名「即译」）：影响 app.getName()、任务管理器显示名、欢迎语。\n"
    "try { app.setName('即译'); } catch (e) { /* 忽略 */ }",
    'main.js app.setName')

# 2. 名称替换：窗口标题、对话框、跳转列表、提示语
for f, pairs in {
    ('src', 'main', 'windows.js'): [
        ("title: '桌面翻译助手',", "title: APP_NAME,"),
        ("title: '桌面翻译助手-悬浮球',", "title: `${APP_NAME}-悬浮球`,"),
        ("title: '桌面翻译助手-框选',", "title: `${APP_NAME}-框选`,"),
        ("title: '桌面翻译助手 - 设置',", "title: `${APP_NAME} · 设置`,"),
        ("title: '桌面翻译助手 - 首次使用',", "title: `${APP_NAME} · 首次使用`,"),
    ],
    ('src', 'main', 'main.js'): [
        ("'桌面翻译助手.exe'", "'即译.exe'"),
        ("message: '桌面翻译助手已经在运行。'", "message: '即译已经在运行。'"),
        ("title: '桌面翻译助手',\n", "title: '即译',\n"),
        ("title: notice.title || '桌面翻译助手',", "title: notice.title || '即译',"),
        ("'桌面翻译助手启动失败',", "'即译启动失败',"),
    ],
}.items():
    p = path(*f)
    for old, new in pairs:
        rep(p, old, new, '%s: %s' % (f[-1], old[:28]))

# windows.js 顶部加 APP_NAME 常量
t = read(path('src', 'main', 'windows.js'))
if 'const APP_NAME' not in t:
    t = t.replace("const path = require('path');",
                  "const path = require('path');\n/** 应用显示名（第十二轮改名「即译」） */\nconst APP_NAME = '即译';", 1)
    write(path('src', 'main', 'windows.js'), t)
    print('ok  : windows.js APP_NAME')
else:
    print('skip: windows.js APP_NAME 已存在')

# ── 3. 设置窗口：关闭＝隐藏（任务栏图标随之消失），打开时恢复任务栏按钮 ──
rep_block(path('src', 'main', 'windows.js'),
          "    // 设置窗口是本应用「任务栏常驻」的载体：",
          "      win.minimize();\n    });",
          """    // 设置窗口是「后台入口」的载体之一。第十二轮用户要求：
    // 关掉设置页与浮窗后任务栏图标消失，但进程继续跑（靠托盘图标再次唤出）。
    // 因此这里改为 hide()：隐藏窗口不会在任务栏留按钮，比 minimize 更符合预期；
    // 真正的退出由「托盘 → 退出」/ 关于页「退出程序」/ --quit 触发（prepareQuit 放行）。
    win.on('close', (e) => {
      if (this._allowClose) return;
      e.preventDefault();
      win.hide();
      win.setSkipTaskbar(true);
    });""",
          'windows.js settings close → hide')

rep(path('src', 'main', 'windows.js'),
    "  openSettings(tab) {",
    "  openSettings(tab) {\n"
    "    // 显示设置窗口时把任务栏按钮加回来（关闭时被 setSkipTaskbar(true) 隐藏了）\n"
    "    const existing = this.wins.settings;\n"
    "    if (existing && !existing.isDestroyed()) { try { existing.setSkipTaskbar(false); } catch { /* ignore */ } }",
    'windows.js openSettings skipTaskbar')

# ── 4. 托盘：只剩三项（设置 / 输入翻译 / 退出），左键切换主窗口 ──────────
rep_block(path('src', 'main', 'tray.js'),
          "  create() {",
          "    return this.tray;\n  }",
          """  create() {
    if (this.tray) return this.tray;
    this.tray = new Tray(trayIcon());
    this.tray.setToolTip(`${app.getName()} · 单击打开 / 右键菜单`);
    // 左键单击：按设置页里的「点击 exe 打开」行为（设置页或浮窗），再点一次收起。
    // 浮窗与设置页都隐藏时任务栏没有图标，托盘是唯一入口，所以单击必须能唤出窗口。
    this.tray.on('click', () => {
      try { this.actions.toggleMainWindow(); } catch (e) { this.logger.warn('托盘点击异常', { code: e && e.code }); }
    });
    this.tray.on('double-click', () => {
      try { this.actions.toggleMainWindow(); } catch (e) { this.logger.warn('托盘双击异常', { code: e && e.code }); }
    });
    this.refresh();
    this._scheduleReassert();
    this._probeBounds();
    return this.tray;
  }
""",
          'tray.js create')

rep_block(path('src', 'main', 'tray.js'),
          "  buildMenu() {",
          "    return Menu.buildFromTemplate(template);",
          """  buildMenu() {
    // 第十二轮：按用户要求只保留三项——设置 / 输入翻译 / 退出。
    // 其余高频操作（暂停、轮询间隔、框选）留在浮窗标题栏与设置页，避免菜单过长点错。
    const template = [
      { label: '设置', click: () => this.actions.openSettings('general') },
      { label: '输入翻译', click: () => this.actions.openSettings('input') },
      { type: 'separator' },
      { label: '退出', click: () => this.actions.quit() },
    ];
    return Menu.buildFromTemplate(template);""",
          'tray.js buildMenu')

# ── 5. 点击 exe 的行为可配置 ───────────────────────────────────────────────
rep(path('src', 'core', 'config', 'defaults.js'),
    "onboarded: false,",
    "onboarded: false,\n    /** 点击 exe / 托盘左键时打开哪个窗口（第十二轮需求） */\n    launchAction: 'settings',",
    'defaults launchAction')

rep(path('src', 'core', 'config', 'store.js'),
    "    const g = next.general;",
    "    const g = next.general;\n"
    "    if (g.launchAction !== 'hud') g.launchAction = 'settings';",
    'store launchAction clamp')

print('--- part 1 done, MISS:', MISS)
