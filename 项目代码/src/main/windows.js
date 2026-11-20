'use strict';
/**
 * 窗口管理（src/main/windows.js）
 *
 * 负责四个窗口的生命周期：
 *  - translation-hud  译文浮窗（F-12/F-13/F-14/F-16/F-17）透明、无边框、置顶、默认不抢焦点、可点击穿透
 *  - selection-overlay 框选遮罩（F-09，每块显示器一个窗口，避免跨屏坐标错乱）
 *  - settings         设置 + API 配置面板（M4-T1）
 *  - floating-ball    收起后的 40×40 悬浮球（F-16 / D3.3）
 *  - onboarding       首次启动引导（M5-T4）
 *
 * 安全：所有渲染进程 `contextIsolation: true, nodeIntegration: false, sandbox: true`，
 * 只通过 preload 暴露的白名单 IPC 与主进程通信（限制书第 8 节「权限申请」）。
 */
const path = require('path');
/** 应用显示名（第十二轮改名「即译」） */
const APP_NAME = '即译';
const { BrowserWindow, screen, app } = require('electron');

const { CHANNELS } = require('../shared/ipc-channels');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
// 二次元风格图标（assets/app.png，256px）。Windows 任务栏/Alt+Tab 取窗口 icon，
// 打包后的 exe 图标由 launcher 的 /win32icon 决定，两者用同一份素材。
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'app.png');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');

const HUD_DEFAULT = { width: 460, height: 240, minWidth: 280, minHeight: 96 };
const BALL_SIZE = 44;
/**
 * 悬浮球窗口（第二十六轮：圆形小气泡环绕）。
 *
 * 窗口固定 200×200，球贴窗口底角，四个选项各自是一个 38px 的圆形气泡，
 * 沿球心半径为 74px 的圆弧排开（像 iOS 的辅助触控菜单）。
 * 弧线朝哪边由主进程按球的屏幕位置决定：贴右边缘就往左上方长，贴左边缘就往右上方长，
 * 在屏幕中间则向上方铺开——永远朝屏幕内侧，不会有一半气泡跑到屏幕外。
 *
 * 窗口尺寸仍然**永不变化**（改了会闪黑框），只切换 `data-open`。
 */
const BALL_BUBBLE_SIZE = 38; // 单个圆形气泡的直径
const BALL_LAYOUT_R = 74; // 气泡中心到球心的半径
const BALL_WIN_W = 200;
const BALL_WIN_H = 200;
/**
 * 三种布局：`side` 决定球在窗口里的位置（贴哪条边），`angles` 是四个气泡的极角（度，屏幕坐标 y 向下）。
 * - left：球在右下角，气泡铺在左上方的 90° 扇形里
 * - right：球在左下角，镜像
 * - center：球在底部居中，气泡在头顶张成 ~110° 的扇形
 */
const BALL_LAYOUTS = {
  left: { cx: 178, cy: 178, angles: [180, 210, 240, 270] },
  right: { cx: 22, cy: 178, angles: [270, 300, 330, 360] },
  center: { cx: 100, cy: 178, angles: [215, 250, 290, 325] },
};
const BALL_ITEMS = 4;
const TOP_LEVEL = 'screen-saver'; // 高于全屏视频/游戏窗口（F-15）

function rendererFile(name) {
  return path.join(RENDERER_DIR, name, 'index.html');
}

function baseWebPreferences(extra = {}) {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    devTools: !app.isPackaged,
    ...extra,
  };
}

class WindowManager {
  constructor({ logger }) {
    this.logger = logger;
    this.wins = { hud: null, settings: null, ball: null, onboarding: null };
    /** @type {Array<{win: BrowserWindow, bounds: {x:number,y:number,width:number,height:number}}>} */
    this.overlays = [];
    this.hudIgnoreMouse = true;
    this.ballIgnoreMouse = true;
    this.onHudClosed = null;
    this.onOverlayRegion = null;
    this.onOverlayCancel = null;
    this.onMoved = null; // (target, bounds) => void
    this.onSettingsVisibility = null; // ({visible}) => void
    this.onTrayAccepted = null; // () => boolean，托盘是否真的进了通知区域（决定关闭设置页时 hide 还是 minimize）
    this._ballExpanded = false; // 悬浮球悬停展开状态（第十九轮需求 4）
    this._ballSide = 'center'; // 气泡弧线朝哪边开：left / right / center（由球的屏幕位置决定）
  }

