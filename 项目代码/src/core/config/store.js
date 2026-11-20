'use strict';
/**
 * 配置存储（core/config/store.js）
 *
 * 职责：
 *  - 加载/合并/校验/原子写盘 config.json
 *  - API 卡片增删改查、排序（M4-T1）
 *  - API Key 加解密（F-08 / KEY-02 / KEY-04），对外只暴露掩码
 *  - 变更事件，供浮窗/设置面板/托盘同步
 *
 * 安全约定：
 *  - 明文密钥只在 getApiSecret() 返回的瞬时对象中存在
 *  - 任何对外视图（publicView/listApis）都不包含密文与明文
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { defaults, API_PRESETS, DEFAULT_SYSTEM_PROMPT, deepClone } = require('./defaults');
const secrets = require('../security/secrets');
const { err, CODES } = require('../errors');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 主题色/背景色只接受 #rgb / #rrggbb（防止把任意字符串塞进 CSS） */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (Array.isArray(v)) out[k] = v.map((x) => (isPlainObject(x) ? deepMerge({}, x) : x));
    else if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function normalizeBaseUrl(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw err(CODES.CONFIG_INVALID, 'Base URL 必须以 http:// 或 https:// 开头');
  return s;
}

class ConfigStore extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.file = opts.file;
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
    this.data = defaults();
    this._loaded = false;
  }

  load() {
    let raw = null;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') this.logger.warn('读取配置失败，使用默认值', { code: e.code });
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.data = deepMerge(defaults(), parsed);
      } catch (e) {
        // 配置损坏时归档并回到默认值，避免直接崩溃
        this.logger.error('配置文件解析失败，已重置为默认配置', { len: raw.length });
        try { fs.renameSync(this.file, this.file + '.broken-' + Date.now()); } catch { /* 忽略 */ }
        this.data = defaults();
      }
    }
    this._ensureSalt();
    this._migrate();
    this._loaded = true;
    this.save();
    return this.data;
  }

  /** 老配置的兼容迁移（只在命中旧默认值时改写，用户自定义过的组合键不动） */
  _migrate() {
    const hk = this.data.hotkeys || {};
    // Ctrl+Shift+P / Ctrl+Alt+P 实测都被其它程序占用，新默认 Ctrl+Alt+S（仍可在设置里改）
    if (hk.pause === 'CommandOrControl+Shift+P' || hk.pause === 'CommandOrControl+Alt+P') {
      hk.pause = 'CommandOrControl+Alt+S';
      this.logger.info('已把暂停热键迁移为 Ctrl+Alt+S（旧组合被其它程序占用）');
    }
    this.data.hotkeys = hk;

    // 第九轮用「生效范围」二选一，用户反馈要"两处分别设置"，改为两个独立图片槽：
    // 老配置里 scope=settings 的图搬到设置页槽位，scope=hud/both 的图留在浮窗槽位。
    const ap = this.data.appearance || {};
    if (ap.bgImageScope) {
      if (ap.bgImageScope === 'settings' && ap.bgImage) {
        ap.settingsBgImage = ap.bgImage;
        ap.bgImage = '';
        this.logger.info('已把旧的"仅设置页"背景图迁移到设置页槽位');
      }
      delete ap.bgImageScope;
      this.data.appearance = ap;
    }
  }

  _ensureSalt() {
    if (!this.data.secrets || !this.data.secrets.salt) {
      this.data.secrets = this.data.secrets || {};
      this.data.secrets.salt = secrets.newSalt();
      this.data.secrets.items = this.data.secrets.items || {};
    }
    if (!this.data.secrets.items) this.data.secrets.items = {};
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = this.file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** 原始配置（含内部 secrets 索引，仅供宿主进程内部使用） */
  raw() {
    return this.data;
  }

  /** 对外视图：剔除 secrets 段 */
  publicView() {
    const view = deepClone(this.data);
    delete view.secrets;
    view.apis = this.listApis();
    return view;
  }

  patch(partial, { silent = false } = {}) {
    if (!isPlainObject(partial)) throw err(CODES.CONFIG_INVALID, '配置补丁必须是对象');
    const safe = deepClone(partial);
    delete safe.secrets; // secrets 段禁止由外部写入
    if (safe.apis) delete safe.apis; // apis 走专用接口
    if (safe.offline && safe.offline.modelPath === undefined) delete safe.offline.modelPath;
    const next = deepMerge(this.data, safe);
    if (next.capture && next.capture.lastSelection) {
      const r = next.capture.lastSelection;
      for (const k of ['x', 'y', 'width', 'height']) {
        if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) {
          throw err(CODES.CONFIG_INVALID, '框选区域坐标必须是数字');
        }
      }
      if (r.width < 4 || r.height < 4) throw err(CODES.CONFIG_INVALID, '框选区域过小');
    }
    if (next.network) {
      next.network.primaryTimeoutMs = Math.max(500, Number(next.network.primaryTimeoutMs) || 5000);
      next.network.backupTimeoutMs = Math.max(500, Number(next.network.backupTimeoutMs) || 3000);
      next.network.maxApiAttempts = Math.min(5, Math.max(1, Number(next.network.maxApiAttempts) || 2));
    }
    if (next.capture) {
      // 第二十一轮需求 4：最小间隔从 500ms 放宽到 200ms（loop 的 MIN_INTERVAL 也是 200），
      // 这样设置页可以给出 0.3 秒这种「实时字幕」档位。
      next.capture.intervalMs = Math.min(60000, Math.max(200, Number(next.capture.intervalMs) || 2000));
    }
    if (next.general) {
      // 点击 exe / 托盘左键的行为：只允许两种（第十二轮需求 2）
      if (next.general.launchAction !== 'hud') next.general.launchAction = 'settings';
      // 翻译通道优先级：只接受 online / offline（第十八轮需求）
      if (!['online', 'offline'].includes(next.general.priority)) next.general.priority = 'online';
      // 常驻悬浮球：布尔开关（第十九轮需求 4），非 false 都视为开
      next.general.ballEnabled = next.general.ballEnabled !== false;
    }
    if (next.offline) {
      // 空闲卸载（第二十二轮）：0 = 不自动卸载，最长 1 小时
      next.offline.idleStopMs = Math.min(3600000, Math.max(0, Math.round(Number(next.offline.idleStopMs) || 0)));
      next.offline.autostart = !!next.offline.autostart;
      next.offline.port = Math.min(65535, Math.max(1024, Math.round(Number(next.offline.port) || 8081)));
      next.offline.threads = Math.min(64, Math.max(0, Math.round(Number(next.offline.threads) || 0)));
    }
    if (next.ocr) {
      // 识别引擎：只接受这四个值，其它一律回落到 auto
      const allowed = ['auto', 'rapid', 'winrt', 'tesseract'];
      if (!allowed.includes(next.ocr.engine)) next.ocr.engine = 'auto';
      // 识别语言（第二十一轮需求 5）：rapid 引擎支持中英 / 日 / 韩三套模型
      const langs = ['auto', 'ch', 'japan', 'korean'];
      if (!langs.includes(next.ocr.lang)) next.ocr.lang = 'auto';
    }
    if (next.hud) {
      next.hud.width = Math.min(1200, Math.max(280, Math.round(Number(next.hud.width) || 460)));
      next.hud.height = Math.min(900, Math.max(96, Math.round(Number(next.hud.height) || 240)));
      next.hud.fontSize = Math.min(28, Math.max(11, Math.round(Number(next.hud.fontSize) || 14)));
      next.hud.opacity = Math.min(1, Math.max(0.3, Number(next.hud.opacity) || 0.84));
      next.hud.autoHeight = next.hud.autoHeight !== false;
      // 浮窗模式：card / subtitle（第十八轮需求 3）
      if (!['card', 'subtitle'].includes(next.hud.mode)) next.hud.mode = 'card';
      next.hud.subtitleFontSize = Math.min(48, Math.max(12, Math.round(Number(next.hud.subtitleFontSize) || 24)));
      next.hud.subtitleBackdrop = !!next.hud.subtitleBackdrop;
      next.hud.subtitleWidth = Math.min(2400, Math.max(0, Math.round(Number(next.hud.subtitleWidth) || 0)));
      // 0 表示"按屏幕宽度自动"，一旦手填就至少得能放下两行字幕（64px）
      const sh = Math.round(Number(next.hud.subtitleHeight) || 0);
      next.hud.subtitleHeight = sh > 0 ? Math.min(400, Math.max(64, sh)) : 0;
      const sp = next.hud.subtitlePoint;
      if (sp && typeof sp === 'object'
        && Number.isFinite(Number(sp.x)) && Number.isFinite(Number(sp.y))) {
        next.hud.subtitlePoint = { x: Math.round(Number(sp.x)), y: Math.round(Number(sp.y)) };
      } else if (sp !== null) {
        next.hud.subtitlePoint = null;
      }
    }
    if (next.appearance) {
      const a = next.appearance;
      if (typeof a.accent !== 'string' || !HEX_COLOR.test(a.accent)) a.accent = '#4c8dff';
      if (typeof a.background !== 'string' || !HEX_COLOR.test(a.background)) a.background = '#12151c';
      a.opacity = Math.min(1, Math.max(0.3, Number(a.opacity) || 0.84));
      a.blur = Math.min(30, Math.max(0, Math.round(Number(a.blur) || 0)));
      a.radius = Math.min(28, Math.max(0, Math.round(Number(a.radius) || 0)));
      a.bgImageOpacity = Math.min(1, Math.max(0, Number(a.bgImageOpacity)));
      if (!Number.isFinite(a.bgImageOpacity)) a.bgImageOpacity = 0.35;
      a.settingsBgImageOpacity = Math.min(1, Math.max(0, Number(a.settingsBgImageOpacity)));
      if (!Number.isFinite(a.settingsBgImageOpacity)) a.settingsBgImageOpacity = 0.35;
      if (!['cover', 'contain', 'tile'].includes(a.bgImageFit)) a.bgImageFit = 'cover';
      // 背景图只允许引用数据目录 theme/ 下的绝对路径，避免被拿来做任意路径读取
      if (typeof a.bgImage !== 'string') a.bgImage = '';
      if (a.bgImage && !path.isAbsolute(a.bgImage)) a.bgImage = '';
      if (typeof a.settingsBgImage !== 'string') a.settingsBgImage = '';
      if (a.settingsBgImage && !path.isAbsolute(a.settingsBgImage)) a.settingsBgImage = '';
      // 第九轮的「生效范围」已被两处独立背景图取代，残留字段直接丢掉
      delete a.bgImageScope;
      // 字体颜色：空串表示自动对比度；非空必须是合法色值
      if (typeof a.textColor !== 'string' || (a.textColor && !HEX_COLOR.test(a.textColor))) a.textColor = '';
    }
    this.data = next;
    this._ensureSalt();
    this.save();
    if (!silent) this.emit('change', this.publicView());
    return this.publicView();
  }

  // ---------- API 卡片（M4） ----------

  /** 排序后的列表（不含任何密钥材料） */
  listApis() {
    const items = (this.data.apis || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return items.map((a) => ({
      id: a.id,
      name: a.name,
      baseUrl: a.baseUrl,
      model: a.model,
      systemPrompt: a.systemPrompt || '',
      enabled: !!a.enabled,
      order: a.order ?? 0,
      hasKey: !!(this.data.secrets.items || {})[a.id],
      keyMasked: a.lastKeyMask || (a.enabled ? '****' : ''),
      lastTest: a.lastTest || null,
    }));
  }

  _nextOrder() {
    const list = this.data.apis || [];
    return list.reduce((m, a) => Math.max(m, Number(a.order ?? 0) + 1), 0);
  }

  addApi(input) {
    const item = {
      id: crypto.randomUUID(),
      name: String(input.name || '').trim() || '未命名 API',
      baseUrl: normalizeBaseUrl(input.baseUrl),
      model: String(input.model || '').trim(),
      systemPrompt: String(input.systemPrompt || DEFAULT_SYSTEM_PROMPT),
      enabled: input.enabled !== false,
      order: this._nextOrder(),
      lastTest: null,
      lastKeyMask: '',
      createdAt: new Date().toISOString(),
    };
    if (!item.baseUrl) throw err(CODES.CONFIG_INVALID, 'Base URL 不能为空');
    if (!item.model) throw err(CODES.CONFIG_INVALID, '模型名称不能为空');
    this.data.apis = this.data.apis || [];
    this.data.apis.push(item);
    if (input.apiKey) this.setApiSecret(item.id, input.apiKey);
    this.save();
    this.emit('change', this.publicView());
    return this.listApis().find((a) => a.id === item.id);
  }

  updateApi(id, patchIn) {
    const list = this.data.apis || [];
    const item = list.find((a) => a.id === id);
    if (!item) throw err(CODES.CONFIG_INVALID, 'API 不存在');
    const p = patchIn || {};
    if (p.name !== undefined) item.name = String(p.name).trim() || item.name;
    if (p.baseUrl !== undefined) item.baseUrl = normalizeBaseUrl(p.baseUrl);
    if (p.model !== undefined) item.model = String(p.model).trim();
    if (p.systemPrompt !== undefined) item.systemPrompt = String(p.systemPrompt);
    if (p.enabled !== undefined) item.enabled = !!p.enabled;
    if (p.order !== undefined) item.order = Number(p.order);
    if (p.apiKey) this.setApiSecret(id, p.apiKey);
    this.save();
    this.emit('change', this.publicView());
    return this.listApis().find((a) => a.id === id);
  }

  removeApi(id) {
    const before = (this.data.apis || []).length;
    this.data.apis = (this.data.apis || []).filter((a) => a.id !== id);
    if (this.data.secrets && this.data.secrets.items) delete this.data.secrets.items[id];
    this._reindex();
    this.save();
    this.emit('change', this.publicView());
    return { removed: before !== (this.data.apis || []).length };
  }

  /** M4-T1 拖拽排序：传入新顺序的 id 数组 */
  reorderApis(ids) {
    if (!Array.isArray(ids)) throw err(CODES.CONFIG_INVALID, '排序参数必须是 id 数组');
    const map = new Map((this.data.apis || []).map((a) => [a.id, a]));
    const next = [];
    ids.forEach((id) => {
      const it = map.get(id);
      if (it) { next.push(it); map.delete(id); }
    });
    for (const rest of map.values()) next.push(rest);
    next.forEach((a, i) => { a.order = i; });
    this.data.apis = next;
    this.save();
    this.emit('change', this.publicView());
    return this.listApis();
  }

  _reindex() {
    (this.data.apis || []).forEach((a, i) => { a.order = i; });
  }

  /** 加密保存 Key（明文不落盘）。返回掩码 */
  setApiSecret(id, plaintext) {
    const key = String(plaintext || '').trim();
    this._ensureSalt();
    const item = (this.data.apis || []).find((a) => a.id === id);
    if (!key) {
      delete this.data.secrets.items[id];
      if (item) item.lastKeyMask = '';
      this.save();
      return '';
    }
    this.data.secrets.items[id] = secrets.seal(key, this.data.secrets.salt);
    const masked = secrets.maskKey(key);
    if (item) item.lastKeyMask = masked;
    // 必须立即落盘：否则用户填写的 Key 在重启后丢失（F-08）
    this.save();
    return masked;
  }

  /** 仅译调用链使用：返回明文密钥（不落盘、不记日志、不返回给渲染进程） */
  getApiSecret(id) {
    const sealed = (this.data.secrets.items || {})[id];
    if (!sealed) return '';
    try {
      return secrets.open(sealed, this.data.secrets.salt);
    } catch (e) {
      this.logger.error('API Key 解密失败（机器密钥变更或配置被复制）', { id });
      throw err(CODES.SECRET_DECRYPT_FAILED, 'API Key 解密失败，请重新填写密钥');
    }
  }

  /** 依次尝试的候选链（F-05a：按 order 升序，仅 enabled） */
  getEnabledApisOrdered() {
    return (this.data.apis || [])
      .filter((a) => a.enabled && a.baseUrl && a.model)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((a) => ({ id: a.id, name: a.name, baseUrl: a.baseUrl, model: a.model, systemPrompt: a.systemPrompt, order: a.order ?? 0 }));
  }

  markApiTest(id, result) {
    const item = (this.data.apis || []).find((a) => a.id === id);
    if (!item) return null;
    item.lastTest = { ...result, at: new Date().toISOString() };
    this.save();
    this.emit('change', this.publicView());
    return item.lastTest;
  }

  getPresets() {
    return API_PRESETS.map((p) => ({ ...p, systemPrompt: DEFAULT_SYSTEM_PROMPT }));
  }
}

module.exports = { ConfigStore, deepMerge, normalizeBaseUrl, DEFAULT_SYSTEM_PROMPT };
