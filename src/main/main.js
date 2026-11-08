const { net, app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, globalShortcut, Notification, safeStorage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const { buildPlan, planLoose } = require('../core/planner');
const { Journal, applyItems } = require('../core/journal');
const { scanSecrets } = require('../core/guard');
const { Vault } = require('../core/vault');
const { scanStale, scanDeadShortcuts, findDuplicates } = require('../core/cleanup');
const { searchDetailed, stats: searchStats, buildIndex } = require('../core/search');
const { MODES, GROUPS, HIDDEN_DIR, classifyShortcut, planMode } = require('../core/modes');
const { Snapshots } = require('../core/snapshots');
const { PACKS } = require('../core/rulepacks');
const { CATEGORIES, customMatch } = require('../core/rules');
const ai = require('../core/ai');
const { recentFiled } = require('../core/recent');
const { listFiles } = require('../core/inbox');
const review = require('../core/review');
const { dhash, groupSimilar } = require('../core/phash');
const usage = require('../core/usage');
const wall = require('../core/wallpaper');
const deskIcons = require('../core/desktopicons');
const { walk } = require('../core/util');
const { decideMode, Switcher, DEFAULT_CFG: AUTOSWITCH_DEFAULT } = require('../core/automode');

const SMOKE = process.env.JADTOH_SMOKE === '1';
// test hook: run against an isolated data dir + folder so tests never touch the real Desktop
// one-time migration: the data folder was %APPDATA%\JadToh before the rename to Bank JadToh
if (!process.env.JADTOH_TEST_DIR) {
  try {
    const oldDir = path.join(app.getPath('appData'), 'JadToh'), newDir = path.join(app.getPath('appData'), 'Bank JadToh');
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) fs.renameSync(oldDir, newDir);
  } catch (e) { /* keep running; a fresh data folder is created */ }
}
if (process.env.JADTOH_TEST_DIR) app.setPath('userData', path.join(process.env.JADTOH_TEST_DIR, 'data'));
const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');

const DEFAULTS = {
  guardIgnore: [], includeShortcuts: false, widget: true, widgetPos: null, widgetCollapsed: false, widgetTop: true,
  theme: 'default', themeAuto: false, themeFx: 'sky', skyV1: false, weather: { on: false, place: null }, notify: true, notifySec: 12, watchOff: [], lang: null, folders: [], autoMode: 'ask', watch: false, trusted: {}, offered: {}, rules: [], ignoreExts: [], pinned: [],
  staleDays: 30, installerDays: 14, aiEnabled: false, aiFallback: true, aiPrivacy: 'names', aiRename: false, cmdAuto: false,
  startup: false, suggestions: [], corrections: {}, stats: {}, dropRoot: '', activeMode: 'all', firstRunDone: false,
};

const M = {
  th: { rv_need_ai: 'ต้องเปิด AI ในตั้งค่าก่อน จึงจะรีวิวชื่อโฟลเดอร์ได้', rv_label: 'ปรับชื่อ/จัดโฟลเดอร์ตามคำแนะนำ AI', n_mode: 'สลับเป็น{m}ให้แล้ว', why_process: 'เจอโปรแกรม {v}', why_schedule: 'ตามตารางเวลา {v}', why_none: 'ไม่มีโปรแกรมหรือตารางที่ตรง จึงกลับค่าเริ่มต้น', widget: 'วิดเจ็ตเก็บล่าสุดบนจอ', n_test: 'ทดสอบแจ้งเตือน — เห็นการ์ดนี้ไหม?', n_test_sub: 'การ์ดจริงจะขึ้นแบบนี้ที่มุมล่างขวา', n_test_dest: 'บันทึกหน้าจอ\\2026-11', n_test_dest2: 'เอกสาร', n_auto: 'จัดโต๊ะให้แล้ว {n} ไฟล์', n_inbox: 'มี {n} ไฟล์รอคุณตัดสินใจ', n_inbox_sub: 'เปิดดูและอนุมัติได้เลย', n_pinned: 'เก็บไว้ที่เดิมให้แล้ว', n_undone: 'ย้อนกลับเรียบร้อย ✓', undo: 'ย้อนกลับ', view: 'ดูในจัดโต๊ะ', close_tip: 'ปิดการแจ้งเตือน', pinned_toast: 'เก็บ “{n}” ไว้ที่เดิมตามที่คุณย้ายกลับ (ปล่อยคืนได้ในแท็บอัตโนมัติ)', show: 'เปิดจัดโต๊ะ', organize: 'จัดโต๊ะเดี๋ยวนี้', modes: 'โหมดหน้าจอ', drop: 'ช่องวางไฟล์', watch: 'ติดตามและจัดอัตโนมัติ', quit: 'ออก', m_work: 'โหมดงาน', m_game: 'โหมดเกม', m_meeting: 'โหมดประชุม', m_all: 'แสดงทั้งหมด', inbox: 'ไฟล์รออนุมัติ: {n}', moved: 'จัดไฟล์อัตโนมัติ {n} ไฟล์', tip: 'แบงค์ จัดโต๊ะ' },
  en: { rv_need_ai: 'Turn on AI in Settings to review folder names', rv_label: 'Folder tidy from AI review', n_mode: 'Switched to {m}', why_process: 'Detected {v}', why_schedule: 'By schedule {v}', why_none: 'Nothing matched, back to default', widget: 'Recent-files widget', n_test: 'Test notification — can you see this?', n_test_sub: 'Real cards appear like this, bottom-right', n_test_dest: 'Captures\\2026-11', n_test_dest2: 'Documents', n_auto: 'Tidied {n} file(s) for you', n_inbox: '{n} file(s) need your call', n_inbox_sub: 'Open to review and approve', n_pinned: 'Left where you put it', n_undone: 'Undone ✓', undo: 'Undo', view: 'Open in Bank JadToh', close_tip: 'Dismiss', pinned_toast: 'Keeping “{n}” where you put it (release it in the Automation tab)', show: 'Open Bank JadToh', organize: 'Tidy up now', modes: 'Screen modes', drop: 'Drop pad', watch: 'Watch & auto-organize', quit: 'Quit', m_work: 'Work mode', m_game: 'Game mode', m_meeting: 'Meeting mode', m_all: 'Show all', inbox: 'Files waiting: {n}', moved: 'Auto-organized {n} files', tip: 'Bank JadToh' },
};

let cfg, cfgFile, journal, vault, snaps, win, dropWin, tray, quitting = false, suppressUntil = 0;
let thumbAllowed = new Set();
const allowedRoots = () => [...cfg.folders, app.getPath('desktop'), process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : '', cfg.dropRoot].filter(Boolean);
const okPath = (p) => pathGuard.insideAny(allowedRoots(), p);
function allowThumbs(paths) { if (thumbAllowed.size > 8000) thumbAllowed.clear(); for (const p of paths) thumbAllowed.add(p); } // the page may only ask thumbnails for paths we handed it
/** Icon of the program a shortcut launches (not the generic "shortcut" icon). */
/* ---------- vault session: the unlocked key lives only in memory and expires ---------- */

let vaultKey = null, vaultUntil = 0, vaultFails = 0;
const viewDirs = new Set();
const TESTING = !!process.env.JADTOH_TEST_DIR;
const VAULT_IDLE_MS = 5 * 60 * 1000, VIEW_MS = TESTING ? 2500 : 3 * 60 * 1000;
const vaultUnlocked = () => !!vaultKey && Date.now() < vaultUntil;
function vaultTouch() { vaultUntil = Date.now() + VAULT_IDLE_MS; }
function vaultLock() { if (vaultKey) vaultKey.fill(0); vaultKey = null; vaultUntil = 0; }
function vaultNeedKey() { if (!vaultUnlocked()) { vaultLock(); throw new Error('locked'); } vaultTouch(); return vaultKey; }
function dropViewDir(dir) { viewDirs.delete(dir); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open: retried at quit */ } }
setInterval(() => { if (vaultKey && !vaultUnlocked()) vaultLock(); }, 15000).unref?.();

async function appIconFor(p) {
  const ext = path.extname(p).toLowerCase();
  let src = p;
  try {
    if (ext === '.lnk') { const l = shell.readShortcutLink(p); src = [l.icon, l.target].find((x) => x && fs.existsSync(x)) || p; }
    else if (ext === '.url') { const m = fs.readFileSync(p, 'utf8').match(/^IconFile=(.+)$/mi); if (m && fs.existsSync(m[1].trim())) src = m[1].trim(); }
  } catch { /* fall back to the file's own icon */ }
  if (src === p && (ext === '.lnk' || ext === '.url')) return ''; // nothing resolvable: the page shows the group emoji instead of a blank-document icon
  try { const ic = await app.getFileIcon(src, { size: 'large' }); return ic.isEmpty() ? '' : ic.toDataURL(); } catch { return ''; }
}

let inbox = [];
const tr = (k, v = {}) => {
  let s = (M[cfg?.lang] || M.en)[k] || k;
  for (const x in v) s = s.replace('{' + x + '}', v[x]);
  return s;
};

function loadCfg() {
  cfgFile = path.join(app.getPath('userData'), 'config.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* first run */ }
  cfg = { ...DEFAULTS, ...saved };
  if (!cfg.lang) cfg.lang = app.getLocale().toLowerCase().startsWith('th') ? 'th' : 'en';
  if (!cfg.folders.length) cfg.folders = [app.getPath('desktop'), app.getPath('downloads')];
  if (!cfg.dropRoot) cfg.dropRoot = path.join(app.getPath('documents'), 'Bank JadToh');
  cfg.autoSwitch = { ...AUTOSWITCH_DEFAULT, ...(saved.autoSwitch || {}) };
  llm.migrate(cfg); // one old Anthropic key -> a connection
  // weather-driven sky becomes the default look; people who never changed the decoration style move to it once (others keep their pick)
  if (!saved.skyV1) { cfg.skyV1 = true; if (!saved.themeFx || saved.themeFx === 'icons') cfg.themeFx = 'sky'; }
  if (process.env.JADTOH_TEST_DIR) {
    cfg.dropRoot = path.join(process.env.JADTOH_TEST_DIR, 'drop');
    cfg.folders = [path.join(process.env.JADTOH_TEST_DIR, 'desk'), path.join(process.env.JADTOH_TEST_DIR, 'desk2')];
    fs.mkdirSync(cfg.folders[1], { recursive: true });
    cfg.watchOff = process.env.JADTOH_WATCHOFF2 === '1' ? [cfg.folders[1]] : [];
    cfg.watch = true;
    cfg.autoMode = process.env.JADTOH_AUTOMODE || 'full';
  }
}
const saveCfg = () => { try { fs.mkdirSync(path.dirname(cfgFile), { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1)); } catch { /* ignore */ } };
const publicCfg = () => ({ ...cfg, aiConns: (cfg.aiConns || []).map(connPublic), aiPresets: llm.PRESETS, hasKey: !!aiReady(), categories: CATEGORIES.map((c) => ({ id: c.id, th: c.th, en: c.en, exts: c.exts.slice(0, 10) })), packs: PACKS.map((p) => ({ id: p.id, th: p.th, en: p.en, count: p.rules.length, ruleIds: p.rules.map((r) => r.id), rules: p.rules.map((r) => ({ name: r.name, dest: r.dest, exts: r.exts, pattern: r.pattern })) })), modes: Object.keys(MODES) });
const themes = require('../core/themes');
const llm = require('../core/llm');
const pathGuard = require('../core/pathguard');
const weatherLib = require('../core/weather');
let wxNow = null, wxError = null;
const wxOn = () => !!(cfg.weather && cfg.weather.on && cfg.weather.place);
const themeState = () => {
  const id = themes.effectiveTheme(cfg);
  const fresh = wxNow && Date.now() - wxNow.at < 3 * 3600e3; // a stale reading is worse than none
  return { id, fx: cfg.themeFx || 'sky', picked: cfg.theme, auto: !!cfg.themeAuto, season: themes.themeForDate(new Date()), list: themes.THEMES,
    wx: id === 'default' && wxOn() && fresh ? wxNow : null,
    weather: { on: !!(cfg.weather && cfg.weather.on), place: cfg.weather ? cfg.weather.place : null, now: wxNow, error: wxError } };
};
const themeSig = (st) => st.id + ':' + (st.wx ? st.wx.kind : '') + ':' + st.fx;
let lastTheme = null;
function broadcastTheme() {
  const st = themeState(); lastTheme = themeSig(st);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('jt:theme', st);
}
async function refreshWeather() {
  if (!wxOn()) { wxNow = null; wxError = null; return; }
  try { wxNow = await weatherLib.current(cfg.weather.place, net.fetch); wxError = null; } catch (e) { wxError = String(e.message || e).slice(0, 80); }
}
async function weatherTick() {
  await refreshWeather();
  if (lastTheme !== null && themeSig(themeState()) !== lastTheme) broadcastTheme();
}
setInterval(() => { if (lastTheme !== null && themeSig(themeState()) !== lastTheme) broadcastTheme(); }, 30 * 60 * 1000).unref(); // midnight rollover when following the season
setInterval(weatherTick, 20 * 60 * 1000).unref();
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send('jt:' + ch, data); };
const existingFolders = () => cfg.folders.filter((f) => fs.existsSync(f));
const desktopDir = () => app.getPath('desktop');

const encKey = (k) => (k ? (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(k).toString('base64') : 'b64:' + Buffer.from(k).toString('base64')) : '');
function decKey(v) {
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
  } catch { /* undecryptable */ }
  return '';
}
/** What the page may see of a connection: never the key. */
const connPublic = (c) => ({ id: c.id, provider: c.provider, label: c.label, model: c.model, baseUrl: c.baseUrl || '', hasKey: !!c.keyEnc, ...llm.describe(c) });
const connUsable = (c) => !!c && (!llm.describe(c).needsKey || !!decKey(c.keyEnc));
const activeConn = () => (cfg.aiConns || []).find((c) => c.id === cfg.aiActive && connUsable(c)) || (cfg.aiConns || []).find(connUsable) || null;
const aiReady = () => !!activeConn();
/** Active connection first; if it fails and fallback is on, the others in list order. */
async function aiComplete(system, user, maxTokens) {
  const first = activeConn();
  const order = [first, ...(cfg.aiFallback ? (cfg.aiConns || []).filter((c) => c !== first && connUsable(c)) : [])].filter(Boolean);
  if (!order.length) throw new Error('no AI connection');
  const errs = [];
  for (const c of order) {
    try { return await llm.complete({ conn: c, key: decKey(c.keyEnc), system, user, maxTokens, fetchImpl: net.fetch }); } catch (e) { errs.push(String(e.message || e)); }
  }
  throw new Error(errs.join(' | '));
}

/* ---------- organizing ---------- */

async function buildAllPlans({ useAI = false } = {}) {
  const sources = [];
  for (const dir of existingFolders()) {
    let plan = await buildPlan({ sourceDir: dir, config: cfg, lang: cfg.lang });
    let aiError = null;
    if (useAI && cfg.aiEnabled && aiReady() && plan.unmatched.length) {
      try {
        const assign = await ai.classifyFiles({
          complete: aiComplete, files: plan.unmatched.slice(0, 40), categories: CATEGORIES.map((c) => c.id),
          privacy: cfg.aiPrivacy, rename: cfg.aiRename, lang: cfg.lang,
        });
        plan = await buildPlan({ sourceDir: dir, config: cfg, lang: cfg.lang, aiAssign: assign });
      } catch (e) { aiError = e.message; }
    }
    sources.push({ ...plan, aiError });
  }
  return { sources };
}

async function applyAndTrack(items, label, { userApproved = true } = {}) {
  suppressUntil = Date.now() + 4000;
  const { batch, results } = await applyItems(items, journal, { label, kind: 'organize' });
  const okSrc = new Set(results.filter((r) => r.ok).map((r) => r.src));
  const trustOffers = [];
  if (userApproved) {
    for (const it of items) {
      if (!okSrc.has(it.src) || it.source === 'ai') continue;
      const s = (cfg.stats[it.category] = cfg.stats[it.category] || { approved: 0 });
      s.approved++;
      if (s.approved >= 10 && !cfg.trusted[it.category] && !cfg.offered[it.category]) {
        cfg.offered[it.category] = true;
        trustOffers.push({ category: it.category, label: it.categoryLabel });
      }
    }
  }
  saveCfg();
  return { batch, results, trustOffers };
}

/* ---------- watcher ---------- */

const watchers = new Map();
const pending = new Map();
function stopWatch() { for (const w of watchers.values()) try { w.close(); } catch { /* ignore */ } watchers.clear(); }
const watchedFolders = () => existingFolders().filter((f) => !(cfg.watchOff || []).includes(f));
function startWatch() {
  stopWatch();
  for (const dir of watchedFolders()) {
    try {
      const w = fs.watch(dir, { persistent: false }, (_ev, fn) => {
        if (!fn || Date.now() < suppressUntil) return;
        const full = path.join(dir, fn.toString());
        clearTimeout(pending.get(full));
        pending.set(full, setTimeout(() => onFileEvent(full), 2500));
      });
      w.on('error', () => { /* folder vanished */ });
      watchers.set(dir, w);
    } catch { /* ignore */ }
  }
}

async function onFileEvent(full) {
  pending.delete(full);
  let st;
  try { st = await fs.promises.stat(full); } catch { return; }
  if (!st.isFile()) return;
  await new Promise((r) => setTimeout(r, 1500));
  let st2;
  try { st2 = await fs.promises.stat(full); } catch { return; }
  if (st2.size !== st.size) return onFileEvent(full); // still being written

  // learning: the user moved a file we organised back to its original place
  const hit = journal.findMoveFrom(full);
  if (hit && !fs.existsSync(hit.move.to)) {
    const ext = hit.move.ext || path.extname(full).slice(1).toLowerCase();
    cfg.corrections[ext] = (cfg.corrections[ext] || 0) + 1;
    cfg.pinned = [...new Set([...cfg.pinned, full])];
    if (cfg.corrections[ext] >= 2 && !cfg.suggestions.some((s) => s.ext === ext)) {
      cfg.suggestions.push({ type: 'ignoreExt', ext });
      send('inbox:changed');
    }
    saveCfg();
    const msg = tr('pinned_toast', { n: path.basename(full) });
    send('toast', msg);
    send('inbox:changed');
    notice({ kind: 'warn', title: tr('n_pinned'), sub: path.basename(full), tab: 'auto' });
    return;
  }
  return handleNew(full);
}

