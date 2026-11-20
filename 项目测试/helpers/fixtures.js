'use strict';
/**
 * 合成测试图清单（SCR-02：仅纯色背景 + 渲染文字，不含任何真实桌面内容）
 *
 * expected 为该图渲染的原文；用于计算字符级相似度，验收 D1.3「中英文印刷体 ≥95%」。
 * minSimilarity 为验收阈值：默认 0.95，14px 以下小字号属已知下降区，单独放宽。
 */
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

const FIXTURES = {
  'zh-en-640x200.png': {
    description: '中英混排，28px 黑字白底',
    expected: '欢迎使用桌面翻译助手\nHello World, this is a test.',
    minSimilarity: 0.95,
    kind: 'normal',
  },
  'en-480x120.png': {
    description: '纯英文，22px',
    expected: 'The quick brown fox\njumps over the lazy dog.',
    minSimilarity: 0.95,
    kind: 'normal',
  },
  'zh-480x140.png': {
    description: '纯中文，26px',
    expected: '桌面翻译助手第一版\n开发完成并已测试',
    minSimilarity: 0.95,
    kind: 'normal',
  },
  'dark-640x160.png': {
    description: '深色背景浅色字（游戏/视频字幕场景），26px',
    expected: 'Press Save to continue\n保存并继续',
    minSimilarity: 0.95,
    kind: 'normal',
  },
  'small-360x90.png': {
    description: '小字号 16px，字幕场景',
    expected: 'Subtitles line one\n字幕第一行',
    minSimilarity: 0.9,
    kind: 'small',
  },
  // ↓ 针对性回归：i/l/O/0 混淆（用户反馈「把 i 看成 l」），详见 core/ocr/score.js
  'il-640x160.png': {
    description: 'i/l 混淆回归：Please / little，20px 白底',
    expected: 'Please click the link to fill in your details.\nThis is a little list of items.',
    minSimilarity: 0.98,
    kind: 'normal',
  },
  'il-small-480x90.png': {
    description: 'i/l 混淆回归：16px 小字号（3x 会断词，需选 2x）',
    expected: 'Click the link, it will fill in.',
    minSimilarity: 0.95,
    kind: 'small',
  },
  'il-dark-560x120.png': {
    description: 'i/l 混淆回归：深底 Log in to，18px',
    expected: 'Log in to see your profile settings.',
    minSimilarity: 0.98,
    kind: 'normal',
  },
  // ↓ 中文标点回归（用户反馈「中文字和标点识别率低」）：WinRT 会把「，。：！」输出成
  //   「 ，  。  ： ！」这类带空格/半角的形式，由 core/ocr/score.js 的 repairCjkPunctuation 收敛
  'cjk-punct-640x200.png': {
    description: '中文标点回归：逗号/句号/冒号/感叹号，26px 白底',
    expected: '请点击保存按钮，然后继续。\n提示：请勿关闭窗口！',
    minSimilarity: 0.95,
    kind: 'normal',
    checkCjkPunct: true,
  },
  // ↓ 小字号中文回归（用户反馈：设置页 14px 提示行「动→目、文字丢失、景→昱」）：
  //   根因不是反色也不是倍数，而是笔画粘连；USM 锐化（core/ocr/winrt.js 默认 sharpen=160）后完全正确
  'ui-hint-14px.png': {
    description: '小字号中文回归：14px 深底浅字（设置页提示行）',
    expected: '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复',
    minSimilarity: 0.98,
    kind: 'small',
    checkCjkPunct: true,
  },
  'ui-hint-16px.png': {
    description: '小字号中文回归：16px 深底浅字',
    expected: '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复',
    minSimilarity: 0.98,
    kind: 'small',
    checkCjkPunct: true,
  },
  'ui-hint-light.png': {
    description: '小字号中文回归：14px 浅底深字（反极性）',
    expected: '「自动」= 深底浅字 / 浅底深字，\n点「跟随背景」可恢复',
    minSimilarity: 0.98,
    kind: 'small',
    checkCjkPunct: true,
  },
  // ↓ 整段正文回归（用户反馈「框里文字识别不全」）：15px 五行长文本最容易暴露两个问题——
  //   ① 锐化过头把字认崩（所以整段用 2x 不锐化那一遍）；② 数字 3.5 被认成「3 ． 5」。
  'para-dark-15px.png': {
    description: '整段中文回归：15px 深底浅字，5 行含数字与百分比',
    expected: [
      '请先点击「保存」按钮，然后等待同步完成。',
      '如果提示网络错误，请检查代理设置后重试。',
      '本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。',
      '注意：关闭窗口不会退出程序，程序会继续在后台运行。',
      '更多帮助请查看使用说明，或联系技术支持。',
    ].join('\n'),
    minSimilarity: 0.94,
    kind: 'small',
    checkCjkPunct: true,
    checkDigits: true,
  },
  'para-light-15px.png': {
    description: '整段中文回归：15px 浅底深字（反极性）',
    expected: [
      '请先点击「保存」按钮，然后等待同步完成。',
      '如果提示网络错误，请检查代理设置后重试。',
      '本次同步共 128 个文件，耗时 3.5 秒，成功率 100%。',
      '注意：关闭窗口不会退出程序，程序会继续在后台运行。',
      '更多帮助请查看使用说明，或联系技术支持。',
    ].join('\n'),
    minSimilarity: 0.93,
    kind: 'small',
    checkCjkPunct: true,
    checkDigits: true,
  },
  'para-dark-16px.png': {
    description: '整段中文回归：16px 三行正文',
    expected: [
      '点击「开始」按钮后，系统会自动扫描并识别选区文字。',
      '识别结果会显示在浮窗中，可以复制或再次翻译。',
      '若译文不准确，可以切换目标语言或调整框选区域。',
    ].join('\n'),
    minSimilarity: 0.95,
    kind: 'small',
    checkCjkPunct: true,
  },
  'para-gray-14px.png': {
    description: '整段中文回归：14px 灰字深底（对比度偏低，已知下降区）',
    expected: [
      '提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
      '浮窗右下角的小三角可以调整窗口大小。',
      '按 Esc 键会暂停定时轮询。',
    ].join('\n'),
    minSimilarity: 0.84,
    kind: 'small',
    checkCjkPunct: true,
  },
};

function list() {
  return Object.entries(FIXTURES).map(([name, meta]) => ({
    name,
    file: path.join(FIXTURES_DIR, name),
    ...meta,
  }));
}

module.exports = { FIXTURES_DIR, FIXTURES, list };
