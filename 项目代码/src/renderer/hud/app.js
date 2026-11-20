'use strict';
/* IIFE-WRAP: 避免与 contextBridge 暴露的不可配置全局 api 冲突 */
(() => {
/**
 * 译文浮窗渲染逻辑（F-12/F-13/F-14/F-16/F-17 + M2-T2/M3-T2/M3-T3/M4-T5）
 *
 * 点击穿透（修正版 3 的 Electron 等价实现）：
 *   主进程默认 setIgnoreMouseEvents(true, {forward:true})，
 *   本脚本在 mousemove 里用 document.elementFromPoint 判断是否悬停 `.interactive`，
 *   命中则请求关闭穿透（可点击），离开则恢复穿透。定时器 120ms 兜底重算最近一次坐标。
 */
const api = window.api;
const Theme = window.TranslatorTheme;

const el = {
  hud: document.getElementById('hud'),
  head: document.getElementById('head'),
  dot: document.getElementById('dot'),
  title: document.getElementById('title'),
  engine: document.getElementById('engine'),
  body: document.getElementById('body'),
  error: document.getElementById('error'),
  placeholder: document.getElementById('placeholder'),
  translation: document.getElementById('translation'),
  sourceWrap: document.getElementById('source-wrap'),
  source: document.getElementById('source'),
  btnSource: document.getElementById('btn-source'),
  history: document.getElementById('history'),
  meta: document.getElementById('meta'),
  status: document.getElementById('status'),
  toasts: document.getElementById('toasts'),
  btnPause: document.getElementById('btn-pause'),
  btnSettings: document.getElementById('btn-settings'),
  btnCopy: document.getElementById('btn-copy'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnCollapse: document.getElementById('btn-collapse'),
  btnClose: document.getElementById('btn-close'),
  grip: document.getElementById('grip'),
  bgLayer: document.getElementById('bg-layer'),
  dock: document.getElementById('dock'),
  dockHandle: document.getElementById('dock-handle'),
  dockCaret: document.getElementById('dock-caret'),
  btnSubSettings: document.getElementById('btn-sub-settings'),
  btnSubCopy: document.getElementById('btn-sub-copy'),
  btnSubPause: document.getElementById('btn-sub-pause'),
  btnSubCollapse: document.getElementById('btn-sub-collapse'),
  btnSubClose: document.getElementById('btn-sub-close'),
  btnSubPauseIcon: document.querySelector('#btn-sub-pause'),
  edgeLeft: document.getElementById('edge-left'),
  edgeRight: document.getElementById('edge-right'),
  edgeBottom: document.getElementById('edge-bottom'),
};

const state = {
  ignoring: true,
  lastPointer: { x: -1, y: -1 },
  sourceVisible: false,
  entries: [],
  current: null,
  showEngine: true,
  loopRunning: false,
  intervalMs: 2000,
  settingsOpen: false,
  autoHeight: true,
  hudMode: 'card',
  appearance: {},
  themeImage: '',
  themeImagePath: '',
};

// ---------------------------------------------------------------- 外观（需求 1）

/** 应用主题色/背景色/不透明度/圆角/模糊/背景图 */
function applyAppearance(raw) {
  if (!Theme) return;
  state.appearance = Theme.normalize(raw);
  Theme.apply(document, state.appearance, { dataUrl: state.themeImage, surface: 'hud' });
  if (el.bgLayer) el.bgLayer.hidden = !state.themeImage;
}

/* ------------------------------------------------------------------ 浮窗模式
 * 第十八轮需求 3：视频 / 游戏模式。
 * 卡片模式是一块半透明面板，铺在游戏上会盖掉一大片画面；字幕模式把它压成
 * 一条细长的透明字幕带——整条底色去掉，只靠文字描边保证可读，正文区域不接收
 * 鼠标（点击直接落到游戏/播放器上），鼠标移到顶部细条才浮出操作按钮。
 */
function applyHudMode(opts = {}) {
  const subtitle = opts.mode === 'subtitle';
  const body = document.body;
  body.classList.toggle('mode-subtitle', subtitle);
  body.classList.toggle('hud-backdrop', subtitle && !!opts.subtitleBackdrop);
  // 自动缩字号用的是内联 font-size，切回卡片模式必须清掉，否则卡片正文会一直停在缩小的字号
  if (!subtitle && el.translation) el.translation.style.fontSize = '';
  const size = Math.min(48, Math.max(12, Number(opts.subtitleFontSize) || 24));
  state.subtitleFontSize = size;
  document.documentElement.style.setProperty('--subtitle-font-size', `${size}px`);
  // 正文区域在字幕模式下不参与命中测试：游戏里的点击/拖拽照常生效
  if (el.body) el.body.classList.toggle('interactive', !subtitle);
  state.hudMode = subtitle ? 'subtitle' : 'card';
  if (typeof opts.autoHeight === 'boolean') state.autoHeight = opts.autoHeight;
  else if (subtitle) state.autoHeight = false;
  // 右侧二合一控制条与左右边缘拖拽只在字幕模式下出现（第十九/二十五轮）
  if (el.dock) {
    el.dock.hidden = !subtitle;
    if (!subtitle) toggleDock(false);
  }
  if (el.edgeLeft) el.edgeLeft.hidden = !subtitle;
  if (el.edgeRight) el.edgeRight.hidden = !subtitle;
  if (el.edgeBottom) el.edgeBottom.hidden = !subtitle;
  renderEngine(state.current);
  scheduleFitSubtitle();
}

/* 第二十一轮需求 3：字幕条是固定高度的细条，长译文按固定字号会被截掉。
 * 这里从配置字号开始逐级缩小，直到整段塞进可显示区域（最小 12px）。
 * 只在字幕模式生效；卡片模式仍按用户设的字号显示，超出就滚动。
 */
let fitRaf = 0;

function scheduleFitSubtitle() {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    fitSubtitleFont();
  });
}

function fitSubtitleFont() {
  if (state.hudMode !== 'subtitle' || !el.translation || !el.body) return;
  const configured = Math.min(48, Math.max(12, Number(state.subtitleFontSize) || 24));
  const text = el.translation.textContent || '';
  el.translation.style.fontSize = `${configured}px`;
  if (!text.trim()) return;
  // 可用高度 = 正文区高度 - 上下内边距（padding 是 14/8，取保守值 22）
  const avail = Math.max(24, el.body.clientHeight - 22);
  const min = 12;
  let size = configured;
  let guard = 0;
  while (size > min && el.translation.scrollHeight > avail && guard < 48) {
    size -= 1;
    el.translation.style.fontSize = `${size}px`;
    guard += 1;
  }
}

window.addEventListener('resize', () => {
  if (state.hudMode === 'subtitle') scheduleFitSubtitle();
});

// 自检入口：等窗口把长文本排完版再量一次，供 smoke 断言「字号确实缩小了」
window.__fitSubtitleFont = () => {
  fitSubtitleFont();
  return {
    mode: state.hudMode,
    fontPx: el.translation ? getComputedStyle(el.translation).fontSize : '',
  };
};

/** 背景图变化时重新读取（只读本地数据目录，主进程编码成 data URL） */async function syncThemeImage(appearance) {
  const path = (appearance && appearance.bgImage) || '';
  if (!path) {
    state.themeImage = '';
    state.themeImagePath = '';
    if (el.bgLayer) el.bgLayer.hidden = true;
    return;
  }
  if (path === state.themeImagePath && state.themeImage) return;
  try {
    const img = await api.theme.getImage('hud');
    if (img && img.dataUrl) {
      state.themeImage = img.dataUrl;
      state.themeImagePath = path;
    }
  } catch { /* 读取失败保持纯色背景 */ }
}

// ---------------------------------------------------------------- 尺寸（需求 3）

let autoHeightTimer = null;

/** 内容变化后请求主进程把窗口高度调整到刚好放得下译文 */
function scheduleAutoHeight() {
  if (!state.autoHeight) return;
  clearTimeout(autoHeightTimer);
  autoHeightTimer = setTimeout(async () => {
    try {
      const foot = document.querySelector('.hud-foot');
      const footH = foot ? foot.offsetHeight : 0;
      // 量「自然高度」：滚动态下 body 的 scrollHeight 会被拉满到窗口高度，
      // 所以临时把它放开成内容高度再读，读不到就退回当前高度。
      const prevBodyFlex = el.body.style.flex;
      const prevBodyMax = el.body.style.maxHeight;
      const prevHudHeight = el.hud.style.height;
      el.body.style.flex = '0 0 auto';
      el.body.style.maxHeight = 'none';
      el.hud.style.height = 'auto';
      const natural = el.body.scrollHeight;
      const headH = el.head.offsetHeight || 0;
      el.body.style.flex = prevBodyFlex;
      el.body.style.maxHeight = prevBodyMax;
      el.hud.style.height = prevHudHeight;

      // 16 = .hud 自身上下内边距，8 = window 与卡片之间的安全余量
      const target = Math.ceil(natural + headH + footH + 16 + 8);
      if (!Number.isFinite(target) || target < 96) return;
      await api.hud.autoHeight(Math.max(96, Math.min(900, target)));
    } catch { /* 高度调整失败不影响展示 */ }
  }, 90);
}

let resizeState = null;

function bindResize() {
  if (!el.grip) return;

  const finish = () => {
    if (!resizeState) return;
    const wasAuto = resizeState.wasAuto;
    try { el.grip.releasePointerCapture(resizeState.pointerId); } catch { /* 已释放 */ }
    resizeState = null;
    api.hud.resize('end', 0, 0).catch(() => {});
    // 手动调过尺寸就把「高度自适应」关掉并落盘，否则下一轮译文又按内容把高度弹回去
    if (wasAuto) api.configPatch({ hud: { autoHeight: false } }).catch(() => {});
  };

  el.grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // 手动调整后不再自动高度，否则下一轮译文又把高度弹回去
    resizeState = { pointerId: e.pointerId, wasAuto: state.autoHeight };
    state.autoHeight = false;
    // 关键：指针捕获。窗口很小，光标快速移出窗口范围后普通 mousemove 会丢，
    // 捕获后 pointermove / pointerup 仍会送到这个元素，拖拽不会中断、松手一定收得到。
    try { el.grip.setPointerCapture(e.pointerId); } catch { /* 老版本忽略 */ }
    api.hud.resize('start', e.screenX, e.screenY, testOpt()).catch(() => {});
  });

  el.grip.addEventListener('pointermove', (e) => {
    if (!resizeState) return;
    // 主进程按光标轮询尺寸（见 src/main/ipc.js），这里只做兜底提示
    api.hud.resize('move', e.screenX, e.screenY, testOpt()).catch(() => {});
  });

  el.grip.addEventListener('pointerup', finish);
  el.grip.addEventListener('pointercancel', finish);
  el.grip.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', finish);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish();
  });
}



