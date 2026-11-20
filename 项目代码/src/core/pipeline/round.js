'use strict';
/**
 * 单轮翻译流水线（core/pipeline/round.js）
 *
 * 一次完整的「截图 → OCR → 翻译」往返，M1-T6 / M2-T3 / M3-T1 共用。
 * 所有错误都归一化为 {ok:false, code, userMessage}，不向上抛原始异常（避免把
 * 内部细节/密钥暴露给渲染进程）。
 */
const crypto = require('crypto');

const { err, CODES, normalize } = require('../errors');
const { normalizeSourceText } = require('../translate/prompt');
const { translate, LOCAL_NOT_READY_MSG } = require('../translate/chain');
const { isSameLanguage } = require('../translate/languages');
const { isSameContent, cacheKey } = require('../translate/fingerprint');
const { looksLikeChinese, looksLikeEnglish } = require('../translate/textlang');
const { toTraditional } = require('../translate/traditional');
const { textMeta } = require('../log');

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_MAX = 50;

function noRegionError() {
  const e = err(CODES.CONFIG_INVALID, '尚未框选翻译区域');
  e.userMessage = '请先按快捷键框选要翻译的区域';
  return e;
}

function hashText(t) {
  return crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 每轮「是否算同一场景」的判定键：区域 + 语言 + 优先级 + 识别语言。
 * 这些变了就必须重新识别/翻译，即使画面一像素没动（例如用户改了目标语言）。
 */
function frameKey(config, region) {
  if (!region) return '';
  const g = config.general || {};
  const o = config.ocr || {};
  return [
    region.x, region.y, region.width, region.height,
    g.sourceLang, g.targetLang, g.priority,
    o.engine, o.lang,
  ].join('|');
}

/**
 * @param {object} deps  {store, capture, ocr, llama, logger}
 * @param {object} state 跨轮状态 {lastSourceHash, lastSource, lastTranslation, frame}
 * @param {object} opts  {signal, regionOverride, force(bool), trigger}
 *
 * 第二十二轮性能优化：在外面套一层「帧指纹预检」。
 * 之前同一画面每轮都要整屏回读 + OCR（约 200ms CPU），画面停住时纯属浪费；
 * 而且翻译失败时（例如没配 API）上一版逻辑根本不触发跳过，会一直空转。
 * 现在无论成功失败都按「帧哈希 + 场景键」缓存整轮结果，画面没动就直接返回。
 */
async function executeRound(deps, state, opts = {}) {
  const { store, capture } = deps;
  const config = store.raw();
  const region = opts.regionOverride || config.capture.lastSelection;
  const key = frameKey(config, region);
  const t0 = Date.now();

  if (opts.force || !region || !capture.peekRegion) {
    return executeRoundOnce(deps, state, opts);
  }

  const tPeek = Date.now();
  let peek = null;
  try {
    peek = await capture.peekRegion(region, { signal: opts.signal });
  } catch {
    peek = null;
  }
  const peekMs = Date.now() - tPeek;

  if (peek && state.frame && state.frame.key === key && state.frame.result && state.frame.sig) {
    const same = capture.sameFrame
      ? capture.sameFrame(state.frame.sig, peek.sig)
      : Buffer.compare(state.frame.sig, peek.sig) === 0;
    if (same) {
      if (deps.logger) deps.logger.debug('画面未变化，跳过截图与 OCR', { trigger: opts.trigger, peekMs });
      return {
        ...state.frame.result,
        unchanged: true,
        skipped: 'frame',
        timings: { peekMs, totalMs: Date.now() - t0 },
      };
    }
  }

  const result = await executeRoundOnce(deps, state, opts);
  if (peek) {
    state.frame = { key, sig: peek.sig, result };
  }
  return { ...result, timings: { ...(result.timings || {}), peekMs } };
}

async function executeRoundOnce(deps, state, opts = {}) {
  const {
    store, capture, ocr, llama, logger, translateFn,
  } = deps;
  const { signal, regionOverride, force = false, trigger = 'manual' } = opts;
  const config = store.raw();
  const t0 = Date.now();
  const timings = {};

  const region = regionOverride || config.capture.lastSelection;
  if (!region) return { ok: false, code: CODES.CONFIG_INVALID, userMessage: noRegionError().userMessage, trigger };

  if (signal && signal.aborted) {
    return { ok: false, code: CODES.ABORTED, userMessage: '已取消', trigger };
  }

  try {
    // 1) 截图（SCR-01：仅框选区域）
    const tCap = Date.now();
    const shot = await capture.captureRegion(region, { signal });
    timings.captureMs = Date.now() - tCap;

    // 2) OCR
    const tOcr = Date.now();
    const ocrRes = await ocr.recognize({ buffer: shot.buffer, signal });
    timings.ocrMs = Date.now() - tOcr;
    const sourceText = normalizeSourceText(ocrRes.text);

    if (!sourceText) {
      logger.debug('OCR 未识别到文字', { region, ocrMs: timings.ocrMs });
      return {
        ok: false,
        code: 'NO_TEXT',
        userMessage: '区域内未识别到文字',
        region,
        trigger,
        timings,
      };
    }

    const srcMeta = textMeta(sourceText);
    logger.info('OCR 完成', {
      engine: ocrRes.engine,
      chars: srcMeta.len,
      sha8: srcMeta.sha8,
      ocrMs: timings.ocrMs,
      trigger,
    });

    // 3) 去重：OCR 会把同一段文字识别出细微差异（i/l、O/0、少个标点），
    //    因此用「归一化指纹 + 相似度」而不是精确哈希判断是否为同一段内容，
    //    否则定时轮询会对同一段文字反复调用付费 API（用户反馈的问题 4）。
    const srcHash = hashText(sourceText);
    const dedupe = config.general.dedupeEnabled && !force;
    // 目标/源语言也是「同一段内容」的一部分：用户把目标语言从中文改成英文时，
    // 文本没变但期望的译文完全变了，若仍复用上一轮就会「翻译不出来」。
    const langKey = `${config.general.sourceLang}>${config.general.targetLang}`;
    const lastLangKey = state.lastLangKey;
    const langChanged = !!lastLangKey && lastLangKey !== langKey;
    if (dedupe && state.lastSource && state.lastTranslation && !langChanged) {
      const cmp = isSameContent(state.lastSource, sourceText, {
        threshold: Number(config.general.dedupeSimilarity) || 0.98,
      });
      if (cmp.same) {
        logger.debug('文本未变化，复用上一轮译文', {
          chars: srcMeta.len,
          similarity: Number(cmp.similarity.toFixed(4)),
        });
        return {
          ok: true,
          ...state.lastTranslation,
          region,
          trigger,
          unchanged: true,
          timings: { ...timings, totalMs: Date.now() - t0 },
        };
      }
    }

    // 3b) 译文缓存：来回滚动/切换回同一段文字时不再请求接口（10 分钟、最多 50 条）
    const ck = cacheKey(config.general.targetLang, sourceText);
    const ttl = Number(config.general.cacheTtlMs) || DEFAULT_CACHE_TTL_MS;
    if (!state.cache) state.cache = new Map();
    if (!force) {
      const hit = state.cache.get(ck);
      if (hit && Date.now() - hit.at < ttl) {
        logger.debug('译文缓存命中', { chars: srcMeta.len, ageMs: Date.now() - hit.at });
        state.lastTranslation = hit.payload;
        state.lastSource = sourceText;
        state.lastLangKey = langKey;
        state.lastSourceHash = srcHash;
        state.lastTranslateAt = Date.now();
        return {
          ok: true,
          ...hit.payload,
          region,
          trigger,
          cached: true,
          timings: { ...timings, translateMs: 0, totalMs: Date.now() - t0 },
        };
      }
      if (hit) state.cache.delete(ck);
    }

    // 4) 源/目标语言相同则无需调用模型
    if (isSameLanguage(config.general.sourceLang, config.general.targetLang)
      && config.general.sourceLang !== 'auto') {
      const same = {
        text: sourceText,
        engine: '无需翻译',
        apiId: null,
        latencyMs: 0,
        attempts: [],
      };
      state.lastTranslation = same;
      state.lastSource = sourceText;
      state.lastLangKey = langKey;
      state.lastSourceHash = srcHash;
      state.lastTranslateAt = Date.now();
      return {
        ok: true,
        sourceText,
        translatedText: same.text,
        engine: same.engine,
        region,
        trigger,
        timings: { ...timings, translateMs: 0, totalMs: Date.now() - t0 },
      };
    }

    // 4b) 原文本来就是目标语言（或只需繁简转换）时，不必调用模型：
    //     实测「中文→中文」会被小模型翻成英文，「中文→繁体」又要白等约 2.7 秒，
    //     而繁简转换本身是确定性的，可以瞬时完成且不花钱。
    const shortcut = detectShortcut(sourceText, config.general.targetLang);
    if (shortcut) {
      const payload = {
        text: shortcut.text,
        engine: shortcut.engine,
        apiId: null,
        latencyMs: 0,
        attempts: [],
      };
      state.lastTranslation = payload;
      state.lastSource = sourceText;
      state.lastLangKey = langKey;
      state.lastSourceHash = srcHash;
      state.lastTranslateAt = Date.now();
      logger.info('原文已是目标语言，跳过翻译', { engine: shortcut.engine, chars: srcMeta.len });
      return {
        ok: true,
        sourceText,
        translatedText: payload.text,
        engine: payload.engine,
        region,
        trigger,
        shortcut: true,
        timings: { ...timings, translateMs: 0, totalMs: Date.now() - t0 },
      };
    }

    // 5) 组装联网候选（明文密钥只在本次调用内存在，KEY-04）
    const candidates = [];
    for (const api of store.getEnabledApisOrdered()) {
      try {
        candidates.push({ ...api, apiKey: store.getApiSecret(api.id) });
      } catch (e) {
        logger.warn('跳过解密失败的 API', { apiId: api.id });
      }
    }

    // 没有可用的联网 API，或用户选了「离线优先」时，先把离线模型拉起来并等就绪
    // （首次启动要加载 1 GB 模型，否则第一次框选会看到"模型未安装"）
    const preferOffline = config.general.priority === 'offline';
    if ((!candidates.length || preferOffline) && typeof deps.ensureOfflineReady === 'function') {
      try {
        await deps.ensureOfflineReady();
      } catch (e) {
        logger.warn('离线模型启动失败', { code: e && e.code });
      }
    }

    const offlineAvailable = await isOfflineAvailable(deps);
    const tTr = Date.now();
    const runner = translateFn || translate;
    const res = await runner({
      text: sourceText,
      targetLang: config.general.targetLang,
      sourceLang: config.general.sourceLang,
      apis: candidates,
      network: config.network,
      offline: config.offline,
      offlineAvailable,
      priority: preferOffline ? 'offline' : 'online',
      signal,
      onAttempt: (info) => logger.debug('翻译通道尝试', info),
    });
    timings.translateMs = Date.now() - tTr;

    const payload = {
      sourceText,
      translatedText: res.text,
      engine: res.engine,
      apiId: res.apiId || null,
      latencyMs: res.latencyMs,
      attempts: (res.attempts || []).map((a) => ({ name: a.name, ok: a.ok, ms: a.ms, code: a.code || null })),
    };
    state.lastTranslation = payload;
    state.lastSource = sourceText;
    state.lastLangKey = langKey;
    state.lastSourceHash = srcHash;
    state.lastTranslateAt = Date.now();

    // 写入译文缓存（超量时淘汰最旧一条）
    state.cache.set(ck, { at: Date.now(), payload });
    while (state.cache.size > DEFAULT_CACHE_MAX) {
      const oldest = state.cache.keys().next().value;
      state.cache.delete(oldest);
    }

    const totalMs = Date.now() - t0;
    timings.totalMs = totalMs;
    logger.info('翻译完成', {
      engine: payload.engine === '离线模式' ? 'offline' : 'api',
      charsIn: srcMeta.len,
      charsOut: payload.translatedText.length,
      totalMs,
      ...timings,
    });

    return { ok: true, ...payload, region, trigger, timings };
  } catch (e) {
    const ae = normalize(e, CODES.TRANSLATE_ALL_FAILED);
    if (ae.code === CODES.ABORTED) {
      return { ok: false, code: CODES.ABORTED, userMessage: '已取消', trigger };
    }
    // 记下原始错误摘要（不含识别文本，LOG-02），否则用户只看到「引擎不可用」无法反馈线索
    logger.warn('单轮翻译失败', {
      code: ae.code,
      ms: Date.now() - t0,
      reason: String((ae && ae.message) || '').slice(0, 200),
    });
    const offlineInstalled = await isOfflineAvailable(deps, { quick: true });
    // 模型文件在、但服务没起来（首次加载失败/被占用），给一句更准确的提示
    const modelPresent = typeof deps.llama?.resolveModel === 'function' && !!deps.llama.resolveModel();
    const notReadyMsg = modelPresent
      ? '离线模型未能启动，请稍后重试或打开设置页「离线模型」查看原因'
      : LOCAL_NOT_READY_MSG;
    return {
      ok: false,
      code: ae.code,
      userMessage: ae.userMessage
        || (ae.code === CODES.OCR_UNAVAILABLE ? 'OCR 引擎不可用，请检查系统 OCR 语言包'
          : ae.code === CODES.CAPTURE_FAILED ? '截图失败，请确认框选区域有效'
            : ae.code === CODES.SECRET_DECRYPT_FAILED ? 'API Key 解密失败，请重新填写密钥'
              : !offlineInstalled && ae.code === CODES.TRANSLATE_ALL_FAILED ? notReadyMsg
                : ae.message),
      region,
      trigger,
      timings,
    };
  }
}

/**
 * 离线通道是否可用：只有 llama-server 进程在跑且（非 quick 时）健康检查通过才算可用。
 * 未安装模型/未启动服务时返回 false，链路上层据此给出「离线模型未安装…」提示（M5-T4）。
 */
async function isOfflineAvailable(deps, opts = {}) {
  const { llama } = deps;
  if (!llama || typeof llama.status !== 'function') return false;
  const st = llama.status();
  if (!st.running) return false;
  if (opts.quick) return true;
  const h = await llama.health(1200);
  return !!h.ok;
}

/**
 * 判断「原文已经是目标语言，不需要调用模型」。
 *
 * 只处理两个高频且结果确定的情况（其余交给模型，避免猜错）：
 *   1. 目标是中文（简体/繁体）而原文本来就是中文 → 简体直接返回；繁体走字符转换
 *   2. 目标是英文而原文本来就是英文 → 直接返回
 *
 * @returns {null | {text:string, engine:string}}
 */
function detectShortcut(text, targetLang) {
  const t = String(targetLang || '').trim().toLowerCase().replace('_', '-');
  const src = String(text || '');
  if (!src.trim()) return null;

  if (t === 'zh' || t === 'zh-tw') {
    if (!looksLikeChinese(src)) return null;
    if (t === 'zh') return { text: src, engine: '无需翻译' };
    const conv = toTraditional(src);
    return conv === src
      ? { text: src, engine: '无需翻译' }
      : { text: conv, engine: '繁体转换' };
  }

  if (t === 'en') {
    if (!looksLikeEnglish(src)) return null;
    return { text: src, engine: '无需翻译' };
  }

  return null;
}

module.exports = {
  executeRound, isOfflineAvailable, hashText, detectShortcut,
};
