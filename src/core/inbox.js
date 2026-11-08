const path = require('path');

/**
 * Answer "what is on my desk that is not filed yet?" from plans the rule engine already built.
 * Works on local data only: nothing here is sent to an AI. `filter` may come from the AI, so it is sanitised.
 */
function cleanFilter(f = {}) {
  const exts = Array.isArray(f.exts) ? f.exts.map((e) => String(e).toLowerCase().replace(/^\./, '')).filter((e) => /^[a-z0-9]{1,10}$/.test(e)).slice(0, 20) : [];
  const age = Number(f.minAgeDays);
  return {
    scope: f.scope === 'all' ? 'all' : 'unsorted',
    exts,
    minAgeDays: Number.isFinite(age) && age > 0 ? Math.min(age, 3650) : 0,
    nameLike: typeof f.nameLike === 'string' ? f.nameLike.trim().slice(0, 60).toLowerCase() : '',
    folder: typeof f.folder === 'string' ? f.folder.trim().slice(0, 120).toLowerCase() : '',
    sort: ['newest', 'oldest', 'largest'].includes(f.sort) ? f.sort : 'newest',
  };
}

function listFiles(sources, filter = {}, { limit = 30, now = Date.now() } = {}) {
  const f = cleanFilter(filter);
  const rows = [];
  // folder: tolerant match on "D:download", "D:\Downloads", "downloads" -> compare letters/digits only
  const norm = (p) => String(p).toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
  const folderKey = norm(f.folder);
  for (const s of sources) {
    if (folderKey) {
      const full = norm(s.sourceDir), base = norm(path.basename(s.sourceDir));
      const hit = full.includes(folderKey) || folderKey.includes(full) || (base && (folderKey.includes(base) || base.includes(folderKey)));
      if (!hit) continue;
    }
    const files = f.scope === 'all' ? [...s.unmatched, ...s.items] : s.unmatched;
    for (const x of files) {
      if (f.exts.length && !f.exts.includes(x.ext)) continue;
      if (f.minAgeDays && (now - x.mtime) / 864e5 < f.minAgeDays) continue;
      if (f.nameLike && !x.name.toLowerCase().includes(f.nameLike)) continue;
      rows.push({ name: x.name, src: x.src, ext: x.ext, size: x.size, mtime: x.mtime, folder: path.basename(s.sourceDir), sorted: !!x.dest, to: x.rel || '', conf: x.confidence || '' });
    }
  }
  // "movable" = files that already have a proposed destination the app is confident about
  const movable = rows.filter((r) => r.sorted && r.conf !== 'low');
  const groups = new Map();
  for (const r of movable) groups.set(r.to, (groups.get(r.to) || 0) + 1);
  const advice = {
    movable: movable.length,
    movableSrcs: movable.slice(0, 500).map((r) => r.src),
    groups: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([to, n]) => ({ to, n })),
    unplaced: rows.length - movable.length,
    unplacedSrcs: rows.filter((r) => !(r.sorted && r.conf !== 'low')).slice(0, 500).map((r) => r.src),
  };
  rows.sort(f.sort === 'oldest' ? (a, b) => a.mtime - b.mtime : f.sort === 'largest' ? (a, b) => b.size - a.size : (a, b) => b.mtime - a.mtime);
  return { filter: f, advice, total: rows.length, bytes: rows.reduce((n, r) => n + r.size, 0), items: rows.slice(0, limit) };
}

module.exports = { listFiles, cleanFilter };
