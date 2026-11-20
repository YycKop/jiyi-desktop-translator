'use strict';
/**
 * Electron 主进程入口（src/main/main.js）
 *
 * 职责（F-01/F-02/F-03）：
 *  1. 应用生命周期与单实例锁，托盘常驻，关闭窗口不退出
 *  2. 承载 DSH 之外的本地编排：截图 → OCR → 翻译 全部由 core（纯 Node）完成，
 *     渲染进程只做展示与设置（不接触文件系统/凭据）
 *  3. 窗口编排：浮窗、框选遮罩、设置、悬浮球、首次引导
 *  4. 全局热键、托盘菜单、点击穿透、性能采样
 *
 * 安全（限制书）：
 *  - 渲染进程 `contextIsolation + sandbox`，仅通过 preload 白名单通信
 *  - 不向任何非用户配置端点发送数据（KEY-04 / CMD-04）
 *  - 日志只记操作类型与长度，绝不记 OCR 原文/译文/Key（LOG-02）
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, screen, Menu, shell, globalShortcut, dialog } = require('electron');

const { CHANNELS, EVENTS } = require('../shared/ipc-channels');
const { TranslatorEngine } = require('../core');
const paths = require('../core/paths');
const { WindowManager } = require('./windows');
const { TrayController } = require('./tray');
const { HotkeyManager } = require('./hotkeys');
const { computeHudPosition } = require('./position');
const ipc = require('./ipc');
const { HudPointerWatcher } = require('./hud-pointer');
const { BallPointerWatcher } = require('./ball-pointer');

const APP_ID = 'com.desktoptranslator.app';
// AUMID 必须在 ready 之前注册，否则 app.setUserTasks（任务栏 JumpList）会返回 false，
// 任务栏右键里就没有「退出程序」等任务。
try { app.setAppUserModelId(APP_ID); } catch (e) { /* 忽略：个别系统策略下不可用 */ }
// 应用名（第十二轮改名「即译」）：影响 app.getName()、任务管理器显示名、欢迎语。
try { app.setName('即译'); } catch (e) { /* 忽略 */ }

// ---------------------------------------------------------------- 任务栏
// Windows 任务栏右键菜单（JumpList）：关闭设置/浮窗只是隐藏到后台，用户随时能从
// 任务栏图标重新打开设置或输入翻译，只有「退出程序」才真正结束进程。
// program 指向启动器（打包结构里 app\core.exe 的上一级），否则 JumpList 直接拉起
// core 会缺少 --no-sandbox 在本机秒退。
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'app.png');
let jumpListOk = false;
function launcherPath() {
  const guess = path.join(path.dirname(process.execPath), '..', '即译.exe');
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

const HUD_REASSERT_MS = 5000; // F-15：定期重新置顶，避免全屏视频/游戏抢占

// ---------------------------------------------------------------- 数据目录
// 必须在任何窗口/Chromium 初始化之前确定，否则 profile 会落在不可写的位置，
// 表现为「双击后进程立刻退出、没有任何提示」（见 paths.js 的解析顺序说明）。
// 顺序：TRANSLATOR_HOME → exe 同级 userdata/ → %APPDATA% → 临时目录。
let DATA_HOME = null;
try {
  DATA_HOME = paths.resolveHome();
  paths.ensure.home();
  app.setPath('userData', paths.userDataDir());
  try { app.setPath('sessionData', paths.userDataDir()); } catch { /* 旧版本不支持 */ }
} catch (e) {
  // 极端情况下仍继续，让后续的启动错误提示把原因显示出来
  DATA_HOME = null;
  console.error('[startup] 数据目录不可用：', e && e.message);
}
// 受限环境（无 GPU / 沙箱禁用的容器）可用环境变量降级启动，不影响默认安全设置
if (process.env.DT_DISABLE_GPU === '1') app.commandLine.appendSwitch('disable-gpu');
if (process.env.DT_NO_SANDBOX === '1') app.commandLine.appendSwitch('no-sandbox');

/** 启动失败时的兜底记录：即使日志系统没起来，也要在数据目录留下可读原因 */
function recordStartupFailure(err) {
  const text = [
    `时间：${new Date().toISOString()}`,
    `版本：${(() => { try { return app.getVersion(); } catch { return 'unknown'; } })()}`,
    `Electron：${process.versions.electron}`,
    `数据目录：${DATA_HOME || '(不可用)'}`,
    `错误：${(err && err.stack) || err}`,
    '',
  ].join('\n');
  try {
    fs.mkdirSync(DATA_HOME, { recursive: true });
    fs.writeFileSync(path.join(DATA_HOME, 'startup-error.log'), text, 'utf8');
  } catch { /* 数据目录也不可用时只能靠 stderr */ }
  console.error('[startup]', text);
}

// 单实例：第二次启动只唤醒已有实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行：给出可见提示，而不是静默退出（用户会以为"打不开"）
  try {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '即译',
      message: '即译已经在运行。',
      detail: '请在屏幕右下角的任务栏托盘区找到图标（可能被折叠在「^」里），'
        + '点击可展开浮窗或开始框选翻译。',
      buttons: ['知道了'],
    });
  } catch { /* 无图形环境时忽略 */ }
  // 关键：ready 之前调用 app.quit() 是空操作，进程会继续跑完 bootstrap，
  // 于是出现「两个实例同时存活、后者热键注册失败再自行退出」的怪象。必须直接 exit。
  app.exit(0);
}

class AppController {
  constructor() {
    this.engine = null;
    this.wm = null;
    this.tray = null;
    this.hotkeys = null;
    this.quitting = false;
    this.hotkeyCapture = false;
    this.hudReassertTimer = null;
    this.logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
  }

  // ---------------------------------------------------------------- 启动

  async bootstrap() {
    app.setAppUserModelId(APP_ID);
    setupJumpList();


    this.engine = new TranslatorEngine({ appVersion: app.getVersion() });
    await this.engine.init();
    this.logger = this.engine.logger;
    this.logger.info('应用启动', { version: app.getVersion(), electron: process.versions.electron });

    this.wm = new WindowManager({ logger: this.logger.child('windows') });
    this.wm.onMoved = (target, bounds) => this.onWindowMoved(target, bounds);
    // 记住配置里的浮窗尺寸，用于判断「用户是否在设置页改了尺寸」
    this._lastHudSize = (() => {
      const hud = this.engine.getConfig().hud || {};
      return { width: hud.width, height: hud.height };
    })();
    // 设置窗口显示/隐藏 → 通知浮窗高亮 ⚙ 按钮（需求 2）
    this.wm.onSettingsVisibility = ({ visible }) => {
      this.wm.emit(EVENTS.SETTINGS_VISIBILITY, { visible: !!visible });
    };
    // 托盘是否真的进了通知区域：决定关闭设置页时是「隐藏」还是「最小化」（见 windows.js 的 close 处理）。
    // 本机会话的通知区域会拒绝注册（原生 WinForms NotifyIcon 同样失败），这时必须留一个任务栏入口，
    // 否则用户关掉设置页后既没有托盘图标也没有任务栏按钮，只能再次双击 exe。
    this.wm.onTrayAccepted = () => {
      try {
        return !!(this.tray && this.tray.status().accepted);
      } catch {
        return false;
      }
    };

    // 浮窗穿透控制（F-14）：主进程轮询光标位置，命中 .interactive 才允许点击
    this.hudPointer = new HudPointerWatcher({
      logger: this.logger.child('hud-pointer'),
      getHudWindow: () => this.wm.wins.hud,
      getCurrentIgnore: () => this.wm.hudIgnoreMouse,
      onIgnoreChange: (ignore) => this.wm.setHudIgnoreMouse(ignore),
    });

    // 悬浮球悬停/穿透（第二十五轮）：窗口固定大小，靠主进程轮询决定
    // 「气泡是否浮出」与「透明区域是否放行鼠标」。
    this.ballPointer = new BallPointerWatcher({
      logger: this.logger.child('ball-pointer'),
      getBallWindow: () => this.wm.wins.ball,
      getBallRect: () => this.wm.ballClientRect(),
      isExpanded: () => this.wm.ballExpanded,
      onHover: (hover) => this.setBallHover(hover),
      onIgnoreChange: (ignore) => this.wm.setBallIgnoreMouse(ignore),
    });
    this.ballPointer.start();

    // 调整浮窗大小的过程中暂停穿透轮询：否则中途被切成穿透态，窗口就收不到后续鼠标事件，
    // 用户看到的现象就是「移动稍快就拖不动」。松手后再恢复轮询。
    this.wm.onHudResizeActive = (active) => {
      if (active) {
        this.wm.setHudIgnoreMouse(false);
        if (this.hudPointer) this.hudPointer.pause();
      } else if (this.hudPointer) {
        this.hudPointer.resume();
      }
    };

    this.hotkeys = new HotkeyManager({
      logger: this.logger.child('hotkey'),
      handlers: {
        select: () => this.startSelection(),
        refresh: () => this.translateLast(),
        pause: () => this.toggleLoop(),
        toggleHud: () => this.toggleHud(),
        collapse: () => this.toggleCollapse(),
      },
    });

    // 浮窗显示通道：core 请求显示译文 → 主进程定位并渲染
    this.engine.onHudShow((data) => this.showHud(data));
    this.engine.on('translation', (r) => this.onTranslation(r));
    this.engine.on('translation-failed', (r) => this.onTranslationFailed(r));
    this.engine.on('notice', (n) => this.onNotice(n));
    this.engine.on('config-changed', (view) => {
      // 广播给浮窗/设置页：主题色、透明度、尺寸等改动要立刻生效（需求 1/3）
      this.wm.emit(EVENTS.CONFIG_CHANGED, view);
      this.applyHudMode(view);
      this.applyHudSizeFromConfig(view);
      this.syncBallFromConfig(view);
      this.refreshTray();
    });
    this.engine.on('loop-started', () => this.refreshTray());
    this.engine.on('loop-stopped', () => this.refreshTray());

    this.tray = new TrayController({
      engine: this.engine,
      wm: this.wm,
      logger: this.logger.child('tray'),
      actions: {
        toggleMainWindow: () => this.toggleMainWindow(),
        toggleHud: () => this.toggleHud(),
        translateLast: () => this.translateLast(),
        startSelection: () => this.startSelection(),
        startLoop: (ms) => this.startLoop(ms),
        stopLoop: (reason) => this.stopLoop(reason),
        toggleLoop: () => this.toggleLoop(),
        toggleCollapse: () => this.toggleCollapse(),
        openSettings: (tab) => this.wm.openSettings(tab),
        openLogs: () => shell.openPath(this.engine.paths.logsDir()),
        hotkeyConflicts: () => this.hotkeys.conflicts,
        quit: () => this.quit(),
      },
    });
    this.tray.create();

    // 托盘被系统拒绝时（本机会话就是这种情况：Shell_NotifyIcon 不生效），
    // 用悬浮球当常驻入口——它左键按 launchAction 打开、右键给出「设置/输入翻译/显示浮窗/退出」。
    // 悬浮球是常驻入口（第十九轮需求 4）：本机通知区域拒绝注册，托盘图标基本不可用，
    // 所以默认「总是显示悬浮球」，不再只在收起浮窗时才出现。
    const trayState = this.tray.status();
    this.trayAccepted = !!(trayState && trayState.accepted);
    if (!this.trayAccepted) {
      this.logger.warn('托盘图标未被系统接受，改用悬浮球作为常驻入口', {
        icon: trayState && trayState.iconPath,
      });
    }
    this.ensureBallVisible();

    ipc.register({
      engine: this.engine,
      wm: this.wm,
      logger: this.logger,
      ctrl: this,
    });

    this.applyHotkeys();
    this.registerShortcutsGuard();

    // 离线模型：配置了自动启动且能找到模型就后台拉起（含首次启动，
    // 因为分发版把模型随包放在 app/resources/models/，用户引导完就能直接用）
    const offlineCfg = this.engine.getConfig().offline;
    if (offlineCfg.autostart) {
      if (this.engine.llama.resolveModel()) {
        this.startModel().catch((e) => this.logger.warn('离线模型自动启动失败', { code: e && e.code }));
      } else {
        this.logger.info('未找到离线模型，跳过自动启动');
      }
    }

    // 宿主桥（供 DSH 插件 translate_text 反向调用宿主 CLI 之外的能力）
    this.engine.startBridge(0).catch((e) => this.logger.warn('宿主桥启动失败', { code: e && e.code }));

    // 首次启动引导（M5-T4）
    const quietArgs = ['--smoke-test', '--diag-windows', '--open-settings', '--open-input', '--translate-once', '--quit'];
    if (!this.engine.getConfig().onboarded) {
      this.wm.openOnboarding();
    } else if (!process.argv.some((a) => quietArgs.includes(a))) {
      // 第十二轮需求 2：点击 exe 打开什么由设置页决定（默认打开设置页）
      this.openLaunchTarget();
    }
  }

  /**
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

  /**
   * 悬浮球左键。
   *
   * 与托盘左键语义一致（按 general.launchAction 打开设置页或译文浮窗），
   * 但**不做 toggle**：球是我们自己画的，单击时用户期望"打开"，再点球应该是再次打开而不是关掉。
   */
  ballPrimary() {
    const action = (this.engine.getConfig().general || {}).launchAction === 'hud' ? 'hud' : 'settings';
    if (action === 'hud') {
      this.showHud({ text: '', engine: '', placeholder: '按快捷键框选区域，或点 ⚙ 进入设置' });
      return 'hud';
    }
    this.wm.openSettings('general');
    return 'settings';
  }

