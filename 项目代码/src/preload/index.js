'use strict';
/**
 * Preload（src/preload/index.js）
 *
 * 渲染进程与主进程之间的唯一桥梁（contextIsolation + sandbox 已开启）。
 * 说明：沙箱化的 preload 不能 require 本地文件，因此通道名在此**内联**声明；
 * 一致性由 项目测试/ipc-contract.test.js 校验（与 src/shared/ipc-channels.js 对比）。
 *
 * 安全：不做任何文件/网络/加解密操作，只转发 IPC；不暴露 ipcRenderer 原始对象。
 */
const { contextBridge, ipcRenderer } = require('electron');

const CH = {
  APP_STATUS: 'app:status',
  APP_QUIT: 'app:quit',
  APP_NOTICE: 'app:notice',
  APP_LOG_TAIL: 'app:log-tail',
  APP_TRAY_STATUS: 'app:tray-status',
  APP_TRAY_RETRY: 'app:tray-retry',
  CONFIG_GET: 'config:get',
  CONFIG_PATCH: 'config:patch',
  API_LIST: 'api:list',
  API_PRESETS: 'api:presets',
  API_ADD: 'api:add',
  API_UPDATE: 'api:update',
  API_REMOVE: 'api:remove',
  API_REORDER: 'api:reorder',
  API_TEST: 'api:test',
  REGION_GET: 'region:get',
  REGION_SET: 'region:set',
  OVERLAY_OPEN: 'overlay:open',
  OVERLAY_SUBMIT: 'overlay:submit',
  OVERLAY_CANCEL: 'overlay:cancel',
  TRANSLATE_RUN: 'translate:run',
  TRANSLATE_ONCE: 'translate:once',
  TRANSLATE_TEXT: 'translate:text',
  LOOP_START: 'loop:start',
  LOOP_STOP: 'loop:stop',
  LOOP_INTERVAL: 'loop:interval',
  HUD_SHOW: 'hud:show',
  HUD_HIDE: 'hud:hide',
  HUD_COLLAPSE: 'hud:collapse',
  HUD_EXPAND: 'hud:expand',
  BALL_PRIMARY: 'ball:primary',
  BALL_MENU: 'ball:menu',
  BALL_HOVER: 'ball:hover',
  BALL_ACTION: 'ball:action',
  BALL_STATE: 'ball:state',
  HUD_SET_IGNORE: 'hud:set-ignore',
  HUD_DRAG: 'hud:drag',
  WINDOW_DRAG: 'window:drag',
  HUD_STATE: 'hud:state',
  HUD_RESIZE: 'hud:resize',
  HUD_AUTOHEIGHT: 'hud:autoheight',
  SETTINGS_OPEN: 'settings:open',
  SETTINGS_CLOSE: 'settings:close',
  SETTINGS_TOGGLE: 'settings:toggle',
  THEME_PICK_IMAGE: 'theme:pick-image',
  THEME_CLEAR_IMAGE: 'theme:clear-image',
  THEME_GET_IMAGE: 'theme:get-image',
  HOTKEY_REGISTER: 'hotkey:register',
  HOTKEY_STATUS: 'hotkey:status',
  HOTKEY_CAPTURE_START: 'hotkey:capture-start',
  HOTKEY_CAPTURE_STOP: 'hotkey:capture-stop',
  MODEL_STATUS: 'model:status',
  MODEL_START: 'model:start',
  MODEL_STOP: 'model:stop',
  MODEL_PICK_FILE: 'model:pick-file',
  PERF_SAMPLE: 'perf:sample',
  EVENT: 'engine:event',
  HUD_RENDER: 'hud:render',
};

/** 统一调用：主进程返回 {ok,data} / {ok,code,message}，这里还原为 Promise/Error */
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res || typeof res !== 'object') throw Object.assign(new Error('IPC 无有效返回'), { code: 'IPC_INVALID' });
  if (!res.ok) {
    throw Object.assign(new Error(res.message || '操作失败'), { code: res.code || 'INTERNAL' });
  }
  return res.data;
}

