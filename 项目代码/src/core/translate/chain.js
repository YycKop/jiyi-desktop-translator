'use strict';
/**
 * 翻译调用链（core/translate/chain.js）
 *
 * 依据 F-05a / F-06 / M4-T4，并按第十八轮需求扩展为「双通道 + 可切优先级」：
 *  - general.priority = 'online'（默认）：先按 order 串行试最多 maxApiAttempts 个联网 API
 *    （主用 5s / 备用 3s），全部失败才降级离线混元；
 *  - general.priority = 'offline'：先走离线混元，失败（未就绪/超时/空译文）再依次试联网 API；
 *  - 两条通道都可用，谁先成功就用谁，engine 记为 api.name 或「离线模式」；
 *  - 只看失败或超时切换，不评估译文质量（F-05a），也不做「离线结果更差就重试在线」这类质量判定。
 */
const { err, CODES, AppError, normalize } = require('../errors');
const { chatCompletion } = require('./openaiCompatible');
const { translateLocal } = require('./hunyuanLocal');
const { buildMessages, cleanTranslation } = require('./prompt');
const { ensureTraditional } = require('./traditional');

const OFFLINE_ENGINE = '离线模式';
const LOCAL_NOT_READY_MSG = '离线模型未安装，请配置联网 API 或下载模型';

function timeoutFor(index, network) {
  const n = network || {};
  return index === 0
    ? Number(n.primaryTimeoutMs) || 5000
    : Number(n.backupTimeoutMs) || 3000;
}

/**
 * @param {object} opts
 * @param {string} opts.text            原文
 * @param {string} opts.targetLang      目标语言 code
 * @param {string} [opts.sourceLang]    源语言 code，默认 auto
 * @param {Array}  [opts.apis]          已排序的候选 API（含明文 key 的临时对象）
 * @param {object} [opts.network]       {primaryTimeoutMs, backupTimeoutMs, maxApiAttempts}
 * @param {object} [opts.offline]       离线配置
 * @param {boolean}[opts.offlineAvailable] 离线服务是否可用（llama-server 就绪）
 * @param {'online'|'offline'} [opts.priority] 优先通道，默认 online
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onAttempt]   (info) => void，仅用于诊断与日志（不含原文）
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{text:string, engine:string, apiId:string|null, latencyMs:number,
 *   attempts:Array, priority:string, stage:string, fallback:boolean}>}
 */
