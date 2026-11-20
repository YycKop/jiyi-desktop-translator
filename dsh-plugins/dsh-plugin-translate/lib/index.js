'use strict';
/**
 * dsh-plugin-translate（lib/index.js，纯 CommonJS —— PLG-01）
 *
 * 职责：把「文本 → 译文」交给宿主壳完成。插件自身不持有任何 API Key，
 * 也不决定用哪个通道：宿主壳按 F-05a 的顺序先试联网 API（最多 2 个，主 5s/备 3s），
 * 全部失败/超时才降级本地混元（引擎标记为「离线模式」）。
 *
 * 宿主桥协议：
 *   POST http://127.0.0.1:<port>/v1/host/translate_text
 *   header: x-bridge-token: <一次性令牌>
 *   body:   {text, targetLang, sourceLang}
 *   resp:   {ok:true, text, engine, latencyMs, apiId}
 *
 * 安全：不打印原文与译文；错误只回传 code 与收敛后的提示（LOG-02 / KEY-03）。
 */
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'translate';
const TIMEOUT_MS = 30000;
const MAX_TEXT = 20000;

function bridgeFileCandidates() {
  const out = [];
  if (process.env.TRANSLATOR_HOME) out.push(path.join(process.env.TRANSLATOR_HOME, 'bridge.json'));
  out.push(path.join(__dirname, '..', '..', '..', '项目测试', '_runtime', 'home', 'bridge.json'));
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'desktop-translator', 'bridge.json'));
  return out;
}

function readBridgeInfo() {
  for (const file of bridgeFileCandidates()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.port && raw.token) return { port: raw.port, token: raw.token, file };
    } catch { /* 继续尝试下一个候选 */ }
  }
  return null;
}

async function callHost(endpoint, body, signal) {
  const info = readBridgeInfo();
  if (!info) {
    const e = new Error('桌面翻译助手宿主壳未运行：请先启动助手');
    e.code = 'HOST_UNAVAILABLE';
    throw e;
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const composed = typeof AbortSignal.any === 'function' && signal
    ? AbortSignal.any([signal, timeout])
    : (signal || timeout);

  const res = await fetch(`http://127.0.0.1:${info.port}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-token': info.token },
    body: JSON.stringify(body),
    signal: composed,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 不打印响应正文 */ }
  if (!res.ok || !json || json.ok === false) {
    const e = new Error((json && json.error) || `宿主桥返回 HTTP ${res.status}`);
    e.code = (json && json.code) || 'HOST_ERROR';
    throw e;
  }
  return json;
}

const tool = {
  name: 'translate_text',
  description: '把一段文本翻译成目标语言（联网 API 优先，失败自动降级本地离线模型；Key 由宿主壳管理）',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要翻译的原文' },
      targetLang: { type: 'string', description: '目标语言代码，如 zh / en / ja / ko' },
      sourceLang: { type: 'string', description: '源语言代码，默认 auto（自动检测）' },
    },
    required: ['text', 'targetLang'],
  },
  async execute(args, exec) {
    const { text, targetLang, sourceLang = 'auto' } = args || {};
    if (typeof text !== 'string' || !text.trim()) throw new Error('text 不能为空');
    if (text.length > MAX_TEXT) throw new Error(`text 过长（上限 ${MAX_TEXT} 字符）`);
    if (typeof targetLang !== 'string' || !targetLang.trim()) throw new Error('targetLang 不能为空');

    const r = await callHost('/v1/host/translate_text', { text, targetLang, sourceLang }, exec && exec.signal);
    return {
      text: r.text || '',
      engine: r.engine || '',
      latencyMs: r.latencyMs || 0,
    };
  },
};

/** 与 screen-ocr 插件相同的注册能力探测（不猜测不存在的 API） */
function registerTools(ctx, tools) {
  if (!ctx) return { registered: false, tools };
  if (typeof ctx.registerTool === 'function') {
    tools.forEach((t) => ctx.registerTool(t));
    return { registered: true, via: 'ctx.registerTool', tools };
  }
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    tools.forEach((t) => ctx.tools.register(t));
    return { registered: true, via: 'ctx.tools.register', tools };
  }
  if (typeof ctx.tool === 'function') {
    tools.forEach((t) => ctx.tool(t));
    return { registered: true, via: 'ctx.tool', tools };
  }
  return { registered: false, tools };
}

function apply(ctx) {
  const result = registerTools(ctx, [tool]);
  if (!result.registered && ctx && typeof ctx.logger?.warn === 'function') {
    ctx.logger.warn('translate: 未识别到工具注册接口，已导出工具定义供上层手动挂载');
  }
  return result;
}

module.exports = {
  name: PLUGIN_NAME,
  apply,
  tools: [tool],
  callHost,
  readBridgeInfo,
  bridgeFileCandidates,
};
