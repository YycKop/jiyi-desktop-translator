'use strict';
/**
 * 悬浮球的「悬停浮出气泡」与点击穿透控制（第二十五轮需求 1）。
 *
 * 为什么需要主进程轮询：
 *   球窗口现在是固定大小的「气泡 + 球」整块区域（约 150×202）。为了让用户
 *   点在透明区域时事件还能落到底下窗口，窗口平时必须开穿透
 *   （`setIgnoreMouseEvents(true, { forward: true })`）；而开了穿透就收不到
 *   `mouseenter`，所以「鼠标移到球上 → 浮出气泡」只能由主进程按光标位置判断。
 *
 * 判定规则（每 90ms 一次，只读 screen.getCursorScreenPoint()）：
 *   - 光标落在球上          → 关穿透（可点可拖）+ 展开气泡
 *   - 已展开且光标仍在窗口内 → 关穿透 + 保持展开（从球滑到气泡的路上不会误收）
 *   - 其余情况              → 开穿透 + 收起气泡
 */

const { screen } = require('electron');

const POLL_MS = 90;

class BallPointerWatcher {
  constructor({
    getBallWindow, getBallRect, isExpanded, onHover, onIgnoreChange, logger, pollMs = POLL_MS,
  }) {
    this.getBallWindow = getBallWindow;
    this.getBallRect = getBallRect;
    this.isExpanded = isExpanded || (() => false);
    this.onHover = onHover;
    this.onIgnoreChange = onIgnoreChange;
    this.logger = logger;
    this.pollMs = pollMs;
    this.timer = null;
    this.paused = false;
    this.hovered = false;
    this.ignored = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hovered = false;
  }

  /** 拖动球的过程中暂停：否则拖到一半被切成穿透态，后续鼠标事件就断了 */
  pause() { this.paused = true; }

  resume() {
    this.paused = false;
    this.ignored = null;
  }

  applyIgnore(ignore) {
    if (this.ignored === ignore) return;
    this.ignored = ignore;
    try {
      if (this.onIgnoreChange) this.onIgnoreChange(ignore);
    } catch (e) {
      if (this.logger) this.logger.warn('切换悬浮球穿透失败', { message: e && e.message });
    }
  }

  setHover(next) {
    if (this.hovered === next) return;
    this.hovered = next;
    try {
      if (this.onHover) this.onHover(next);
    } catch (e) {
      if (this.logger) this.logger.warn('悬浮球悬停回调失败', { message: e && e.message });
    }
  }

  tick() {
    if (this.paused) return;
    const win = this.getBallWindow && this.getBallWindow();
    if (!win || win.isDestroyed() || !win.isVisible()) {
      this.ignored = null;
      this.hovered = false;
      return;
    }
    let point;
    let b;
    try {
      point = screen.getCursorScreenPoint();
      b = win.getBounds();
    } catch {
      return;
    }
    const rx = point.x - b.x;
    const ry = point.y - b.y;
    const insideWindow = rx >= 0 && ry >= 0 && rx < b.width && ry < b.height;
    const ball = (this.getBallRect && this.getBallRect()) || { x: 0, y: 0, w: b.width, h: b.height };
    const inBall = rx >= ball.x && rx < ball.x + ball.w && ry >= ball.y && ry < ball.y + ball.h;
    const expanded = !!this.isExpanded();

    const active = inBall || (expanded && insideWindow);
    this.applyIgnore(!active);
    this.setHover(active);
  }
}

module.exports = { BallPointerWatcher, POLL_MS };
