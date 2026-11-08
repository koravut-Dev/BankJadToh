const fs = require('fs');
const path = require('path');
const { uniquePath, moveFile, sanitizeName, missingDirs } = require('./util');

class Journal {
  constructor(file) {
    this.file = file;
    this.data = { batches: [] };
    this.onChange = null; // called after a batch is added or undone (drives the live widget)
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new journal */ }
    if (!Array.isArray(this.data.batches)) this.data.batches = [];
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }

  add({ label, kind = 'organize', moves }) {
    const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: Date.now(), label, kind, moves, undone: false };
    this.data.batches.push(b);
    if (this.data.batches.length > 500) this.data.batches.splice(0, this.data.batches.length - 500);
    this.save();
    if (this.onChange) { try { this.onChange(); } catch { /* listener must never break filing */ } }
    return b;
  }

  list() { return [...this.data.batches].reverse(); }
  get(id) { return this.data.batches.find((b) => b.id === id); }

  /** Most recent not-undone move whose original location was `from`. */
  findMoveFrom(from, maxAgeMs = 7 * 864e5) {
    for (const b of [...this.data.batches].reverse()) {
      if (b.undone || Date.now() - b.time > maxAgeMs) continue;
      for (const m of b.moves) if (m.from === from && !m.restored) return { batch: b, move: m };
    }
    return null;
  }

  async undo(id) {
    const b = this.get(id);
    if (!b) throw new Error('batch not found');
    if (b.undone) throw new Error('already undone');
    b.undone = true;
    this.save();
    const results = [];
    for (const m of [...b.moves].reverse()) {
      if (!fs.existsSync(m.to)) { results.push({ ...m, ok: false, error: 'missing' }); continue; }
      try {
        const target = uniquePath(m.from);
        await moveFile(m.to, target);
        m.restored = true;
        results.push({ ...m, ok: true, restoredTo: target });
        for (const d of m.createdDirs || []) { try { fs.rmdirSync(d); } catch { /* not empty / gone */ } }
      } catch (e) {
        results.push({ ...m, ok: false, error: e.code || e.message });
      }
    }
    this.save();
    if (this.onChange) { try { this.onChange(); } catch { /* ignore */ } }
    return results;
  }
}

/** Apply plan items (move files) and record one journal batch. */
async function applyItems(items, journal, { label = 'Organize', kind = 'organize' } = {}) {
  const moves = [], results = [];
  for (const it of items) {
    try {
      if (!fs.existsSync(it.src)) { results.push({ src: it.src, ok: false, error: 'missing' }); continue; }
      const ext = path.extname(it.src);
      const base = it.newName ? sanitizeName(it.newName) + ext : path.basename(it.src);
      const createdDirs = missingDirs(it.dest);
      const target = uniquePath(path.join(it.dest, base));
      await moveFile(it.src, target);
      moves.push({ from: it.src, to: target, category: it.category, ext: it.ext, createdDirs });
      results.push({ src: it.src, ok: true, to: target });
    } catch (e) {
      results.push({ src: it.src, ok: false, error: e.code || e.message });
    }
  }
  const batch = moves.length ? journal.add({ label, kind, moves }) : null;
  return { batch, results };
}

module.exports = { Journal, applyItems };