async function handleNew(full) {
  const dir = path.dirname(full);
  const plan = await buildPlan({ sourceDir: dir, config: cfg, lang: cfg.lang, only: [path.basename(full)] });
  const auto = [], wait = [];
  for (const it of plan.items) {
    const ok = it.confidence === 'high' && (cfg.autoMode === 'full' || (cfg.autoMode === 'smart' && cfg.trusted[it.category] && it.source !== 'ai'));
    (ok ? auto : wait).push(it);
  }
  if (auto.length) {
    const r = await applyAndTrack(auto, 'Auto', { userApproved: false });
    const okSrc = new Set(r.results.filter((x) => x.ok).map((x) => x.src));
    if (okSrc.size) {
      notice({
        kind: 'ok', title: tr('n_auto', { n: okSrc.size }), sub: path.basename(dir),
        items: auto.filter((it) => okSrc.has(it.src)).map((it) => ({ name: it.newName || it.name, to: it.rel })),
        undoId: r.batch?.id, tab: 'history',
      });
    }
    send('inbox:changed');
  }
  if (wait.length) {
    inbox = inbox.filter((i) => !wait.some((w) => w.src === i.src)).concat(wait);
    send('inbox:changed');
    updateTray();
    notice({ kind: 'warn', title: tr('n_inbox', { n: inbox.length }), sub: tr('n_inbox_sub'), items: wait.map((it) => ({ name: it.name, to: it.rel })), tab: 'auto' });
  }
}

/* ---------- always-visible widget: what was filed lately, and where ---------- */

let widgetWin = null, widgetSaveTimer = null;
const WIDGET_W = 340;

function widgetStartPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  const p = cfg.widgetPos;
  // keep a saved position only if it is still on some display (monitor unplugged / resolution changed)
  if (p && screen.getAllDisplays().some((d) => p.x >= d.workArea.x - 40 && p.x < d.workArea.x + d.workArea.width - 60 && p.y >= d.workArea.y - 10 && p.y < d.workArea.y + d.workArea.height - 40)) return p;
  return { x: wa.x + wa.width - WIDGET_W - 24, y: wa.y + 70 };
}

function createWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.showInactive(); return; }
  const pos = widgetStartPos();
  widgetWin = new BrowserWindow({
    x: pos.x, y: pos.y, width: WIDGET_W, height: 160, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: !!cfg.widgetTop, title: 'Bank JadToh Widget', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, disableBlinkFeatures: 'Auxclick', backgroundThrottling: false },
  });
  if (cfg.widgetTop) widgetWin.setAlwaysOnTop(true, 'floating');
  widgetWin.loadFile(path.join(ROOT, 'src', 'renderer', 'widget.html'));
  widgetWin.on('move', () => {
    clearTimeout(widgetSaveTimer);
    widgetSaveTimer = setTimeout(() => {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      const [x, y] = widgetWin.getPosition();
      cfg.widgetPos = { x, y }; saveCfg();
    }, 500);
  });
  widgetWin.on('closed', () => { widgetWin = null; });
}

function closeWidget() { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.close(); }
function pushWidget() { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('jt:widget'); }

/* ---------- custom notification popup (bottom-right, never steals focus) ---------- */

let noticeWin = null, noticeReady = null;
function ensureNotice() {
  if (noticeWin && !noticeWin.isDestroyed()) return noticeReady;
  noticeWin = new BrowserWindow({
    width: 400, height: 10, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false,
    hasShadow: false, alwaysOnTop: true, title: 'Bank JadToh Notice',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, disableBlinkFeatures: 'Auxclick', backgroundThrottling: false },
  });
  noticeWin.setAlwaysOnTop(true, 'screen-saver');
  noticeReady = new Promise((r) => noticeWin.webContents.once('did-finish-load', r));
  if (SMOKE) noticeWin.webContents.on('console-message', (e) => console.log('NOTICE console ' + (e.message ?? '')));
  noticeWin.webContents.on('preload-error', (_e, p, err) => console.log('NOTICE preload-error ' + err));
  noticeWin.loadFile(path.join(ROOT, 'src', 'renderer', 'notify.html'));
  noticeWin.on('closed', () => { noticeWin = null; });
  return noticeReady;
}

function dlog(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch { /* ignore */ }
}

async function notice(p) {
  try {
    if (!cfg.notify) return;
    if (SMOKE && process.env.JADTOH_NOTICE_TEST !== '1' && process.env.JADTOH_BAR_TEST !== '1') return; // tests must not pop windows on the real screen
    await ensureNotice();
    if (noticeWin && !noticeWin.isDestroyed()) {
      noticeWin.webContents.send('jt:notice', { ...p, duration: p.duration ?? (cfg.notifySec ?? 12) * 1000, undoLabel: tr('undo'), viewLabel: tr('view'), closeLabel: tr('close_tip'), undoneLabel: tr('n_undone') });
      dlog('notice sent: ' + p.title);
    }
  } catch (e) { dlog('notice FAILED: ' + (e.stack || e)); }
}

/* ---------- windows & tray ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600, show: false, title: 'แบงค์ จัดโต๊ะ', icon: ICON, backgroundColor: '#0f1420',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, disableBlinkFeatures: 'Auxclick' },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!SMOKE && !process.argv.includes('--hidden')) win.show(); });
  win.on('close', (e) => { if (!quitting && !SMOKE) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showWin(tab) {
  if (!win || win.isDestroyed()) createWindow();
  win.show(); win.focus();
  if (tab) send('nav', tab);
}

function createDropPad() {
  if (dropWin && !dropWin.isDestroyed()) { dropWin.show(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  dropWin = new BrowserWindow({
    width: 260, height: 160, x: wa.x + wa.width - 280, y: wa.y + wa.height - 180, frame: false, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, title: 'Bank JadToh Drop', backgroundColor: '#141a2a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, disableBlinkFeatures: 'Auxclick' },
  });
  dropWin.setMenuBarVisibility(false);
  dropWin.loadFile(path.join(ROOT, 'src', 'renderer', 'drop.html'));
  dropWin.on('closed', () => { dropWin = null; });
}

const sharedDesktops = () => (process.env.PUBLIC ? [path.join(process.env.PUBLIC, 'Desktop')] : []);

async function setMode(modeId) {
  const { items } = planMode(desktopDir(), modeId, sharedDesktops());
  let moved = 0, failed = 0;
  if (items.length) {
    const hiddenDir = path.join(desktopDir(), '.jadtoh-hidden');
    suppressUntil = Date.now() + 4000;
    const { results } = await applyItems(items, journal, { label: 'Mode: ' + modeId, kind: 'mode' });
    moved = results.filter((r) => r.ok).length;
    failed = results.length - moved;
    if (process.platform === 'win32' && fs.existsSync(hiddenDir)) execFile('attrib', ['+h', hiddenDir], () => {});
  }
  if (!failed) { cfg.activeMode = modeId; saveCfg(); }
  return { moved, failed };
}

/* ---------- updates (electron-updater; needs a publish server configured at release time) ---------- */

let autoUpdater = null, updateState = { status: 'idle' };
function setupUpdater() {
  if (!app.isPackaged) { updateState = { status: 'dev' }; return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-available', (i) => { updateState = { status: 'available', version: i.version }; send('inbox:changed'); });
    autoUpdater.on('update-not-available', () => { updateState = { status: 'latest' }; });
    autoUpdater.on('download-progress', (p) => { updateState = { status: 'downloading', percent: Math.round(p.percent) }; });
    autoUpdater.on('update-downloaded', (i) => { updateState = { status: 'ready', version: i.version }; });
    autoUpdater.on('error', (e) => { updateState = { status: /app-update\.yml|ENOENT|publish/i.test(String(e)) ? 'unconfigured' : 'error', message: String(e.message || e).slice(0, 200) }; });
  } catch { updateState = { status: 'unconfigured' }; }
}

/* ---------- wallpaper-aware icon layout ---------- */

function regValue(name) {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', name], { windowsHide: true }, (err, out) => {
      if (err) return resolve('');
      const m = out.match(new RegExp(name + '\\s+REG_\\w+\\s+(.*)'));
      resolve(m ? m[1].trim() : '');
    });
  });
}

async function loadWallpaper() {
  const transcoded = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  const regPath = await regValue('WallPaper');
  const candidates = [transcoded, regPath].filter((p) => p && fs.existsSync(p));
  for (const p of candidates) {
    const img = nativeImage.createFromBuffer(fs.readFileSync(p));
    if (!img.isEmpty()) {
      const style = parseInt(await regValue('WallpaperStyle'), 10), tile = (await regValue('TileWallpaper')) === '1';
      const mode = tile ? 'center' : ({ 10: 'fill', 22: 'fill', 6: 'fit', 2: 'stretch', 0: 'center' }[style] || 'fill');
      return { img, source: p === transcoded ? 'TranscodedWallpaper' : path.basename(p), mode };
    }
  }
  return null;
}

/** Physical-pixel geometry (what Explorer's ListView uses): primary monitor rect, its work area, and the desktop origin. */
function physicalGeometry() {
  const toPhys = (r) => (screen.dipToScreenRect ? screen.dipToScreenRect(null, r) : r);
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const rects = displays.map((d) => toPhys(d.bounds));
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
  const p = toPhys(primary.bounds), w = toPhys(primary.workArea);
  return { primary: p, work: w, originX: p.x - minX, originY: p.y - minY, displays: displays.length };
}

const LAYOUT_MODES = ['wallpaper', 'plain'];
const ICON_SORTS = ['current', 'name', 'size', 'type', 'date'];

/** Order desktop icon names like Explorer's "Sort by" (Name / Size / Item type / Date modified).
 *  System icons (This PC, Recycle Bin…) have no file on disk and stay first, then folders, then files — same as Windows. */
function sortIconNames(items, sort, dir) {
  const byPos = [...items].sort((x, y) => x.x - y.x || x.y - y.y);
  if (!ICON_SORTS.includes(sort) || sort === 'current') return byPos.map((i) => i.name);
  const files = new Map(); // display name -> stat info (Explorer may hide extensions, so index both spellings)
  for (const d of [desktopDir(), ...sharedDesktops()]) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { /* unreadable */ }
    for (const n of names) {
      if (n.startsWith('.jadtoh')) continue;
      let st; try { st = fs.statSync(path.join(d, n)); } catch { continue; }
      const info = { dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, ext: st.isDirectory() ? '' : path.extname(n).toLowerCase() };
      if (!files.has(n)) files.set(n, info);
      const bare = path.basename(n, path.extname(n));
      if (!files.has(bare)) files.set(bare, info);
    }
  }
  const cmpName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const sign = dir === 'desc' ? -1 : 1;
  const rank = (f) => (!f ? 0 : f.dir ? 1 : 2);
  return byPos.map((i) => ({ name: i.name, f: files.get(i.name) })).sort((a, b) => {
    const r = rank(a.f) - rank(b.f);
    if (r) return r; // groups keep their order whatever the direction
    let c = 0;
    if (a.f && b.f) {
      if (sort === 'size') c = a.f.size - b.f.size;
      else if (sort === 'date') c = a.f.mtime - b.f.mtime;
      else if (sort === 'type') c = cmpName(a.f.ext, b.f.ext);
    }
    return (c || cmpName(a.name, b.name)) * sign;
  }).map((x) => x.name);
}

async function planIconLayout({ protectPct = 30, anchor = 'auto', all = false, sort = 'current', dir = 'asc', mode = 'wallpaper' } = {}) {
  const info = await deskIcons.listIcons();
  if (info.error) return { error: info.error };
  const plain = mode === 'plain'; // "normal" layout: neat rows from the top-left, ignoring the picture
  const wp = await loadWallpaper();
  if (!wp && !plain) return { error: 'nowallpaper', autoArrange: info.autoArrange };
  const geo = physicalGeometry();
  let fit = null, sal = null;
  if (wp) {
    const { width: iw } = wp.img.getSize();
    const small = wp.img.resize({ width: Math.min(640, iw) });
    const ss = small.getSize();
    const src = { data: small.toBitmap(), w: ss.width, h: ss.height };
    fit = wall.fitToScreen(src, { w: geo.primary.width, h: geo.primary.height }, wp.mode, 384); // plain mode still uses it for the preview picture
    if (!plain) sal = wall.saliency(fit, { cols: 48, rows: 27, bgra: true }); // analysed once, then several protection levels derived from it
  }
  const order = sortIconNames(info.items, sort, dir === 'desc' ? 'desc' : 'asc');
  const workH = geo.work.height + (geo.work.y - geo.primary.y);
  // start the grid where Windows' own grid starts (taken from where the existing icons sit), so snap-to-grid keeps our cells
  const onPrimary = info.items.filter((i) => i.x >= geo.originX && i.x < geo.originX + geo.primary.width);
  const marginX = onPrimary.length ? Math.max(0, Math.min(...onPrimary.map((i) => i.x)) - geo.originX) % info.cellW : 8;
  const marginY = onPrimary.length ? Math.max(0, Math.min(...onPrimary.map((i) => i.y)) - geo.originY) % info.cellH : 8;
  const ANCHORS = plain ? ['left'] : ['left', 'right', 'top', 'bottom'];
  const noBusy = { cols: 48, rows: 27, mask: new Uint8Array(48 * 27) };
  const variant = (pct, anc) => {
    const busy = plain ? noBusy : wall.busyMask(sal, { protectPct: Math.max(5, Math.min(60, pct)), grow: 1 });
    const plan = wall.planLayout({ items: order, screenW: geo.primary.width, screenH: geo.primary.height, cellW: info.cellW, cellH: info.cellH, marginX, marginY, workH, busy, anchor: anc });
    return {
      protect: pct, anchor: anc, spread: plan.spread,
      grid: { cols: busy.cols, rows: busy.rows, mask: Array.from(busy.mask) },
      icons: plan.positions.map((p) => ({ name: p.name, x: p.x, y: p.y, onSubject: p.onSubject })),
      freeCells: plan.freeCells, totalCells: plan.totalCells, overflow: plan.overflow,
      // Explorer's coordinates: monitor-relative position + where this monitor sits inside the whole desktop
      positions: plan.positions.map((p) => ({ name: p.name, x: p.x + geo.originX, y: p.y + geo.originY })),
    };
  };
  const byAnchor = (pct) => Object.fromEntries(ANCHORS.map((a) => [a, variant(pct, a)]));
  const bestOf = (set) => ANCHORS.slice().sort((a, b) => set[a].overflow - set[b].overflow || set[a].spread - set[b].spread)[0];
  const pick = (pct) => { const set = byAnchor(pct), best = bestOf(set); return { best, set, chosen: set[anchor === 'auto' || !set[anchor] ? best : anchor] }; };
  const thumb = fit ? nativeImage.createFromBitmap(Buffer.from(fit.data), { width: fit.w, height: fit.h }).toDataURL() : null;
  const out = {
    autoArrange: info.autoArrange, snapToGrid: info.snapToGrid, count: info.count, displays: geo.displays,
    mode: plain ? 'plain' : 'wallpaper', wallpaper: { source: wp ? wp.source : '', mode: wp ? wp.mode : '', thumb },
    screen: { w: geo.primary.width, h: geo.primary.height }, cell: { w: info.cellW, h: info.cellH },
    origin: { x: geo.originX, y: geo.originY },
    ...pick(protectPct).chosen, best: pick(protectPct).best,
    current: info.items.map((i) => ({ name: i.name, x: i.x, y: i.y })),
  };
  if (all && !plain) out.plans = Object.fromEntries([15, 30, 50].map((p) => { const { best, set } = pick(p); return [p, { best, by: set }]; }));
  return out;
}

/* ---------- hardening: no window may navigate away, open new windows, or get browser permissions ---------- */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (ev) => ev.preventDefault());
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
});

const layoutDir = () => path.join(app.getPath('userData'), 'layouts');

function saveLayoutBackup(items) {
  fs.mkdirSync(layoutDir(), { recursive: true });
  const file = path.join(layoutDir(), Date.now() + '.json');
  fs.writeFileSync(file, JSON.stringify(items));
  const all = fs.readdirSync(layoutDir()).filter((f) => f.endsWith('.json')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 10))) { try { fs.unlinkSync(path.join(layoutDir(), f)); } catch { /* ignore */ } }
  return file;
}

const latestLayoutBackup = () => {
  try { const f = fs.readdirSync(layoutDir()).filter((x) => x.endsWith('.json')).sort().pop(); return f ? path.join(layoutDir(), f) : null; } catch { return null; }
};

/* ---------- visually similar images ---------- */

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

async function findSimilarImages(dirs, { max = 1500, maxDist = 4 } = {}) {
  const items = [];
  const files = [];
  for (const dir of dirs) {
    await walk(dir, {
      depth: 3, max: 20000,
      onFile: async (p, name) => {
        if (files.length >= max || !IMG_EXTS.has(path.extname(name).toLowerCase())) return;
        try {
          const st = await fs.promises.stat(p);
          if (st.size >= 4 * 1024 && st.size <= 40 * 1048576) files.push({ p, size: st.size, mtime: st.mtimeMs });
        } catch { /* skip */ }
      },
    });
  }
  let n = 0;
  for (const f of files) {
    if (++n % 15 === 0) await new Promise((r) => setImmediate(r)); // keep the app responsive
    const img = nativeImage.createFromPath(f.p);
    if (img.isEmpty()) continue;
    const { width, height } = img.getSize();
    if (width < 32 || height < 32) continue;
    const h = dhash(img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap(), true);
    if (h.flat) continue;
    items.push({ path: f.p, hash: h.hash, w: width, h: height, size: f.size, mtime: f.mtime });
  }
  const groups = groupSimilar(items, maxDist);
  let thumbs = 0;
  for (const g of groups) {
    for (const f of g.files) {
      f.thumb = thumbs++ < 240 ? nativeImage.createFromPath(f.path).resize({ width: 72, quality: 'good' }).toDataURL() : '';
      delete f.hash;
    }
  }
  return { groups: groups.slice(0, 80), scanned: items.length, capped: files.length >= max };
}

/* ---------- automatic mode switching (running programs + weekly schedule) ---------- */

let manualHoldUntil = 0, lastDecision = null, modeTimer = null;
const switcher = new Switcher({ needed: 3 });

function listProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 16e6 }, (err, out) => {
      if (err) return resolve([]);
      resolve(out.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((s) => s.toLowerCase()));
    });
  });
}

async function autoModeTick() {
  const a = cfg.autoSwitch;
  if (!a || !a.enabled) return;
  const running = await listProcesses();
  lastDecision = decideMode(running, new Date(), a);
  if (Date.now() < manualHoldUntil) return; // the user chose a mode by hand: leave it alone for a while
  const target = switcher.feed(lastDecision.mode, cfg.activeMode);
  if (!target) return;
  await setMode(target);
  updateTray();
  send('inbox:changed');
  const why = lastDecision.reason === 'schedule' ? tr('why_schedule', { v: lastDecision.detail }) : tr('why_process', { v: lastDecision.detail });
  notice({ kind: 'ok', title: tr('n_mode', { m: tr('m_' + target) }), sub: lastDecision.reason === 'fallback' ? tr('why_none') : why, tab: 'modes' });
}

function startModeTimer() {
  clearInterval(modeTimer);
  modeTimer = null;
  if (cfg.autoSwitch && cfg.autoSwitch.enabled) {
    modeTimer = setInterval(() => autoModeTick().catch((e) => dlog('autoModeTick: ' + e.message)), 8000);
  }
}

function sanitizeAutoSwitch(a) {
  const modes = Object.keys(MODES);
  const list = (arr) => (Array.isArray(arr) ? arr : []).map((s) => String(s).trim().toLowerCase()).filter((s) => s && s.length <= 64 && /^[\w .\-()+]+$/.test(s)).slice(0, 60);
  const hhmm = (s) => (/^\d{1,2}:\d{2}$/.test(String(s)) ? String(s) : null);
  const out = {
    enabled: !!a.enabled,
    fallback: modes.includes(a.fallback) ? a.fallback : 'all',
    processes: { game: list(a.processes?.game), meeting: list(a.processes?.meeting) },
    schedule: (Array.isArray(a.schedule) ? a.schedule : []).slice(0, 5).map((s) => ({
      mode: modes.includes(s.mode) ? s.mode : 'work',
      days: (Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => d >= 1 && d <= 7),
      from: hhmm(s.from) || '09:00', to: hhmm(s.to) || '18:00',
    })),
  };
  return out;
}

function updateTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: tr('show'), click: () => showWin() },
    { label: tr('organize'), click: () => showWin('organize') },
    { label: inbox.length ? tr('inbox', { n: inbox.length }) : '—', enabled: inbox.length > 0, click: () => showWin('auto') },
    { type: 'separator' },
    { label: tr('modes'), submenu: Object.keys(MODES).map((m) => ({ label: tr('m_' + m), type: 'radio', checked: cfg.activeMode === m, click: () => { manualHoldUntil = Date.now() + 30 * 60e3; setMode(m).then(updateTray); } })) },
    { label: tr('drop'), click: createDropPad },
    { label: tr('widget'), type: 'checkbox', checked: !!cfg.widget, click: (i) => { cfg.widget = i.checked; saveCfg(); cfg.widget ? createWidget() : closeWidget(); send('inbox:changed'); } },
    { label: tr('watch'), type: 'checkbox', checked: !!cfg.watch, click: (i) => { cfg.watch = i.checked; saveCfg(); cfg.watch ? startWatch() : stopWatch(); send('inbox:changed'); } },
    { type: 'separator' },
    { label: tr('quit'), click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setToolTip(tr('tip'));
  tray.setContextMenu(menu);
}

/* ---------- IPC ---------- */

const handle = (ch, fn) => ipcMain.handle('jt:' + ch, async (_e, payload) => {
  try { return await fn(payload); } catch (e) { return { error: e.message || String(e) }; }
});

