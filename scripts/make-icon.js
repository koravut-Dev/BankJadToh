// Generates assets/icon.png (256x256): a rounded square with a tidy "table" glyph. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4);

function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - r - 1 : x;
  const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    let c = [0, 0, 0, 0];
    if (inRound(x, y, 8, 8, 248, 248, 56)) {
      const t = (x + y) / (2 * S);
      c = [Math.round(60 + 60 * t), Math.round(110 + 40 * t), Math.round(240 - 20 * t), 255]; // blue gradient
      // tabletop
      if (inRound(x, y, 48, 96, 208, 128, 10)) c = [255, 255, 255, 255];
      // legs
      if (inRound(x, y, 64, 128, 88, 196, 6) || inRound(x, y, 168, 128, 192, 196, 6)) c = [255, 255, 255, 255];
      // tidy items on the table
      if (inRound(x, y, 70, 64, 100, 94, 6)) c = [255, 214, 90, 255];
      if (inRound(x, y, 112, 52, 142, 94, 6)) c = [120, 235, 190, 255];
      if (inRound(x, y, 154, 72, 184, 94, 6)) c = [255, 140, 150, 255];
    }
    px.set(c, i);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