// ---------------------------------------------------------------- 提示

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = `toast ${kind || ''}`.trim();
  node.textContent = message;
  el.toasts.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

function setEmptyStatus(text, cls) {
  el.status.textContent = text || '';
  el.status.className = `status ${cls || ''}`.trim();
}

function setDot(cls) {
  el.dot.className = `dot ${cls || ''}`.trim();
}

// ---------------------------------------------------------------- 点击穿透

async function setIgnore(next) {
  if (next === state.ignoring) return;
  state.ignoring = next;
  try {
    await api.hud.setClickThrough(next);
  } catch (e) {
    /* 窗口可能已销毁，忽略 */
  }
}

function hitInteractive(x, y) {
  if (x < 0 || y < 0) return false;
  const target = document.elementFromPoint(x, y);
  if (!target) return false;
  return !!target.closest('.interactive');
}

function evaluatePointer() {
  const { x, y } = state.lastPointer;
  if (x < 0 || y < 0) return;
  const hit = hitInteractive(x, y);
  if (hit) setIgnore(false);
  else setIgnore(true);
}

window.addEventListener('mousemove', (e) => {
  state.lastPointer = { x: e.clientX, y: e.clientY };
  evaluatePointer();
}, { passive: true });

window.addEventListener('mouseleave', () => {
  state.lastPointer = { x: -1, y: -1 };
  setIgnore(true);
});