function registerIpc() {
  handle('cfg:get', () => publicCfg());
  handle('cfg:set', (patch) => {
    const allowed = ['unusedDays', 'includeShortcuts', 'widget', 'widgetTop', 'watchOff', 'notify', 'notifySec', 'lang', 'autoMode', 'watch', 'staleDays', 'installerDays', 'aiEnabled', 'aiFallback', 'aiPrivacy', 'aiRename', 'cmdAuto', 'startup', 'folders', 'ignoreExts', 'theme', 'themeAuto', 'themeFx'];
    for (const k of allowed) if (k in patch) cfg[k] = patch[k];
    if ('startup' in patch) app.setLoginItemSettings({ openAtLogin: !!cfg.startup, args: ['--hidden'] });
    if ('widget' in patch) { cfg.widget ? createWidget() : closeWidget(); }
    if ('widgetTop' in patch && widgetWin && !widgetWin.isDestroyed()) widgetWin.setAlwaysOnTop(!!cfg.widgetTop, 'floating');
    if ('folders' in patch) cfg.watchOff = (cfg.watchOff || []).filter((f) => cfg.folders.includes(f));
    if ('watch' in patch || 'folders' in patch || 'watchOff' in patch) cfg.watch ? startWatch() : stopWatch();
    if (!themes.IDS.has(cfg.theme)) cfg.theme = 'default';
    if (!['sky', 'icons', 'shapes', 'scene', 'calm'].includes(cfg.themeFx)) cfg.themeFx = 'sky';
    saveCfg(); updateTray();
    if ('theme' in patch || 'themeAuto' in patch || 'themeFx' in patch) broadcastTheme();
    return publicCfg();
  });
  handle('theme:get', () => { const st = themeState(); lastTheme = themeSig(st); if (wxOn() && !wxNow && !wxError) refreshWeather().then(() => broadcastTheme()); return st; });
  handle('weather:search', async ({ q } = {}) => { try { return { places: await weatherLib.searchPlaces(q, cfg.lang, net.fetch) }; } catch (e) { return { places: [], error: String(e.message || e) }; } });
  handle('weather:set', async (p = {}) => {
    if ('place' in p) { const pl = p.place; cfg.weather.place = pl && Number.isFinite(pl.lat) && Number.isFinite(pl.lon) ? { name: String(pl.name || '').slice(0, 60), area: String(pl.area || '').slice(0, 80), lat: pl.lat, lon: pl.lon } : null; wxNow = null; }
    if ('on' in p) cfg.weather.on = !!p.on && !!cfg.weather.place;
    saveCfg();
    await refreshWeather();
    broadcastTheme();
    return themeState();
  });
  handle('cfg:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return publicCfg();
    if (!cfg.folders.includes(r.filePaths[0])) cfg.folders.push(r.filePaths[0]);
    saveCfg(); if (cfg.watch) startWatch();
    return publicCfg();
  });
  // AI connections: several providers/keys; keys are encrypted here and never sent back to the page
  handle('ai:conn:save', (p = {}) => {
    const preset = llm.presetOf(p.provider);
    cfg.aiConns = cfg.aiConns || [];
    const old = p.id ? cfg.aiConns.find((c) => c.id === p.id) : null;
    const baseUrl = String(p.baseUrl || '').trim();
    if (baseUrl) llm.validateBase(baseUrl); // throws a readable message for http://example.com etc.
    if (preset.custom && !baseUrl) throw new Error('address needed');
    const conn = {
      id: old ? old.id : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      provider: preset.id, label: String(p.label || preset.name).trim().slice(0, 40) || preset.name,
      model: String(p.model || preset.model).trim().slice(0, 80), baseUrl: preset.custom || baseUrl !== preset.baseUrl ? baseUrl : '',
      keyEnc: typeof p.key === 'string' && p.key.trim() ? encKey(p.key.trim()) : (old ? old.keyEnc : ''),
    };
    if (old) Object.assign(old, conn); else cfg.aiConns.push(conn);
    if (!cfg.aiActive || !cfg.aiConns.some((c) => c.id === cfg.aiActive)) cfg.aiActive = conn.id;
    saveCfg();
    return { cfg: publicCfg(), id: conn.id };
  });
  handle('ai:conn:remove', (id) => {
    cfg.aiConns = (cfg.aiConns || []).filter((c) => c.id !== id);
    if (cfg.aiActive === id) cfg.aiActive = cfg.aiConns[0] ? cfg.aiConns[0].id : null;
    saveCfg(); return publicCfg();
  });
  handle('ai:conn:activate', (id) => {
    if ((cfg.aiConns || []).some((c) => c.id === id)) { cfg.aiActive = id; saveCfg(); }
    return publicCfg();
  });
  handle('ai:test', async (id) => {
    const c = (cfg.aiConns || []).find((x) => x.id === id);
    if (!c) throw new Error('no such connection');
    const t0 = Date.now();
    const reply = await llm.complete({ conn: c, key: decKey(c.keyEnc), system: 'Reply with the single word OK.', user: 'ping', maxTokens: 16, fetchImpl: net.fetch });
    return { ok: true, ms: Date.now() - t0, reply: String(reply).trim().slice(0, 40) };
  });

  handle('plan:build', async (o) => {
    const r = await buildAllPlans(o || {});
    // remember which files the page may ask thumbnails for (it must never be able to read arbitrary paths)
    allowThumbs(r.sources.flatMap((s) => [...s.items.map((i) => i.src), ...s.unmatched.map((u) => u.src)]));
    return r;
  });
  handle('thumb:get', async (paths) => {
    const out = {};
    const todo = (Array.isArray(paths) ? paths : []).filter((p) => thumbAllowed.has(p)).slice(0, 40);
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async (p) => {
        try {
          if (['.lnk', '.url', '.exe', '.msi'].includes(path.extname(p).toLowerCase())) { out[p] = await appIconFor(p); return; } // no shell thumbnails for these
          const img = nativeImage.createThumbnailFromPath ? await nativeImage.createThumbnailFromPath(p, { width: 120, height: 120 }) : nativeImage.createFromPath(p).resize({ width: 120 });
          out[p] = img.isEmpty() ? '' : img.toDataURL();
        } catch { out[p] = ''; }
      }));
    }
    return out;
  });
  handle('plan:apply', async ({ items, label }) => applyAndTrack(items, label || 'Organize'));
  handle('trust:set', ({ category, value }) => { if (value) cfg.trusted[category] = true; else delete cfg.trusted[category]; saveCfg(); return publicCfg(); });

  handle('pin:remove', async ({ path: p }) => {
    cfg.pinned = cfg.pinned.filter((x) => x !== p);
    saveCfg();
    if (fs.existsSync(p)) await handleNew(p); // organise it right away per the current auto mode
    return true;
  });
  handle('auto:status', () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const autoBatches = journal.list().filter((b) => b.label === 'Auto');
    const todayBy = {};
    let todayTotal = 0;
    for (const b of autoBatches) {
      if (b.undone || b.time < startOfDay.getTime()) continue;
      for (const m of b.moves) {
        const f = cfg.folders.find((x) => path.dirname(m.from) === x);
        if (f) todayBy[f] = (todayBy[f] || 0) + 1;
        todayTotal++;
      }
    }
    const pinned = cfg.pinned.filter((p) => fs.existsSync(p)).map((p) => ({ path: p, name: path.basename(p) }));
    pinned.forEach((p) => thumbAllowed.add(p.path));
    return {
      pinned,
      watching: [...watchers.keys()],
      todayTotal,
      folders: cfg.folders.map((f) => ({ path: f, exists: fs.existsSync(f), watch: !(cfg.watchOff || []).includes(f), today: todayBy[f] || 0 })),
      recent: autoBatches.slice(0, 8).map((b) => ({
        id: b.id, time: b.time, undone: b.undone, files: b.moves.map((m) => ({ name: path.basename(m.to), to: path.relative(path.dirname(m.from), path.dirname(m.to)), category: m.category || '' })),
      })),
    };
  });
  handle('inbox:list', () => { inbox.forEach((i) => thumbAllowed.add(i.src)); return inbox; });
  handle('inbox:apply', async (srcs) => {
    const items = inbox.filter((i) => srcs.includes(i.src));
    const r = await applyAndTrack(items, 'Inbox');
    inbox = inbox.filter((i) => !srcs.includes(i.src)); updateTray();
    return r;
  });
  handle('inbox:dismiss', (srcs) => { inbox = inbox.filter((i) => !srcs.includes(i.src)); updateTray(); return true; });
  handle('suggest:accept', ({ ext }) => {
    cfg.ignoreExts = [...new Set([...cfg.ignoreExts, ext])];
    cfg.suggestions = cfg.suggestions.filter((s) => s.ext !== ext); saveCfg(); return publicCfg();
  });
  handle('suggest:dismiss', ({ ext }) => { cfg.suggestions = cfg.suggestions.filter((s) => s.ext !== ext); saveCfg(); return publicCfg(); });

  handle('journal:list', () => journal.list().slice(0, 100).map((b) => ({ id: b.id, time: b.time, label: b.label, kind: b.kind, undone: b.undone, count: b.moves.length, sample: b.moves.slice(0, 3).map((m) => path.basename(m.from)), moves: b.moves.slice(0, 4).map((m) => ({ name: path.basename(m.to), to: path.relative(path.dirname(m.from), path.dirname(m.to)), category: m.category || '' })) })));
  handle('journal:undo', async (id) => { suppressUntil = Date.now() + 4000; const r = await journal.undo(id); return { ok: r.filter((x) => x.ok).length, failed: r.filter((x) => !x.ok).length }; });

  handle('guard:scan', async () => {
    const all = await scanSecrets(existingFolders());
    const ignore = new Set(cfg.guardIgnore || []);
    return { findings: all.filter((f) => !ignore.has(f.path)), ignored: all.filter((f) => ignore.has(f.path)).map((f) => ({ path: f.path, name: f.name })), vault: vault.list() };
  });
  handle('guard:ignore', ({ path: p }) => { cfg.guardIgnore = [...new Set([...(cfg.guardIgnore || []), p])]; saveCfg(); return true; });
  handle('guard:unignore', ({ path: p }) => { cfg.guardIgnore = (cfg.guardIgnore || []).filter((x) => x !== p); saveCfg(); return true; });

  handle('vault:status', () => ({
    initialized: vault.isInitialized(), hint: vault.hint(), unlocked: vaultUnlocked(),
    expiresIn: vaultUnlocked() ? Math.max(0, Math.round((vaultUntil - Date.now()) / 1000)) : 0,
    legacy: vault.list().filter((e) => e.v !== 2).length, count: vault.list().length,
  }));
  handle('vault:setup', ({ pass, hint }) => {
    const r = vault.setup(pass, hint);
    vaultKey = r.dk; vaultTouch(); vaultFails = 0;
    return { recoveryKey: r.recoveryKey }; // shown to the user once, never stored
  });
  handle('vault:unlock', async ({ secret, mode }) => {
    if (vaultFails >= 5) await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * (vaultFails - 3)))); // slow down guessing
    try {
      const dk = vault.unlock(secret, mode === 'recovery' ? 'recovery' : 'pass');
      vaultLock(); vaultKey = dk; vaultTouch(); vaultFails = 0;
      return { ok: true };
    } catch (e) { vaultFails++; throw new Error('wrong passphrase'); }
  });
  handle('vault:lock', () => { vaultLock(); return true; });
  handle('vault:setHint', ({ hint, newPass }) => {
    const dk = vaultNeedKey();
    if (newPass) vault.rewrap(dk, newPass);
    vault.setHint(hint);
    return true;
  });
  handle('vault:add', async ({ file }) => {
    if (!okPath(file)) throw new Error('path not allowed');
    if (!vault.isInitialized()) throw new Error('needsSetup');
    const dk = vaultNeedKey();
    const e = vault.addFile(file, dk);
    if (TESTING) fs.unlinkSync(file); else await shell.trashItem(file); // the original goes to the Recycle Bin only after a verified encrypted copy exists
    return e;
  });
  handle('vault:list', () => vault.list());
  handle('vault:view', async ({ id }) => {
    const { path: p, dir } = vault.viewTemp(id, vaultNeedKey());
    viewDirs.add(dir);
    setTimeout(() => dropViewDir(dir), VIEW_MS);
    if (!TESTING) await shell.openPath(p);
    return { minutes: Math.round(VIEW_MS / 60000) || 3, path: TESTING ? p : undefined };
  });
  handle('vault:restore', ({ id }) => {
    const out = vault.restore(id, vaultNeedKey(), path.join(desktopDir(), 'Bank JadToh-restored'));
    if (!TESTING) shell.showItemInFolder(out);
    return { out };
  });
  handle('vault:legacyRestore', ({ id, pass }) => {
    const out = vault.legacyRestore(id, pass, path.join(desktopDir(), 'Bank JadToh-restored'));
    if (!TESTING) shell.showItemInFolder(out);
    return { out };
  });
  handle('vault:migrate', ({ id, pass }) => { vault.migrate(id, pass, vaultNeedKey()); return vault.list(); });
  handle('vault:remove', (id) => { vault.remove(id); return true; });

  // what the Security card in Settings shows: the saved audit report + facts read from the running app right now
  handle('trust:info', async () => {
    let report = null;
    try { report = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'security-report.json'), 'utf8')); } catch {}
    const wins = BrowserWindow.getAllWindows().map((w) => { const p = w.webContents.getLastWebPreferences(); return { contextIsolation: p.contextIsolation !== false, nodeIntegration: !!p.nodeIntegration, sandbox: !!p.sandbox, webSecurity: p.webSecurity !== false }; });
    return {
      report,
      live: {
        app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, packaged: app.isPackaged,
        windows: wins.length, isolated: wins.every((w) => w.contextIsolation && !w.nodeIntegration && w.webSecurity && w.sandbox),
        dataDir: app.getPath('userData'), watching: cfg.folders, ai: !!(cfg.aiEnabled && aiReady()), aiPrivacy: cfg.aiPrivacy, aiTo: cfg.aiEnabled && aiReady() ? (cfg.aiFallback ? (cfg.aiConns || []).filter(connUsable) : [activeConn()]).map((c) => llm.describe(c)) : [],
        weather: wxOn() ? cfg.weather.place.name : null, keyStore: !(cfg.aiConns || []).some((c) => c.keyEnc) ? 'none' : (cfg.aiConns || []).some((c) => (c.keyEnc || '').startsWith('b64:')) ? 'weak' : 'windows', signed: false,
      },
    };
  });

  handle('cleanup:scan', async () => {
    const dirs = existingFolders();
    const stale = await scanStale(dirs, { captureDays: cfg.staleDays, installerDays: cfg.installerDays });
    const dead = await scanDeadShortcuts(desktopDir(), (p) => shell.readShortcutLink(p));
    allowThumbs([...stale.captures, ...stale.installers, ...dead].map((x) => x.path));
    return { ...stale, dead };
  });
  handle('cleanup:dupes', async () => { const g = await findDuplicates(existingFolders()); allowThumbs(g.flatMap((x) => x.files.map((f) => f.path))); return g; });
  handle('update:state', () => ({ ...updateState, version: app.getVersion(), packaged: app.isPackaged }));
  handle('update:check', async () => {
    if (!autoUpdater) return { ...updateState, version: app.getVersion(), packaged: app.isPackaged };
    updateState = { status: 'checking' };
    try { await autoUpdater.checkForUpdates(); } catch (e) { updateState = { status: /app-update\.yml|ENOENT|publish/i.test(String(e)) ? 'unconfigured' : 'error', message: String(e.message || e).slice(0, 200) }; }
    await new Promise((r) => setTimeout(r, 1200));
    return { ...updateState, version: app.getVersion(), packaged: app.isPackaged };
  });
  handle('update:download', async () => { if (autoUpdater && updateState.status === 'available') { await autoUpdater.downloadUpdate(); } return updateState; });
  handle('update:install', () => { if (autoUpdater && updateState.status === 'ready') { quitting = true; autoUpdater.quitAndInstall(); } return true; });
  handle('layout:plan', (o) => planIconLayout({ ...(o || {}), all: true }));
  handle('layout:apply', async (o) => {
    // a throw-away test instance (JADTOH_TEST_DIR) uses fake folders but would still move the REAL desktop icons: never allow that
    if (TESTING && process.env.JADTOH_ALLOW_REAL_ICONS !== '1') return { error: 'testing' };
    const plan = await planIconLayout(o || {}); // always re-plan here: never trust positions sent by the page
    if (plan.error) return { error: plan.error };
    if (plan.autoArrange) return { error: 'autoarrange' };
    const backup = saveLayoutBackup(plan.current);
    const r = await deskIcons.setIcons(plan.positions);
    if (r.error) return { error: r.error };
    return { moved: r.moved, missing: r.missing, backup: path.basename(backup) };
  });
  handle('layout:restore', async () => {
    const f = latestLayoutBackup();
    if (!f) return { error: 'nobackup' };
    const r = await deskIcons.setIcons(JSON.parse(fs.readFileSync(f, 'utf8')));
    if (r.error) return { error: r.error };
    fs.unlinkSync(f);
    return { moved: r.moved, left: fs.existsSync(layoutDir()) ? fs.readdirSync(layoutDir()).filter((x) => x.endsWith('.json')).length : 0 };
  });
  handle('layout:hasBackup', () => { const f = latestLayoutBackup(); return { has: !!f, time: f ? Number(path.basename(f, '.json')) || 0 : 0 }; });
  handle('cleanup:similar', async () => { const r = await findSimilarImages(existingFolders()); allowThumbs(r.groups.flatMap((g) => g.files.map((f) => f.path))); return r; });
  handle('cleanup:unused', async () => {
    const shortcuts = [];
    for (const dir of [desktopDir(), ...sharedDesktops()]) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* unreadable */ }
      for (const n of names) {
        if (path.extname(n).toLowerCase() !== '.lnk') continue;
        const p = path.join(dir, n);
        let target = '';
        try { target = (shell.readShortcutLink(p) || {}).target || ''; } catch { /* broken */ }
        shortcuts.push({ name: n, path: p, target, shared: dir !== desktopDir() });
      }
    }
    const entries = usage.parseUserAssist(await usage.readUserAssistRaw());
    const items = usage.classifyUnused(shortcuts, entries, { days: cfg.unusedDays || 60 });
    allowThumbs(items.map((i) => i.path));
    return { items, history: entries.length, days: cfg.unusedDays || 60 };
  });
  handle('cleanup:parkUnused', async (paths) => {
    const dest = path.join(desktopDir(), cfg.lang === 'th' ? 'ไม่ค่อยใช้' : 'Rarely used');
    suppressUntil = Date.now() + 4000;
    const items = (Array.isArray(paths) ? paths : []).filter((p) => okPath(p) && path.extname(p).toLowerCase() === '.lnk').map((p) => ({ src: p, dest, category: 'unused', name: path.basename(p) }));
    const { batch, results } = await applyItems(items, journal, { label: 'Unused apps', kind: 'organize' });
    return { moved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, batch: batch && batch.id };
  });
  handle('cleanup:trash', async (paths) => {
    suppressUntil = Date.now() + 4000;
    let n = 0;
    for (const p of Array.isArray(paths) ? paths : []) { if (!okPath(p)) continue; try { await shell.trashItem(p); n++; } catch { /* locked */ } }
    return { trashed: n };
  });

  handle('mode:overview', () => {
    // every shortcut the modes can touch (Desktop + Public Desktop + the hidden holding folder), with its group
    const desk = desktopDir(), hiddenDir = path.join(desk, HIDDEN_DIR);
    const dirs = [[desk, false, false], ...sharedDesktops().map((d) => [d, false, true]), [hiddenDir, true, false]];
    const items = [];
    for (const [dir, hidden, shared] of dirs) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* missing */ }
      for (const n of names) {
        if (!/\.(lnk|url)$/i.test(n)) continue;
        items.push({ name: n.replace(/\.(lnk|url)$/i, ''), path: path.join(dir, n), group: classifyShortcut(n), hidden, shared });
      }
    }
    allowThumbs(items.map((i) => i.path));
    return { items, modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.show])), groups: Object.keys(GROUPS), active: cfg.activeMode };
  });
  handle('mode:plan', (id) => planMode(desktopDir(), id, sharedDesktops()).items.map((i) => ({ name: i.name, action: i.action, group: i.group, shared: !!i.shared })));
  handle('mode:apply', async (id) => { manualHoldUntil = Date.now() + 30 * 60e3; const r = await setMode(id); updateTray(); return { ...r, active: id }; });
  handle('autoswitch:get', () => ({ cfg: cfg.autoSwitch, decision: lastDecision, holdMin: Math.max(0, Math.ceil((manualHoldUntil - Date.now()) / 60e3)) }));
  handle('autoswitch:set', (a) => {
    cfg.autoSwitch = sanitizeAutoSwitch(a);
    saveCfg(); startModeTimer();
    if (cfg.autoSwitch.enabled) autoModeTick().catch(() => {});
    return { cfg: cfg.autoSwitch };
  });

  handle('search:query', async (q) => { const r = await searchDetailed(existingFolders(), String(q || '')); allowThumbs(r.results.map((x) => x.path)); return r; });
  handle('search:stats', () => searchStats());
  handle('search:reindex', async () => { await buildIndex(existingFolders(), { force: true }); return true; });

  handle('snap:list', () => snaps.list());
  handle('snap:take', () => { snaps.take([...existingFolders()], { force: true }); return snaps.list(); });
  handle('snap:diff', (d) => snaps.diff(d));
  handle('snap:restore', async (d) => { suppressUntil = Date.now() + 4000; const r = await snaps.restore(d, journal); pushWidget(); return r; });

  handle('rules:test', async (rules) => {
    const list = Array.isArray(rules) ? rules.slice(0, 60) : [];
    const files = [];
    for (const dir of existingFolders()) {
      let names = [];
      try { names = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { /* unreadable */ }
      for (const e of names) {
        if (!e.isFile()) continue;
        let st; try { st = await fs.promises.stat(path.join(dir, e.name)); } catch { continue; }
        files.push({ name: e.name, ext: path.extname(e.name).toLowerCase().slice(1), ageDays: (Date.now() - st.mtimeMs) / 864e5 });
      }
    }
    return list.map((r) => {
      let hits = [];
      try { hits = files.filter((x) => customMatch({ pattern: String(r.pattern || ''), exts: r.exts || [], minAgeDays: r.minAgeDays || 0 }, x, x.ageDays)); } catch { /* bad regex */ }
      return { count: hits.length, names: hits.slice(0, 6).map((x) => x.name), bad: !!r.pattern && (() => { try { new RegExp(r.pattern, 'iu'); return false; } catch { return true; } })() };
    });
  });
  handle('rules:folders', () => {
    const out = new Set();
    for (const dir of existingFolders()) { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) out.add(e.name); } catch { /* skip */ } }
    return [...out].slice(0, 40);
  });
  handle('rules:update', ({ id, rule }) => {
    const r = cfg.rules.find((x) => x.id === id);
    if (!r) throw new Error('rule not found');
    if (rule.pattern) new RegExp(rule.pattern, 'iu'); // validate
    const exts = (rule.exts || []).map((e) => String(e).trim().replace(/^\./, '')).filter(Boolean);
    if (!rule.dest || (!rule.pattern && !exts.length)) throw new Error('rule needs a destination and a pattern or extensions');
    Object.assign(r, { name: rule.name || r.name, pattern: rule.pattern || '', exts, dest: rule.dest, monthly: !!rule.monthly });
    saveCfg(); return publicCfg();
  });
  handle('rules:add', (rule) => {
    if (rule.pattern) new RegExp(rule.pattern, 'iu'); // validate
    const r = { id: 'u' + Date.now().toString(36), enabled: true, name: rule.name || 'Rule', pattern: rule.pattern || '', exts: (rule.exts || []).map((e) => e.trim().replace(/^\./, '')).filter(Boolean), dest: rule.dest, monthly: !!rule.monthly, minAgeDays: 0 };
    if (!r.dest || (!r.pattern && !r.exts.length)) throw new Error('rule needs a destination and a pattern or extensions');
    cfg.rules.push(r); saveCfg(); return publicCfg();
  });
  handle('rules:toggle', (id) => { const r = cfg.rules.find((x) => x.id === id); if (r) r.enabled = !r.enabled; saveCfg(); return publicCfg(); });
  handle('rules:delete', (id) => { cfg.rules = cfg.rules.filter((x) => x.id !== id); saveCfg(); return publicCfg(); });
  handle('rules:pack', (id) => {
    const p = PACKS.find((x) => x.id === id);
    if (!p) throw new Error('pack not found');
    for (const r of p.rules) if (!cfg.rules.some((x) => x.id === r.id)) cfg.rules.push({ ...r });
    saveCfg(); return publicCfg();
  });
  handle('rules:export', async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'jadtoh-rules.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify({ jadtohRules: 1, rules: cfg.rules }, null, 2));
    return { file: r.filePath };
  });
  handle('rules:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { canceled: true };
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!j.jadtohRules || !Array.isArray(j.rules)) throw new Error('not a Bank JadToh rules file');
    let n = 0;
    for (const x of j.rules) {
      if (!x || typeof x.dest !== 'string' || (!x.pattern && !(x.exts || []).length)) continue;
      if (x.pattern) { try { new RegExp(x.pattern, 'iu'); } catch { continue; } }
      if (path.isAbsolute(x.dest)) continue; // imported rules may only target folders inside the managed folders
      if (!cfg.rules.some((y) => y.id === x.id)) { cfg.rules.push({ id: x.id || 'i' + Date.now().toString(36) + n, enabled: true, name: String(x.name || 'Imported'), pattern: x.pattern || '', exts: x.exts || [], dest: x.dest, monthly: !!x.monthly, minAgeDays: 0 }); n++; }
    }
    saveCfg(); return { imported: n, cfg: publicCfg() };
  });

  // what the app last offered to move: only these paths (from our own plan) can be moved by a "yes"
  handle('cmd:moveSuggested', async (srcs) => moveOffered(srcs));
  // let the AI propose a place for files the rules could not place; still only a preview until the user confirms
  handle('cmd:suggestAI', async (folder) => {
    const { sources } = await buildAllPlans({ useAI: true });
    const r = listFiles(sources, { scope: 'all', folder: typeof folder === 'string' ? folder : '' });
    rememberOffer(sources, r.filter.folder);
    allowThumbs(r.items.map((i) => i.src));
    return { ...r, ai: true };
  });
  handle('cmd:run', async (arg) => {
    const text = typeof arg === 'string' ? arg : String((arg && arg.text) || '');
    const history = arg && Array.isArray(arg.history) ? arg.history : [];
    const yes = isYes(text) && offerAlive();
    if (yes) return { action: 'moveLast', srcs: [...offer.items.keys()], count: offer.items.size, via: 'local' };
    if (cfg.aiEnabled && aiReady()) {
      try {
        const a = await ai.interpretCommand({ complete: aiComplete, text, lang: cfg.lang, modes: Object.keys(MODES), history });
        if (!a || typeof a.action !== 'string') throw new Error('no action');
        if (a.action === 'confirm') {
          if (offerAlive()) return { action: 'moveLast', srcs: [...offer.items.keys()], count: offer.items.size, via: 'ai' };
          return { action: 'chat', message: cfg.lang === 'en' ? 'There is nothing waiting to be moved. Ask me about a folder first.' : 'ตอนนี้ยังไม่มีอะไรรอให้ย้าย ลองถามเรื่องโฟลเดอร์ก่อนนะ', via: 'ai' };
        }
        if (a.action === 'rule' && a.rule) {
          if (a.rule.pattern) new RegExp(a.rule.pattern, 'iu');
          if (path.isAbsolute(a.rule.dest || '')) throw new Error('absolute destination not allowed');
        }
        // a "chat" reply that only apologises is useless: if the keywords match a real action, use that instead
        const local = localCommand(text);
        if (a.action === 'chat' && local.action !== 'search') return withInbox({ ...local, via: 'ai' });
        return withInbox({ ...a, via: 'ai' });
      } catch (e) {
        dlog('cmd:run AI failed, using local rules: ' + (e && e.message));
      }
    }
    return withInbox({ ...localCommand(text), via: 'local' });
  });

  /* ---- folder review: scan -> AI analyses -> user approves -> applied as one undoable batch ---- */
  let reviewScan = null;
  const reviewProps = new Map();
  handle('review:scan', async () => {
    reviewScan = await review.scanDesk(existingFolders(), { samples: true });
    reviewProps.clear();
    return { ai: !!(cfg.aiEnabled && aiReady()), folders: reviewScan.map((f) => ({ name: f.name, files: f.files, locked: f.locked })) };
  });
  handle('review:analyze', async () => {
    if (!(cfg.aiEnabled && aiReady())) throw new Error(tr('rv_need_ai'));
    if (!reviewScan || !reviewScan.length) return { score: 100, summary: '', suggestions: [], empty: true };
    const r = await review.reviewFolders({ complete: aiComplete, folders: reviewScan, lang: cfg.lang });
    reviewProps.clear();
    for (const s of r.suggestions) reviewProps.set(s.id, s);
    return { ...r, suggestions: r.suggestions.map(({ from, toPath, ...pub }) => pub) };
  });
  handle('review:apply', async (ids) => {
    const picked = (Array.isArray(ids) ? ids : []).map((id) => reviewProps.get(id)).filter(Boolean);
    suppressUntil = Date.now() + 5000;
    const r = await review.applyReview(picked, journal, { label: tr('rv_label') });
    for (const x of r.results) if (x.ok) reviewProps.delete(x.id);
    return { batchId: r.batch ? r.batch.id : null, results: r.results };
  });

  handle('drop:files', async (paths) => {
    const plan = await planLoose(paths, { destRoot: cfg.dropRoot, config: cfg, lang: cfg.lang });
    suppressUntil = Date.now() + 4000;
    const r = await applyItems(plan.items, journal, { label: 'Drop pad', kind: 'organize' });
    return { moved: r.results.filter((x) => x.ok).length, left: plan.unmatched.length, root: cfg.dropRoot };
  });

  handle('shell:reveal', (p) => { if (!okPath(p)) throw new Error('path not allowed'); shell.showItemInFolder(p); return true; });
  handle('shell:open', (p) => {
    if (!okPath(p)) throw new Error('path not allowed');
    if (pathGuard.isRunnable(p)) { shell.showItemInFolder(p); return ''; } // never launch programs/scripts from a click in a result list
    return shell.openPath(p);
  });
  handle('drop:open', () => { createDropPad(); return true; });
  handle('notice:size', ({ h }) => {
    if (!noticeWin || noticeWin.isDestroyed()) return false;
    if (!h || h <= 0) { noticeWin.hide(); return true; }
    const wa = screen.getPrimaryDisplay().workArea, W = 400, H = Math.min(Math.ceil(h), 620);
    noticeWin.setBounds({ x: wa.x + wa.width - W, y: wa.y + wa.height - H, width: W, height: H });
    if (!noticeWin.isVisible()) noticeWin.showInactive();
    dlog(`notice size h=${H} visible=${noticeWin.isVisible()} bounds=${JSON.stringify(noticeWin.getBounds())} wa=${JSON.stringify(wa)}`);
    return true;
  });
  handle('notice:open', (tab) => { showWin(tab); return true; });

  handle('widget:data', () => ({ ...recentFiled(journal, { limit: 6 }), lang: cfg.lang, collapsed: !!cfg.widgetCollapsed }));
  handle('widget:size', ({ h }) => {
    if (!widgetWin || widgetWin.isDestroyed()) return false;
    const [x, y] = widgetWin.getPosition();
    widgetWin.setBounds({ x, y, width: WIDGET_W, height: Math.max(60, Math.min(Math.ceil(h), 600)) });
    if (!widgetWin.isVisible()) widgetWin.showInactive();
    return true;
  });
  handle('widget:reveal', (p) => {
    // only files the journal actually filed may be revealed
    if (recentFiled(journal, { limit: 50 }).items.some((i) => i.full === p)) shell.showItemInFolder(p);
    return true;
  });
  handle('widget:collapse', (v) => { cfg.widgetCollapsed = !!v; saveCfg(); return true; });
  handle('widget:hide', () => { cfg.widget = false; saveCfg(); closeWidget(); updateTray(); send('inbox:changed'); return true; });
  handle('widget:open', () => { showWin(); return true; });
  handle('notice:test', async () => {
    await notice({ kind: 'ok', title: tr('n_test'), sub: tr('n_test_sub'), tab: 'settings', items: [{ name: 'Screenshot 2026-11-05.png', to: tr('n_test_dest') }, { name: 'report.pdf', to: tr('n_test_dest2') }] });
    return true;
  });
}

