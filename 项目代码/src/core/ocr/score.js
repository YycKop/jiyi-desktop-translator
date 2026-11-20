'use strict';
/**
 * OCR 结果打分与择优（core/ocr/score.js）
 *
 * 背景（实测数据见 项目测试/reports/ocr-scale-experiment.json）：
 * 同一张图在不同放大倍数下会得到不同结果，且不存在「一个倍数通吃」的情况——
 *   · il-640x160：2x 把 "Please" 认成 "PIease"，3x 正确；
 *   · il-small-480x90：3x 把 "the" 拆成 "th e"，2x 正确；
 *   · il-dark-560x120：3x 把 "Log" 认成 "LO g"，2x 更接近；
 *   · en-480x120：2x 把 "jumps" 认成 "JUmps"，3x 正确。
 * 因此改成**多遍识别 + 打分择优**：用下面这些不依赖词典的异常特征给每遍结果打分，
 * 取分数最低（最干净）的一遍。
 *
 * 检查的都是「OCR 典型错误形状」，而不是猜测语义，所以不会把正确文本改坏：
 *   - 词内大小写跳变（PIease、JUmps、LOg、SubtitIes）
 *   - 被拆开的单字母词（th e、LO g）
 *   - 词内夹数字（t0、h3llo）
 *   - 零散符号行
 */

const SINGLE_LETTER_OK = new Set(['a', 'A', 'I', 'i']);

/**
 * 常用界面/技术词表：只用来识别"差一个字母"的疑似错认（Ctri→Ctrl、CtrI→Ctrl）。
 * 词表刻意保持很小且只收界面术语，避免把正常英文单词误判。
 */
const TECH_WORDS = new Set([
  'ctrl', 'alt', 'shift', 'enter', 'esc', 'tab', 'space', 'copy', 'paste', 'undo', 'redo',
  'save', 'open', 'close', 'click', 'file', 'view', 'help', 'text', 'font', 'image', 'color',
  'theme', 'model', 'token', 'port', 'host', 'json', 'http', 'https', 'true', 'false', 'null',
  'settings', 'translate', 'ocr', 'update', 'install', 'config', 'start', 'stop', 'retry',
  'menu', 'exit', 'quit', 'cancel', 'apply', 'reset', 'search', 'input', 'output', 'window',
  'screen', 'lang', 'source', 'target', 'local', 'cloud', 'timer', 'status', 'error', 'warn',
  'debug', 'info', 'please', 'click', 'link', 'list', 'item', 'items', 'line', 'lines',
]);

/**
 * a、b 的编辑距离是否 ≤ 1（只做判断，不算完整矩阵）。
 */
function withinEditDistance1(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    diff += 1;
    if (diff > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < a.length || j < b.length) diff += 1;
  return diff === 1;
}

/** 是不是"看着像某个界面术语，但差一个字母"——OCR 把 l 认成 i/t 的典型产物 */
function isNearMissWord(token) {
  const raw = String(token || '');
  const lower = raw.toLowerCase();
  if (lower.length < 3 || lower.length > 12) return false;
  if (TECH_WORDS.has(lower)) return false;
  // 只对**含大写字母**的 token 生效：正常英文小写词（fine、file）会被误判成"差点拼错"，
  // 而快捷键/控件名基本都是大小写混合（Ctrl、Ctri、CtrI、Shift）。
  if (!/[A-Z]/.test(raw)) return false;
  for (const word of TECH_WORDS) {
    if (withinEditDistance1(lower, word)) return true;
  }
  return false;
}

/** 中日韩字符与全角标点区间（用于判断"半角标点夹在中文里"） */
const CJK_CHAR = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
/** 中日韩标点 + 全角字符（，。：！？（）“” 等） */
const CJK_PUNCT = '\\u3000-\\u303f\\uff00-\\uffef';
const CJK_ALL = CJK_CHAR + CJK_PUNCT;
const CJK_PUNCT_IN_CJK = new RegExp(`[${CJK_CHAR}]\\s*[,;:?!]|[,;:?!]\\s*[${CJK_CHAR}]`);

/**
 * 词内大小写跳变：
 *  - `^[A-Z]{2,}[a-z]`：连续大写开头又突然变小写，OCR 把 l 认成 I 的典型产物（PIease、LOg、JUmps）
 *  - `[a-z]I[a-z]`：小写中间夹一个大写 I，通常是被认成 I 的 l（SubtitIes）
 * 不把通用的「小写后跟大写」都算异常，因为 iPhone、macOS、eBay 是正常写法。
 */
function hasCaseJump(token) {
  if (/^[A-Z]{2,}[a-z]/.test(token)) return true;
  if (/[a-z]I[a-z]/.test(token)) return true;
  // 词尾突然大写：tO、iT 这类，多半是小写 o 被认成大写 O
  if (/[a-z][A-Z]$/.test(token)) return true;
  return false;
}

