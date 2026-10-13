// 의존성 없이 PNG 아이콘을 생성한다: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const colors = [[255, 79, 216], [79, 232, 255], [79, 232, 255], [255, 79, 216]];
function pixel(u, v) {
  // 어두운 배경 + 4개의 네온 레인 + 아래쪽 판정선
  let r = 5 + 14 * v, g = 5 + 6 * v, b = 15 + 30 * v;
  const lane = Math.floor(((u - 0.15) / 0.7) * 4);
  if (u > 0.15 && u < 0.85 && v > 0.12) {
    const lu = (((u - 0.15) / 0.7) * 4) % 1;
    if (lu > 0.1 && lu < 0.9) {
      const c = colors[lane];
      const a = 0.25 + 0.35 * v;
      r += c[0] * a; g += c[1] * a; b += c[2] * a;
      // 노트
      const noteY = [0.35, 0.55, 0.45, 0.65][lane];
      if (Math.abs(v - noteY) < 0.035 && lu > 0.18 && lu < 0.82) { r = 255; g = 255; b = 255; }
    }
  }
  if (Math.abs(v - 0.82) < 0.012 && u > 0.12 && u < 0.88) { r = 255; g = 255; b = 255; }
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}
writeFileSync('public/icons/icon-192.png', png(192, pixel));
writeFileSync('public/icons/icon-512.png', png(512, pixel));
console.log('icons written');
