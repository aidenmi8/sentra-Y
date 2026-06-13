import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GOLD = [212, 175, 55, 255];
const CYAN = [0, 229, 255, 255];
const BG = [6, 6, 12, 255];
const MUTED = [92, 90, 84, 255];

const glyphs = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
};

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function image(width, height) {
  return Buffer.alloc(width * height * 4);
}

function setPx(buf, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (Math.floor(y) * width + Math.floor(x)) * 4;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = color[3];
}

function fill(buf, width, height, color) {
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = color[0];
    buf[i * 4 + 1] = color[1];
    buf[i * 4 + 2] = color[2];
    buf[i * 4 + 3] = color[3];
  }
}

function fillRect(buf, width, height, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(buf, width, height, xx, yy, color);
  }
}

function drawLine(buf, width, height, x1, y1, x2, y2, color, thickness = 1) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    fillRect(buf, width, height, Math.round(x - thickness / 2), Math.round(y - thickness / 2), thickness, thickness, color);
  }
}

function drawRing(buf, width, height, cx, cy, radius, thickness, color) {
  const min = radius - thickness / 2;
  const max = radius + thickness / 2;
  for (let y = Math.floor(cy - max); y <= Math.ceil(cy + max); y++) {
    for (let x = Math.floor(cx - max); x <= Math.ceil(cx + max); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= min && d <= max) setPx(buf, width, height, x, y, color);
    }
  }
}

function textWidth(text, cell, gap) {
  return text.split('').reduce((sum, ch) => {
    if (ch === ' ') return sum + cell * 3;
    return sum + (glyphs[ch]?.[0].length || 5) * cell + gap;
  }, -gap);
}

function drawText(buf, width, height, text, x, y, cell, color, gap = Math.max(1, Math.floor(cell))) {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {
      cursor += cell * 3;
      continue;
    }
    const glyph = glyphs[ch];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] === '1') fillRect(buf, width, height, cursor + col * cell, y + row * cell, cell, cell, color);
      }
    }
    cursor += glyph[0].length * cell + gap;
  }
}

function icon(size) {
  const buf = image(size, size);
  fill(buf, size, size, BG);
  const cx = size / 2;
  const cy = size / 2;
  drawRing(buf, size, size, cx, cy, size * 0.39, Math.max(1, Math.round(size * 0.018)), GOLD);
  drawRing(buf, size, size, cx, cy, size * 0.29, Math.max(1, Math.round(size * 0.012)), [0, 229, 255, 190]);
  drawLine(buf, size, size, cx, size * 0.15, cx, size * 0.26, CYAN, Math.max(1, Math.round(size * 0.012)));
  drawLine(buf, size, size, cx, size * 0.74, cx, size * 0.85, CYAN, Math.max(1, Math.round(size * 0.012)));
  drawLine(buf, size, size, size * 0.15, cy, size * 0.26, cy, GOLD, Math.max(1, Math.round(size * 0.012)));
  drawLine(buf, size, size, size * 0.74, cy, size * 0.85, cy, GOLD, Math.max(1, Math.round(size * 0.012)));
  const cell = Math.max(1, Math.floor(size / 16));
  const label = 'SM8';
  drawText(buf, size, size, label, Math.round((size - textWidth(label, cell, cell)) / 2), Math.round(size * 0.42), cell, GOLD, cell);
  return png(size, size, buf);
}

function ogImage() {
  const width = 1200;
  const height = 630;
  const buf = image(width, height);
  fill(buf, width, height, BG);
  for (let i = 0; i < 14; i++) drawRing(buf, width, height, 350, 315, 90 + i * 12, 2, i % 2 ? [0, 229, 255, 80] : [212, 175, 55, 90]);
  const mark = 'SM8';
  drawText(buf, width, height, mark, 275, 285, 18, GOLD, 18);
  drawText(buf, width, height, 'SENTRA MI8', 560, 245, 18, GOLD, 8);
  drawText(buf, width, height, 'GLOBAL INTELLIGENCE', 565, 385, 8, CYAN, 5);
  drawLine(buf, width, height, 560, 360, 1010, 360, MUTED, 2);
  return png(width, height, buf);
}

function icoFromPng(pngBytes) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBytes.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngBytes]);
}

writeFileSync('public/favicon-16x16.png', icon(16));
const favicon32 = icon(32);
writeFileSync('public/favicon-32x32.png', favicon32);
writeFileSync('public/favicon.ico', icoFromPng(favicon32));
writeFileSync('public/apple-touch-icon.png', icon(180));
writeFileSync('public/android-chrome-192x192.png', icon(192));
writeFileSync('public/icon-192.png', icon(192));
const icon512 = icon(512);
writeFileSync('public/android-chrome-512x512.png', icon512);
writeFileSync('public/sentra-mi8-icon.png', icon512);
writeFileSync('public/casaos-icon.png', icon512);
writeFileSync('public/og-image.png', ogImage());

console.log('Generated Sentra Mi8 brand assets.');
