'use strict';
/**
 * 定时翻译引擎（core/pipeline/loop.js）
 *
 * 依据 F-11 / M3-T1 / D3.1：
 *  - start(intervalMs) / stop()
 *  - 防重入：上一轮未结束时本轮直接跳过（顺延），不排队堆积
 *  - 使用 setTimeout 链而非 setInterval，避免单轮耗时超过间隔时产生雪崩
 *  - stop() 会中止进行中的一轮（AbortSignal，PLG-04 同类约束）
 */
const { EventEmitter } = require('events');
const { CODES } = require('../errors');

const MIN_INTERVAL = 200;
const MAX_INTERVAL = 600000;

class TranslationLoop extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.execute = opts.execute; // (opts) => Promise<roundResult>
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.intervalMs = clampInterval(opts.intervalMs || 2000);
    this.running = false;
    this.busy = false;
    this.timer = null;
    this.controller = null;
    this.stats = {
      ticks: 0, ok: 0, failed: 0, skipped: 0, lastMs: 0, lastAt: null, consecutiveFailures: 0,
    };
    this._stopped = false;
  }

  isRunning() {
    return this.running;
  }

  setInterval(intervalMs) {
    const next = clampInterval(intervalMs);
    const wasRunning = this.running;
    this.intervalMs = next;
    if (wasRunning) {
      this.stop('interval-change');
      this.start(next, 'interval-change');
    }
    return next;
  }

  start(intervalMs, reason = 'start') {
    if (typeof intervalMs === 'number') this.intervalMs = clampInterval(intervalMs);
    if (this.running) {
      this.logger.debug('定时引擎已在运行，忽略重复启动', { intervalMs: this.intervalMs });
      return { running: true, intervalMs: this.intervalMs };
    }
    this.running = true;
    this._stopped = false;
    this.logger.info('定时翻译启动', { intervalMs: this.intervalMs, reason });
    this.emit('started', { intervalMs: this.intervalMs, reason });
    this._schedule(0);
    return { running: true, intervalMs: this.intervalMs };
  }

  stop(reason = 'stop') {
    this._stopped = true;
    const wasRunning = this.running;
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.controller) {
      try { this.controller.abort(); } catch { /* noop */ }
      this.controller = null;
    }
    if (wasRunning) {
      this.logger.info('定时翻译停止', { reason });
      this.emit('stopped', { reason });
    }
    return { running: false };
  }

  _schedule(delayMs) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this._tick();
    }, Math.max(0, delayMs));
    if (this.timer.unref) this.timer.unref();
  }

  async _tick() {
    if (!this.running || this._stopped) return;
    if (this.busy) {
      this.stats.skipped += 1;
      this.logger.debug('上一轮仍在进行，本轮顺延');
      this._schedule(this.intervalMs);
      return;
    }
    const started = Date.now();
    this.busy = true;
    this.stats.ticks += 1;
    this.controller = new AbortController();
    try {
      const res = await this.execute({ trigger: 'interval', signal: this.controller.signal });
      this._handleResult(res, started);
    } catch (e) {
      this.stats.failed += 1;
      this.stats.consecutiveFailures += 1;
      this.logger.warn('定时轮询异常', { code: e && e.code || 'UNKNOWN' });
      const payload = { code: e && e.code || CODES.TRANSLATE_ALL_FAILED, message: e && e.message };
      // 注意：Node 的 'error' 事件在没有监听者时会直接抛出并杀死进程，
      // 轮询是常驻后台任务，必须保证「无人监听也不崩」，因此先判断监听者。
      if (this.listenerCount('error') > 0) this.emit('error', payload);
      this.emit('failed', payload);
    } finally {
      this.busy = false;
      this.controller = null;
      const elapsed = Date.now() - started;
      if (this.running && !this._stopped) {
        // 顺延：本轮耗时超过间隔则立即开始下一轮，否则等到下一个整间隔
        this._schedule(Math.max(0, this.intervalMs - elapsed));
      }
    }
  }

  _handleResult(res, started) {
    const ms = Date.now() - started;
    this.stats.lastMs = ms;
    this.stats.lastAt = new Date().toISOString();
    if (!res || res.code === CODES.ABORTED) return;
    if (res.ok) {
      this.stats.ok += 1;
      this.stats.consecutiveFailures = 0;
      this.emit('result', { ...res, ms });
    } else {
      this.stats.failed += 1;
      this.stats.consecutiveFailures += 1;
      this.emit('failed', { ...res, ms });
    }
  }

  /** 手动触发一次（F-11 手动模式 / 托盘「立即翻译」） */
  async runOnce(trigger = 'manual') {
    if (this.busy) {
      const e = new Error('上一轮翻译尚未完成');
      e.code = CODES.LOOP_BUSY;
      throw e;
    }
    this.busy = true;
    this.controller = new AbortController();
    const started = Date.now();
    try {
      const res = await this.execute({ trigger, signal: this.controller.signal });
      this._handleResult(res, started);
      return res;
    } finally {
      this.busy = false;
      this.controller = null;
    }
  }

  getStatus() {
    return {
      running: this.running,
      busy: this.busy,
      intervalMs: this.intervalMs,
      stats: { ...this.stats },
    };
  }
}

function clampInterval(ms) {
  const n = Number(ms) || 2000;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n));
}

module.exports = { TranslationLoop, clampInterval, MIN_INTERVAL, MAX_INTERVAL };