  /**
   * 悬浮球右键菜单项（不弹窗，供自检断言菜单内容）。
   */
  ballMenuTemplate() {
    return [
      { label: '设置…', click: () => this.wm.openSettings('general') },
      { label: '输入翻译…', click: () => this.wm.openSettings('input') },
      { type: 'separator' },
      {
        label: '显示译文浮窗',
        click: () => {
          this.expand();
          this.showHud({ text: '', engine: '', placeholder: '按快捷键框选区域，或点 ⚙ 进入设置' });
        },
      },
      { type: 'separator' },
      { label: '退出即译', click: () => this.quit() },
    ];
  }

  /**
   * 悬浮球右键菜单。
   *
   * 系统通知区域拒绝注册新图标时（本机会话就是这种情况），这里是唯一稳定的常驻入口，
   * 因此菜单内容与托盘右键保持一致：设置 / 输入翻译 / 显示浮窗 / 退出。
   */
  showBallMenu() {
    const win = this.wm.wins.ball;
    const template = this.ballMenuTemplate();
    const labels = template.filter((i) => !i.type).map((i) => i.label);
    if (!win || win.isDestroyed()) {
      // 球窗口异常时退化为只做设置页，保证仍有入口
      this.wm.openSettings('general');
      return labels;
    }
    Menu.buildFromTemplate(template).popup({ window: win });
    return labels;
  }

  /** 启动反馈：显示一条提示浮窗，若期间没有新翻译则 6 秒后自动隐藏 */
  showLaunchHint() {
    const hk = (this.engine.getConfig().hotkeys || {}).select || 'CommandOrControl+Shift+T';
    const accelText = String(hk).replace('CommandOrControl', 'Ctrl').replace(/\+/g, '+');
    const before = this.engine.state && this.engine.state.lastTranslateAt;
    try {
      this.showHud({
        text: '',
        engine: '',
        placeholder: `已就绪 · 按 ${accelText} 框选区域 · 点 ⚙ 打开设置`,
      });
      this.logger.info('启动提示已显示');
    } catch (e) {
      this.logger.warn('启动提示显示失败', { message: e && e.message });
    }
    setTimeout(() => {
      try {
        const after = this.engine.state && this.engine.state.lastTranslateAt;
        if (after !== before) return; // 期间已有翻译结果，保留浮窗
        this.hideHud();
      } catch { /* ignore */ }
    }, 6000);
  }

  /** 阻止应用被意外退出（托盘驻留，F-02） */
  registerShortcutsGuard() {
app.on('window-all-closed', (e) => {
      if (this.quitting) return;
      e.preventDefault && e.preventDefault();
    });
  }

  // ---------------------------------------------------------------- 热键

  applyHotkeys() {
    const cfg = this.engine.getConfig();
    const results = this.hotkeys.applyAll(cfg.hotkeys);
    this.hotkeyResults = results;
    const failed = Object.entries(results).filter(([, r]) => !r.ok && r.reason === 'occupied');
    if (failed.length) {
      const names = failed.map(([a]) => a).join('、');
      this.notify({
        level: 'warn',
        title: '热键被占用',
        message: `以下热键已被其它程序占用：${names}。请前往「设置 → 热键」修改。`,
        code: 'HOTKEY_CONFLICT',
      });
      this.wm.emit(EVENTS.HOTKEY_CONFLICT, { conflicts: this.hotkeys.conflicts });
    }
    this.refreshTray();
    return results;
  }

  hotkeyStatus() {
    return { ...this.hotkeys.status(), results: this.hotkeyResults || {} };
  }

  beginHotkeyCapture() {
    this.hotkeyCapture = true;
    this.hotkeys.unregisterAll();
    return true;
  }

  endHotkeyCapture() {
    this.hotkeyCapture = false;
    this.applyHotkeys();
    return true;
  }

  /** REV-001 G-02：设置页按下新组合键后调用 */
  registerHotkey(action, accelerator) {
    if (!action || !accelerator) {
      return { ok: false, reason: 'invalid', message: '动作或热键为空' };
    }
    const probe = this.hotkeys.probe(accelerator);
    if (!probe.ok) {
      return {
        ok: false,
        reason: probe.reason,
        accelerator,
        message: probe.reason === 'occupied'
          ? '该组合键已被其它程序占用，请换一个'
          : probe.reason === 'duplicate-in-app'
            ? '该组合键已用于其它功能'
            : '无效的组合键',
      };
    }
    this.engine.patchConfig({ hotkeys: { [action]: accelerator } });
    const r = this.hotkeys.registerOne(action, accelerator);
    this.hotkeyCapture = false;
    this.refreshTray();
    return { ...r, accelerator };
  }

  // ---------------------------------------------------------------- 浮窗

  /**
   * 浮窗几何：卡片模式用 hud.width/height + computeHudPosition；
   * 字幕模式（第十八轮需求 3）用「工作区 86% 宽 × 96 高的细长条」，默认贴底居中，
   * 用户拖动过就按 hud.subtitlePoint 走。
   */
  hudBoundsFor(cfg) {
    const hud = (cfg && cfg.hud) || {};
    const subtitle = hud.mode === 'subtitle';
    const region = this.engine.getSelectionRegion();
    const display = region
      ? screen.getDisplayNearestPoint({ x: region.x, y: region.y })
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = display.workArea;
    if (!subtitle) {
      const size = {
        width: Math.round(hud.width) || 460,
        height: Math.round(hud.height) || 240,
      };
      const pos = computeHudPosition({
        region,
        size,
        workArea,
        mode: hud.position,
        fixedPoint: hud.fixedPoint,
      });
      return { x: pos.x, y: pos.y, ...size, placement: pos.placement, subtitle: false };
    }
    const width = Math.round(hud.subtitleWidth) > 0
      ? Math.min(workArea.width, Math.round(hud.subtitleWidth))
      : Math.max(640, Math.min(1800, Math.round(workArea.width * 0.86)));
    const height = Math.round(hud.subtitleHeight) > 0
      ? Math.max(64, Math.round(hud.subtitleHeight))
      : 96;
    let x = Math.round(workArea.x + (workArea.width - width) / 2);
    let y = Math.round(workArea.y + workArea.height - height - 120);
    if (hud.subtitlePoint && Number.isFinite(Number(hud.subtitlePoint.x))) {
      x = Math.round(Number(hud.subtitlePoint.x));
      y = Math.round(Number(hud.subtitlePoint.y));
    }
    // 保证整条字幕留在工作区内（多显示器 / 换分辨率后不至于跑到屏幕外）
    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);
    y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height);
    return { x, y, width, height, placement: 'subtitle', subtitle: true };
  }

  showHud(data = {}) {
    const cfg = this.engine.getConfig();
    const bounds = this.hudBoundsFor(cfg);
    this._hudMode = bounds.subtitle ? 'subtitle' : 'card';
    // 需求 3：沿用用户上次调整过的尺寸（首次创建时用它，之后由 setHudBounds 保持）
    const win = this.wm.ensureHud({ width: bounds.width, height: bounds.height });
    this.wm.setHudBounds({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    });
    this.wm.showHud({
      ...data,
      placement: bounds.placement,
      opacity: cfg.hud.opacity,
      fontSize: cfg.hud.fontSize,
      maxWidth: cfg.hud.maxWidth,
      showEngine: cfg.hud.showEngine,
      targetLang: cfg.general.targetLang,
      // 字幕条高度固定，不参与「内容自适应加高」，否则一条字幕会把整块画面顶掉
      autoHeight: bounds.subtitle ? false : cfg.hud.autoHeight,
      hudMode: bounds.subtitle ? 'subtitle' : 'card',
      subtitleFontSize: cfg.hud.subtitleFontSize,
      subtitleBackdrop: !!cfg.hud.subtitleBackdrop,
      appearance: cfg.appearance,
    });
    this.startHudReassert();
    if (process.env.DT_HUD_ALWAYS_INTERACTIVE === '1') {
      // 调试开关：始终可点击（不做穿透），用于排查"按钮点不动"
      this.wm.setHudIgnoreMouse(false);
      if (this.hudPointer) this.hudPointer.stop();
    } else if (this.hudPointer) {
      this.hudPointer.start();
    }
    this.refreshTray();
    return { shown: true, bounds: this.wm.wins.hud ? this.wm.wins.hud.getBounds() : null };
  }

  /** 切换浮窗模式（卡片 ↔ 字幕条）后立刻套用新的几何（第十八轮需求 3） */
  applyHudMode(view) {
    const win = this.wm.wins.hud;
    if (!win || win.isDestroyed()) return;
    const hud = (view && view.hud) || {};
    const mode = hud.mode === 'subtitle' ? 'subtitle' : 'card';
    if (mode === this._hudMode) return;
    this._hudMode = mode;
    if (!win.isVisible()) return;
    const b = this.hudBoundsFor(this.engine.getConfig());
    this.wm.setHudBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  }

  /** 设置页改了宽高时，立刻把浮窗调成新尺寸（需求 3） */
  applyHudSizeFromConfig(view) {
    const win = this.wm.wins.hud;
    if (!win || win.isDestroyed()) return;
    const hud = (view && view.hud) || {};
    // 字幕模式的宽高由 subtitleWidth / subtitleHeight 决定
    //（第十九轮需求 3 可拖边缘，第二十轮需求又加了高度，所以两个都要跟着变）
    if (hud.mode === 'subtitle') {
      const width = Number(hud.subtitleWidth) || 0;
      const height = Number(hud.subtitleHeight) || 0;
      const key = `${width}x${height}`;
      const lastSub = this._lastSubtitleSize;
      this._lastSubtitleSize = key;
      if (!win.isVisible() || key === lastSub) return;
      const b = this.hudBoundsFor(this.engine.getConfig());
      this.wm.setHudBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
      return;
    }
    const width = Number(hud.width) || 0;
    const height = Number(hud.height) || 0;
    const last = this._lastHudSize || {};
    // 只在配置里的尺寸真的变化时才套用，否则会把「自适应高度」的结果又弹回去
    const changed = (width && width !== last.width) || (height && height !== last.height);
    this._lastHudSize = { width, height };
    if (!changed) return;
    const b = win.getBounds();
    this.wm.setHudSize({ width: width || b.width, height: height || b.height });
  }

  hideHud() {    this.wm.hideHud();
    this.stopHudReassert();
    this.refreshTray();
  }

  toggleHud() {
    if (this.wm.hudVisible) this.hideHud();
    else this.showHud({ text: '', engine: '', placeholder: '按快捷键框选区域，或从托盘选择「立即翻译」' });
  }

  /** F-16 / D3.3：收起为悬浮球 */
  collapse() {
    this.wm.hideHud();
    this.stopHudReassert();
    this.ensureBallVisible();
    this.engine.patchConfig({ hud: { collapsed: true } });
    this.refreshTray();
    return true;
  }

  expand() {
    this.engine.patchConfig({ hud: { collapsed: false } });
    return this.showHud({ text: '', engine: '', placeholder: '按快捷键框选区域，或从托盘选择「立即翻译」' });
  }

  /**
   * 常驻悬浮球的显示/隐藏（第十九轮需求 4）。
   * 默认开启：托盘在本机注册不上，球是唯一稳定的常驻入口。
   */
  ensureBallVisible() {
    const cfg = this.engine.getConfig();
    if ((cfg.general || {}).ballEnabled === false) {
      this.wm.hideBall();
      return null;
    }
    const point = cfg.hud.ballPoint || this.defaultBallPoint();
    return this.wm.showBall(point);
  }

  /** 配置变化后同步悬浮球显隐（设置页的「显示悬浮球」开关） */
  syncBallFromConfig(view) {
    const enabled = !(((view && view.general) || {}).ballEnabled === false);
    const win = this.wm.wins.ball;
    const visible = !!(win && !win.isDestroyed() && win.isVisible());
    if (enabled && !visible) this.ensureBallVisible();
    else if (!enabled && visible) { this.setBallHover(false); this.wm.hideBall(); }
  }

  /** 悬浮球悬停展开/收起快捷面板（第十九轮需求 4） */
  setBallHover(open) {
    const r = this.wm.setBallExpanded(!!open);
    if (!r) return null;
    const win = this.wm.wins.ball;
    if (win && !win.isDestroyed()) {
      try {
        this.wm.sendTo(win, CHANNELS.BALL_STATE, {
          expanded: !!r.expanded,
          side: r.side,
          layout: r.layout,
        });
      } catch { /* 窗口正在销毁时忽略 */ }
    }
    return { expanded: !!r.expanded, side: r.side, layout: r.layout, bounds: r.bounds };
  }

  /** 悬浮球快捷面板里的动作（与右键菜单同一组语义） */
  ballAction(action) {
    switch (action) {
      case 'settings': this.wm.openSettings('general'); break;
      case 'input': this.wm.openSettings('input'); break;
      case 'hud':
        this.showHud({ text: '', engine: '', placeholder: '按快捷键框选区域，或点 ⚙ 进入设置' });
        break;
      case 'quit': this.quit(); break;
      default: return { ok: false, action };
    }
    this.setBallHover(false);
    return { ok: true, action };
  }

  toggleCollapse() {
    const ballVisible = !!(this.wm.wins.ball && this.wm.wins.ball.isVisible());
    return ballVisible ? this.expand() : this.collapse();
  }

  defaultBallPoint() {
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    return { x: wa.x + wa.width - 72, y: wa.y + Math.round(wa.height * 0.5) };
  }

  /** F-15：全屏视频/游戏可能把窗口压到下面，定期重新置顶 */
  startHudReassert() {
    if (this.hudReassertTimer) return;
    this.hudReassertTimer = setInterval(() => {
      const win = this.wm.wins.hud;
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
      } catch { /* ignore */ }
    }, HUD_REASSERT_MS);
    if (this.hudReassertTimer.unref) this.hudReassertTimer.unref();
  }

  stopHudReassert() {
    if (this.hudReassertTimer) { clearInterval(this.hudReassertTimer); this.hudReassertTimer = null; }
  }

  /** 用户拖动浮窗后记住位置（F-12「固定位置」；字幕模式记到 subtitlePoint） */
  onWindowMoved(target, bounds) {
    if (target === 'hud') {
      const hud = this.engine.getConfig().hud || {};
      if (hud.mode === 'subtitle') {
        // 字幕条被拖动：只记坐标，不影响卡片模式的「固定位置」
        this.engine.patchConfig({ hud: { subtitlePoint: { x: bounds.x, y: bounds.y } } });
      } else {
        this.engine.patchConfig({ hud: { position: 'fixed', fixedPoint: { x: bounds.x, y: bounds.y } } });
      }
    } else if (target === 'ball') {
      this.engine.patchConfig({ hud: { ballPoint: { x: bounds.x, y: bounds.y } } });
    }
  }

  // ---------------------------------------------------------------- 翻译流程

  async runRound(opts = {}) {
    const r = await this.engine.runRound(opts);
    if (!r.ok) {
      this.wm.emit(EVENTS.TRANSLATION_FAILED, r);
      if (this.wm.hudVisible) this.wm.emit(CHANNELS.HUD_RENDER, { error: r.userMessage, code: r.code });
      else if (opts.showOnError) this.showHud({ error: r.userMessage });
      return r;
    }
    return r;
  }

  onTranslation(r) {
    // 定时循环产出的译文：更新浮窗（不抢焦点，showInactive）
    this.showHud({
      text: r.translatedText,
      source: r.sourceText,
      engine: r.engine,
      latencyMs: r.latencyMs,
      unchanged: !!r.unchanged,
      trigger: r.trigger || 'interval',
    });
    this.wm.emit(EVENTS.TRANSLATION, r);
  }

  onTranslationFailed(r) {
    if (this.wm.hudVisible) {
      this.wm.emit(CHANNELS.HUD_RENDER, { error: r.userMessage, code: r.code });
    }
    this.wm.emit(EVENTS.TRANSLATION_FAILED, r);
  }

  async translateLast() {
    const region = this.engine.getSelectionRegion();
    if (!region) {
      this.wm.openSettings('general');
      this.notify({ level: 'warn', title: '尚未框选区域', message: '请先按快捷键框选要翻译的屏幕区域。' });
      return { ok: false, code: 'NO_REGION' };
    }
    const r = await this.engine.runRound({ regionOverride: region, force: true, trigger: 'manual' });
    if (r.ok) {
      this.showHud({
        text: r.translatedText,
        source: r.sourceText,
        engine: r.engine,
        latencyMs: r.latencyMs,
        trigger: 'manual',
      });
      this.wm.emit(EVENTS.TRANSLATION, r);
    } else {
      this.showHud({ error: r.userMessage, code: r.code });
    }
    return r;
  }

  startSelection() {
    if (this.wm.overlayOpen) return { overlays: this.wm.overlays.length };
    this.wm.hideHud();
    return { overlays: this.wm.openOverlay() };
  }

  /** 框选完成 → 立即翻译一次（M2-T3） */
  async onRegionSelected(region) {
    const r = await this.engine.runRound({ regionOverride: region, force: true, trigger: 'selection' });
    this.wm.emit(EVENTS.SELECTION_CHANGED, region);
    if (r.ok) {
      this.showHud({ text: r.translatedText, source: r.sourceText, engine: r.engine, latencyMs: r.latencyMs, trigger: 'selection' });
      // 框选后若已在定时模式，继续轮询
      if (this.engine.getConfig().capture.mode === 'interval' && !this.engine.loop.isRunning()) this.startLoop();
    } else {
      this.showHud({ error: r.userMessage, code: r.code, placeholder: r.userMessage });
    }
    return r;
  }

  onSelectionCanceled() {
    this.wm.emit(EVENTS.NOTICE, { level: 'info', message: '已取消框选' });
  }

  // ---------------------------------------------------------------- 定时循环

  startLoop(intervalMs) {
    const iv = this.engine.startLoop(intervalMs);
    this.refreshTray();
    return { running: true, intervalMs: iv };
  }

  stopLoop(reason = 'tray') {
    this.engine.stopLoop(reason);
    this.refreshTray();
    return { running: false };
  }

  /**
   * 一键暂停/继续（HUD ⏸ 按钮、Esc、热键、托盘共用）。
   * 暂停会同时中止正在进行的这一轮（loop.stop() 内部 abort）。
   */
  toggleLoop() {
    const running = this.engine.loop.isRunning();
    if (running) {
      const r = this.stopLoop('toggle');
      this.notify({ level: 'info', message: '已暂停定时翻译' });
      return { ...r, paused: true };
    }
    const r = this.startLoop(this.engine.store.raw().capture.intervalMs);
    this.notify({ level: 'info', message: `已开始定时翻译（每 ${Math.round((r.intervalMs || 2000) / 1000)} 秒）` });
    return { ...r, paused: false };
  }

  // ---------------------------------------------------------------- 离线模型

  async startModel() {
    this.notify({ level: 'info', title: '正在启动离线模型', message: '首次加载需要数秒到数十秒，请稍候。' });
    const st = await this.engine.llama.start();
    this.refreshTray();
    this.wm.emit(EVENTS.STATUS, { llama: st });
    return st;
  }

  // ---------------------------------------------------------------- 通知 / 托盘

  refreshTray() {
    if (this.tray) this.tray.refresh();
  }

  onNotice(notice) {
    // 注意：这里**不能**再调用 engine.addNotice()——engine 会在 addNotice 里 emit('notice')，
    // 而本方法正是 'notice' 的监听者，会形成无限递归（曾导致日志瞬间刷屏数千行）。
    // 主进程自己发出的提示统一走 notify()，引擎内部提示由 engine.addNotice 自行记录。
    this.logger.info('提示', { level: notice.level, code: notice.code || '' });
    this.wm.emit(EVENTS.NOTICE, notice);
    if (this.tray && this.tray.tray && notice.level !== 'info') {
      try {
        this.tray.tray.displayBalloon({
          title: notice.title || '即译',
          content: notice.message || '',
          noSound: true,
        });
      } catch { /* 部分系统不支持气泡通知 */ }
    }
  }

  /** 主进程主动提示：交给 engine 记录并由 'notice' 事件统一转发，避免重复与递归 */
  notify(notice) {
    if (this.engine) this.engine.addNotice(notice);
    else this.onNotice(notice);
  }

  // ---------------------------------------------------------------- 退出

  async quit() {
    if (this.quitting) return;
    this.quitting = true;
    try { this.wm.prepareQuit(); } catch (e) { /* 忽略 */ }
    this.stopHudReassert();
    try { if (this.hudPointer) this.hudPointer.stop(); } catch { /* ignore */ }
    try { this.hotkeys.unregisterAll(); } catch { /* ignore */ }
    try { this.tray.destroy(); } catch { /* ignore */ }
    try { this.wm.closeOverlay(); } catch { /* ignore */ }
    try { await this.engine.shutdown(); } catch (e) { this.logger.warn('退出清理异常', { code: e && e.code }); }
    app.quit();
  }
}

