'use strict';
/**
 * 热键加速键单元测试（REV-001 G-02 / TRAP-03）
 *
 * 设置页捕获的组合键必须与主进程注册的格式完全一致，否则「用户改了热键但没生效」。
 */
const test = require('node:test');
const assert = require('node:assert');

const A = require('../../项目代码/src/shared/accelerator');

test('normalizeAccelerator 统一修饰键顺序', () => {
  assert.strictEqual(A.normalizeAccelerator('shift+ctrl+t'), 'CommandOrControl+Shift+T');
  assert.strictEqual(A.normalizeAccelerator('Control+Shift+T'), 'CommandOrControl+Shift+T');
  assert.strictEqual(A.normalizeAccelerator('alt+shift+r'), 'Alt+Shift+R');
  assert.strictEqual(A.normalizeAccelerator('cmd+k'), 'Command+K');
});

test('normalizeAccelerator 幂等（重复规范化结果不变）', () => {
  const once = A.normalizeAccelerator('ctrl+shift+t');
  assert.strictEqual(A.normalizeAccelerator(once), once);
});

test('normalizeAccelerator 处理空值与缺少主键', () => {
  assert.strictEqual(A.normalizeAccelerator(''), '');
  assert.strictEqual(A.normalizeAccelerator(null), '');
  assert.strictEqual(A.normalizeAccelerator('ctrl+shift'), '', '只有修饰键应返回空串');
});

test('acceleratorFromEvent 由键盘事件生成组合键', () => {
  const r = A.acceleratorFromEvent({ key: 't', ctrlKey: true, shiftKey: true });
  assert.deepStrictEqual(r, { ok: true, accelerator: 'CommandOrControl+Shift+T' });

  const mac = A.acceleratorFromEvent({ key: 'r', metaKey: true });
  assert.strictEqual(mac.accelerator, 'CommandOrControl+R');
});

test('acceleratorFromEvent 拒绝无修饰键与纯修饰键', () => {
  assert.deepStrictEqual(A.acceleratorFromEvent({ key: 't' }), { ok: false, reason: 'no-modifier' });
  assert.deepStrictEqual(A.acceleratorFromEvent({ key: 'Control', ctrlKey: true }), { ok: false, reason: 'modifier-only' });
  assert.deepStrictEqual(A.acceleratorFromEvent({ key: 'Shift', shiftKey: true }), { ok: false, reason: 'modifier-only' });
});

test('acceleratorFromEvent 映射特殊键', () => {
  assert.strictEqual(A.acceleratorFromEvent({ key: ' ', ctrlKey: true }).accelerator, 'CommandOrControl+Space');
  assert.strictEqual(A.acceleratorFromEvent({ key: 'ArrowUp', altKey: true }).accelerator, 'Alt+Up');
  assert.strictEqual(A.acceleratorFromEvent({ key: 'Escape', ctrlKey: true }).accelerator, 'CommandOrControl+Escape');
});

test('ACTIONS 与标签一一对应（REV-001 要求可自定义，不得硬编码）', () => {
  assert.deepStrictEqual(A.ACTIONS, ['select', 'refresh', 'pause', 'toggleHud', 'collapse']);
  for (const action of A.ACTIONS) {
    assert.ok(typeof A.ACTION_LABELS[action] === 'string' && A.ACTION_LABELS[action].length > 0, action);
  }
  // 暂停必须出现在动作表里：用户要求「不打开设置面板就能停掉当前翻译」
  assert.ok(A.ACTIONS.includes('pause'));
});