// 120ms 兜底轮询：穿透态下若 mousemove 丢失（例如光标瞬移），仍能恢复/关闭穿透
setInterval(() => {
  if (state.lastPointer.x < 0) return;
  evaluatePointer();
}, 120);

// ---------------------------------------------------------------- 拖动浮窗

/* 自检专用：`--smoke-test` 下主进程接受 testCursor 作为"假光标"，
 * 否则自检里没有任何办法移动系统鼠标。生产环境主进程忽略该字段。 */
const testOpt = () => (window.__dshTestCursor ? { testCursor: window.__dshTestCursor } : {});

let dragging = null;

function endDrag() {
  if (!dragging) return;
  try { el.head.releasePointerCapture(dragging.pointerId); } catch { /* 已释放 */ }
  dragging = null;
  document.removeEventListener('pointermove', onDragDocMove, true);
  document.removeEventListener('pointerup', endDrag, true);
  document.removeEventListener('pointercancel', endDrag, true);
  api.hud.drag('end', 0, 0).catch(() => {});
}

/* 第二十七轮：同 bindEdgeResize——窗口移动会让 Chromium 隐式释放 pointer capture，
   捕获丢了不能当松手，否则快速拖动时半路就断了。document 级监听兜住后续坐标与松手。 */
const onDragDocMove = (e) => {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  if (e.buttons === 0) { endDrag(); return; }
  api.hud.drag('move', e.screenX, e.screenY, testOpt()).catch(() => {});
};