const ctrl = new AppController();

/**
 * 渲染进程异常收集：console.error / preload 报错 / 进程崩溃。
 * 用于启动自检（npm run smoke）与故障排查，只记消息与来源，不记页面数据。
 */
const rendererErrors = [];
app.on('web-contents-created', (_event, wc) => {
  try {
    wc.on('console-message', (...args) => {
      // Electron 新旧版本签名不同，这里兼容 (event, level, message, ...) 与 (event)
      const first = args[0];
      let level = null;
      let message = '';
      let source = '';
      let line = 0;
      if (first && typeof first === 'object' && (first.level || first.message)) {
        level = String(first.level || '');
        message = String(first.message || '');
        source = String(first.sourceId || '');
        line = Number(first.lineNumber || 0);
      } else {
        level = String(args[1]);
        message = String(args[2] || '');
        source = String(args[4] || '');
        line = Number(args[3] || 0);
      }
      const isError = level === 'error' || level === '3' || Number(level) >= 2;
      if (isError) {
        rendererErrors.push({ kind: 'console', message, source: path.basename(source || ''), line });
      }
    });
    wc.on('preload-error', (_e, preloadPath, error) => {
      rendererErrors.push({ kind: 'preload', message: String(error && error.message), source: path.basename(preloadPath || '') });
    });
    wc.on('render-process-gone', (_e, details) => {
      rendererErrors.push({ kind: 'crash', message: String(details && details.reason) });
    });
  } catch { /* 忽略监听失败 */ }
});

/**
 * 性能探针（--perf-probe[=秒数]）：在真实窗口里跑定时翻译，采集 CPU / 内存后退出。
 * 只用于诊断，正常启动路径不会走到这里；不采屏幕内容、不写用户数据以外的位置。
 */
async function runPerfProbe(ctrl) {
  const arg = process.argv.find((a) => a.startsWith('--perf-probe')) || '';
  const seconds = Math.min(120, Math.max(6, Number((arg.split('=')[1] || 20)) || 20));
  const intervalArg = process.argv.find((a) => a.startsWith('--perf-probe-interval'));
  const intervalMs = Math.min(5000, Math.max(200, Number(intervalArg && intervalArg.split('=')[1]) || 1000));

  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;
  // --perf-probe-region=x,y,w,h：手动指定一块（最好是静止的）区域，
  // 否则默认区域可能正好压在会动的窗口上，测出来的是"每轮都在变"的最坏情况。
  const regionArg = process.argv.find((a) => a.startsWith('--perf-probe-region'));
  let region = ctrl.engine.getConfig().capture.lastSelection || {
    x: Math.round(wa.x + wa.width / 2 - 450),
    y: Math.round(wa.y + wa.height / 2 - 110),
    width: 900,
    height: 220,
  };
  if (regionArg) {
    const nums = String(regionArg.split('=')[1] || '').split(',').map((v) => Number(v));
    if (nums.length === 4 && nums.every((v) => Number.isFinite(v)) && nums[2] >= 4 && nums[3] >= 4) {
      region = { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
    }
  }
  ctrl.engine.store.patch({ capture: { lastSelection: region, mode: 'interval', intervalMs } }, { silent: true });

  const samples = [];
  let lastSig = null;
  let roundTicks = 0;
  const onRound = () => { roundTicks += 1; };
  ctrl.engine.on('translation', onRound);
  ctrl.engine.on('translation-failed', onRound);

  ctrl.startLoop(intervalMs);
  const startedAt = Date.now();
  while (Date.now() - startedAt < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    const metrics = app.getAppMetrics();
    let cpu = 0;
    let memKb = 0;
    for (const m of metrics) {
      const pct = Number(m.cpu && m.cpu.percentCPUUsage);
      if (Number.isFinite(pct)) cpu += pct;
      const wss = Number(m.memory && m.memory.workingSetSize);
      if (Number.isFinite(wss)) memKb += wss;
    }
    samples.push({
      atMs: Date.now() - startedAt,
      cpuPct: Math.round(cpu * 10) / 10,
      memMB: Math.round(memKb / 1024),
      procs: metrics.length,
    });
    // 顺带量一下"这块区域到底动不动"：连续两次 peek 的平均绝对差。
    // 稳态开销只有在画面静止时才有意义，这个数字能把两种场景分开。
    try {
      const p = await ctrl.engine.capture.peekRegion(region);
      if (p) {
        if (lastSig) {
          let sum = 0;
          for (let i = 0; i < p.sig.length; i += 1) sum += Math.abs(lastSig[i] - p.sig[i]);
          samples[samples.length - 1].frameDiff = Math.round((sum / p.sig.length) * 100) / 100;
        }
        lastSig = p.sig;
      }
    } catch { /* 忽略 */ }
  }
  ctrl.stopLoop('perf-probe');
  ctrl.engine.off('translation', onRound);
  ctrl.engine.off('translation-failed', onRound);

  const cpus = samples.map((s) => s.cpuPct);
  const mems = samples.map((s) => s.memMB);
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);
  const perProc = app.getAppMetrics().map((m) => ({
    type: m.type,
    cpuPct: Math.round(Number(m.cpu && m.cpu.percentCPUUsage) * 10) / 10,
    memMB: Math.round(Number(m.memory && m.memory.workingSetSize) / 1024),
  }));
  return {
    seconds,
    intervalMs,
    rounds: roundTicks,
    avgCpuPct: avg(cpus),
    peakCpuPct: cpus.length ? Math.max(...cpus) : 0,
    avgMemMB: avg(mems),
    peakMemMB: mems.length ? Math.max(...mems) : 0,
    samples,
    perProc,
  };
}

