'use strict';
/**
 * 系统托盘（src/main/tray.js）
 *
 * F-02：托盘常驻，关闭窗口不退出；菜单项映射到主进程动作。
 * M3-T4：托盘内切换 手动/定时（1s/2s/5s），状态持久化到配置。
 * REV-001 G-02：托盘必须提供「热键设置」入口，不得只依赖硬编码快捷键；
 *               若注册冲突，托盘顶部显示告警项。
 */
const path = require('path');
const fs = require('fs');
const { Tray, Menu, nativeImage, app } = require('electron');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const INTERVALS = [1000, 2000, 5000];
/** 托盘挂载重试时间点（ms）：Windows 任务栏繁忙/Explorer 重启时首挂常失败 */
const REASSERT_DELAYS = [1500, 6000, 20000];

function trayIcon() {
  // Windows 上优先用 .ico：Shell 会按 DPI 自己挑 16/24/32 档，
  // 比 PNG 缩放更不容易被判定为"无效图标"（用户反馈托盘里看不到图标）。
  const candidates = process.platform === 'win32'
    ? ['app.ico', 'tray.ico', 'tray.png', 'app.png']
    : ['tray.png', 'app.png'];
  for (const name of candidates) {
    const file = path.join(ASSETS, name);
    if (fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) {
        // ico 自带多档尺寸，不要再 resize（resize 会压成单档）
        return name.endsWith('.ico') ? img : img.resize({ width: 32, height: 32 });
      }
    }
  }
  // 兜底：1×1 透明图，保证托盘仍可创建（不阻塞启动）
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  );
}

class TrayController {
  constructor({ engine, wm, logger, actions }) {
    this.engine = engine;
    this.wm = wm;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.actions = actions;
    this.tray = null;
    this._reassertTimer = null;
    this._boundsTimer = null;
    this._reassertedCount = 0;
  }

  create() {
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


  /**
   * 托盘当前状态，供设置页「关于」显示。
   *
   * accepted 只是**尽力判断**：Windows 上 getBounds() 可能返回空矩形但图标确实在
   * （本机实测原生 WinForms NotifyIcon 也注册不上），所以 accepted=false 不代表一定失败，
   * 只用来提示用户「如果没看到图标，可以点下面的按钮重挂一次」。
   * @returns {{created:boolean, accepted:boolean, bounds:object|null, attempts:number}}
   */
  status() {
    if (!this.tray) return { created: false, accepted: false, bounds: null, attempts: this._reassertedCount };
    let bounds = null;
    try { bounds = this.tray.getBounds(); } catch { bounds = null; }
    const accepted = !!(bounds && bounds.width > 0 && bounds.height > 0);
    return { created: true, accepted, bounds, attempts: this._reassertedCount };
  }

  /** 用户手动触发的重挂（设置页按钮）：忽略自动重试的次数上限 */
  retryNow() {
    this._reassertedCount = 0;
    this.reassert();
    return this.status();
  }

  /**
   * 记录图标位置，用于诊断「托盘图标到底有没有出现」。
   *
   * 结论（本机实测）：Windows 上 getBounds() 即使图标已注册也可能返回空矩形
   * （用最小化 Electron 探针 A/B 与原生 WinForms NotifyIcon 对比，通知区域按钮数都不变），
   * 所以**不能**拿它判断是否失败，只写 debug 日志供排查。
   */
  _probeBounds(delayMs = 1500) {
    if (this._boundsTimer) clearTimeout(this._boundsTimer);
    this._boundsTimer = setTimeout(() => {
      this._boundsTimer = null;
      if (!this.tray) return;
      try {
        const b = this.tray.getBounds();
        if (typeof this.logger.debug === 'function') this.logger.debug('托盘图标 bounds', { bounds: b });
      } catch { /* 探测失败不影响主流程 */ }
    }, delayMs);
    if (this._boundsTimer.unref) this._boundsTimer.unref();
  }

  /**
   * 重新挂载托盘图标。
   *
   * 为什么需要：Windows 的 Shell_NotifyIcon(NIM_ADD) 会等待任务栏响应，超时即失败
   * （Chromium 打印 "Unable to create status tray icon"），
   * 常见于开机/explorer 重启/任务栏繁忙时——启动瞬间创建往往首挂失败。
   * 这里在启动后延迟重建一次，让图标可靠出现在通知区域。
   */
  reassert() {
    if (this._reassertTimer) { clearTimeout(this._reassertTimer); this._reassertTimer = null; }
    if (!this.tray) return;
    try {
      const old = this.tray;
      this.tray = null;
      try { old.destroy(); } catch { /* 旧实例可能已被系统回收 */ }
      this._reassertedCount += 1;
      this.create();
      this.logger.info('托盘图标已重新挂载', { attempt: this._reassertedCount });
    } catch (e) {
      this.logger.warn('托盘图标重新挂载失败', { code: e && e.code, message: e && e.message });
    }
  }

  /**
   * 安排一次「重新挂载」。
   * @param {boolean} force 忽略次数上限（用于 getBounds 探测发现图标确实没显示的情况）
   */
  _scheduleReassert(force = false) {
    if (this._reassertTimer) return;
    if (!force && this._reassertedCount >= REASSERT_DELAYS.length) return;
    const delay = REASSERT_DELAYS[Math.min(this._reassertedCount, REASSERT_DELAYS.length - 1)];
    this._reassertTimer = setTimeout(() => {
      this._reassertTimer = null;
      this.reassert();
    }, delay);
    if (this._reassertTimer.unref) this._reassertTimer.unref();
  }

  buildMenu() {
    // 第十二轮：按用户要求只保留三项——设置 / 输入翻译 / 退出。
    // 其余高频操作（暂停、轮询间隔、框选）留在浮窗标题栏与设置页，避免菜单过长点错。
    const template = [
      { label: '设置', click: () => this.actions.openSettings('general') },
      { label: '输入翻译', click: () => this.actions.openSettings('input') },
      { type: 'separator' },
      { label: '退出', click: () => this.actions.quit() },
    ];
    return Menu.buildFromTemplate(template);
  }

  /** 右键菜单的可见项（供自检断言「只有 设置 / 输入翻译 / 退出」） */
  menuLabels() {
    try {
      return this.buildMenu().items.map((i) => String(i.label || '')).filter(Boolean);
    } catch {
      return [];
    }
  }

  refresh() {
    if (!this.tray) return;
    try {
      this.tray.setContextMenu(this.buildMenu());
    } catch (e) {
      this.logger.error('托盘菜单刷新失败', { code: e && e.code, message: e.message });
    }
  }

  destroy() {
    if (this._reassertTimer) { clearTimeout(this._reassertTimer); this._reassertTimer = null; }
    if (this._boundsTimer) { clearTimeout(this._boundsTimer); this._boundsTimer = null; }
    if (this.tray) { this.tray.destroy(); this.tray = null; }
  }
}

module.exports = { TrayController, INTERVALS };