el.head.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  dragging = { pointerId: e.pointerId };
  // 同 resize：捕获指针，避免快速移动时丢事件、松手后还在拖
  try { el.head.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  document.addEventListener('pointermove', onDragDocMove, true);
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
  api.hud.drag('start', e.screenX, e.screenY, testOpt()).catch(() => {});
  e.preventDefault();
});
el.head.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  api.hud.drag('move', e.screenX, e.screenY, testOpt()).catch(() => {});
});
el.head.addEventListener('pointerup', endDrag);
el.head.addEventListener('pointercancel', endDrag);
el.head.addEventListener('lostpointercapture', () => {
  if (!dragging) return;
  try { el.head.setPointerCapture(dragging.pointerId); } catch { /* 靠 document 级监听 */ }
});
window.addEventListener('blur', endDrag);

// ---------------------------------------------------------------- 渲染

function renderMeta(entry) {
  if (!entry) { el.meta.textContent = ''; return; }
  const parts = [];
  if (entry.latencyMs) parts.push(`${Math.round(entry.latencyMs)}ms`);
  const t = new Date(entry.at || Date.now());
  parts.push(t.toLocaleTimeString('zh-CN', { hour12: false }));
  if (entry.unchanged) parts.push('未变化');
  el.meta.textContent = parts.join(' · ');
}

function renderEngine(entry) {
  if (!state.showEngine || !entry || !entry.engine) {
    el.engine.hidden = true;
    return;
  }
  el.engine.hidden = false;
  el.engine.textContent = `引擎：${entry.engine}`;
  el.engine.className = `badge ${entry.engine === '离线模式' ? 'offline' : ''}`.trim();
}

