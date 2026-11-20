'use strict';
/**
 * 截图服务（core/capture/index.js）
 *
 * 统一入口，按运行环境自动选择后端：
 *  - electron：宿主壳内（生产默认，M1-T3 截图委托宿主壳）
 *  - gdi     ：无 Electron 的 headless 场景（自测 / 集成测试）
 *  - mock/file：测试用合成图或文件回放（SCR-02）
 *
 * SCR-01：本模块只按调用方给定的矩形区域采集，永不主动全屏/定时/后台截屏。
 */
const { err, CODES } = require('../errors');

const BACKENDS = {
  electron: () => require('./electron'),
  gdi: () => require('./win32'),
  mock: () => require('./mock'),
};

class CaptureService {
  constructor(opts = {}) {
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.backendName = opts.backend || 'auto';
    this._impl = null;
  }

  _load(name) {
    const factory = BACKENDS[name];
    if (!factory) throw err(CODES.CAPTURE_FAILED, `未知截图后端：${name}`);
    return factory();
  }

  async pick(force = false) {
    if (this._impl && !force) return this._impl;
    if (this.backendName && this.backendName !== 'auto') {
      const impl = this._load(this.backendName);
      this._impl = { name: this.backendName, impl };
      return this._impl;
    }
    const order = ['electron', 'gdi'];
    for (const name of order) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const impl = this._load(name);
        // eslint-disable-next-line no-await-in-loop
        const p = await impl.probe();
        if (p.ok) {
          this._impl = { name, impl };
          this.logger.info('截图后端选定', { backend: name });
          return this._impl;
        }
      } catch { /* 试下一个后端 */ }
    }
    throw err(CODES.CAPTURE_UNAVAILABLE, '没有可用的截图后端');
  }

  /**
   * @returns {Promise<{buffer:Buffer,width:number,height:number,backend:string,ms:number}>}
   */
  async captureRegion(region, opts = {}) {
    const { name, impl } = await this.pick();
    const started = Date.now();
    const r = await impl.captureRegion(region, opts);
    return { ...r, backend: r.backend || name, ms: r.ms != null ? r.ms : Date.now() - started };
  }

  /**
   * 低分辨率帧指纹（第二十二轮性能优化）。
   * 只有 electron / gdi 后端支持；不支持时返回 null，调用方照常走完整截图。
   * @returns {Promise<{sig:Buffer,sigSide:number,width:number,height:number}|null>}
   */
  async peekRegion(region, opts = {}) {
    const { impl } = await this.pick();
    if (!impl || typeof impl.peekRegion !== 'function') return null;
    return impl.peekRegion(region, opts);
  }

  /** 两帧签名是否"基本没变"（平均绝对差 ≤ tolerance） */
  sameFrame(a, b, tolerance = 3) {
    if (this._impl && this._impl.impl && typeof this._impl.impl.sameFrame === 'function') {
      return this._impl.impl.sameFrame(a, b, tolerance);
    }
    if (!a || !b || a.length !== b.length || !a.length) return false;
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
    return sum / a.length <= tolerance;
  }

  async status() {
    const out = {};
    for (const name of Object.keys(BACKENDS)) {
      try {
        out[name] = await this._load(name).probe();
      } catch (e) {
        out[name] = { ok: false, backend: name, reason: e.message };
      }
    }
    return { selected: this._impl ? this._impl.name : null, backends: out };
  }
}

module.exports = { CaptureService, BACKENDS };
