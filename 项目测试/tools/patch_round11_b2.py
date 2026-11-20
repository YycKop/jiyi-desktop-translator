"""第十一轮补丁 B2：设置页「输入翻译」面板（HTML + CSS + JS）。

锚点均按真实缩进（侧栏 6 空格、pane 6 空格）校正。
"""
import io
import os
import sys

ROOT = r'D:\桌面翻译助手\项目代码\src\renderer\settings'
HTML = os.path.join(ROOT, 'index.html')
CSS = os.path.join(ROOT, 'settings.css')
JS = os.path.join(ROOT, 'app.js')


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def patch(path, old, new, label):
    t = read(path)
    if old not in t:
        print('MISS:', label)
        sys.exit(2)
    if t.count(old) > 1:
        print('AMBIGUOUS(%d):' % t.count(old), label)
        sys.exit(2)
    write(path, t.replace(old, new))
    print('ok:', label)


# ── HTML ────────────────────────────────────────────────────────────────────
patch(
    HTML,
    '      <button class="tab" data-tab="appearance">外观</button>',
    '      <button class="tab" data-tab="input">输入翻译</button>\n'
    '      <button class="tab" data-tab="appearance">外观</button>',
    'html: sidebar tab',
)

PANE = '''      <!-- 输入翻译：不走截图/OCR，直接把文字交给同一条翻译链路（联网 API → 离线模型） -->
      <section class="pane" id="pane-input">
        <h2>输入翻译</h2>
        <label class="field">
          <span>原文</span>
          <textarea id="input-source" rows="7" placeholder="在这里输入或粘贴要翻译的文字，Ctrl+Enter 立即翻译"></textarea>
          <div class="hint">
            共 <b id="input-count">0</b> 字 · 目标语言 <b id="input-target">中文（简体）</b> ·
            与浮窗共用同一套 API 与离线模型；不截图、不外传
          </div>
        </label>
        <div class="row actions">
          <button id="btn-input-translate" class="btn primary">翻译（Ctrl+Enter）</button>
          <button id="btn-input-clear" class="btn">清空</button>
          <button id="btn-input-copy" class="btn">复制译文</button>
          <span class="hint" id="input-status"></span>
        </div>
        <label class="field">
          <span>译文</span>
          <div id="input-result" class="input-result placeholder">译文会显示在这里</div>
        </label>
        <div class="hint">输入翻译与浮窗共用「目标语言」设置（在「通用」页切换）。</div>
      </section>

'''
patch(
    HTML,
    '      <section class="pane" id="pane-appearance">',
    PANE + '      <section class="pane" id="pane-appearance">',
    'html: input pane',
)

# ── CSS ─────────────────────────────────────────────────────────────────────
CSS_ADD = '''
/* ── 输入翻译面板（第十一轮） ───────────────────────────────── */
#pane-input textarea {
  width: 100%;
  resize: vertical;
  min-height: 120px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--fg);
  font: inherit;
  line-height: 1.6;
}
#pane-input textarea:focus { outline: none; border-color: var(--accent); }
#pane-input .row.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 10px 0 14px;
  flex-wrap: wrap;
}
.input-result {
  min-height: 132px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--fg);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.input-result.placeholder { color: var(--fg-faint); }
'''
t = read(CSS)
write(CSS, t.rstrip() + '\n' + CSS_ADD)
print('ok: css appended')

# ── JS ──────────────────────────────────────────────────────────────────────
patch(
    JS,
    "const TAB_NAMES = ['general', 'appearance', 'apis', 'hotkey', 'offline', 'about'];",
    "const TAB_NAMES = ['general', 'input', 'appearance', 'apis', 'hotkey', 'offline', 'about'];",
    'js: TAB_NAMES',
)

patch(
    JS,
    "  if (tab === 'appearance') applyTheme();",
    "  if (tab === 'appearance') applyTheme();\n"
    "  if (tab === 'input') { renderInputTarget(); setTimeout(() => { const s = $('input-source'); if (s) s.focus(); }, 60); }",
    'js: selectTab hook',
)

INPUT_JS = '''
/* ── 输入翻译（第十一轮） ────────────────────────────────────────────────
 * 不截图、不 OCR，直接把文字交给 engine.translateText：链路与浮窗完全一致
 * （联网 API 主备 → 离线模型降级），配额与降级行为对用户可预期。
 * 语言统一走「通用」页的 targetLang，避免两处各有一套状态。
 */
function renderInputTarget() {
  const t = (state.cfg && state.cfg.general && state.cfg.general.targetLang) || 'zh';
  const node = $('input-target');
  if (node) node.textContent = L ? L.displayName(t) : t;
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

'''
patch(JS, 'function bindEvents() {', INPUT_JS + 'function bindEvents() {', 'js: input helpers')

BIND = '''  // 输入翻译（第十一轮）
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

'''
patch(JS, 'function bindEvents() {\n', 'function bindEvents() {\n' + BIND, 'js: bind input events')

print('patched b2')
