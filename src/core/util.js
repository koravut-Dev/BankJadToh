const fs = require('fs');
const path = require('path');

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; i < 10000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return path.join(dir, `${name}-${Date.now()}${ext}`);
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sanitizeName(s, max = 120) {
  return String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, max);
}

async function moveFile(src, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.promises.rename(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
      await fs.promises.unlink(src);
    } else throw e;
  }
}

/** Non-existing ancestors of dir (leaf first) so undo can clean up only what we created. */
function missingDirs(dir) {
  const out = [];
  let cur = dir;
  while (cur && !fs.existsSync(cur)) {
    out.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '$recycle.bin', 'appdata']);

async function walk(dir, { depth = 2, skipDirs = DEFAULT_SKIP_DIRS, onFile, max = 50000 } = {}) {
  let count = 0;
  async function rec(d, lvl) {
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (count >= max) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (lvl < depth && !skipDirs.has(e.name.toLowerCase())) await rec(p, lvl + 1);
      } else if (e.isFile()) {
        count++;
        await onFile(p, e.name);
      }
    }
  }
  await rec(dir, 0);
}

module.exports = { norm, uniquePath, monthKey, sanitizeName, moveFile, missingDirs, walk };
