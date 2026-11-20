'use strict';
/**
 * OCR 服务（core/ocr/index.js）
 *
 * 引擎说明：
 *  - rapid（首选）：PP-OCRv4 ONNX（onnxruntime-node），中文小字与照片底更稳；
 *    模型在 runtime/ocr-rapid/models，随包分发。
 *  - winrt：Windows.Media.Ocr（零依赖、零内存，中文长文与标点稍弱）。
 *  - tesseract：用户自装时的兜底。
 *  - mock：仅测试。
 *
 * `ocr.engine` 配置可选 auto / rapid / winrt / tesseract，auto 时按 AUTO_ORDER 依次探测。
 */
const path = require('path');
const winrt = require('./winrt');
const tesseract = require('./tesseract');
const mock = require('./mock');
const { RapidOcr } = require('./rapid');
const { err, CODES } = require('../errors');

const presetPath = require('../paths');

function rapidModelsDir() {
  const fs = require('fs');
  const candidates = [
    // 开发态 = 项目代码\runtime；打包态 = app\resources\runtime（与 llama 同一处）
    path.join(presetPath.resourceRoot(), 'runtime', 'ocr-rapid', 'models'),
    // 源码树（项目代码/runtime）与打包后（resources/app/runtime）
    path.join(__dirname, '..', '..', '..', 'runtime', 'ocr-rapid', 'models'),
    // 打包后运行时实际落在 resources/runtime（与 llama 同一处）
    path.join(__dirname, '..', '..', '..', '..', 'runtime', 'ocr-rapid', 'models'),
    path.join(presetPath.PROJECT_ROOT, '项目代码', 'runtime', 'ocr-rapid', 'models'),
    path.join(presetPath.PROJECT_ROOT, 'runtime', 'ocr-rapid', 'models'),
    // 用户把模型拷到数据目录时也认
    path.join(presetPath.home(), 'models', 'ocr-rapid'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'ch_PP-OCRv4_rec_mobile.onnx'))) return dir;
  }
  return candidates[0];
}

const rapidEngine = new RapidOcr({ modelsDir: rapidModelsDir() });

const ENGINES = {
  rapid: {
    name: 'rapid',
    label: 'ONNX · PP-OCRv4（推荐）',
    recognize: rapidEngine.recognize.bind(rapidEngine),
    probe: rapidEngine.probe.bind(rapidEngine),
  },
  winrt: {
    name: 'winrt',
    label: 'Windows 内置 OCR',
    recognize: winrt.recognize,
    // 多遍识别（2x + 3x + 对比度）：同一张图在不同放大倍数下各有胜负，
    // 用 core/ocr/score.js 的异常形状打分挑最干净的一遍（见该文件注释与实测数据）。
    recognizeMulti: winrt.recognizeMulti,
    probe: winrt.probe,
  },
  tesseract: { name: 'tesseract', label: 'Tesseract', recognize: tesseract.recognize, probe: tesseract.probe },
  mock: { name: 'mock', label: 'Mock（测试）', recognize: mock.recognize, probe: mock.probe },
};

const AUTO_ORDER = ['rapid', 'winrt', 'tesseract'];
const VALID_PREFERRED = ['auto', 'rapid', 'winrt', 'tesseract'];
// 识别语言白名单；rapid 引擎支持 ch / japan / korean 三套模型
const VALID_LANGS = ['auto', 'ch', 'japan', 'korean'];

class OcrService {
  constructor(opts = {}) {
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.preferred = opts.engine || 'auto';
    this.langs = opts.langs || ['zh-Hans-CN', 'en-US'];
    // 识别语言（第二十一轮需求 5）：auto 时中英优先、低分再试日 / 韩
    this.lang = opts.lang || 'auto';
    this._picked = null;
    this._probeCache = null;
  }

  /** 切换识别语言（auto / ch / japan / korean）；下一轮生效，无需重启 */
  setLang(lang) {
    const next = VALID_LANGS.includes(lang) ? lang : 'auto';
    if (next === this.lang) return this.lang;
    this.lang = next;
    return this.lang;
  }

