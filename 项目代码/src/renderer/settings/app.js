'use strict';
/* IIFE-WRAP: 避免与 contextBridge 暴露的不可配置全局 api 冲突 */
(() => {
/**
 * 设置窗口渲染进程（src/renderer/settings/app.js）
 *
 * 覆盖 M4（API 卡片/排序/测试连接/密钥掩码）、REV-001 G-02（热键自定义）、
 * M3-T4（轮询间隔）、M5-T4（离线模型配置）等设置项。
 * 注意：所有用户可控文本一律通过 textContent 写入，禁止 innerHTML 拼接（防注入）。
 */

const $ = (id) => document.getElementById(id);
const L = window.TranslatorLanguages;
const ACC = window.Accelerator;
const Theme = window.TranslatorTheme;
const api = window.api;

const state = {
  cfg: null,
  presets: [],
  editingId: null,
  keyVisible: false,
  captureAction: null,
  hotkeyStatus: null,
  modelStatus: null,
  themeImage: '',
  themeImagePath: '',
  // 设置页自己的背景图（与浮窗那张分开，留空时沿用浮窗图）
  settingsImage: '',
  settingsImagePath: '',
};

/* ---------------------------------------------------------------- 基础工具 */

function toast(msg, kind = '', ms = 2800) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = String(msg);
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 200ms'; }, ms);
  setTimeout(() => el.remove(), ms + 240);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyText || '请稍候…';
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

function fillLanguages() {
  const all = (L && (L.list ? L.list() : L.LANGUAGES)) || [];
  const target = $('target-lang');
  const source = $('source-lang');
  target.innerHTML = '';
  source.innerHTML = '';
  for (const item of all) {
    if (!item.detectOnly) {
      const o = el('option', null, item.zh + '（' + item.code + '）');
      o.value = item.code;
      target.appendChild(o);
    }
    const s = el('option', null, item.zh + '（' + item.code + '）');
    s.value = item.code;
    source.appendChild(s);
  }
}

/* --------------------------------------------------------------- 配置渲染 */

/** 字幕模式专属字段：只有选了「视频 · 游戏模式」才显示 */
function toggleSubtitleFields() {
  const mode = ($('hud-mode') && $('hud-mode').value) || 'card';
  const hidden = mode !== 'subtitle';
  for (const id of ['fld-subtitle-font', 'fld-subtitle-backdrop', 'fld-subtitle-width', 'fld-subtitle-height']) {
    const node = $(id);
    if (node) node.hidden = hidden;
  }
}

function renderGeneral() {
  const cfg = state.cfg;
  if (!cfg) return;
  $('target-lang').value = cfg.general.targetLang;
  $('source-lang').value = cfg.general.sourceLang;
  $('priority').value = cfg.general.priority === 'offline' ? 'offline' : 'online';
  const hudMode = $('hud-mode');
  if (hudMode) hudMode.value = (cfg.hud && cfg.hud.mode) === 'subtitle' ? 'subtitle' : 'card';
  if ($('hud-subtitle-font')) $('hud-subtitle-font').value = String((cfg.hud && cfg.hud.subtitleFontSize) || 24);
  if ($('hud-subtitle-backdrop')) $('hud-subtitle-backdrop').checked = !!(cfg.hud && cfg.hud.subtitleBackdrop);
  if ($('hud-subtitle-width')) $('hud-subtitle-width').value = String((cfg.hud && cfg.hud.subtitleWidth) || 0);
  if ($('hud-subtitle-height')) $('hud-subtitle-height').value = String((cfg.hud && cfg.hud.subtitleHeight) || 0);
  if ($('ball-enabled')) $('ball-enabled').checked = !(cfg.general && cfg.general.ballEnabled === false);
  toggleSubtitleFields();
  const engineSelect = $('ocr-engine');
  if (engineSelect) engineSelect.value = (cfg.ocr && cfg.ocr.engine) || 'auto';
  const langSelectRender = $('ocr-lang');
  if (langSelectRender) langSelectRender.value = (cfg.ocr && cfg.ocr.lang) || 'auto';
  $('launch-action').value = cfg.general.launchAction === 'hud' ? 'hud' : 'settings';
  $('hud-position').value = cfg.hud.position;
  $('hud-font').value = String(cfg.hud.fontSize);
  $('hud-width').value = String(cfg.hud.width);
  $('hud-height').value = String(cfg.hud.height);
  $('hud-auto-height').checked = cfg.hud.autoHeight !== false;
  $('hud-show-engine').checked = !!cfg.hud.showEngine;
  $('interval').value = String(cfg.capture.intervalMs);
  $('dedupe').checked = !!cfg.general.dedupeEnabled;
  $('dedupe-hint').textContent = '最小重译间隔：' + cfg.general.minRetranslateMs + 'ms（文字未变化时不重复调用接口）';
  $('version').textContent = 'v' + (cfg.version || '1.0.0');
}

function renderAppearance() {
  const cfg = state.cfg;
  if (!cfg) return;
  const a = Theme ? Theme.normalize(cfg.appearance) : (cfg.appearance || {});
  const pct = (v) => Math.round(Number(v) * 100);

  $('theme-accent').value = a.accent;
  $('theme-bg').value = a.background;
  $('theme-accent-hex').textContent = a.accent;
  $('theme-bg-hex').textContent = a.background;
  $('theme-text').value = a.textColor || '#e8ecf3';
  $('theme-text-hex').textContent = a.textColor || '自动';
  $('theme-opacity').value = String(pct(a.opacity));
  $('theme-opacity-val').textContent = pct(a.opacity) + '%';
  $('theme-blur').value = String(a.blur);
  $('theme-blur-val').textContent = a.blur + 'px';
  $('theme-radius').value = String(a.radius);
  $('theme-radius-val').textContent = a.radius + 'px';
  $('hud-image-opacity').value = String(pct(a.bgImageOpacity));
  $('hud-image-opacity-val').textContent = pct(a.bgImageOpacity) + '%';
  $('settings-image-opacity').value = String(pct(a.settingsBgImageOpacity));
  $('settings-image-opacity-val').textContent = pct(a.settingsBgImageOpacity) + '%';
  $('theme-image-fit').value = a.bgImageFit;
  $('hud-image-name').textContent = a.bgImage
    ? '已设置（' + a.bgImage.split(/[\\/]/).pop() + '）'
    : '未设置（浮窗不显示背景图）';
  $('settings-image-name').textContent = a.settingsBgImage
    ? '已设置（' + a.settingsBgImage.split(/[\\/]/).pop() + '）'
    : a.bgImage ? '沿用浮窗那张' : '未设置';

  applyTheme();
}

/** 把外观应用到设置窗口本身 + 预览卡片（需求：设置页与浮窗同一套风格） */
function applyTheme() {
  const cfg = state.cfg;
  if (!cfg || !Theme) return;
  const a = Theme.normalize(cfg.appearance);
  // 设置页用自己那张图；没设就沿用浮窗图（主进程已按此规则回落）
  const palette = Theme.apply(document, a, { dataUrl: state.settingsImage, surface: 'settings' });

  const box = $('hud-preview');
  if (box) {
    box.style.background = palette.hudBg;
    box.style.borderRadius = a.radius + 'px';
    box.style.backdropFilter = a.blur > 0 ? 'blur(' + a.blur + 'px)' : 'none';
    box.style.borderColor = palette.borderStrong;
    box.style.color = palette.fg;
  }
  const bg = $('preview-bg');
  if (bg) {
    // 预览卡片模拟的是浮窗，所以用浮窗那张图与浮窗的不透明度
    const img = Theme.imageStyle(a, state.themeImage, 'hud');
    bg.style.backgroundImage = img.image;
    bg.style.backgroundSize = img.size;
    bg.style.backgroundRepeat = img.repeat;
    bg.style.opacity = String(img.opacity);
    bg.hidden = !state.themeImage;
  }
}

/** 背景图变化时从主进程取 data URL（只读本地文件）。两处各取各的。 */
async function syncThemeImage() {
  const a = (state.cfg && state.cfg.appearance) || {};
  const hudPath = a.bgImage || '';
  const setPath = a.settingsBgImage || '';
  if (!hudPath) {
    state.themeImage = '';
    state.themeImagePath = '';
  } else if (hudPath !== state.themeImagePath || !state.themeImage) {
    try {
      const img = await api.theme.getImage('hud');
      if (img && img.dataUrl) {
        state.themeImage = img.dataUrl;
        state.themeImagePath = hudPath;
      }
    } catch { /* 读取失败就用纯色 */ }
  }

  // 设置页槽位：留空时主进程会回落返回浮窗那张，用 path 判断是否需要重新取
  const effective = setPath || hudPath;
  if (!effective) {
    state.settingsImage = '';
    state.settingsImagePath = '';
    return;
  }
  if (effective === state.settingsImagePath && state.settingsImage) return;
  try {
    const img = await api.theme.getImage('settings');
    if (img && img.dataUrl) {
      state.settingsImage = img.dataUrl;
      state.settingsImagePath = effective;
    }
  } catch { /* 忽略 */ }
}

/** 外观改动立即生效（不写整份 config，避免闪烁） */
async function patchAppearance(partial, opts) {
  await patchConfig({ appearance: partial }, opts);
}

function renderRegion() {  const r = state.cfg && state.cfg.capture ? state.cfg.capture.lastSelection : null;
  const info = $('region-info');
  if (!r) {
    info.textContent = '尚未保存框选区域';
    return;
  }
  info.textContent = '上次框选：' + r.x + ', ' + r.y + '  ' + r.width + '×' + r.height
    + (r.at ? '   ' + new Date(r.at).toLocaleString() : '');
}

function renderApis() {
  const list = (state.cfg && state.cfg.apis) || [];
  const box = $('api-list');
  box.innerHTML = '';
  $('api-empty').hidden = list.length > 0;

  list.forEach((item, index) => {
    const card = el('div', 'api-card' + (item.enabled ? '' : ' disabled'));
    card.dataset.id = item.id;

    // 拖拽手柄（只有手柄可拖，避免按钮误触）
    const handle = el('span', 'handle', '☰');
    handle.title = '拖动排序';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      state.draggingId = item.id;
      card.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', item.id); } catch { /* 旧内核 */ }
      e.dataTransfer.effectAllowed = 'move';
    });
    handle.addEventListener('dragend', () => {
      state.draggingId = null;
      box.querySelectorAll('.api-card').forEach((c) => c.classList.remove('dragging', 'drop-target'));
    });

    card.addEventListener('dragover', (e) => {
      if (!state.draggingId || state.draggingId === item.id) return;
      e.preventDefault();
      card.classList.add('drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drop-target');
      const from = state.draggingId || e.dataTransfer.getData('text/plain');
      if (!from || from === item.id) return;
      const ids = list.map((x) => x.id).filter((id) => id !== from);
      ids.splice(index, 0, from);
      try {
        state.cfg.apis = await api.api.reorder(ids);
        renderApis();
        toast('已保存排序', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    // 主信息
    const meta = el('div', 'meta');
    const nameRow = el('div', 'name');
    nameRow.appendChild(document.createTextNode(item.name));
    if (index === 0 && item.enabled) nameRow.appendChild(el('span', 'badge primary', '主用'));
    else if (index === 1 && item.enabled) nameRow.appendChild(el('span', 'badge', '备用'));
    if (!item.enabled) nameRow.appendChild(el('span', 'badge', '已停用'));
    if (item.lastTest) {
      if (item.lastTest.ok) nameRow.appendChild(el('span', 'badge ok', '可用 ' + (item.lastTest.latencyMs || 0) + 'ms'));
      else nameRow.appendChild(el('span', 'badge err', '异常'));
    }
    const sub = el('div', 'sub', item.model + '  ·  ' + item.baseUrl);
    meta.appendChild(nameRow);
    meta.appendChild(sub);
    if (item.hasKey) {
      const keyLine = el('div', 'sub faint', '密钥：' + (item.keyMasked || '****'));
      meta.appendChild(keyLine);
    } else {
      meta.appendChild(el('div', 'sub faint', '未填写密钥'));
    }

    // 操作区
    const actions = el('div', 'actions');
    const sw = el('label', 'switch');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!item.enabled;
    cb.title = '启用/停用';
    cb.addEventListener('change', async () => {
      try {
        await api.api.update(item.id, { enabled: cb.checked });
        await reloadConfig();
      } catch (err) {
        cb.checked = !cb.checked;
        toast(err.message, 'err');
      }
    });
    sw.appendChild(cb);
    sw.appendChild(document.createElement('i'));

    const btnTest = el('button', null, '测试连接');
    btnTest.addEventListener('click', async () => {
      setBusy(btnTest, true, '测试中…');
      try {
        const r = await api.api.test(item.id);
        if (r.ok) toast('连接成功（延迟 ' + r.latencyMs + ' ms）', 'ok');
        else toast(r.message || '连接失败', 'err', 4200);
      } catch (err) {
        toast(err.message, 'err', 4200);
      } finally {
        setBusy(btnTest, false);
        await reloadConfig();
      }
    });

    const btnEdit = el('button', null, '编辑');
    btnEdit.addEventListener('click', () => openModal(item));

    const btnDel = el('button', 'ghost danger', '删除');
    btnDel.addEventListener('click', async () => {
      if (!window.confirm('确定删除接口「' + item.name + '」？密钥也会一并删除。')) return;
      try {
        await api.api.remove(item.id);
        await reloadConfig();
        toast('已删除', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    actions.appendChild(sw);
    actions.appendChild(btnTest);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    card.appendChild(handle);
    card.appendChild(meta);
    card.appendChild(actions);
    box.appendChild(card);
  });
}

async function renderHotkeys() {
  const box = $('hotkey-list');
  let st = state.hotkeyStatus;
  try {
    st = await api.hotkey.status();
    state.hotkeyStatus = st;
  } catch (err) {
    $('hotkey-status').textContent = '无法获取热键状态：' + err.message;
    return;
  }
  box.innerHTML = '';
  const actions = st.actions || ACC.ACTIONS;
  for (const action of actions) {
    const label = (st.labels && st.labels[action]) || (ACC.ACTION_LABELS && ACC.ACTION_LABELS[action]) || action;
    const accel = (st.registered && st.registered[action]) || '';
    const conflict = st.conflicts && st.conflicts[action];
    const row = el('div', 'hotkey-row' + (conflict ? ' conflict' : ''));

    row.appendChild(el('span', 'label', label));

    const kbd = el('kbd', null, accel || '未设置');
    kbd.dataset.action = action;
    row.appendChild(kbd);

    const reasonText = conflict ? describeConflict(conflict) : '';
    if (reasonText) row.appendChild(el('span', 'reason', reasonText));

    const btn = el('button', null, '修改');
    btn.addEventListener('click', () => startCapture(action, kbd, btn));
    row.appendChild(btn);

    box.appendChild(row);
  }

  const conflicts = Object.keys(st.conflicts || {});
  $('hotkey-status').textContent = conflicts.length
    ? '存在 ' + conflicts.length + ' 个热键冲突项，请重新设置或关闭冲突程序后重试。'
    : '热键注册正常。若在管理员权限运行的游戏中使用无效，请以相同权限启动本应用（REV-001 G-01）。';
}

function describeConflict(c) {
  const reason = c && c.reason;
  const map = {
    occupied: '被其它程序占用',
    'duplicate-in-app': '与应用内其它动作重复',
    'no-modifier': '必须包含 Ctrl/Alt/Shift/Win',
    'modifier-only': '只有修饰键',
    empty: '未设置',
    error: '注册失败',
    'not-configured': '未配置',
    'no-handler': '缺少处理函数',
  };
  return map[reason] || (c && c.message) || '不可用';
}

/* ------------------------------------------------------------ 热键捕获流程 */

function startCapture(action, kbd, btn) {
  if (state.captureAction) return;
  state.captureAction = action;
  kbd.classList.add('capturing');
  kbd.textContent = '请按下组合键…（Esc 取消）';
  setBusy(btn, true, '等待按键');
  api.hotkey.captureStart().catch(() => {});

  const onKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      finishCapture();
      return;
    }
    const r = ACC.acceleratorFromEvent(e);
    if (!r.ok) {
      kbd.textContent = r.reason === 'no-modifier' ? '需要至少一个修饰键…' : '请继续按主键…';
      return;
    }
    finishCapture();
    try {
      const res = await api.hotkey.register(action, r.accelerator);
      if (res && res.ok) toast('已设置为 ' + r.accelerator, 'ok');
      else toast('设置失败：' + describeConflict(res) + '（' + r.accelerator + '）', 'warn', 4200);
    } catch (err) {
      toast(err.message, 'err', 4200);
    }
    await renderHotkeys();
  };

  function finishCapture() {
    window.removeEventListener('keydown', onKey, true);
    kbd.classList.remove('capturing');
    state.captureAction = null;
    setBusy(btn, false);
    api.hotkey.captureStop().catch(() => {});
    renderHotkeys();
  }

  state.finishCapture = finishCapture;
  window.addEventListener('keydown', onKey, true);
}

/* ------------------------------------------------------------- 离线模型区 */

function renderOffline() {
  const cfg = state.cfg;
  const st = state.modelStatus;
  if (!cfg) return;
  $('offline-port').value = String(cfg.offline.port);
  $('offline-threads').value = cfg.offline.threads ? String(cfg.offline.threads) : '';
  $('offline-server').value = cfg.offline.serverPath || '';
  $('offline-autostart').checked = !!cfg.offline.autostart;
  $('offline-idle').value = String(Math.round((Number(cfg.offline.idleStopMs) || 0) / 60000));

  if (!st) {
    $('model-state').textContent = '未知';
    return;
  }
  const badge = $('model-state');
  badge.textContent = st.running
    ? (st.ready ? '运行中（就绪）' : '运行中（加载模型…）')
    : (st.binaryPath ? '已停止' : '缺少 llama-server');
  badge.className = st.running ? 'badge ok' : 'badge warn';
  $('model-binary').textContent = st.binaryPath || '未找到（可手动填写路径）';
  $('model-file').textContent = st.modelPath || '未选择';
  $('model-url').textContent = st.running ? st.baseUrl : 'http://127.0.0.1:' + st.port;
  if (st.lastError) $('model-url').title = st.lastError;
}

async function refreshModelStatus() {
  try {
    state.modelStatus = await api.model.status();
  } catch (err) {
    state.modelStatus = null;
    toast(err.message, 'err');
  }
  renderOffline();
}

/* ------------------------------------------------------------------ 弹窗 */

function openModal(item) {
  state.editingId = item ? item.id : null;
  state.keyVisible = false;
  $('modal-title').textContent = item ? '编辑接口' : '添加接口';
  $('m-name').value = item ? item.name : '';
  $('m-baseurl').value = item ? item.baseUrl : '';
  $('m-model').value = item ? item.model : '';
  $('m-prompt').value = item && item.systemPrompt && item.systemPrompt !== '' ? item.systemPrompt : '';
  $('m-enabled').checked = item ? !!item.enabled : true;
  $('m-key').value = '';
  $('m-key').type = 'password';
  $('m-key').placeholder = item && item.hasKey ? '已保存密钥，留空表示不修改' : 'sk-...';
  $('m-preset').value = '';
  $('modal-msg').textContent = '';
  $('modal-mask').hidden = false;
  setTimeout(() => $('m-name').focus(), 30);
}

function closeModal() {
  $('modal-mask').hidden = true;
  state.editingId = null;
  state.keyVisible = false;
}

async function saveModal() {
  const name = $('m-name').value.trim();
  const baseUrl = $('m-baseurl').value.trim();
  const model = $('m-model').value.trim();
  const apiKey = $('m-key').value;
  const systemPrompt = $('m-prompt').value.trim();
  const enabled = $('m-enabled').checked;

  if (!baseUrl) { $('modal-msg').textContent = '请填写 BaseURL'; return; }
  if (!/^https?:\/\//i.test(baseUrl)) { $('modal-msg').textContent = 'BaseURL 必须以 http:// 或 https:// 开头'; return; }
  if (!model) { $('modal-msg').textContent = '请填写模型名称'; return; }
  if (!state.editingId && !apiKey) { $('modal-msg').textContent = '请填写 API Key'; return; }

  const btn = $('m-save');
  setBusy(btn, true, '保存中…');
  try {
    if (state.editingId) {
      const patch = { name: name || '未命名 API', baseUrl, model, enabled };
      if (systemPrompt) patch.systemPrompt = systemPrompt;
      if (apiKey) patch.apiKey = apiKey;
      await api.api.update(state.editingId, patch);
      closeModal();
      await reloadConfig();
      toast('已保存', 'ok');
    } else {
      const created = await api.api.add({
        name: name || '未命名 API', baseUrl, model, apiKey, enabled,
        systemPrompt: systemPrompt || undefined,
      });
      closeModal();
      await reloadConfig();
      toast('已添加，正在验证连接…', 'ok');
      try {
        const r = await api.api.test(created.id);
        if (r.ok) toast('连接成功（延迟 ' + r.latencyMs + ' ms）', 'ok');
        else toast('已保存，但连接测试失败：' + (r.message || '未知原因'), 'warn', 5000);
        await reloadConfig();
      } catch (err) {
        toast('已保存，连接测试异常：' + err.message, 'warn', 5000);
      }
    }
  } catch (err) {
    $('modal-msg').textContent = err.message;
  } finally {
    setBusy(btn, false);
  }
}

/* -------------------------------------------------------------- 配置读写 */

async function reloadConfig() {
  try {
    state.cfg = await api.configGet();
  } catch (err) {
    toast('读取配置失败：' + err.message, 'err');
    return;
  }
  renderGeneral();
  renderApis();
  renderRegion();
  renderOffline();
  syncThemeImage().then(() => renderAppearance());
}

async function patchConfig(partial, opts) {
  try {
    state.cfg = await api.configPatch(partial);
    renderGeneral();
    renderApis();
    renderRegion();
    renderOffline();
    await syncThemeImage();
    renderAppearance();
    if (!opts || !opts.quiet) toast('已保存', 'ok', 1200);
    return true;
  } catch (err) {
    toast('保存失败：' + err.message, 'err', 3600);
    await reloadConfig();
    return false;
  }
}

/** 拖动滑块时先本地预览（不写盘），松手再落盘 —— 避免每移动 1px 就写一次配置 */
function previewAppearance(partial) {
  if (!state.cfg) return;
  state.cfg.appearance = Object.assign({}, state.cfg.appearance, partial);
  applyTheme();
}

let appearanceTimer = null;
function commitAppearance(partial, delay = 320) {
  previewAppearance(partial);
  clearTimeout(appearanceTimer);
  appearanceTimer = setTimeout(() => patchAppearance(partial, { quiet: true }), delay);
}

let numberTimer = null;
function patchNumberLater(partial, delay = 420) {
  clearTimeout(numberTimer);
  numberTimer = setTimeout(() => patchConfig(partial, { quiet: true }), delay);
}

/* ------------------------------------------------------------------ 绑定 */

const TAB_NAMES = ['general', 'input', 'appearance', 'apis', 'hotkey', 'offline', 'about'];

function selectTab(name) {
  const tab = TAB_NAMES.includes(name) ? name : 'general';
  document.querySelectorAll('.sidebar .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + tab));
  if (tab === 'hotkey') renderHotkeys();
  if (tab === 'offline') refreshModelStatus();
  if (tab === 'appearance') applyTheme();
  if (tab === 'input') { renderInputTarget(); setTimeout(() => { const s = $('input-source'); if (s) s.focus(); }, 60); }
}


/* ── 输入翻译（第十一轮） ────────────────────────────────────────────────
 * 不截图、不 OCR，直接把文字交给 engine.translateText：链路与浮窗完全一致
 * （联网 API 主备 → 离线模型降级），配额与降级行为对用户可预期。
 * 语言统一走「通用」页的 targetLang，避免两处各有一套状态。
 */
function renderInputTarget() {
  const t = (state.cfg && state.cfg.general && state.cfg.general.targetLang) || 'zh';
  const node = $('input-target');
  // 界面用中文名（displayName 返回英文名，方便日志；labelZh 才是给用户看的）
  if (node) node.textContent = L ? (L.labelZh ? L.labelZh(t) : L.displayName(t)) : t;
}

function setInputStatus(text, kind) {
  const node = $('input-status');
  if (!node) return;
  node.textContent = text || '';
  node.style.color = kind === 'err' ? 'var(--err)' : kind === 'ok' ? 'var(--ok)' : '';
}

function updateInputCount() {
  const src = $('input-source');
  const cnt = $('input-count');
  if (src && cnt) cnt.textContent = String(src.value.length);
}

async function translateInput() {
  const src = $('input-source');
  const out = $('input-result');
  const text = ((src && src.value) || '').trim();
  if (!text) {
    setInputStatus('请先输入要翻译的文字', 'err');
    return;
  }
  const g = (state.cfg && state.cfg.general) || {};
  const btn = $('btn-input-translate');
  setBusy(btn, true, '翻译中…');
  setInputStatus('正在翻译…');
  const t0 = Date.now();
  try {
    const r = await api.translate.text({ text: text, targetLang: g.targetLang || 'zh', sourceLang: g.sourceLang || 'auto' });
    const translated = (r && r.text) || '';
    if (out) {
      out.textContent = translated || '（模型没有返回译文）';
      out.classList.toggle('placeholder', !translated);
    }
    const ms = (r && r.latencyMs) != null ? r.latencyMs : (Date.now() - t0);
    setInputStatus('完成 · ' + ((r && r.engine) || '未知引擎') + ' · ' + ms + ' ms' + (r && r.shortcut ? ' · 无需翻译' : ''), 'ok');
  } catch (e) {
    setInputStatus('翻译失败：' + ((e && e.message) || '未知错误'), 'err');
    if (out) {
      out.textContent = '翻译失败，请检查 API 配置或离线模型';
      out.classList.add('placeholder');
    }
  } finally {
    setBusy(btn, false);
  }
}

function bindEvents() {
  // 输入翻译（第十一轮）
  if ($('input-source')) {
    $('input-source').addEventListener('input', updateInputCount);
    $('input-source').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        translateInput();
      }
    });
  }
  if ($('btn-input-translate')) $('btn-input-translate').addEventListener('click', translateInput);
  // 退出程序（第十一轮需求 2：任务栏驻留时的显式出口）
  if ($('btn-quit')) {
    $('btn-quit').addEventListener('click', async () => {
      try { await api.quit(); } catch (e) { toast('退出失败：' + ((e && e.message) || '未知错误'), 'err'); }
    });
  }
  if ($('btn-input-clear')) {
    $('btn-input-clear').addEventListener('click', () => {
      const src = $('input-source');
      const out = $('input-result');
      if (src) src.value = '';
      if (out) { out.textContent = '译文会显示在这里'; out.classList.add('placeholder'); }
      updateInputCount();
      setInputStatus('');
    });
  }
  if ($('btn-input-copy')) {
    $('btn-input-copy').addEventListener('click', async () => {
      const out = $('input-result');
      const text = ((out && out.textContent) || '').trim();
      if (!text) { setInputStatus('还没有译文可复制', 'err'); return; }
      try { await navigator.clipboard.writeText(text); setInputStatus('译文已复制', 'ok'); }
      catch { setInputStatus('复制失败，请手动选中复制', 'err'); }
    });
  }

  // 侧栏切换
  document.querySelectorAll('.sidebar .tab').forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  });

  $('btn-close').addEventListener('click', () => api.settings.close());

  // 通用 / 浮窗
  $('target-lang').addEventListener('change', (e) => patchConfig({ general: { targetLang: e.target.value } }));
  $('source-lang').addEventListener('change', (e) => patchConfig({ general: { sourceLang: e.target.value } }));
  const engineSelect = $('ocr-engine');
  if (engineSelect) {
    engineSelect.addEventListener('change', (e) => patchConfig({ ocr: { engine: e.target.value } }));
  }
  const langSelect = $('ocr-lang');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      const v = e.target.value;
      patchConfig({ ocr: { lang: v } });
      toast(v === 'auto'
        ? '识别语言：自动（中英优先，低分时自动尝试日/韩模型）'
        : `识别语言已固定为 ${{ ch: '中英', japan: '日文', korean: '韩文' }[v] || v}`);
    });
  }
  $('hud-position').addEventListener('change', (e) => patchConfig({ hud: { position: e.target.value } }));
  $('priority').addEventListener('change', (e) => {
    const v = e.target.value === 'offline' ? 'offline' : 'online';
    patchConfig({ general: { priority: v } });
    toast(v === 'offline' ? '已改为离线优先（失败自动走在线 API）' : '已改为在线优先（失败自动走离线模型）');
  });
  const modeSelect = $('hud-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const v = e.target.value === 'subtitle' ? 'subtitle' : 'card';
      toggleSubtitleFields();
      patchConfig({ hud: { mode: v } });
      toast(v === 'subtitle' ? '已切换为视频 · 游戏字幕条' : '已切换为卡片模式', 'ok', 2000);
    });
  }
  const subFont = $('hud-subtitle-font');
  if (subFont) {
    subFont.addEventListener('change', (e) => {
      const v = Math.min(48, Math.max(12, Math.round(Number(e.target.value) || 24)));
      e.target.value = String(v);
      patchConfig({ hud: { subtitleFontSize: v } }, { quiet: true });
    });
  }
  const subBackdrop = $('hud-subtitle-backdrop');
  if (subBackdrop) {
    subBackdrop.addEventListener('change', (e) => patchConfig({ hud: { subtitleBackdrop: e.target.checked } }, { quiet: true }));
  }
  const subWidth = $('hud-subtitle-width');
  if (subWidth) {
    subWidth.addEventListener('change', (e) => {
      const v = Math.min(2400, Math.max(0, Math.round(Number(e.target.value) || 0)));
      e.target.value = String(v);
      patchConfig({ hud: { subtitleWidth: v } }, { quiet: true });
      toast(v ? `字幕宽度已设为 ${v}px` : '字幕宽度已改为自动', 'ok', 1600);
    });
  }
  const subHeight = $('hud-subtitle-height');
  if (subHeight) {
    subHeight.addEventListener('change', (e) => {
      const v = Math.min(400, Math.max(0, Math.round(Number(e.target.value) || 0)));
      e.target.value = String(v);
      patchConfig({ hud: { subtitleHeight: v } }, { quiet: true });
      toast(v ? `字幕高度已设为 ${v}px` : '字幕高度已改为自动', 'ok', 1600);
    });
  }
  const ballEnabled = $('ball-enabled');
  if (ballEnabled) {
    ballEnabled.addEventListener('change', (e) => patchConfig({ general: { ballEnabled: e.target.checked } }, { quiet: true }));
  }
  $('hud-font').addEventListener('change', (e) => {
    const v = Math.min(32, Math.max(10, Number(e.target.value) || 14));
    e.target.value = String(v);
    patchConfig({ hud: { fontSize: v } }, { quiet: true });
  });
  $('hud-width').addEventListener('change', (e) => {
    const v = Math.min(1200, Math.max(280, Math.round(Number(e.target.value) || 460)));
    e.target.value = String(v);
    patchConfig({ hud: { width: v } }, { quiet: true });
    toast('浮窗宽度已更新为 ' + v + 'px', 'ok', 1600);
  });
  $('hud-height').addEventListener('change', (e) => {
    const v = Math.min(900, Math.max(96, Math.round(Number(e.target.value) || 240)));
    e.target.value = String(v);
    patchConfig({ hud: { height: v } }, { quiet: true });
    toast('浮窗高度已更新为 ' + v + 'px', 'ok', 1600);
  });
  $('hud-auto-height').addEventListener('change', (e) => patchConfig({ hud: { autoHeight: e.target.checked } }, { quiet: true }));
  $('hud-show-engine').addEventListener('change', (e) => patchConfig({ hud: { showEngine: e.target.checked } }, { quiet: true }));
  $('interval').addEventListener('change', (e) => patchConfig({ capture: { intervalMs: Number(e.target.value) } }));
  $('launch-action').addEventListener('change', (e) => {
    const hud = e.target.value === 'hud';
    patchConfig({ general: { launchAction: hud ? 'hud' : 'settings' } });
    toast(hud ? '以后点击图标会打开译文浮窗' : '以后点击图标会打开设置页');
  });
  $('dedupe').addEventListener('change', (e) => patchConfig({ general: { dedupeEnabled: e.target.checked } }, { quiet: true }));

  /* ---------------- 外观（需求 1） ---------------- */
  const accent = $('theme-accent');
  const bgColor = $('theme-bg');
  accent.addEventListener('input', (e) => {
    $('theme-accent-hex').textContent = e.target.value;
    previewAppearance({ accent: e.target.value });
  });
  accent.addEventListener('change', (e) => commitAppearance({ accent: e.target.value }, 0));
  bgColor.addEventListener('input', (e) => {
    $('theme-bg-hex').textContent = e.target.value;
    previewAppearance({ background: e.target.value });
  });
  bgColor.addEventListener('change', (e) => commitAppearance({ background: e.target.value }, 0));

  // 字体颜色（空串 = 跟随背景自动对比度）
  const textColor = $('theme-text');
  textColor.addEventListener('input', (e) => {
    $('theme-text-hex').textContent = e.target.value;
    previewAppearance({ textColor: e.target.value });
  });
  textColor.addEventListener('change', (e) => commitAppearance({ textColor: e.target.value }, 0));
  $('btn-theme-text-auto').addEventListener('click', () => {
    commitAppearance({ textColor: '' }, 0);
    toast('字体颜色已改为自动（深底浅字 / 浅底深字）', 'ok', 1800);
  });

  document.querySelectorAll('.preset-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const accentHex = dot.dataset.accent;
      const bgHex = dot.dataset.bg;
      commitAppearance({ accent: accentHex, background: bgHex }, 0);
    });
  });

  const ranges = [
    ['theme-opacity', 'opacity', 100, 'theme-opacity-val', '%'],
    ['theme-blur', 'blur', 1, 'theme-blur-val', 'px'],
    ['theme-radius', 'radius', 1, 'theme-radius-val', 'px'],
    ['hud-image-opacity', 'bgImageOpacity', 100, 'hud-image-opacity-val', '%'],
    ['settings-image-opacity', 'settingsBgImageOpacity', 100, 'settings-image-opacity-val', '%'],
  ];
  for (const [id, key, div, labelId, unit] of ranges) {
    const input = $(id);
    input.addEventListener('input', (e) => {
      const raw = Number(e.target.value);
      const value = div === 100 ? raw / 100 : raw;
      $(labelId).textContent = raw + unit;
      previewAppearance({ [key]: value });
    });
    input.addEventListener('change', (e) => {
      const raw = Number(e.target.value);
      const value = div === 100 ? raw / 100 : raw;
      commitAppearance({ [key]: value }, 0);
    });
  }

  $('theme-image-fit').addEventListener('change', (e) => commitAppearance({ bgImageFit: e.target.value }, 0));

  // 两处背景图各自独立：hud 槽位与 settings 槽位分别选择/清除
  const bindImageSlot = (target, btnId, clearId) => {
    $(btnId).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, '选择中…');
      try {
        const r = await api.theme.pickImage(target);
        if (r && !r.canceled) {
          if (target === 'settings') {
            state.settingsImage = r.dataUrl || '';
            state.settingsImagePath = r.path || '';
          } else {
            state.themeImage = r.dataUrl || '';
            state.themeImagePath = r.path || '';
          }
          await reloadConfig();
          toast(target === 'settings' ? '设置页背景图已应用' : '浮窗背景图已应用', 'ok', 1600);
        }
      } catch (err) {
        toast('设置背景图失败：' + err.message, 'err', 4200);
      } finally {
        setBusy(btn, false);
      }
    });

    $(clearId).addEventListener('click', async () => {
      try {
        await api.theme.clearImage(target);
        if (target === 'settings') {
          state.settingsImage = '';
          state.settingsImagePath = '';
        } else {
          state.themeImage = '';
          state.themeImagePath = '';
        }
        await reloadConfig();
        toast(target === 'settings' ? '已清除设置页背景图' : '已清除浮窗背景图', 'ok', 1600);
      } catch (err) {
        toast('清除失败：' + err.message, 'err', 3600);
      }
    });
  };
  bindImageSlot('hud', 'btn-hud-image', 'btn-hud-image-clear');
  bindImageSlot('settings', 'btn-settings-image', 'btn-settings-image-clear');

  $('btn-run-once').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, '翻译中…');
    try {
      const r = await api.translate.once();
      if (r && r.ok) toast('已获取译文（' + r.engine + '）', 'ok');
      else toast((r && r.userMessage) || '未获得译文', 'warn', 4200);
    } catch (err) {
      toast(err.message, 'err', 4200);
    } finally {
      setBusy(btn, false);
    }
  });

  $('btn-select').addEventListener('click', () => {
    api.overlay.open().catch((err) => toast(err.message, 'err'));
    api.settings.close();
  });

  $('btn-reset-region').addEventListener('click', async () => {
    if (!window.confirm('清除已保存的框选区域？下次翻译需要重新框选。')) return;
    await patchConfig({ capture: { lastSelection: null } }, { quiet: true });
    renderRegion();
    toast('已清除框选区域', 'ok', 1500);
  });

  // API
  $('btn-add-api').addEventListener('click', () => openModal(null));
  $('modal-close').addEventListener('click', closeModal);
  $('m-cancel').addEventListener('click', closeModal);
  $('m-save').addEventListener('click', saveModal);
  $('modal-mask').addEventListener('click', (e) => { if (e.target === $('modal-mask')) closeModal(); });
  $('m-eye').addEventListener('click', () => {
    state.keyVisible = !state.keyVisible;
    $('m-key').type = state.keyVisible ? 'text' : 'password';
  });
  $('m-preset').addEventListener('change', (e) => {
    const p = state.presets.find((x) => x.id === e.target.value);
    if (!p) return;
    if (!$('m-name').value.trim()) $('m-name').value = p.name || '';
    $('m-baseurl').value = p.baseUrl || '';
    $('m-model').value = p.model || '';
  });

  // 离线模型
  $('btn-pick-model').addEventListener('click', async () => {
    try {
      const r = await api.model.pick();
      if (r && r.path) toast('已选择模型：' + r.name, 'ok', 3200);
      await reloadConfig();
      await refreshModelStatus();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  $('btn-start-model').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, '启动中…');
    try {
      state.modelStatus = await api.model.start();
      const st = state.modelStatus;
      if (st && st.running) toast('离线服务已启动', 'ok');
      else toast('启动失败：' + ((st && st.lastError) || '请检查模型与 llama-server 路径'), 'err', 5000);
    } catch (err) {
      toast(err.message, 'err', 5000);
    } finally {
      setBusy(btn, false);
      await refreshModelStatus();
    }
  });
  $('btn-stop-model').addEventListener('click', async () => {
    try {
      state.modelStatus = await api.model.stop();
      toast('离线服务已停止', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
    await refreshModelStatus();
  });
  $('btn-refresh-model').addEventListener('click', refreshModelStatus);
  $('offline-port').addEventListener('change', (e) => {
    const v = Math.min(65535, Math.max(1024, Number(e.target.value) || 8081));
    e.target.value = String(v);
    patchConfig({ offline: { port: v } });
  });
  $('offline-threads').addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    patchConfig({ offline: { threads: raw ? Math.min(64, Math.max(1, Number(raw) || 4)) : null } }, { quiet: true });
  });
  $('offline-server').addEventListener('change', (e) => {
    patchConfig({ offline: { serverPath: e.target.value.trim() } }, { quiet: true });
  });
  $('offline-autostart').addEventListener('change', (e) => {
    patchConfig({ offline: { autostart: e.target.checked } }, { quiet: true });
  });
  // 空闲卸载（第二十二轮性能优化）：界面按分钟填，配置存毫秒，0 = 常驻
  $('offline-idle').addEventListener('change', (e) => {
    const minutes = Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0)));
    e.target.value = String(minutes);
    patchConfig({ offline: { idleStopMs: minutes * 60000 } }, { quiet: true }).then(() => {
      if (minutes === 0) toast('离线模型将一直常驻（约 2 GB 内存）');
      else toast(`离线模型空闲 ${minutes} 分钟后自动释放`);
    }).catch((err) => toast(err.message, 'err'));
  });

  // 关于 / 诊断
  $('btn-open-logs').addEventListener('click', () => api.openLogs().catch((err) => toast(err.message, 'err')));
  $('btn-perf').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, '采样中…');
    try {
      const r = await api.perfSample();
      $('diag-out').textContent = '内存采样：\n' + JSON.stringify(r, null, 2);
    } catch (err) {
      $('diag-out').textContent = '采样失败：' + err.message;
    } finally {
      setBusy(btn, false);
    }
  });
  $('btn-selftest').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, '检测中…');
    try {
      const st = await api.status();
      $('diag-out').textContent = '引擎状态：\n' + JSON.stringify(st, null, 2);
    } catch (err) {
      $('diag-out').textContent = '检测失败：' + err.message;
    } finally {
      setBusy(btn, false);
    }
  });

  // 托盘图标重挂：用户反馈「任务栏 ^ 里看不到图标」。
  // Windows 的 Shell_NotifyIcon(NIM_ADD) 会因任务栏繁忙失败，这里给一个可自证的入口。
  const trayBtn = $('btn-tray-retry');
  if (trayBtn) {
    trayBtn.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, '重挂中…');
      try {
        const st = await api.trayRetry();
        renderTrayState(st);
        toast(st.message || '已重新挂载托盘图标');
      } catch (err) {
        const el = $('tray-state');
        if (el) el.textContent = '托盘图标状态：重挂失败（' + err.message + '）';
      } finally {
        setBusy(btn, false);
      }
    });
  }
  api.trayStatus().then(renderTrayState).catch(() => {
    const el = $('tray-state');
    if (el) el.textContent = '托盘图标状态：无法读取（可点右侧按钮重挂）';
  });
}

