'use strict';
/**
 * 语言表（core/translate/languages.js）
 *
 * F-07：源语言自动检测 + 目标语言手动；覆盖中英日韩及常用小语种。
 * HY-MT1.5-1.8B 官方支持 33 语种，下表与之对齐并附加中文显示名。
 */

const LANGUAGES = [
  { code: 'auto', zh: '自动检测', en: 'Auto Detect', detectOnly: true },
  { code: 'zh', zh: '中文（简体）', en: 'Simplified Chinese' },
  { code: 'zh-TW', zh: '中文（繁体）', en: 'Traditional Chinese' },
  { code: 'en', zh: '英语', en: 'English' },
  { code: 'ja', zh: '日语', en: 'Japanese' },
  { code: 'ko', zh: '韩语', en: 'Korean' },
  { code: 'ru', zh: '俄语', en: 'Russian' },
  { code: 'fr', zh: '法语', en: 'French' },
  { code: 'de', zh: '德语', en: 'German' },
  { code: 'es', zh: '西班牙语', en: 'Spanish' },
  { code: 'pt', zh: '葡萄牙语', en: 'Portuguese' },
  { code: 'it', zh: '意大利语', en: 'Italian' },
  { code: 'ar', zh: '阿拉伯语', en: 'Arabic' },
  { code: 'th', zh: '泰语', en: 'Thai' },
  { code: 'vi', zh: '越南语', en: 'Vietnamese' },
  { code: 'id', zh: '印尼语', en: 'Indonesian' },
  { code: 'ms', zh: '马来语', en: 'Malay' },
  { code: 'tr', zh: '土耳其语', en: 'Turkish' },
  { code: 'nl', zh: '荷兰语', en: 'Dutch' },
  { code: 'pl', zh: '波兰语', en: 'Polish' },
  { code: 'uk', zh: '乌克兰语', en: 'Ukrainian' },
  { code: 'cs', zh: '捷克语', en: 'Czech' },
  { code: 'sv', zh: '瑞典语', en: 'Swedish' },
  { code: 'da', zh: '丹麦语', en: 'Danish' },
  { code: 'fi', zh: '芬兰语', en: 'Finnish' },
  { code: 'nb', zh: '挪威语', en: 'Norwegian' },
  { code: 'el', zh: '希腊语', en: 'Greek' },
  { code: 'hu', zh: '匈牙利语', en: 'Hungarian' },
  { code: 'ro', zh: '罗马尼亚语', en: 'Romanian' },
  { code: 'bg', zh: '保加利亚语', en: 'Bulgarian' },
  { code: 'he', zh: '希伯来语', en: 'Hebrew' },
  { code: 'fa', zh: '波斯语', en: 'Persian' },
  { code: 'hi', zh: '印地语', en: 'Hindi' },
  { code: 'ur', zh: '乌尔都语', en: 'Urdu' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));

function list() {
  return LANGUAGES.map((l) => ({ ...l }));
}

function normalizeCode(code) {
  const c = String(code || '').trim();
  if (!c) return 'auto';
  const direct = BY_CODE.get(c.toLowerCase());
  if (direct) return direct.code;
  // 兼容 zh_CN / zh-Hans / en_US 等写法
  const base = c.replace('_', '-').split('-')[0].toLowerCase();
  const hit = BY_CODE.get(base);
  return hit ? hit.code : c;
}

/** 提示词中使用的语言名称（英文名最稳，模型对英文语种名识别更好） */
function displayName(code) {
  const c = normalizeCode(code);
  const hit = BY_CODE.get(String(c).toLowerCase());
  return hit ? hit.en : String(code || 'the target language');
}

function labelZh(code) {
  const hit = BY_CODE.get(String(normalizeCode(code)).toLowerCase());
  return hit ? hit.zh : String(code || '');
}

/** 源语言与目标语言相同则无需翻译（'auto' 一律视为不同） */
function isSameLanguage(sourceLang, targetLang) {
  const s = normalizeCode(sourceLang);
  const t = normalizeCode(targetLang);
  if (s === 'auto' || t === 'auto') return false;
  const a = s.split('-')[0].toLowerCase();
  const b = t.split('-')[0].toLowerCase();
  if (a !== b) return false;
  // 简繁同属 zh，但目标不同则仍需转换
  return s.toLowerCase() === t.toLowerCase() || !['zh', 'zh-tw'].includes(b);
}

const langApi = { LANGUAGES, list, normalizeCode, displayName, labelZh, isSameLanguage };
// UMD：主进程 require，渲染进程通过 <script> 直接取同一份语言表，避免两处不一致
// 注意：这里不能声明名为 api / state 等常用名的全局变量——经典 <script> 共享全局
// 词法作用域，一旦与页面脚本重名会抛 SyntaxError 并令整页脚本停止执行。
if (typeof module !== 'undefined' && module.exports) module.exports = langApi;
if (typeof window !== 'undefined') window.TranslatorLanguages = langApi;
