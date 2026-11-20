'use strict';
/**
 * 外观主题（src/renderer/shared/theme.js）
 *
 * 需求：设置页与浮窗的风格由用户自定义（主题色、背景色、不透明度、背景图、圆角、模糊）。
 *
 * 设计：
 *  - 只用一个输入（配置里的 appearance 段）推导整套配色，渲染进程不自己拼颜色；
 *  - 全部通过 CSS 变量下发（--accent/--bg/--fg/...），CSS 里不再出现硬编码色值；
 *  - UMD：主进程（如有需要）/ 渲染进程经典 <script> 均可加载。
 *
 * 安全性：
 *  - 颜色值必须匹配 #rgb/#rrggbb，非法值回落默认，避免把任意字符串注入 CSS；
 *  - 背景图只接受 data:image/*（主进程从数据目录读取后编码），不接受远程 URL（N-04/L0G-01）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TranslatorTheme = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULTS = {
    accent: '#4c8dff',
    background: '#12151c',
    opacity: 0.84,
    blur: 12,
    radius: 12,
    // 两处各自独立：bgImage 给浮窗，settingsBgImage 给设置页（留空则沿用浮窗那张）
    bgImage: '',
    bgImageOpacity: 0.35,
    settingsBgImage: '',
    settingsBgImageOpacity: 0.35,
    bgImageFit: 'cover',
    textColor: '',
  };

  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  function toHex6(input) {
    if (typeof input !== 'string' || !HEX.test(input)) return null;
    if (input.length === 4) {
      return ('#' + input[1] + input[1] + input[2] + input[2] + input[3] + input[3]).toLowerCase();
    }
    return input.toLowerCase();
  }

  function rgbOf(hex) {
    const h = toHex6(hex) || '#000000';
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function rgba(hex, alpha) {
    const c = rgbOf(hex);
    const a = Math.min(1, Math.max(0, Number(alpha)));
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number.isFinite(a) ? a.toFixed(3) : 1})`;
  }

  function mix(hexA, hexB, t) {
    const a = rgbOf(hexA);
    const b = rgbOf(hexB);
    const k = Math.min(1, Math.max(0, t));
    const part = (x, y) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
    return `#${part(a.r, b.r)}${part(a.g, b.g)}${part(a.b, b.b)}`;
  }

  /** 背景越亮，前景越暗（保证对比度） */
  function isLight(hex) {
    const c = rgbOf(hex);
    const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return lum > 0.55;
  }

  function clamp(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  /** 把配置里的 appearance 规整成可用值（渲染进程侧兜底，主进程 store 已校验一次） */
  function normalize(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const out = {
      accent: toHex6(a.accent) || DEFAULTS.accent,
      background: toHex6(a.background) || DEFAULTS.background,
      opacity: clamp(a.opacity, 0.3, 1, DEFAULTS.opacity),
      blur: Math.round(clamp(a.blur, 0, 30, DEFAULTS.blur)),
      radius: Math.round(clamp(a.radius, 0, 28, DEFAULTS.radius)),
      bgImage: typeof a.bgImage === 'string' ? a.bgImage : '',
      bgImageOpacity: clamp(a.bgImageOpacity, 0, 1, DEFAULTS.bgImageOpacity),
      settingsBgImage: typeof a.settingsBgImage === 'string' ? a.settingsBgImage : '',
      settingsBgImageOpacity: clamp(a.settingsBgImageOpacity, 0, 1, DEFAULTS.settingsBgImageOpacity),
      bgImageFit: ['cover', 'contain', 'tile'].includes(a.bgImageFit) ? a.bgImageFit : 'cover',
      // 空串表示「跟随自动对比度」（深底浅字 / 浅底深字）
      textColor: toHex6(a.textColor) || '',
    };
    return out;
  }

  /** 由基色推导整套调色板 */
  function palette(raw) {
    const a = normalize(raw);
    const light = isLight(a.background);
    const bg = a.background;
    // 用户自定义的字体颜色优先；次要文字（时间、原文摘要）按它做透明度派生，
    // 颜色通道用 rgba 保持与背景的混合自然（不用 mix，避免在透明背景上偏色）
    const fgHex = a.textColor || (light ? '#16181d' : '#e8ecf3');
    const fg = rgbOf(fgHex);
    const fgRgb = `${fg.r}, ${fg.g}, ${fg.b}`;
    return {
      ...a,
      light,
      bgElevated: mix(bg, light ? '#ffffff' : '#ffffff', light ? 0.45 : 0.08),
      bgHover: mix(bg, light ? '#000000' : '#ffffff', light ? 0.08 : 0.14),
      fg: fgHex,
      fgDim: `rgba(${fgRgb}, 0.66)`,
      fgFaint: `rgba(${fgRgb}, 0.40)`,
      accentStrong: mix(a.accent, light ? '#000000' : '#ffffff', 0.22),
      accentSoft: rgba(a.accent, light ? 0.14 : 0.16),
      accentBorder: rgba(a.accent, 0.4),
      border: light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.10)',
      borderStrong: light ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.18)',
      // 语义色：浅底用深色、深底用浅色，保证提示框在 --bg-elevated 上始终看得清
      ok: light ? '#0f7b4f' : '#7fe0b0',
      err: light ? '#b42318' : '#ff9c9c',
      warn: light ? '#8a5300' : '#ffcf87',
      hudBg: rgba(bg, a.opacity),
      shadow: light ? '0 12px 32px rgba(0, 0, 0, 0.18)' : '0 12px 32px rgba(0, 0, 0, 0.45)',
    };
  }

  /** 生成 background-image 相关声明（surface 决定用哪个不透明度：两处可各调各的） */
  function imageStyle(raw, dataUrl, surface) {
    const a = normalize(raw);
    if (!dataUrl) return { image: 'none', size: 'auto', repeat: 'no-repeat', opacity: 0 };
    const size = a.bgImageFit === 'contain' ? 'contain' : a.bgImageFit === 'tile' ? 'auto' : 'cover';
    const opacity = surface === 'settings' ? a.settingsBgImageOpacity : a.bgImageOpacity;
    return {
      image: `url("${dataUrl}")`,
      size,
      repeat: a.bgImageFit === 'tile' ? 'repeat' : 'no-repeat',
      opacity,
    };
  }

  /**
   * 把主题写进 CSS 变量。
   * @param {Document} doc
   * @param {object} raw 配置里的 appearance 段
   * @param {object} [opts] { dataUrl?: string, surface?: 'hud'|'settings' }
   *   dataUrl 由调用方按表面取「该表面自己的图」，本函数不再做范围过滤。
   * @returns {object} 调色板
   */
  function apply(doc, raw, opts = {}) {
    const p = palette(raw);
    const surface = opts.surface === 'settings' ? 'settings' : 'hud';
    const img = imageStyle(raw, opts.dataUrl, surface);
    const root = doc.documentElement;
    const set = (k, v) => root.style.setProperty(k, v);
    set('--bg', p.background);
    set('--bg-elevated', p.bgElevated);
    set('--bg-hover', p.bgHover);
    set('--fg', p.fg);
    set('--fg-dim', p.fgDim);
    set('--fg-faint', p.fgFaint);
    set('--accent', p.accent);
    set('--accent-strong', p.accentStrong);
    set('--accent-soft', p.accentSoft);
    set('--accent-border', p.accentBorder);
    set('--border', p.border);
    set('--border-strong', p.borderStrong);
    // 提示框（toast）用的语义色，别再在 CSS 里写死浅色字（浅底主题会变成黑底黑字）
    set('--ok', p.ok);
    set('--err', p.err);
    set('--warn', p.warn);
    set('--radius', `${p.radius}px`);
    set('--hud-bg', p.hudBg);
    set('--hud-blur', `${p.blur}px`);
    set('--hud-radius', `${p.radius}px`);
    set('--hud-shadow', p.shadow);
    set('--theme-image', img.image);
    set('--theme-image-size', img.size);
    set('--theme-image-repeat', img.repeat);
    // 浮窗是小尺寸阅读窗口，图片占比过高必然压住文字；这里给浮窗设一道上限，
    // 设置页仍按用户设置原样显示（两处可分离，也能各自好看）。
    const imgOpacity = surface === 'hud' ? Math.min(img.opacity, 0.55) : img.opacity;
    set('--theme-image-opacity', String(imgOpacity));
    // 设置页与浮窗共用一张背景图时，设置页的标题栏/侧栏需要半透明，
    // 否则实色面板会把图片完全盖住（需求：设置页背景与浮窗同步）。
    set('--bg-veil', rgba(p.background, 0.52));
    // 内容区没有实色面板，图片会直接垫在文字下面：罩子随用户设的图片不透明度自适应，
    // 图片越淡罩子越薄（仍看得见照片），图片越浓罩子越厚（正文保持对比度）。
    set('--bg-veil-strong', rgba(p.background, Math.min(0.78, 0.48 + Number(img.opacity || 0) * 0.3)));
    set('--bg-elevated-veil', rgba(p.bgElevated, 0.86));
    // 浮窗卡片本身就是半透明底色，再叠图片会过亮；罩子厚度跟着图片不透明度走——
    // 图片越实，压得越暗，保证按钮与译文始终读得清（用户反馈过"看不清浮窗按钮"）。
    // 与上面的上限配合：既让用户挑的图"看得见"，又保证 #e8ecf3 级别的文字对比度仍在 4.5:1 以上
    const veil = Math.min(0.82, 0.40 + imgOpacity * 0.35);
    set('--hud-veil', rgba(p.background, veil));
    // 标题栏与按钮加一层底片 + 文字投影：背景图是用户挑的照片，颜色不可控，
    // 只靠半透明卡片仍有"看不清按钮"的风险（用户反馈）。
    set('--hud-head-bg', rgba(p.bgElevated, p.light ? 0.82 : 0.72));
    set('--text-shadow', p.light ? '0 1px 2px rgba(255, 255, 255, 0.75)' : '0 1px 2px rgba(0, 0, 0, 0.6)');
    const hasImg = img.image !== 'none';
    set('--has-image', hasImg ? '1' : '0');
    root.dataset.hasImage = hasImg ? '1' : '0';
    // 背景图图层统一由这里显隐，浮窗与设置页共用同一份逻辑
    if (typeof doc.querySelectorAll === 'function') {
      doc.querySelectorAll('.bg-layer').forEach((el) => { el.hidden = !hasImg; });
    }
    root.dataset.theme = p.light ? 'light' : 'dark';
    return p;
  }

  return { DEFAULTS, normalize, palette, apply, rgba, mix, isLight, toHex6, imageStyle };
});
