const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { walk } = require('./util');
const { matchCapture, classifyExt } = require('./rules');

/** Old screen captures and old installers (by modified time). */
async function scanStale(dirs, { captureDays = 30, installerDays = 14 } = {}) {
  const captures = [], installers = [];
  const now = Date.now();
  for (const dir of dirs) {
    await walk(dir, {
      depth: 2,
      onFile: async (p, name) => {
        let st;
        try { st = await fs.promises.stat(p); } catch { return; }
        const ext = path.extname(name).toLowerCase().slice(1);
        const file = { name, ext };
        const ageDays = (now - st.mtimeMs) / 864e5;
        const row = { path: p, name, size: st.size, mtime: st.mtimeMs, ageDays: Math.floor(ageDays) };
        const inCaptureFolder = /(^|[\\/])(captures|screenshots|บันทึกหน้าจอ)([\\/]|$)/i.test(path.dirname(p));
        if ((matchCapture(file) || inCaptureFolder) && ageDays >= captureDays) captures.push(row);
        else if (classifyExt(ext)?.id === 'installers' && ageDays >= installerDays) installers.push(row);
      },
    });
  }
  return { captures, installers };
}

/** Shortcuts whose target no longer exists. `readLink(p)` returns {target} (Electron's shell.readShortcutLink). */
async function scanDeadShortcuts(dir, readLink) {
  const out = [];
  let entries = [];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || path.extname(e.name).toLowerCase() !== '.lnk') continue;
    const p = path.join(dir, e.name);
    let target = '';
    try { target = (readLink(p) || {}).target || ''; } catch { continue; }
    if (!target || /^shell:|^\\\\|^[a-z]+:\/\//i.test(target)) continue; // Store apps / network / URLs: can't judge
    if (!fs.existsSync(target)) out.push({ path: p, name: e.name, target });
  }
  return out;
}

function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Exact duplicate files (same size + SHA-1). Keeps the oldest copy as `keep`. */
async function findDuplicates(dirs, { depth = 3, maxFileMB = 2048 } = {}) {
  const bySize = new Map();
  for (const dir of dirs) {
    await walk(dir, {
      depth,
      max: 30000,
      onFile: async (p) => {
        let st;
        try { st = await fs.promises.stat(p); } catch { return; }
        if (st.size === 0 || st.size > maxFileMB * 1048576) return;
        const arr = bySize.get(st.size) || [];
        arr.push({ path: p, mtime: st.mtimeMs, size: st.size });
        bySize.set(st.size, arr);
      },
    });
  }
  const groups = [];
  for (const arr of bySize.values()) {
    if (arr.length < 2) continue;
    const byHash = new Map();
    for (const f of arr) {
      try {
        const h = await hashFile(f.path);
        (byHash.get(h) || byHash.set(h, []).get(h)).push(f);
      } catch { /* locked */ }
    }
    for (const [hash, files] of byHash) {
      if (files.length < 2) continue;
      files.sort((a, b) => a.mtime - b.mtime);
      groups.push({ hash, size: files[0].size, keep: files[0].path, files });
    }
  }
  groups.sort((a, b) => b.size * b.files.length - a.size * a.files.length);
  return groups;
}

module.exports = { scanStale, scanDeadShortcuts, findDuplicates };
