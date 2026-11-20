'use strict';
/**
 * 极简 PNG 解码器（仅用于把截图 PNG 转成像素数组）。
 *
 * 为什么自己写：OCR 引擎需要原始像素，而项目不引入 sharp/canvas 这类原生依赖。
 * 支持的子集刚好覆盖我们自己的截图来源（GDI+ 与 Electron nativeImage）：
 * 8 位深、非隔行、颜色类型 0/2/4/6（灰度/灰度+A/RGB/RGBA）。
 */

const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * 解码 PNG。
 * @param {Buffer} buffer PNG 字节
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} RGBA 像素
 */
function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('decodePng: 需要 Buffer');
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (buffer[i] !== SIG[i]) throw new Error('decodePng: 不是 PNG 文件');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) break;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8];
      colorType = buffer[start + 9];
      interlace = buffer[start + 12];
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4; // 跳过 CRC
  }

  if (!width || !height) throw new Error('decodePng: 缺少 IHDR');
  if (bitDepth !== 8) throw new Error(`decodePng: 不支持位深 ${bitDepth}`);
  if (interlace !== 0) throw new Error('decodePng: 不支持隔行扫描');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`decodePng: 不支持颜色类型 ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const base = y * (stride + 1);
    const filter = raw[base];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[base + 1 + x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paeth(left, up, upLeft); break;
        default: throw new Error(`decodePng: 未知过滤器 ${filter}`);
      }
      line[x] = restored & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (channels === 4) {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = line[src + 3];
      } else if (channels === 3) {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = 255;
      } else if (channels === 2) {
        out[dst] = line[src];
        out[dst + 1] = line[src];
        out[dst + 2] = line[src];
        out[dst + 3] = line[src + 1];
      } else {
        out[dst] = line[src];
        out[dst + 1] = line[src];
        out[dst + 2] = line[src];
        out[dst + 3] = 255;
      }
    }

    prev.set(line);
  }

  return { width, height, data: out };
}

module.exports = { decodePng };