/** "inbox" answers come from a local scan; the AI only chose the filter and never sees file names. */
let offer = { at: 0, items: new Map(), folder: '' };
const offerAlive = () => offer.items.size > 0 && Date.now() - offer.at < 10 * 60 * 1000;
const isYes = (s) => /^\s*(จัดเลย|ทำเลย|ทำให้เลย|จัดให้เลย|ได้เลย|ตกลง|โอเค|ok|okay|yes|yep|do it|go ahead|go)\s*[!.\s]*$/i.test(s);
/** Remember which files in the filtered folder(s) have a confident destination, so "yes" can move them. */
function rememberOffer(sources, folder) {
  const items = new Map();
  const keep = listFiles(sources, { scope: 'all', folder }, { limit: 100000 }).items;
  const wanted = new Set(keep.map((k) => k.src));
  for (const s of sources) for (const i of s.items) if (i.confidence !== 'low' && wanted.has(i.src)) items.set(i.src, i);
  offer = { at: Date.now(), items, folder: folder || '' };
}
async function moveOffered(srcs) {
  const items = (Array.isArray(srcs) ? srcs : []).map((s) => offer.items.get(s)).filter(Boolean);
  if (!items.length) return { results: [], batch: null };
  const r = await applyAndTrack(items, cfg.lang === 'en' ? 'From command bar' : 'จัดจากแถบคำสั่ง');
  for (const i of items) offer.items.delete(i.src);
  return r;
}
async function withInbox(a) {
  if (a.action !== 'inbox') return a;
  const { sources } = await buildAllPlans({ useAI: false });
  const r = listFiles(sources, a.filter);
  // for folder questions the useful answer covers every file there (filed or not), then offers the move
  rememberOffer(sources, r.filter.folder);
  // "act without asking" mode: only moves the rule-based, confident suggestions (never AI guesses); still one undoable batch
  if (cfg.cmdAuto && r.total) {
    const srcs = [...offer.items.values()].filter((i) => i.source !== 'ai').map((i) => i.src);
    if (srcs.length) return { ...a, filter: r.filter, result: r, auto: await moveOffered(srcs) };
  }
  allowThumbs(r.items.map((i) => i.src));
  return { ...a, filter: r.filter, result: r };
}

