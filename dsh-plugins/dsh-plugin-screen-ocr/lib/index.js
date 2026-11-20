'use strict';
/**
 * dsh-plugin-screen-ocr（lib/index.js，纯 CommonJS —— PLG-01）
 *
 * 职责：把「框选区域 → 识别文字」这一步交给宿主壳完成，插件自身**不接触屏幕**。
 * 这是环境配置清单第 3 节的关键约束：插件不具备截屏权限，只能通过宿主桥请求。
 *
 * 宿主桥协议（见 项目代码/src/core/host/bridge.js）：
 *   POST http://127.0.0.1:<port>/v1/host/ocr_region
 *   header: x-bridge-token: <bridge.json 中的一次性令牌>
 *   body:   {x, y, width, height}
 *   resp:   {ok:true, text, engine, width, height, ms}
 *
 * 安全：令牌只在内存中使用，不写日志；错误信息不回显令牌与识别原文。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_NAME = 'screen-ocr';
const TIMEOUT_MS = 15000;

/** 依次尝试的 bridge.json 位置（宿主壳启动时写入） */
function bridgeFileCandidates() {
  const out = [];
  if (process.env.TRANSLATOR_HOME) out.push(path.join(process.env.TRANSLATOR_HOME, 'bridge.json'));
  // 开发期：宿主壳以工作区作为数据目录
  out.push(path.join(__dirname, '..', '..', '..', '项目测试', '_runtime', 'home', 'bridge.json'));
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'desktop-translator', 'bridge.json'));
  return out;
}

/** 读取宿主桥连接信息；找不到时返回 null（由调用方给出可读提示） */
function readBridgeInfo() {
  for (const file of bridgeFileCandidates()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.port && raw.token) return { port: raw.port, token: raw.token, file };
    } catch {
      // 未启动或已被清理，继续尝试下一个候选
    }
  }
  return null;
}

async function callHost(endpoint, body, signal) {
  const info = readBridgeInfo();
  if (!info) {
    const e = new Error('桌面翻译助手宿主壳未运行：请先启动助手并打开宿主桥');
    e.code = 'HOST_UNAVAILABLE';
    throw e;
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  // PLG-04：必须响应调用方的取消信号
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
  try { json = JSON.parse(text); } catch { /* 保留原文供诊断，但绝不打印 */ }
  if (!res.ok || !json || json.ok === false) {
    const e = new Error((json && json.error) || `宿主桥返回 HTTP ${res.status}`);
    e.code = (json && json.code) || 'HOST_ERROR';
    throw e;
  }
  return json;
}

const tool = {
  name: 'screen_ocr',
  description: '识别屏幕上指定矩形区域的文字（截图与 OCR 均由桌面翻译助手宿主壳完成，插件不直接接触屏幕）',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: '区域左上角横坐标（屏幕坐标）' },
      y: { type: 'number', description: '区域左上角纵坐标（屏幕坐标）' },
      width: { type: 'number', description: '区域宽度（像素，至少 4）' },
      height: { type: 'number', description: '区域高度（像素，至少 4）' },
    },
    required: ['x', 'y', 'width', 'height'],
  },
  async execute(args, exec) {
    const { x, y, width, height } = args || {};
    const bad = [x, y, width, height].find((v) => typeof v !== 'number' || !Number.isFinite(v));
    if (bad !== undefined) throw new Error('参数 x/y/width/height 必须都是数字');
    if (width < 4 || height < 4) throw new Error('区域过小（宽高至少 4 像素）');

    const r = await callHost('/v1/host/ocr_region', { x, y, width, height }, exec && exec.signal);
    return {
      text: r.text || '',
      engine: r.engine || '',
      ms: r.ms || 0,
      empty: !String(r.text || '').trim(),
    };
  },
};

/**
 * 注册工具。DSH 的插件挂载入口在不同版本里可能叫 registerTool / tools.register / tool，
 * 因此这里做能力探测，并把工具对象一并返回，便于上层自行挂载（不猜测不存在的 API）。
 */
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
    ctx.logger.warn('screen-ocr: 未识别到工具注册接口，已导出工具定义供上层手动挂载');
  }
  return result;
}

module.exports = {
  name: PLUGIN_NAME,
  apply,
  tools: [tool],
  // 供单测/脚本直接调用
  callHost,
  readBridgeInfo,
  bridgeFileCandidates,
};
