/**
 * 热键加速键工具（src/shared/accelerator.js）
 *
 * UMD 形式：主进程（CommonJS require）与渲染进程（<script> 标签）共用同一份实现，
 * 避免「设置页捕获到的组合键」与「主进程注册的组合键」格式不一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Accelerator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ACTION_LABELS = {
    select: '框选翻译区域',
    refresh: '立即翻译上次区域',
    pause: '暂停/继续定时翻译',
    toggleHud: '显示/隐藏浮窗',
    collapse: '收起为悬浮球',
  };
  var ACTIONS = ['select', 'refresh', 'pause', 'toggleHud', 'collapse'];
  var MOD_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'AltGr', 'Shift', 'Super', 'Meta'];

  var KEY_ALIASES = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    '+': 'Plus',
  };

  /** 规范化：修饰键顺序统一，主键首字母大写 */
  function normalizeAccelerator(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    var parts = raw.split('+').map(function (p) { return p.trim(); }).filter(Boolean);
    var mods = [];
    var key = '';
    for (var i = 0; i < parts.length; i += 1) {
      var p = parts[i];
      var lower = p.toLowerCase();
      if (lower === 'ctrl' || lower === 'control' || lower === 'cmdorctrl' || lower === 'commandorcontrol') mods.push('CommandOrControl');
      else if (lower === 'cmd' || lower === 'command' || lower === 'super' || lower === 'meta') mods.push('Command');
      else if (lower === 'alt' || lower === 'option') mods.push('Alt');
      else if (lower === 'shift') mods.push('Shift');
      else key = p;
    }
    if (!key) return '';
    var normKey;
    if (KEY_ALIASES[key]) normKey = KEY_ALIASES[key];
    else if (key.length === 1) normKey = key.toUpperCase();
    else normKey = key.charAt(0).toUpperCase() + key.slice(1);
    var ordered = [];
    for (var m = 0; m < MOD_ORDER.length; m += 1) {
      if (mods.indexOf(MOD_ORDER[m]) >= 0 && ordered.indexOf(MOD_ORDER[m]) < 0) ordered.push(MOD_ORDER[m]);
    }
    return ordered.concat([normKey]).join('+');
  }

  /** 由键盘事件生成加速键；要求至少一个修饰键（避免注册裸字母为全局热键） */
  function acceleratorFromEvent(ev) {
    var mods = [];
    if (ev.ctrlKey || ev.metaKey) mods.push('CommandOrControl');
    if (ev.altKey) mods.push('Alt');
    if (ev.shiftKey) mods.push('Shift');
    var rawKey = ev.key || '';
    if (!mods.length) return { ok: false, reason: 'no-modifier' };
    if (['Control', 'Alt', 'Shift', 'Meta', 'Dead', 'Unidentified'].indexOf(rawKey) >= 0) {
      return { ok: false, reason: 'modifier-only' };
    }
    if (!rawKey) return { ok: false, reason: 'no-key' };
    var key = KEY_ALIASES[rawKey] || rawKey;
    if (!KEY_ALIASES[rawKey] && key.length === 1) key = key.toUpperCase();
    return { ok: true, accelerator: normalizeAccelerator(mods.concat([key]).join('+')) };
  }

  return {
    ACTION_LABELS: ACTION_LABELS,
    ACTIONS: ACTIONS,
    MOD_ORDER: MOD_ORDER,
    KEY_ALIASES: KEY_ALIASES,
    normalizeAccelerator: normalizeAccelerator,
    acceleratorFromEvent: acceleratorFromEvent,
  };
}));
