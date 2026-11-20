'use strict';
/**
 * 核心引擎（core/index.js）
 *
 * 把配置、截图、OCR、翻译链、定时循环、宿主桥、性能采样装配成一个可被
 * Electron 宿主壳 / CLI / 测试直接驱动的外观（Facade）。本模块不依赖 electron，
 * 因此可在纯 Node 环境下做单元与集成测试。
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const paths = require('./paths');
const { createLogger, textMeta } = require('./log');
const { err, CODES, normalize } = require('./errors');
const { ConfigStore } = require('./config/store');
const { CaptureService } = require('./capture');
const { OcrService } = require('./ocr');
const { LlamaServerManager } = require('./llama/server');
const { TranslationLoop } = require('./pipeline/loop');
const { executeRound, detectShortcut } = require('./pipeline/round');
const { translate, testConnection } = require('./translate/chain');
const { normalizeSourceText } = require('./translate/prompt');
const { HostBridge } = require('./host/bridge');
const perf = require('./metrics/perf');

class TranslatorEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.logger = createLogger({ level: opts.logLevel || 'info', scope: 'core', console: opts.console !== false });
    try {
      paths.ensure.home();
      paths.ensure.logs();
      this.logger.attachFile(path.join(paths.logsDir(), 'app.log'));
    } catch (e) {
      this.logger.warn('日志文件不可写，降级为控制台日志', { code: e.code });
    }

    this.store = new ConfigStore({ file: opts.configFile || paths.configFile(), logger: this.logger.child('config') });
    this.capture = new CaptureService({
      logger: this.logger.child('capture'),
      backend: opts.captureBackend || 'auto',
    });
    this.ocr = new OcrService({ logger: this.logger.child('ocr'), engine: opts.ocrEngine || 'auto' });
    this.llama = new LlamaServerManager({ logger: this.logger.child('llama'), offline: this.store.raw().offline });
    this.state = { lastSource: '', lastSourceHash: '', lastTranslation: null, lastTranslateAt: 0 };
    this.bridge = null;
    this.hudSink = null;
    this.notices = [];
    this.startedAt = null;

    this.loop = new TranslationLoop({
      logger: this.logger.child('loop'),
      intervalMs: this.store.raw().capture.intervalMs,
      execute: (o) => this.runRound(o),
    });
    this.loop.on('result', (r) => this.emit('translation', r));
    this.loop.on('failed', (r) => this.emit('translation-failed', r));
    this.loop.on('started', (s) => this.emit('loop-started', s));
    this.loop.on('stopped', (s) => this.emit('loop-stopped', s));
    this.store.on('change', (view) => this.emit('config-changed', view));
  }

  async init() {
    this.store.load();
    // 构造函数执行时配置还没加载（拿到的是默认值），load() 之后必须同步一次，
    // 否则离线模型的端口/线程/上下文全部落回默认（曾导致 -c 4096 覆盖用户的 2048）
    this.llama.updateConfig(this.store.raw().offline);
    this.loop.setInterval(this.store.raw().capture.intervalMs);
    // 识别引擎同理：构造函数里只有默认 auto，加载配置后要按用户选择切一次
    this.ocr.setPreferred(this.store.raw().ocr && this.store.raw().ocr.engine);
    // 识别语言（第二十一轮需求 5）：auto / ch / japan / korean
    this.ocr.setLang(this.store.raw().ocr && this.store.raw().ocr.lang);
    this.store.on('change', () => {
      const raw = this.store.raw();
      this.llama.updateConfig(raw.offline);
      if (raw.ocr) {
        this.ocr.setPreferred(raw.ocr.engine);
        this.ocr.setLang(raw.ocr.lang);
      }
    });
    this.startedAt = new Date().toISOString();
    this.logger.info('核心引擎初始化完成', {
      config: path.basename(this.store.file),
      dataDir: paths.home(),
      captureBackend: this.capture.backendName,
    });
    return this.status();
  }

  // ---------------- 配置 ----------------

  getConfig() {
    return this.store.publicView();
  }

  patchConfig(patch) {
    return this.store.patch(patch);
  }

  getPresets() {
    return this.store.getPresets();
  }

  listApis() {
    return this.store.listApis();
  }

  addApi(input) {
    return this.store.addApi(input);
  }

  updateApi(id, patch) {
    return this.store.updateApi(id, patch);
  }

  removeApi(id) {
    return this.store.removeApi(id);
  }

  reorderApis(ids) {
    return this.store.reorderApis(ids);
  }

  async testApi(id) {
    const apis = this.store.raw().apis || [];
    const item = apis.find((a) => a.id === id);
    if (!item) throw err(CODES.CONFIG_INVALID, 'API 不存在');
    let apiKey = '';
    try { apiKey = this.store.getApiSecret(id); } catch (e) {
      const r = { ok: false, code: CODES.SECRET_DECRYPT_FAILED, message: '密钥解密失败，请重新填写' };
      this.store.markApiTest(id, r);
      return r;
    }
    if (!apiKey) {
      const r = { ok: false, code: 'NO_KEY', message: '尚未填写 API Key' };
      this.store.markApiTest(id, r);
      return r;
    }
    const r = await testConnection({
      baseUrl: item.baseUrl, apiKey, model: item.model, systemPrompt: item.systemPrompt,
    }, { timeoutMs: 8000 });
    this.logger.info('API 连通性测试', { apiId: id, ok: r.ok, ms: r.latencyMs });
    this.store.markApiTest(id, r);
    return r;
  }

  // ---------------- 框选区域 ----------------

  getSelectionRegion() {
    return this.store.raw().capture.lastSelection;
  }

  /** M2-T1 / M2-T4：保存框选区域并持久化 */
  setSelectionRegion(region) {
    const r = {
      x: Math.round(region.x), y: Math.round(region.y),
      width: Math.round(region.width), height: Math.round(region.height),
      at: new Date().toISOString(),
    };
    this.store.patch({ capture: { lastSelection: r } });
    this.logger.info('框选区域已保存', { w: r.width, h: r.height });
    this.emit('selection-changed', r);
    return r;
  }

  // ---------------- 翻译 ----------------

  /**
   * 确保离线模型可用：没有在跑就按配置拉起并等就绪。
   * 只返回布尔值，失败不抛（调用方决定是降级还是报错）。
   */
  async ensureOfflineReady(timeoutMs = 45000) {
    if (!this.llama.resolveModel()) return false;
    const st = this.llama.status();
    if (st.running && st.ready) {
      // 第二十二轮：这里要顺带刷新「最近使用时间」，否则空闲卸载会把正在用的模型收走
      this.llama.touch();
      return true;
    }
    // 注意：offline.autostart 只表示「开机是否预加载」，不代表「用到时也不拉起」。
    // 第二十二轮把默认值改成 false 之后，这里必须照常按需启动，否则离线优先直接失效。
    try {
      // 已经在跑但还在加载模型（首次 5~20 秒）时，等它就绪而不是直接放弃
      if (!st.running) await this.llama.start();
      const ok = await this.llama.waitReady(timeoutMs);
      this.logger.info('离线模型就绪等待结束', { ok, wasRunning: !!st.running });
      return ok;
    } catch (e) {
      this.logger.warn('离线模型拉起失败', { code: e && e.code });
      return false;
    }
  }

  /** 执行一轮截图 → OCR → 翻译 */
  async runRound(opts = {}) {
    return executeRound(
      {
        store: this.store,
        capture: this.capture,
        ocr: this.ocr,
        llama: this.llama,
        logger: this.logger.child('round'),
        translateFn: this.opts.translateFn,
        ensureOfflineReady: () => this.ensureOfflineReady(),
      },
      this.state,
      opts,
    );
  }

  /** 直接翻译一段文本（插件 translate_text / 设置面板自测） */
  async translateText({ text, targetLang, sourceLang = 'auto' }) {
    const config = this.store.raw();
    const target = targetLang || config.general.targetLang;

    // 原文已经是目标语言时不调用模型（与 pipeline/round.js 保持同一套判定）：
    // zh→zh 会被小模型翻成英文，zh→繁体只需字符转换。
    const shortcut = detectShortcut(text, target);
    if (shortcut) {
      return {
        text: shortcut.text, engine: shortcut.engine, apiId: null, latencyMs: 0, attempts: [], shortcut: true,
      };
    }

    const candidates = [];
    for (const api of this.store.getEnabledApisOrdered()) {
      try { candidates.push({ ...api, apiKey: this.store.getApiSecret(api.id) }); } catch { /* 跳过解密失败项 */ }
    }
    // 离线优先时先把模型拉起来；没配 API 时同样需要它
    const preferOffline = config.general.priority === 'offline';
    if (!candidates.length || preferOffline) await this.ensureOfflineReady();
    const offlineAvailable = await this.offlineAvailable();
    const r = await translate({
      text,
      targetLang: target,
      sourceLang: sourceLang || config.general.sourceLang,
      apis: candidates,
      network: config.network,
      offline: config.offline,
      offlineAvailable,
      priority: preferOffline ? 'offline' : 'online',
      onAttempt: (info) => this.logger.debug('翻译通道尝试', info),
    });
    return r;
  }

  async offlineAvailable() {
    const st = this.llama.status();
    if (!st.running) return false;
    const h = await this.llama.health(1200);
    return !!h.ok;
  }

  async captureRegionForPlugin(region) {
    const r = await this.capture.captureRegion(region);
    return r;
  }

  /**
   * 区域 OCR（供 DSH 插件一次性取回文本，M1-T3）
   *
   * 插件不允许直接截屏或调用系统 OCR，必须由宿主壳完成：截图 → OCR → 文本清洗。
   * 返回值只含识别文本与耗时，不含图片数据，避免把屏幕内容外带。
   */
  async ocrRegionForPlugin(region) {
    const shot = await this.capture.captureRegion(region);
    const t0 = Date.now();
    const r = await this.ocr.recognize({ buffer: shot.buffer });
    const text = normalizeSourceText(r.text);
    this.logger.info('插件区域 OCR 完成', {
      engine: r.engine, chars: text.length, ocrMs: Date.now() - t0,
    });
    return { text, engine: r.engine, width: shot.width, height: shot.height, ms: Date.now() - t0 };
  }

  // ---------------- 浮窗 ----------------

  onHudShow(fn) {
    this.hudSink = fn;
  }

  async showHud({ text, engine, source }) {
    this.logger.debug('请求显示译文', { chars: String(text || '').length, engine });
    if (this.hudSink) {
      try { return await this.hudSink({ text, engine, source }); } catch (e) {
        this.logger.warn('浮窗显示失败', { code: e && e.code });
        return { shown: false };
      }
    }
    return { shown: false, reason: 'no-hud' };
  }

  // ---------------- 定时循环 ----------------

  startLoop(intervalMs) {
    const iv = this.loop.start(intervalMs ?? this.store.raw().capture.intervalMs);
    this.store.patch({ capture: { mode: 'interval', intervalMs: this.loop.intervalMs } });
    return iv;
  }

  stopLoop(reason = 'manual') {
    this.store.patch({ capture: { mode: 'manual' } });
    return this.loop.stop(reason);
  }

  setIntervalMs(ms) {
    const iv = this.loop.setInterval(ms);
    this.store.patch({ capture: { intervalMs: iv } });
    return iv;
  }

  async translateOnce(trigger = 'manual') {
    return this.loop.runOnce(trigger);
  }

  // ---------------- 宿主桥 ----------------

  async startBridge(port = 0) {
    if (this.bridge) return { port: this.bridge.port };
    this.bridge = new HostBridge({
      logger: this.logger.child('bridge'),
      port: port || this.store.raw().advanced.bridgePort || 0,
      handlers: {
        captureRegion: (r) => this.captureRegionForPlugin(r),
        ocrRegion: (r) => this.ocrRegionForPlugin(r),
        translateText: (a) => this.translateText(a),
        setSelectionRegion: (r) => this.setSelectionRegion(r),
        showHud: (a) => this.showHud(a),
        status: () => this.status(),
      },
    });
    const info = await this.bridge.start();
    if (this.opts.writeBridgeFile !== false) {
      this.bridge.writeBridgeFile(paths.bridgeFile());
    }
    this.emit('bridge-started', { port: info.port });
    return info;
  }

  async stopBridge() {
    if (!this.bridge) return { stopped: false };
    const b = this.bridge;
    this.bridge = null;
    b.removeBridgeFile(paths.bridgeFile());
    return b.stop();
  }

  // ---------------- 状态 ----------------

  status() {
    return {
      app: 'desktop-translator',
      version: require('../../package.json').version,
      startedAt: this.startedAt,
      config: {
        targetLang: this.store.raw().general.targetLang,
        sourceLang: this.store.raw().general.sourceLang,
        mode: this.store.raw().capture.mode,
        intervalMs: this.loop.intervalMs,
        apis: this.store.listApis().length,
        apisEnabled: this.store.listApis().filter((a) => a.enabled).length,
      },
      region: this.getSelectionRegion(),
      ocr: { engine: this.ocr.preferred, picked: this.ocr._picked ? this.ocr._picked.name : null },
      capture: { backend: this.capture._impl ? this.capture._impl.name : null },
      loop: this.loop.getStatus(),
      llama: this.llama.status(),
      bridge: this.bridge ? { port: this.bridge.port } : null,
      memory: perf.currentProcessUsage(),
      notices: this.notices.slice(0, 20),
    };
  }

  addNotice(notice) {
    this.notices.unshift({ at: new Date().toISOString(), ...notice });
    if (this.notices.length > 20) this.notices.pop();
    this.emit('notice', notice);
  }

  async memorySample() {
    const pids = [process.pid];
    const st = this.llama.status();
    if (st.running && st.pid) pids.push(st.pid);
    return perf.samplePids(pids);
  }

  async shutdown() {
    this.loop.stop('shutdown');
    await this.stopBridge();
    await this.llama.stop();
    this.logger.info('核心引擎已关闭');
    return { ok: true };
  }
}

module.exports = {
  TranslatorEngine,
  paths,
  createLogger,
  textMeta,
  CODES,
  err,
  normalize,
  perf,
  fsExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
};