/**
 * 给一段 OCR 文本打分：**分数越低越干净**。
 * @param {string} text
 * @returns {{score:number, penalties:Array<{kind:string, sample:string}>}}
 */
function scoreText(text) {
  const penalties = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // 纯符号/纯数字行：多半是边框、滚动条被当成文字
    if (!/[\p{L}]/u.test(line)) {
      penalties.push({ kind: 'symbol-line', sample: line.slice(0, 12) });
      continue;
    }
    const tokens = line.split(/\s+/);
    // 中文里夹着半角标点：WinRT 常把「，。：」认成 ", . :"，或干脆丢掉逗号，
    // 这比半角/全角本身更影响译文质量，因此计入惩罚（repairCjkPunctuation 会修好）。
    if (CJK_PUNCT_IN_CJK.test(line)) {
      penalties.push({ kind: 'cjk-ascii-punct', sample: line.slice(0, 16) });
    }
    // 标点事故：重复标点、行首标点（这两类用户一眼就能看出来，权重直接计 1 次）
    if (/([，。、；：！？])[，。、；：！？]+/.test(line)) {
      penalties.push({ kind: 'dup-punct', sample: line.slice(0, 16) });
    }
    if (/^[，。、；：！？]/.test(line)) {
      penalties.push({ kind: 'lead-punct', sample: line.slice(0, 16) });
    }
    // 英文/代码里的运算符被空格拆开（Ctrl + Shift+T）：低对比度那一遍常这样，会污染译文
    if (/([\p{Script=Latin}\p{N}])\s+[+\-*/=<>]|[+\-*/=<>]\s+[\p{Script=Latin}\p{N}]/u.test(line)) {
      penalties.push({ kind: 'ascii-space', sample: line.slice(0, 16) });
    }
    for (const token of tokens) {
      const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!core) continue;
      // 一个 token 里可能混着符号（`Ctri+Shift+T`），逐个字母串检查才有意义
      const runs = core.match(/[\p{Script=Latin}]+/gu) || [];
      if (!runs.length) continue; // 纯中文/日文/数字不做这些判断
      const isLatin = /^[\p{Script=Latin}]+$/u.test(core);

      if (isLatin && core.length === 1 && !SINGLE_LETTER_OK.has(core)) {
        penalties.push({ kind: 'single-letter', sample: core });
        continue;
      }
      let flagged = false;
      for (const run of runs) {
        if (run.length < 2) continue;
        if (hasCaseJump(run)) {
          penalties.push({ kind: 'case-jump', sample: run.slice(0, 16) });
          flagged = true;
          break;
        }
        // 差一个字母的界面术语（Ctri / CtrI / Shfit）：OCR 最爱把 l 认成 i
        if (isNearMissWord(run)) {
          penalties.push({ kind: 'near-miss', sample: run.slice(0, 16) });
          flagged = true;
          break;
        }
      }
      if (flagged) continue;
      // 词内夹数字（版本号 v1、型号 2x 之类会出现，但权重较低）
      if (/^\p{L}+\p{N}+$/u.test(core) && !/^(v|V)\d/i.test(core)) {
        penalties.push({ kind: 'digit-in-word', sample: core.slice(0, 16) });
      }
    }
  }
  return { score: penalties.length, penalties };
}

/**
 * 在多遍识别结果中选最优。
 * 同分时优先**靠前**的候选（调用方按「先 2x 后 3x」顺序传入，2x 更快是本机基准）。
 *
 * @param {Array<{text:string, scale:number, [k:string]:any}>} candidates
 * @returns {{best:any, scored:Array, reason:string}}
 */
function chooseBest(candidates) {
  const list = (candidates || []).filter((c) => c && typeof c.text === 'string' && c.text.trim());
  if (!list.length) return { best: null, scored: [], reason: 'empty' };
  const scored = list.map((c) => {
    const s = scoreText(c.text);
    return { ...c, score: s.score, penalties: s.penalties };
  });
  let best = scored[0];
  for (const c of scored) {
    if (c.score < best.score) best = c;
  }
  const reason = scored.length === 1 ? 'single-pass'
    : (best.score < scored[0].score ? 'better-pass' : 'first-pass');
  return { best, scored, reason };
}

/**
 * 按**行**合并多遍结果：同一段文字在不同倍数下往往"各错一行"，
 * 整段择优会丢掉另一边正确的那几行，所以同结构时逐行取最干净的一行。
 *
 * 只有在各遍的行数一致时才这样做（行数不一致说明版面切分不同，整段择优更稳）。
 *
 * @param {Array<{text:string, scale:number}>} candidates
 * @returns {{text:string, reason:string, lines:Array}}
 */
