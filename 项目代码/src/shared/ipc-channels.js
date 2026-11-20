'use strict';
/**
 * IPC 通道契约（src/shared/ipc-channels.js）
 *
 * 这是宿主壳（Electron 主进程）与渲染进程之间唯一的通信契约文件。
 * 新增通道必须同时在此登记并在 main/ipc.js 实现、preload/index.js 暴露。
 * 约束：渲染进程不直接访问 Node / 文件系统，全部经 IPC 委托主进程（环境配置清单第 3 节）。
 */

const CHANNELS = {
  // 应用
  APP_STATUS: 'app:status',
  APP_QUIT: 'app:quit',
  APP_NOTICE: 'app:notice',
  APP_LOG_TAIL: 'app:log-tail',
  APP_TRAY_STATUS: 'app:tray-status',
  APP_TRAY_RETRY: 'app:tray-retry',

  // 配置
  CONFIG_GET: 'config:get',
  CONFIG_PATCH: 'config:patch',

  // API 接口管理（M4）
  API_LIST: 'api:list',
  API_PRESETS: 'api:presets',
  API_ADD: 'api:add',
  API_UPDATE: 'api:update',
  API_REMOVE: 'api:remove',
  API_REORDER: 'api:reorder',
  API_TEST: 'api:test',

  // 框选区域
  REGION_GET: 'region:get',
  REGION_SET: 'region:set',
  OVERLAY_OPEN: 'overlay:open',
  OVERLAY_SUBMIT: 'overlay:submit',
  OVERLAY_CANCEL: 'overlay:cancel',

  // 翻译
  TRANSLATE_RUN: 'translate:run',
  TRANSLATE_ONCE: 'translate:once',
  TRANSLATE_TEXT: 'translate:text',

  // 定时循环（M3）
  LOOP_START: 'loop:start',
  LOOP_STOP: 'loop:stop',
  LOOP_INTERVAL: 'loop:interval',

  // 浮窗（M2/M3）
  HUD_SHOW: 'hud:show',
  HUD_HIDE: 'hud:hide',
  HUD_COLLAPSE: 'hud:collapse',
  HUD_EXPAND: 'hud:expand',
  // 悬浮球：不依赖系统通知区域的常驻入口（托盘被系统拒绝时用它兜底）
  BALL_PRIMARY: 'ball:primary',
  BALL_MENU: 'ball:menu',
  /** 悬停展开/收起快捷面板（第十九轮需求 4） */
  BALL_HOVER: 'ball:hover',
  /** 快捷面板里点选的动作：settings / input / hud / quit */
  BALL_ACTION: 'ball:action',
  /** 主进程 → 悬浮球：{expanded, side} */
  BALL_STATE: 'ball:state',
  HUD_SET_IGNORE: 'hud:set-ignore',
  HUD_DRAG: 'hud:drag',
  WINDOW_DRAG: 'window:drag',
  HUD_STATE: 'hud:state',
  /** 拖动边缘调整浮窗大小（需求 3） */
  HUD_RESIZE: 'hud:resize',
  /** 译文内容变化后请求自适应高度 */
  HUD_AUTOHEIGHT: 'hud:autoheight',

  // 设置 / 热键（M4 / REV-001 G-02）
  SETTINGS_OPEN: 'settings:open',
  SETTINGS_CLOSE: 'settings:close',
  /** 再点一次 ⚙ 关闭设置页（需求 2） */
  SETTINGS_TOGGLE: 'settings:toggle',

  // 外观自定义（需求 1：主题色 / 背景图）
  THEME_PICK_IMAGE: 'theme:pick-image',
  THEME_CLEAR_IMAGE: 'theme:clear-image',
  THEME_GET_IMAGE: 'theme:get-image',
  HOTKEY_REGISTER: 'hotkey:register',
  HOTKEY_STATUS: 'hotkey:status',
  HOTKEY_CAPTURE_START: 'hotkey:capture-start',
  HOTKEY_CAPTURE_STOP: 'hotkey:capture-stop',

  // 离线模型（M5-T4）
  MODEL_STATUS: 'model:status',
  MODEL_START: 'model:start',
  MODEL_STOP: 'model:stop',
  MODEL_PICK_FILE: 'model:pick-file',

  // 性能（N-02-R1）
  PERF_SAMPLE: 'perf:sample',

  // 主进程 → 渲染进程（事件推送）
  EVENT: 'engine:event',
  HUD_RENDER: 'hud:render',
};

/** 主进程推送给所有渲染进程的事件名 */
const EVENTS = {
  TRANSLATION: 'translation',
  TRANSLATION_FAILED: 'translation-failed',
  LOOP_STARTED: 'loop-started',
  LOOP_STOPPED: 'loop-stopped',
  CONFIG_CHANGED: 'config-changed',
  SELECTION_CHANGED: 'selection-changed',
  NOTICE: 'notice',
  HOTKEY_CONFLICT: 'hotkey-conflict',
  STATUS: 'status',
  /** 设置窗口显示/隐藏状态变化（供浮窗 ⚙ 按钮高亮） */
  SETTINGS_VISIBILITY: 'settings-visibility',
};

module.exports = { CHANNELS, EVENTS };
