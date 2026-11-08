const fs = require('fs');
const path = require('path');
const { norm, monthKey, sanitizeName } = require('./util');
const { CATEGORIES, byId, classifyExt, matchCapture, customMatch, shouldSkip } = require('./rules');
const { assignProjects } = require('./projects');
const { classifyShortcut, GROUP_LABELS } = require('./modes');

const isShortcut = (ext) => ext === 'lnk' || ext === 'url';

function shortcutFolderName(group, lang, folderMap) {
  const g = GROUP_LABELS[group];
  for (const a of [group, ...g.aliases, g.th, g.en]) {
    const hit = folderMap.get(norm(a));
    if (hit) return hit;
  }
  return g[lang] || g.en;
}

const DEV_FOLDERS = new Set(['.vs', 'node_modules', '.git', '.idea', '.vscode', '__pycache__']);
const PROJECT_OK = new Set(['documents', 'spreadsheets', 'presentations', 'code', 'archives', 'design']);

function catFolderName(cat, lang, folderMap) {
  for (const a of [cat.id, ...cat.aliases]) {
    const hit = folderMap.get(norm(a));
    if (hit) return hit;
  }
  return cat[lang] || cat.en;
}

function projectsFolderName(lang, folderMap) {
  return folderMap.get('projects') || folderMap.get(norm('โปรเจกต์')) || (lang === 'th' ? 'โปรเจกต์' : 'Projects');
}

function decide(file, ctx) {
  const { root, folderMap, lang, config, proj, aiAssign } = ctx;
  const ageDays = (Date.now() - file.mtime) / 864e5;
  const mk = (category, categoryLabel, destDir, source, confidence, reason, extra = {}) => ({
    id: file.src, src: file.src, name: file.name, ext: file.ext, size: file.size, mtime: file.mtime,
    category, categoryLabel, dest: destDir, rel: path.relative(root, destDir) || '.', destExists: fs.existsSync(destDir),
    source, confidence, reason, newName: null, ...extra,
  });

  for (const r of config.rules || []) {
    if (r.enabled === false || !customMatch(r, file, ageDays)) continue;
    let dest = path.isAbsolute(r.dest) ? r.dest : path.join(root, r.dest);
    if (r.monthly) dest = path.join(dest, monthKey(file.mtime));
    return mk('rule:' + r.id, r.name, dest, 'custom', 'high', { k: 'rule', v: r.name });
  }

  if (isShortcut(file.ext)) {
    // only reached when "include shortcuts" is on; unknown programs are left where they are
    const g = classifyShortcut(file.name);
    if (!g) return null;
    const label = GROUP_LABELS[g][lang] || GROUP_LABELS[g].en;
    return mk('sc:' + g, label, path.join(root, shortcutFolderName(g, lang, folderMap)), 'shortcut', 'medium', { k: 'shortcut', v: label });
  }

  if (matchCapture(file)) {
    const c = byId.captures;
    const dest = path.join(root, catFolderName(c, lang, folderMap), monthKey(file.mtime));
    return mk('captures', c[lang], dest, 'pattern', 'high', { k: 'capture', v: '' });
  }

  const cat = classifyExt(file.ext);
  const p = proj && proj.get(file.src);
  if (p && (!cat || PROJECT_OK.has(cat.id))) {
    const dest = p.existing
      ? path.join(root, p.folder)
      : path.join(root, projectsFolderName(lang, folderMap), sanitizeName(p.folder));
    return mk('project', p.folder, dest, 'project', p.confidence, { k: p.existing ? 'projExisting' : 'projNew', v: p.folder });
  }

  if (cat) {
    const dest = path.join(root, catFolderName(cat, lang, folderMap));
    return mk(cat.id, cat[lang], dest, 'ext', 'high', { k: 'ext', v: '.' + file.ext });
  }

  const ai = aiAssign && aiAssign[file.name];
  if (ai) {
    const conf = ai.confidence >= 0.9 ? 'high' : ai.confidence >= 0.6 ? 'medium' : 'low';
    const extra = ai.newName ? { newName: sanitizeName(ai.newName) } : {};
    if (ai.category && byId[ai.category]) {
      const c = byId[ai.category];
      return mk(c.id, c[lang], path.join(root, catFolderName(c, lang, folderMap)), 'ai', conf, { k: 'ai', v: Math.round((ai.confidence || 0) * 100) + '%' }, extra);
    }
    if (ai.folder) {
      const f = sanitizeName(ai.folder, 40);
      if (f) return mk('ai', f, path.join(root, folderMap.get(norm(f)) || f), 'ai', conf, { k: 'ai', v: Math.round((ai.confidence || 0) * 100) + '%' }, extra);
    }
  }
  return null;
}