function renderHistory() {
  const rest = state.entries.slice(1, 6);
  if (!rest.length) {
    el.history.hidden = true;
    el.history.innerHTML = '';
    return;
  }
  el.history.hidden = false;
  el.history.innerHTML = '';
  for (const item of rest) {
    const node = document.createElement('div');
    node.className = 'history-item interactive';
    const time = new Date(item.at || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
    node.textContent = `${time} · ${(item.text || '').replace(/\s+/g, ' ').slice(0, 60)}`;
    node.addEventListener('click', () => {
      state.current = item;
      renderCurrent(item);
      setEmptyStatus(`已回看 ${time}`);
    });
    el.history.appendChild(node);
  }
}

function renderCurrent(entry) {
  el.placeholder.hidden = !!entry;
  el.translation.textContent = entry ? entry.text || '' : '';
  el.error.hidden = !entry || !entry.error;
  if (entry && entry.error) el.error.textContent = entry.error;

  // 第二十五轮需求 4：原文记录默认不展示，只有用户点了左下角「原文」才展开
  const hasSource = !!(entry && entry.source);
  el.sourceWrap.hidden = !(hasSource && state.sourceVisible);
  if (el.btnSource) {
    el.btnSource.hidden = !hasSource;
    el.btnSource.textContent = state.sourceVisible ? '原文 ▾' : '原文 ▸';
    el.btnSource.setAttribute('aria-expanded', state.sourceVisible ? 'true' : 'false');
  }
  if (hasSource) {
    el.source.textContent = entry.source;
    el.source.hidden = false;
  }
  el.title.textContent = entry && entry.error ? '翻译失败' : '译文';
  if (entry && entry.error) setDot('err');
  renderEngine(entry);
  renderMeta(entry);
  renderHistory();
  scheduleAutoHeight();
  scheduleFitSubtitle();
}

function upsert(payload) {
  if (!payload) return;
  if (payload.placeholder) {
    el.placeholder.hidden = false;
    el.placeholder.textContent = payload.placeholder;
    if (!payload.text) {
      el.translation.textContent = '';
      el.error.hidden = true;
      return;
    }
  }
  if (payload.error) {
    const entry = { error: payload.error, at: Date.now(), code: payload.code };
    state.current = entry;
    renderCurrent(entry);
    setEmptyStatus('', '');
    return;
  }
  if (payload.opacity || payload.fontSize || payload.showEngine !== undefined) {
    if (payload.fontSize) el.hud.style.fontSize = `${payload.fontSize}px`;
    if (payload.showEngine !== undefined) state.showEngine = !!payload.showEngine;
  }
  if (payload.appearance) {
    state.autoHeight = payload.autoHeight !== false;
    syncThemeImage(payload.appearance).then(() => applyAppearance(payload.appearance));
  }
  if (payload.hudMode) {
    applyHudMode({
      mode: payload.hudMode,
      subtitleFontSize: payload.subtitleFontSize,
      subtitleBackdrop: payload.subtitleBackdrop,
      autoHeight: payload.autoHeight,
    });
  }
  if (typeof payload.text !== 'string') return;

  const entry = {
    text: payload.text,
    source: payload.source || '',
    engine: payload.engine || '',
    latencyMs: payload.latencyMs || 0,
    unchanged: !!payload.unchanged,
    at: Date.now(),
  };
  state.entries.unshift(entry);
  state.entries = state.entries.slice(0, 20);
  state.current = entry;
  renderCurrent(entry);
  setDot('');
  setEmptyStatus(payload.trigger === 'interval' ? '定时轮询' : '');
  el.body.scrollTop = 0;
}

// ---------------------------------------------------------------- 交互

el.btnCopy.addEventListener('click', async () => {
  const text = state.current && state.current.text;
  if (!text) { toast('暂无可复制的译文', 'warn'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制译文', 'ok');
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('已复制译文', 'ok');
    } catch {
      toast('复制失败', 'err');
    }
  }
});

el.btnRefresh.addEventListener('click', async () => {
  setDot('busy');
  setEmptyStatus('翻译中…');
  try {
    const r = await api.translate.once();
    if (!r || !r.ok) {
      upsert({ error: (r && r.userMessage) || '翻译失败' });
    }
  } catch (e) {
    upsert({ error: e.message || '翻译失败' });
  } finally {
    setTimeout(() => setDot(''), 400);
  }
});

el.btnCollapse.addEventListener('click', () => { api.hud.collapse().catch(() => {}); });
el.btnClose.addEventListener('click', () => { api.hud.hide().catch(() => {}); });

/* ------------------------------------------------------------------ 字幕模式：二合一控制条
 * 第二十五轮需求 2：把手柄与设置区合并到字幕条正中上方。
 *   - 短按手柄 → 向左右两侧展开按钮组（居中定位，所以是往两边长）；
 *   - 按住拖动 → 移动字幕条（与卡片模式共用 HUD_DRAG）。
 * 按钮复用卡片模式的同一批处理函数，避免两套逻辑走散。
 */
const dockButtons = {
  'btn-sub-settings': el.btnSettings,
  'btn-sub-copy': el.btnCopy,
  'btn-sub-pause': el.btnPause,
  'btn-sub-collapse': el.btnCollapse,
  'btn-sub-close': el.btnClose,
};

function toggleDock(force) {
  if (!el.dock) return;
  const next = typeof force === 'boolean' ? force : !el.dock.classList.contains('expanded');
  el.dock.classList.toggle('expanded', next);
  if (el.dockCaret) el.dockCaret.textContent = next ? '▾' : '▴';
  if (el.dockHandle) el.dockHandle.setAttribute('aria-expanded', next ? 'true' : 'false');
}

if (el.dockHandle) {
  // 交互规则：位移 < 3px 视为点击（展开/收起），>= 3px 视为拖动窗口。
  // 用 pointer capture + 主进程轮询驱动的 HUD_DRAG，和卡片标题栏拖动是同一条链路。
  let dragging = false;
  let pressed = false;
  let startX = 0;
  let startY = 0;
  let dockPid = 0;

  el.dockHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pressed = true;
    dragging = false;
    dockPid = e.pointerId;
    startX = e.screenX;
    startY = e.screenY;
    try { el.dockHandle.setPointerCapture(e.pointerId); } catch {}
    document.addEventListener('pointermove', onDockDocMove, true);
    api.hud.drag('start', e.screenX, e.screenY, testOpt());
  });

  el.dockHandle.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    if (!dragging) {
      if (Math.abs(e.screenX - startX) < 3 && Math.abs(e.screenY - startY) < 3) return;
      dragging = true;
      el.dockHandle.classList.add('dragging');
    }
    api.hud.drag('move', e.screenX, e.screenY, testOpt());
  });

  const endDrag = (e) => {
    if (!pressed) return;
    pressed = false;
    try { el.dockHandle.releasePointerCapture(e.pointerId); } catch {}
    document.removeEventListener('pointermove', onDockDocMove, true);
    api.hud.drag('end', e.screenX, e.screenY, testOpt());
    el.dockHandle.classList.remove('dragging');
    if (!dragging) toggleDock();
    dragging = false;
  };
  const onDockDocMove = (e) => {
    if (!pressed || e.pointerId !== dockPid) return;
    if (e.buttons === 0) { endDrag(e); return; }
    if (!dragging) {
      if (Math.abs(e.screenX - startX) < 3 && Math.abs(e.screenY - startY) < 3) return;
      dragging = true;
      el.dockHandle.classList.add('dragging');
    }
    api.hud.drag('move', e.screenX, e.screenY, testOpt());
  };
  el.dockHandle.addEventListener('pointerup', endDrag);
  el.dockHandle.addEventListener('pointercancel', endDrag);
  // 捕获丢失 ≠ 松手：控制条本身是半个拖拽区，快速移动时最容易丢捕获
  el.dockHandle.addEventListener('lostpointercapture', () => {
    if (!pressed) return;
    try { el.dockHandle.setPointerCapture(dockPid); } catch { /* 靠 document 级监听 */ }
  });
}

