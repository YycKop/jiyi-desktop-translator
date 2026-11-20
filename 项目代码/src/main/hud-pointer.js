'use strict';
/**
 * 浮窗点击穿透控制器（M3-T2 / F-14，修正版 3 的 Electron 等价实现）
 *
 * 为什么需要主进程轮询，而不是只靠渲染进程的 mousemove：
 *   浮窗默认 setIgnoreMouseEvents(true, { forward: true })，理论上会转发 mousemove，
 *   但在 Windows + 透明无边框 + focusable:false 的组合下实测**收不到**转发事件，
 *   于是渲染进程永远不会请求关闭穿透，用户就会觉得"浮窗上的按钮点不动"。
 *   这里改为主进程按 120ms 轮询真实光标位置：
 *     - 光标不在浮窗范围内 → 保持穿透（不挡下层窗口）
 *     - 光标在浮窗范围内 → 在渲染进程里做 elementFromPoint 命中判断，
 *       命中 `.interactive` 才关闭穿透，从而既能点按钮，又能让空白区域继续穿透。
 *
 * 权威性：主进程是唯一权威来源，每 tick 用「期望值 ≠ 实际值」纠正，
 * 因此渲染进程即使也调用 setClickThrough，也不会把状态卡在穿透态。
 */

const { screen } = require('electron');

const POLL_MS = 120;
const HIT_PROBE_COOLDOWN_MS = 90;

/** 在渲染进程里判断该客户区坐标是否落在可交互元素上（CDP 求值，不受页面 CSP 限制） */
function probeInteractive(win, x, y) {
  const script = `(() => {
    const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
    return !!(el && el.closest('.interactive'));
  })()`;
  return win.webContents.executeJavaScript(script, true).catch(() => false);
}

class HudPointerWatcher {
  constructor({
    getHudWindow, getCurrentIgnore, onIgnoreChange, logger, pollMs = POLL_MS,
  }) {
    this.getHudWindow = getHudWindow;
    this.getCurrentIgnore = getCurrentIgnore || (() => null);
    this.onIgnoreChange = onIgnoreChange;
    this.logger = logger;
    this.pollMs = pollMs;
    this.timer = null;
    this.busy = false;
    this.lastProbeAt = 0;
    this.lastDesired = null;
    this.paused = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.busy = false;
    this.lastDesired = null;
  }

  /** 拖动/调整大小时暂停轮询，避免中途把窗口切成穿透态导致拖拽中断 */
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.lastProbeAt = 0;
  }

  /** 统一出口：只有在期望值与实际值不一致时才真正调用 setIgnoreMouseEvents */
  apply(desired) {
    this.lastDesired = desired;
    let current = null;
    try { current = this.getCurrentIgnore(); } catch { /* ignore */ }
    if (current === desired) return;
    if (this.logger) this.logger.info('浮窗穿透状态切换', { ignored: desired });
    try {
      if (this.onIgnoreChange) this.onIgnoreChange(desired);
    } catch (e) {
      if (this.logger) this.logger.warn('切换浮窗穿透失败', { message: e && e.message });
    }
  }

  async tick() {
    if (this.busy) return;
    if (this.paused) return;
    const win = this.getHudWindow && this.getHudWindow();
    if (!win || win.isDestroyed() || !win.isVisible()) {
      this.lastDesired = null;
      return;
    }
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    const b = win.getBounds();
    const inside = point.x >= b.x && point.x < b.x + b.width
      && point.y >= b.y && point.y < b.y + b.height;

    if (!inside) {
      // 光标离开浮窗 → 恢复穿透，不遮挡下层窗口
      this.apply(true);
      return;
    }

    const now = Date.now();
    if (now - this.lastProbeAt < HIT_PROBE_COOLDOWN_MS) return;
    this.lastProbeAt = now;

    this.busy = true;
    try {
      const hit = await probeInteractive(win, point.x - b.x, point.y - b.y);
      this.apply(!hit);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { HudPointerWatcher, POLL_MS };
