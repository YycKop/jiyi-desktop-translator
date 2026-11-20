'use strict';
/* IIFE-WRAP: 避免与 contextBridge 暴露的不可配置全局 api 冲突 */
(() => {
/**
 * 悬浮球交互（F-16 / D3.3）
 *
 * 单击 → 按「点击图标时打开」的配置打开设置页或译文浮窗；拖动 → 移动悬浮球
 * （位置由主进程持久化到 hud.ballPoint），位移小于 4px 视为点击。
 *
 * 第二十五轮：气泡开合由主进程 `src/main/ball-pointer.js` 按光标位置决定
 * （球窗口平时穿透，收不到 mouseenter），结果通过 `ball:state` 下发。
 *
 * 第二十六轮：气泡改成绕球的圆形小图标。具体坐标不在这里算——
 * 主进程下发 `layout`（球心 + 每个气泡的 left/top），这里只负责落位与动画，
 * 保证「主进程判定命中」（ballClientRect）与「渲染进程画在哪」用的是同一套数字。
 */
const api = window.api;
const ball = document.getElementById('ball');
const wrap = document.getElementById('wrap');
const fan = document.getElementById('fan');
const bubbles = Array.from(document.querySelectorAll('.bubble'));
// 弹出动画的错开序号：不走 HTML 内联 style（CSP 禁止内联样式属性，见 ipc-contract 测试），
// 这里用 CSSOM 写自定义属性，效果一致。
bubbles.forEach((node, i) => node.style.setProperty('--i', String(i)));

const DRAG_THRESHOLD = 4;
const BALL_VISUAL = 40; // 球的 CSS 尺寸（窗口里 44，留 2px 给悬停放大）
let drag = null;
let expanded = false;

function setOpen(open) {
  expanded = !!open;
  wrap.dataset.open = expanded ? 'true' : 'false';
  fan.setAttribute('aria-hidden', expanded ? 'false' : 'true');
}

/** 按主进程下发的布局摆放球与气泡 */
function applyLayout(layout) {
  if (!layout || !Number.isFinite(layout.cx) || !Number.isFinite(layout.cy)) return;
  wrap.dataset.side = layout.side || 'center';
  ball.style.left = `${Math.round(layout.cx - BALL_VISUAL / 2)}px`;
  ball.style.top = `${Math.round(layout.cy - BALL_VISUAL / 2)}px`;
  const list = Array.isArray(layout.bubbles) ? layout.bubbles : [];
  list.forEach((b, i) => {
    const node = bubbles[i];
    if (!node) return;
    node.style.left = `${b.x}px`;
    node.style.top = `${b.y}px`;
  });
}

/** 主进程下发的开合状态（悬停判定、动作执行后收起都走这里） */
api.ball.onState((payload) => {
  if (!payload) return;
  if (payload.layout) applyLayout(payload.layout);
  setOpen(!!payload.expanded);
});

fan.addEventListener('click', (e) => {
  const btn = e.target.closest('.bubble');
  if (!btn) return;
  e.stopPropagation();
  const act = btn.dataset.act;
  setOpen(false);
  api.ball.action(act).catch(() => {});
});

ball.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  drag = { moved: false, startX: e.screenX, startY: e.screenY };
  api.window.drag('start', e.screenX, e.screenY).catch(() => {});
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    const dx = Math.abs(e.screenX - drag.startX);
    const dy = Math.abs(e.screenY - drag.startY);
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
    drag.moved = true;
  }
  api.window.drag('move', e.screenX, e.screenY).catch(() => {});
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  api.window.drag('end', 0, 0).catch(() => {});
  if (!wasDrag) {
    // 单击：按「点击图标时打开」的配置打开设置页或译文浮窗（与托盘左键一致）
    api.ball.primary().catch(() => { api.hud.expand().catch(() => {}); });
  }
});

// 右键：弹出与托盘一致的菜单（设置 / 输入翻译 / 显示浮窗 / 退出）。
// 这条入口不依赖系统通知区域——本机通知区域拒绝新图标时，悬浮球就是唯一的常驻入口。
ball.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.ball.menu().catch(() => {});
});

// 定时轮询时显示脉冲动画，提示"仍在工作"
api.onEvent((evt) => {
  if (!evt) return;
  if (evt.type === 'loop-started') ball.classList.add('busy');
  if (evt.type === 'loop-stopped') ball.classList.remove('busy');
});

// 首帧默认收起（主进程在下一次轮询时按光标位置决定是否展开）
setOpen(false);
})();