function renderTrayState(st) {
  const el = $('tray-state');
  if (!el) return;
  const s = st || {};
  if (!s.created) {
    el.textContent = '托盘图标状态：未创建（程序仍驻留，可用 ⚙ 或再次双击 exe 打开设置）';
    return;
  }
  el.textContent = s.accepted
    ? '托盘图标状态：已挂载（可右键打开菜单）'
    : '托盘图标状态：已创建，但系统未回传位置——若在 ^ 里看不到，请点「重新挂载托盘图标」，或重启资源管理器后再试';
}

/* 主进程事件推送（配置变化 / 热键冲突 / 通知） */
function subscribeEvents() {
  if (!api.onEvent) return;
  api.onEvent((ev) => {
    const type = ev && ev.type;
    const payload = (ev && ev.payload) || {};
    if (type === 'config-changed') {
      state.cfg = payload;
      renderGeneral();
      renderApis();
      renderRegion();
      renderOffline();
      syncThemeImage().then(() => renderAppearance());
    } else if (type === 'hotkey-conflict') {
      toast('有热键未注册成功，请在「热键」页重新设置', 'warn', 4200);
      renderHotkeys();
    } else if (type === 'settings-tab') {
      if (payload && payload.tab) selectTab(payload.tab);
    } else if (type === 'notice') {
      toast(payload.message || '通知', payload.level === 'error' ? 'err' : 'warn', 4200);
    } else if (type === 'selection-changed') {
      renderRegion();
    }
  });
}