  /** 切换引擎（设置页会调用）；preferred 变化时清掉已选引擎，下一轮重新探测。 */
  setPreferred(engine) {
    const next = VALID_PREFERRED.includes(engine) ? engine : 'auto';
    if (next === this.preferred) return this.preferred;
    this.preferred = next;
    this._picked = null;
    this._probeCache = null;
    return this.preferred;
  }

  async probeAll() {
    if (this._probeCache) return this._probeCache;
    const out = {};
    for (const key of Object.keys(ENGINES)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        out[key] = await ENGINES[key].probe();
      } catch (e) {
        out[key] = { ok: false, engine: key, reason: e.message };
      }
    }
    this._probeCache = out;
    return out;
  }

  async pick(force = false) {
    if (this._picked && !force) return this._picked;
    if (this.preferred && this.preferred !== 'auto') {
      const e = ENGINES[this.preferred];
      if (!e) throw err(CODES.OCR_UNAVAILABLE, `未知 OCR 引擎：${this.preferred}`);
      const p = await e.probe();
      if (!p.ok) throw err(CODES.OCR_UNAVAILABLE, `${e.label} 不可用：${p.reason || '探测失败'}`);
      this._picked = e;
      return e;
    }
    for (const key of AUTO_ORDER) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const p = await ENGINES[key].probe();
        if (p.ok) {
          this._picked = ENGINES[key];
          this.logger.info('OCR 引擎选定', { engine: key, lang: p.lang || p.version || '' });
          return this._picked;
        }
      } catch { /* 继续尝试下一个引擎 */ }
    }
    throw err(CODES.OCR_UNAVAILABLE, '没有可用的 OCR 引擎（ONNX 模型缺失且未检测到系统 OCR）');
  }

  /**
   * @param {{buffer:Buffer, signal?:AbortSignal, multiPass?:boolean}} opts
   *   multiPass 只对 winrt 有意义（其它引擎没有放大倍数概念）
   */
  async recognize({ buffer, signal, multiPass }) {
    const engine = await this.pick();
    if (signal && signal.aborted) throw err(CODES.ABORTED, '已取消');
    const langs = engine.name === 'tesseract' ? ['chi_sim', 'eng'] : this.langs;
    const useMulti = multiPass !== false && typeof engine.recognizeMulti === 'function';
    // rapid 支持多语种模型（中英 / 日 / 韩），其余引擎忽略 lang
    const extra = engine.name === 'rapid' ? { lang: this.lang } : {};
    try {
      const r = useMulti
        ? await engine.recognizeMulti({ buffer, langs, signal, ...extra })
        : await engine.recognize({ buffer, langs, signal, ...extra });
      return { ...r, engine: engine.name, multiPass: !!useMulti };
    } catch (e) {
      if (e && e.code === CODES.ABORTED) throw e;
      // 探测通过但识别失败：清掉缓存，下一轮重新探测；
      // 这样偶发的模型/子进程问题不会被永久判定成"没有可用的 OCR 引擎"。
      this._picked = null;
      this._probeCache = null;
      this.logger.warn('OCR 识别失败，已重置引擎缓存', {
        engine: engine.name,
        reason: String((e && e.message) || e).slice(0, 200),
      });
      throw e;
    }
  }

  /** 同步快照（供 status()/诊断用；探测结果由 probeAll() 缓存） */
  status() {
    return {
      preferred: this.preferred,
      picked: this._picked ? this._picked.name : null,
      lang: this.lang,
      langsAvailable: typeof rapidEngine.availableLangs === 'function' ? rapidEngine.availableLangs() : [],
      multiPass: true,
      rapidModels: rapidModelsDir(),
      engines: this._probeCache || null,
    };
  }
}

module.exports = { OcrService, ENGINES, AUTO_ORDER, VALID_PREFERRED, VALID_LANGS, rapidModelsDir };
