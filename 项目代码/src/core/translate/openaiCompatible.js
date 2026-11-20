'use strict';
/**
 * OpenAI 兼容 Chat Completions 调用（core/translate/openaiCompatible.js）
 *
 * 依据 F-05 / F-05a / M4-T4：
 *  - POST {baseUrl}/chat/completions，Authorization: Bearer {userKey}
 *  - 主用超时 5s、备用 3s（由调用方传入）
 *  - 任一错误都归一化为 AppError，携带可读 userMessage
 *
 * 安全：请求只发往用户自己填写的端点（CMD-04）；密钥仅存于 Authorization 头，
 * 不写入日志、不进入异常 message（KEY-03）。
 */
const { err, CODES, AppError } = require('../errors');

function endpointOf(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) throw err(CODES.CONFIG_INVALID, 'Base URL 为空');
  if (/\/chat\/completions$/i.test(u)) return u;
  return u + '/chat/completions';
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch { return '(invalid-url)'; }
}

function classifyHttp(status, bodyText) {
  const snippet = String(bodyText || '').slice(0, 300);
  if (status === 401 || status === 403) {
    return err(CODES.API_UNAUTHORIZED, `鉴权失败（HTTP ${status}）`, { status, snippet });
  }
  if (status === 404) {
    return err(CODES.API_MODEL_NOT_FOUND, `模型或接口不存在（HTTP 404）`, { status, snippet });
  }
  if (status === 429) {
    return err(CODES.TRANSLATE_ALL_FAILED, '请求过于频繁（HTTP 429）', { status, snippet });
  }
  if (status >= 500) {
    return err(CODES.TRANSLATE_ALL_FAILED, `服务端错误（HTTP ${status}）`, { status, snippet });
  }
  return err(CODES.TRANSLATE_ALL_FAILED, `请求失败（HTTP ${status}）`, { status, snippet });
}

function extractText(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  if (!choice) return '';
  if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
  if (typeof choice.text === 'string') return choice.text;
  if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
  return '';
}

/**
 * @returns {Promise<{text:string, latencyMs:number, usage:object|null, model:string}>}
 */
async function chatCompletion(opts) {
  const {
    baseUrl, apiKey, model, messages,
    timeoutMs = 5000, signal, temperature = 0, maxTokens, fetchImpl,
  } = opts;

  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw err('NO_FETCH', '运行环境缺少 fetch 实现');

  const url = endpointOf(baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); throw err(CODES.ABORTED, '已取消'); }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  const body = {
    model,
    messages,
    temperature,
    stream: false,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const started = Date.now();
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
    if (timedOut) throw err(CODES.TRANSLATE_TIMEOUT, `请求超时（${timeoutMs}ms）`, { host: safeOrigin(url) });
    if (signal && signal.aborted) throw err(CODES.ABORTED, '已取消');
    throw err(CODES.TRANSLATE_ALL_FAILED, '网络不可达或连接被拒绝', { host: safeOrigin(url), reason: String(e && e.code || e && e.name || '') });
  }

  let text;
  try {
    text = await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
    throw err(CODES.TRANSLATE_ALL_FAILED, '读取响应失败', { host: safeOrigin(url) });
  }
  clearTimeout(timer);
  if (signal) signal.removeEventListener('abort', onOuterAbort);

  const latencyMs = Date.now() - started;
  if (!res.ok) throw classifyHttp(res.status, text);

  let json;
  try { json = JSON.parse(text); } catch {
    throw err(CODES.TRANSLATE_ALL_FAILED, '响应不是合法 JSON', { host: safeOrigin(url) });
  }
  const content = extractText(json);
  if (!content || !String(content).trim()) {
    throw err(CODES.TRANSLATE_ALL_FAILED, '返回内容为空', { host: safeOrigin(url) });
  }
  return { text: content, latencyMs, usage: json.usage || null, model: json.model || model };
}

module.exports = { chatCompletion, endpointOf, safeOrigin, AppError };
