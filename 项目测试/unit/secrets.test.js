'use strict';
/**
 * 密钥模块单元测试（F-08、KEY-03/KEY-04）
 *
 * 覆盖：AES-256-GCM 加解密往返、错盐解密失败、掩码格式、常量时间比较、盐随机性。
 */
const test = require('node:test');
const assert = require('node:assert');

const secrets = require('../../项目代码/src/core/security/secrets');

test('seal/open 往返一致，且密文每次不同（随机 IV）', () => {
  const salt = secrets.newSalt();
  const plaintext = 'sk-live-0123456789abcdef';
  const a = secrets.seal(plaintext, salt);
  const b = secrets.seal(plaintext, salt);
  assert.notStrictEqual(a, b, '同一明文两次加密结果应不同');
  assert.ok(a.startsWith('v1:'), '密文应带 v1 版本前缀');
  assert.strictEqual(secrets.open(a, salt), plaintext);
  assert.strictEqual(secrets.open(b, salt), plaintext);
});

test('换盐无法解密（模拟换机器/配置被复制）', () => {
  const salt = secrets.newSalt();
  const sealed = secrets.seal('sk-secret-value', salt);
  const otherSalt = secrets.newSalt();
  assert.throws(() => secrets.open(sealed, otherSalt));
});

test('密文被篡改时 GCM 校验失败', () => {
  const salt = secrets.newSalt();
  const sealed = secrets.seal('sk-tamper-me', salt);
  const raw = Buffer.from(sealed.slice(3), 'base64');
  raw[raw.length - 1] ^= 0xff;
  const tampered = 'v1:' + raw.toString('base64');
  assert.throws(() => secrets.open(tampered, salt));
});

test('maskKey 形如 sk-****abcd，短串全部掩码', () => {
  assert.strictEqual(secrets.maskKey('sk-0123456789abcd'), 'sk-****abcd');
  assert.strictEqual(secrets.maskKey('short'), '****');
  assert.strictEqual(secrets.maskKey(''), '');
});

test('safeEqual 长度不同或内容不同均为 false', () => {
  assert.strictEqual(secrets.safeEqual('abc', 'abc'), true);
  assert.strictEqual(secrets.safeEqual('abc', 'abd'), false);
  assert.strictEqual(secrets.safeEqual('abc', 'abcd'), false);
  assert.strictEqual(secrets.safeEqual('', ''), true);
});

test('newSalt 每次不同且长度足够', () => {
  const a = secrets.newSalt();
  const b = secrets.newSalt();
  assert.notStrictEqual(a, b);
  assert.ok(Buffer.from(a, 'base64').length >= 16);
});

test('machineId 稳定可读（不抛出）', () => {
  const id = secrets.machineId();
  assert.strictEqual(typeof id, 'string');
  assert.ok(id.length > 0);
  assert.strictEqual(secrets.machineId(), id, '同一进程内多次调用应一致');
});