for (const [id, target] of Object.entries(dockButtons)) {
  const node = document.getElementById(id);
  if (!node || !target) continue;
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDock(false);
    target.click();
  });
}

/* ------------------------------------------------------------------ 字幕模式：拖边缘改尺寸
 * 第十九轮需求 3：字幕条原来只有固定宽度，长句子被截断也没法调。
 * 第二十轮：左右边缘改宽度、底部横条改高度，松手由主进程分别写回
 * hud.subtitleWidth / hud.subtitleHeight。
 */
/* 第二十三轮需求 2：尺寸变了，可拖拽区域要跟着变大。
 * 热区厚度按窗口尺寸的比例算（左右按宽度、底部按高度），并给一个上下限：
 * 太薄点不中，太厚会把整条字幕都变成拖拽柄、正文反而不好选。
 * 第二十四轮：可见拖动条改为「细、淡、短」——热区仍然是厚的好抓，
 * 但视觉提示不能抢正文。 */
function syncEdgeMetrics() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const clamp = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, v)));
  const edgeX = clamp(w * 0.03, 16, 40);
  const edgeY = clamp(h * 0.16, 14, 44);
  // 竖条粗细：3px 足够看见，又不会盖住字
  const bar = 3;
  const edgeLen = clamp(Math.min(w, h) * 0.16, 28, 64);
  const bottomLen = clamp(w * 0.22, 120, 320);
  const gripW = clamp(w * 0.14, 64, 160);
  const gripH = clamp(h * 0.19, 18, 34);
  const root = document.documentElement;
  root.style.setProperty('--edge-x', `${edgeX}px`);
  root.style.setProperty('--edge-y', `${edgeY}px`);
  root.style.setProperty('--edge-bar', `${bar}px`);
  root.style.setProperty('--edge-bar-len', `${edgeLen}px`);
  root.style.setProperty('--bottom-bar-len', `${bottomLen}px`);
  root.style.setProperty('--grip-w', `${gripW}px`);
  root.style.setProperty('--grip-h', `${gripH}px`);
}

