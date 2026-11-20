'use strict';
/**
 * IPC 处理器（src/main/ipc.js）
 *
 * 渲染进程唯一可用的主进程能力入口，通道定义见 src/shared/ipc-channels.js。
 * 统一返回 `{ ok: true, data }` / `{ ok: false, code, message }`，异常不外泄密钥与原文
 * （限制书 KEY-03 / LOG-02：错误消息只描述操作类型，不含文本内容）。
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app, screen, BrowserWindow } = require('electron');

const { CHANNELS } = require('../shared/ipc-channels');
const { normalizeAccelerator, acceleratorFromEvent } = require('../shared/accelerator');
const paths = require('../core/paths');
const themeFiles = require('./theme-files');

function userMessage(e) {
  if (e && typeof e.toUser === 'function') {
    try { return e.toUser(); } catch { /* ignore */ }
  }
  return (e && e.message) || '操作失败';
}

function fail(e) {
  return { ok: false, code: (e && e.code) || 'INTERNAL', message: userMessage(e) };
}

function register(ctx) {
  const { engine, wm, logger, ctrl } = ctx;
  const log = logger.child ? logger.child('ipc') : logger;

  // 诊断开关：DT_IPC_LOG=1 时把每次 IPC 调用记入日志（便于排查"点了没反应"）
  const IPC_TRACE = process.env.DT_IPC_LOG === '1';

  /** 包装：统一错误处理 + 日志 */
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (IPC_TRACE) log.info('IPC 调用', { channel });
      try {
        const data = await fn(event, ...args);
        return { ok: true, data: data === undefined ? null : data };
      } catch (e) {
        log.warn('IPC 调用失败', { channel, code: e && e.code });
        return fail(e);
      }
    });
  };

  // ------------------------------------------------------------ 应用
  handle(CHANNELS.APP_STATUS, async () => {
    const st = engine.status();
    return {
      ...st,
      hotkeys: ctrl.hotkeyStatus(),
      hud: { visible: wm.hudVisible, ignored: wm.hudIgnoreMouse },
      window: { collapsed: !!(wm.wins.ball && wm.wins.ball.isVisible()) },
    };
  });

  handle(CHANNELS.APP_QUIT, async () => { setImmediate(() => ctrl.quit()); return true; });

  handle(CHANNELS.APP_NOTICE, async (_e, notice) => engine.addNotice(notice));

  handle(CHANNELS.APP_LOG_TAIL, async () => {
    const file = path.join(engine.paths.logsDir(), 'app.log');
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, 'utf8').split('\n').slice(-200);
    return text;
  });

  // 托盘状态/手动重挂：用户反馈「任务栏 ^ 里看不到图标」，提供一个可自证的入口
  handle(CHANNELS.APP_TRAY_STATUS, async () => (ctrl.tray ? ctrl.tray.status() : { created: false }));
  handle(CHANNELS.APP_TRAY_RETRY, async () => {
    const st = ctrl.tray ? ctrl.tray.retryNow() : { created: false };
    return { ...st, message: st.accepted ? '托盘图标已重新挂载' : '已重挂，但系统未确认位置（若仍看不到，可重启资源管理器后重试）' };
  });

  // ------------------------------------------------------------ 配置
  handle(CHANNELS.CONFIG_GET, async () => engine.getConfig());
  handle(CHANNELS.CONFIG_PATCH, async (_e, patch) => engine.patchConfig(patch));

  // ------------------------------------------------------------ API 接口
  handle(CHANNELS.API_LIST, async () => engine.listApis());
  handle(CHANNELS.API_PRESETS, async () => engine.getPresets());
  handle(CHANNELS.API_ADD, async (_e, input) => engine.addApi(input));
  handle(CHANNELS.API_UPDATE, async (_e, payload) => engine.updateApi(payload.id, payload.patch || {}));
  handle(CHANNELS.API_REMOVE, async (_e, id) => engine.removeApi(id));
  handle(CHANNELS.API_REORDER, async (_e, ids) => engine.reorderApis(ids));
  handle(CHANNELS.API_TEST, async (_e, id) => engine.testApi(id));

  // ------------------------------------------------------------ 框选区域
  handle(CHANNELS.REGION_GET, async () => engine.getSelectionRegion());
  handle(CHANNELS.REGION_SET, async (_e, region) => engine.setSelectionRegion(region));

  handle(CHANNELS.OVERLAY_OPEN, async () => {
    const count = wm.openOverlay();
    return { overlays: count };
  });

  handle(CHANNELS.OVERLAY_SUBMIT, async (event, rect) => {
    const region = wm.resolveOverlayRegion(event.sender.id, rect || {});
    wm.closeOverlay();
    const saved = engine.setSelectionRegion(region);
    setImmediate(() => ctrl.onRegionSelected(saved));
    return saved;
  });

  handle(CHANNELS.OVERLAY_CANCEL, async () => {
    wm.closeOverlay();
    setImmediate(() => ctrl.onSelectionCanceled && ctrl.onSelectionCanceled());
    return true;
  });

  // ------------------------------------------------------------ 翻译
  handle(CHANNELS.TRANSLATE_RUN, async (_e, opts) => ctrl.runRound(opts || {}));
  handle(CHANNELS.TRANSLATE_ONCE, async () => ctrl.translateLast());
  handle(CHANNELS.TRANSLATE_TEXT, async (_e, payload) => engine.translateText(payload || {}));

  // ------------------------------------------------------------ 定时循环
  handle(CHANNELS.LOOP_START, async (_e, intervalMs) => ctrl.startLoop(intervalMs));
  handle(CHANNELS.LOOP_STOP, async () => ctrl.stopLoop('renderer'));
  handle(CHANNELS.LOOP_INTERVAL, async (_e, ms) => {
    const iv = engine.setIntervalMs(ms);
    if (engine.loop.isRunning()) ctrl.startLoop(iv);
    ctrl.refreshTray();
    return iv;
  });

  // ------------------------------------------------------------ 浮窗
  /**
   * 无边框窗口拖动（浮窗 / 悬浮球共用）。
   * Electron 的 -webkit-app-region: drag 对 focusable:false 的窗口不稳定，
   * 这里用渲染进程上报的光标屏幕坐标直接搬移窗口（不会激活窗口，F-17）。
   */
  const dragAnchors = new WeakMap();
  const HUD_DRAG_TICK_MS = 16;
  /* 第二十三轮：拖动和改尺寸用同一套「屏幕坐标绝对锚点 + 主进程轮询」。
   * 之前只靠渲染进程上报的 screenX/screenY：字幕条又宽又长，光标很快会移出窗口，
   * 事件一丢就"拖不动 / 拖一半停住"。现在主进程按 16ms 直接读真实光标，
   * 渲染进程的上报只当心跳。 */
  const applyHudDrag = (win) => {
    const a = dragAnchors.get(win);
    if (!a) return null;
    const pt = a.testCursor || readResizeCursor(null);
    if (!pt) return win.getBounds();
    try {
      win.setPosition(Math.round(a.x + (pt.x - a.cx)), Math.round(a.y + (pt.y - a.cy)));
    } catch (e) { stopHudDrag(win); }
    return win.getBounds();
  };
  const stopHudDrag = (win) => {
    const a = dragAnchors.get(win);
    if (!a) return;
    if (a.timer) clearInterval(a.timer);
    dragAnchors.delete(win);
    if (ctx.wm.onHudResizeActive) ctx.wm.onHudResizeActive(false);
    // 悬浮球拖动结束：先按新位置重算「气泡朝哪边开」（球被拖到屏幕另一侧时弧线要换方向，
    // 否则一半气泡会飘到屏幕外），再恢复「悬停浮出气泡」的光标轮询
    if (win === ctx.wm.wins.ball && ctx.wm.refreshBallSide) {
      try { ctx.wm.refreshBallSide(); } catch { /* 窗口刚被销毁时忽略 */ }
    }
    if (win === ctx.wm.wins.ball && ctx.ballPointer) ctx.ballPointer.resume();
  };
  const dragWindow = (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const p = payload || {};
    if (p.phase === 'start') {
      stopHudDrag(win);
      const b = win.getBounds();
      const cursor = readResizeCursor(p) || { x: b.x, y: b.y };
      const timer = setInterval(() => {
        try { applyHudDrag(win); } catch (e) { stopHudDrag(win); }
      }, HUD_DRAG_TICK_MS);
      if (timer.unref) timer.unref();
      dragAnchors.set(win, {
        x: b.x,
        y: b.y,
        cx: cursor.x,
        cy: cursor.y,
        testCursor: HUD_RESIZE_TEST_MODE && p.testCursor ? cursor : null,
        timer,
      });
      if (ctx.wm.onHudResizeActive) ctx.wm.onHudResizeActive(true);
      // 悬浮球被拖动时暂停悬停轮询，避免中途切穿透导致鼠标事件断掉
      if (win === ctx.wm.wins.ball && ctx.ballPointer) ctx.ballPointer.pause();
      return b;
    }
    if (p.phase === 'move') {
      const a = dragAnchors.get(win);
      if (!a) return win.getBounds();
      if (HUD_RESIZE_TEST_MODE && p.testCursor) {
        const c = readResizeCursor(p);
        if (c) a.testCursor = c;
      }
      return applyHudDrag(win) || win.getBounds();
    }
    const b = applyHudDrag(win) || win.getBounds();
    stopHudDrag(win);
    return b;
  };

  handle(CHANNELS.HUD_SHOW, async (_e, data) => ctrl.showHud(data || {}));
  handle(CHANNELS.HUD_HIDE, async () => { wm.hideHud(); ctrl.refreshTray(); return true; });
  handle(CHANNELS.HUD_COLLAPSE, async () => ctrl.collapse());
  handle(CHANNELS.HUD_EXPAND, async () => ctrl.expand());
  // 悬浮球：左键按「点击图标时打开」的配置走，右键弹出与托盘一致的四项菜单
  handle(CHANNELS.BALL_PRIMARY, async () => ctrl.ballPrimary());
  handle(CHANNELS.BALL_MENU, async () => ctrl.showBallMenu());
  handle(CHANNELS.BALL_HOVER, async (_e, open) => ctrl.setBallHover(!!open));
  handle(CHANNELS.BALL_ACTION, async (_e, action) => ctrl.ballAction(String(action || '')));
  handle(CHANNELS.HUD_SET_IGNORE, async (_e, ignore) => {
    const r = wm.setHudIgnoreMouse(!!ignore);
    try { ctx.logger.debug('渲染进程请求切换穿透', r); } catch { /* ignore */ }
    return r;
  });

  handle(CHANNELS.HUD_DRAG, async (event, payload) => dragWindow(event, payload));
  handle(CHANNELS.WINDOW_DRAG, async (event, payload) => dragWindow(event, payload));

  // 拖动右下角调整浮窗大小（需求 3）：以「按下瞬间的窗口尺寸 + 光标位移」计算，避免累积误差。
  //
  // 为什么由主进程轮询光标而不是靠渲染进程的 mousemove：
  // 用户实测「移动稍快就拖不动，松手后还在拖」。透明无边框小窗口在光标快速移出窗口范围时
  // 会丢 mousemove / mouseup（窗口没有拿到系统鼠标捕获），于是尺寸跟不上、松手也收不到 end。
  // 现在改成：start 时在主进程起一个 16ms 的定时器直接读 screen.getCursorScreenPoint() 调尺寸，
  // 渲染进程只负责告知「开始/结束」，也就不再依赖事件送达顺序。
  const HUD_RESIZE_TICK_MS = 16;
  const HUD_RESIZE_MAX_MS = 120000; // 兜底：极端情况下（end 丢失）最多拖 2 分钟
  const HUD_RESIZE_MIN_W = 320;
  let hudResize = null;

  /**
   * 把「光标位移量」换算成新的窗口几何。
   * - axis 'both'：右下角拖动，宽高同时变（卡片模式）
   * - axis 'x'：只改宽度（字幕模式，第十九轮需求 3）
   *   edge 'left' 时窗口右边保持不动、左边跟着光标走，视觉上就是「拖左边缘」
   * - axis 'y'：只改高度（字幕模式，第二十轮需求「动态调整显示区域大小」），
   *   拖的是底边，所以顶边固定、高度随光标走
   */
  const HUD_RESIZE_MIN_H = 64;
  const HUD_RESIZE_MAX_H = 400;
  // 光标与事件都静默超过这个时长，就当作 pointerup 丢了（第二十一轮需求 1）
  const HUD_RESIZE_STALE_MS = 2500;
  // 自检里没法真的移动系统鼠标，所以 `--smoke-test` 下允许渲染进程用 testCursor
  // 指定一个"假光标"。生产环境这个字段一律忽略，几何永远以真实光标为准。
  const HUD_RESIZE_TEST_MODE = process.argv.includes('--smoke-test');
  const readResizeCursor = (payload) => {
    if (HUD_RESIZE_TEST_MODE && payload && payload.testCursor
        && Number.isFinite(payload.testCursor.x) && Number.isFinite(payload.testCursor.y)) {
      return { x: Math.round(payload.testCursor.x), y: Math.round(payload.testCursor.y) };
    }
    try { return screen.getCursorScreenPoint(); } catch { return null; }
  };
  const calcHudBounds = (st, dx, dy) => {
    const base = st.base;
    if (st.axis === 'y') {
      const height = Math.min(HUD_RESIZE_MAX_H, Math.max(HUD_RESIZE_MIN_H, base.height + dy));
      return { width: base.width, height, x: base.x, minHeight: HUD_RESIZE_MIN_H };
    }
    if (st.axis !== 'x') {
      return { width: base.width + dx, height: base.height + dy, x: base.x };
    }
    const width = Math.max(HUD_RESIZE_MIN_W, st.edge === 'left' ? base.width - dx : base.width + dx);
    const x = st.edge === 'left' ? base.x + (base.width - width) : base.x;
    return { width, height: base.height, x };
  };

  const stopHudResize = (persist) => {
    if (!hudResize) return;
    if (hudResize.timer) clearInterval(hudResize.timer);
    const win = hudResize.win;
    const state = hudResize;
    hudResize = null;
    if (ctx.wm.onHudResizeActive) ctx.wm.onHudResizeActive(false);
    if (persist && win && !win.isDestroyed()) {
      const b = win.getBounds();
      try {
        if (state.axis === 'x') {
          // 字幕模式只记宽度（和拖出来的水平位置），卡片尺寸保持原样
          ctrl.engine.store.patch({
            hud: { subtitleWidth: b.width, subtitlePoint: { x: b.x, y: b.y } },
          }, { silent: true });
        } else if (state.axis === 'y') {
          // 拖底边只记字幕高度
          ctrl.engine.store.patch({
            hud: { subtitleHeight: b.height, subtitlePoint: { x: b.x, y: b.y } },
          }, { silent: true });
        } else {
          // 松手后把尺寸写进配置，下次打开沿用（静默，避免触发整页重渲染）
          ctrl.engine.store.patch({ hud: { width: b.width, height: b.height } }, { silent: true });
        }
      } catch (e) { ctx.logger.warn('保存浮窗尺寸失败', { code: e && e.code }); }
    }
    return state;
  };

  /**
   * 轮询兜底：渲染进程的 pointermove 有时会丢（快速移动、指针离开窗口、捕获失效）。
   * 第二十三轮改成「屏幕坐标绝对锚点」：以 start 时记录的光标点为原点，
   * 每一次都用「当前光标 - 原点」重算几何，而不是上一轮的增量。
   *
   * 为什么必须先改正这一点：旧实现里主进程每次轮询都把基准 rebase 成当前窗口几何，
   * 而渲染进程仍在用「事件坐标 - start 时的坐标」算绝对位移。
   * 于是两条驱动一叠加就会重复累加——垂直拖动（以及拖左边缘，因为窗口 x 会跟着动）
   * 表现成"抖、跳、拖不动"，而拖右边缘恰好没触发 rebase 才看起来正常。
   * 现在两边算的是同一个纯函数 f(原点, 当前屏幕坐标)，幂等，谁先到都不会互相打架。
   */
  const applyHudResize = () => {
    if (!hudResize) return;
    const st = hudResize;
    const win = st.win;
    if (!win || win.isDestroyed()) { stopHudResize(false); return; }
    const pt = st.testCursor || readResizeCursor(null);
    if (!pt) return;
    const now = Date.now();
    if (pt.x !== st.lastCursor.x || pt.y !== st.lastCursor.y) {
      st.lastCursor = pt;
      st.lastCursorAt = now;
    }
    const next = calcHudBounds(st, pt.x - st.startCursor.x, pt.y - st.startCursor.y);
    if (next.width === st.lastW && next.height === st.lastH && next.x === st.lastX) return;
    st.lastW = next.width;
    st.lastH = next.height;
    st.lastX = next.x;
    try {
      wm.setHudSize({ ...next, maxWidth: st.maxWidth, minHeight: st.minHeight });
    } catch (e) { stopHudResize(false); }
  };

  const tickHudResize = () => {
    if (!hudResize) return;
    const st = hudResize;
    const now = Date.now();
    if (now - st.startedAt > HUD_RESIZE_MAX_MS) { stopHudResize(true); return; }
    // 拖动期间渲染进程的 pointermove 也在持续上报，两者送来的都是绝对锚点，
    // 所以谁先到都只是"再算一遍"，不需要再让位给谁。
    applyHudResize();
    // 光标与事件都静默太久 —— pointerup 丢了，收尾（第二十一轮需求 1）
    const idleCursor = Date.now() - st.lastCursorAt;
    const idleRenderer = Date.now() - (st.lastRendererMoveAt || 0);
    if (idleCursor > HUD_RESIZE_STALE_MS && idleRenderer > HUD_RESIZE_STALE_MS) {
      stopHudResize(true);
    }
  };

  handle(CHANNELS.HUD_RESIZE, async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const p = payload || {};
    if (p.phase === 'start') {
      stopHudResize(false);
      const b = win.getBounds();
      const display = screen.getDisplayMatching(b);
      const cursor = readResizeCursor(p) || { x: b.x, y: b.y };
      const minHeight = p.axis === 'y' ? HUD_RESIZE_MIN_H : 96;
      hudResize = {
        win,
        base: { x: b.x, y: b.y, width: b.width, height: b.height },
        axis: p.axis === 'x' ? 'x' : (p.axis === 'y' ? 'y' : 'both'),
        edge: p.edge === 'left' ? 'left' : (p.edge === 'bottom' ? 'bottom' : 'right'),
        maxWidth: Math.max(HUD_RESIZE_MIN_W, (display && display.workAreaSize && display.workAreaSize.width) || 1200),
        minHeight,
        startCursor: cursor, // 绝对锚点：整个拖动过程不变
        testCursor: HUD_RESIZE_TEST_MODE && p.testCursor ? cursor : null,
        startedAt: Date.now(),
        lastW: b.width,
        lastH: b.height,
        lastX: b.x,
        lastCursor: cursor,
        lastCursorAt: Date.now(),
        lastRendererMoveAt: Date.now(),
        timer: setInterval(tickHudResize, HUD_RESIZE_TICK_MS),
      };
      if (hudResize.timer.unref) hudResize.timer.unref();
      if (ctx.wm.onHudResizeActive) ctx.wm.onHudResizeActive(true);
      return b;
    }
    if (p.phase === 'move') {
      if (!hudResize) return win.getBounds();
      // 渲染进程报告「按键已经松开」：pointerup 丢了也在这里收尾（第二十一轮需求 1）
      if (p.buttons === 0) { stopHudResize(true); return win.getBounds(); }
      hudResize.lastRendererMoveAt = Date.now();
      // 自检模式下把假光标记下来，几何用它算（生产环境 readResizeCursor 只认真实光标）
      const fake = readResizeCursor(p);
      if (HUD_RESIZE_TEST_MODE && p.testCursor && fake) hudResize.testCursor = fake;
      // 不再用事件坐标算几何（窗口自身在动，事件坐标是相对的，会形成反馈回路），
      // 只用它作为「还按着」的心跳，几何统一由真实光标算。
      applyHudResize();
      return win.getBounds();
    }
    stopHudResize(true);
    return win.getBounds();
  });

  // 内容变化后自适应高度（需求 3）：只在「自动高度」开启时生效
  handle(CHANNELS.HUD_AUTOHEIGHT, async (_e, height) => {
    const cfg = ctrl.engine.getConfig();
    if (!cfg.hud.autoHeight) return { applied: false, reason: 'auto-height-off' };
    const h = Math.round(Number(height) || 0);
    if (h < 96 || h > 900) return { applied: false, reason: 'out-of-range' };
    const win = wm.wins.hud;
    if (!win || win.isDestroyed()) return { applied: false };
    const b = win.getBounds();
    if (Math.abs(b.height - h) < 6) return { applied: false, height: b.height };
    const next = wm.setHudSize({ width: b.width, height: h });
    return { applied: true, bounds: next };
  });

  handle(CHANNELS.HUD_STATE, async () => ({
    visible: wm.hudVisible,
    ignored: wm.hudIgnoreMouse,
    bounds: wm.wins.hud && !wm.wins.hud.isDestroyed() ? wm.wins.hud.getBounds() : null,
  }));

  // ------------------------------------------------------------ 设置 / 热键
  handle(CHANNELS.SETTINGS_OPEN, async (_e, tab) => { wm.openSettings(tab); return true; });
  handle(CHANNELS.SETTINGS_CLOSE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return true;
  });
  // 需求 2：再点一次 ⚙ 关闭设置页
  handle(CHANNELS.SETTINGS_TOGGLE, async (_e, tab) => {
    const open = wm.toggleSettings(tab);
    return { open };
  });

  // ------------------------------------------------------------ 外观（需求 1）
  // 背景图相关：目录/大小/格式限制都在 theme-files 里（可单测），这里只做 IPC 编排
  // 两处背景图各自独立（用户要求「设置页和浮窗的背景分别设置」）：
  // target='hud' → appearance.bgImage，target='settings' → appearance.settingsBgImage
  const imageTarget = (payload) => {
    const t = payload && payload.target;
    return t === 'settings' ? 'settings' : 'hud';
  };

  handle(CHANNELS.THEME_PICK_IMAGE, async (_e, payload) => {
    const target = imageTarget(payload);
    const r = await dialog.showOpenDialog(wm.wins.settings || undefined, {
      title: target === 'settings' ? '选择设置页背景图' : '选择浮窗背景图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    // 复制到数据目录，原文件被删除/移动后主题仍然有效
    const img = themeFiles.importThemeImage(r.filePaths[0], Date.now(), target);
    const key = target === 'settings' ? 'settingsBgImage' : 'bgImage';
    ctrl.engine.store.patch({ appearance: { [key]: img.path } }, { silent: false });
    return { canceled: false, target, path: img.path, dataUrl: img.dataUrl };
  });

  handle(CHANNELS.THEME_CLEAR_IMAGE, async (_e, payload) => {
    const target = imageTarget(payload);
    const key = target === 'settings' ? 'settingsBgImage' : 'bgImage';
    const cfg = ctrl.engine.getConfig();
    const old = cfg.appearance && cfg.appearance[key];
    ctrl.engine.store.patch({ appearance: { [key]: '' } }, { silent: false });
    if (old) themeFiles.removeThemeImage(old);
    return { cleared: true, target };
  });

  handle(CHANNELS.THEME_GET_IMAGE, async (_e, payload) => {
    const cfg = ctrl.engine.getConfig();
    const img = themeFiles.resolveSurfaceImage(cfg.appearance, imageTarget(payload));
    return img ? { path: img.path, dataUrl: img.dataUrl, fallback: img.fallback === true } : null;
  });

  handle(CHANNELS.HOTKEY_STATUS, async () => ctrl.hotkeyStatus());

  handle(CHANNELS.HOTKEY_REGISTER, async (_e, payload) => {
    const action = payload && payload.action;
    const accelerator = normalizeAccelerator(payload && payload.accelerator);
    if (!action) throw Object.assign(new Error('缺少热键动作'), { code: 'CONFIG_INVALID' });
    const r = ctrl.registerHotkey(action, accelerator);
    return r;
  });

  handle(CHANNELS.HOTKEY_CAPTURE_START, async () => ctrl.beginHotkeyCapture());
  handle(CHANNELS.HOTKEY_CAPTURE_STOP, async () => ctrl.endHotkeyCapture());

  // ------------------------------------------------------------ 离线模型
  handle(CHANNELS.MODEL_STATUS, async () => engine.llama.status());
  handle(CHANNELS.MODEL_START, async () => ctrl.startModel());
  handle(CHANNELS.MODEL_STOP, async () => { await engine.llama.stop(); ctrl.refreshTray(); return engine.llama.status(); });

  handle(CHANNELS.MODEL_PICK_FILE, async () => {
    const r = await dialog.showOpenDialog(wm.wins.settings || undefined, {
      title: '选择 GGUF 离线模型',
      filters: [{ name: 'GGUF 模型', extensions: ['gguf'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const file = r.filePaths[0];
    engine.patchConfig({ offline: { modelPath: file } });
    return { path: file, name: path.basename(file) };
  });

  // ------------------------------------------------------------ 性能
  handle(CHANNELS.PERF_SAMPLE, async () => engine.memorySample());

  // ------------------------------------------------------------ 其他工具动作
  handle('shell:open-logs', async () => { shell.openPath(engine.paths.logsDir()); return true; });
  handle('shell:open-path', async (_e, p) => {
    // 白名单：只允许打开项目内的性能/日志目录
    const allowed = [engine.paths.logsDir(), engine.paths.perfDir(), engine.paths.modelsDir()];
    const target = path.resolve(String(p || ''));
    if (!allowed.some((a) => path.resolve(a) === target)) {
      throw Object.assign(new Error('不允许打开该目录'), { code: 'CONFIG_INVALID' });
    }
    shell.openPath(target);
    return true;
  });

  handle('sys:displays', async () => screen.getAllDisplays().map((d) => ({
    id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor,
  })));

  handle('sys:version', async () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }));

  log.info('IPC 已注册');
}

/** 供渲染进程校验候选热键（无副作用） */
function probeAccelerator(accelerator) {
  return normalizeAccelerator(accelerator);
}

module.exports = { register, acceleratorFromEvent, probeAccelerator };
