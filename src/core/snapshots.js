const fs = require('fs');
const path = require('path');
const { uniquePath, moveFile } = require('./util');

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name.toLowerCase() !== 'desktop.ini').map((e) => {
      let st = null;
      try { st = fs.statSync(path.join(dir, e.name)); } catch { /* ignore */ }
      return { name: e.name, dir: e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
    });
  } catch { return []; }
}

class Snapshots {
  constructor(dir) { this.dir = dir; }

  take(folders, { force = false } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, dayKey() + '.json');
    if (!force && fs.existsSync(file)) return null;
    const snap = { date: dayKey(), time: Date.now(), folders: Object.fromEntries(folders.map((f) => [f, listDir(f)])) };
    fs.writeFileSync(file, JSON.stringify(snap));
    // keep 60 days
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 60))) { try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* ignore */ } }
    return snap;
  }

  list() {
    try {
      return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => f.replace('.json', ''));
    } catch { return []; }
  }

  load(date) { return JSON.parse(fs.readFileSync(path.join(this.dir, date + '.json'), 'utf8')); }

  /** Compare a snapshot to the current state of its folders. */
  diff(date) {
    const snap = this.load(date);
    const out = [];
    for (const [folder, entries] of Object.entries(snap.folders)) {
      const now = new Set(listDir(folder).map((e) => e.name));
      const before = new Set(entries.map((e) => e.name));
      out.push({
        folder,
        missing: entries.filter((e) => !now.has(e.name)).map((e) => e.name),
        added: [...now].filter((n) => !before.has(n)),
      });
    }
    return out;
  }

  /** Put back files that are missing from the folder if the journal knows where they were moved to. */
  async restore(date, journal) {
    const restored = [], notFound = [];
    for (const d of this.diff(date)) {
      for (const name of d.missing) {
        const from = path.join(d.folder, name);
        const hit = journal.findMoveFrom(from, 365 * 864e5);
        if (hit && fs.existsSync(hit.move.to)) {
          await moveFile(hit.move.to, uniquePath(from));
          hit.move.restored = true;
          restored.push(name);
        } else notFound.push(name);
      }
    }
    journal.save();
    return { restored, notFound };
  }
}

module.exports = { Snapshots };
