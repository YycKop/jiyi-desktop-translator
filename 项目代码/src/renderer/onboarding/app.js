'use strict';
/* IIFE-WRAP: 避免与 contextBridge 暴露的不可配置全局 api 冲突 */
(() => {
/**
 * 首次启动引导（src/renderer/onboarding/app.js，M5-T4）
 *
 * 步骤：目标语言 → 离线模型（可选）→ 联网 API（可选）→ 完成。
 * 任何一步都可以跳过；完成后写 onboarded=true，下次启动不再弹出。
 */

const $ = (id) => document.getElementById(id);
const api = window.api;
const L = window.TranslatorLanguages;

const state = { step: 1, total: 4, modelPicked: false, apiCount: 0 };

function setStep(n) {
  state.step = Math.min(state.total, Math.max(1, n));
  document.querySelectorAll('.step').forEach((s) => {
    s.classList.toggle('active', Number(s.dataset.step) === state.step);
  });
  document.querySelectorAll('#dots .dot').forEach((d, i) => {
    d.classList.toggle('active', i === state.step - 1);
  });
  $('btn-back').style.visibility = state.step === 1 ? 'hidden' : 'visible';
  $('btn-next').textContent = state.step === state.total ? '开始使用' : '下一步';
  if (state.step === 2) refreshModel();
  if (state.step === 3) refreshApiSummary();
}

async function refreshModel() {
  try {
    const st = await api.model.status();
    $('binary-state').textContent = st.binaryPath || '未找到（安装包内应包含 runtime\\llama）';
    $('model-state').textContent = st.modelPath || '未选择';
    if (st.running) $('model-hint').textContent = '离线服务已在运行，可直接使用离线翻译。';
  } catch (err) {
    $('binary-state').textContent = '检测失败';
    $('model-hint').textContent = err.message;
  }
}

async function refreshApiSummary() {
  try {
    const list = await api.api.list();
    state.apiCount = list.length;
    if (!list.length) {
      $('api-summary').textContent = '尚未配置接口';
      return;
    }
    const names = list.map((a) => a.name + (a.enabled ? '' : '（停用）')).join(' → ');
    $('api-summary').textContent = '已配置 ' + list.length + ' 个接口：' + names;
  } catch (err) {
    $('api-summary').textContent = '读取失败：' + err.message;
  }
}

async function finish() {
  try {
    await api.configPatch({ onboarded: true });
  } catch {
    /* 即使失败也关闭窗口，避免卡在引导页 */
  }
  api.settings.close();
}

function bind() {
  $('btn-close').addEventListener('click', finish);
  $('btn-back').addEventListener('click', () => setStep(state.step - 1));
  $('btn-next').addEventListener('click', () => {
    if (state.step === state.total) finish();
    else setStep(state.step + 1);
  });

  $('target-lang').addEventListener('change', async (e) => {
    try {
      await api.configPatch({ general: { targetLang: e.target.value } });
    } catch (err) {
      $('model-hint').textContent = '保存失败：' + err.message;
    }
  });

  $('btn-pick-model').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.model.pick();
      if (r && r.path) {
        state.modelPicked = true;
        $('model-hint').textContent = '已选择：' + r.path + '。稍后可在设置中启动离线服务。';
        await refreshModel();
        setStep(3);
      }
    } catch (err) {
      $('model-hint').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-skip-model').addEventListener('click', () => setStep(3));
  $('btn-open-api').addEventListener('click', () => {
    api.settings.open('apis').catch(() => {});
  });
  $('btn-skip-api').addEventListener('click', () => setStep(4));
}

async function init() {
  const langs = (L && (L.list ? L.list() : L.LANGUAGES)) || [];
  const sel = $('target-lang');
  for (const item of langs) {
    if (item.detectOnly) continue;
    const o = document.createElement('option');
    o.value = item.code;
    o.textContent = item.zh + '（' + item.code + '）';
    sel.appendChild(o);
  }
  try {
    const cfg = await api.configGet();
    sel.value = cfg.general.targetLang || 'zh';
    if (cfg.hotkeys && cfg.hotkeys.select) $('hk-select').textContent = cfg.hotkeys.select;
  } catch {
    sel.value = 'zh';
  }
  bind();
  setStep(1);
}

window.addEventListener('DOMContentLoaded', init);
})();
