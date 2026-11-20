'use strict';
/**
 * Mock OCR 引擎（core/ocr/mock.js）
 *
 * 仅用于单元/集成测试与开发环境（无真实屏幕时）。测试通过 setProvider 注入
 * 合成文本，绝不采集真实桌面内容（SCR-02）。
 */
let provider = () => 'Hello world';
let lastInput = null;

function setProvider(fn) {
  provider = typeof fn === 'function' ? fn : () => String(fn || '');
}

function getLastInput() {
  return lastInput;
}

async function recognize(opts = {}) {
  lastInput = { bytes: opts.buffer ? opts.buffer.length : 0, langs: opts.langs || null };
  const text = String(await provider(opts) || '');
  return {
    text,
    lines: text ? text.split('\n').map((t) => ({ text: t, words: [] })) : [],
    lang: 'mock',
    engine: 'mock',
    ms: 0,
  };
}

async function probe() {
  return { ok: true, engine: 'mock', reason: 'test provider' };
}

function reset() {
  provider = () => 'Hello world';
  lastInput = null;
}

module.exports = { recognize, probe, setProvider, getLastInput, reset };