function subscribe(channel, cb) {
  const listener = (_event, payload) => { cb(payload); };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // 应用
  status: () => call(CH.APP_STATUS),
  quit: () => call(CH.APP_QUIT),
  notice: (n) => call(CH.APP_NOTICE, n),
  logTail: () => call(CH.APP_LOG_TAIL),
  trayStatus: () => call(CH.APP_TRAY_STATUS),
  trayRetry: () => call(CH.APP_TRAY_RETRY),

  // 配置
  configGet: () => call(CH.CONFIG_GET),
  configPatch: (patch) => call(CH.CONFIG_PATCH, patch),

  // API 接口
  api: {
    list: () => call(CH.API_LIST),
    presets: () => call(CH.API_PRESETS),
    add: (input) => call(CH.API_ADD, input),
    update: (id, patch) => call(CH.API_UPDATE, { id, patch }),
    remove: (id) => call(CH.API_REMOVE, id),
    reorder: (ids) => call(CH.API_REORDER, ids),
    test: (id) => call(CH.API_TEST, id),
  },

  // 框选
  region: {
    get: () => call(CH.REGION_GET),
    set: (r) => call(CH.REGION_SET, r),
  },
  overlay: {
    open: () => call(CH.OVERLAY_OPEN),
    submit: (rect) => call(CH.OVERLAY_SUBMIT, rect),
    cancel: () => call(CH.OVERLAY_CANCEL),
  },

  // 翻译
  translate: {
    run: (opts) => call(CH.TRANSLATE_RUN, opts || {}),
    once: () => call(CH.TRANSLATE_ONCE),
    text: (payload) => call(CH.TRANSLATE_TEXT, payload),
  },

  // 定时
  loop: {
    start: (intervalMs) => call(CH.LOOP_START, intervalMs),
    stop: () => call(CH.LOOP_STOP),
    setInterval: (ms) => call(CH.LOOP_INTERVAL, ms),
  },

  // 悬浮球（托盘不可用时的常驻入口）
  ball: {
    primary: () => call(CH.BALL_PRIMARY),
    menu: () => call(CH.BALL_MENU),
    /** 悬停展开/收起快捷面板：返回 {expanded, side, bounds} */
    hover: (open) => call(CH.BALL_HOVER, !!open),
    /** 快捷面板动作：settings / input / hud / quit */
    action: (act) => call(CH.BALL_ACTION, String(act || '')),
    /** 主进程通知展开状态变化（用于切换面板在球的哪一侧） */
    onState: (cb) => subscribe(CH.BALL_STATE, cb),
  },

  // 浮窗
  hud: {
    show: (data) => call(CH.HUD_SHOW, data),
    hide: () => call(CH.HUD_HIDE),
    collapse: () => call(CH.HUD_COLLAPSE),
    expand: () => call(CH.HUD_EXPAND),
    setClickThrough: (ignore) => call(CH.HUD_SET_IGNORE, !!ignore),
    drag: (phase, x, y, opts) => call(CH.HUD_DRAG, {
      phase,
      x,
      y,
      // 自检专用假光标（生产环境主进程会忽略它）
      testCursor: (opts && opts.testCursor) || undefined,
    }),
    /**
     * 拖动调整大小：phase = start | move | end
     * opts.axis：'both'（默认，右下角拖）| 'x'（字幕模式只调宽度）
     * opts.edge：'right'（默认）| 'left'（拖左边缘，窗口左边跟着走）
     */
    resize: (phase, x, y, opts) => call(CH.HUD_RESIZE, {
      phase,
      x,
      y,
      axis: (opts && opts.axis) || 'both',
      edge: (opts && opts.edge) || 'right',
      testCursor: (opts && opts.testCursor) || undefined,
    }),
    /** 内容高度变化后请求自适应尺寸 */
    autoHeight: (height) => call(CH.HUD_AUTOHEIGHT, height),
    state: () => call(CH.HUD_STATE),
    onRender: (cb) => subscribe(CH.HUD_RENDER, cb),
  },

  // 窗口拖动（浮窗 / 悬浮球共用）
  window: {
    drag: (phase, x, y) => call(CH.WINDOW_DRAG, { phase, x, y }),
  },

  // 设置 / 热键
  settings: {
    open: (tab) => call(CH.SETTINGS_OPEN, tab),
    close: () => call(CH.SETTINGS_CLOSE),
    /** 打开/关闭切换：返回 { open: boolean } */
    toggle: (tab) => call(CH.SETTINGS_TOGGLE, tab),
  },

  // 外观（需求 1：主题色 / 背景图）
  theme: {
    pickImage: (target) => call(CH.THEME_PICK_IMAGE, { target: target || 'hud' }),
    clearImage: (target) => call(CH.THEME_CLEAR_IMAGE, { target: target || 'hud' }),
    getImage: (target) => call(CH.THEME_GET_IMAGE, { target: target || 'hud' }),
  },
  hotkey: {
    status: () => call(CH.HOTKEY_STATUS),
    register: (action, accelerator) => call(CH.HOTKEY_REGISTER, { action, accelerator }),
    captureStart: () => call(CH.HOTKEY_CAPTURE_START),
    captureStop: () => call(CH.HOTKEY_CAPTURE_STOP),
  },

  // 离线模型
  model: {
    status: () => call(CH.MODEL_STATUS),
    start: () => call(CH.MODEL_START),
    stop: () => call(CH.MODEL_STOP),
    pick: () => call(CH.MODEL_PICK_FILE),
  },

  // 性能 / 系统
  perfSample: () => call(CH.PERF_SAMPLE),
  openLogs: () => call('shell:open-logs'),
  displays: () => call('sys:displays'),
  versions: () => call('sys:version'),

  // 事件
  onEvent: (cb) => subscribe(CH.EVENT, cb),
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('apiChannels', CH);