function bindEdgeResize(node, edge, axis) {
  if (!node) return;
  let st = null;
  // 自检专用：主进程有没有真光标可控，测试时用 window.__dshTestCursor 指定假光标。
  // 生产环境主进程只认 --smoke-test 下的 testCursor，这个字段不会改变真实行为。
  const testOpt = () => (window.__dshTestCursor ? { testCursor: window.__dshTestCursor } : {});
  const sendMove = (e) => {
    api.hud.resize('move', e.screenX, e.screenY, { axis, edge, ...testOpt() }).catch(() => {});
  };

  /* 第二十七轮：拖动中窗口自己会变形，Chromium 在「指针被捕获的元素跟着变形」时
     可能隐式释放 pointer capture。以前把 lostpointercapture 当松手直接收尾，
     于是鼠标一快、窗口一抖，拖动就断了（用户反馈「移动快点会丢失拖动状态」）。
     现在捕获丢了只当「降级」，改由 document 级监听继续送坐标。 */
  const onDocMove = (e) => {
    if (!st || e.pointerId !== st.pid) return;
    if (e.buttons === 0) { finish(); return; }
    sendMove(e);
  };
  const onDocUp = () => finish();
  const onDocCancel = () => finish();
  const attachDoc = () => {
    document.addEventListener('pointermove', onDocMove, true);
    document.addEventListener('pointerup', onDocUp, true);
    document.addEventListener('pointercancel', onDocCancel, true);
  };
  const detachDoc = () => {
    document.removeEventListener('pointermove', onDocMove, true);
    document.removeEventListener('pointerup', onDocUp, true);
    document.removeEventListener('pointercancel', onDocCancel, true);
  };

  const finish = () => {
    if (!st) return;
    const pid = st.pid;
    st = null;
    detachDoc();
    try { node.releasePointerCapture(pid); } catch { /* 已释放 */ }
    api.hud.resize('end', 0, 0, { axis, edge }).catch(() => {});
  };

  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    st = { pid: e.pointerId };
    try { node.setPointerCapture(e.pointerId); } catch { /* 老版本忽略 */ }
    attachDoc();
    api.hud.resize('start', e.screenX, e.screenY, { axis, edge, ...testOpt() }).catch(() => {});
  });
  node.addEventListener('pointermove', (e) => {
    if (!st) return;
    // 第二十一轮需求 1：捕获仍在、但按键已经松开 —— pointerup 丢了（边缘拖拽时很常见）。
    // 按松手处理，否则就是用户说的「鼠标松开还能继续拖动」。
    if (e.buttons === 0) { finish(); return; }
    sendMove(e);
  });
  // 捕获丢失 ≠ 松手：试着抢回捕获，抢不到就靠 document 级监听继续拖
  node.addEventListener('lostpointercapture', () => {
    if (!st) return;
    try { node.setPointerCapture(st.pid); } catch { /* 回不来了，document 级监听兜底 */ }
  });
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);
  window.addEventListener('blur', finish);
}

bindEdgeResize(el.edgeLeft, 'left', 'x');
bindEdgeResize(el.edgeRight, 'right', 'x');
bindEdgeResize(el.edgeBottom, 'bottom', 'y');
syncEdgeMetrics();
window.addEventListener('resize', syncEdgeMetrics);

/* ------------------------------------------------------------------ 一键暂停
 * 用户反馈：想停掉当前的定时翻译还得打开设置面板，太麻烦。
 * 这里在浮窗上直接给一个开关：⏸ 暂停（同时中止正在进行的这一轮）/ ▶ 继续。
 * Esc 等价于「暂停」，符合「随时按一下就停」的直觉。
 * 状态以主进程为准（loop-started / loop-stopped 事件 + 初始化时读配置）。
 */
function renderPause() {
  if (!el.btnPause) return;
  const label = state.loopRunning
    ? `暂停定时翻译（当前 ${Math.round(state.intervalMs / 1000)} 秒一轮，Esc）`
    : '开始定时翻译（Esc 暂停）';
  // 第二十五轮需求 3：卡片与字幕条共用同一套内联 SVG，状态由 data-state 驱动显隐，
  // 不再一处写字符（⏸/▶）一处写图标，避免"暂停/继续图标风格不统一"。
  const dataState = state.loopRunning ? 'running' : 'paused';
  for (const node of [el.btnPause, el.btnSubPause]) {
    if (!node) continue;
    node.dataset.state = dataState;
    node.title = label;
    node.classList.toggle('active', state.loopRunning);
  }
}

async function toggleLoop() {
  try {
    // 以主进程为准：托盘/热键也可能刚刚切换过，本地 state 可能过期
    try {
      const st = await api.status();
      if (st && st.loop && typeof st.loop.running === 'boolean') {
        state.loopRunning = st.loop.running;
        if (st.loop.intervalMs) state.intervalMs = st.loop.intervalMs;
      }
    } catch { /* 读不到就沿用本地状态 */ }

    if (state.loopRunning) {
      await api.loop.stop();
      state.loopRunning = false;
      setDot('');
      setEmptyStatus('已暂停');
      toast('已暂停定时翻译', 'ok');
    } else {
      const r = await api.loop.start(state.intervalMs);
      state.loopRunning = true;
      if (r && r.intervalMs) state.intervalMs = r.intervalMs;
      setDot('busy');
      setEmptyStatus('定时翻译中…');
      toast(`已开始定时翻译（每 ${Math.round(state.intervalMs / 1000)} 秒）`, 'ok');
    }
  } catch (e) {
    toast(e.message || '切换失败', 'err');
  } finally {
    renderPause();
  }
}

