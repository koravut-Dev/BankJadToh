// Perceptual image hashing (dHash) so visually similar images can be found, not only byte-identical ones.
// The caller (Electron main) decodes an image and downsizes it to 9x8; this module is pure and testable.

const W = 9, H = 8;

/** @param {Uint8Array|Buffer} bmp 9x8 pixels, 4 bytes each. @param {boolean} bgra Electron on Windows gives BGRA. */
function dhash(bmp, bgra = true) {
  const luma = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = bmp[i * 4], b = bmp[i * 4 + 1], c = bmp[i * 4 + 2];
    const r = bgra ? c : a, g = b, bl = bgra ? a : c;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
  }
  let mean = 0;
  for (const v of luma) mean += v;
  mean /= luma.length;
  let variance = 0;
  for (const v of luma) variance += (v - mean) ** 2;
  variance /= luma.length;

  let hi = 0, lo = 0, bit = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const on = luma[y * W + x] > luma[y * W + x + 1] ? 1 : 0;
      if (bit < 32) hi = ((hi << 1) | on) >>> 0; else lo = ((lo << 1) | on) >>> 0;
      bit++;
    }
  }
  const hex = (n) => n.toString(16).padStart(8, '0');
  return { hash: hex(hi) + hex(lo), flat: variance < 4 }; // flat = near-solid image: its hash is meaningless
}

function popcount(n) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hamming(a, b) {
  return popcount((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0) + popcount((parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0);
}

/**
 * Group images whose hashes differ by <= maxDist bits (of 64). Union-find, so A~B and B~C end up together.
 * items: [{path, hash, w, h, size, mtime}]. The kept file is the one with most pixels, then largest, then oldest.
 */
function groupSimilar(items, maxDist = 4) {
  const n = items.length, parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const hi = items.map((it) => parseInt(it.hash.slice(0, 8), 16) >>> 0), lo = items.map((it) => parseInt(it.hash.slice(8), 16) >>> 0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (popcount((hi[i] ^ hi[j]) >>> 0) + popcount((lo[i] ^ lo[j]) >>> 0) <= maxDist) parent[find(j)] = find(i);
    }
  }
  const buckets = new Map();
  items.forEach((it, i) => { const r = find(i); (buckets.get(r) || buckets.set(r, []).get(r)).push(it); });
  const groups = [];
  for (const files of buckets.values()) {
    if (files.length < 2) continue;
    files.sort((a, b) => (b.w * b.h - a.w * a.h) || (b.size - a.size) || (a.mtime - b.mtime));
    let worst = 0;
    for (const f of files.slice(1)) worst = Math.max(worst, hamming(files[0].hash, f.hash));
    groups.push({ keep: files[0].path, files, maxDist: worst, similarity: Math.round((1 - worst / 64) * 100) });
  }
  groups.sort((a, b) => b.files.length - a.files.length);
  return groups;
}

module.exports = { dhash, hamming, groupSimilar, W, H };
