'use strict';
/**
 * 浮窗位置计算（src/main/position.js）
 *
 * F-12：译文浮窗优先显示在框选区域附近；若右侧/下方空间不足则翻转到左侧/上方；
 * 仍不足则夹取到工作区内（多显示器时以该区域所在显示器的工作区为准）。
 */

const GAP = 12; // 浮窗与框选区域的间距

/** 判断两个矩形是否相交 */
function intersects(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

/**
 * @param {object} opts
 * @param {{x:number,y:number,width:number,height:number}} opts.region 框选区域（屏幕坐标）
 * @param {{width:number,height:number}} opts.size           浮窗尺寸
 * @param {{x:number,y:number,width:number,height:number}} opts.workArea 显示器工作区
 * @param {string} [opts.mode]   'auto' | 'top' | 'left' | 'right' | 'bottom' | 'fixed'
 * @param {{x:number,y:number}} [opts.fixedPoint]
 * @returns {{x:number,y:number,placement:string}}
 */
function computeHudPosition({ region, size, workArea, mode = 'auto', fixedPoint }) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const maxX = workArea.x + workArea.width - size.width;
  const maxY = workArea.y + workArea.height - size.height;

  if (mode === 'fixed' && fixedPoint) {
    return { x: Math.round(clamp(fixedPoint.x, workArea.x, maxX)), y: Math.round(clamp(fixedPoint.y, workArea.y, maxY)), placement: 'fixed' };
  }
  if (!region) {
    // 没有框选区域时贴工作区右下角（托盘触发的「展开浮窗」）
    return { x: Math.round(maxX - 24), y: Math.round(Math.max(workArea.y, maxY - 24)), placement: 'corner' };
  }

  const right = region.x + region.width + GAP;
  const left = region.x - size.width - GAP;
  const below = region.y + region.height + GAP;
  const above = region.y - size.height - GAP;

  const fitsRight = right + size.width <= workArea.x + workArea.width;
  const fitsLeft = left >= workArea.x;
  const fitsBelow = below + size.height <= workArea.y + workArea.height;
  const fitsAbove = above >= workArea.y;

  let x;
  let y;
  let placement;

  const wantTop = mode === 'top';
  const wantLeft = mode === 'left';
  const wantRight = mode === 'right';
  const wantBottom = mode === 'bottom';

  if (wantRight && fitsRight) {
    x = right; y = region.y; placement = 'right';
  } else if (wantLeft && fitsLeft) {
    x = left; y = region.y; placement = 'left';
  } else if (wantTop && fitsAbove) {
    x = region.x; y = above; placement = 'above';
  } else if (wantBottom && fitsBelow) {
    x = region.x; y = below; placement = 'below';
  } else if (fitsRight) {
    x = right; y = region.y; placement = 'right';
  } else if (fitsLeft) {
    x = left; y = region.y; placement = 'left';
  } else if (fitsBelow) {
    x = region.x; y = below; placement = 'below';
  } else if (fitsAbove) {
    x = region.x; y = above; placement = 'above';
  } else {
    // 四周都放不下：夹取到工作区，并尽量不遮挡框选区域（优先放上方）
    placement = 'clamped';
    y = clamp(above, workArea.y, maxY);
    x = clamp(region.x, workArea.x, maxX);
    if (intersects({ x, y, width: size.width, height: size.height }, region)) {
      y = clamp(below, workArea.y, maxY);
    }
  }

  return { x: Math.round(clamp(x, workArea.x, maxX)), y: Math.round(clamp(y, workArea.y, maxY)), placement };
}

module.exports = { computeHudPosition, intersects, GAP };