if (el.btnPause) el.btnPause.addEventListener('click', toggleLoop);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!state.loopRunning) return;
    e.preventDefault();
    toggleLoop();
  }
});

// 设置入口：不依赖托盘（F-02 之外的兜底，托盘图标不可见时仍能进入设置）
// 需求 2：已经打开时再点一次就关闭
el.btnSettings.addEventListener('click', async () => {
  try {
    const r = await api.settings.toggle('general');
    setSettingsOpen(!!(r && r.open));
  } catch (e) {
    toast(e.message || '打开设置失败', 'err');
  }
});

function setSettingsOpen(open) {
  state.settingsOpen = !!open;
  if (!el.btnSettings) return;
  el.btnSettings.classList.toggle('active', state.settingsOpen);
  el.btnSettings.title = state.settingsOpen ? '关闭设置（再点一次）' : '打开设置';
}

el.btnSource.addEventListener('click', () => {
  state.sourceVisible = !state.sourceVisible;
  // 展开/收起交给 renderCurrent 统一处理（它同时维护 wrap 显隐、文案与 aria 状态）
  renderCurrent(state.current);
  if (state.autoHeight) scheduleAutoHeight();
  scheduleFitSubtitle();
});

// 主进程推送译文
api.hud.onRender(upsert);

// 全局事件（例如设置变更后刷新显示偏好）
api.onEvent((evt) => {
  if (!evt) return;
  if (evt.type === 'config-changed' && evt.payload) {
    const hud = evt.payload.hud || {};
    if (hud.showEngine !== undefined) state.showEngine = !!hud.showEngine;
    if (hud.fontSize) el.hud.style.fontSize = `${hud.fontSize}px`;
    if (typeof hud.autoHeight === 'boolean') state.autoHeight = hud.autoHeight;
    applyHudMode({
      mode: hud.mode,
      subtitleFontSize: hud.subtitleFontSize,
      subtitleBackdrop: hud.subtitleBackdrop,
      autoHeight: hud.mode === 'subtitle' ? false : hud.autoHeight,
    });
    if (evt.payload.appearance) {
      syncThemeImage(evt.payload.appearance).then(() => applyAppearance(evt.payload.appearance));
    }
    if (state.current) renderEngine(state.current);
    scheduleAutoHeight();
  }
  if (evt.type === 'settings-visibility' && evt.payload) {
    setSettingsOpen(!!evt.payload.visible);
  }
  if (evt.type === 'translation-failed' && evt.payload) {
    upsert({ error: evt.payload.userMessage || '翻译失败', code: evt.payload.code });
  }
  if (evt.type === 'loop-started') {
    state.loopRunning = true;
    if (evt.payload && evt.payload.intervalMs) state.intervalMs = evt.payload.intervalMs;
    renderPause();
  }
  if (evt.type === 'loop-stopped') {
    state.loopRunning = false;
    renderPause();
  }
});

// 初始化：读取显示偏好
(async () => {
  try {
    const cfg = await api.configGet();
    state.showEngine = !!cfg.hud.showEngine;
    state.autoHeight = cfg.hud.autoHeight !== false;
    if (cfg.hud.fontSize) el.hud.style.fontSize = `${cfg.hud.fontSize}px`;
    if (cfg.capture && cfg.capture.intervalMs) state.intervalMs = cfg.capture.intervalMs;
    state.loopRunning = !!(cfg.capture && cfg.capture.mode === 'interval');
    await syncThemeImage(cfg.appearance);
    applyAppearance(cfg.appearance);
    applyHudMode({
      mode: cfg.hud.mode,
      subtitleFontSize: cfg.hud.subtitleFontSize,
      subtitleBackdrop: cfg.hud.subtitleBackdrop,
      autoHeight: cfg.hud.mode === 'subtitle' ? false : cfg.hud.autoHeight !== false,
    });
    bindResize();
    renderPause();
    el.placeholder.textContent = '按快捷键框选区域，或点标题栏 ⚙ 进入设置';
    scheduleAutoHeight();
  } catch { /* 读取失败保持默认 */ }
})();
})();