function localCommand(text) {
  const s = text.trim();
  let m;
  // careful: Thai "เปิด" (on) contains "ปิด" (off), so "off" must not be preceded by "เ"
  const onoff = /(?<!เ)ปิด|disable|turn off|\bstop\b/i.test(s) ? false : /เปิด|enable|turn on|\bstart\b/i.test(s) ? true : null;
  if (onoff !== null) {
    if (/(วิดเจ็ต|widget)/i.test(s) && /(บนสุด|always on top|top)/i.test(s)) return { action: 'setting', key: 'widgetTop', value: onoff };
    if (/(วิดเจ็ต|widget)/i.test(s)) return { action: 'setting', key: 'widget', value: onoff };
    if (/(แจ้งเตือน|notif)/i.test(s)) return { action: 'setting', key: 'notify', value: onoff };
    if (/(พร้อม ?windows|startup|เปิดเครื่อง)/i.test(s)) return { action: 'setting', key: 'startup', value: onoff };
    if (/(อัตโนมัติ|auto|ติดตาม|watch)/i.test(s)) return { action: 'setting', key: 'watch', value: onoff };
  }
  if (/(เรียง|จัด|ปรับ|arrange|tidy|line up|fix).*(ไอคอน|icon)|(เรียง|arrange).*(หน้าจอ|เดสก์ท็อป|desktop|screen)|(เป็นรู|ช่องว่าง|gap|hole).*(ไอคอน|หน้าจอ|icon|screen|desktop)/i.test(s)) return { action: 'layout', ...(/(ปกติ|ธรรมดา|plain|normal|ตาราง|grid)/i.test(s) ? { mode: 'plain' } : /(วอลเปเปอร์|wallpaper|ภาพพื้นหลัง)/i.test(s) ? { mode: 'wallpaper' } : {}), sort: /(ชื่อ|name|a-z|ตัวอักษร)/i.test(s) ? 'name' : /(ประเภท|type)/i.test(s) ? 'type' : /(วันที่|date|ใหม่|เก่า)/i.test(s) ? 'date' : /(ขนาด|size)/i.test(s) ? 'size' : 'current' };
  if (/(ไฟล์ซ้ำ|ซ้ำกัน|duplicate)/i.test(s)) return { action: 'clean', kind: 'dupes' };
  if (/(รูป.*(คล้าย|ซ้ำ)|similar)/i.test(s)) return { action: 'clean', kind: 'similar' };
  if (/(ไม่ค่อยใช้|ไม่ได้ใช้|unused|rarely)/i.test(s)) return { action: 'clean', kind: 'unused' };
  if (/(ล้าง|ทำความสะอาด|clean ?up|clear|ลบ.*(เก่า|ตัวติดตั้ง|แคป|ทางลัดเสีย))/i.test(s)) return { action: 'clean', kind: 'stale' };
  if (/(ความปลอดภัย|ความลับ|รหัสผ่าน|secret|password|vault|guard)/i.test(s)) return { action: 'goto', tab: 'guard' };
  if (/(ประวัติ|ย้อนเวลา|time machine|history|snapshot)/i.test(s)) return { action: 'goto', tab: 'history' };
  if (/(กฎ|rules?)/i.test(s) && !/(สร้าง|เพิ่ม|add|create)/i.test(s)) return { action: 'goto', tab: 'rules' };
  if (/(ตั้งค่า|settings?)/i.test(s)) return { action: 'goto', tab: 'settings' };
  if (/(เช็ค|ตรวจ|รีวิว|ประเมิน|check|review|audit).*(โฟลเดอร์|แฟ้ม|หมวดหมู่|folder)|(โฟลเดอร์|folder).*(เข้าใจง่าย|จัดหมวด|ชื่อ|clear)/i.test(s)) return { action: 'review' };
  const fm = s.match(/\b[a-z]:[\\/]?[^\s"']*/i);
  const folderHint = fm ? fm[0] : /ดาวน์โหลด|download/i.test(s) ? 'downloads' : /เดสก์ท็อป|desktop|หน้าจอ/i.test(s) ? 'desktop' : '';
  if (folderHint && /(เหมาะสม|ถูกที่|ถูกต้อง|เก็บ.*ถูก|จัดหมวด|อยู่ใน|well placed|right place|suitable|proper|belong)/i.test(s)) return { action: 'inbox', filter: { scope: 'all', folder: folderHint } };
  if (/(ยังไม่ถูกจัด|ไม่ถูกจัดหมวด|ยังไม่ได้จัด|ที่เหลือ|unsorted|uncategori[sz]ed|not (filed|sorted)|left ?over)/i.test(s)) return { action: 'inbox', filter: { scope: 'unsorted' } };
  if ((m = s.match(/^(ค้นหา|หา|search|find)\s+(.+)/i))) return { action: 'search', query: m[2] };
  if (/(ย้อนกลับ|undo)/i.test(s)) return { action: 'undo' };
  if (/(โหมด|mode)/i.test(s) || /(แสดงทั้งหมด|show all)/i.test(s)) {
    if (/(เกม|game)/i.test(s)) return { action: 'mode', mode: 'game' };
    if (/(ประชุม|meeting)/i.test(s)) return { action: 'mode', mode: 'meeting' };
    if (/(งาน|work)/i.test(s)) return { action: 'mode', mode: 'work' };
    return { action: 'mode', mode: 'all' };
  }
  if (/(จัด|organi[sz]e|tidy|scan|สแกน)/i.test(s)) return { action: 'organize' };
  return { action: 'search', query: s };
}

/* ---------- lifecycle ---------- */

function bootstrap() {
  loadCfg();
  const data = app.getPath('userData');
  journal = new Journal(path.join(data, 'journal.json'));
  journal.onChange = () => pushWidget();
  vault = new Vault(path.join(data, 'vault'));
  snaps = new Snapshots(path.join(data, 'snapshots'));
  registerIpc();
  createWindow();

  try {
    const img = nativeImage.createFromPath(ICON);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
    tray.on('click', () => showWin());
    updateTray();
  } catch { /* tray unavailable */ }

  setupUpdater();
  if (!SMOKE) startModeTimer();
  if (cfg.widget && (!SMOKE || process.env.JADTOH_WIDGET_TEST === '1')) createWidget();
  if (cfg.watch) startWatch();
  snaps.take(existingFolders());
  setInterval(() => snaps.take(existingFolders()), 6 * 3600 * 1000);

  try {
    globalShortcut.register('Control+Alt+J', () => { showWin(); send('palette:open'); });
    globalShortcut.register('Control+Alt+D', createDropPad);
  } catch { /* shortcut taken */ }

  if (process.env.JADTOH_SELFTEST === '1') {
    // real (non-smoke) run: drop a screenshot into the watched folder and log what the popup does
    setTimeout(() => fs.writeFileSync(path.join(cfg.folders[0], 'Screenshot 2026-11-05 selftest.png'), 'png'), 3000);
    setTimeout(async () => {
      if (process.env.JADTOH_NOTICE_SHOT && noticeWin && !noticeWin.isDestroyed()) fs.writeFileSync(process.env.JADTOH_NOTICE_SHOT, (await noticeWin.webContents.capturePage()).toPNG());
    }, 9000);
    setTimeout(() => dlog('t+17s (~9s after popup) visible=' + (noticeWin && !noticeWin.isDestroyed() ? noticeWin.isVisible() : 'none')), 17000);
    setTimeout(() => dlog('t+26s (~18s after popup) visible=' + (noticeWin && !noticeWin.isDestroyed() ? noticeWin.isVisible() : 'none')), 26000);
    setTimeout(() => { dlog('selftest end; noticeWin visible=' + (noticeWin && !noticeWin.isDestroyed() ? noticeWin.isVisible() : 'none')); app.exit(0); }, 27000);
  }

  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      for (let i = 0; i < 40; i++) {
        if (await win.webContents.executeJavaScript(`!!document.querySelector('#view h1')`)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const out = await win.webContents.executeJavaScript(`JSON.stringify({title:document.title,nav:document.querySelectorAll('nav button').length,view:document.querySelector('#view h1')?.textContent,errors:window.__errors||[],api:typeof window.api,i18n:typeof window.I18N,navHtml:document.querySelector('#nav')?.innerHTML.length,view:document.querySelector('#view')?.innerHTML.length})`);
      win.webContents.on('console-message', (_e, _l, m) => console.log('CONSOLE ' + m));
      console.log('SMOKE ' + out);
      if (process.env.JADTOH_SMOKE_DEEP === '1') {
        // exercise every tab and the read-only scans; print counts only
        const deep = await win.webContents.executeJavaScript(`(async () => {
          const res = {};
          for (const [id] of TABS) { go(id); await new Promise(r => setTimeout(r, 400)); res[id] = document.querySelector('#view h1')?.textContent || 'MISSING'; }
          go('organize'); await ACTS.scan();
          res.planItems = state.plan.sources.map(s => s.items.length); res.unmatched = state.plan.sources.map(s => s.unmatched.length);
          res.planRendered = document.querySelectorAll('#planBox tr').length;
          state.gd.scanned = 0; go('guard'); await new Promise(r => setTimeout(r, 4000)); res.guardCards = document.querySelectorAll('.gcard').length; res.guardLevel = gdLevel();
          state.cl = null; go('cleanup'); await new Promise(r => setTimeout(r, 7000)); res.cleanupCards = document.querySelectorAll('.ccard').length; res.cleanupDone = Object.values(state.cl.status).filter(s => s === 'done').length;
          go('search'); document.querySelector('#q').value = 'pdf'; await runSearch(); res.searchRows = document.querySelectorAll('.rcard').length;
          go('history'); await new Promise(r => setTimeout(r, 400)); res.historyOk = !!document.querySelector('#view .card');
          res.lang = cfg.lang; cfg.lang = cfg.lang === 'th' ? 'en' : 'th'; go('organize'); res.otherLangH1 = document.querySelector('#view h1').textContent;
          res.errors = window.__errors; return JSON.stringify(res);
        })()`);
        console.log('DEEP ' + deep);
      }
      if (process.env.JADTOH_SIMILAR_TEST === '1') {
        // build real image files: a picture, a smaller re-save of it, and a different picture
        const dir = cfg.folders[0];
        fs.mkdirSync(dir, { recursive: true });
        const make = (w, h, f) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.max(0, Math.min(255, f(x / w, y / h) + ((x * 73856093) ^ (y * 19349663)) % 17 - 8)); b.set([v * 0.9, v, v * 1.1 > 255 ? 255 : v * 1.1, 255], (y * w + x) * 4); } return nativeImage.createFromBitmap(b, { width: w, height: h }); };
        const pic = (u, v) => 30 + u * 190 + Math.sin(v * 9) * 25;
        fs.writeFileSync(path.join(dir, 'holiday_big.png'), make(640, 480, pic).toPNG());
        fs.writeFileSync(path.join(dir, 'holiday_small.jpg'), make(320, 240, pic).toJPEG(80));
        fs.writeFileSync(path.join(dir, 'other.png'), make(640, 480, (u, v) => 230 - v * 190 + Math.cos(u * 11) * 30).toPNG());
        fs.writeFileSync(path.join(dir, 'solid.png'), make(300, 300, () => 120).toPNG());
        const t0 = Date.now();
        const r = await findSimilarImages([dir]);
        console.log('SIMILAR ' + JSON.stringify({ ms: Date.now() - t0, scanned: r.scanned, groups: r.groups.map((g) => ({ keep: path.basename(g.keep), files: g.files.map((f) => path.basename(f.path) + ':' + f.w + 'x' + f.h), similarity: g.similarity, hasThumb: !!g.files[0].thumb })) }));
      }
      if (process.env.JADTOH_QR_UI === '1') {
        // files the rule engine does not know -> create a rule from the tile itself, never visiting the Rules page
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        for (const n of ['alpha.dwg', 'omega.dwg', 'client_brief.xyz', 'mystery.zzz', 'report.pdf', 'photo.jpg']) fs.writeFileSync(path.join(desk, n), n.endsWith('.jpg') || n.endsWith('.pdf') ? 'x' : 'x'.repeat(4096));
        win.setSize(1240, 1500); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_QR_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        const R = {};
        try {
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.plan = null; state.scanning = false; go('organize'); await sl(4000);");
          R.leftBefore = await run("return JSON.stringify(state.plan.sources.flatMap(s => s.unmatched.map(u => u.name)));");
          R.leftTilesClickable = await run("return document.querySelectorAll('.leftbox .tile[data-act=qrOpen]').length;");
          await shot('1-left-box');
          const src = path.join(desk, 'alpha.dwg');
          await run("ACTS.qrOpen({ dataset: { src: " + JSON.stringify(src) + " } }); await sl(900);");
          R.draft = await run("return JSON.stringify(qr.d);");
          await run("const d = document.querySelector('#qrDest'); d.value = 'งานออกแบบ\\\\DWG'; d.dispatchEvent(new Event('input', { bubbles: true })); await sl(1200);");
          R.previewNames = await run("return JSON.stringify(qr.prev);");
          await shot('2-dialog');
          // invalid state: nothing ticked -> save disabled
          R.saveDisabledWhenEmpty = await run("const e = document.querySelector('#qrUseExt'); e.checked = false; e.dispatchEvent(new Event('change')); await sl(500); const dis = document.querySelector('#qrSave').disabled; e.checked = true; e.dispatchEvent(new Event('change')); await sl(900); return dis;");
          await run("document.querySelector('#qrSave').click(); await sl(3500);");
          R.rules = await run("return JSON.stringify(cfg.rules.map(r => ({ name: r.name, pattern: r.pattern, exts: r.exts, dest: r.dest })));");
          R.leftAfter = await run("return JSON.stringify(state.plan.sources.flatMap(s => s.unmatched.map(u => u.name)));");
          R.planNow = await run("return JSON.stringify(state.plan.sources.flatMap(s => s.items.filter(i => i.reason.k === 'rule').map(i => ({ n: i.name, rel: i.rel, sel: state.sel.has(i.src), conf: i.confidence }))));");
          R.note = await run("return document.querySelector('.done.note') ? document.querySelector('.done.note').textContent.replace(/\\s+/g, ' ') : null;");
          await shot('3-after');
          R.err = await run("return window.__errors;");
        } catch (e) { R.failure = String(e.message || e); }
        console.log('QRUI ' + JSON.stringify(R));
        win.hide();
      }
      if (process.env.JADTOH_THEME_UI === '1') {
        // renders the popup + widget in every theme and stitches one contact sheet. Touches no user data (theme is restored).
        const sl = (ms) => new Promise((r) => setTimeout(r, ms));
        if (process.env.JADTOH_THEME_FX) cfg.themeFx = process.env.JADTOH_THEME_FX;
        const saved = { themeFx: process.env.JADTOH_THEME_FX ? 'icons' : cfg.themeFx, theme: cfg.theme, themeAuto: cfg.themeAuto, notify: cfg.notify, weather: cfg.weather };
        const setT = (id) => {
          if (id.startsWith('wx-')) { cfg.theme = 'default'; cfg.weather = { on: true, place: { name: 'กรุงเทพมหานคร', area: 'กรุงเทพฯ, ไทย', lat: 13.75, lon: 100.5 } }; wxNow = { kind: id.slice(3), temp: 31, at: Date.now(), place: 'กรุงเทพมหานคร' }; }
          else { cfg.theme = id; cfg.weather = { on: false, place: null }; wxNow = null; }
          broadcastTheme();
        };
        const sheet = [];
        try {
          cfg.notify = true; cfg.themeAuto = false;
          createWidget(); await sl(1500);
          const items = [
            { name: 'Screenshot 2026-11-05 231402.png', folder: 'Screenshots', category: 'captures', time: Date.now() - 20000, auto: true, full: 'x' },
            { name: 'ใบเสร็จค่าไฟ พ.ย.pdf', folder: 'เอกสาร', category: 'documents', time: Date.now() - 600000, auto: true, full: 'x' },
            { name: 'ชุดติดตั้ง Chrome.exe', folder: 'Installers', category: 'installers', time: Date.now() - 4000000, auto: false, full: 'x' },
            { name: 'Steam', folder: 'เกมและแชท', category: 'sc:games', time: Date.now() - 90000000, auto: true, full: 'x' },
          ];
          for (const id of (process.env.JADTOH_THEME_IDS || 'default,loy,xmas,newyear,valentine,songkran,halloween').split(',')) {
            setT(id); await sl(900);
            await widgetWin.webContents.executeJavaScript('data = ' + JSON.stringify({ items, todayCount: 7, lang: 'th' }) + '; collapsed = false; render();');
            await sl(1400);
            await ensureNotice();
            noticeWin.webContents.send('jt:notice', { title: 'จัดโต๊ะให้แล้ว 3 ไฟล์', sub: 'จากโฟลเดอร์ Desktop', items: [{ name: items[0].name, to: 'Screenshots' }, { name: items[1].name, to: 'เอกสาร' }, { name: items[2].name, to: 'Installers' }], duration: 0, undoId: 'x', undoLabel: 'ย้อนกลับ', tab: 'history', viewLabel: 'ดู', undoneLabel: 'ย้อนแล้ว' });
            await sl(2200);
            const wImg = (await widgetWin.webContents.capturePage()).toDataURL();
            const nImg = (await noticeWin.webContents.capturePage()).toDataURL();
            sheet.push({ id, wImg, nImg });
            noticeWin.webContents.executeJavaScript("document.getElementById('stack').innerHTML=''");
          }
          const html = '<body style="margin:0;background:#8a93a8;font:12px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:10px">' + sheet.map((x) => '<div style="background:repeating-conic-gradient(#7b8499 0 25%,#8a93a8 0 50%) 0 0/20px 20px;padding:6px;display:flex;gap:6px;align-items:flex-start"><b style="position:absolute;margin:-2px 0 0 4px">' + x.id + '</b><img src="' + x.nImg + '" style="height:260px"><img src="' + x.wImg + '" style="height:260px"></div>').join('') + '</div></body>';
          const sheetWin = new BrowserWindow({ width: 1500, height: 1250, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, disableBlinkFeatures: 'Auxclick' } });
          fs.writeFileSync(process.env.JADTOH_THEME_SHOT + '.html', html); await sheetWin.loadFile(process.env.JADTOH_THEME_SHOT + '.html');
          await sl(800);
          fs.writeFileSync(process.env.JADTOH_THEME_SHOT, (await sheetWin.webContents.capturePage()).toPNG());
          sheetWin.destroy();
          if (process.env.JADTOH_THEME_SHOT2) {
            setT(process.env.JADTOH_THEME_MAIN || 'loy');
            win.setSize(1240, 1500); win.showInactive();
            await win.webContents.executeJavaScript("(async () => { cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; go('" + (process.env.JADTOH_THEME_TAB || 'settings') + "'); await new Promise(r => setTimeout(r, 2500)); })()");
            await sl(800);
            fs.writeFileSync(process.env.JADTOH_THEME_SHOT2, (await win.webContents.capturePage()).toPNG());
            win.hide();
          }
        } catch (e) { console.log('THEMEUI failure ' + (e.stack || e)); }
        Object.assign(cfg, saved); wxNow = null; broadcastTheme();
        console.log('THEMEUI done ' + sheet.length);
        closeWidget(); if (noticeWin && !noticeWin.isDestroyed()) noticeWin.close();
      }
      if (process.env.JADTOH_AI_UI === '1') {
        // in-memory sample connections (never saved), open Settings -> AI, optionally with the add form
        const saved = { aiConns: cfg.aiConns, aiActive: cfg.aiActive, aiEnabled: cfg.aiEnabled };
        cfg.aiEnabled = true; cfg.aiActive = 'c1';
        cfg.aiConns = [
          { id: 'c1', provider: 'anthropic', label: 'Claude (งาน)', model: 'claude-haiku-5-5', baseUrl: '', keyEnc: 'b64:eA==' },
          { id: 'c2', provider: 'openai', label: 'OpenAI ส่วนตัว', model: 'gpt-4o-mini', baseUrl: '', keyEnc: 'b64:eA==' },
          { id: 'c3', provider: 'ollama', label: 'Ollama ในเครื่อง', model: 'llama3.2', baseUrl: '', keyEnc: '' },
          { id: 'c4', provider: 'gemini', label: 'Gemini', model: 'gemini-2.0-flash', baseUrl: '', keyEnc: '' },
        ];
        win.setSize(1240, 1700); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const R = {};
        try {
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; aiui.res = { c1: { ok: true, ms: 640, reply: 'OK' }, c4: { ok: false, msg: 'Google Gemini: 400 API key not valid' } }; go('settings'); await sl(2200);");
          if (process.env.JADTOH_AI_FORM) await run("ACTS.aiAdd(); await sl(300); ACTS.aiPickProv({ dataset: { p: '" + process.env.JADTOH_AI_FORM + "' } }); await sl(500);");
          await run("document.querySelector('.aic-list').scrollIntoView({ block: 'start' }); await sl(500);");
          R.cards = await run("return document.querySelectorAll('.aic:not(.add)').length;");
          // scroll must survive a re-render of the same page, and reset when another page opens (render-only actions: nothing is saved)
          R.scroll = await run("const m = document.querySelector('#view'); m.scrollTop = 1400; await sl(200); const a = m.scrollTop; ACTS.aiAdd(); await sl(900); const b = m.scrollTop; ACTS.aiCancel(); await sl(300); const c = m.scrollTop; go('search'); await sl(400); const d = m.scrollTop; return JSON.stringify({ set: a, afterAdd: b, afterCancel: c, otherPage: d, formVisible: false });");
          R.err = await run("return window.__errors;");
          fs.writeFileSync(process.env.JADTOH_AI_SHOT, (await win.webContents.capturePage()).toPNG());
        } catch (e) { R.failure = String(e.message || e); }
        console.log('AIUI ' + JSON.stringify(R));
        Object.assign(cfg, saved); win.hide();
      }
      if (process.env.JADTOH_HOSTILE === '1' && TESTING) {
        // pen-test: hostile strings in file names, rules, AI labels and weather place; every page must render them as plain text
        const PAY = '<img src=x onerror=window.__pwn=1>';
        const desk = cfg.folders[0]; fs.mkdirSync(desk, { recursive: true });
        const names = ['&lt;img src=x onerror=window.__pwn=1&gt;.txt', "it's a test.txt", '${7*7}${alert(1)}.txt', 'a&b;c.txt', '\u202egnp.exe', 'x onerror=window.__pwn=1 y.txt', 'A'.repeat(200) + '.txt', '%s%s%n.txt', 'ใบเสร็จ <script>.txt'.replace(/[<>]/g, ''), '{{constructor.constructor(1)()}}.txt'];
        for (const n of names) { try { fs.writeFileSync(path.join(desk, n), 'hello secret password=abc12345678 ' + n); } catch (e) { console.log('HOSTILE skip name ' + n.slice(0, 20) + ' ' + e.code); } }
        cfg.rules = [{ id: 'h1', enabled: true, name: PAY, pattern: '<script>window.__pwn=1</script>', exts: ['<i>'], dest: '<b id=pwn>x</b>', monthly: false }];
        cfg.aiConns = [{ id: 'h2', provider: 'custom', label: PAY, model: PAY, baseUrl: 'https://example.com/v1', keyEnc: 'b64:eA==' }]; cfg.aiActive = 'h2'; cfg.aiEnabled = true;
        cfg.weather = { on: true, place: { name: PAY, area: PAY, lat: 1, lon: 1 } }; wxNow = { kind: 'rain', temp: 1, at: Date.now(), place: PAY };
        cfg.guardIgnore = [path.join(desk, PAY.replace(/[<>"]/g, ''))];
        win.setSize(1240, 1500); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const R = { tabs: {} };
        const probe = "return JSON.stringify({ pwn: window.__pwn || null, bad: document.querySelectorAll('[onerror], img[src=\"x\"], #pwn, script:not([src])').length, errs: (window.__errors || []).length, shownAsText: document.body.innerText.includes('<img src=x onerror') });";
        try {
          startWatch();
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; window.__pwn = null; await sl(300);");
          for (const tab of ['organize', 'auto', 'guard', 'cleanup', 'modes', 'layout', 'search', 'history', 'rules', 'settings']) {
            await run("go('" + tab + "'); await sl(" + (tab === 'organize' || tab === 'guard' ? 3500 : 1800) + ");");
            if (tab === 'search') await run("state.searchQ = 'txt'; const q = document.querySelector('#q'); if (q) { q.value = 'txt'; q.dispatchEvent(new Event('input', { bubbles: true })); } await sl(1800);");
            if (tab === 'rules') await run("ACTS.rlNew && ACTS.rlNew(); await sl(500);");
            R.tabs[tab] = JSON.parse(await run(probe));
          }
          // the quick-rule dialog, command palette and the notice/widget windows
          await run("go('organize'); await sl(2500); const t0 = document.querySelector('.tile'); if (t0) t0.click(); await sl(600);");
          R.tabs.quickRule = JSON.parse(await run(probe));
          await run("closeModal && closeModal(); openPalette(); document.querySelector('#palIn').value = '" + PAY.replace(/'/g, '') + "'; document.querySelector('#palIn').dispatchEvent(new Event('input', { bubbles: true })); await sl(800);");
          R.tabs.palette = JSON.parse(await run(probe));
          await ensureNotice();
          noticeWin.webContents.send('jt:notice', { title: PAY, sub: PAY, items: [{ name: PAY, to: PAY }], duration: 0, undoId: 'x', undoLabel: PAY, tab: 'history', viewLabel: PAY, undoneLabel: PAY });
          await new Promise((r) => setTimeout(r, 1500));
          R.notice = JSON.parse(await noticeWin.webContents.executeJavaScript("JSON.stringify({ shownAsText: document.body.innerText.includes('<img src=x onerror'), pwn: window.__pwn || null, bad: document.querySelectorAll('[onerror], img[src=\"x\"]').length })"));
          createWidget(); await new Promise((r) => setTimeout(r, 1500));
          await widgetWin.webContents.executeJavaScript("data = { items: [{ name: '" + PAY + "', folder: '" + PAY + "', category: 'rule:x', time: Date.now(), auto: true, full: 'x' }], todayCount: 1, lang: 'th' }; render();");
          await new Promise((r) => setTimeout(r, 600));
          R.widget = JSON.parse(await widgetWin.webContents.executeJavaScript("JSON.stringify({ shownAsText: document.body.innerText.includes('<img src=x onerror'), pwn: window.__pwn || null, bad: document.querySelectorAll('[onerror], img[src=\"x\"]').length })"));
          // main-process guards
          const tryIpc = async (ch, arg) => { const r = await win.webContents.executeJavaScript("window.api.invoke('" + ch + "', " + JSON.stringify(arg) + ")"); return r && r.error ? 'refused: ' + r.error : JSON.stringify(r); };
          const outside = path.join(app.getPath('temp'), 'jt-outside.txt'); fs.writeFileSync(outside, 'keep me');
          R.ipc = {
            openExe: await tryIpc('shell:open', 'C:\\Windows\\System32\\calc.exe'),
            openOutside: await tryIpc('shell:open', outside),
            revealOutside: await tryIpc('shell:reveal', outside),
            trashOutside: await tryIpc('cleanup:trash', [outside]),
            traversal: await tryIpc('cleanup:trash', [path.join(desk, '..', '..', 'jt-outside.txt')]),
            vaultOutside: await tryIpc('vault:add', { file: outside }),
          };
          R.outsideStillThere = fs.existsSync(outside); fs.unlinkSync(outside);
          R.pwnMain = await run("return window.__pwn || null;");
        } catch (e) { R.failure = String(e.stack || e).slice(0, 400); }
        console.log('HOSTILE ' + JSON.stringify(R));
        closeWidget(); win.hide();
        if (process.env.JADTOH_HOSTILE_QUIT === '1') { quitting = true; app.quit(); }
      }
      if (process.env.JADTOH_TRUST_UI === '1') {
        // read-only: open Settings, screenshot the Security card
        win.setSize(1240, 1300); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const R = {};
        try {
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; go('settings'); await sl(2500);");
          if (process.env.JADTOH_TRUST_OPEN) await run("document.querySelectorAll('.tr-card')[" + Number(process.env.JADTOH_TRUST_OPEN) + "].open = true; await sl(200);");
          await run("document.querySelector('.trust').scrollIntoView({ block: 'start' }); await sl(500);");
          R.rows = await run("return document.querySelectorAll('.tr-card').length;");
          R.hero = await run("return (document.querySelector('.tr-hero b') || {}).textContent;");
          R.live = await run("return [...document.querySelectorAll('.tr-live span')].map(e => e.textContent);");
          R.err = await run("return window.__errors;");
          fs.writeFileSync(process.env.JADTOH_TRUST_SHOT, (await win.webContents.capturePage()).toPNG());
        } catch (e) { R.failure = String(e.message || e); }
        console.log('TRUSTUI ' + JSON.stringify(R));
        win.hide();
      }
      if (process.env.JADTOH_SETTINGS_UI === '1') {
        win.setSize(1240, 1900); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_SETTINGS_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        const R = {};
        try {
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; go('settings'); await sl(2500);");
          await shot('1-default');
          // switch, segmented control, slider, privacy card - each must persist in the real config
          await run("ACTS.setTog({ dataset: { k: 'notify', def: '1' } }); await sl(900);");
          R.notifyOff = await run("return JSON.stringify({ ui: cfg.notify, segDisabled: document.querySelector('.seg.dis') !== null });");
          await run("ACTS.setTog({ dataset: { k: 'notify', def: '1' } }); await sl(700); ACTS.setSeg({ dataset: { k: 'notifySec', v: '30' } }); await sl(700); ACTS.setSeg({ dataset: { k: 'aiPrivacy', v: 'content' } }); await sl(700); ACTS.setTog({ dataset: { k: 'aiEnabled', def: '0' } }); await sl(700);");
          await run("const el = document.querySelector('.srange[data-k=staleDays]'); el.value = 90; el.dispatchEvent(new Event('input', { bubbles: true })); R0 = document.querySelector('#val-staleDays').textContent; el.dispatchEvent(new Event('change', { bubbles: true })); await sl(900);");
          R.persisted = await run("const c = await window.api.invoke('cfg:get'); return JSON.stringify({ notify: c.notify, notifySec: c.notifySec, aiPrivacy: c.aiPrivacy, aiEnabled: c.aiEnabled, staleDays: c.staleDays });");
          await run("ACTS.setSeg({ dataset: { k: 'lang', v: 'en' } }); await sl(1500);");
          R.langEn = await run("return document.querySelector('#view h1').textContent + ' | ' + document.querySelector('.seg button.on').textContent;");
          await shot('2-changed-en');
          await run("ACTS.setSeg({ dataset: { k: 'lang', v: 'th' } }); await sl(900); ACTS.setTog({ dataset: { k: 'aiEnabled', def: '0' } }); await sl(500);");
          R.err = await run("return window.__errors;");
        } catch (e) { R.failure = String(e.message || e); }
        console.log('SETTINGSUI ' + JSON.stringify(R));
        win.hide();
      }
      if (process.env.JADTOH_RULES_UI === '1') {
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        for (const n of ['receipt_0912.pdf', 'ใบเสร็จ ร้านกาแฟ.png', 'ใบเสร็จรับเงิน_ตุลาคม.pdf', 'invoice_0042.pdf', 'tax-inv 2026.pdf', 'notes.txt', 'db_backup.sql', 'game_clip_valorant.mp4', 'logo.psd']) fs.writeFileSync(path.join(desk, n), 'x');
        cfg.rules.push({ id: 'u-demo1', enabled: true, name: 'ภาพประกอบงาน', pattern: 'logo|banner|mockup', exts: ['psd', 'ai', 'fig'], dest: 'Design\\Source', monthly: false, minAgeDays: 0 });
        win.setSize(1240, 1800); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_RULES_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        const R = {};
        try {
          await run("await window.api.invoke('rules:pack', 'finance'); cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; rl.open = false; go('rules'); await sl(2500);");
          await shot('1-list');
          await run("ACTS.rlNew(); await sl(400); const set = (f, v) => { const el = document.querySelector('.rl-in[data-f=' + f + ']'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; set('words', 'ใบเสร็จ, receipt'); ACTS.rlType({ dataset: { g: 'docs' } }); await sl(300); ACTS.rlType({ dataset: { g: 'images' } }); await sl(300); set('dest', 'การเงิน\\\\ใบเสร็จ'); document.querySelector('[data-f=monthly]').click(); await sl(1500);");
          R.preview = await run("return JSON.stringify(rl.prev);");
          R.draftRule = await run("return JSON.stringify(rlRule(rl.draft));");
          await shot('2-builder');
          R.badRegex = await run("rl.draft.advanced = true; rl.draft.raw = 'receipt(['; rlRerender(); await rlTest(); await sl(600); const t0 = document.querySelector('#rlPrev').textContent; rl.draft.advanced = false; rlRerender(); return t0;");
          await run("ACTS.rlSave(); await sl(1800);");
          R.saved = await run("const r = cfg.rules[cfg.rules.length - 1]; return JSON.stringify({ n: cfg.rules.length, name: r.name, pattern: r.pattern, exts: r.exts, dest: r.dest, monthly: r.monthly });");
          R.editRoundtrip = await run("const r = cfg.rules[cfg.rules.length - 1]; ACTS.rlEdit({ dataset: { id: r.id } }); await sl(1500); return JSON.stringify({ words: rl.draft.words, types: rl.draft.types, dest: rl.draft.dest, monthly: rl.draft.monthly, advanced: rl.draft.advanced });");
          await shot('3-edit');
          R.err = await run("return window.__errors;");
        } catch (e) { R.failure = String(e.message || e); }
        console.log('RULESUI ' + JSON.stringify(R));
        win.hide();
      }
      if (process.env.JADTOH_HISTORY_UI === '1') {
        // a believable two-week history in an isolated profile: back-dated journal batches + a past desk snapshot
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        for (const n of ['plan.docx', 'Screenshot 2026-11-04.png', 'budget.xlsx']) fs.writeFileSync(path.join(desk, n), 'x');
        const day = (d, h = 10, m = 0) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.getTime(); };
        const mv = (name, to, category) => ({ from: path.join(desk, name), to: path.join(desk, to, name), category, ext: name.split('.').pop() });
        const B = (time, label, kind, moves, undone = false) => ({ id: Math.random().toString(36).slice(2, 10), time, label, kind, undone, moves });
        journal.data.batches.push(
          B(day(0, 9, 40), 'Organize', 'organize', [mv('Screenshot 2026-11-04.png', 'บันทึกหน้าจอ\\2026-11', 'captures'), mv('budget.xlsx', 'โปรเจกต์\\Budget', 'project'), mv('plan.docx', 'เอกสาร', 'documents'), mv('a.png', 'รูปภาพ', 'images'), mv('b.png', 'รูปภาพ', 'images')]),
          B(day(0, 8, 12), 'Auto', 'organize', [mv('Screenshot 2026-11-03.png', 'บันทึกหน้าจอ\\2026-11', 'captures')]),
          B(day(1, 18, 5), 'Mode: game', 'mode', [mv('VALORANT.lnk', '.jadtoh-hidden', 'mode')]),
          B(day(1, 14, 30), 'Auto', 'organize', [mv('setup.exe', 'ตัวติดตั้งโปรแกรม', 'installers'), mv('x.zip', 'ไฟล์บีบอัด', 'archives')]),
          B(day(3, 11, 0), 'Organize', 'organize', Array.from({ length: 9 }, (_, i) => mv(`IMG_${i}.jpg`, 'รูปภาพ', 'images'))),
          B(day(5, 16, 45), 'Inbox', 'organize', [mv('report.pdf', 'เอกสาร', 'documents')]),
          B(day(5, 9, 15), 'Organize', 'organize', [mv('old.pdf', 'เอกสาร', 'documents')], true),
          B(day(8, 13, 20), 'Drop pad', 'organize', [mv('slides.pptx', 'งานนำเสนอ', 'presentations'), mv('clip.mp4', 'วิดีโอ', 'videos')]),
          B(day(12, 10, 10), 'Organize', 'organize', Array.from({ length: 14 }, (_, i) => mv(`doc_${i}.pdf`, 'เอกสาร', 'documents'))),
        );
        journal.data.batches.sort((a, b) => a.time - b.time); journal.save();
        const snapDate = (() => { const x = new Date(day(3)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
        fs.mkdirSync(snaps.dir, { recursive: true });
        fs.writeFileSync(path.join(snaps.dir, snapDate + '.json'), JSON.stringify({ date: snapDate, time: day(3), folders: { [desk]: ['plan.docx', 'proposal_final.docx', 'invoice_0042.pdf', 'trip_photo.jpg', 'notes.txt'].map((name) => ({ name, dir: false, size: 1, mtime: 1 })) } }));
        snaps.take([desk], { force: true });
        win.setSize(1240, 1500); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_HISTORY_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.hs = { day: null, batches: [], snaps: [], diff: null, diffDate: null }; go('history'); await sl(2500);");
        await shot('1-all');
        await run("ACTS.tmDay({ dataset: { date: " + JSON.stringify(snapDate) + " } }); await sl(2500);");
        await shot('2-day-snapshot');
        console.log('HISTORYUI ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, batches: state.hs.batches.length, snaps: state.hs.snaps.length, diff: state.hs.diff && state.hs.diff.map(d => [d.missing.length, d.added.length])})`));
        win.hide();
      }
      if (process.env.JADTOH_SEARCH_UI === '1') {
        const desk = cfg.folders[0];
        fs.mkdirSync(path.join(desk, 'การเงิน'), { recursive: true });
        const old = (p, days) => { const t0 = new Date(Date.now() - days * 864e5); fs.utimesSync(p, t0, t0); };
        const W = (rel, content, days = 0) => { const p = path.join(desk, rel); fs.writeFileSync(p, content); if (days) old(p, days); return p; };
        W('ใบเสร็จ ร้านกาแฟ.txt', 'ใบเสร็จรับเงิน ร้านกาแฟเช้าวันใหม่\nลาเต้เย็น 65 บาท ครัวซองต์ 55 บาท รวมทั้งสิ้น 120 บาท ขอบคุณที่อุดหนุน', 1);
        W('การเงิน/receipt_2026-10.csv', 'date,shop,amount\n2026-10-03,กาแฟ,120\n2026-10-09,ร้านหนังสือ,450\n', 33);
        W('การเงิน/ใบกำกับภาษี_ตุลาคม.pdf', 'pdf-bytes', 35);
        W('summary_ระบบเงิน.md', '# สรุปการแก้ไขระบบเงิน\nแก้ใบเสร็จซ้ำในระบบเงิน ปรับยอดรวมให้ตรงกับใบกำกับภาษี', 0);
        W('meeting notes.txt', 'agenda: budget review, receipts policy, new vendor onboarding', 2);
        const pic = (seed, w = 200, h = 150) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; b[i] = (80 + seed * 37 + x * 0.5) % 256; b[i + 1] = (60 + seed * 71 + y * 0.7) % 256; b[i + 2] = (140 + seed * 23 + (x + y) * 0.2) % 256; b[i + 3] = 255; } return nativeImage.createFromBitmap(b, { width: w, height: h }); };
        fs.writeFileSync(path.join(desk, 'receipt_photo.jpg'), pic(5).toJPEG(85));
        fs.writeFileSync(path.join(desk, 'Screenshot receipt page.png'), pic(9).toPNG());
        W('invoice_template.xlsx', 'x'.repeat(3000), 12);
        win.setSize(1240, 1500); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_SEARCH_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.sr = { q: '', data: null, filter: null, busy: false, ms: 0 }; go('search'); await sl(3500);");
        await shot('1-empty');
        await run("document.querySelector('#q').value = 'ใบเสร็จ'; document.querySelector('#q').dispatchEvent(new Event('input', { bubbles: true })); await sl(3000);");
        await shot('2-results');
        await run("ACTS.sDate({ dataset: { v: 'เมื่อวาน' } }); await sl(2500);");
        await shot('3-yesterday');
        console.log('SEARCHUI ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, q: state.sr.q, total: state.sr.data && state.sr.data.total, words: state.sr.data && state.sr.data.words, thumbs: document.querySelectorAll('.thumb.r.has').length, marks: document.querySelectorAll('mark').length})`));
        win.hide();
      }
      if (process.env.JADTOH_VAULT_UI === '1') {
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        const secret = path.join(desk, 'credential.txt');
        fs.writeFileSync(secret, 'user: bob\npassword: hunter2hunter2\n');
        const legacySrc = path.join(desk, 'old_wifi_passwords.txt'); fs.writeFileSync(legacySrc, 'legacy secret'); vault.add(legacySrc, 'old passphrase 1'); fs.unlinkSync(legacySrc);
        win.setSize(1240, 1500); win.showInactive();
        const R = {};
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms)); const waitFor = async (sel, n = 60) => { for (let i = 0; i < n; i++) { const e = document.querySelector(sel); if (e) return e; await sl(100); } throw new Error("timeout " + sel); };' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_VAULT_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        try {
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.gd.scanned = 0; state.gd.findings = null; go('guard'); await sl(4000);");
          // 1) store a file: setup dialog -> recovery key
          await run("ACTS.toVault({ dataset: { path: " + JSON.stringify(secret) + " } }); await waitFor('#vp1'); document.querySelector('#vp1').value = 'correct horse battery'; document.querySelector('#vp1').dispatchEvent(new Event('input')); document.querySelector('#vp2').value = 'correct horse battery'; document.querySelector('#vh').value = 'my first dog + year'; await sl(300);");
          await shot('1-setup');
          R.recoveryKey = await run("document.querySelector('#vok').click(); await waitFor('#rkey'); await sl(300); return document.querySelector('#rkey').textContent;");
          R.escapeBlocked = await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sl(200); return !!document.querySelector('#rkey');");
          R.doneDisabledFirst = await run("return document.querySelector('#rkdone').disabled;");
          await shot('2-recovery');
          await run("document.querySelector('#rkok').click(); document.querySelector('#rkdone').click(); await sl(1800);");
          R.afterAdd = await run("return JSON.stringify({ vault: state.gd.vault.map(v => ({ name: v.name, v: v.v })), findings: state.gd.findings.length });");
          R.originalGone = !fs.existsSync(secret);
          // 2) lock, then unlock with two wrong passphrases (hint should pulse)
          await run("await ACTS.vLock();");
          await run("const v = state.gd.vault.find(x => x.v === 2); ACTS.vView({ dataset: { id: v.id } }); await waitFor('#vsec'); for (let i = 0; i < 2; i++) { document.querySelector('#vsec').value = 'not the passphrase'; document.querySelector('#vok').click(); await sl(1500); } ");
          R.hintPulse = await run("return document.querySelector('#vhint').classList.contains('pulse');");
          R.hintText = await run("return document.querySelector('#vhint').textContent;");
          await shot('3-unlock-hint');
          // 3) forgot -> recovery key
          await run("document.querySelector('#vmode').click(); await sl(200); document.querySelector('#vsec').value = " + JSON.stringify(R.recoveryKey.toLowerCase()) + "; document.querySelector('#vok').click(); await sl(2500);");
          R.status1 = await run("return JSON.stringify(await window.api.invoke('vault:status'));");
          const tmpLeft = () => fs.readdirSync(app.getPath('temp')).filter((n) => n.startsWith('jadtoh-view-')).length;
          R.viewTempExists = tmpLeft();
          await new Promise((r) => setTimeout(r, 3200));
          R.viewTempAfter = tmpLeft();
          // 4) restore to the original place
          await run("const v = state.gd.vault.find(x => x.v === 2); ACTS.vRestore({ dataset: { id: v.id } }); await waitFor('#askYes'); document.querySelector('#askYes').click(); await sl(3500);");
          R.restoredBack = fs.existsSync(secret);
          R.vaultAfterRestore = await run("return JSON.stringify(state.gd.vault.map(v => ({ name: v.name, v: v.v })));");
          R.flaggedAgain = await run("return state.gd.findings.some(f => f.name === 'credential.txt');");
          await shot('4-flagged-again');
          // 5) ignore it
          await run("ACTS.gdIgnore({ dataset: { path: " + JSON.stringify(secret) + " } }); await sl(2500);");
          R.afterIgnore = await run("return JSON.stringify({ flagged: state.gd.findings.some(f => f.name === 'credential.txt'), ignored: state.gd.ignored.length });");
          await shot('5-ignored');
          R.err = await run("return window.__errors;");
        } catch (e) { R.failure = String(e.message || e); }
        console.log('VAULTUI ' + JSON.stringify(R));
        win.hide();
      }
      if (process.env.JADTOH_MODES_UI === '1') {
        // real shortcuts of this PC, read-only: show the page as-is, then preview Game mode on the stage (nothing is applied)
        win.setSize(1240, 1500); win.showInactive();
        await win.webContents.executeJavaScript(`(async () => { cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.md.loaded = false; state.md.sel = null; go('modes'); await new Promise(r => setTimeout(r, 4500)); })()`);
        fs.writeFileSync(process.env.JADTOH_MODES_SHOT + '-1.png', (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`(async () => { ACTS.mdPick({ dataset: { mode: 'game' } }); await new Promise(r => setTimeout(r, 1500)); })()`);
        fs.writeFileSync(process.env.JADTOH_MODES_SHOT + '-2.png', (await win.webContents.capturePage()).toPNG());
        console.log('MODESUI ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, items: state.md.items.length, groups: [...new Set(state.md.items.map(i => i.group))], hidden: state.md.items.filter(i => i.hidden).length, tilesWithThumb: document.querySelectorAll('.si.has').length, diffGame: (() => { const d = mdDiff('game'); return [d.hide.length, d.show.length]; })()})`));
        win.hide();
      }
      if (process.env.JADTOH_GUARD_UI === '1') {
        // fake secrets (obviously fake values) in an isolated folder + two files already in the vault
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        const W = (n, c) => fs.writeFileSync(path.join(desk, n), c);
        W('credential.txt', 'user: bob\npassword: hunter2hunter2\n');
        W('.env', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nDB=postgres://app:s3cretpass@db.local:5432/main\n');
        W('id_rsa', '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END OPENSSH PRIVATE KEY-----\n');
        W('seed phrase backup.txt', 'not a real phrase, just a name match');
        W('notes.txt', 'shopping list: milk, eggs');
        const tmpd = fs.mkdtempSync(path.join(app.getPath('temp'), 'jt-vault-'));
        for (const n of ['bank_recovery_codes.txt', 'wifi_passwords.csv']) { const p = path.join(tmpd, n); fs.writeFileSync(p, 'x'.repeat(1500)); vault.add(p, 'correct horse battery'); }
        fs.rmSync(tmpd, { recursive: true, force: true });
        win.setSize(1240, 1500); win.showInactive();
        await win.webContents.executeJavaScript(`(async () => { cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.gd.scanned = 0; state.gd.findings = null; go('guard'); await new Promise(r => setTimeout(r, 4500)); })()`);
        fs.writeFileSync(process.env.JADTOH_GUARD_SHOT + '-1.png', (await win.webContents.capturePage()).toPNG());
        for (const n of ['credential.txt', '.env', 'id_rsa', 'seed phrase backup.txt']) fs.unlinkSync(path.join(desk, n));
        await win.webContents.executeJavaScript(`(async () => { await ACTS.guardScan(); await new Promise(r => setTimeout(r, 900)); })()`);
        fs.writeFileSync(process.env.JADTOH_GUARD_SHOT + '-2.png', (await win.webContents.capturePage()).toPNG());
        console.log('GUARDUI ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, level: gdLevel(), vault: state.gd.vault.length})`));
        win.hide();
      }
      if (process.env.JADTOH_CLEAN_UI === '1') {
        // aged captures/installers, duplicates and look-alike pictures in an isolated folder; dead shortcuts + unused apps come from the real desktop (read-only)
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        const pic = (seed, w = 320, h = 240) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const nz = ((x * 73856093) ^ (y * 19349663)) % 17 - 8; b[i] = (80 + seed * 37 + x * 0.4 + nz) % 256; b[i + 1] = (60 + seed * 71 + y * 0.6 + nz) % 256; b[i + 2] = (140 + seed * 23 + (x + y) * 0.2) % 256; b[i + 3] = 255; } return nativeImage.createFromBitmap(b, { width: w, height: h }); };
        const old = (p, days) => { const t0 = new Date(Date.now() - days * 864e5); fs.utimesSync(p, t0, t0); };
        for (let n = 1; n <= 5; n++) { const p = path.join(desk, `Screenshot 2026-09-0${n} 1${n}0000.png`); fs.writeFileSync(p, pic(n * 3).toPNG()); old(p, 40 + n * 9); }
        for (const [n, kb] of [['setup_chrome.exe', 4200], ['vc_redist.x64.exe', 1800], ['node-v22.msi', 9000]]) { const p = path.join(desk, n); fs.writeFileSync(p, Buffer.alloc(kb * 1024, 7)); old(p, 25 + kb % 9); }
        const photo = pic(40).toJPEG(90); fs.writeFileSync(path.join(desk, 'holiday_beach.jpg'), photo); fs.writeFileSync(path.join(desk, 'holiday_beach (copy).jpg'), photo); fs.writeFileSync(path.join(desk, 'holiday_beach_2.jpg'), photo);
        fs.writeFileSync(path.join(desk, 'holiday_big.png'), pic(60, 640, 480).toPNG()); fs.writeFileSync(path.join(desk, 'holiday_small.jpg'), pic(60, 320, 240).toJPEG(80));
        const big = Buffer.alloc(3 * 1024 * 1024, 3); fs.writeFileSync(path.join(desk, 'project_backup.zip'), big); fs.writeFileSync(path.join(desk, 'project_backup_old.zip'), big);
        win.setSize(1240, 1750); win.showInactive();
        await win.webContents.executeJavaScript(`(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms)); cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; state.cl = null; go('cleanup'); await sl(6000); await ACTS.clScanKey({ dataset: { key: 'dupes' } }); await ACTS.clScanKey({ dataset: { key: 'similar' } }); ACTS.clOpen({ dataset: { key: 'captures' } }); await sl(1800); })()`);
        fs.writeFileSync(process.env.JADTOH_CLEAN_SHOT + '-1.png', (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`(async () => { ACTS.clOpen({ dataset: { key: 'dupes' } }); ACTS.clOpen({ dataset: { key: 'similar' } }); await new Promise(r => setTimeout(r, 1800)); })()`);
        fs.writeFileSync(process.env.JADTOH_CLEAN_SHOT + '-2.png', (await win.webContents.capturePage()).toPNG());
        console.log('CLEANUI ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, status: state.cl.status, counts: Object.fromEntries(CL_ORDER.map(k => [k, clItems(k).length])), sel: state.cl.sel.size})`));
        win.hide();
      }
      if (process.env.JADTOH_AUTO_UI === '1') {
        // simulate a busy day on the automation page, in an isolated folder: some files auto-filed, some waiting, trust progress, a pinned file
        const desk = cfg.folders[0];
        fs.mkdirSync(path.join(desk, 'ISO_ONE'), { recursive: true });
        const pic = (seed, w = 240, h = 180) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; b[i] = (80 + seed * 37 + x * 0.5) % 256; b[i + 1] = (60 + seed * 71 + y * 0.7) % 256; b[i + 2] = (140 + seed * 23 + (x + y) * 0.2) % 256; b[i + 3] = 255; } return nativeImage.createFromBitmap(b, { width: w, height: h }); };
        cfg.autoMode = 'smart'; cfg.includeShortcuts = true; cfg.lang = 'th';
        cfg.trusted = { captures: true }; cfg.stats = { captures: { approved: 14 }, images: { approved: 7 }, documents: { approved: 4 }, project: { approved: 10 }, code: { approved: 2 } };
        const pinned = path.join(desk, 'pinned_keep_here.png'); fs.writeFileSync(pinned, pic(9).toPNG()); cfg.pinned = [pinned];
        const files = [];
        for (let n = 1; n <= 3; n++) { const p = path.join(desk, `Screenshot 2026-11-05 15${n}000.png`); fs.writeFileSync(p, pic(n).toPNG()); files.push(p); }
        for (const [i, n] of ['holiday_beach.jpg', 'cat.png'].entries()) { const p = path.join(desk, n); fs.writeFileSync(p, n.endsWith('jpg') ? pic(20 + i).toJPEG(85) : pic(20 + i).toPNG()); files.push(p); }
        for (const n of ['iso-one-pp-plan.xlsx', 'IAC_Migrate_plan.docx', 'IAC_Mas_Au_v2.xlsx', 'report_final.pdf', 'Cursor.lnk']) { const p = path.join(desk, n); fs.writeFileSync(p, 'x'.repeat(2048)); files.push(p); }
        startWatch(); // folders exist now, so the watcher can attach (real runs have them from the start)
        for (const p of files) { await handleNew(p); await new Promise((r) => setTimeout(r, 150)); }
        win.setSize(1240, 2000); win.showInactive();
        await win.webContents.executeJavaScript(`(async () => { cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; go('auto'); await new Promise(r => setTimeout(r, 2500)); })()`);
        fs.writeFileSync(process.env.JADTOH_AUTO_SHOT, (await win.webContents.capturePage()).toPNG());
        console.log('AUTOUI ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, inbox: state.inbox.length, h1: document.querySelector('#view h1')?.textContent, thumbs: document.querySelectorAll('[data-thumb].has').length})`));
        win.hide();
      }
      if (process.env.JADTOH_ORG_UI === '1') {
        // realistic messy desk in an isolated folder, then screenshot the visual organize page before and after tidying
        const desk = cfg.folders[0];
        fs.mkdirSync(path.join(desk, 'ISO_ONE'), { recursive: true });
        const pic = (seed, w = 320, h = 240) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; b[i] = (80 + seed * 37 + x * 0.4) % 256; b[i + 1] = (60 + seed * 71 + y * 0.6) % 256; b[i + 2] = (140 + seed * 23 + (x + y) * 0.2) % 256; b[i + 3] = 255; } return nativeImage.createFromBitmap(b, { width: w, height: h }); };
        for (let n = 1; n <= 6; n++) fs.writeFileSync(path.join(desk, `Screenshot 2026-10-0${n} 1${n}0${n}00.png`), pic(n).toPNG());
        for (const [i, n] of ['holiday_beach.jpg', 'LINE_ALBUM_trip_1.jpg', 'cat.png'].entries()) fs.writeFileSync(path.join(desk, n), n.endsWith('.jpg') ? pic(10 + i).toJPEG(85) : pic(10 + i).toPNG());
        for (const n of ['IAC_Migrate_plan.docx', 'IAC_Mas_Au_v2.xlsx', 'iso-one-pp-plan.xlsx', 'iso-one-members.docx', 'report_final.pdf', 'notes.txt', 'setup_tool.exe', 'backup_2026.zip', 'mockup.psd', 'Cursor.lnk', 'VALORANT.lnk', 'LINE.lnk', 'weird.zzz', 'mystery.dat2', 'ArtCraft Launcher.lnk']) fs.writeFileSync(path.join(desk, n), 'x'.repeat(2048));
        cfg.includeShortcuts = true; cfg.lang = 'th';
        win.setSize(1240, 1500);
        win.showInactive();
        await win.webContents.executeJavaScript(`(async () => { cfg.lang = 'th'; cfg.includeShortcuts = true; state.plan = null; go('organize'); await new Promise(r => setTimeout(r, 4000)); })()`);
        fs.writeFileSync(process.env.JADTOH_ORG_SHOT + '-1.png', (await win.webContents.capturePage()).toPNG());
        // tap one tile off, then tidy
        await win.webContents.executeJavaScript(`(async () => { document.querySelector('.tile.sel[data-act=tileTog]').click(); await new Promise(r => setTimeout(r, 200)); ACTS.apply(); await new Promise(r => setTimeout(r, 300)); })()`);
        fs.writeFileSync(process.env.JADTOH_ORG_SHOT + '-2.png', (await win.webContents.capturePage()).toPNG()); // mid-flight animation
        await new Promise((r) => setTimeout(r, 3500));
        fs.writeFileSync(process.env.JADTOH_ORG_SHOT + '-3.png', (await win.webContents.capturePage()).toPNG());
        console.log('ORG ' + await win.webContents.executeJavaScript(`JSON.stringify({err: window.__errors, done: state.done, left: state.plan.sources.flatMap(s=>s.items).length, thumbs: [...state.thumbs.values()].filter(Boolean).length})`));
        win.hide();
      }
      if (process.env.JADTOH_FONT_TEST === '1') {
        await win.webContents.executeJavaScript(`(async () => { cfg.lang = 'th'; go('organize'); await new Promise(r => setTimeout(r, 300)); })()`);
        win.showInactive();
        await new Promise((r) => setTimeout(r, 1500));
        const f = await win.webContents.executeJavaScript(`(async () => { await document.fonts.ready; return JSON.stringify({
          family: getComputedStyle(document.body).fontFamily.split(',')[0],
          loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.weight + '/' + f.unicodeRange.slice(0, 8)),
          failed: [...document.fonts].filter(f => f.status === 'error').length,
          check: document.fonts.check('500 14px "IBM Plex Sans Thai"', 'จัดโต๊ะ') }); })()`);
        console.log('FONT ' + f);
        fs.writeFileSync(process.env.JADTOH_FONT_SHOT, (await win.webContents.capturePage()).toPNG());
        win.hide();
      }
      if (process.env.JADTOH_DROP_TEST === '1') {
        // end-to-end through the real drop-pad page: page -> preload bridge -> IPC -> planner -> move -> journal
        const src = path.join(path.dirname(cfg.dropRoot), 'incoming');
        fs.mkdirSync(src, { recursive: true });
        const files = ['Screenshot 2026-11-05 drop.png', 'report.pdf', 'weird.zzz'].map((n) => { const p = path.join(src, n); fs.writeFileSync(p, 'x'); return p; });
        createDropPad();
        await new Promise((r) => setTimeout(r, 1200));
        const res = await dropWin.webContents.executeJavaScript(`window.api.invoke('drop:files', ${JSON.stringify(files)})`);
        const walkAll = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(path.join(d, e.name)) : [path.relative(cfg.dropRoot, path.join(d, e.name))])) : []);
        console.log('DROP ' + JSON.stringify({ result: res, filed: walkAll(cfg.dropRoot), leftInIncoming: fs.readdirSync(src), journalTop: journal.list()[0] && journal.list()[0].label }));
        dropWin.close();
      }
      if (process.env.JADTOH_LAYOUT_UI === '1') {
        // REAL desktop, read-only: analyse, render before/after, switch protection level. Nothing is applied.
        win.setSize(1240, 1500); win.showInactive();
        const run = (code) => win.webContents.executeJavaScript('(async () => { const sl = (ms) => new Promise(r => setTimeout(r, ms));' + code + '})()');
        const shot = async (n) => fs.writeFileSync(process.env.JADTOH_LAYOUT_SHOT + '-' + n + '.png', (await win.webContents.capturePage()).toPNG());
        const R = {};
        try {
          await run("cfg = await window.api.invoke('cfg:get'); cfg.lang = 'th'; lay.plan = null; lay.error = null; go('layout'); await sl(600);");
          await shot('1-analyzing');
          await run("for (let i = 0; i < 60 && (!lay.plan || lay.busy); i++) await sl(500); await sl(1500);");
          R.plan = await run("const p = lay.plan; if (!p) return JSON.stringify({ error: lay.error }); const v = layVariant(); return JSON.stringify({ icons: p.count, autoArrange: p.autoArrange, screen: p.screen, origin: p.origin, levels: Object.keys(p.plans), nowOnScreen: layNowIcons().length, nowHits: layNowIcons().filter(i => layHit(i.x, i.y, v)).length, afterHits: v.icons.filter(i => layHit(i.x, i.y, v)).length });");
          await shot('2-default');
          R.byLevel = await run("const out = {}; for (const pct of [15, 30, 50]) { const e = lay.plan.plans[pct], v = e.by[e.best]; out[pct] = { free: v.freeCells, over: v.overflow, afterHits: v.icons.filter(i => layHit(i.x, i.y, v)).length, busyCells: v.grid.mask.reduce((a, b) => a + b, 0) }; } return JSON.stringify(out);");
          await run("ACTS.layLevel({ dataset: { v: '50' } }); await sl(1600);");
          await shot('3-strong');
          await run("document.querySelector('[data-chg=laymask]').click(); await sl(600);");
          R.maskToggled = await run("return lay.mask;");
          R.err = await run("return window.__errors;");
        } catch (e) { R.failure = String(e.message || e); }
        console.log('LAYOUTUI ' + JSON.stringify(R));
        win.hide();
      }
      if (process.env.JADTOH_LAYOUT_TEST === '1') {
        // read-only on the real machine: plan only, never applies
        const r = await planIconLayout({ protectPct: 30 });
        if (r.error) console.log('LAYOUT ' + JSON.stringify(r));
        else {
          console.log('LAYOUT ' + JSON.stringify({ icons: r.count, displays: r.displays, autoArrange: r.autoArrange, snap: r.snapToGrid, screen: r.screen, cell: r.cell, wallpaper: { source: r.wallpaper.source, mode: r.wallpaper.mode }, freeCells: r.freeCells, totalCells: r.totalCells, overflow: r.overflow, busyPct: Math.round(100 * r.grid.mask.reduce((a, b) => a + b, 0) / r.grid.mask.length), firstThree: r.positions.slice(0, 3), curFirstThree: r.current.slice(0, 3) }));
          fs.writeFileSync(process.env.JADTOH_LAYOUT_SHOT || path.join(app.getPath('temp'), 'jt-layout.json'), JSON.stringify(r));
        }
      }
      if (process.env.JADTOH_UNUSED_TEST === '1') {
        // read-only on the real machine: counts only, no names
        const raw = await usage.readUserAssistRaw();
        const entries = usage.parseUserAssist(raw);
        const shortcuts = [];
        for (const dir of [desktopDir(), ...sharedDesktops()]) {
          try { for (const n of fs.readdirSync(dir)) if (n.toLowerCase().endsWith('.lnk')) shortcuts.push({ name: n, target: (shell.readShortcutLink(path.join(dir, n)) || {}).target || '' }); } catch { /* ignore */ }
        }
        const res = usage.classifyUnused(shortcuts, entries, { days: 60 });
        const tally = {}; for (const r of res) tally[r.status] = (tally[r.status] || 0) + 1;
        console.log('UNUSED ' + JSON.stringify({ rawRows: raw.length, parsed: entries.length, shortcuts: shortcuts.length, tally }));
      }
      if (process.env.JADTOH_PROC_TEST === '1') {
        const procs = await listProcesses();
        const real = decideMode(procs, new Date(), { ...AUTOSWITCH_DEFAULT, enabled: true });
        console.log('PROC ' + JSON.stringify({ count: procs.length, hasExplorer: procs.includes('explorer.exe'), decisionNow: real }));
      }
      if (process.env.JADTOH_WIDGET_TEST === '1') {
        // file a few fake files for real (isolated dir), then screenshot the widget
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        const names = ['Screenshot 2026-11-05 153012.png', 'IAC_Migrate_plan.docx', 'IAC_Mas_Au_v2.xlsx', 'setup_tool.exe', 'holiday_photo.jpg', 'บทสรุประบบเงิน.pdf'];
        for (const n of names) fs.writeFileSync(path.join(desk, n), 'x');
        const plan = await buildPlan({ sourceDir: desk, config: cfg, lang: cfg.lang });
        const first = plan.items.slice(0, 3), rest = plan.items.slice(3);
        await applyItems(first, journal, { label: 'Organize', kind: 'organize' });
        await new Promise((r) => setTimeout(r, 1200));
        await applyItems(rest, journal, { label: 'Auto', kind: 'organize' });
        await new Promise((r) => setTimeout(r, 1500));
        const rows = await widgetWin.webContents.executeJavaScript('document.querySelectorAll("#list li").length');
        fs.writeFileSync(process.env.JADTOH_WIDGET_SHOT, (await widgetWin.webContents.capturePage()).toPNG());
        console.log('WIDGET rows=' + rows + ' bounds=' + JSON.stringify(widgetWin.getBounds()) + ' top=' + widgetWin.isAlwaysOnTop());
        // undo the newest batch -> its rows must disappear from the widget
        await journal.undo(journal.list()[0].id);
        await new Promise((r) => setTimeout(r, 900));
        console.log('WIDGET after undo rows=' + await widgetWin.webContents.executeJavaScript('document.querySelectorAll("#list li").length'));
        // collapse persists
        await widgetWin.webContents.executeJavaScript('document.getElementById("fold").click()');
        await new Promise((r) => setTimeout(r, 600));
        console.log('WIDGET collapsed=' + cfg.widgetCollapsed + ' h=' + widgetWin.getBounds().height);
      }
      if (process.env.JADTOH_BAR_TEST === '1') {
        // measure the progress bar: 5s card, sampled every 50ms; hover from 1.0s to 2.0s
        await notice({ kind: 'ok', title: 'bar test', sub: 'x', duration: 5000, items: [{ name: 'a.png', to: 'b' }] });
        await new Promise((r) => setTimeout(r, 250));
        const rows = await noticeWin.webContents.executeJavaScript(`new Promise((resolve) => {
          const card = document.querySelector('.card'), bar = card.querySelector('.bar'), out = [], t0 = performance.now();
          const iv = setInterval(() => {
            const t = performance.now() - t0;
            if (t >= 1000 && !card._h) { card._h = 1; card.dispatchEvent(new PointerEvent('pointerenter')); }
            if (t >= 2000 && card._h === 1) { card._h = 2; card.dispatchEvent(new PointerEvent('pointerleave')); }
            const m = new DOMMatrix(getComputedStyle(bar).transform);
            out.push([Math.round(t), +m.a.toFixed(4)]);
            if (t > 4300 || !card.isConnected) { clearInterval(iv); resolve(out); }
          }, 50);
        })`);
        const vals = rows.map((r) => r[1]);
        let maxStep = 0, rises = 0;
        for (let i = 1; i < vals.length; i++) { const d = vals[i - 1] - vals[i]; if (d < -1e-9) rises++; maxStep = Math.max(maxStep, d); }
        const during = rows.filter((r) => r[0] >= 1100 && r[0] <= 2000).map((r) => r[1]);
        const resumeAt = (rows.find((r) => r[0] > 2000 && r[1] < during[during.length - 1] - 0.002) || [null])[0];
        console.log('BAR ' + JSON.stringify({ samples: rows.length, start: vals[0], rises, maxStepPer50ms: +maxStep.toFixed(4), expectedStep: 0.01, frozenDuringHover: Math.max(...during) - Math.min(...during) < 0.002, resumedAtMs: resumeAt, end: vals[vals.length - 1] }));
      }
      if (process.env.JADTOH_NOTICE_TEST === '1') {
        await notice({ kind: 'ok', title: tr('n_auto', { n: 3 }), sub: 'Desktop', undoId: 'x', tab: 'history', items: [{ name: 'Screenshot 2026-11-05 153012.png', to: 'บันทึกหน้าจอ\\2026-11' }, { name: 'IAC_Migrate_plan.docx', to: 'โปรเจกต์\\IAC' }, { name: 'setup_tool.exe', to: 'ตัวติดตั้งโปรแกรม' }] });
        await new Promise((r) => setTimeout(r, 700));
        await notice({ kind: 'warn', title: tr('n_inbox', { n: 2 }), sub: tr('n_inbox_sub'), tab: 'auto', items: [{ name: 'report_final_v3.pdf', to: 'เอกสาร' }, { name: 'mystery.zzz', to: 'โปรเจกต์\\Mystery' }] });
        await new Promise((r) => setTimeout(r, 1500));
        console.log('NOTICE dbg ' + await noticeWin.webContents.executeJavaScript('JSON.stringify({cards:document.getElementById("stack").children.length,h:document.body.scrollHeight,api:typeof window.api,vis:document.visibilityState})'));
        const img = await noticeWin.webContents.capturePage();
        fs.writeFileSync(process.env.JADTOH_NOTICE_SHOT, img.toPNG());
        console.log('NOTICE shot ' + JSON.stringify(noticeWin.getBounds()));
        createDropPad();
        await new Promise((r) => setTimeout(r, 1200));
        console.log('DROPPAD text=' + JSON.stringify(await dropWin.webContents.executeJavaScript('document.getElementById("t1").textContent')));
        dropWin.close();
      }
      if (process.env.JADTOH_WATCH_TEST === '1') {
        const desk = cfg.folders[0];
        fs.mkdirSync(desk, { recursive: true });
        await new Promise((r) => setTimeout(r, 1000));
        fs.writeFileSync(path.join(desk, 'Screenshot 2026-11-05 test.png'), 'png');   // high-confidence rule
        fs.writeFileSync(path.join(desk, 'weird.zzz'), 'x');                            // no rule
        fs.writeFileSync(path.join(cfg.folders[1], 'Screenshot 2026-11-05 second.png'), 'png'); // second watched folder
        const t0 = Date.now();
        while (Date.now() - t0 < 15000 && !journal.list().some((b) => b.label === 'Auto')) await new Promise((r) => setTimeout(r, 500));
        const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(desk, path.join(d, e.name))]));
        // user moves the organised file back -> must be pinned and left alone
        const moved = walk(desk).find((f) => f.endsWith('test.png'));
        if (moved) {
          await new Promise((r) => setTimeout(r, 5000)); // let the self-move suppression window pass, like a real user would
          fs.renameSync(path.join(desk, moved), path.join(desk, 'Screenshot 2026-11-05 test.png'));
          await new Promise((r) => setTimeout(r, 7000));
          console.log('PIN ' + JSON.stringify({ stillAtRoot: fs.existsSync(path.join(desk, 'Screenshot 2026-11-05 test.png')), pinned: cfg.pinned.map((p) => path.basename(p)) }));
          // release the pin -> organised again right away
          const pinned = path.join(desk, 'Screenshot 2026-11-05 test.png');
          await ipcMain.listenerCount ? null : null;
          cfg.pinned = []; await handleNew(pinned);
          console.log('UNPIN ' + JSON.stringify({ files: walk(desk) }));
        }
        await new Promise((r) => setTimeout(r, 4000));
        console.log('FOLDER2 ' + JSON.stringify({ watched: [...watchers.keys()].map((p) => path.basename(p)), desk2Files: walk(cfg.folders[1]) }));
        console.log('WATCH ' + JSON.stringify({ seconds: Math.round((Date.now() - t0) / 100) / 10, files: walk(desk), autoBatches: journal.list().filter((b) => b.label === 'Auto').length, inbox: inbox.map((i) => i.name) }));
      }
      app.exit(0);
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWin());
  app.whenReady().then(bootstrap);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); vaultLock(); for (const d of [...viewDirs]) dropViewDir(d); });
  app.on('window-all-closed', () => { /* stay in tray */ });
}
