const { norm } = require('./util');

const GENERIC = new Set([
  'screenshot', 'recording', 'image', 'img', 'copy', 'new', 'untitled', 'document', 'doc', 'file', 'final', 'draft', 'scan',
  'photo', 'video', 'line', 'chatgpt', 'whatsapp', 'download', 'setup', 'report', 'test', 'temp', 'data', 'sheet', 'export',
  'backup', 'screen', 'capture', 'invoice', 'receipt', 'page', 'book', 'form', 'the', 'and',
]);

const tokens = (stem) => stem.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const isNum = (s) => /^\d+$/.test(s);

/**
 * Groups files that belong to the same "project" by shared name prefix, or by an existing
 * folder whose name matches the prefix (e.g. iso-one-pp.xlsx -> ISO_ONE).
 * Returns Map(src -> {folder, existing, confidence})
 */
function assignProjects(files, folderMap) {
  const info = files.map((f) => {
    const t = tokens(f.stem);
    const t0 = t[0];
    const ok0 = t0 && t0.length >= 3 && !isNum(t0) && !GENERIC.has(t0.toLowerCase());
    const ok1 = ok0 && t[1] && !isNum(t[1]);
    return {
      f, t,
      k1: ok0 ? norm(t0) : null,
      k2: ok1 ? norm(t0 + t[1]) : null,
      k3: ok1 && t[2] && !isNum(t[2]) ? norm(t0 + t[1] + t[2]) : null,
    };
  });
  const c1 = new Map(), c2 = new Map();
  for (const i of info) {
    if (i.k1) c1.set(i.k1, (c1.get(i.k1) || 0) + 1);
    if (i.k2) c2.set(i.k2, (c2.get(i.k2) || 0) + 1);
  }
  const display = new Map();
  const result = new Map();
  for (const i of info) {
    let done = false;
    for (const k of [i.k3, i.k2, i.k1]) {
      if (k && k.length >= 4 && folderMap.has(k)) {
        result.set(i.f.src, { folder: folderMap.get(k), existing: true, confidence: 'high' });
        done = true;
        break;
      }
    }
    if (done) continue;
    let key = null, name = null;
    if (i.k2 && c2.get(i.k2) >= 2) { key = 'b:' + i.k2; name = `${i.t[0]}_${i.t[1]}`; }
    else if (i.k1 && c1.get(i.k1) >= 2) { key = 'a:' + i.k1; name = i.t[0]; }
    if (key) {
      if (!display.has(key)) display.set(key, name);
      result.set(i.f.src, { folder: display.get(key), existing: false, confidence: 'medium' });
    }
  }
  return result;
}

module.exports = { assignProjects };
