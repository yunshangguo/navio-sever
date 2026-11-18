'use strict';
/**
 * 生成 build/icon.png（256×256）——纯 Node，无第三方依赖
 * 圆角渐变底 + 白色 M 字标
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256;
const H = 256;
const R = 58; // 圆角半径

/* ---- CRC32 ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- 几何 ---- */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function roundRectAlpha(x, y, w, h, r, pad) {
  const x0 = pad;
  const y0 = pad;
  const x1 = w - pad;
  const y1 = h - pad;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const d = Math.hypot(x - cx, y - cy);
  return r + 0.5 - d;
}

const lerp = (a, b, t) => a + (b - a) * t;

// 渐变两端
const C1 = [79, 140, 255];
const C2 = [139, 92, 246];

// M 字的笔画（粗线）
const STROKE_R = 11;
const STROKES = [
  [96, 78, 96, 176],
  [160, 78, 160, 176],
  [96, 78, 128, 134],
  [128, 134, 160, 78]
];

const buf = Buffer.alloc(W * H * 4);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const a = roundRectAlpha(x + 0.5, y + 0.5, W, H, R, 6);
    const bgA = Math.max(0, Math.min(1, a));
    if (bgA <= 0.001) {
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = 0;
      continue;
    }
    // 对角渐变 + 轻微径向提亮
    let t = ((x / W) * 0.42 + (y / H) * 0.58) * 1.0;
    const dx = (x - W * 0.3) / W;
    const dy = (y - H * 0.2) / H;
    const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 1.9) * 0.18;
    t = Math.min(1, t);
    let r = lerp(C1[0], C2[0], t);
    let g = lerp(C1[1], C2[1], t);
    let b = lerp(C1[2], C2[2], t);
    r = Math.min(255, r + 255 * glow);
    g = Math.min(255, g + 255 * glow);
    b = Math.min(255, b + 255 * glow);

    // M 字
    let md = Infinity;
    for (const s of STROKES) {
      md = Math.min(md, segDist(x + 0.5, y + 0.5, s[0], s[1], s[2], s[3]));
    }
    const letterA = Math.max(0, Math.min(1, STROKE_R + 0.5 - md));
    if (letterA > 0) {
      r = lerp(r, 255, letterA);
      g = lerp(g, 255, letterA);
      b = lerp(b, 255, letterA);
    }

    buf[i] = Math.round(r);
    buf[i + 1] = Math.round(g);
    buf[i + 2] = Math.round(b);
    buf[i + 3] = Math.round(255 * bgA);
  }
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePNG(W, H, buf));
console.log('icon written:', out, fs.statSync(out).size, 'bytes');
