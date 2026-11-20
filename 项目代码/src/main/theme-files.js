'use strict';
/**
 * 背景图文件读写（第八轮缺陷修复）
 *
 * 为什么单独成模块：此前这段逻辑写在 src/main/ipc.js 的闭包里，误用了
 * `ctrl.engine.paths.home()`（TranslatorEngine 并不暴露 paths），用户点
 * 「选择图片…」时报 `Cannot read properties of undefined (reading 'home')`。
 * 抽出来之后：① 只依赖 core/paths，可在纯 Node 下单元测试；
 * ② 目录与大小限制集中一处，主进程多处复用不会各写一份。
 */
const fs = require('fs');
const path = require('path');

const paths = require('../core/paths');

const THEME_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const MAX_THEME_BYTES = 8 * 1024 * 1024;
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/** 主题目录：<数据目录>/theme（不存在则创建） */
function themeDir() {
  const dir = path.join(paths.home(), 'theme');
  paths.ensureDir(dir);
  return dir;
}

/**
 * 读背景图为 data URL。
 * 只返回给本地渲染进程，不写日志、不外发（SCR-03/LOG-01）。
 * @returns {{dataUrl:string,path:string,bytes:number}|null}
 */
function readThemeImage(file) {
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_THEME_BYTES) return null;
    const ext = path.extname(file).toLowerCase();
    if (!THEME_EXTS.includes(ext)) return null;
    const buf = fs.readFileSync(file);
    return {
      dataUrl: `data:${MIME[ext]};base64,${buf.toString('base64')}`,
      path: file,
      bytes: buf.length,
    };
  } catch {
    return null;
  }
}

/**
 * 把用户选的图片复制进主题目录（原图被移动/删除后主题仍有效）。
 * prefix 区分用途：hud = 浮窗背景图，settings = 设置页背景图（两处可分别设置）。
 * @returns {{path:string,dataUrl:string|null}}
 */
function importThemeImage(src, stamp = Date.now(), prefix = 'hud') {
  const stat = fs.statSync(src);
  if (stat.size > MAX_THEME_BYTES) {
    throw Object.assign(new Error('图片过大（上限 8 MB）'), { code: 'CONFIG_INVALID' });
  }
  const ext = path.extname(src).toLowerCase();
  if (!THEME_EXTS.includes(ext)) {
    throw Object.assign(new Error('不支持的图片格式'), { code: 'CONFIG_INVALID' });
  }
  const tag = prefix === 'settings' ? 'settings' : 'hud';
  const dest = path.join(themeDir(), `${tag}-${stamp}${ext}`);
  fs.copyFileSync(src, dest);
  const img = readThemeImage(dest);
  return { path: dest, dataUrl: img ? img.dataUrl : null };
}

/** 删除主题目录里的图片（只允许删 theme/ 下的文件，防越权删除） */
function removeThemeImage(file) {
  if (!file) return false;
  const dir = path.resolve(themeDir());
  const target = path.resolve(file);
  if (!target.startsWith(dir + path.sep)) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 取某个表面实际生效的图片：
 *   浮窗 → appearance.bgImage
 *   设置页 → appearance.settingsBgImage，留空时沿用浮窗那张
 * @returns {{dataUrl:string,path:string,bytes:number,fallback:boolean}|null}
 */
function resolveSurfaceImage(appearance, surface) {
  const a = appearance || {};
  if (surface === 'settings') {
    const own = readThemeImage(a.settingsBgImage);
    if (own) return { ...own, fallback: false };
    const shared = readThemeImage(a.bgImage);
    return shared ? { ...shared, fallback: true } : null;
  }
  const shared = readThemeImage(a.bgImage);
  return shared ? { ...shared, fallback: false } : null;
}

module.exports = {
  THEME_EXTS,
  MAX_THEME_BYTES,
  themeDir,
  readThemeImage,
  importThemeImage,
  removeThemeImage,
  resolveSurfaceImage,
};
