// Core engine tests (no Electron needed). Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { buildPlan, planLoose } = require('../src/core/planner');
const { Journal, applyItems } = require('../src/core/journal');
const { scanSecrets } = require('../src/core/guard');
const { Vault } = require('../src/core/vault');
const { Hello } = require('../src/core/hello');
const { findDuplicates, scanStale } = require('../src/core/cleanup');
const { search, parseDates } = require('../src/core/search');
const { planMode, classifyShortcut } = require('../src/core/modes');
const { Snapshots } = require('../src/core/snapshots');
const { PACKS } = require('../src/core/rulepacks');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n      ' + (e.stack || e)); process.exitCode = 1; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jadtoh-'));
const desk = path.join(tmp, 'Desktop');
const data = path.join(tmp, 'data');
fs.mkdirSync(desk, { recursive: true });
const touch = (name, content = 'x', ageDays = 0) => {
  const p = path.join(desk, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (ageDays) { const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(p, t, t); }
  return p;
};

(async () => {
  // fixture modelled on a real cluttered desktop
  touch('Screenshot 2026-10-03 120000.png');
  touch('Screenshot 2026-09-20 101010.png', 'y', 40);
  touch('Recording 2026-10-01.mp4', 'rec');
  touch('IAC_Mas_Au_v2.xlsx');
  touch('IAC_Migrate_plan.docx');
  touch('iso-one-pp-plan.xlsx');
  touch('iso-one-members.docx');
  fs.mkdirSync(path.join(desk, 'ISO_ONE'));
  fs.mkdirSync(path.join(desk, 'images'));
  fs.mkdirSync(path.join(desk, '.vs'));
  touch('photo_dup.jpg', 'SAMEBYTES');
  touch('LINE_ALBUM_trip_1.jpg', 'SAMEBYTES');
  touch('setup_tool.exe', 'e', 30);
  touch('credential.txt', 'user: bob\npassword: hunter2hunter2\n');
  touch('notes.txt', 'hello world meeting about ระบบเงิน');
  touch('mystery.zzz');
  touch('LINE.lnk');
  touch('VALORANT.lnk');
  touch('Cursor.lnk');
  touch('Mystery Tool.lnk');
  touch('desktop.ini');
  touch('movie.crdownload');

  const plan = await buildPlan({ sourceDir: desk, config: {}, lang: 'th' });
  const byName = Object.fromEntries(plan.items.map((i) => [i.name, i]));

  await test('captures go to monthly folder', () => {
    assert.match(byName['Screenshot 2026-10-03 120000.png'].rel, /บันทึกหน้าจอ[\\/]\d{4}-\d{2}$/);
    assert.match(byName['Screenshot 2026-09-20 101010.png'].rel, /บันทึกหน้าจอ/);
    assert.strictEqual(byName['Recording 2026-10-01.mp4'].category, 'captures');
  });
  await test('existing "images" folder is reused (not a new รูปภาพ)', () => {
    assert.strictEqual(byName['photo_dup.jpg'].rel, 'images');
  });
  await test('project clustering: new IAC folder + existing ISO_ONE', () => {
    assert.match(byName['IAC_Mas_Au_v2.xlsx'].rel, /โปรเจกต์[\\/]IAC$/);
    assert.strictEqual(byName['IAC_Migrate_plan.docx'].rel, path.join('โปรเจกต์', 'IAC'));
    assert.strictEqual(byName['iso-one-pp-plan.xlsx'].rel, 'ISO_ONE');
    assert.strictEqual(byName['iso-one-members.docx'].rel, 'ISO_ONE');
    assert.strictEqual(byName['iso-one-pp-plan.xlsx'].confidence, 'high');
  });
  await test('skips shortcuts, ini, partial downloads; leaves unknown ext unmatched', () => {
    for (const n of ['LINE.lnk', 'desktop.ini', 'movie.crdownload']) assert.ok(!byName[n]);
    assert.ok(plan.unmatched.some((u) => u.name === 'mystery.zzz'));
  });
  await test('warns about dev folders (.vs)', () => assert.ok(plan.warnings.some((w) => w.name === '.vs')));
  await test('english folder names when lang=en', async () => {
    const p = await buildPlan({ sourceDir: desk, config: {}, lang: 'en' });
    assert.ok(p.items.find((i) => i.name === 'setup_tool.exe').rel === 'Installers');
  });
  await test('custom rule wins and supports monthly', async () => {
    const cfg = { rules: [{ id: 'r1', name: 'Notes', pattern: '^notes', exts: ['txt'], dest: 'Meetings', monthly: true, enabled: true }] };
    const p = await buildPlan({ sourceDir: desk, config: cfg, lang: 'th' });
    assert.match(p.items.find((i) => i.name === 'notes.txt').rel, /^Meetings[\\/]\d{4}-\d{2}$/);
  });
  await test('pinned / ignored extensions are left alone', async () => {
    const p = await buildPlan({ sourceDir: desk, config: { pinned: [path.join(desk, 'notes.txt')], ignoreExts: ['exe'] }, lang: 'th' });
    assert.ok(!p.items.find((i) => i.name === 'notes.txt'));
    assert.ok(!p.items.find((i) => i.name === 'setup_tool.exe'));
  });
  await test('ai assignment fills unmatched files', async () => {
    const p = await buildPlan({ sourceDir: desk, config: {}, lang: 'th', aiAssign: { 'mystery.zzz': { category: null, folder: 'ใบเสร็จ', confidence: 0.95, newName: 'ใบเสร็จ ร้านกาแฟ' } } });
    const it = p.items.find((i) => i.name === 'mystery.zzz');
    assert.strictEqual(it.rel, 'ใบเสร็จ');
    assert.strictEqual(it.confidence, 'high');
    assert.strictEqual(it.newName, 'ใบเสร็จ ร้านกาแฟ');
  });

  const journal = new Journal(path.join(data, 'journal.json'));
  const before = fs.readdirSync(desk).sort();
  let batch;
  await test('apply moves files, handles name clash, journals', async () => {
    fs.mkdirSync(path.join(desk, 'images'), { recursive: true });
    fs.writeFileSync(path.join(desk, 'images', 'photo_dup.jpg'), 'already here');
    const r = await applyItems(plan.items, journal, { label: 'test' });
    batch = r.batch;
    assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results.filter((x) => !x.ok)));
    assert.ok(fs.existsSync(path.join(desk, 'images', 'photo_dup (1).jpg')), 'clash renamed');
    assert.strictEqual(fs.readFileSync(path.join(desk, 'images', 'photo_dup.jpg'), 'utf8'), 'already here', 'existing file untouched');
    assert.ok(!fs.existsSync(path.join(desk, 'IAC_Mas_Au_v2.xlsx')));
    assert.ok(fs.existsSync(path.join(desk, 'ISO_ONE', 'iso-one-pp-plan.xlsx')));
    assert.ok(fs.existsSync(path.join(desk, 'LINE.lnk')), 'shortcuts untouched');
  });
  await test('undo restores everything and removes created folders', async () => {
    const res = await journal.undo(batch.id);
    assert.ok(res.every((x) => x.ok));
    assert.ok(fs.existsSync(path.join(desk, 'IAC_Mas_Au_v2.xlsx')));
    assert.ok(!fs.existsSync(path.join(desk, 'โปรเจกต์')), 'created project dir removed');
    assert.ok(!fs.existsSync(path.join(desk, 'บันทึกหน้าจอ')), 'created captures dir removed');
    assert.ok(fs.existsSync(path.join(desk, 'ISO_ONE')), 'pre-existing folder kept');
    await assert.rejects(() => journal.undo(batch.id));
  });

  await test('guard finds the credential file without leaking content', async () => {
    const f = await scanSecrets([desk]);
    const c = f.find((x) => x.name === 'credential.txt');
    assert.ok(c && c.severity === 'high');
    assert.ok(c.reasons.includes('content:passwordAssign'));
    assert.ok(!JSON.stringify(f).includes('hunter2'));
  });
  await test('vault encrypts, rejects wrong passphrase, round-trips', () => {
    const v = new Vault(path.join(data, 'vault'));
    const src = path.join(desk, 'credential.txt');
    const e = v.add(src, 'correct horse battery');
    const raw = fs.readFileSync(path.join(data, 'vault', e.id + '.jtv'));
    assert.ok(!raw.includes('hunter2'));
    assert.throws(() => v.extract(e.id, 'wrong passphrase!!', path.join(tmp, 'out')), /wrong passphrase/);
    const out = v.extract(e.id, 'correct horse battery', path.join(tmp, 'out'));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), fs.readFileSync(src, 'utf8'));
    assert.throws(() => v.add(src, 'short'), /too short/);
  });
  await test('vault v2: one passphrase + hint + recovery key; restore leaves no copy; view is temporary; legacy still opens', () => {
    const vdir = path.join(data, 'vault2');
    const v = new Vault(vdir);
    assert.strictEqual(v.isInitialized(), false);
    assert.throws(() => v.setup('short', ''), /too short/);
    const { dk, recoveryKey } = v.setup('correct horse battery', 'my first dog + year');
    assert.match(recoveryKey, /^([A-HJ-NP-Z2-9]{5}-){4}[A-HJ-NP-Z2-9]{5}$/);
    assert.strictEqual(v.hint(), 'my first dog + year');
    assert.ok(!JSON.stringify(v.meta).includes('correct horse') && !JSON.stringify(v.meta).includes(recoveryKey.replace(/-/g, '')), 'neither secret is stored');
    // reopen from disk
    const v2 = new Vault(vdir);
    assert.ok(v2.isInitialized() && v2.hint() === 'my first dog + year');
    assert.ok(v2.unlock('correct horse battery').equals(dk), 'passphrase opens');
    assert.ok(v2.unlock(recoveryKey.toLowerCase().replace(/-/g, ' '), 'recovery').equals(dk), 'recovery key opens (case/spacing tolerant)');
    assert.throws(() => v2.unlock('wrong passphrase!!'), /wrong passphrase/);
    assert.throws(() => v2.unlock('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', 'recovery'), /wrong passphrase/);
    // add -> encrypted at rest -> restore to original place, vault entry gone
    const orig = path.join(tmp, 'Orig'); fs.mkdirSync(orig, { recursive: true });
    const secretFile = path.join(orig, 'bank_codes.txt'); fs.writeFileSync(secretFile, 'PIN 1234 secret-marker');
    const e = v2.addFile(secretFile, dk);
    assert.strictEqual(e.v, 2);
    assert.ok(!fs.readFileSync(path.join(vdir, e.id + '.jtv')).includes('secret-marker'), 'ciphertext only');
    fs.unlinkSync(secretFile);
    const view = v2.viewTemp(e.id, dk);
    assert.strictEqual(fs.readFileSync(view.path, 'utf8'), 'PIN 1234 secret-marker');
    fs.rmSync(view.dir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(view.dir), 'temp view removed');
    const out = v2.restore(e.id, dk, path.join(tmp, 'fallback'));
    assert.strictEqual(out, secretFile, 'back where it came from');
    assert.strictEqual(v2.list().length, 0, 'taken out of the vault - no duplicate copies');
    assert.ok(!fs.existsSync(path.join(vdir, e.id + '.jtv')));
    // change passphrase: old stops working, recovery key still works
    v2.rewrap(dk, 'new passphrase 2026');
    assert.throws(() => new Vault(vdir).unlock('correct horse battery'), /wrong passphrase/);
    assert.ok(new Vault(vdir).unlock('new passphrase 2026').equals(dk));
    assert.ok(new Vault(vdir).unlock(recoveryKey, 'recovery').equals(dk));
    // restoring when the original folder is gone falls back, never overwrites
    const e2 = v2.addFile(secretFile, dk); fs.rmSync(orig, { recursive: true, force: true });
    const out2 = v2.restore(e2.id, dk, path.join(tmp, 'fallback'));
    assert.ok(out2.startsWith(path.join(tmp, 'fallback')) && fs.existsSync(out2));
    // legacy entry: per-file passphrase, migrate to master key
    const lf = path.join(tmp, 'legacy.txt'); fs.writeFileSync(lf, 'legacy data');
    const le = v2.add(lf, 'old passphrase 1');
    assert.ok(!le.v);
    const mig = v2.migrate(le.id, 'old passphrase 1', dk);
    assert.strictEqual(mig.v, 2);
    assert.strictEqual(fs.readFileSync(v2.restore(le.id, dk, path.join(tmp, 'fallback2')), 'utf8'), 'legacy data');
    const le2 = v2.add(lf, 'old passphrase 1');
    const lout = v2.legacyRestore(le2.id, 'old passphrase 1', path.join(tmp, 'fallback3'));
    assert.strictEqual(fs.readFileSync(lout, 'utf8'), 'legacy data');
    assert.strictEqual(v2.list().length, 0, 'legacyRestore also removes the entry');
  });
  await test('duplicate finder groups identical content', async () => {
    const g = await findDuplicates([desk]);
    const grp = g.find((x) => x.files.some((f) => f.path.endsWith('LINE_ALBUM_trip_1.jpg')));
    assert.ok(grp, 'photo group found');
    assert.strictEqual(grp.files.length, 2);
    assert.ok(grp.files.some((f) => f.path.endsWith('photo_dup.jpg')));
  });
  await test('stale captures & old installers', async () => {
    const s = await scanStale([desk], { captureDays: 30, installerDays: 14 });
    assert.ok(s.captures.some((c) => c.name.startsWith('Screenshot 2026-09-20')));
    assert.ok(s.installers.some((c) => c.name === 'setup_tool.exe'));
    assert.ok(!s.captures.some((c) => c.name.startsWith('Screenshot 2026-10-03')));
  });
  await test('search: name, content (Thai) and date phrases', async () => {
    const r1 = await search([desk], 'ไฟล์เรื่องระบบเงิน');
    assert.ok(r1.some((x) => x.name === 'notes.txt'), 'thai content match');
    const r2 = await search([desk], 'iso one');
    assert.ok(r2.length >= 0);
    const r3 = await search([desk], 'setup เดือนนี้');
    assert.ok(Array.isArray(r3));
    const d = parseDates('เมื่อวาน report');
    assert.ok(d.from !== null && d.rest.trim() === 'report');
  });
  await test('search detail: says WHY it matched (name / folder / content) and gives a readable snippet', async () => {
    const { searchDetailed } = require('../src/core/search');
    const sd = path.join(tmp, 'SearchDesk'); fs.mkdirSync(path.join(sd, 'receipts'), { recursive: true });
    fs.writeFileSync(path.join(sd, 'receipt_march.txt'), 'x');
    fs.writeFileSync(path.join(sd, 'notes.txt'), 'Lunch at the cafe — RECEIPT total 120 baht, thanks for coming back again soon');
    fs.writeFileSync(path.join(sd, 'receipts', 'img001.jpg'), 'x');
    const r = await searchDetailed([sd], 'receipt');
    const by = Object.fromEntries(r.results.map((x) => [x.name, x]));
    assert.deepStrictEqual(r.words, ['receipt']);
    assert.strictEqual(by['receipt_march.txt'].hit.name, true);
    assert.strictEqual(by['notes.txt'].hit.content, true);
    assert.strictEqual(by['notes.txt'].hit.name, false);
    assert.match(by['notes.txt'].snippet, /RECEIPT total 120 baht/, 'snippet keeps the original case');
    assert.strictEqual(by['img001.jpg'].hit.path, true);
    assert.strictEqual(by['img001.jpg'].hit.name, false);
    assert.ok(by['receipt_march.txt'].score > by['img001.jpg'].score, 'name match outranks folder match');
    assert.strictEqual(r.total, 3);
    const none = await searchDetailed([sd], 'zzzz-not-here');
    assert.strictEqual(none.total, 0, 'pieces of a made-up word must not match unrelated files ("not" in notes.txt)');
    // Thai compound: "ใบเสร็จ" is segmented into ใบ + เสร็จ; a file with only "ใบ" must NOT match
    const th = path.join(tmp, 'ThaiSearch'); fs.mkdirSync(th, { recursive: true });
    fs.writeFileSync(path.join(th, 'ใบเสร็จ ร้านกาแฟ.txt'), 'x');
    fs.writeFileSync(path.join(th, 'ใบกำกับภาษี.pdf'), 'x');
    fs.writeFileSync(path.join(th, 'เสร็จงานแล้ว.txt'), 'x');
    const tr = await searchDetailed([th], 'ใบเสร็จ');
    assert.deepStrictEqual(tr.results.map((x) => x.name), ['ใบเสร็จ ร้านกาแฟ.txt'], 'only the file that has the whole word');
  });
  await test('modes: classify and hide/show shortcuts, unknown stays visible', async () => {
    assert.strictEqual(classifyShortcut('VALORANT.lnk'), 'games');
    assert.strictEqual(classifyShortcut('Cursor.lnk'), 'dev');
    assert.strictEqual(classifyShortcut('LINE.lnk'), 'comms');
    assert.strictEqual(classifyShortcut('Mystery Tool.lnk'), null);
    const work = planMode(desk, 'work');
    const hid = work.items.map((i) => i.name);
    assert.ok(hid.includes('VALORANT.lnk') && !hid.includes('Cursor.lnk') && !hid.includes('Mystery Tool.lnk') && !hid.includes('LINE.lnk'));
    await applyItems(work.items, journal, { label: 'mode', kind: 'mode' });
    assert.ok(!fs.existsSync(path.join(desk, 'VALORANT.lnk')));
    const all = planMode(desk, 'all');
    assert.deepStrictEqual(all.items.map((i) => i.name), ['VALORANT.lnk']);
    await applyItems(all.items, journal, { label: 'mode', kind: 'mode' });
    assert.ok(fs.existsSync(path.join(desk, 'VALORANT.lnk')));
  });
  await test('snapshot diff + restore via journal', async () => {
    const snaps = new Snapshots(path.join(data, 'snaps'));
    snaps.take([desk], { force: true });
    const date = snaps.list()[0];
    const p2 = await buildPlan({ sourceDir: desk, config: {}, lang: 'th' });
    await applyItems(p2.items, journal, { label: 'again' });
    const d = snaps.diff(date)[0];
    assert.ok(d.missing.includes('IAC_Mas_Au_v2.xlsx'));
    const r = await snaps.restore(date, journal);
    assert.ok(r.restored.includes('IAC_Mas_Au_v2.xlsx'));
    assert.ok(fs.existsSync(path.join(desk, 'IAC_Mas_Au_v2.xlsx')));
  });
  await test('planLoose (drop pad) routes files to a separate root', async () => {
    const f = touch('x_invoice.pdf');
    const root = path.join(tmp, 'Docs');
    const r = await planLoose([f], { destRoot: root, config: { rules: PACKS[0].rules }, lang: 'en' });
    assert.strictEqual(r.items.length, 1);
    assert.ok(r.items[0].dest.startsWith(root));
  });
  await test('recent widget data: newest first, skips undone / moved-away / mode batches', () => {
    const { recentFiled } = require('../src/core/recent');
    const now = Date.now();
    const j = { data: { batches: [
      { id: 'a', time: now - 5000, kind: 'organize', label: 'Organize', undone: false, moves: [{ from: 'D:\\D\\a.png', to: 'D:\\D\\Captures\\2026-11\\a.png', category: 'captures' }, { from: 'D:\\D\\gone.pdf', to: 'D:\\D\\Docs\\gone.pdf', category: 'documents' }] },
      { id: 'b', time: now - 3000, kind: 'organize', label: 'Auto', undone: false, moves: [{ from: 'D:\\D\\b.docx', to: 'D:\\D\\Docs\\b.docx', category: 'documents' }] },
      { id: 'c', time: now - 2000, kind: 'organize', label: 'Organize', undone: true, moves: [{ from: 'x', to: 'D:\\D\\undone.txt' }] },
      { id: 'd', time: now - 1000, kind: 'mode', label: 'Mode', undone: false, moves: [{ from: 'x', to: 'D:\\D\\.hidden\\l.lnk' }] },
    ] } };
    const r = recentFiled(j, { limit: 5, exists: (p) => !p.endsWith('gone.pdf'), now });
    assert.deepStrictEqual(r.items.map((i) => i.name), ['b.docx', 'a.png']);
    assert.strictEqual(r.items[0].auto, true);
    assert.strictEqual(r.items[1].folder, 'Captures\\2026-11');
    assert.strictEqual(r.todayCount, 2);
  });
  await test('auto mode: process beats schedule, meeting beats game, launchers are weak, hysteresis', () => {
    const { decideMode, Switcher, DEFAULT_CFG } = require('../src/core/automode');
    const cfg = { ...DEFAULT_CFG, enabled: true };
    const mon10 = new Date(2026, 10, 2, 10, 0);   // Monday 10:00 -> work hours
    const sat10 = new Date(2026, 10, 7, 10, 0);   // Saturday
    assert.strictEqual(decideMode(['chrome.exe'], mon10, cfg).mode, 'work');
    assert.strictEqual(decideMode(['chrome.exe'], sat10, cfg).mode, 'all');
    assert.deepStrictEqual(decideMode(['VALORANT-Win64-Shipping.exe'], mon10, cfg), { mode: 'game', reason: 'process', detail: 'valorant-win64-shipping.exe' });
    assert.strictEqual(decideMode(['valorant.exe', 'zoom.exe'], mon10, cfg).mode, 'meeting');
    assert.strictEqual(decideMode(['steam.exe'], mon10, cfg).mode, 'work', 'steam open during work hours must not flip to game');
    assert.strictEqual(decideMode(['steam.exe'], sat10, cfg).mode, 'game', 'steam alone on a free day is a weak game hint');
    const night = new Date(2026, 10, 2, 23, 0);
    assert.strictEqual(decideMode([], night, { ...cfg, schedule: [{ mode: 'work', days: [1], from: '22:00', to: '02:00' }] }).mode, 'work', 'overnight window');
    const s = new Switcher({ needed: 3 });
    assert.strictEqual(s.feed('game', 'all'), null);
    assert.strictEqual(s.feed('game', 'all'), null);
    assert.strictEqual(s.feed('all', 'all'), null, 'flapping resets');
    assert.strictEqual(s.feed('game', 'all'), null);
    assert.strictEqual(s.feed('game', 'all'), null);
    assert.strictEqual(s.feed('game', 'all'), 'game');
  });
  await test('perceptual hash: same picture (resized/noisy) groups, different picture does not, solid colour ignored', () => {
    const { dhash, hamming, groupSimilar } = require('../src/core/phash');
    const img = (f) => { const b = Buffer.alloc(9 * 8 * 4); for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) { const v = Math.max(0, Math.min(255, Math.round(f(x, y)))); b.set([v, v, v, 255], (y * 9 + x) * 4); } return b; };
    const base = (x, y) => 40 + x * 22 + (y % 3) * 15;           // left-to-right gradient with texture
    const a = dhash(img(base)), b = dhash(img((x, y) => base(x, y) + ((x * 7 + y * 13) % 5) - 2)); // slight noise (re-encode)
    const c = dhash(img((x, y) => 250 - x * 25 + ((x * y) % 4) * 30)), flat = dhash(img(() => 128));
    assert.ok(hamming(a.hash, b.hash) <= 4, 'noisy copy is close: ' + hamming(a.hash, b.hash));
    assert.ok(hamming(a.hash, c.hash) > 20, 'different picture is far: ' + hamming(a.hash, c.hash));
    assert.strictEqual(flat.flat, true);
    const mk = (p, h, w, size, mtime) => ({ path: p, hash: h.hash, w, h: w, size, mtime });
    const g = groupSimilar([mk('small.jpg', a, 100, 5, 1), mk('big.jpg', b, 400, 50, 2), mk('other.jpg', c, 400, 50, 3)]);
    assert.strictEqual(g.length, 1);
    assert.strictEqual(g[0].keep, 'big.jpg', 'keeps the highest-resolution copy');
    assert.deepStrictEqual(g[0].files.map((f) => f.path), ['big.jpg', 'small.jpg']);
  });
  await test('unused apps: UserAssist parsing (ROT13 + FILETIME) and classification', () => {
    const { rot13, parseUserAssist, classifyUnused } = require('../src/core/usage');
    assert.strictEqual(rot13('P:\\Cebtenz Svyrf\\Pyhq.rkr'), 'C:\\Program Files\\Clud.exe');
    const now = Date.UTC(2026, 10, 5);
    const row = (name, runs, ms) => { const b = Buffer.alloc(72); b.writeUInt32LE(runs, 4); b.writeBigUInt64LE(BigInt(ms) * 10000n + 116444736000000000n, 60); return { n: rot13(name), d: b.toString('hex').toUpperCase() }; };
    const entries = parseUserAssist([
      row('C:\\Games\\Old\\oldgame.exe', 9, now - 200 * 864e5),
      row('C:\\Apps\\fresh.exe', 40, now - 2 * 864e5),
      { n: 'bad', d: 'zz' },
    ]);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].runs, 9);
    assert.strictEqual(Math.round((now - entries[0].last) / 864e5), 200);
    const res = classifyUnused([
      { name: 'Old Game.lnk', target: 'C:\\Games\\Old\\OldGame.exe' },
      { name: 'Fresh.lnk', target: 'C:\\Apps\\Fresh.exe' },
      { name: 'Stranger.lnk', target: 'C:\\Apps\\stranger.exe' },
      { name: 'Store.lnk', target: '' },
    ], entries, { days: 60, now });
    const by = Object.fromEntries(res.map((r) => [r.name, r.status]));
    assert.deepStrictEqual(by, { 'Old Game.lnk': 'old', 'Fresh.lnk': 'recent', 'Stranger.lnk': 'never', 'Store.lnk': 'unknown' });
    assert.strictEqual(res[0].name, 'Old Game.lnk', 'old first');
  });
  await test('wallpaper-aware layout: salient subject is protected, icons fill free cells column by column', () => {
    const { fitToScreen, saliency, busyMask, planLayout } = require('../src/core/wallpaper');
    // dark wallpaper 640x360 with a bright "subject" block on the right-centre (x 55%-85%, y 25%-80%)
    const W = 640, H = 360, data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inside = x > W * 0.55 && x < W * 0.85 && y > H * 0.25 && y < H * 0.8;
      const v = inside ? 225 : 28 + ((x * 31 + y * 17) % 7);
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
    const fit = fitToScreen({ data, w: W, h: H }, { w: 1920, h: 1080 }, 'fill', 192);
    assert.strictEqual(fit.w, 192); assert.strictEqual(fit.h, 108);
    const busy = busyMask(saliency(fit, { cols: 48, rows: 27 }), { protectPct: 30, grow: 1 });
    const at = (fx, fy) => busy.mask[Math.floor(fy * busy.rows) * busy.cols + Math.floor(fx * busy.cols)];
    assert.strictEqual(at(0.70, 0.50), 1, 'subject centre is busy');
    assert.strictEqual(at(0.05, 0.50), 0, 'left edge is free');
    const items = Array.from({ length: 40 }, (_, i) => 'Icon ' + i);
    const plan = planLayout({ items, screenW: 1920, screenH: 1080, cellW: 95, cellH: 98, margin: 8, workH: 1020, busy });
    assert.strictEqual(plan.positions.length, 40);
    assert.strictEqual(plan.overflow, 0, '40 icons fit in the free area');
    const inSubject = (p) => p.x + 95 > 1920 * 0.55 && p.x < 1920 * 0.85 && p.y + 98 > 1080 * 0.25 && p.y < 1080 * 0.8;
    assert.ok(plan.positions.every((p) => !inSubject(p)), 'no icon sits on the subject');
    assert.strictEqual(plan.positions[0].x, 8); assert.strictEqual(plan.positions[0].y, 8);
    assert.strictEqual(plan.positions[1].x, 8); assert.strictEqual(plan.positions[1].y, 8 + 98, 'fills the first column top-to-bottom');
    assert.strictEqual(new Set(plan.positions.map((p) => p.x + ',' + p.y)).size, 40, 'no two icons share a cell');
    // too many icons: overflow lands on the least busy remaining cells, and is reported
    const many = planLayout({ items: Array.from({ length: plan.freeCells + 5 }, (_, i) => 'I' + i), screenW: 1920, screenH: 1080, cellW: 95, cellH: 98, margin: 8, workH: 1020, busy });
    assert.strictEqual(many.overflow, 5);
  });
  await test('include-shortcuts option: off = untouched, on = known groups filed, unknown stays, existing folder reused', async () => {
    const d2 = path.join(tmp, 'ShortcutDesk');
    fs.mkdirSync(path.join(d2, 'game'), { recursive: true });
    for (const n of ['Cursor.lnk', 'VALORANT.lnk', 'LINE.lnk', 'Mystery Tool.lnk', 'Escape Simulator 2.url']) fs.writeFileSync(path.join(d2, n), 'x');
    const off = await buildPlan({ sourceDir: d2, config: {}, lang: 'th' });
    assert.strictEqual(off.items.length, 0, 'shortcuts untouched by default');
    const on = await buildPlan({ sourceDir: d2, config: { includeShortcuts: true }, lang: 'th' });
    const by = Object.fromEntries(on.items.map((i) => [i.name, i.rel]));
    assert.strictEqual(by['VALORANT.lnk'], 'game', 'reuses the existing "game" folder');
    assert.strictEqual(by['Escape Simulator 2.url'], 'game');
    assert.strictEqual(by['Cursor.lnk'], 'เครื่องมือ Dev');
    assert.strictEqual(by['LINE.lnk'], 'แชทและประชุม');
    assert.ok(!by['Mystery Tool.lnk'] && on.unmatched.some((u) => u.name === 'Mystery Tool.lnk'), 'unknown shortcut stays');
    assert.ok(on.items.every((i) => i.confidence === 'medium'), 'never auto-filed in full mode');
    const j2 = new Journal(path.join(data, 'j2.json'));
    const r = await applyItems(on.items, j2, { label: 'sc' });
    assert.ok(r.results.every((x) => x.ok));
    assert.ok(fs.existsSync(path.join(d2, 'เครื่องมือ Dev', 'Cursor.lnk')));
    await j2.undo(r.batch.id);
    assert.ok(fs.existsSync(path.join(d2, 'Cursor.lnk')) && !fs.existsSync(path.join(d2, 'เครื่องมือ Dev')), 'undo puts them back and removes the created folder');
  });
  await test('rule packs are valid regexes', () => {
    for (const p of PACKS) for (const r of p.rules) { if (r.pattern) new RegExp(r.pattern, 'iu'); assert.ok(r.dest && r.id); }
  });

  await test('themes: festival dates pick the right theme, auto off keeps the user pick, unknown ids fall back', () => {
    const T = require('../src/core/themes');
    const on = (y, m, d) => T.themeForDate(new Date(y, m - 1, d));
    assert.equal(on(2026, 11, 24), 'loy', 'Loy Krathong 2026 = 24 Nov');
    assert.equal(on(2025, 11, 5), 'loy', 'Loy Krathong 2025 = 5 Nov');
    assert.equal(on(2026, 12, 25), 'xmas');
    assert.equal(on(2026, 12, 31), 'newyear');
    assert.equal(on(2027, 1, 2), 'newyear');
    assert.equal(on(2027, 4, 13), 'songkran');
    assert.equal(on(2026, 10, 31), 'halloween');
    assert.equal(on(2027, 2, 14), 'valentine');
    assert.equal(on(2026, 7, 7), 'default');
    assert.equal(T.effectiveTheme({ theme: 'xmas', themeAuto: false }, new Date(2026, 10, 24)), 'xmas', 'auto off: the pick wins');
    assert.equal(T.effectiveTheme({ theme: 'xmas', themeAuto: true }, new Date(2026, 10, 24)), 'loy', 'auto on: the season wins');
    assert.equal(T.effectiveTheme({ theme: 'xmas', themeAuto: true }, new Date(2026, 6, 7)), 'xmas', 'auto on, no season: the pick');
    assert.equal(T.effectiveTheme({ theme: 'nope' }), 'default');
  });

  await test('weather: WMO codes map to the right look; place search and reading work with a stubbed network', async () => {
    const W = require('../src/core/weather');
    assert.equal(W.kindOf(0, true), 'sun'); assert.equal(W.kindOf(0, false), 'night'); assert.equal(W.kindOf(1, true), 'sun');
    assert.equal(W.kindOf(3, true), 'cloud'); assert.equal(W.kindOf(45, true), 'fog'); assert.equal(W.kindOf(53, false), 'rain');
    assert.equal(W.kindOf(63, true), 'rain'); assert.equal(W.kindOf(81, true), 'rain'); assert.equal(W.kindOf(73, true), 'snow'); assert.equal(W.kindOf(96, true), 'storm');
    const calls = [];
    const stub = async (url) => { calls.push(String(url)); return { ok: true, json: async () => (String(url).includes('geocoding') ? { results: [{ name: 'Bangkok', admin1: 'BKK', country: 'TH', latitude: 13.7563, longitude: 100.5018 }] } : { current: { temperature_2m: 30.6, weather_code: 61, is_day: 1 } }) }; };
    const pl = await W.searchPlaces('Bangkok', 'en', stub);
    assert.deepEqual(pl, [{ name: 'Bangkok', area: 'BKK, TH', lat: 13.76, lon: 100.5 }]);
    const cur = await W.current(pl[0], stub);
    assert.equal(cur.kind, 'rain'); assert.equal(cur.temp, 31);
    assert.ok(calls[1].includes('latitude=13.76') && !/name|email|user/i.test(calls[1].split('?')[1].replace(/current=[^&]*/, '')), 'only coordinates are sent');
    assert.deepEqual(await W.searchPlaces('a', 'th', stub), [], 'too-short queries never hit the network');
  });

  await test('llm: three wire formats, key handling, address rules, migration', async () => {
    const L = require('../src/core/llm');
    const seen = [];
    const mk = (body) => async (url, init) => { seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => body }; };
    // Anthropic
    let t = await L.complete({ conn: { provider: 'anthropic', model: 'm1' }, key: 'KEY-A', system: 'S', user: 'U', fetchImpl: mk({ content: [{ type: 'text', text: 'hi' }] }) });
    assert.equal(t, 'hi'); assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(seen[0].headers['x-api-key'], 'KEY-A'); assert.equal(seen[0].body.system, 'S'); assert.equal(seen[0].body.model, 'm1');
    // OpenAI-style (OpenAI, OpenRouter, ...)
    t = await L.complete({ conn: { provider: 'openrouter', model: 'x/y' }, key: 'KEY-O', system: 'S', user: 'U', fetchImpl: mk({ choices: [{ message: { content: 'yo' } }] }) });
    assert.equal(t, 'yo'); assert.equal(seen[1].url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(seen[1].headers.authorization, 'Bearer KEY-O');
    assert.deepEqual(seen[1].body.messages.map((m) => m.role), ['system', 'user']);
    // Gemini: key in a header, never in the URL
    t = await L.complete({ conn: { provider: 'gemini', model: 'gem' }, key: 'KEY-G', system: 'S', user: 'U', fetchImpl: mk({ candidates: [{ content: { parts: [{ text: 'g1' }, { text: 'g2' }] } }] }) });
    assert.equal(t, 'g1g2'); assert.ok(seen[2].url.endsWith('/v1beta/models/gem:generateContent') && !seen[2].url.includes('KEY-G')); assert.equal(seen[2].headers['x-goog-api-key'], 'KEY-G');
    // local server: no key, no auth header
    t = await L.complete({ conn: { provider: 'ollama', model: 'llama3.2' }, key: '', system: 'S', user: 'U', fetchImpl: mk({ choices: [{ message: { content: 'local' } }] }) });
    assert.equal(t, 'local'); assert.equal(seen[3].url, 'http://localhost:11434/v1/chat/completions'); assert.ok(!('authorization' in seen[3].headers));
    assert.deepEqual([L.describe({ provider: 'ollama' }).local, L.describe({ provider: 'openai' }).local, L.describe({ provider: 'ollama' }).needsKey, L.describe({ provider: 'openai' }).needsKey], [true, false, false, true]);
    // newer OpenAI models: retry with max_completion_tokens
    let n = 0;
    const picky = async (url, init) => { n++; const b = JSON.parse(init.body); if ('max_tokens' in b) return { ok: false, status: 400, json: async () => ({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }) }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok2' } }] }) }; };
    assert.equal(await L.complete({ conn: { provider: 'openai', model: 'new' }, key: 'k', system: 's', user: 'u', fetchImpl: picky }), 'ok2'); assert.equal(n, 2);
    // errors never echo the key
    const bad = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided: SECRET-123' } }) });
    await assert.rejects(() => L.complete({ conn: { provider: 'openai', model: 'm' }, key: 'SECRET-123', system: 's', user: 'u', fetchImpl: bad }), (e) => /401/.test(e.message) && !e.message.includes('SECRET-123'));
    // addresses: https anywhere, http only for this PC / home network, no credentials in the URL
    assert.equal(L.validateBase('https://api.example.com/v1/'), 'https://api.example.com/v1');
    assert.equal(L.validateBase('http://192.168.1.20:8080/v1'), 'http://192.168.1.20:8080/v1');
    assert.throws(() => L.validateBase('http://example.com/v1')); assert.throws(() => L.validateBase('ftp://x')); assert.throws(() => L.validateBase('https://u:p@example.com')); assert.throws(() => L.validateBase('not a url'));
    // the old single key becomes a connection, still encrypted as before
    const old = { aiKeyEnc: 'enc:AAAA' };
    assert.equal(L.migrate(old), true); assert.equal(old.aiConns.length, 1); assert.equal(old.aiConns[0].provider, 'anthropic'); assert.equal(old.aiConns[0].keyEnc, 'enc:AAAA'); assert.equal(old.aiActive, 'c-legacy'); assert.ok(!('aiKeyEnc' in old));
    assert.equal(L.migrate(old), false, 'second run changes nothing');
    const empty = {}; L.migrate(empty); assert.deepEqual(empty.aiConns, []);
  });

  await test('pathguard: only paths inside managed folders; no traversal; links cannot escape; programs are not launched', () => {
    const G = require('../src/core/pathguard');
    const root = path.join(tmp, 'pg-root'), out = path.join(tmp, 'pg-outside');
    fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.txt'), 'x'); fs.writeFileSync(path.join(out, 'secret.txt'), 'x');
    assert.ok(G.insideAny([root], path.join(root, 'a.txt')));
    assert.ok(G.insideAny([root], path.join(root, 'sub', 'new.txt')), 'a not-yet-existing path inside is fine');
    assert.ok(!G.insideAny([root], root), 'the folder itself is not a file inside it');
    assert.ok(!G.insideAny([root], path.join(out, 'secret.txt')));
    assert.ok(!G.insideAny([root], path.join(root, '..', 'pg-outside', 'secret.txt')), 'dot-dot traversal');
    assert.ok(!G.insideAny([root], root + '-evil' + path.sep + 'a.txt'), 'prefix lookalike folder');
    assert.ok(!G.insideAny([root], 'a.txt') && !G.insideAny([root], '') && !G.insideAny([root], null) && !G.insideAny([root], path.join(root, 'a\0.txt')));
    try { fs.symlinkSync(out, path.join(root, 'link'), 'junction'); assert.ok(!G.insideAny([root], path.join(root, 'link', 'secret.txt')), 'junction pointing outside is rejected'); } catch (e) { if (e.code !== 'EPERM') throw e; }
    for (const n of ['x.exe', 'x.BAT', 'x.ps1', 'x.lnk', 'x.js', 'x.hta', 'x.msi']) assert.ok(G.isRunnable(n), n);
    for (const n of ['x.pdf', 'x.txt', 'x.png', 'x.docx']) assert.ok(!G.isRunnable(n), n);
  });

  await test('vault: a shortened GCM tag is rejected (wrapped key and file)', () => {
    const vdir = path.join(data, 'vault-tag');
    const v = new Vault(vdir);
    const { dk } = v.setup('correct horse battery', '');
    assert.ok(new Vault(vdir).unlock('correct horse battery').equals(dk), 'control: right passphrase works');
    const mf = path.join(vdir, 'index.json');
    const idx = JSON.parse(fs.readFileSync(mf, 'utf8'));
    idx.meta.wrapPass.tag = Buffer.from(idx.meta.wrapPass.tag, 'base64').subarray(0, 4).toString('base64'); // truncate the tag to 4 bytes
    fs.writeFileSync(mf, JSON.stringify(idx));
    assert.throws(() => new Vault(vdir).unlock('correct horse battery'), /wrong passphrase/, 'a 4-byte tag must not be accepted even with the right passphrase');
    const enc = require('../src/core/vault').encryptBuffer(Buffer.from('hello'), 'a.txt', 'pw-for-file-test');
    const cut = Buffer.concat([enc.subarray(0, 32), enc.subarray(32, 36), enc.subarray(48)]); // file tag cut to 4 bytes
    assert.throws(() => require('../src/core/vault').decryptBuffer(cut, 'pw-for-file-test'));
  });

  await test('inbox: lists only unsorted files, filters are sanitised', async () => {
    const { listFiles, cleanFilter } = require('../src/core/inbox');
    const day = 864e5, now = Date.now();
    const src = [{
      sourceDir: path.join(tmp, 'Desk'),
      items: [{ name: 'a.png', src: 'a.png', ext: 'png', size: 10, mtime: now, dest: 'x' }],
      unmatched: [
        { name: 'old.zzz', src: 'old.zzz', ext: 'zzz', size: 500, mtime: now - 40 * day },
        { name: 'new Receipt.zzz', src: 'new Receipt.zzz', ext: 'zzz', size: 5, mtime: now - day },
        { name: 'big.dat', src: 'big.dat', ext: 'dat', size: 9000, mtime: now - 5 * day },
      ],
    }];
    assert.strictEqual(listFiles(src, {}).total, 3, 'default scope is unsorted only');
    assert.strictEqual(listFiles(src, { scope: 'all' }).total, 4);
    assert.deepStrictEqual(listFiles(src, { minAgeDays: 30 }).items.map((i) => i.name), ['old.zzz']);
    assert.deepStrictEqual(listFiles(src, { exts: ['.ZZZ'], nameLike: 'RECEIPT' }).items.map((i) => i.name), ['new Receipt.zzz']);
    assert.strictEqual(listFiles(src, { sort: 'largest' }).items[0].name, 'big.dat');
    assert.strictEqual(listFiles(src, {}, { limit: 1 }).items.length, 1);
    const c = cleanFilter({ scope: 'evil', exts: ['../x', 'pdf', 5], minAgeDays: 'abc', nameLike: 'x'.repeat(500), sort: 'drop table' });
    assert.deepStrictEqual([c.scope, c.exts, c.minAgeDays, c.nameLike.length, c.sort], ['unsorted', ['pdf', '5'], 0, 60, 'newest']);
  });

  await test('folder review: scan, untrusted AI output is validated, apply is one undoable batch', async () => {
    const rv = require('../src/core/review');
    const root = path.join(tmp, 'RV');
    const mk = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
    mk('stuff/a.pdf', '1'); mk('stuff/b.pdf', '2'); mk('Invoices/c.pdf', '3'); mk('misc2/d.png', '4'); mk('app/package.json', '{}'); mk('.hidden/x.txt', 'x'); mk('stuff/.env', 'SECRET=1');
    const folders = await rv.scanDesk([root], { samples: true });
    const by = Object.fromEntries(folders.map((f) => [f.name, f]));
    assert.ok(!by['.hidden'], 'hidden folders are not listed');
    assert.strictEqual(by.app.locked, true, 'project folders are locked');
    assert.ok(!by.stuff.sample.includes('.env'), 'secret-looking file names are not sampled');
    const idx = (n) => folders.indexOf(by[n]);
    const out = { score: 140, summary: 's', suggestions: [
      { type: 'rename', i: idx('stuff'), to: 'เอกสาร PDF/..\\evil', reason: 'r' },
      { type: 'rename', i: idx('app'), to: 'Hacked' },              // locked
      { type: 'rename', i: idx('misc2'), to: 'Invoices' },          // clashes with an existing folder
      { type: 'rename', i: 99, to: 'Nope' },                         // unknown folder
      { type: 'nest', i: idx('misc2'), into: idx('Invoices'), reason: 'fits' },
      { type: 'delete', i: idx('Invoices') },                        // unknown type
    ] };
    const v = rv.validateReview(out, folders);
    assert.strictEqual(v.score, 100);
    assert.deepStrictEqual(v.suggestions.map((s) => s.type), ['rename', 'nest']);
    assert.ok(!/[\\/]/.test(v.suggestions[0].to), 'path separators are stripped from a proposed name');
    assert.strictEqual(path.dirname(v.suggestions[0].toPath), root, 'rename stays in the same parent');
    const journal = new Journal(path.join(tmp, 'rv-journal.json'));
    const r = await rv.applyReview(v.suggestions, journal);
    assert.ok(r.results.every((x) => x.ok) && r.batch, 'both applied in one batch');
    assert.ok(!fs.existsSync(path.join(root, 'stuff')) && fs.existsSync(v.suggestions[0].toPath));
    assert.ok(fs.existsSync(path.join(root, 'Invoices', 'misc2', 'd.png')));
    await journal.undo(r.batch.id);
    assert.ok(fs.existsSync(path.join(root, 'stuff', 'a.pdf')) && fs.existsSync(path.join(root, 'misc2', 'd.png')), 'undo restores both');
  });

  await test('command bar: local keywords map to the right action (Thai "เปิด" is not read as "ปิด")', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const fn = src.match(/function localCommand\(text\) \{[\s\S]*?\n\}\n/)[0];
    const lc = new Function(fn + '; return localCommand;')();
    const is = (s, want) => assert.deepStrictEqual(Object.fromEntries(Object.entries(lc(s)).filter(([k]) => k in want)), want, s);
    is('เรียงหน้าจอให้หน่อยมันเป็นรูอยู่', { action: 'layout' });
    is('เรียงไอคอนตามชื่อ', { action: 'layout', sort: 'name' });
    is('เปิดวิดเจ็ต', { action: 'setting', key: 'widget', value: true });
    is('ปิดวิดเจ็ต', { action: 'setting', key: 'widget', value: false });
    is('turn off notifications', { action: 'setting', key: 'notify', value: false });
    is('ลบไฟล์ซ้ำ', { action: 'clean', kind: 'dupes' });
    is('ล้างของเก่า', { action: 'clean', kind: 'stale' });
    is('จัดโต๊ะ', { action: 'organize' });
    is('ดูประวัติ', { action: 'goto', tab: 'history' });
    is('ค้นหา ใบเสร็จ', { action: 'search', query: 'ใบเสร็จ' });
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  await test('windows hello: DK also opens with the Hello-derived key; passphrase and recovery key keep working; disable removes it', async () => {
    // fake Windows: a deterministic "TPM signature" per challenge, as RSA PKCS#1 v1.5 would give
    const fake = async (script, env = {}) => {
      if (env.JT_MODE === 'delete') return 'OK:1';
      if (!env.JT_MODE) return 'OK:1';
      return 'SIG:' + require('crypto').createHmac('sha256', 'tpm-private-key').update(env.JT_CHALLENGE).digest('base64');
    };
    const h = new Hello(fake);
    assert.strictEqual(await h.available(), true);
    assert.strictEqual(await new Hello(async () => { throw new Error('x'); }).available(), false, 'no Hello -> unavailable, no throw');
    const vdir = path.join(data, 'vault-hello');
    const v = new Vault(vdir);
    const { dk, recoveryKey } = v.setup('correct horse battery');
    assert.strictEqual(v.hasHello(), false);
    const ch = h.newChallenge();
    v.enableHello(dk, ch, await h.enroll(ch));
    const v2 = new Vault(vdir);
    assert.ok(v2.hasHello(), 'persisted');
    assert.ok(v2.unlockHello(await h.secret(v2.helloChallenge())).equals(dk), 'Hello secret opens the vault');
    assert.throws(() => v2.unlockHello('0'.repeat(64)), /wrong passphrase/, 'any other secret is rejected');
    assert.ok(!fs.readFileSync(path.join(vdir, 'index.json'), 'utf8').includes(dk.toString('base64')), 'DK itself is never stored');
    v2.rewrap(dk, 'brand new passphrase 1');
    assert.ok(new Vault(vdir).unlockHello(await h.secret(ch)).equals(dk), 'changing the passphrase keeps Hello working');
    assert.ok(new Vault(vdir).unlock(recoveryKey, 'recovery').equals(dk), 'recovery key still works');
    new Vault(vdir).disableHello();
    assert.strictEqual(new Vault(vdir).hasHello(), false);
    assert.throws(() => new Vault(vdir).unlockHello('x'), /not enabled/);
    assert.ok(new Vault(vdir).unlock('brand new passphrase 1').equals(dk), 'passphrase still works after disabling');
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
