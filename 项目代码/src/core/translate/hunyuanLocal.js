'use strict';
/**
 * 离线混元翻译服务适配（core/translate/hunyuanLocal.js）
 *
 * 依据 M1-T4 / M1-T5：
 *  - 目标为本地 llama.cpp `llama-server` 暴露的 OpenAI 兼容接口
 *  - 默认 http://127.0.0.1:8081/v1/chat/completions，model 填 hy-mt
 *  - 单次超时 10s（首次推理可能较慢），后续 3s 内
 *
 * 安全：仅请求 127.0.0.1 / localhost（CMD-04 允许的调试端点），不出本机。
 */
const { err, CODES } = require('../errors');
const { chatCompletion } = require('./openaiCompatible');
const { buildMessages } = require('./prompt');

function baseUrlOf(offline) {
  const host = (offline && offline.host) || '127.0.0.1';
  const port = (offline && offline.port) || 8081;
  return `http://${host}:${port}/v1`;
}

/**
 * @returns {Promise<{text:string, engine:string, latencyMs:number}>}
 */
async function translateLocal(opts) {
  const {
    text, targetLang, sourceLang, offline = {}, signal, fetchImpl,
  } = opts;

  const model = offline.modelName || 'hy-mt';
  const timeoutMs = Number(offline.timeoutMs) || 10000;
  const messages = buildMessages({
    text,
    targetLang,
    sourceLang,
    useLocalDefaults: true,
  });

  const r = await chatCompletion({
    baseUrl: baseUrlOf(offline),
    model,
    messages,
    timeoutMs,
    signal,
    temperature: 0,
    fetchImpl,
  });
  return { text: r.text, engine: '离线模式', latencyMs: r.latencyMs };
}

/** 健康检查：llama-server 是否已就绪（M1-T5 验收用） */
async function health(offline = {}, fetchImpl) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const url = `http://${offline.host || '127.0.0.1'}:${offline.port || 8081}/health`;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(1500) });
    return { ok: res.ok, status: res.status, url };
  } catch (e) {
    return { ok: false, status: 0, url, reason: String(e && e.name || '') };
  }
}

module.exports = { translateLocal, health, baseUrlOf, CODES };
