'use strict';
/**
 * 提示词构造与译文清洗（core/translate/prompt.js）
 *
 * M1-T4 指定离线 system prompt：
 *   "You are a translator. Translate the user text to {targetLang}. Output only the translated text, no explanation."
 * 联网分支允许用户覆盖 systemPrompt（M4-T2 字段），未覆盖时使用默认模板。
 */
const { displayName, normalizeCode } = require('./languages');
const { isTraditionalTarget } = require('./traditional');
const { DEFAULT_SYSTEM_PROMPT } = require('../config/defaults');

const LOCAL_SYSTEM_PROMPT =
  'You are a translator. Translate the user text to {target}. '
  + 'Output only the translated text, no explanation.';

/**
 * 目标为繁体中文时专用的 system prompt。
 *
 * 实测：本地 HY-MT 对 "Translate into Traditional Chinese" 基本不动手，
 * 会把简体原文原样返回；改成"把每个简体字改写成繁体"的指令后能正确输出繁体。
 * 这里只追加语义，不覆盖用户自己的模板。
 */
const TRADITIONAL_HINT =
  'Rewrite every Simplified Chinese character into its Traditional Chinese form '
  + '(for example 请→請, 击→擊, 继续→繼續, 设置→設置) and keep the meaning unchanged.';

function buildSystemPrompt(template, targetLang, sourceLang) {
  const target = displayName(targetLang);
  const tpl = String(template || '').trim() || DEFAULT_SYSTEM_PROMPT;
  let out = tpl.includes('{target}')
    ? tpl.replace(/\{target(Lang)?\}/g, target)
    : `${tpl} Target language: ${target}.`;

  // 源语言放在 system 里，不放 user 正文：放在正文里小模型会把
  // 「[source language: xx]」这行一起抄进译文（实测）。
  const src = normalizeCode(sourceLang);
  if (src && src !== 'auto') out += ` Source language: ${displayName(src)}.`;

  if (isTraditionalTarget(targetLang)) out += ` ${TRADITIONAL_HINT}`;
  return out;
}

function buildMessages({ text, targetLang, sourceLang, systemPrompt, useLocalDefaults }) {
  const sys = buildSystemPrompt(
    useLocalDefaults ? LOCAL_SYSTEM_PROMPT : systemPrompt,
    targetLang,
    sourceLang,
  );
  return [
    { role: 'system', content: sys },
    { role: 'user', content: String(text == null ? '' : text) },
  ];
}

const PREFIX_RE = /^(translation|translated text|译文|翻译结果|中文翻译)\s*[:：]\s*/i;

/** 清洗模型输出：去包裹引号、去“译文：”前缀、收敛空行（不动正文内容） */
function cleanTranslation(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/\r\n/g, '\n').trim();
  if (!s) return '';

  // 去掉模型常见的 <译文> 包裹
  const wrap = /^<([^>\n]{1,12})>\n?([\s\S]*?)\n?<\/\1>$/.exec(s);
  if (wrap) s = wrap[2].trim();

  s = s.replace(PREFIX_RE, '').trim();

  // 整体被成对引号包裹时剥离（仅当首尾配对且中间无同类引号）
  const pairs = [['"', '"'], ['“', '”'], ['「', '」'], ["'", "'"], ['『', '』']];
  for (const [l, r] of pairs) {
    if (s.length > 1 && s.startsWith(l) && s.endsWith(r) && s.indexOf(l, 1) === -1
      && s.lastIndexOf(r, s.length - 2) === -1) {
      s = s.slice(l.length, s.length - r.length).trim();
      break;
    }
  }

  // 折叠 3 行以上空行（保留段落结构）
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** CJK 字符（含中文标点与全角符号） */
const CJK_CLASS = '\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF';
const CJK_SPACE_RE = new RegExp(`([${CJK_CLASS}])[ \\t]+(?=[${CJK_CLASS}])`, 'g');

/**
 * Windows OCR 会在相邻汉字之间插入空格（"欢 迎 使 用"），需折叠。
 * 仅在两侧都是 CJK 时删除空格；CJK 与拉丁/数字之间保留空格（"使用 Excel 编辑"）。
 */
function collapseCjkSpaces(text) {
  let s = String(text || '');
  let prev;
  do {
    prev = s;
    s = s.replace(CJK_SPACE_RE, '$1');
  } while (s !== prev);
  return s;
}

/** OCR 原文归一化：合并行内多余空白，去掉零宽字符，折叠汉字间空格 */
function normalizeSourceText(raw) {
  const lines = String(raw || '')
    .replace(/[\u200b-\u200f\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => collapseCjkSpaces(line.replace(/[ \t\u00a0]+/g, ' ')).trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  LOCAL_SYSTEM_PROMPT,
  TRADITIONAL_HINT,
  isTraditionalTarget,
  buildSystemPrompt,
  buildMessages,
  cleanTranslation,
  collapseCjkSpaces,
  normalizeSourceText,
};
