'use strict';
/**
 * 浮窗位置计算单元测试（F-12 / M2-T2 风险项：多显示器、贴边翻转让位）
 */
const test = require('node:test');
const assert = require('node:assert');

const { computeHudPosition, intersects, GAP } = require('../../项目代码/src/main/position');

const WORK = { x: 0, y: 0, width: 1920, height: 1080 };
const SIZE = { width: 420, height: 240 };

test('intersects 判定矩形相交', () => {
  assert.strictEqual(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), true);
  assert.strictEqual(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), false);
});

test('区域左侧有余量时浮窗放右侧且不遮挡区域', () => {
  const region = { x: 100, y: 100, width: 300, height: 120 };
  const pos = computeHudPosition({ region, size: SIZE, workArea: WORK });
  assert.strictEqual(pos.placement, 'right');
  assert.strictEqual(pos.x, region.x + region.width + GAP);
  assert.strictEqual(pos.y, region.y);
  assert.strictEqual(intersects({ ...pos, ...SIZE }, region), false);
});

test('区域贴近右边缘时翻转到左侧', () => {
  const region = { x: 1750, y: 200, width: 160, height: 100 };
  const pos = computeHudPosition({ region, size: SIZE, workArea: WORK });
  assert.strictEqual(pos.placement, 'left');
  assert.ok(pos.x + SIZE.width <= region.x);
});

test('mode=top 优先放上方', () => {
  const region = { x: 600, y: 500, width: 400, height: 200 };
  const pos = computeHudPosition({ region, size: SIZE, workArea: WORK, mode: 'top' });
  assert.strictEqual(pos.placement, 'above');
  assert.strictEqual(pos.y, region.y - SIZE.height - GAP);
});

test('mode=bottom 优先放下方', () => {
  const region = { x: 600, y: 100, width: 400, height: 200 };
  const pos = computeHudPosition({ region, size: SIZE, workArea: WORK, mode: 'bottom' });
  assert.strictEqual(pos.placement, 'below');
  assert.strictEqual(pos.y, region.y + region.height + GAP);
});

test('四周都放不下时夹取到工作区内', () => {
  // 区域又宽又高：右侧 200+1400+12+420=2032>1920，左侧 200-432<0，
  // 下方 150+700+12+240=1102>1080，上方 150-252<0 → 四个方向都放不下
  const region = { x: 200, y: 150, width: 1400, height: 700 };
  const pos = computeHudPosition({ region, size: SIZE, workArea: WORK });
  assert.strictEqual(pos.placement, 'clamped');
  assert.ok(pos.x >= WORK.x && pos.x + SIZE.width <= WORK.x + WORK.width);
  assert.ok(pos.y >= WORK.y && pos.y + SIZE.height <= WORK.y + WORK.height);
});

test('mode=fixed 使用固定点并夹取到工作区', () => {
  const pos = computeHudPosition({
    region: { x: 10, y: 10, width: 100, height: 50 },
    size: SIZE,
    workArea: WORK,
    mode: 'fixed',
    fixedPoint: { x: 2000, y: -50 },
  });
  assert.strictEqual(pos.placement, 'fixed');
  assert.strictEqual(pos.x, WORK.x + WORK.width - SIZE.width);
  assert.strictEqual(pos.y, WORK.y);
});

test('无框选区域时贴右下角（托盘展开浮窗）', () => {
  const pos = computeHudPosition({ region: null, size: SIZE, workArea: WORK });
  assert.strictEqual(pos.placement, 'corner');
  assert.ok(pos.x > WORK.width / 2 && pos.y > WORK.height / 2);
});

test('多显示器：以区域所在显示器的工作区为准', () => {
  const second = { x: 1920, y: 0, width: 1920, height: 1080 };
  const region = { x: 2000, y: 300, width: 200, height: 100 };
  const pos = computeHudPosition({ region, size: SIZE, workArea: second });
  assert.strictEqual(pos.placement, 'right');
  assert.ok(pos.x >= second.x, '不得落到第一块屏幕上');
});
