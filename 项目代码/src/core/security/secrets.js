'use strict';
/**
 * 本地加密存储（core/security/secrets.js）
 *
 * 依据 F-08 / KEY-02 / KEY-04 / M4.3：
 *  - 用户 API Key 不以明文落盘
 *  - AES-256-GCM + 机器绑定密钥（scrypt 派生）
 *  - 明文仅在内存中短暂存在，不进入日志与异常消息
 *  - 不使用自实现密码学（RFC 8018 scrypt + AES-GCM 均为 Node 标准库）
 */
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

let cachedMachineId = null;

/**
 * 机器标识：注册表 MachineGuid（只读）为主，hostname+用户名 为兜底。
 * 注意：仅由运行时应用读取，AI 开发过程不读取任何注册表或用户目录内容（FS-02）。
 */
function machineId() {
  if (cachedMachineId) return cachedMachineId;
  let guid = '';
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      });
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{8,})/.exec(out);
      if (m) guid = m[1].trim();
    } catch { /* 无权限或非 Windows 时兜底 */ }
  }
  let user = '';
  try { user = os.userInfo().username; } catch { user = 'unknown'; }
  cachedMachineId = guid ? `guid:${guid}` : `host:${os.hostname()}|user:${user}|plat:${process.platform}`;
  return cachedMachineId;
}

function newSalt() {
  return crypto.randomBytes(16).toString('base64');
}

function deriveKey(saltB64) {
  if (!saltB64) throw new Error('missing salt');
  const salt = Buffer.from(saltB64, 'base64');
  return crypto.scryptSync(`${machineId()}|desktop-translator-v1`, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * 加密：返回 `v1:<base64(iv|tag|ciphertext)>`
 */
function seal(plaintext, saltB64) {
  const key = deriveKey(saltB64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

function open(sealed, saltB64) {
  const s = String(sealed || '');
  if (!s.startsWith('v1:')) throw new Error('unsupported secret format');
  const buf = Buffer.from(s.slice(3), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const key = deriveKey(saltB64);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** 掩码展示（M4-T1 卡片显示 sk-****abcd） */
function maskKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 常量时间比较，用于宿主桥令牌校验 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { machineId, newSalt, deriveKey, seal, open, maskKey, safeEqual };