  // ---------------------------------------------------------------- 浮窗

  /** 创建（或复用）译文浮窗 */
  ensureHud(opts = {}) {
    if (this.wins.hud && !this.wins.hud.isDestroyed()) return this.wins.hud;
    const win = new BrowserWindow({
      width: opts.width || HUD_DEFAULT.width,
      height: opts.height || HUD_DEFAULT.height,
      minWidth: HUD_DEFAULT.minWidth,
      minHeight: HUD_DEFAULT.minHeight,
      show: false,
      icon: APP_ICON,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // F-17：显示/更新译文不抢目标窗口焦点 —— 用 showInactive() 保证，而不是 focusable:false。
      // 实测（Windows 10 + Electron 28 + transparent+WS_EX_NOACTIVATE）：focusable:false 时
      // 窗口收得到 mousemove 却收不到任何点击事件，按钮全部失效；focusable:true 且始终
      // showInactive() 既能点击、又不会抢走游戏/视频窗口的焦点。
      focusable: process.env.DT_HUD_NOACTIVATE !== '1',
      acceptFirstMouse: true,
      title: APP_NAME,
      webPreferences: baseWebPreferences({ backgroundThrottling: false }),
    });

    win.setAlwaysOnTop(true, TOP_LEVEL);
    win.setSkipTaskbar(true);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 同理：透明浮窗也不该有系统投影，否则卡片外会糊一圈黑边（第二十轮）
    try { win.setHasShadow(false); } catch { /* 忽略 */ }
    // M3-T2：默认整窗穿透，仅命中文可交互元素时由渲染进程请求关闭穿透
    win.setIgnoreMouseEvents(true, { forward: true });

    win.on('moved', () => {
      if (this.onMoved && !win.isDestroyed()) this.onMoved('hud', win.getBounds());
    });
    win.on('closed', () => {
      this.wins.hud = null;
      if (this.onHudClosed) this.onHudClosed();
    });

    win.loadFile(rendererFile('hud'));
    this.wins.hud = win;
    return win;
  }

  async showHud(data) {
    const win = this.ensureHud({ width: data && data.width, height: data && data.height });
    this.sendTo(win, CHANNELS.HUD_RENDER, data);
    if (!win.isVisible()) win.showInactive();
    return win;
  }

  hideHud() {
    const win = this.wins.hud;
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  }

  get hudVisible() {
    return !!(this.wins.hud && !this.wins.hud.isDestroyed() && this.wins.hud.isVisible());
  }

  setHudBounds(bounds) {
    const win = this.wins.hud;
    if (!win || win.isDestroyed()) return;
    win.setBounds(bounds);
  }

