'use strict';
/* IIFE-WRAP: 避免与 contextBridge 暴露的不可配置全局 api 冲突 */
(() => {
/**
 * 框选遮罩交互（F-09 / M2-T1 / D2.1）
 *
 * 流程：mousedown 记录起点 → mousemove 实时更新矩形 → mouseup 提交本地坐标（主进程换算为全局坐标）。
 * 取消：Esc 或右键。选区小于 4×4 视为误触，不提交。
 */
const api = window.api;

const MIN_SIZE = 4;
const sel = document.getElementById('sel');
const size = document.getElementById('size');
const hint = document.getElementById('hint');

let start = null;
let current = null;

function rectOf(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function paint(rect) {
  sel.style.left = `${rect.x}px`;
  sel.style.top = `${rect.y}px`;
  sel.style.width = `${rect.width}px`;
  sel.style.height = `${rect.height}px`;
  if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
    size.hidden = false;
    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    const above = rect.y > 30;
    size.style.left = `${Math.max(4, rect.x)}px`;
    size.style.top = above ? `${rect.y - 26}px` : `${rect.y + rect.height + 6}px`;
  } else {
    size.hidden = true;
  }
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  current = { x: e.clientX, y: e.clientY };
  hint.style.opacity = '0';
  paint(rectOf(start, current));
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!start) return;
  current = { x: e.clientX, y: e.clientY };
  paint(rectOf(start, current));
});

window.addEventListener('mouseup', async (e) => {
  if (!start || e.button !== 0) return;
  const rect = rectOf(start, current || start);
  start = null;
  if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
    // 单击/误触：恢复提示，不提交
    hint.style.opacity = '1';
    sel.style.width = '0px';
    sel.style.height = '0px';
    return;
  }
  sel.classList.add('hidden');
  hint.style.opacity = '0';
  try {
    await api.overlay.submit({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  } catch (err) {
    /* 主进程已关闭遮罩时静默失败 */
  }
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.overlay.cancel().catch(() => {});
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    api.overlay.cancel().catch(() => {});
  }
});

// 窗口获得焦点后自动请求键盘焦点，保证 Esc 可用
window.addEventListener('focus', () => {
  document.body.focus();
});

// 光标处先画一个 0 尺寸选区，使整屏变暗（box-shadow 铺满）
paint({ x: 0, y: 0, width: 0, height: 0 });
})();
