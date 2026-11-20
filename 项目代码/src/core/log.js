'use strict';
/**
 * 脱敏日志（core/log.js）
 *
 * 依据限制书 LOG-01/LOG-02/LOG-03：
 *  - 不记录 OCR 原文全文、译文全文、用户 API Key
 *  - 只记录操作类型与度量（如“OCR 完成，长度 42 字符”）
 *  - 不包含任何远程上报逻辑
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const REDACT_RULES = [
  [/sk-[A-Za-z0-9_\-]{6,}/g, 'sk-****'],
  [/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ****'],
  [/"?(apiKey|api_key|authorization|token|ciphertext|secret)"?\s*[:=]\s*"?[^"\s,}]{4,}"?/gi, '$1=****'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '****'],
];

function redact(input) {
  let s = typeof input === 'string' ? input : String(input);
  for (const [re, rep] of REDACT_RULES) s = s.replace(re, rep);
  return s;
}

/** 文本指纹：用于日志中代替原文，便于比对但不泄露内容（LOG-02） */
function textMeta(text) {
  const s = typeof text === 'string' ? text : '';
  return {
    len: s.length,
    sha8: crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8),
  };
}

class Logger {
  constructor(opts = {}) {
    this.level = LEVELS[opts.level || process.env.TRANSLATOR_LOG_LEVEL || 'info'] || LEVELS.info;
    this.scope = opts.scope || 'app';
    this.ring = opts.ring || [];
    this.ringSize = opts.ringSize || 400;
    this.file = opts.file === null ? null : opts.file || null;
    this.fileMaxBytes = opts.fileMaxBytes || 2 * 1024 * 1024;
    this.sinks = opts.sinks || [];
    this.console = opts.console !== false;
  }

  child(scope) {
    const l = new Logger({
      scope: this.scope + ':' + scope,
      level: Object.keys(LEVELS).find((k) => LEVELS[k] === this.level) || 'info',
      ring: this.ring,
      ringSize: this.ringSize,
      file: this.file,
      fileMaxBytes: this.fileMaxBytes,
      sinks: this.sinks,
      console: this.console,
    });
    return l;
  }

  attachFile(file) {
    this.file = file;
    paths.ensureDir(path.dirname(file));
    return this;
  }

  _emit(level, msg, meta) {
    if (LEVELS[level] < this.level) return;
    const ts = new Date().toISOString();
    const line = {
      ts,
      level,
      scope: this.scope,
      msg: redact(msg),
      ...(meta || {}),
    };
    const text = JSON.stringify(line);

    this.ring.push(line);
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);

    if (this.console) {
      const tag = `[${ts.slice(11, 23)}][${level.toUpperCase()}][${this.scope}]`;
      // 输出到 stdout，Electron 主进程日志可见；不写入任何远程通道（LOG-01）
      // eslint-disable-next-line no-console
      (level === 'error' || level === 'warn' ? console.error : console.log)(`${tag} ${line.msg}`,
        Object.keys(line).length > 4 ? JSON.stringify(Object.fromEntries(
          Object.entries(line).filter(([k]) => !['ts', 'level', 'scope', 'msg'].includes(k)),
        )) : '');
    }
    for (const sink of this.sinks) {
      try { sink(line); } catch { /* 订阅方异常不影响主流程 */ }
    }
    if (this.file) {
      try {
        this._rotateIfNeeded();
        fs.appendFileSync(this.file, text + '\n', 'utf8');
      } catch { /* 磁盘不可写时降级为仅内存日志 */ }
    }
  }

  _rotateIfNeeded() {
    try {
      const st = fs.statSync(this.file);
      if (st.size > this.fileMaxBytes) {
        fs.renameSync(this.file, this.file + '.1');
      }
    } catch { /* 文件不存在则忽略 */ }
  }

  debug(msg, meta) { this._emit('debug', msg, meta); }
  info(msg, meta) { this._emit('info', msg, meta); }
  warn(msg, meta) { this._emit('warn', msg, meta); }
  error(msg, meta) { this._emit('error', msg, meta); }

  recent(n = 100) { return this.ring.slice(-n); }
}

function createLogger(opts = {}) {
  return new Logger(opts);
}

module.exports = { Logger, createLogger, redact, textMeta, LEVELS };
