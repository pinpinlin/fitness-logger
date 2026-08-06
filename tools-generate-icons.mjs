// 產生 PNG 圖示（純 node，無外部庫）：深底＋藍色啞鈴示意
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [17, 18, 20, 255], BAR = [79, 157, 255, 255], PLATE = [242, 243, 245, 255];
function draw(x, y, size) {
  const u = x / size, v = y / size;               // 0..1
  const midY = Math.abs(v - 0.5);
  // 中央握把（細長橫桿）
  if (midY < 0.055 && u > 0.28 && u < 0.72) return BAR;
  // 兩側槓片（較粗直塊）
  if (midY < 0.20 && ((u > 0.18 && u < 0.30) || (u > 0.70 && u < 0.82))) return PLATE;
  if (midY < 0.12 && ((u > 0.12 && u < 0.20) || (u > 0.80 && u < 0.88))) return PLATE;
  return BG;
}

const dir = fileURLToPath(new URL('./icons/', import.meta.url));
for (const [name, size] of [['icon-192.png', 192], ['icon-512-maskable.png', 512], ['apple-touch-icon-180.png', 180]]) {
  writeFileSync(dir + name, png(size, draw));
  console.log('wrote', name, size);
}
