// Wallpaper analysis + icon layout planning. Pure functions (no Electron) so they can be unit-tested.
// "Salient" = the part of the picture a user would not want icons on: strong edges / detail, and areas
// whose brightness differs a lot from the rest of the picture (e.g. big bright lettering on a dark wallpaper).
// This is a heuristic, not an understanding of the picture.

/** Map a source image onto a screen-shaped canvas the way Windows does for the given wallpaper style. */
function fitToScreen(src, screen, mode, outW = 192) {
  const outH = Math.max(1, Math.round(outW * screen.h / screen.w));
  const out = new Uint8Array(outW * outH * 4);   // RGBA-ish, same channel order as src
  const covered = new Uint8Array(outW * outH);   // 1 = wallpaper pixel, 0 = letterbox/background colour
  const sx = screen.w / outW, sy = screen.h / outH;
  let scaleX, scaleY, offX, offY;
  if (mode === 'stretch') { scaleX = screen.w / src.w; scaleY = screen.h / src.h; offX = offY = 0; }
  else if (mode === 'fit') { const s = Math.min(screen.w / src.w, screen.h / src.h); scaleX = scaleY = s; offX = (screen.w - src.w * s) / 2; offY = (screen.h - src.h * s) / 2; }
  else if (mode === 'center') { scaleX = scaleY = 1; offX = (screen.w - src.w) / 2; offY = (screen.h - src.h) / 2; }
  else { const s = Math.max(screen.w / src.w, screen.h / src.h); scaleX = scaleY = s; offX = (screen.w - src.w * s) / 2; offY = (screen.h - src.h * s) / 2; } // fill / span
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const u = Math.floor(((x + 0.5) * sx - offX) / scaleX), v = Math.floor(((y + 0.5) * sy - offY) / scaleY);
      if (u < 0 || v < 0 || u >= src.w || v >= src.h) continue;
      const si = (v * src.w + u) * 4, di = (y * outW + x) * 4;
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1]; out[di + 2] = src.data[si + 2]; out[di + 3] = 255;
      covered[y * outW + x] = 1;
    }
  }
  return { data: out, covered, w: outW, h: outH };
}

const luma = (d, i, bgra) => (bgra ? 0.114 * d[i] + 0.587 * d[i + 1] + 0.299 * d[i + 2] : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);

/** Returns {cols, rows, score: Float32Array 0..1 per cell}. Letterboxed (uncovered) pixels never count as salient. */
function saliency(img, { cols = 48, rows = 27, bgra = true } = {}) {
  const { data, covered, w, h } = img;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = luma(data, i * 4, bgra);
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    edge[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
  }
  let sum = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (covered[i]) { sum += g[i]; n++; }
  const mean = n ? sum / n : 0;

  const E = new Float32Array(cols * rows), D = new Float32Array(cols * rows), C = new Float32Array(cols * rows);
  for (let i = 0; i < w * h; i++) {
    if (!covered[i]) continue;
    const cx = Math.min(cols - 1, Math.floor(((i % w) / w) * cols)), cy = Math.min(rows - 1, Math.floor((Math.floor(i / w) / h) * rows));
    const c = cy * cols + cx;
    E[c] += edge[i]; D[c] += Math.abs(g[i] - mean); C[c]++;
  }
  for (let c = 0; c < cols * rows; c++) if (C[c]) { E[c] /= C[c]; D[c] /= C[c]; }
  const p95 = (arr) => { const s = [...arr].filter((v) => v > 0).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * 0.95)] || 1 : 1; };
  const e95 = p95(E) || 1, d95 = p95(D) || 1;
  const score = new Float32Array(cols * rows);
  // either strong detail OR a large brightness difference from the rest of the picture makes a cell salient
  for (let c = 0; c < cols * rows; c++) score[c] = C[c] ? Math.min(1, Math.max(E[c] / e95, 0.9 * (D[c] / d95))) : 0;
  return { cols, rows, score };
}

/**
 * Mark cells as busy: at most the most salient `protectPct` percent, and only cells that are genuinely salient
 * (score >= absThr, where 1.0 = the level of the strongest 5% of the picture). A plain wallpaper therefore
 * protects almost nothing. The mask is then grown by `grow` cells for a safety margin.
 */
function busyMask(sal, { protectPct = 30, grow = 1, absThr = 0.5 } = {}) {
  const { cols, rows, score } = sal;
  const sorted = [...score].sort((a, b) => a - b);
  const pct = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - protectPct / 100)))];
  const thr = Math.max(pct, absThr);
  let mask = Uint8Array.from(score, (v) => (v > 0 && v >= thr ? 1 : 0));
  for (let k = 0; k < grow; k++) {
    const next = Uint8Array.from(mask);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!mask[y * cols + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) next[ny * cols + nx] = 1;
      }
    }
    mask = next;
  }
  return { cols, rows, mask };
}

/**
 * Lay icons out in column-major order (like Windows) using only cells that are not on the subject.
 * Overflow goes to the least busy remaining cells.
 * items: names in the order they should appear. Coordinates are the top-left of each icon cell, in screen pixels.
 */
function planLayout({ items, screenW, screenH, cellW, cellH, margin = 8, marginX = margin, marginY = margin, workH = screenH, busy, maxBusyFrac = 0.3, anchor = 'left' }) {
  const cols = Math.max(1, Math.floor((screenW - marginX * 2) / cellW));
  const rows = Math.max(1, Math.floor((workH - marginY * 2) / cellH));
  const cells = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = marginX + c * cellW, y = marginY + r * cellH;
      // fraction of the busy grid covered by this icon cell
      const x0 = Math.floor((x / screenW) * busy.cols), x1 = Math.max(x0, Math.min(busy.cols - 1, Math.floor(((x + cellW - 1) / screenW) * busy.cols)));
      const y0 = Math.floor((y / screenH) * busy.rows), y1 = Math.max(y0, Math.min(busy.rows - 1, Math.floor(((y + cellH - 1) / screenH) * busy.rows)));
      let tot = 0, hit = 0;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { tot++; hit += busy.mask[yy * busy.cols + xx]; }
      cells.push({ x, y, c, r, frac: tot ? hit / tot : 0 });
    }
  }
  // which edge the icons hug: the order the free cells are filled in
  const order = {
    left: (a, b) => a.c - b.c || a.r - b.r, right: (a, b) => b.c - a.c || a.r - b.r,
    top: (a, b) => a.r - b.r || a.c - b.c, bottom: (a, b) => b.r - a.r || a.c - b.c,
  }[anchor] || ((a, b) => a.c - b.c || a.r - b.r);
  const free = cells.filter((c) => c.frac <= maxBusyFrac).sort(order);
  const rest = cells.filter((c) => c.frac > maxBusyFrac).sort((a, b) => a.frac - b.frac || order(a, b));
  const slots = [...free, ...rest];
  const positions = items.map((name, i) => ({ name, x: slots[i % slots.length].x, y: slots[i % slots.length].y, onSubject: i >= free.length }));
  // how far, on average, the icons sit from the chosen edge (lower = tidier)
  const dist = { left: (p) => p.x, right: (p) => screenW - p.x, top: (p) => p.y, bottom: (p) => screenH - p.y }[anchor] || ((p) => p.x);
  const spread = positions.length ? positions.reduce((a, p) => a + dist(p), 0) / positions.length : 0;
  return { positions, cols, rows, freeCells: free.length, totalCells: cells.length, overflow: Math.max(0, items.length - free.length), cells, anchor, spread };
}

module.exports = { fitToScreen, saliency, busyMask, planLayout };