async function readFiles(dir, config, skippedRef) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const wantShortcut = config.includeShortcuts && /\.(lnk|url)$/i.test(e.name) && !e.name.startsWith('.');
    if (shouldSkip(e.name) && !wantShortcut) { skippedRef.n++; continue; }
    const p = path.join(dir, e.name);
    if ((config.pinned || []).includes(p)) { skippedRef.n++; continue; }
    let st;
    try { st = await fs.promises.stat(p); } catch { continue; }
    const ext = path.extname(e.name).toLowerCase().slice(1);
    if ((config.ignoreExts || []).includes(ext)) { skippedRef.n++; continue; }
    files.push({ name: e.name, src: p, ext, size: st.size, mtime: st.mtimeMs, stem: path.basename(e.name, path.extname(e.name)) });
  }
  return { entries, files };
}

/** Plan moves for the top level of one folder. */
async function buildPlan({ sourceDir, config = {}, lang = 'th', only = null, aiAssign = {} }) {
  const skipped = { n: 0 };
  let read;
  try { read = await readFiles(sourceDir, config, skipped); } catch { return { sourceDir, items: [], unmatched: [], warnings: [], skipped: 0 }; }
  const { entries, files } = read;
  const folderMap = new Map();
  const warnings = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    folderMap.set(norm(e.name), e.name);
    if (DEV_FOLDERS.has(e.name.toLowerCase())) warnings.push({ type: 'devFolder', name: e.name, path: path.join(sourceDir, e.name) });
  }
  const proj = assignProjects(files, folderMap);
  const ctx = { root: sourceDir, folderMap, lang, config, proj, aiAssign };
  const items = [], unmatched = [];
  for (const f of files) {
    if (only && !only.includes(f.name)) continue;
    const it = decide(f, ctx);
    if (it) items.push(it); else unmatched.push({ src: f.src, name: f.name, ext: f.ext, size: f.size, mtime: f.mtime });
  }
  items.sort((a, b) => a.rel.localeCompare(b.rel) || a.name.localeCompare(b.name));
  return { sourceDir, items, unmatched, warnings, skipped: skipped.n };
}

/** Plan for arbitrary files (drop pad): destination root is separate from where files live. */
async function planLoose(paths, { destRoot, config = {}, lang = 'th' }) {
  let entries = [];
  try { entries = await fs.promises.readdir(destRoot, { withFileTypes: true }); } catch { /* destRoot may not exist yet */ }
  const folderMap = new Map(entries.filter((e) => e.isDirectory()).map((e) => [norm(e.name), e.name]));
  const items = [], unmatched = [];
  for (const p of paths) {
    let st;
    try { st = await fs.promises.stat(p); } catch { continue; }
    if (!st.isFile()) continue;
    const name = path.basename(p);
    const ext = path.extname(name).toLowerCase().slice(1);
    const file = { name, src: p, ext, size: st.size, mtime: st.mtimeMs, stem: path.basename(name, path.extname(name)) };
    const it = decide(file, { root: destRoot, folderMap, lang, config, proj: null, aiAssign: {} });
    if (it) items.push(it); else unmatched.push(file);
  }
  return { items, unmatched };
}

module.exports = { buildPlan, planLoose, catFolderName, CATEGORIES };
