'use strict';
/**
 * 全局热键（src/main/hotkeys.js）
 *
 * 需求：F-09（框选）、F-11（立即翻译）、F-16（展开/收起浮窗）、REV-001 G-02（冲突检测 + 自定义）。
 * 约束：不得硬编码 —— 加速键全部来自配置（config.hotkeys），用户可在设置里重新捕获。
 * 冲突：globalShortcut.register 返回 false 视为被占用，记入 conflicts 并上报，
 *      托盘/设置页据此提示「热键被占用，请前往设置修改」。
 */
const { globalShortcut } = require('electron');
const { normalizeAccelerator, ACTIONS, ACTION_LABELS } = require('../shared/accelerator');

class HotkeyManager {
  constructor({ logger, handlers = {} } = {}) {
    this.logger = logger || { info() {}, warn() {}, debug() {}, error() {} };
    this.handlers = handlers;
    this.registered = {}; // action -> accelerator
    this.conflicts = {}; // action -> accelerator（注册失败）
  }

  setHandler(action, fn) {
    this.handlers[action] = fn;
  }

  unregisterAll() {
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
    this.registered = {};
    this.conflicts = {};
  }

  /** 注册单个动作，返回 {ok, accelerator, reason} */
  registerOne(action, accelerator) {
    const accel = normalizeAccelerator(accelerator);
    if (!accel) return { ok: false, reason: 'empty', accelerator: '' };
    const fn = this.handlers[action];
    if (typeof fn !== 'function') return { ok: false, reason: 'no-handler', accelerator: accel };

    const dup = Object.entries(this.registered).find(([a, v]) => a !== action && v === accel);
    if (dup) {
      return { ok: false, reason: 'duplicate-in-app', conflictingWith: dup[0], accelerator: accel };
    }
    try {
      const ok = globalShortcut.register(accel, () => {
        try { fn(); } catch (e) { this.logger.error('热键回调异常', { action, code: e && e.code }); }
      });
      if (!ok) {
        this.conflicts[action] = accel;
        this.logger.warn('热键注册失败（可能被其它程序占用）', { action, accel });
        return { ok: false, reason: 'occupied', accelerator: accel };
      }
      this.registered[action] = accel;
      delete this.conflicts[action];
      this.logger.info('热键已注册', { action, accel });
      return { ok: true, accelerator: accel };
    } catch (e) {
      this.conflicts[action] = accel;
      return { ok: false, reason: 'error', message: e.message, accelerator: accel };
    }
  }

  /** 按配置注册全部热键，返回每个动作的结果 */
  applyAll(hotkeys = {}) {
    this.unregisterAll();
    const results = {};
    for (const action of ACTIONS) {
      const accel = hotkeys[action];
      if (!accel) {
        results[action] = { ok: false, reason: 'not-configured', accelerator: '' };
        continue;
      }
      // 清理上一个会话可能残留的注册，避免误判"被占用"
      try {
        const norm = normalizeAccelerator(accel);
        if (globalShortcut.isRegistered(norm)) globalShortcut.unregister(norm);
      } catch { /* ignore */ }
      results[action] = this.registerOne(action, accel);
    }
    return results;
  }

  /** 只探测候选热键是否可用（不改变已注册状态；用于设置页「按下新组合键」） */
  probe(accelerator) {
    const accel = normalizeAccelerator(accelerator);
    if (!accel) return { ok: false, reason: 'empty', accelerator: '' };
    const dup = Object.entries(this.registered).find(([, v]) => v === accel);
    if (dup) return { ok: false, reason: 'duplicate-in-app', conflictingWith: dup[0], accelerator: accel };
    if (globalShortcut.isRegistered(accel)) return { ok: false, reason: 'occupied', accelerator: accel };
    try {
      const ok = globalShortcut.register(accel, () => {});
      if (ok) globalShortcut.unregister(accel);
      return ok ? { ok: true, accelerator: accel } : { ok: false, reason: 'occupied', accelerator: accel };
    } catch (e) {
      return { ok: false, reason: 'error', message: e.message, accelerator: accel };
    }
  }

  status() {
    return {
      registered: { ...this.registered },
      conflicts: { ...this.conflicts },
      labels: ACTION_LABELS,
      actions: ACTIONS,
    };
  }
}

module.exports = {
  HotkeyManager, normalizeAccelerator, ACTIONS, ACTION_LABELS,
};