/* ------------------------------------------------------------------- 启动 */

async function init() {
  fillLanguages();
  bindEvents();
  subscribeEvents();
  try {
    state.presets = await api.api.presets();
    const sel = $('m-preset');
    for (const p of state.presets) {
      const o = el('option', null, p.name);
      o.value = p.id;
      sel.appendChild(o);
    }
  } catch {
    /* 预设失败不影响主流程 */
  }
  await reloadConfig();
  await refreshModelStatus();

  try {
    const v = await api.versions();
    const box = $('about-versions');
    box.innerHTML = '';
    const rows = [
      ['应用版本', 'v' + v.app],
      ['Electron', v.electron],
      ['Chromium', v.chrome],
      ['Node.js', v.node],
      ['平台', v.platform + ' / ' + v.arch],
    ];
    for (const [k, val] of rows) {
      const row = el('div', 'row');
      row.appendChild(el('span', 'muted', k));
      row.appendChild(el('span', 'spacer'));
      row.appendChild(el('span', 'mono', val));
      box.appendChild(row);
    }
  } catch { /* 忽略 */ }

  // 主进程通过 loadFile(..., {hash}) 指定初始页签
  const initialTab = String(location.hash || '').replace(/^#/, '');
  if (initialTab) selectTab(initialTab);
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', () => {
  if (state.captureAction && state.finishCapture) state.finishCapture();
});
})();