  /** 调整浮窗尺寸（需求 3）。范围与配置一致：宽 280~1200、高 96~900 */
  /**
   * 调整浮窗尺寸。
   * maxWidth：字幕模式允许拉到工作区宽度（卡片模式仍限制 1200）；
   * x：拖左边缘时窗口左边要跟着走，传入新的左上角 x。
   */
  setHudSize({ width, height, maxWidth, minHeight, x }) {
    const win = this.wins.hud;
    if (!win || win.isDestroyed()) return null;
    if (!width || !height) return null;
    const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));
    const b = win.getBounds();
    win.setBounds({
      x: Number.isFinite(x) ? Math.round(x) : b.x,
      y: b.y,
      width: clamp(width, 280, clamp(maxWidth || 1200, 280, 4000)),
      height: clamp(height, clamp(minHeight || 96, 48, 900), 900),
    });
    return win.getBounds();
  }

  /**
   * 关闭/开启点击穿透（M3-T2 + 修正版 3）。
   * 开启穿透时必须 forward: true，否则渲染进程收不到 mousemove，无法判断是否悬停到交互元素。
   */
  setHudIgnoreMouse(ignore) {
    const win = this.wins.hud;
    if (!win || win.isDestroyed()) return { ignored: null };
    const next = !!ignore;
    this.hudIgnoreMouse = next;
    win.setIgnoreMouseEvents(next, next ? { forward: true } : undefined);
    return { ignored: next };
  }

  /**
   * 悬浮球的点击穿透（第二十五轮）：球窗口是固定大小的「气泡 + 球」整块区域，
   * 透明部分必须放行鼠标事件，否则会挡住下面的窗口。
   * 由 `BallPointerWatcher` 每 90ms 根据光标位置决定开/关。
   */
  setBallIgnoreMouse(ignore, opts = {}) {
    const win = this.wins.ball;
    if (!win || win.isDestroyed()) return { ignored: null };
    const next = !!ignore;
    this.ballIgnoreMouse = next;
    try {
      win.setIgnoreMouseEvents(next, next ? { forward: true } : undefined);
      if (opts.log) this.logger.debug('悬浮球穿透状态', { ignored: next });
    } catch { /* 窗口销毁瞬间忽略 */ }
    return { ignored: next };
  }

  get hudSize() {
    const win = this.wins.hud;
    if (!win || win.isDestroyed()) return { width: HUD_DEFAULT.width, height: HUD_DEFAULT.height };
    const b = win.getBounds();
    return { width: b.width, height: b.height };
  }

  // ---------------------------------------------------------------- 悬浮球

  ensureBall(opts = {}) {
    if (this.wins.ball && !this.wins.ball.isDestroyed()) return this.wins.ball;
    const win = new BrowserWindow({
      // 窗口一开始就是「气泡 + 球」的整块区域：悬停只切内容显隐，不改尺寸，
      // 避免透明窗 resize 时闪黑框（第二十五轮需求 1）。
      width: BALL_WIN_W,
      height: BALL_WIN_H,
      show: false,
      icon: APP_ICON,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // 与浮窗同样的坑：focusable:false（WS_EX_NOACTIVATE）时 Windows 只投递 mousemove、
      // 不投递任何鼠标按下事件 → 悬浮球既点不动也拖不动。改为可聚焦 + showInactive()，
      // 既能接收点击/拖动，又不会抢走目标窗口焦点（F-17）。
      focusable: process.env.DT_BALL_NOACTIVATE !== '1',
      acceptFirstMouse: true,
      title: `${APP_NAME}-悬浮球`,
      webPreferences: baseWebPreferences({ backgroundThrottling: false }),
    });
    win.setAlwaysOnTop(true, TOP_LEVEL);
    win.setSkipTaskbar(true);
    // 透明窗口在 Windows 上仍可能被 DWM 画一圈投影（表现为球旁边一条黑边），
    // hasShadow:false 在部分版本不生效，创建后再显式关一次（第二十轮用户反馈）。
    try { win.setHasShadow(false); } catch { /* 旧版本无此 API 时忽略 */ }
    if (opts.point) {
      const p = this.ballWindowPosition(opts.point);
      win.setPosition(Math.round(p.x), Math.round(p.y));
    }
    win.on('moved', () => {
      if (!this.onMoved || win.isDestroyed()) return;
      // 写回的是「球」的位置，不是窗口位置（窗口还包含上方的气泡区域）
      this.onMoved('ball', this.ballPointOf(win.getBounds()));
    });
    win.on('closed', () => { this.wins.ball = null; });
    win.loadFile(rendererFile('ball'));
    this.wins.ball = win;
    return win;
  }

  showBall(point) {
    const win = this.ensureBall({ point });
    if (point) {
      const p = this.ballWindowPosition(point);
      win.setPosition(Math.round(p.x), Math.round(p.y));
    }
    this._ballExpanded = false;
    this._ballSide = point ? this.ballSideFor(point) : (this._ballSide || 'center');
    win.showInactive();
    // 初始按"穿透"起：整块窗口大部分是透明的，先放行鼠标事件，
    // 光标移到球上时由 BallPointerWatcher 关掉穿透（第二十五轮）。
    this.setBallIgnoreMouse(true);
    // 球在窗口里的位置由 side 决定，渲染进程需要这份布局才能把球摆对，
    // 且页面可能还没加载完 → 两种时机都推一次。
    const push = () => {
      if (!win || win.isDestroyed()) return;
      try {
        win.webContents.send('ball:state', {
          expanded: false,
          side: this._ballSide,
          layout: this.ballLayout(this._ballSide),
        });
      } catch { /* 页面还未就绪时忽略，did-finish-load 会再推一次 */ }
    };
    push();
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', push);
    } else {
      push();
    }
    return win;
  }

  /** 球左上角（屏幕坐标）→ 窗口左上角（球贴窗口底角，具体哪个角看 side） */
  ballWindowPosition(point) {
    const side = this.ballSideFor(point);
    this._ballSide = side;
    const layout = BALL_LAYOUTS[side];
    return {
      x: Math.round(point.x - layout.cx),
      y: Math.round(point.y - layout.cy),
    };
  }

  /** 窗口矩形 → 球左上角（屏幕坐标），供 onMoved 写回配置 */
  ballPointOf(bounds) {
    const layout = BALL_LAYOUTS[this._ballSide] || BALL_LAYOUTS.center;
    return {
      x: Math.round(bounds.x + layout.cx),
      y: Math.round(bounds.y + layout.cy),
    };
  }

  /** 球在窗口内的客户区矩形（供穿透/悬停判定用） */
  ballClientRect() {
    const layout = BALL_LAYOUTS[this._ballSide] || BALL_LAYOUTS.center;
    return {
      x: layout.cx - BALL_SIZE / 2,
      y: layout.cy - BALL_SIZE / 2,
      w: BALL_SIZE,
      h: BALL_SIZE,
    };
  }

  hideBall() {
    const win = this.wins.ball;
    if (win && !win.isDestroyed()) win.hide();
  }

  get ballExpanded() {
    return !!(this._ballExpanded && this.wins.ball && !this.wins.ball.isDestroyed());
  }

  /** 球贴着哪条边，决定气泡弧线朝哪边开 */
  ballSideFor(point) {
    const wa = this.ballWorkArea(point);
    const midLeft = wa.x + wa.width * 0.38;
    const midRight = wa.x + wa.width * 0.62;
    if (point.x >= wa.x + wa.width - 120) return 'left'; // 贴右边 → 往左上长
    if (point.x <= wa.x + 120) return 'right'; // 贴左边 → 往右上长
    if (point.x > midRight) return 'left';
    if (point.x < midLeft) return 'right';
    return 'center';
  }

  /** 球所在显示器的工作区 */
  ballWorkArea(point) {
    try {
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        return screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).workArea;
      }
    } catch {
      /* 忽略：退回主屏 */
    }
    return screen.getPrimaryDisplay().workArea;
  }

  /**
   * 生成一次布局：球心在窗口内的坐标 + 四个气泡的中心坐标（窗口坐标系）。
   * 主进程算出来后整块下发给渲染进程，避免两边各写一套极坐标公式而错位。
   */
  ballLayout(side) {
    const key = BALL_LAYOUTS[side] ? side : 'center';
    const base = BALL_LAYOUTS[key];
    const bubbles = base.angles.map((deg, i) => {
      const rad = (deg * Math.PI) / 180;
      return {
        index: i,
        x: Math.round(base.cx + BALL_LAYOUT_R * Math.cos(rad) - BALL_BUBBLE_SIZE / 2),
        y: Math.round(base.cy + BALL_LAYOUT_R * Math.sin(rad) - BALL_BUBBLE_SIZE / 2),
        angle: deg,
      };
    });
    return {
      side: key,
      cx: base.cx,
      cy: base.cy,
      ballSize: BALL_SIZE,
      bubbleSize: BALL_BUBBLE_SIZE,
      radius: BALL_LAYOUT_R,
      bubbles,
      winW: BALL_WIN_W,
      winH: BALL_WIN_H,
    };
  }

  /**
   * 球被拖动到别处后重算「气泡朝哪边开」。
   *
   * 窗口是「气泡区 + 球」的整块矩形，球固定在窗口的某个角上；
   * 一旦球被拖到屏幕另一侧，弧线方向就要翻转，并且窗口要重新摆位
   * （保持球在屏幕上原地不动），否则一半气泡会飘到屏幕外。
   */
  refreshBallSide() {
    const win = this.wins.ball;
    if (!win || win.isDestroyed()) return null;
    const pt = this.ballPointOf(win.getBounds());
    const side = this.ballSideFor(pt);
    if (side !== this._ballSide) {
      this._ballSide = side;
      const p = this.ballWindowPosition(pt);
      win.setPosition(Math.round(p.x), Math.round(p.y));
    }
    const payload = {
      expanded: !!this._ballExpanded,
      side: this._ballSide,
      layout: this.ballLayout(this._ballSide),
    };
    try {
      win.webContents.send('ball:state', payload);
    } catch { /* 页面未就绪时忽略 */ }
    return payload;
  }

  /**
   * 悬停展开 / 收起气泡菜单。
   *
   * 与旧实现的区别：**不再改窗口尺寸**。窗口固定 200×200，
   * 这里只切一个布尔状态并把布局广播给渲染进程；渲染进程用 CSS 过渡
   * 做「气泡从球心向外胀开」的动画，所以不会有黑框闪动。
   */
  setBallExpanded(expanded) {
    const win = this.wins.ball;
    if (!win || win.isDestroyed() || !win.isVisible()) return null;
    this._ballExpanded = !!expanded;
    return {
      expanded: this._ballExpanded,
      side: this._ballSide,
      layout: this.ballLayout(this._ballSide),
      bounds: win.getBounds(),
    };
  }

  // ---------------------------------------------------------------- 框选遮罩

  /** 为每块显示器创建一个全屏透明遮罩窗口（M2-T1） */
  openOverlay() {
    this.closeOverlay();
    const displays = screen.getAllDisplays();
    const created = [];
    for (const display of displays) {
      const b = display.bounds;
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        show: false,
      icon: APP_ICON,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        enableLargerThanScreen: true,
        title: `${APP_NAME}-框选`,
        webPreferences: baseWebPreferences(),
      });
      win.setAlwaysOnTop(true, TOP_LEVEL);
      win.setMenuBarVisibility(false);
      win.loadFile(rendererFile('overlay'));
      win.on('closed', () => {
        this.overlays = this.overlays.filter((o) => o.win !== win);
      });
      this.overlays.push({ win, bounds: b });
      created.push(win);
    }
    // 光标所在显示器优先获得焦点，便于 ESC 取消
    const cursor = screen.getCursorScreenPoint();
    const focusTarget = this.overlays.find((o) => (
      cursor.x >= o.bounds.x && cursor.x < o.bounds.x + o.bounds.width
      && cursor.y >= o.bounds.y && cursor.y < o.bounds.y + o.bounds.height
    ));
    for (const { win, bounds } of this.overlays) {
      win.showInactive();
      win.setBounds(bounds);
    }
    if (focusTarget) {
      focusTarget.win.setAlwaysOnTop(true, TOP_LEVEL);
      focusTarget.win.focus();
    }
    this.logger && this.logger.debug('框选遮罩已打开', { displays: displays.length });
    return this.overlays.length;
  }

  closeOverlay() {
    for (const { win } of this.overlays) {
      if (win && !win.isDestroyed()) win.close();
    }
    this.overlays = [];
  }

  get overlayOpen() {
    return this.overlays.length > 0;
  }

  /** 渲染进程上报的本地坐标 → 全局屏幕坐标（多显示器修正） */
  resolveOverlayRegion(senderWebContentsId, rect) {
    const entry = this.overlays.find((o) => o.win.webContents.id === senderWebContentsId);
    const bounds = entry ? entry.bounds : { x: 0, y: 0 };
    const x = Math.round(bounds.x + rect.x);
    const y = Math.round(bounds.y + rect.y);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    return { x, y, width, height };
  }

  // ---------------------------------------------------------------- 设置窗口

  ensureSettings(tab) {
    if (this.wins.settings && !this.wins.settings.isDestroyed()) return this.wins.settings;
    const win = new BrowserWindow({
      width: 780,
      height: 620,
      minWidth: 680,
      minHeight: 480,
      show: false,
      icon: APP_ICON,
      frame: false,
      transparent: false,
      backgroundColor: '#12151c',
      resizable: true,
      skipTaskbar: false,
      title: `${APP_NAME} · 设置`,
      webPreferences: baseWebPreferences(),
    });
    // 第十二轮需求 1：关掉设置页与浮窗后「任务栏图标消失，但软件不退出」。
    // 隐藏窗口（hide）比最小化更符合预期——隐藏窗口不会在任务栏留按钮；
    // 再次打开走托盘图标 / 再次双击 exe，退出只走「托盘 → 退出」/ 关于页按钮 / --quit。
    //
    // 兜底（第十三轮）：本机通知区域会拒绝注册图标（原生 WinForms NotifyIcon 同样失败），
    // 这时候 hide 之后用户可能再也找不到入口，所以托盘不可用时改为「最小化」，保留任务栏按钮。
    win.on('close', (e) => {
      if (this._allowClose) return;
      e.preventDefault();
      const trayOk = typeof this.onTrayAccepted === 'function' ? !!this.onTrayAccepted() : true;
      if (!trayOk) {
        win.minimize();
        this._emitSettingsVisibility(false);
        return;
      }
      win.hide();
      win.setSkipTaskbar(true);
      this._emitSettingsVisibility(false);
    });
    win.on('closed', () => {
      this.wins.settings = null;
      this._emitSettingsVisibility(false);
    });
    win.on('show', () => this._emitSettingsVisibility(true));
    win.on('hide', () => this._emitSettingsVisibility(false));
    win.loadFile(rendererFile('settings'), { hash: tab || 'general' });
    this.wins.settings = win;
    return win;
  }

  openSettings(tab) {
    // 显示设置窗口时把任务栏按钮加回来（关闭时被 setSkipTaskbar(true) 隐藏了）
    const existing = this.wins.settings;
    if (existing && !existing.isDestroyed()) { try { existing.setSkipTaskbar(false); } catch { /* ignore */ } }
    const win = this.ensureSettings(tab);
    if (!win.isVisible()) win.show();
    win.focus();
    if (tab && win.webContents) win.webContents.send(CHANNELS.EVENT, { type: 'settings-tab', payload: { tab } });
    this._emitSettingsVisibility(true);
    return win;
  }

  /** 退出前放行窗口关闭（否则 close 事件会被最小化逻辑拦下） */
  prepareQuit() {
    this._allowClose = true;
  }

  /** 设置窗口当前是否可见 */
  get settingsVisible() {
    return !!(this.wins.settings && !this.wins.settings.isDestroyed() && this.wins.settings.isVisible());
  }

  /**
   * 打开/关闭切换（需求 2：浮窗 ⚙ 再点一次关闭设置页）。
   * @returns {boolean} 切换后是否处于打开状态
   */
  toggleSettings(tab) {
    if (this.settingsVisible) {
      this.wins.settings.hide();
      this._emitSettingsVisibility(false);
      return false;
    }
    this.openSettings(tab || 'general');
    return true;
  }

  _emitSettingsVisibility(visible) {
    if (this.onSettingsVisibility) this.onSettingsVisibility({ visible: !!visible });
  }

  // ---------------------------------------------------------------- 首次引导

  ensureOnboarding() {
    if (this.wins.onboarding && !this.wins.onboarding.isDestroyed()) return this.wins.onboarding;
    const win = new BrowserWindow({
      width: 660,
      height: 520,
      show: false,
      icon: APP_ICON,
      frame: false,
      transparent: false,
      backgroundColor: '#12151c',
      resizable: false,
      title: `${APP_NAME} · 首次使用`,
      webPreferences: baseWebPreferences(),
    });
    win.on('closed', () => { this.wins.onboarding = null; });
    win.loadFile(rendererFile('onboarding'));
    this.wins.onboarding = win;
    return win;
  }

  openOnboarding() {
    const win = this.ensureOnboarding();
    win.show();
    win.focus();
    return win;
  }

  closeOnboarding() {
    const win = this.wins.onboarding;
    if (win && !win.isDestroyed()) win.close();
  }

  // ---------------------------------------------------------------- 广播

  allWindows() {
    const list = Object.values(this.wins).filter((w) => w && !w.isDestroyed());
    for (const { win } of this.overlays) if (win && !win.isDestroyed()) list.push(win);
    return list;
  }

  sendTo(win, channel, payload) {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }

  broadcast(channel, payload) {
    for (const win of this.allWindows()) this.sendTo(win, channel, payload);
  }

  emit(type, payload) {
    this.broadcast(CHANNELS.EVENT, { type, payload });
  }
}

module.exports = {
  WindowManager,
  HUD_DEFAULT,
  BALL_SIZE,
  BALL_WIN_W,
  BALL_WIN_H,
  BALL_BUBBLE_SIZE,
  BALL_LAYOUT_R,
  BALL_LAYOUTS,
  RENDERER_DIR,
  PRELOAD,
  TOP_LEVEL,
};