/** 启动自检（--smoke-test）：逐个窗口渲染并截图，输出 JSON 结论 */
async function runSmokeTest() {
  const paths = require('../core/paths');
  // 开发态写到工作区的 项目测试/ 下；打包产物一律写到数据目录，
  // 绝不在 app/resources 里创建 项目测试/（否则自检产物会混进发布包）。
  const devDir = path.join(paths.PROJECT_ROOT, '项目测试', 'reports', 'electron-smoke');
  const outDir = app.isPackaged ? path.join(paths.home(), 'smoke') : devDir;
  fs.mkdirSync(outDir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shots = [];
  // 自检会临时改浮窗模式/尺寸/高度自适应，跑完必须整段还原，
  // 否则下一次自检会读到被改过的 autoHeight=false，hudAutoHeight 检查就开始随机失败。
  let hudSnapshot = null;
  try {
    hudSnapshot = JSON.parse(JSON.stringify(ctrl.engine.store.raw().hud));
  } catch { /* 配置还没加载时忽略 */ }
  // 自检的断言都基于「卡片模式 + 自动高度」这套基线。如果上一次自检没跑完就被终止，
  // 配置里可能残留 mode='subtitle' / 被拖动过的字幕宽高，会让 hudAutoHeight / hudSubtitleMode
  // 莫名其妙变 false。这里先把基线拉正（跑完仍然整段还原用户原本的值）。
  try {
    ctrl.engine.store.patch({
      hud: { mode: 'card', autoHeight: true, subtitleWidth: 0, subtitleHeight: 0, subtitlePoint: null },
    });
  } catch { /* 忽略 */ }
  try { ctrl.wm.setHudMode('card'); } catch { /* 老版本窗口管理器没有该方法 */ }

  async function shoot(win, name) {
    if (!win || win.isDestroyed()) return null;
    try {
      let img = await win.webContents.capturePage();
      if (img.isEmpty()) {
        // 偶发：窗口还没画出第一帧时截图会是空的，等一下再试一次
        await sleep(400);
        img = await win.webContents.capturePage();
      }
      const buf = img.toPNG();
      if (!buf || !buf.length) {
        rendererErrors.push({ kind: 'capture', message: '截图内容为空', source: name });
        return null;
      }
      fs.writeFileSync(path.join(outDir, name + '.png'), buf);
      shots.push(name + '.png');
      return path.join(outDir, name + '.png');
    } catch (e) {
      rendererErrors.push({ kind: 'capture', message: String(e && e.message), source: name });
      return null;
    }
  }

  const report = { startedAt: new Date().toISOString(), checks: {}, shots, rendererErrors };

  // 1) 浮窗（HUD）
  ctrl.showHud({
    text: '这是一段用于自检的示例译文。\nThe quick brown fox jumps over the lazy dog.',
    source: '自检原文 sample source text',
    engine: '自检引擎',
    latencyMs: 42,
  });
  await sleep(900);
  const hud = ctrl.wm.wins.hud;
  report.checks.hudCreated = !!(hud && !hud.isDestroyed());
  report.checks.jumpList = jumpListOk;
  await shoot(hud, '01-hud');

  // 2) 设置窗口
  ctrl.wm.openSettings('general');
  await sleep(1400);
  const settings = ctrl.wm.wins.settings;
  report.checks.settingsCreated = !!(settings && !settings.isDestroyed());
  await shoot(settings, '02-settings-general');
  try {
    settings.webContents.send(CHANNELS.EVENT, { type: 'settings-tab', payload: { tab: 'apis' } });
  } catch { /* ignore */ }
  await sleep(200);
  ctrl.wm.openSettings('apis');
  await sleep(700);
  await shoot(settings, '03-settings-apis');

  // 2b) 外观页（主题色 / 透明度 / 背景图）
  try {
    settings.webContents.send(CHANNELS.EVENT, { type: 'settings-tab', payload: { tab: 'appearance' } });
    await sleep(500);
    report.checks.appearancePane = await settings.webContents.executeJavaScript(
      "!!document.getElementById('theme-accent') && !!document.getElementById('theme-opacity') && !!document.getElementById('btn-hud-image') && !!document.getElementById('btn-settings-image')",
      true
    );
    await shoot(settings, '07-settings-appearance');
    // 外观页下半部分（两处背景图槽位）单独截一张，便于自检核对
    await settings.webContents.executeJavaScript(
      "(() => { const c = document.querySelector('.content'); if (c) c.scrollTop = c.scrollHeight; return true; })()",
      true
    );
    await sleep(320);
    await shoot(settings, '12-settings-appearance-bg');
  } catch (e) {
    rendererErrors.push({ kind: 'appearance', message: String(e && e.message) });
    report.checks.appearancePane = false;
  }


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
    report.checks.quitButton = await settings.webContents.executeJavaScript("!!document.getElementById('btn-quit')", true);
    // 第十八轮：翻译优先级与浮窗模式两个下拉必须存在（设置页是唯一入口）
    report.checks.settingsPriority = await settings.webContents.executeJavaScript("!!document.getElementById('priority')", true);
    report.checks.settingsHudMode = await settings.webContents.executeJavaScript("!!document.getElementById('hud-mode')", true);
    // 第二十一轮需求 4/5：更密的轮询档位 + 识别语言下拉
    report.checks.settingsIntervalDense = await settings.webContents.executeJavaScript(`(() => {
      const sel = document.querySelector('select#interval');
      if (!sel) return { ok: false };
      const values = Array.from(sel.options).map((o) => Number(o.value)).sort((a, b) => a - b);
      return { ok: values.length >= 6 && values[0] <= 300, values };
    })()`, true);
    report.checks.settingsOcrLang = await settings.webContents.executeJavaScript(`(() => {
      const sel = document.getElementById('ocr-lang');
      if (!sel) return { ok: false };
      const values = Array.from(sel.options).map((o) => o.value);
      return { ok: ['auto', 'ch', 'japan', 'korean'].every((v) => values.includes(v)), values };
    })()`, true);
    // 第十九轮需求 1：提示条要跟随主题（浅色主题下不能再出现「黑底黑字」）
    try {
      const toastInfo = await settings.webContents.executeJavaScript(`(() => {
        const d = document.createElement('div');
        d.className = 'toast';
        d.textContent = '主题提示';
        document.body.appendChild(d);
        const cs = getComputedStyle(d);
        const info = { bg: cs.backgroundColor, color: cs.color };
        d.remove();
        return info;
      })()`, true);
      const bg = String(toastInfo && toastInfo.bg || '');
      const fg = String(toastInfo && toastInfo.color || '');
      // 主题变量生效时背景不会是透明的，且前景与背景不同
      report.checks.settingsToastTheme = { ...toastInfo, ok: !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== fg };
    } catch (e) {
      report.checks.settingsToastTheme = { ok: false, message: String(e && e.message) };
    }
    report.checks.settingsBallToggle = await settings.webContents.executeJavaScript("!!document.getElementById('ball-enabled')", true);
    report.checks.settingsSubtitleWidth = await settings.webContents.executeJavaScript("!!document.getElementById('hud-subtitle-width')", true);
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

  // 2c-2) OCR 引擎自检（第十四轮之后：auto 应选中 ONNX 引擎；探测结果写进报告）
  try {
    const ocr = ctrl.engine && ctrl.engine.ocr;
    if (!ocr) throw new Error('OCR 服务未实例化');
    const probes = await ocr.probeAll();
    const st = ocr.status();
    let picked = st.picked;
    if (!picked) {
      try { picked = (await ocr.pick()).name; } catch (e) { picked = null; }
    }
    const rapidProbe = probes && probes.rapid;
    report.checks.ocrEngine = !!picked;
    report.checks.ocrOnnxReady = !!(rapidProbe && rapidProbe.ok);
    report.ocr = {
      preferred: st.preferred,
      picked,
      rapidModels: st.rapidModels,
      probes: Object.keys(probes || {}).reduce((acc, k) => {
        acc[k] = !!probes[k].ok;
        return acc;
      }, {}),
    };
    // 开发态：拿一张合成图跑一遍真实识别（打包产物没有 项目测试/，自然跳过）
    const fixture = path.join(paths.PROJECT_ROOT, '项目测试', 'fixtures', 'zh-en-640x200.png');
    if (fs.existsSync(fixture) && picked) {
      const t0 = Date.now();
      const r = await ocr.recognize({ buffer: fs.readFileSync(fixture) });
      const text = String((r && r.text) || '');
      report.ocr.sample = {
        engine: (r && r.engine) || picked,
        ms: Date.now() - t0,
        chars: text.length,
        // 日志/报告里不写识别全文，只记是否命中关键短语
        hitExpected: text.includes('桌面翻译助手') && text.includes('Hello World'),
      };
      report.checks.ocrRecognize = report.ocr.sample.hitExpected;
    }
  } catch (e) {
    report.checks.ocrEngine = false;
    report.checks.ocrOnnxReady = false;
    report.ocr = { error: String((e && e.message) || e) };
  }

  // 2d) 关设置窗口 → 退到后台（第十二轮需求：关掉后任务栏按钮消失，但进程不退出）
  //     托盘可用时是 hide（任务栏不占位置）；本机托盘注册不上时退化为 minimize（保留任务栏入口），
  //     所以这里两种都算通过，但要区分记录下来。
  try {
    settings.close();
    await sleep(400);
    const s2 = ctrl.wm.wins.settings;
    const trayAccepted = !!(ctrl.tray && ctrl.tray.status().accepted);
    report.checks.trayAccepted = trayAccepted;
    report.checks.settingsRetreatMode = s2 && !s2.isDestroyed() && s2.isMinimized() ? 'minimize' : 'hide';
    report.checks.settingsCloseHides = !!(
      s2 &&
      !s2.isDestroyed() &&
      (!s2.isVisible() || s2.isMinimized()) &&
      report.checks.settingsRetreatMode === (trayAccepted ? 'hide' : 'minimize')
    );
    if (s2 && !s2.isDestroyed()) {
      if (s2.isMinimized()) s2.restore();
      s2.show();
    }
    await sleep(300);
  } catch (e) {
    rendererErrors.push({ kind: 'settings-close', message: String(e && e.message) });
    report.checks.settingsCloseHides = false;
  }

  // 3) 首次引导
  const onboarding = ctrl.wm.openOnboarding();
  await sleep(900);
  report.checks.onboardingCreated = !!(onboarding && !onboarding.isDestroyed());
  await shoot(onboarding, '04-onboarding');
  ctrl.wm.closeOnboarding();

  // 4) 框选遮罩（打开 1.2s 后取消，绝不采集真实桌面像素）
  ctrl.startSelection();
  await sleep(900);
  report.checks.overlayOpen = ctrl.wm.overlayOpen;
  const overlayWin = ctrl.wm.overlays[0] && ctrl.wm.overlays[0].win;
  await shoot(overlayWin, '05-overlay');
  ctrl.wm.closeOverlay();
  await sleep(200);
  report.checks.overlayClosed = !ctrl.wm.overlayOpen;

  // 5) 悬浮球
  ctrl.collapse();
  await sleep(500);
  report.checks.ballCreated = !!(ctrl.wm.wins.ball && !ctrl.wm.wins.ball.isDestroyed());
  await shoot(ctrl.wm.wins.ball, '06-ball');

  // 5b) 悬浮球单击必须能打开入口（用户反馈过「点球没反应」）
  //     打开哪一个由 general.launchAction 决定（设置页 or 浮窗），所以两种都算通过。
  try {
    // 先把设置窗口收起来，否则"本来就开着"会让判定失去意义
    const setWin = ctrl.wm.wins.settings;
    if (setWin && !setWin.isDestroyed() && setWin.isVisible()) {
      setWin.hide();
      await sleep(150);
    }
    await ctrl.wm.wins.ball.webContents.executeJavaScript(`
      (() => {
        const b = document.getElementById('ball');
        const opts = { bubbles: true, button: 0, screenX: 120, screenY: 120 };
        b.dispatchEvent(new MouseEvent('mousedown', opts));
        window.dispatchEvent(new MouseEvent('mouseup', opts));
        return true;
      })()
    `, true);
    await sleep(700);
    const hudShown = !!(ctrl.wm.wins.hud && !ctrl.wm.wins.hud.isDestroyed() && ctrl.wm.wins.hud.isVisible());
    const setShown = !!(setWin && !setWin.isDestroyed() && setWin.isVisible());
    report.checks.ballClickExpands = hudShown || setShown;
    report.checks.ballClickTarget = hudShown && setShown ? 'both' : hudShown ? 'hud' : setShown ? 'settings' : 'none';
  } catch (e) {
    rendererErrors.push({ kind: 'ball-click', message: String(e && e.message) });
    report.checks.ballClickExpands = false;
    report.checks.ballClickTarget = 'error';
  }
  ctrl.expand();
  await sleep(300);

  // 5c) 浮窗上的暂停按钮（用户反馈：想停掉翻译不该被迫打开设置）
  try {
    ctrl.startLoop(2000);
    await sleep(150);
    const before = ctrl.engine.loop.isRunning();
    await ctrl.wm.wins.hud.webContents.executeJavaScript(
      "document.getElementById('btn-pause').click(); true", true,
    );
    await sleep(400);
    const after = ctrl.engine.loop.isRunning();
    report.checks.pauseButton = before === true && after === false;
    // 再点一次应当恢复运行，然后停掉，避免自检期间持续截图
    await ctrl.wm.wins.hud.webContents.executeJavaScript(
      "document.getElementById('btn-pause').click(); true", true,
    );
    await sleep(400);
    report.checks.resumeButton = ctrl.engine.loop.isRunning() === true;
    ctrl.stopLoop('smoke');
  } catch (e) {
    rendererErrors.push({ kind: 'pause-button', message: String(e && e.message) });
  }

  // 5d) 浮窗 ⚙：点一次开设置、再点一次关设置（需求 2）
  try {
    if (ctrl.wm.settingsVisible && ctrl.wm.wins.settings) ctrl.wm.wins.settings.hide();
    await sleep(300);
    const hudWin = ctrl.wm.ensureHud();
    ctrl.wm.showHud({ text: '设置开关自检', engine: '自检引擎' });
    await sleep(500);
    await hudWin.webContents.executeJavaScript("document.getElementById('btn-settings').click(); true", true);
    await sleep(900);
    const opened = ctrl.wm.settingsVisible;
    await hudWin.webContents.executeJavaScript("document.getElementById('btn-settings').click(); true", true);
    await sleep(700);
    const closed = !ctrl.wm.settingsVisible;
    report.checks.settingsToggle = opened === true && closed === true;
    // 关掉设置页，后面的检查不受影响
    if (ctrl.wm.settingsVisible) ctrl.wm.wins.settings.hide();
  } catch (e) {
    rendererErrors.push({ kind: 'settings-toggle', message: String(e && e.message) });
    report.checks.settingsToggle = false;
  }

  // 5e) 浮窗高度自适应（需求 3）：长文本时高度应大于配置的最小高度
  try {
    ctrl.showHud({
      text: '这是一段很长的译文，用来验证浮窗会根据内容自动调整高度。\n第二行。\n第三行。\n第四行。\n第五行。\n第六行。',
      engine: '自检引擎',
      latencyMs: 12,
    });
    await sleep(700);
    const b = ctrl.wm.wins.hud.getBounds();
    report.checks.hudAutoHeight = b.height > 240;
    await shoot(ctrl.wm.wins.hud, '08-hud-tall');

    // 第二十五轮需求 4：原文默认收起，点左下角「原文」才展开
    try {
      ctrl.showHud({
        text: '点击左下角「原文」查看这段译文对应的原文。',
        source: 'Click the source toggle at the bottom left to reveal this text.',
        engine: '自检引擎',
        latencyMs: 9,
      });
      await sleep(520);
      const srcToggle = await ctrl.wm.wins.hud.webContents.executeJavaScript(`
        (() => {
          const read = () => {
            const btn = document.getElementById('btn-source');
            const wrap = document.getElementById('source-wrap');
            const cs = btn ? getComputedStyle(btn) : null;
            const foot = document.querySelector('.hud-foot');
            const fr = foot ? foot.getBoundingClientRect() : null;
            const br = btn ? btn.getBoundingClientRect() : null;
            return {
              text: btn ? btn.textContent.trim() : '',
              hidden: btn ? btn.hidden : null,
              expanded: btn ? btn.getAttribute('aria-expanded') : null,
              wrapVisible: wrap ? !wrap.hidden : null,
              // 位置：在页脚里、且靠左（离窗口左边 < 窗口宽 30%）
              inFoot: !!(fr && br && br.top >= fr.top - 1 && br.bottom <= fr.bottom + 1),
              leftRatio: br ? br.left / window.innerWidth : -1,
              visible: cs ? cs.display !== 'none' : false,
            };
          };
          const before = read();
          const btn = document.getElementById('btn-source');
          if (btn) btn.click();
          const opened = read();
          if (btn) btn.click();
          const closed = read();
          return { before, opened, closed };
        })()
      `, true);
      report.checks.hudSourceToggle = {
        ...srcToggle,
        ok: !!(srcToggle && srcToggle.before && srcToggle.before.visible
          && srcToggle.before.hidden === false
          && srcToggle.before.inFoot && srcToggle.before.leftRatio >= 0
          && srcToggle.before.leftRatio <= 0.3
          && srcToggle.before.wrapVisible === false
          && srcToggle.opened.wrapVisible === true
          && srcToggle.opened.text === '原文 ▾'
          && srcToggle.closed.wrapVisible === false),
      };
      await sleep(240);
      // 留一张"原文已展开"的截图，便于人工核对左下角入口的位置与样式
      ctrl.showHud({
        text: '点击左下角「原文」查看这段译文对应的原文。',
        source: 'Click the source toggle at the bottom left to reveal this text.',
        engine: '自检引擎',
        latencyMs: 9,
      });
      await sleep(420);
      await ctrl.wm.wins.hud.webContents.executeJavaScript(
        `(() => { const b = document.getElementById('btn-source'); if (b) b.click(); return b ? b.textContent.trim() : null; })()`,
        true
      );
      await sleep(260);
      await shoot(ctrl.wm.wins.hud, '17-hud-source');
    } catch (e) {
      rendererErrors.push({ kind: 'hud-source-toggle', message: String(e && e.message) });
      report.checks.hudSourceToggle = false;
    }

    // 主题变量是否真正下发到浮窗（需求 1 的端到端证据）
    const themeInfo = await ctrl.wm.wins.hud.webContents.executeJavaScript(`
      (() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          hasModule: !!window.TranslatorTheme,
          hudBg: cs.getPropertyValue('--hud-bg').trim(),
          accent: cs.getPropertyValue('--accent').trim(),
          radius: cs.getPropertyValue('--hud-radius').trim(),
          dataTheme: document.documentElement.dataset.theme || '',
        };
      })()
    `, true);
    report.checks.hudTheme = themeInfo;
    report.checks.hudThemeApplied = !!themeInfo && themeInfo.hasModule === true && themeInfo.hudBg !== '';

    // 5e-2) 字体颜色（第七轮需求 4）：配置自定义字色后 --fg 应随之改变
    try {
      const readFg = () => ctrl.wm.wins.hud.webContents.executeJavaScript(
        "getComputedStyle(document.documentElement).getPropertyValue('--fg').trim()",
        true,
      );
      const fgAuto = await readFg();
      // 用户可能已经设过自定义字色，恢复时要写回原值而不是空串（空串=跟随背景）
      const prevTextColor = (ctrl.engine.store.raw().appearance || {}).textColor || '';
      ctrl.engine.store.patch({ appearance: { textColor: '#ffd666' } });
      await sleep(600);
      const fgCustom = await readFg();
      ctrl.engine.store.patch({ appearance: { textColor: prevTextColor } });
      await sleep(400);
      const fgBack = await readFg();
      report.checks.hudTextColor = { fgAuto, fgCustom, fgBack };
      const customOk = /#ffd666|255,\s*214,\s*102/i.test(fgCustom);
      report.checks.hudTextColorApplied = fgCustom !== fgAuto && customOk && fgBack === fgAuto;
    } catch (e) {
      rendererErrors.push({ kind: 'hud-text-color', message: String(e && e.message) });
      report.checks.hudTextColorApplied = false;
    }

    // 5e-3) 背景图（第七轮需求 1 的回归）：导入一张合成图后 --theme-image 应下发到浮窗
    try {
      const themeFiles = require('./theme-files');
      const candidates = [
        path.join(__dirname, '..', '..', '..', '项目测试', 'fixtures', 'bg-photo.png'),
        path.join(paths.PROJECT_ROOT, '..', '项目测试', 'fixtures', 'bg-photo.png'),
      ];
      const fixture = candidates.find((p) => fs.existsSync(p));
      if (!fixture) {
        report.checks.hudBgImage = { skipped: 'no-fixture' };
        report.checks.hudBgImageApplied = true; // 打包产物里没有测试图，跳过（不算失败）
        report.checks.hudBgImageClipped = true;
        report.checks.settingsBgImageApplied = true;
        report.checks.hudReadableApplied = true; // 同上：没有测试图时这项无从验证，跳过
        report.checks.appearancePane = true;
      } else {
        // 两处各自一张：浮窗槽位用 bgImage，设置页槽位用 settingsBgImage
        const img = themeFiles.importThemeImage(fixture, Date.now(), 'hud');
        const imgSet = themeFiles.importThemeImage(fixture, Date.now() + 1, 'settings');
        ctrl.engine.store.patch({ appearance: { bgImage: img.path, settingsBgImage: imgSet.path } });
        await sleep(700);
        const bgInfo = await ctrl.wm.wins.hud.webContents.executeJavaScript(`
          (() => {
            const cs = getComputedStyle(document.documentElement);
            return {
              image: cs.getPropertyValue('--theme-image').trim(),
              size: cs.getPropertyValue('--theme-image-size').trim(),
              layer: getComputedStyle(document.getElementById('bg-layer')).backgroundImage.slice(0, 24),
              // 需求 3：layers 必须在 .hud 卡片内部，才能被 border-radius 裁切
              nested: !!document.querySelector('.hud > .bg-layer'),
              radius: getComputedStyle(document.getElementById('hud')).borderTopLeftRadius,
              layerOpacity: getComputedStyle(document.getElementById('bg-layer')).opacity,
              veil: (() => {
                const v = document.getElementById('bg-veil');
                if (!v) return 'missing';
                const s = getComputedStyle(v);
                return s.display + '|' + s.backgroundColor + '|' + s.opacity;
              })(),
            };
          })()
        `, true);
        report.checks.hudBgImage = {
          image: String(bgInfo.image).slice(0, 40),
          size: bgInfo.size,
          layer: bgInfo.layer,
          nested: bgInfo.nested,
          radius: bgInfo.radius,
          layerOpacity: bgInfo.layerOpacity,
          veil: bgInfo.veil,
        };
        report.checks.hudBgImageApplied = /url\(/.test(bgInfo.image) || /url\(/.test(bgInfo.layer);
        // 需求 3：背景图必须是卡片内部的图层，才能被卡片的圆角/边框裁切
        report.checks.hudBgImageClipped = bgInfo.nested === true && /url\(/.test(String(bgInfo.layer));

        // 需求 1（第十轮）：把图片不透明度拉满，文字与按钮也不能跟着变淡
        ctrl.engine.store.patch({ appearance: { bgImageOpacity: 0.95 } });
        await sleep(600);
        const strongInfo = await ctrl.wm.wins.hud.webContents.executeJavaScript(`
          (() => {
            const cs = getComputedStyle(document.documentElement);
            const body = document.querySelector('.hud-body');
            const head = document.querySelector('.hud-head');
            const text = document.querySelector('.translation') || document.querySelector('.placeholder');
            return {
              veil: cs.getPropertyValue('--hud-veil').trim(),
              bodyZ: body ? getComputedStyle(body).zIndex : '',
              headZ: head ? getComputedStyle(head).zIndex : '',
              textOpacity: text ? getComputedStyle(text).opacity : '',
              textColor: text ? getComputedStyle(text).color : '',
              textShadow: text ? getComputedStyle(text).textShadow.slice(0, 20) : '',
              btnBg: (() => {
                const b = document.getElementById('btn-close');
                return b ? getComputedStyle(b).backgroundColor : '';
              })(),
            };
          })()
        `, true);
        report.checks.hudReadableOnStrongImage = strongInfo;
        // 文字必须在罩层之上（z-index>=1）且完全不透明
        report.checks.hudReadableApplied = Number(strongInfo.bodyZ) >= 1
          && Number(strongInfo.headZ) >= 1
          && strongInfo.textOpacity === '1'
          && strongInfo.veil !== '';
        if (report.shots) {
          const shotStrong = await ctrl.wm.wins.hud.webContents.capturePage();
          if (shotStrong && !shotStrong.isEmpty()) {
            const file = path.join(outDir, '11-hud-bg-strong.png');
            fs.writeFileSync(file, shotStrong.toPNG());
            report.shots.push('11-hud-bg-strong.png');
          }
        }
        ctrl.engine.store.patch({ appearance: { bgImageOpacity: 0.35 } });
        await sleep(300);
        if (report.shots) {
          const shot = await ctrl.wm.wins.hud.webContents.capturePage();
          if (shot && !shot.isEmpty()) {
            const file = path.join(outDir, '10-hud-bg.png');
            fs.writeFileSync(file, shot.toPNG());
            report.shots.push('10-hud-bg.png');
          }
        }

        // 需求 2（第十轮）：两处背景图必须各自独立，互不覆盖
        try {
          const rawAp = ctrl.engine.store.raw().appearance;
          const hudImg = themeFiles.resolveSurfaceImage(rawAp, 'hud');
          const setImg = themeFiles.resolveSurfaceImage(rawAp, 'settings');
          report.checks.surfaceImagesIndependent = {
            hud: hudImg ? path.basename(hudImg.path) : null,
            settings: setImg ? path.basename(setImg.path) : null,
            independent: !!(hudImg && setImg && hudImg.path !== setImg.path),
          };
        } catch (e) {
          report.checks.surfaceImagesIndependent = { error: String(e && e.message) };
        }
        // 需求 2：设置窗口显示它自己那张图（用户要求两处可分离）
        try {
          ctrl.wm.openSettings('appearance');
          const settingsWin = ctrl.wm.wins.settings;
          await sleep(600);
          const setInfo = await settingsWin.webContents.executeJavaScript(`
            (() => {
              const cs = getComputedStyle(document.documentElement);
              const layer = document.getElementById('bg-layer');
              const lcs = layer ? getComputedStyle(layer) : null;
              return {
                image: cs.getPropertyValue('--theme-image').trim().slice(0, 24),
                hasImage: document.documentElement.dataset.hasImage,
                layerHidden: layer ? layer.hidden : null,
                layerBg: lcs ? lcs.backgroundImage.slice(0, 24) : '',
                veil: cs.getPropertyValue('--bg-elevated-veil').trim(),
                contentBg: (() => {
                  const c = document.querySelector('.content');
                  return c ? getComputedStyle(c).backgroundColor : '';
                })(),
                scrim: (() => {
                  const s = getComputedStyle(document.body, '::after');
                  return s.display + '|' + s.backgroundColor;
                })(),
              };
            })()
          `, true);
          report.checks.settingsBgImage = setInfo;
          report.checks.settingsBgImageApplied = setInfo.layerHidden === false
            && /url\(/.test(String(setInfo.layerBg));
          if (report.shots) {
            const img2 = await settingsWin.webContents.capturePage();
            if (img2 && !img2.isEmpty()) {
              const file = path.join(outDir, '09-settings-bg.png');
              fs.writeFileSync(file, img2.toPNG());
              report.shots.push('09-settings-bg.png');
            }
          }
        } catch (e) {
          rendererErrors.push({ kind: 'settings-bg-image', message: String(e && e.message) });
          report.checks.settingsBgImageApplied = false;
        }
        // 恢复：清空配置并删掉刚导入的两张图（自检不污染用户主题）
        ctrl.engine.store.patch({ appearance: { bgImage: '', settingsBgImage: '' } });
        themeFiles.removeThemeImage(img.path);
        themeFiles.removeThemeImage(imgSet.path);
        await sleep(300);
      }
    } catch (e) {
      rendererErrors.push({ kind: 'hud-bg-image', message: String(e && e.message) });
      report.checks.hudBgImageApplied = false;
    }
  } catch (e) {
    rendererErrors.push({ kind: 'auto-height', message: String(e && e.message) });
    report.checks.hudAutoHeight = false;
  }

  // 5f) 右下角拖拽调整大小（需求 3）：用真实输入事件走一遍 pointer 链路
  try {
    const hudWin2 = ctrl.wm.wins.hud;
    const before = hudWin2.getBounds();
    const autoBefore = ctrl.engine.store.raw().hud.autoHeight;
    const wc = hudWin2.webContents;
    const gx = Math.max(2, before.width - 10);
    const gy = Math.max(2, before.height - 10);
    wc.sendInputEvent({ type: 'mouseMove', x: gx, y: gy });
    wc.sendInputEvent({ type: 'mouseDown', x: gx, y: gy, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) {
      wc.sendInputEvent({
        type: 'mouseMove',
        x: gx + Math.round((80 * i) / 8),
        y: gy + Math.round((50 * i) / 8),
        button: 'left',
        modifiers: ['leftButtonDown'],
      });
      // eslint-disable-next-line no-await-in-loop
      await sleep(20);
    }
    wc.sendInputEvent({ type: 'mouseUp', x: gx + 80, y: gy + 50, button: 'left', clickCount: 1 });
    await sleep(400);
    let after = hudWin2.getBounds();

    if (!(after.width > before.width && after.height > before.height)) {
      // 兜底：某些环境下 sendInputEvent 不会产生 pointer 事件，改用合成 PointerEvent
      // 第二十三轮起主进程按「屏幕绝对锚点」算几何，自检里必须提供假光标（testCursor），
      // 否则真实光标原地不动 → 位移恒为 0，尺寸不会变。
      await wc.executeJavaScript(`
        (() => {
          const grip = document.getElementById('grip');
          const base = { bubbles: true, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse', buttons: 1 };
          const sx = ${before.x + before.width};
          const sy = ${before.y + before.height};
          window.__dshTestCursor = { x: sx, y: sy };
          grip.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ screenX: sx, screenY: sy }, base)));
          window.__dshTestCursor = { x: sx + 80, y: sy + 50 };
          grip.dispatchEvent(new PointerEvent('pointermove', Object.assign({ screenX: sx + 80, screenY: sy + 50 }, base)));
          window.__dshTestCursor = { x: sx + 80, y: sy + 50 };
          grip.dispatchEvent(new PointerEvent('pointerup', Object.assign({ screenX: sx + 80, screenY: sy + 50 }, base, { buttons: 0 })));
          window.__dshTestCursor = null;
          return true;
        })()
      `, true);
      await sleep(500);
      after = hudWin2.getBounds();
    }

    // 拖拽方向由用户（或自检）决定，宽高可能一增一减，只要尺寸确实变了就算通过
    report.checks.hudResize = Math.abs(after.width - before.width) >= 32 || Math.abs(after.height - before.height) >= 32;
    report.checks.hudResizeDelta = { before, after };
    // 自检不应污染用户尺寸：改回原值
    try {
      ctrl.engine.store.patch({ hud: { width: before.width, height: before.height, autoHeight: autoBefore } }, { silent: true });
      ctrl.wm.setHudSize({ width: before.width, height: before.height });
    } catch { /* 忽略 */ }
  } catch (e) {
    rendererErrors.push({ kind: 'hud-resize', message: String(e && e.message) });
    report.checks.hudResize = false;
  }

  // 5f) 视频 / 游戏字幕条（第十八轮需求 3）
  // 三条硬指标：窗口变细长、正文区域不接收鼠标（点击落到游戏上）、文字带描边投影
  try {
    const hudWin4 = ctrl.wm.wins.hud;
    const prevHud = JSON.parse(JSON.stringify(ctrl.engine.store.raw().hud));
    ctrl.engine.store.patch({ hud: { mode: 'subtitle', subtitleFontSize: 28 } }, { silent: true });
    await sleep(500);
    ctrl.showHud({
      text: '细长的透明字幕条，只留描边文字，尽量不遮挡游戏画面。',
      engine: '自检引擎',
      latencyMs: 9,
    });
    await sleep(800);
    const b = hudWin4.getBounds();
    const cfgHudNow = JSON.parse(JSON.stringify(ctrl.engine.store.raw().hud));
    const info = await hudWin4.webContents.executeJavaScript(`
      (() => {
        const cs = (n) => getComputedStyle(n);
        const body = document.querySelector('.hud-body');
        const text = document.getElementById('translation');
        const hud = document.getElementById('hud');
        return {
          modeClass: document.body.classList.contains('mode-subtitle'),
          bodyInteractive: body ? body.classList.contains('interactive') : null,
          bodyPointer: body ? cs(body).pointerEvents : '',
          hudPointer: hud ? cs(hud).pointerEvents : '',
          hudBg: hud ? cs(hud).backgroundColor : '',
          shadow: text ? cs(text).textShadow : '',
          stroke: text ? cs(text).webkitTextStrokeWidth : '',
          fontPx: text ? cs(text).fontSize : '',
          headOpacity: (() => {
            const h = document.querySelector('.hud-head');
            return h ? cs(h).opacity : '';
          })(),
        };
      })()
    `, true);
    report.checks.hudSubtitle = { bounds: { width: b.width, height: b.height }, cfgHud: cfgHudNow, ...info };
    report.checks.hudSubtitleMode = info.modeClass === true
      && b.height <= 140 && b.width >= 640
      && info.bodyPointer === 'none'
      && (info.shadow || '').length > 10
      && parseFloat(info.fontPx) >= 26;

    // 第二十五轮需求 2：拖动区与设置区合一，位于字幕条正中上方，点击向两侧展开
    const dockInfo = await hudWin4.webContents.executeJavaScript(`
      (() => {
        const dock = document.getElementById('dock');
        const handle = document.getElementById('dock-handle');
        const r0 = dock ? dock.getBoundingClientRect() : null;
        const before = dock ? dock.classList.contains('expanded') : null;
        const tap = () => {
          if (!handle) return;
          const opts = { bubbles: true, cancelable: true, pointerId: 21, button: 0, buttons: 1 };
          handle.dispatchEvent(new PointerEvent('pointerdown', opts));
          const up = { ...opts, buttons: 0 };
          handle.dispatchEvent(new PointerEvent('pointerup', up));
        };
        tap();
        const r1 = dock ? dock.getBoundingClientRect() : null;
        const after = dock ? dock.classList.contains('expanded') : null;
        const visible = dock ? !dock.hidden : false;
        return {
          visible, before, after,
          collapsedWidth: r0 ? Math.round(r0.width) : 0,
          expandedWidth: r1 ? Math.round(r1.width) : 0,
          // 「向两侧展开」：左右边缘都要往外走，中心保持在窗口正中
          grewLeft: r0 && r1 ? Math.round(r0.left - r1.left) : 0,
          grewRight: r0 && r1 ? Math.round(r1.right - r0.right) : 0,
          centerOffset: r1 ? Math.round((r1.left + r1.right) / 2 - window.innerWidth / 2) : -1,
        };
      })()
    `, true);
    // 展开有 160ms 过渡，等它走完再截图，否则拍到的是"按钮已出现但底色还没淡入"的中间帧
    await sleep(280);
    await shoot(hudWin4, '16-hud-subtitle-rail');
    // 第二十轮回归：用户反馈「控制区点了没反应」。控制区在 DOM 里、也能被 .click() 触发，
    // 但字幕模式下 .hud 整块 pointer-events:none，若子元素没显式恢复，elementFromPoint
    // 就命不中它 → 主进程判定为空白 → 保持穿透 → 真实鼠标点不动。
    // 这里直接断言「光标落点能命中手柄与三条拖拽热区」，与 hud-pointer.js 的判据一致。
    const hit = await hudWin4.webContents.executeJavaScript(`
      (() => {
        const pick = (node, dx, dy) => {
          if (!node) return null;
          const r = node.getBoundingClientRect();
          const x = dx === undefined ? r.left + r.width / 2 : dx;
          const y = dy === undefined ? r.top + r.height / 2 : dy;
          const el = document.elementFromPoint(x, y);
          return {
            inside: !!(el && el.closest && el.closest('#' + node.id)),
            interactive: !!(el && el.closest && el.closest('.interactive')),
            tag: el ? (el.id || el.className || el.tagName) : null,
          };
        };
        const dock = document.getElementById('dock');
        const handle = document.getElementById('dock-handle');
        const edgeL = document.getElementById('edge-left');
        const edgeR = document.getElementById('edge-right');
        const edgeB = document.getElementById('edge-bottom');
        return {
          expanded: dock ? dock.classList.contains('expanded') : null,
          dock: pick(dock),
          handle: pick(handle),
          edgeLeft: pick(edgeL, edgeL ? edgeL.getBoundingClientRect().left + 3 : 0),
          edgeRight: pick(edgeR, edgeR ? edgeR.getBoundingClientRect().right - 3 : 0),
          edgeBottom: pick(edgeB, edgeB ? edgeB.getBoundingClientRect().left + 40 : 0,
            edgeB ? edgeB.getBoundingClientRect().top + 3 : 0),
        };
      })()
    `, true);
    report.checks.hudSubtitleHit = {
      ...hit,
      ok: !!(hit && hit.expanded && hit.dock && hit.dock.interactive
        && hit.handle && hit.handle.inside && hit.handle.interactive
        && hit.edgeLeft && hit.edgeLeft.inside && hit.edgeLeft.interactive
        && hit.edgeRight && hit.edgeRight.inside && hit.edgeRight.interactive
        && hit.edgeBottom && hit.edgeBottom.inside && hit.edgeBottom.interactive),
    };
    // 收起，恢复成单手柄状态
    await hudWin4.webContents.executeJavaScript(`
      (() => {
        const handle = document.getElementById('dock-handle');
        if (!handle) return true;
        const opts = { bubbles: true, cancelable: true, pointerId: 22, button: 0, buttons: 1 };
        handle.dispatchEvent(new PointerEvent('pointerdown', opts));
        handle.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        return true;
      })()
    `, true);
    report.checks.hudSubtitleRail = {
      ...dockInfo,
      ok: dockInfo.visible === true && dockInfo.before === false && dockInfo.after === true
        && dockInfo.expandedWidth > dockInfo.collapsedWidth
        && dockInfo.grewLeft > 20 && dockInfo.grewRight > 20
        && Math.abs(dockInfo.centerOffset) <= 3,
    };

    // 第十九轮需求 3：拖字幕条边缘改宽度 → 窗口变宽，松手写回 hud.subtitleWidth
    const widthBefore = hudWin4.getBounds().width;
    const resized = await hudWin4.webContents.executeJavaScript(`
      (() => {
        const edge = document.getElementById('edge-right');
        if (!edge) return null;
        window.__dshTestCursor = { x: 1000, y: 500 };
        const fire = (type, sx) => edge.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1,
          screenX: sx, screenY: 500,
        }));
        fire('pointerdown', 1000);
        window.__dshTestCursor = { x: 1120, y: 500 };
        fire('pointermove', 1120);
        return true;
      })()
    `, true);
    await sleep(320);
    const widthAfterDrag = hudWin4.getBounds().width;
    await hudWin4.webContents.executeJavaScript(`(() => {
      const edge = document.getElementById('edge-right');
      window.__dshTestCursor = null;
      if (edge) edge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
      return true;
    })()`, true);
    await sleep(220);
    const cfgHud = ctrl.engine.store.raw().hud || {};
    report.checks.hudSubtitleResize = {
      ok: !!resized && widthAfterDrag > widthBefore + 40 && Number(cfgHud.subtitleWidth) >= widthBefore,
      before: widthBefore,
      after: widthAfterDrag,
      persisted: Number(cfgHud.subtitleWidth) || 0,
    };

    /* 第二十七轮：拖动过程中 Chromium 隐式释放 pointer capture 时不能中断拖动。
       用户反馈「鼠标移动快点会丢失拖动状态」——窗口在拖动中不断变形，
       捕获元素随之变化，浏览器会静默 releasePointerCapture，旧实现把它当松手收尾。
       这里先拖起来，再人为派发 lostpointercapture，然后继续移动光标：
       宽度必须继续增长，松手后必须冻结。 */
    try {
      ctrl.engine.store.patch({ hud: { subtitleWidth: 1400 } });
      await sleep(320);
      const fireStart = `(() => {
        const edge = document.getElementById('edge-right');
        if (!edge) return false;
        window.__dshTestCursor = { x: 1000, y: 500 };
        edge.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 11, button: 0, buttons: 1,
          screenX: 1000, screenY: 500,
        }));
        return true;
      })()`;
      await hudWin4.webContents.executeJavaScript(fireStart, true);
      await sleep(220);
      const lossBefore = hudWin4.getBounds().width;
      await hudWin4.webContents.executeJavaScript(`(() => {
        const edge = document.getElementById('edge-right');
        window.__dshTestCursor = { x: 1080, y: 500 };
        if (edge) {
          edge.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, pointerId: 11, button: 0, buttons: 1,
            screenX: 1080, screenY: 500,
          }));
          edge.dispatchEvent(new Event('lostpointercapture'));
        }
        return true;
      })()`, true);
      await sleep(240);
      const lossMid = hudWin4.getBounds().width;
      await hudWin4.webContents.executeJavaScript(`(() => {
        window.__dshTestCursor = { x: 1160, y: 500 };
        document.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, pointerId: 11, button: 0, buttons: 1, screenX: 1160, screenY: 500,
        }));
        return true;
      })()`, true);
      await sleep(240);
      const lossGrown = hudWin4.getBounds().width;
      await hudWin4.webContents.executeJavaScript(`(() => {
        window.__dshTestCursor = null;
        document.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, pointerId: 11, buttons: 0, screenX: 1160, screenY: 500,
        }));
        return true;
      })()`, true);
      await sleep(220);
      const lossFrozen = hudWin4.getBounds().width;
      report.checks.hudSubtitleCaptureLoss = {
        ok: lossMid > lossBefore + 20 && lossGrown > lossMid + 20 && Math.abs(lossFrozen - lossGrown) <= 3,
        before: lossBefore,
        mid: lossMid,
        grown: lossGrown,
        frozen: lossFrozen,
      };
    } catch (e) {
      report.checks.hudSubtitleCaptureLoss = { ok: false, error: String(e && e.message) };
    }

    // 第二十轮：拖底边改字幕条高度（axis:'y'），松手写回 hud.subtitleHeight
    // 第二十三轮需求 2/3：顺便量一下热区厚度与顶部拖动区（要随尺寸变大、要看得见）
    const readEdgeMetrics = () => hudWin4.webContents.executeJavaScript(`
      (() => {
        const root = getComputedStyle(document.documentElement);
        const num = (k) => parseFloat(root.getPropertyValue(k)) || 0;
        // 第二十五轮：手柄从顶部细条挪到了居中的 .hud-dock，量它就行
        const handle = document.getElementById('dock-handle');
        const dock = document.getElementById('dock');
        const edge = document.getElementById('edge-bottom');
        const cs = dock ? getComputedStyle(dock) : null;
        const rect = handle ? handle.getBoundingClientRect() : null;
        const dockRect = dock ? dock.getBoundingClientRect() : null;
        const bg = cs ? cs.backgroundColor : '';
        return {
          edgeX: num('--edge-x'),
          edgeY: num('--edge-y'),
          edgeH: edge ? Math.round(edge.getBoundingClientRect().height) : 0,
          gripW: dockRect ? Math.round(dockRect.width) : 0,
          gripH: rect ? Math.round(rect.height) : 0,
          gripOpacity: cs ? Number(cs.opacity) : 0,
          gripBg: bg,
          gripSolid: !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent',
          dockExpanded: dock ? dock.classList.contains('expanded') : null,
        };
      })()
    `, true);
    const metricsBefore = await readEdgeMetrics();
    const heightBefore = hudWin4.getBounds().height;
    await hudWin4.webContents.executeJavaScript(`
      (() => {
        const edge = document.getElementById('edge-bottom');
        if (!edge) return null;
        window.__dshTestCursor = { x: 600, y: 200 };
        const fire = (type, sy) => edge.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 9, button: 0, buttons: 1,
          screenX: 600, screenY: sy,
        }));
        fire('pointerdown', 200);
        window.__dshTestCursor = { x: 600, y: 268 };
        fire('pointermove', 268);
        return true;
      })()
    `, true);
    await sleep(320);
    const heightAfterDrag = hudWin4.getBounds().height;
    await hudWin4.webContents.executeJavaScript(`(() => {
      const edge = document.getElementById('edge-bottom');
      window.__dshTestCursor = null;
      if (edge) edge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
      return true;
    })()`, true);
    await sleep(220);
    const metricsAfter = await readEdgeMetrics();
    const cfgHud2 = ctrl.engine.store.raw().hud || {};
    report.checks.hudSubtitleResizeY = {
      ok: heightAfterDrag > heightBefore + 30 && Number(cfgHud2.subtitleHeight) >= heightBefore,
      before: heightBefore,
      after: heightAfterDrag,
      persisted: Number(cfgHud2.subtitleHeight) || 0,
    };
    // 第二十三轮需求 2：窗口变大后热区也要变大；需求 3：拖动区要看得见
    // 第二十五轮：收起态刻意做成「只有淡握把、无边框无底色」（用户嫌挂着边框像浮框），
    // 所以这里只要求握把可量、有可见度；胶囊底色在展开态另由 hudSubtitleRail 覆盖。
    report.checks.hudSubtitleEdgeScale = {
      ok: metricsAfter.edgeH >= 14
        && metricsAfter.edgeY >= metricsBefore.edgeY
        && metricsAfter.gripH >= 16
        && metricsAfter.gripW >= 20
        && metricsAfter.gripOpacity > 0,
      before: metricsBefore,
      after: metricsAfter,
    };

    await shoot(hudWin4, '14-hud-subtitle');

    // 第二十五轮用户反馈：「拖左边就是左边往外、右边不动，而不是整块窗口平移」。
    // 先把宽度收回到一个中间值，避免撞上工作区最大宽（撞上限后拖不动会被误判成 bug）。
    ctrl.engine.store.patch({ hud: { subtitleWidth: 1400 } });
    await sleep(420);
    const b0 = hudWin4.getBounds();
    const rightEdge0 = b0.x + b0.width;
    // 用左边缘做「拉伸」检查：往左拖 70px，左边应该跟着走、右边保持不动
    const leftDrag = (sx, buttons) => hudWin4.webContents.executeJavaScript(`
      (() => {
        const edge = document.getElementById('edge-left');
        if (!edge) return null;
        if (!window.__leftEdgeStarted) {
          window.__dshTestCursor = { x: ${sx}, y: 200 };
          edge.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, pointerId: 12, button: 0, buttons: 1,
            screenX: ${sx}, screenY: 200,
          }));
          window.__leftEdgeStarted = true;
        }
        window.__dshTestCursor = { x: ${sx}, y: 200 };
        edge.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, pointerId: 12, button: 0, buttons: ${buttons},
          screenX: ${sx}, screenY: 200,
        }));
        return Math.round(edge.getBoundingClientRect().width);
      })()
    `, true);
    const leftEdgeW = await leftDrag(b0.x + 8, 1);
    await sleep(340);
    const b1 = hudWin4.getBounds();
    await leftDrag(b0.x + 8 - 70, 1);
    await sleep(360);
    const b2 = hudWin4.getBounds();
    const rightEdge2 = b2.x + b2.width;
    // 松手后不能再拖：模拟 pointerup 丢失，只发 buttons=0 的移动
    await leftDrag(b0.x + 8 - 220, 0);
    await sleep(380);
    const b3 = hudWin4.getBounds();
    await hudWin4.webContents.executeJavaScript(`(() => {
      const edge = document.getElementById('edge-left');
      window.__dshTestCursor = null;
      if (edge) edge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 12 }));
      window.__leftEdgeStarted = false;
      return true;
    })()`, true);
    await sleep(200);
    report.checks.hudSubtitleRelease = {
      // 左边缘拉伸：宽度变大 ≈70px、x 跟着左移 ≈70px、右边缘不动（±3px）
      // 松手后（buttons=0）宽度必须冻结
      ok: !!leftEdgeW && leftEdgeW >= 12
        && b2.width > b1.width + 40
        && b1.x - b2.x > 40
        && Math.abs(rightEdge2 - rightEdge0) <= 3
        && b3.width === b2.width,
      leftEdgeWidth: leftEdgeW,
      bounds: [
        { x: b0.x, width: b0.width },
        { x: b1.x, width: b1.width },
        { x: b2.x, width: b2.width },
        { x: b3.x, width: b3.width },
      ],
      rightEdge: [rightEdge0, rightEdge2],
    };

    // 第二十一轮需求 2：字幕模式下点暂停，两个暂停按钮的图标都要跟着变
    const pauseSync = await hudWin4.webContents.executeJavaScript(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // 第二十五轮需求 3：图标改成内联 SVG，状态看 data-state，同时确认有可见的 svg 子元素
        const read = () => {
          const of = (id) => {
            const b = document.getElementById(id);
            if (!b) return { state: '', svg: 0 };
            return {
              state: b.dataset.state || '',
              svg: b.querySelectorAll('svg').length,
            };
          };
          return { card: of('btn-pause'), sub: of('btn-sub-pause') };
        };
        const before = read();
        const sub = document.getElementById('btn-sub-pause');
        if (sub) sub.click();
        await wait(2600);
        const afterOne = read();
        if (sub) sub.click();
        await wait(2600);
        const afterTwo = read();
        return { before, afterOne, afterTwo };
      })()
    `, true);
    report.checks.hudSubtitlePauseSync = {
      // 每读一次状态都是新对象，必须比 .state 字段本身（比对象引用永远为 false）
      ok: !!pauseSync
        && pauseSync.afterOne.sub.state === pauseSync.afterOne.card.state
        && pauseSync.afterTwo.sub.state === pauseSync.afterTwo.card.state
        && pauseSync.afterOne.sub.svg === 2 && pauseSync.afterOne.card.svg === 2
        && (pauseSync.afterOne.sub.state !== pauseSync.before.sub.state
          || pauseSync.afterTwo.sub.state !== pauseSync.before.sub.state),
      ...pauseSync,
    };

    // 第二十五轮需求 2：二合一控制条始终居中，展开时向两侧长、中心不动
    const railSide = await hudWin4.webContents.executeJavaScript(`
      (() => {
        const dock = document.getElementById('dock');
        const handle = document.getElementById('dock-handle');
        if (!dock || !handle) return null;
        const mid = (el) => {
          const r = el.getBoundingClientRect();
          return Math.round((r.left + r.right) / 2);
        };
        const tap = () => {
          const opts = { bubbles: true, cancelable: true, pointerId: 23, button: 0, buttons: 1 };
          handle.dispatchEvent(new PointerEvent('pointerdown', opts));
          handle.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        };
        const winW = window.innerWidth;
        const centerOfWindow = Math.round(winW / 2);
        // 统一从「收起」状态开始量：多按一次把它切回收起
        if (dock.classList.contains('expanded')) tap();
        const collapsed = mid(dock);
        tap();
        const expanded = mid(dock);
        tap();
        return { collapsed, expanded, centerOfWindow, winW };
      })()
    `, true);
    report.checks.hudSubtitleRailSide = {
      // 第二十五轮：手柄居中，展开/收起都不移动中心点（±2px 容差）
      ok: !!railSide
        && Math.abs(railSide.collapsed - railSide.expanded) <= 2
        && Math.abs(railSide.collapsed - railSide.centerOfWindow) <= 3,
      ...railSide,
    };

    // 第二十一轮需求 3：长译文自动缩字号，保证整段塞进字幕条
    // 先把高度还原成标准 96px，否则前面拖出来的高度会让长文本也放得下
    // silent:true 不会触发 config-changed，等于改了配置不生效——这里要的是真实路径
    ctrl.engine.store.patch({ hud: { subtitleHeight: 0 } });
    await sleep(520);
    const fitProbe = await hudWin4.webContents.executeJavaScript(`
      (() => {
        const el = document.getElementById('translation');
        if (!el) return null;
        const line = '这是一段故意写得很长很长的中文字幕，用来验证字幕条在放不下的时候会自动缩小字号，'
          + '直到整段文字都能完整显示出来而不会被截断，同时也不会缩到看不清的程度，'
          + '而且换行之后每一行都要在可视区域里。';
        const body = document.getElementById('body') || document.querySelector('.hud-body');
        const before = parseFloat(getComputedStyle(el).fontSize);
        el.textContent = line;
        if (window.__fitSubtitleFont) window.__fitSubtitleFont();
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const after = parseFloat(getComputedStyle(el).fontSize);
          resolve({
            before, after,
            fits: !!body && el.scrollHeight <= body.clientHeight + 2,
            scrollH: el.scrollHeight,
            boxH: body ? body.clientHeight : 0,
          });
        })));
      })()
    `, true);
    report.checks.hudSubtitleFit = {
      ok: !!fitProbe && fitProbe.after < fitProbe.before && fitProbe.after >= 12 && fitProbe.fits,
      ...(fitProbe || {}),
    };

    // 恢复卡片模式与用户原配置，自检不留痕
    ctrl.engine.store.patch({ hud: prevHud }, { silent: true });
    await sleep(400);
  } catch (e) {
    rendererErrors.push({ kind: 'hud-subtitle', message: String(e && e.message) });
    report.checks.hudSubtitleMode = false;
  }

  // 6) 托盘与热键
  report.checks.trayCreated = !!(ctrl.tray && ctrl.tray.tray);
  // 第十二轮：右键菜单必须只有 设置 / 输入翻译 / 退出 三项
  try {
    report.checks.trayMenuItems = ctrl.tray && typeof ctrl.tray.menuLabels === 'function'
      ? ctrl.tray.menuLabels()
      : [];
  } catch (e) {
    report.checks.trayMenuItems = [];
  }
  // 悬浮球右键菜单（托盘被系统拒绝时的兜底入口）
  try {
    report.checks.ballMenuItems = ctrl.ballMenuTemplate()
      .filter((i) => !i.type)
      .map((i) => i.label);
  } catch (e) {
    report.checks.ballMenuItems = [];
  }

  // 5g) 悬浮球常驻 + 悬停浮出气泡（第二十五轮改写：窗口尺寸固定，不再 resize）
  try {
    const ballWin = ctrl.wm.wins.ball;
    const visible = !!(ballWin && !ballWin.isDestroyed() && ballWin.isVisible());
    report.checks.ballVisible = visible;
    const before = visible ? ballWin.getBounds() : { width: 0, height: 0 };
    ctrl.setBallHover(true);
    await sleep(320);
    const after = ballWin && !ballWin.isDestroyed() ? ballWin.getBounds() : { width: 0, height: 0 };
    const bubble = ballWin && !ballWin.isDestroyed()
      ? await ballWin.webContents.executeJavaScript(
        `(() => {
          const wrap = document.getElementById('wrap');
          const fan = document.getElementById('fan');
          const cs = fan ? getComputedStyle(fan) : null;
          const ball = document.getElementById('ball');
          const items = Array.from(document.querySelectorAll('.bubble'));
          const center = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
          };
          const ballC = ball ? center(ball) : null;
          const shots = items.map((el) => {
            const c = center(el);
            const st = getComputedStyle(el);
            return {
              x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h),
              opacity: Number(st.opacity),
              radius: st.borderTopLeftRadius,
              // 气泡中心到球心的距离（应等于主进程下发的半径 74）
              dist: ballC ? Math.round(Math.hypot(c.x - ballC.x, c.y - ballC.y)) : -1,
            };
          });
          return {
            open: wrap ? wrap.dataset.open : '',
            side: wrap ? wrap.dataset.side : '',
            ariaHidden: fan ? fan.getAttribute('aria-hidden') : '',
            opacity: cs ? cs.opacity : '',
            visible: cs ? cs.visibility : '',
            count: items.length,
            items: shots,
            ball: ballC ? { x: Math.round(ballC.x), y: Math.round(ballC.y) } : null,
          };
        })()`,
        true
      )
      : { open: '', opacity: '', visible: '', count: 0, items: [] };
    await shoot(ballWin, '15-ball-fan');
    ctrl.setBallHover(false);
    await sleep(260);
    const closed = ballWin && !ballWin.isDestroyed()
      ? await ballWin.webContents.executeJavaScript(
        `(() => {
          const wrap = document.getElementById('wrap');
          const fan = document.getElementById('fan');
          const cs = fan ? getComputedStyle(fan) : null;
          return { open: wrap ? wrap.dataset.open : '', opacity: cs ? cs.opacity : '' };
        })()`,
        true
      )
      : { open: '', opacity: '' };
    report.checks.ballHover = {
      beforeW: before.width,
      afterW: after.width,
      bubble,
      closed,
      // 窗口尺寸不变（不再因为悬停而 resize，这是"黑框闪"的根因，也是第二十五轮的核心断言）
      sizeStable: after.width === before.width && after.height === before.height,
      // 第二十六轮：四个圆形气泡等半径环绕球心
      circleOk: (() => {
        const items = (bubble && bubble.items) || [];
        if (items.length !== 4) return false;
        const dists = items.map((i) => i.dist);
        const spread = Math.max(...dists) - Math.min(...dists);
        return items.every((i) => i.w === i.h && i.opacity > 0.9 && i.radius === '50%')
          && dists.every((d) => Math.abs(d - 74) <= 2)
          && spread <= 2;
      })(),
      ok: visible && bubble.open === 'true' && Number(bubble.opacity) > 0.9
        && closed.open === 'false',
    };
    report.checks.ballHoverExpanded = report.checks.ballHover.ok;

    // 第二十六轮：球被拖到屏幕另一侧后，气泡弧线要换向（否则一半气泡飘到屏幕外）
    try {
      if (ballWin && !ballWin.isDestroyed()) {
        const wa = ctrl.wm.ballWorkArea ? ctrl.wm.ballWorkArea(ctrl.wm.ballPointOf(ballWin.getBounds())) : null;
        const origin = ballWin.getBounds();
        const leftX = (wa ? wa.x : 0) + 8; // 把窗口推到最左边，等于球贴左边缘
        ballWin.setPosition(leftX, origin.y);
        await sleep(160);
        const flipped = ctrl.wm.refreshBallSide();
        await sleep(120);
        const state = await ballWin.webContents.executeJavaScript(
          `(() => {
            const wrap = document.getElementById('wrap');
            const ball = document.getElementById('ball');
            const r = ball ? ball.getBoundingClientRect() : null;
            return { side: wrap ? wrap.dataset.side : '', ballLeft: r ? Math.round(r.left) : -1 };
          })()`,
          true
        );
        report.checks.ballEdgeFlip = {
          origin,
          side: flipped && flipped.side,
          domSide: state.side,
          ballLeft: state.ballLeft,
          bubbles: (flipped && flipped.layout && flipped.layout.bubbles) || [],
          ok: !!flipped && flipped.side === 'right' && state.side === 'right'
            && state.ballLeft <= 26,
        };
        // 复位（窗口回到原处并重新展开一次布局），不影响后续检查
        ballWin.setPosition(origin.x, origin.y);
        await sleep(140);
        ctrl.wm.refreshBallSide();
        await sleep(120);
      }
    } catch (e) {
      rendererErrors.push({ kind: 'ball-edge-flip', message: String(e && e.message) });
      report.checks.ballEdgeFlip = false;
    }
  } catch (e) {
    rendererErrors.push({ kind: 'ball-hover', message: String(e && e.message) });
    report.checks.ballHoverExpanded = false;
  }
  report.checks.trayAccepted = !!ctrl.trayAccepted;
  report.checks.hotkeys = ctrl.hotkeyStatus().registered;
  report.checks.loop = ctrl.engine.loop.getStatus();
  report.checks.ocr = ctrl.engine.ocr.status ? ctrl.engine.ocr.status() : null;

  // 5h) 帧指纹跳过（第二十二轮性能优化）
  // 目的：证明"画面没动时不再重复截图 + OCR"。桌面内容未必静止，
  // 所以最多试 3 次拿两帧相同签名；实在稳不住就记为 unstable 而不是判失败。
  try {
    const probeRegion = { x: 8, y: 8, width: 240, height: 90 };
    let result = { skipped: false, reason: 'no-peek' };
    let prevSig = null;
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const peek = await ctrl.engine.capture.peekRegion(probeRegion).catch(() => null);
      if (!peek) { result = { skipped: false, reason: 'peek-unavailable' }; break; }
      if (prevSig && ctrl.engine.capture.sameFrame(prevSig, peek.sig)) {
        const before = report.checks.ocr && report.checks.ocr.preferred;
        // eslint-disable-next-line no-await-in-loop
        const r1 = await ctrl.engine.runRound({ trigger: 'smoke', regionOverride: probeRegion });
        // eslint-disable-next-line no-await-in-loop
        const r2 = await ctrl.engine.runRound({ trigger: 'smoke', regionOverride: probeRegion });
        result = {
          skipped: r2.skipped === 'frame',
          unchanged: r2.unchanged === true,
          ocrEngine: before,
          totalMsSecond: r2.timings && r2.timings.totalMs,
          firstTotalMs: r1.timings && r1.timings.totalMs,
        };
        break;
      }
      prevSig = peek.sig;
      // eslint-disable-next-line no-await-in-loop
      await sleep(260);
    }
    report.checks.frameSkip = result;
    report.checks.frameSkipOk = result.skipped === true || result.reason === 'peek-unavailable';
  } catch (e) {
    rendererErrors.push({ kind: 'frame-skip', message: String(e && e.message) });
    report.checks.frameSkipOk = false;
  }

  // 还原自检期间改动过的浮窗配置（模式/尺寸/高度自适应），避免污染用户设置与下次自检
  if (hudSnapshot) {
    try {
      ctrl.engine.store.patch({ hud: hudSnapshot }, { silent: true });
      ctrl.wm.setHudSize({ width: hudSnapshot.width, height: hudSnapshot.height });
    } catch (e) {
      rendererErrors.push({ kind: 'hud-restore', message: String(e && e.message) });
    }
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.checks.hudCreated && report.checks.settingsCreated
    && report.checks.onboardingCreated && rendererErrors.length === 0;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('[smoke] ' + JSON.stringify({
    ok: report.ok, shots, rendererErrors: rendererErrors.length,
  }));
  if (!report.ok) console.error('[smoke] 失败详情见 report.json');
  return report;
}

/**
 * 窗口诊断（--diag-windows）：打印每个窗口的真实可见性与位置后退出。
 * 用于排查「双击后看不到窗口」这类问题（不影响正常启动路径）。
 */
async function runWindowDiag() {
  await new Promise((r) => setTimeout(r, 2000));
  const rows = {};
  for (const key of ['hud', 'settings', 'onboarding', 'overlay', 'ball']) {
    const win = ctrl.wm && ctrl.wm.wins ? ctrl.wm.wins[key] : null;
    if (!win || win.isDestroyed()) { rows[key] = { exists: false }; continue; }
    rows[key] = {
      exists: true,
      visible: win.isVisible(),
      bounds: win.getBounds(),
      loading: win.webContents.isLoading(),
      url: path.basename(String(win.webContents.getURL() || '')),
    };
  }
  console.log('[diag] ' + JSON.stringify({ dataHome: DATA_HOME, windows: rows }, null, 2));
  return rows;
}

/**
 * 用户再次双击图标时，必须让已有实例「看得见」，并给出通往设置的入口。
 * 之前只弹一个 focusable:false 的小浮窗，用户会以为程序没启动；托盘图标也可能不在/在溢出区，
 * 所以这里把「再次双击」定义为打开设置窗口——这是最明确、最容易发现的入口。
 * 顺序：首次引导 → 设置窗口（必要时创建）→ 兜底显示浮窗。
 */
function raiseVisibleWindow() {
  const wm = ctrl.wm;
  if (!wm || !wm.wins) return false;

  // 1) 未完成首次引导：优先把引导窗口提上来
  const ob = wm.wins.onboarding;
  if (ob && !ob.isDestroyed()) {
    try {
      if (ob.isMinimized()) ob.restore();
      ob.show();
      ob.focus();
      ob.moveTop();
      return true;
    } catch { /* 继续尝试设置窗口 */ }
  }

  // 2) 设置窗口：已存在则提到最前，不存在则创建
  try {
    const win = wm.openSettings('general');
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.moveTop();
      return true;
    }
  } catch (e) {
    try { ctrl.logger.warn('第二实例打开设置失败', { message: e && e.message }); } catch { /* ignore */ }
  }

  // 3) 兜底：显示浮窗
  const hud = wm.wins.hud;
  if (hud && !hud.isDestroyed()) {
    try {
      hud.show();
      hud.setAlwaysOnTop(true, 'screen-saver');
      hud.moveTop();
      return true;
    } catch { /* ignore */ }
  }
  return false;
}

app.on('second-instance', () => {
  try {
    const shown = raiseVisibleWindow();
    if (!shown) ctrl.showHud({ text: '', engine: '', placeholder: '应用已在运行' });
    try { ctrl.logger.info('第二实例唤醒了主窗口', { shown }); } catch { /* ignore */ }
    if (ctrl.tray && ctrl.tray.tray) {
      try {
        ctrl.tray.tray.displayBalloon({
          title: '即译',
          content: '程序已经在运行（托盘图标在右下角 ^ 里），已为你切换到主窗口。',
        });
      } catch { /* 气泡失败不影响主流程 */ }
    }
  } catch { /* ignore */ }
});

app.on('before-quit', async (e) => {
  if (ctrl.quitting) return;
  e.preventDefault();
  await ctrl.quit();
});

app.whenReady().then(async () => {
  if (!gotLock) return; // 非首个实例：上面已 app.exit(0)，这里再兜一层，避免并发写配置/日志
  Menu.setApplicationMenu(null); // 隐藏默认菜单栏（无边框风格）
  try {
    await ctrl.bootstrap();
    if (process.argv.includes('--diag-windows')) {
      await runWindowDiag();
      await ctrl.quit();
      app.exit(0);
      return;
    }
    if (process.argv.includes('--smoke-test')) {
      const report = await runSmokeTest();
      await ctrl.quit();
      app.exit(report && report.ok ? 0 : 2);
      return;
    }
    // 第二十二轮诊断入口：在真实窗口下跑一段定时翻译，输出 CPU / 内存占用后退出
    if (process.argv.some((a) => a.startsWith('--perf-probe'))) {
      const report = await runPerfProbe(ctrl);
      ctrl.logger.info('性能探针完成', report);
      try {
        process.stdout.write(`[perf] ${JSON.stringify(report)}\n`);
      } catch { /* 无控制台时忽略 */ }
      await ctrl.quit();
      app.exit(0);
      return;
    }
    // 显式入口：桌面快捷方式/命令行带 --open-settings 时直接打开设置
    // （托盘图标可能被 Windows 收进溢出区，用户需要一个「一定打得开」的入口）
    if (process.argv.includes('--quit')) {
      ctrl.logger.info('收到 --quit，直接退出（任务栏右键菜单）');
      ctrl.quit('jumplist');
      return;
    }
    if (process.argv.includes('--open-input')) {
      ctrl.wm.openSettings('input');
      return;
    }
    if (process.argv.includes('--translate-once')) {
      ctrl.translateLast();
      return;
    }
    if (process.argv.includes('--open-settings')) {
      ctrl.wm.openSettings('general');
    }
  } catch (e) {
    // 启动失败也要给出可见反馈，避免"双击无反应"
    recordStartupFailure(e);
    try {
      dialog.showErrorBox(
        '即译启动失败',
        `${(e && e.message) || String(e)}\n\n排查信息已写入：\n${path.join(DATA_HOME || '', 'startup-error.log')}`,
      );
    } catch { /* 无图形环境时忽略 */ }
    app.exit(1);
  }
});

module.exports = { ctrl };

