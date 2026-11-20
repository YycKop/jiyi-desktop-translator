'use strict';
/**
 * 统一错误类型（core/errors.js）
 *
 * 所有错误对象的 message 均不含凭据、OCR 原文（限制书 LOG-02）。
 */

class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details || null;
    this.userMessage = null;
  }
  /** 面向用户的提示文案（不含敏感信息） */
  toUser() {
    return this.userMessage || this.message;
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

const CODES = {
  CONFIG_INVALID: 'CONFIG_INVALID',
  SECRET_DECRYPT_FAILED: 'SECRET_DECRYPT_FAILED',
  OCR_UNAVAILABLE: 'OCR_UNAVAILABLE',
  OCR_FAILED: 'OCR_FAILED',
  CAPTURE_FAILED: 'CAPTURE_FAILED',
  CAPTURE_UNAVAILABLE: 'CAPTURE_UNAVAILABLE',
  TRANSLATE_ALL_FAILED: 'TRANSLATE_ALL_FAILED',
  TRANSLATE_TIMEOUT: 'TRANSLATE_TIMEOUT',
  API_UNAUTHORIZED: 'API_UNAUTHORIZED',
  API_MODEL_NOT_FOUND: 'API_MODEL_NOT_FOUND',
  LLAMA_NOT_INSTALLED: 'LLAMA_NOT_INSTALLED',
  MODEL_MISSING: 'MODEL_MISSING',
  LLAMA_START_FAILED: 'LLAMA_START_FAILED',
  BRIDGE_UNAUTHORIZED: 'BRIDGE_UNAUTHORIZED',
  HOTKEY_CONFLICT: 'HOTKEY_CONFLICT',
  LOOP_BUSY: 'LOOP_BUSY',
  ABORTED: 'ABORTED',
};

function err(code, message, details) {
  return new AppError(code, message, details);
}

/** 将任意异常归一化为 AppError */
function normalize(e, fallbackCode = 'UNKNOWN') {
  if (e instanceof AppError) return e;
  const msg = e && e.message ? String(e.message) : String(e);
  // 三方库/Node 抛出的错误有时自带 code（如 ECONNREFUSED）——
  // 只有落在本项目 CODES 枚举里的才认，避免把系统错误码当业务码上抛。
  const known = e && typeof e.code === 'string' && Object.values(CODES).includes(e.code);
  const ae = new AppError(known ? e.code : fallbackCode, msg);
  if (e && typeof e.userMessage === 'string') ae.userMessage = e.userMessage;
  return ae;
}

module.exports = { AppError, CODES, err, normalize };
