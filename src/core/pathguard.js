// The page can only ask the main process to touch files that live inside the folders Bank JadToh manages.
// Defence in depth: even if some page code were ever tricked into running, it still could not open, trash or encrypt arbitrary paths.
const fs = require('fs');
const path = require('path');

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }; // follows junctions/symlinks so a link cannot point outside
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function inside(root, p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) return false;
  const rel = path.relative(norm(real(root)), norm(real(p)));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
const insideAny = (roots, p) => (roots || []).some((r) => r && inside(r, p));

// files that run code when opened: these are shown in Explorer instead of being launched
const RUNNABLE = new Set(['.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.reg', '.lnk', '.url', '.cpl', '.msc', '.jar', '.appx', '.msix', '.dll']);
const isRunnable = (p) => RUNNABLE.has(path.extname(String(p || '')).toLowerCase());

module.exports = { inside, insideAny, isRunnable };