/**
 * a 是否为 b 的子序列（忽略空白）。
 *
 * 用来判断"两遍结果的差异只是漏了字"。例如 `新框选区域` 是 `重新框选区域` 的子序列，
 * 说明短的那一份只是少识别了一个字；而 `按钮` 不是 `扌安钮` 的子序列——那是一个字被拆成两半，
 * 这种情况不能因为"更长"就选它。
 */
function isSubsequence(a, b) {  const x = String(a || '').replace(/\s+/g, '');
  const y = String(b || '').replace(/\s+/g, '');
  if (!x.length) return true;
  if (x.length >= y.length) return false;
  let i = 0;
  for (let j = 0; j < y.length && i < x.length; j += 1) {
    if (y[j] === x[i]) i += 1;
  }
  return i === x.length;
}

/**
 * 在多遍识别结果中合并逐行最优。
 *
 * @param {Array<{text:string, scale:number, [k:string]:any}>} candidates
 * @param {{voting?:boolean}} [opts]  voting=false 时不做"多遍投票"，完全按传入顺序 + 分数决定
 *   （短文本提示行用得上：那类图只有锐化那遍最准，投票会把别的遍的近似结果选上来）
 */
function mergeLines(candidates, opts = {}) {
  const useVoting = opts.voting !== false;
  const list = (candidates || []).filter((c) => c && typeof c.text === 'string' && c.text.trim());
  if (list.length < 2) {
    return { text: list[0] ? list[0].text : '', reason: 'single-pass', lines: [] };
  }
  const split = list.map((c) => c.text.split(/\r?\n/));
  const counts = new Set(split.map((s) => s.length));
  if (counts.size !== 1) {
    const { best, reason } = chooseBest(list);
    return { text: best ? best.text : '', reason: `pass-${reason}`, lines: [] };
  }
  const out = [];
  const detail = [];
  for (let i = 0; i < split[0].length; i += 1) {
    const variants = split.map((s) => s[i] || '');
    const scores = variants.map((v) => scoreText(v).score);
    // 多遍之间"投票"：同一行被两遍以上认成同一个串，那多半就是对的（比单遍的分数更可靠）
    const counts = new Map();
    for (const v of variants) {
      const key = v.replace(/\s+/g, '');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestIdx = 0;
    for (let k = 1; k < variants.length; k += 1) {
      const sBest = scores[bestIdx];
      const sCur = scores[k];
      if (sCur < sBest) { bestIdx = k; continue; }
      if (sCur > sBest) continue;
      const cBest = counts.get(variants[bestIdx].replace(/\s+/g, '')) || 0;
      const cCur = counts.get(variants[k].replace(/\s+/g, '')) || 0;
      if (useVoting && cCur > cBest) { bestIdx = k; continue; }
      if (useVoting && cCur < cBest) continue;
      // 分数与票数都相同：优先"更完整"的那份
      if (isSubsequence(variants[bestIdx], variants[k])) { bestIdx = k; continue; }
      // 两者互不为子序列时，取更长的（实测里 OCR 最常见的失败是"漏字"，
      // 而"一个字被拆成两半"这种多出来的情况会被上面的投票/分数先挑掉）
      const lenBest = variants[bestIdx].replace(/\s+/g, '').length;
      const lenCur = variants[k].replace(/\s+/g, '').length;
      if (lenCur > lenBest) bestIdx = k;
    }
    out.push(variants[bestIdx]);
    detail.push({
      line: i,
      from: list[bestIdx].scale,
      sharpen: list[bestIdx].sharpen || 0,
      votes: counts.get(variants[bestIdx].replace(/\s+/g, '')) || 0,
      score: scores[bestIdx],
    });
  }
  return { text: out.join('\n'), reason: 'line-merge', lines: detail };
}

/**
 * 收敛 OCR 的 i/l 类混淆（只在**词内部**动手，不动句首大小写）。
 *
 * 规则都很窄，只覆盖实测见过的形状：
 *   PIease → Please     （两个大写开头后接小写，第二个是 I → 多半是被认成 I 的 l）
 *   SubtitIes → Subtitles（小写中间夹大写 I）
 *   tO → to             （词尾突然大写，o 被认成 O）
 * 不动 iPhone / macOS / USA 这类正常写法。
 *
 * @param {string} text
 * @returns {{text:string, changed:boolean}}
 */
function repairText(text) {
  const src = String(text || '');
  let out = src;
  // 1) PIease / PLease → Please：首字母后紧跟 "I+小写"
  out = out.replace(/\b([A-Z])I(?=[a-z])/g, '$1l');
  // 2) SubtitIes → Subtitles：小写 + I + 小写
  out = out.replace(/([a-z])I(?=[a-z])/g, '$1l');
  // 3) tO → to：小写字母 + 词尾大写
  out = out.replace(/([a-z])([A-Z])\b/g, (m, a, b) => a + b.toLowerCase());
  return { text: out, changed: out !== src };
}

/**
 * 中文标点修复（实测中文识别率的主要短板不是"认错字"，而是"标点全半角混用/丢失"）。
 *
 * 规则只用「上下文」做判断，不猜语义：
 *   1. 中文之间的空格全部去掉（WinRT 会把「欢迎使用」输出成「欢 迎 使 用」）；
 *   2. 夹在中文里的半角标点换成全角：, ; : ? ! ( )  →  ， ； ： ？ ！ （ ）；
 *   3. 中文句尾的 `.` 换成 `。`（排除 3.5、v1.2 这类数字串）；
 *   4. 成对的半角引号按中文习惯换成 “ ”。
 * 纯英文/数字行、URL、代码片段不受影响（左右都是 ASCII 时不替换）。
 *
 * @param {string} text
 * @returns {{text:string, changed:boolean}}
 */
function repairCjkPunctuation(text) {
  const src = String(text || '');
  if (!src) return { text: src, changed: false };
  let out = src;

  // 1) 中文旁的半角标点 → 全角（先做标点，再收空格，否则「， 然后」会残留空格）
  const map = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！', '(': '（', ')': '）' };
  for (const [ascii, wide] of Object.entries(map)) {
    const re = new RegExp(`([${CJK_CHAR}])\\s*\\${ascii}`, 'g');
    out = out.replace(re, `$1${wide}`);
    const re2 = new RegExp(`\\${ascii}\\s*([${CJK_CHAR}])`, 'g');
    out = out.replace(re2, `${wide}$1`);
  }

  // 2) 括号里含中文时整对转全角（「见说明(第3页)」→「见说明（第3页）」）
  out = out.replace(new RegExp(`\\(([^)\\n]*[${CJK_CHAR}][^)\\n]*)\\)`, 'g'), '（$1）');

  // 3) 中文句尾句号：中文后面的 .（后面不是数字/字母，避免破坏 3.5、v1.2）
  out = out.replace(new RegExp(`([${CJK_CHAR}])\\.(?![0-9A-Za-z])`, 'g'), '$1。');

  // 3) 中文旁的成对半角引号（成对替换，避免把 " 全变成 “）
  out = out.replace(new RegExp(`([${CJK_CHAR}])"([^"\\n]+)"`, 'g'), '$1“$2”');
  out = out.replace(new RegExp(`"([^"\\n]+)"([${CJK_CHAR}])`, 'g'), '“$1”$2');

  // 4) 汉字/全角标点之间的空白全部去掉。
  //    WinRT 会把「欢迎使用」输出成「欢 迎 使 用」，把「，然后」输出成「， 然后」，
  //    导致译文里出现莫名其妙的空格（中译英时尤其明显）。
  const cjkSpace = new RegExp(`([${CJK_ALL}])[ \\t\\u3000]+(?=[${CJK_ALL}])`, 'g');
  let prev;
  do {
    prev = out;
    out = out.replace(cjkSpace, '$1');
  } while (out !== prev);

  // 5) 数字里的小数点：WinRT 在中文语境下会把 3.5 认成「3 ． 5」或「3。5」，
  //    这类错误会直接毁掉译文里的数字，所以按「数字-分隔符-数字」精确复原。
  out = out.replace(/(\d)[ \t]*[．。·][ \t]*(\d)/g, '$1.$2');
  // 数字与百分号/单位之间也不该有空格：100 ％ → 100%
  out = out.replace(/(\d)[ \t]*[％%]/g, '$1%');
  // 纯数字之间的空格（「128 个」保留，"1 000" 这类千分位则合并）
  out = out.replace(/(\d)[ \t]+(?=\d{3}\b)/g, '$1');

  // 6) 连续的标点合并：WinRT 偶尔把「，」认成「，，」或「。，」，
  //    这是用户最直观感受到的"莫名多出来的标点"，只保留第一个。
  out = out.replace(/([，。、；：！？])[，。、；：！？]+/g, '$1');
  // 7) 行首挂标点（`, 然后继续` / `。如果没有响应`）：标点不可能出现在行首，直接去掉
  out = out.replace(/(^|\n)[ \t]*[，。、；：！？]+[ \t]*/g, '$1');
  // 8) 英文/代码里的运算符两侧空格（`Ctrl + Shift` → `Ctrl+Shift`）：
  //    只在运算符两边都是**字母**时才收紧，这样 `1 + 1 = 2` 这类算式不会被连成一串。
  out = out.replace(/(\p{Script=Latin})\s+([+\-*/=<>])\s+(?=\p{Script=Latin})/gu, '$1$2');

  return { text: out, changed: out !== src };
}

module.exports = {
  scoreText, chooseBest, mergeLines, hasCaseJump, repairText, repairCjkPunctuation,
};
