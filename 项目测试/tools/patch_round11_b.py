"""第十一轮补丁 B：设置页新增「输入翻译」面板（HTML + CSS + JS）。"""
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


# ── HTML：侧栏按钮 + 面板 ───────────────────────────────────────────────────
patch(
    HTML,
    '        <button class="tab" data-tab="appearance">外观</button>',
    '        <button class="tab" data-tab="input">输入翻译</button>\n'
    '        <button class="tab" data-tab="appearance">外观</button>',
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
            与浮窗共用同一套 API 与离线模型，不截图、不联网上报
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
        <div class="hint">
          输入翻译与浮窗共用「目标语言」设置（见「通用」页）；需要换语言时改那处即可。
        </div>
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
/* ── 输入翻译面板 ───────────────────────────────────────────── */
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
#pane-input .row.actions { display: flex; gap: 8px; align-items: center; margin: 10px 0 14px; flex-wrap: wrap; }
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
    "  if (tab === 'input') { renderInputTarget(); setTimeout(() => el.inputSource && el.inputSource.focus(), 60); }",
    'js: selectTab hook',
)

INPUT_JS = '''
// ── 输入翻译（第十一轮） ────────────────────────────────────────────────────
// 设计：不截图、不 OCR，直接把文字送进 engine.translateText，链路与浮窗完全一致
// （联网 API 主备 → 离线模型降级），因此配额/降级行为对用户是可预期的。
function renderInputTarget() {
  const t = (state.cfg && state.cfg.general && state.cfg.general.targetLang) || 'zh';
  const name = Langs.displayName(t);
  if (el.inputTarget) el.inputTarget.textContent = name;
}

function setInputStatus(text, kind) {
  if (!el.inputStatus) return;
  el.inputStatus.textContent = text || '';
  el.inputStatus.style.color = kind === 'err' ? 'var(--err)' : kind === 'ok' ? 'var(--ok)' : '';
}

function updateInputCount() {
  if (!el.inputCount || !el.inputSource) return;
  el.inputCount.textContent = String(el.inputSource.value.length);
}

async function translateInput() {
  const text = (el.inputSource && el.inputSource.value || '').trim();
  if (!text) { setInputStatus('请先输入要翻译的文字', 'err'); return; }
  const target = (state.cfg && state.cfg.general && state.cfg.general.targetLang) || 'zh';
  setBusy(el.btnInputTranslate, true, '翻译中…');
  setInputStatus('正在翻译…');
  const t0 = Date.now();
  try {
    const r = await api.translate.text({ text, targetLang: target, sourceLang: (state.cfg.general.sourceLang || 'auto') });
    const out = (r && r.text) || '';
    if (el.inputResult) {
      el.inputResult.textContent = out || '（模型没有返回译文）';
      el.inputResult.classList.toggle('placeholder', !out);
    }
    const ms = (r && r.latencyMs) || (Date.now() - t0);
    setInputStatus(`完成 · ${r.engine || '未知引擎'} · ${ms} ms${r.shortcut ? ' · 无需翻译' : ''}`, 'ok');
  } catch (e) {
    setInputStatus(`翻译失败：${e && e.message ? e.message : '未知错误'}`, 'err');
    if (el.inputResult) {
      el.inputResult.textContent = '翻译失败，请检查 API 配置或离线模型';
      el.inputResult.classList.add('placeholder');
    }
  } finally {
    setBusy(el.btnInputTranslate, false);
  }
}

'''
patch(
    JS,
    'function bindEvents() {',
    INPUT_JS + 'function bindEvents() {',
    'js: input helpers',
)

BIND = '''  // 输入翻译
  if (el.inputSource) {
    el.inputSource.addEventListener('input', updateInputCount);
    el.inputSource.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); translateInput(); }
    });
  }
  if (el.btnInputTranslate) el.btnInputTranslate.addEventListener('click', translateInput);
  if (el.btnInputClear) {
    el.btnInputClear.addEventListener('click', () => {
      if (el.inputSource) el.inputSource.value = '';
      if (el.inputResult) { el.inputResult.textContent = '译文会显示在这里'; el.inputResult.classList.add('placeholder'); }
      updateInputCount();
      setInputStatus('');
    });
  }
  if (el.btnInputCopy) {
    el.btnInputCopy.addEventListener('click', async () => {
      const out = (el.inputResult && el.inputResult.textContent || '').trim();
      if (!out) { setInputStatus('还没有译文可复制', 'err'); return; }
      try { await navigator.clipboard.writeText(out); setInputStatus('译文已复制', 'ok'); }
      catch { setInputStatus('复制失败，请手动选中', 'err'); }
    });
  }

'''
patch(JS, 'function bindEvents() {\n', 'function bindEvents() {\n' + BIND, 'js: bind input events')

print('patched b')