async function translate(opts) {
  const {
    text, targetLang, sourceLang = 'auto', apis = [], network = {},
    offline = {}, offlineAvailable = false, priority = 'online', signal, onAttempt, fetchImpl,
  } = opts;

  const source = String(text || '');
  if (!source.trim()) {
    return { text: '', engine: '', apiId: null, latencyMs: 0, attempts: [], empty: true };
  }

  const maxAttempts = Math.min(5, Math.max(1, Number(network.maxApiAttempts) || 2));
  const candidates = apis.slice(0, maxAttempts);
  const attempts = [];
  const wanted = priority === 'offline' ? 'offline' : 'online';
  // 双通道串行：先跑优先通道，整条通道失败后再跑另一条（第十八轮需求 1/2）
  const order = wanted === 'offline' ? ['offline', 'online'] : ['online', 'offline'];

  const pushAttempt = (info) => {
    attempts.push(info);
    if (onAttempt) onAttempt(info);
  };

  /** 联网通道：串行试候选 API，首个非空译文即采用 */
  const runOnline = async () => {
    if (!candidates.length) {
      const e = err(CODES.TRANSLATE_ALL_FAILED, '未配置可用的联网 API');
      e.stage = 'online';
      return { ok: false, error: e };
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const api = candidates[i];
      const timeoutMs = timeoutFor(i, network);
      const started = Date.now();
      try {
        if (signal && signal.aborted) throw err(CODES.ABORTED, '已取消');
        const messages = buildMessages({
          text: source,
          targetLang,
          sourceLang,
          systemPrompt: api.systemPrompt,
        });
        const res = await chatCompletion({
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.model,
          messages,
          timeoutMs,
          signal,
          temperature: 0,
          fetchImpl,
        });
        let cleaned = cleanTranslation(res.text);
        // 目标为繁体时本地模型常原样返回简体，这里做一次确定性兜底转换
        cleaned = ensureTraditional(cleaned, source, targetLang).text;
        if (!cleaned) throw err(CODES.TRANSLATE_ALL_FAILED, '返回内容为空');
        const latencyMs = Date.now() - started;
        pushAttempt({
          apiId: api.id, name: api.name, ok: true, ms: latencyMs, stage: 'online',
        });
        return {
          ok: true,
          value: { text: cleaned, engine: api.name, apiId: api.id, latencyMs },
        };
      } catch (e) {
        const ae = normalize(e, CODES.TRANSLATE_ALL_FAILED);
        if (ae.code === CODES.ABORTED) return { ok: false, error: ae, abort: true };
        const latencyMs = Date.now() - started;
        pushAttempt({
          apiId: api.id, name: api.name, ok: false, ms: latencyMs, code: ae.code, message: ae.message, stage: 'online',
        });
        // 继续下一个候选（F-05a：失败或超时才切换，不评估质量）
      }
    }
    const e = err(CODES.TRANSLATE_ALL_FAILED, '联网 API 均未返回结果');
    e.stage = 'online';
    return { ok: false, error: e };
  };

  /** 离线通道：llama-server 未就绪时直接判失败，交给另一条通道 */
  const runOffline = async () => {
    if (!offlineAvailable) {
      const e = err(CODES.TRANSLATE_ALL_FAILED, LOCAL_NOT_READY_MSG);
      e.stage = 'offline';
      return { ok: false, error: e };
    }
    const started = Date.now();
    try {
      if (signal && signal.aborted) throw err(CODES.ABORTED, '已取消');
      const res = await translateLocal({
        text: source, targetLang, sourceLang, offline, signal, fetchImpl,
      });
      let cleaned = cleanTranslation(res.text);
      cleaned = ensureTraditional(cleaned, source, targetLang).text;
      if (!cleaned) throw err(CODES.TRANSLATE_ALL_FAILED, '离线模型返回空内容');
      const latencyMs = Date.now() - started;
      pushAttempt({
        apiId: null, name: OFFLINE_ENGINE, ok: true, ms: latencyMs, stage: 'offline',
      });
      return {
        ok: true,
        value: { text: cleaned, engine: OFFLINE_ENGINE, apiId: null, latencyMs },
      };
    } catch (e) {
      const ae = normalize(e, CODES.TRANSLATE_ALL_FAILED);
      if (ae.code === CODES.ABORTED) return { ok: false, error: ae, abort: true };
      pushAttempt({
        apiId: null, name: OFFLINE_ENGINE, ok: false, code: ae.code, message: ae.message, stage: 'offline',
      });
      return { ok: false, error: ae };
    }
  };

  const lanes = { online: runOnline, offline: runOffline };
  for (let i = 0; i < order.length; i += 1) {
    const stage = order[i];
    const result = await lanes[stage]();
    if (result.ok) {
      return {
        ...result.value,
        attempts,
        priority: wanted,
        stage,
        fallback: i > 0,
      };
    }
    if (result.abort) throw result.error;
  }

  const failed = err(CODES.TRANSLATE_ALL_FAILED, '所有翻译通道均不可用');
  const hasApis = candidates.length > 0;
  if (offlineAvailable && hasApis) {
    failed.userMessage = '翻译失败：离线模型与联网 API 均未返回结果';
  } else if (!offlineAvailable && !hasApis) {
    failed.userMessage = LOCAL_NOT_READY_MSG;
  } else if (offlineAvailable) {
    failed.userMessage = '翻译失败：离线模型未返回结果（未配置联网 API）';
  } else {
    // 联网 API 失败 + 离线未就绪：按需求书口径统一提示「离线模型未安装」，
    // 用户据此要么配 API、要么下模型（M1-M5 细节书 F-06 的约定措辞）。
    failed.userMessage = LOCAL_NOT_READY_MSG;
  }
  failed.details = { attempts, priority: wanted };
  throw failed;
}

/** 单 API 连通性测试（M4-T3，超时 8s，不修改配置） */
async function testConnection(api, { timeoutMs = 8000, fetchImpl, targetLang = 'zh' } = {}) {
  const started = Date.now();
  try {
    const messages = buildMessages({
      text: 'Hello',
      targetLang,
      sourceLang: 'en',
      systemPrompt: api.systemPrompt,
    });
    const res = await chatCompletion({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      messages,
      timeoutMs,
      fetchImpl,
    });
    const latencyMs = Date.now() - started;
    return {
      ok: true,
      latencyMs,
      sample: cleanTranslation(res.text).slice(0, 40),
      model: res.model,
    };
  } catch (e) {
    const ae = normalize(e, CODES.TRANSLATE_ALL_FAILED);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      code: ae.code,
      message: ae.message,
      hint: ae.code === CODES.API_UNAUTHORIZED ? 'API Key 无效或无权限'
        : ae.code === CODES.API_MODEL_NOT_FOUND ? '模型名称不存在'
          : ae.code === CODES.TRANSLATE_TIMEOUT ? '连接超时' : '连接失败',
    };
  }
}

module.exports = { translate, testConnection, OFFLINE_ENGINE, LOCAL_NOT_READY_MSG, AppError };
