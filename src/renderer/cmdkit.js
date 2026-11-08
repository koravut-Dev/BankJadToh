/* Command bar actions. Every one follows the same promise:
   1) work out what WOULD happen (nothing is changed yet), 2) show it as a picture/list, 3) wait for an explicit click, 4) do it, 5) offer undo when possible.
   AI (or the local keyword fallback) only chooses WHICH action and its small options; the values are whitelisted here. */
const ck = (th, en) => (cfg && cfg.lang === 'en' ? en : th);
const ckBase = (p) => String(p).split(/[\\/]/).pop();
const ckTabs = ['organize', 'auto', 'guard', 'cleanup', 'modes', 'layout', 'search', 'history', 'rules', 'settings'];

function pcBusy(text) { $('#palRes').innerHTML = `<div class="pal-busy"><span class="dots"><i></i><i></i><i></i></span> ${esc(text)}</div>`; }
function pcNote(a, icon, text, extra = '') { $('#palRes').innerHTML = viaBadge(a) + `<div class="pc"><div class="pc-head"><span class="pc-ico">${icon}</span><div><b>${esc(text)}</b></div></div>${extra}</div>`; }

/** The shared card: what will happen -> confirm -> result (+ undo). run() returns { text, undo? } or { error }. */
function pcCard({ via, icon, title, sub = '', preview = '', confirm, run, danger = false, link = null }) {
  $('#palRes').innerHTML = viaBadge({ via }) + `<div class="pc"><div class="pc-head"><span class="pc-ico">${icon}</span><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>
    ${preview ? `<div class="pc-prev">${preview}</div>` : ''}
    <div class="pc-foot"><button class="primary pc-go ${danger ? 'warn' : ''}" id="pcGo">⚡ ${esc(confirm)}</button><button class="pc-no" id="pcNo">${ck('ยกเลิก', 'Cancel')}</button>${link ? `<button class="sm pc-link" id="pcLink">${esc(link.label)} ›</button>` : ''}</div><div id="pcRes"></div></div>`;
  if (typeof loadThumbs === 'function') loadThumbs();
  $('#pcNo').onclick = () => closeModal();
  if (link) $('#pcLink').onclick = () => { closeModal(); link.go(); };
  $('#pcGo').onclick = async () => {
    const go = $('#pcGo'); go.disabled = true; $('#pcNo').disabled = true;
    go.innerHTML = `<span class="dots"><i></i><i></i><i></i></span> ${ck('กำลังทำ…', 'Working…')}`;
    let r;
    try { r = await run(); } catch (e) { r = { error: String(e.message || e) }; }
    go.remove(); $('#pcNo')?.remove(); $('#pcLink')?.remove();
    const out = $('#pcRes');
    if (!r || r.error) { out.innerHTML = `<div class="rv-fin"><b>⚠️ ${esc((r && r.error) || ck('ทำไม่สำเร็จ', 'Did not work'))}</b></div>`; return; }
    out.innerHTML = `<div class="rv-fin ok"><span class="rv-party">🎉</span><b>${esc(r.text)}</b>${r.undo ? `<button class="sm" id="pcUndo">↩ ${ck('ย้อนกลับ', 'Undo')}</button>` : ''}</div>`;
    out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (r.undo) $('#pcUndo').onclick = async () => {
      $('#pcUndo').disabled = true;
      const u = await r.undo();
      out.innerHTML = `<div class="rv-fin"><b>${u === false ? '⚠️ ' + ck('ย้อนกลับไม่สำเร็จ', 'Undo failed') : ck('ย้อนกลับแล้ว ✓', 'Undone ✓')}</b></div>`;
    };
  };
}

/** File rows with thumbnails (reuses the palette list look). */
const pcRows = (rows, total, shown = 6) => `<div class="pal-files">${rows.slice(0, shown).map((f) => `<div class="pal-file"><div class="thumb" data-thumb="${esc(f.path)}"><span>${extIcon((f.name || '').split('.').pop())}</span></div><div class="pf-main"><b title="${esc(f.path)}">${esc(f.name)}</b><small>${esc(f.note || '')}${f.size != null ? (f.note ? ' · ' : '') + fmtSize(f.size) : ''}</small></div></div>`).join('')}</div>${total > shown ? `<div class="muted" style="font-size:12px;margin-top:4px">${ck('และอีก', 'and')} ${total - shown} ${ck('รายการ', 'more')}</div>` : ''}`;

const CK = {
  /* arrange desktop icons: shows before/after on the real wallpaper */
  async layout(a) {
    pcBusy(ck('กำลังดูวอลเปเปอร์และไอคอนบนหน้าจอ…', 'Looking at your wallpaper and icons…'));
    const sort = ['current', 'name', 'size', 'type', 'date'].includes(a.sort) ? a.sort : 'current';
    const dir = a.dir === 'desc' ? 'desc' : 'asc';
    let mode = a.mode === 'plain' ? 'plain' : 'wallpaper';
    let r = await call('layout:plan', { protectPct: 30, sort, dir, mode });
    if (r && r.error === 'nowallpaper' && mode !== 'plain') { mode = 'plain'; r = await call('layout:plan', { protectPct: 30, sort, dir, mode }); } // no readable wallpaper: the normal layout still works
    const goLay = { label: ck('เปิดหน้าจัดไอคอน', 'Open Icon layout'), go: () => go('layout') };
    if (!r) { $('#palRes').innerHTML = ''; return; }
    if (r.error || r.autoArrange) {
      const msg = r.autoArrange ? layoutMessage('autoarrange') : layoutMessage(r.error);
      return pcCard({ via: a.via, icon: '🖥️', title: ck('ยังจัดไอคอนให้ไม่ได้ตอนนี้', 'Cannot arrange the icons yet'), sub: msg, confirm: ck('เปิดหน้าจัดไอคอนดูวิธีแก้', 'Open Icon layout for the fix'), run: async () => { go('layout'); closeModal(); return { text: ck('เปิดให้แล้ว', 'Opened') }; }, link: null });
    }
    const img = r.wallpaper.thumb ? new Image() : null;
    if (img) await new Promise((res) => { img.onload = res; img.onerror = res; img.src = r.wallpaper.thumb; });
    const W = 300, H = Math.round(W * r.screen.h / r.screen.w), k = W / r.screen.w;
    const sub = mode === 'plain' ? ck(`ไอคอน ${r.count} ตัว จะเรียงเป็นแถวจากซ้ายบนลงล่าง ไม่สนภาพพื้นหลัง`, `${r.count} icons will be lined up in neat columns from the top-left`) : ck(`ไอคอน ${r.count} ตัว จะถูกเรียงเป็นระเบียบ หลบจุดสำคัญของวอลเปเปอร์`, `${r.count} icons will be lined up neatly, avoiding the wallpaper's focal area`);
    const modes = `<div class="pc-modes"><button class="gchip ${mode === 'wallpaper' ? 'sel' : ''}" data-m="wallpaper">🖼️ ${ck('ตามภาพวอลเปเปอร์', 'Around the wallpaper')}</button><button class="gchip ${mode === 'plain' ? 'sel' : ''}" data-m="plain">📐 ${ck('แบบปกติ', 'Normal')}</button></div>`;
    const preview = modes + `<div class="pc-ba"><figure><canvas id="pcB" width="${W}" height="${H}"></canvas><figcaption>${ck('ตอนนี้', 'Now')}</figcaption></figure><span class="pc-arr">➜</span><figure><canvas id="pcA" width="${W}" height="${H}"></canvas><figcaption>${ck('หลังจัด', 'After')}</figcaption></figure></div>`;
    pcCard({
      via: a.via, icon: '🖥️', title: ck('เรียงไอคอนบนหน้าจอใหม่', 'Re-arrange the desktop icons'), sub, preview,
      confirm: ck('เรียงเลย', 'Arrange now'), link: goLay,
      run: async () => {
        const x = await call('layout:apply', { protectPct: 30, sort, dir, mode });
        if (!x) return { error: ck('จัดไม่สำเร็จ', 'Could not arrange') };
        if (x.error) return { error: layoutMessage(x.error) };
        return { text: ck(`เรียงให้แล้ว ${x.moved} ไอคอน`, `${x.moved} icons arranged`), undo: async () => { const u = await call('layout:restore'); return !!(u && !u.error); } };
      },
    });
    document.querySelectorAll('.pc-modes [data-m]').forEach((b) => { b.onclick = () => { if (b.dataset.m !== mode) CK.layout({ ...a, mode: b.dataset.m }); }; });
    const draw = (id, icons, ok) => { const c = $(id); if (!c) return; const g = c.getContext('2d'); if (img) g.drawImage(img, 0, 0, W, H); else { const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#2a3a5e'); bg.addColorStop(1, '#141b30'); g.fillStyle = bg; g.fillRect(0, 0, W, H); } const s = r.cell.w * 0.5 * k; for (const it of icons) { g.fillStyle = 'rgba(126,224,184,.96)'; g.strokeStyle = 'rgba(0,0,0,.55)'; const x = it.x * k + (r.cell.w * k - s) / 2, y = it.y * k + r.cell.h * 0.08 * k; g.beginPath(); g.roundRect(x, y, s, s, 3); g.fill(); g.stroke(); } };
    const cur = (r.current || []).map((i) => ({ x: i.x - r.origin.x, y: i.y - r.origin.y })).filter((i) => i.x >= 0 && i.x < r.screen.w && i.y >= 0 && i.y < r.screen.h);
    draw('#pcB', cur); draw('#pcA', r.icons || []);
  },

  /* clean up: stale captures/installers/dead shortcuts, exact duplicates, similar pictures, rarely used apps */
  async clean(a) {
    const kind = ['stale', 'dupes', 'similar', 'unused'].includes(a.kind) ? a.kind : 'stale';
    pcBusy(ck('กำลังสแกนหาของที่ล้างได้…', 'Scanning for things to clear…'));
    const goClean = { label: ck('ดูในหน้าทำความสะอาด', 'See in Clean-up'), go: () => { state.cl && (state.cl.open = kind); go('cleanup'); } };
    let rows = [], label = '', run;
    if (kind === 'stale') {
      const r = await call('cleanup:scan'); if (!r) return;
      rows = [...r.captures, ...r.installers, ...r.dead].map((x) => ({ path: x.path, name: x.name || ckBase(x.path), size: x.size, note: r.dead.includes(x) ? ck('ทางลัดเสีย', 'dead shortcut') : r.installers.includes(x) ? ck('ตัวติดตั้งเก่า', 'old installer') : ck('แคปหน้าจอเก่า', 'old capture') }));
      label = ck('ภาพหน้าจอเก่า ตัวติดตั้งที่ใช้แล้ว และทางลัดที่เสีย', 'Old screen captures, used installers & broken shortcuts');
    } else if (kind === 'dupes') {
      const r = await call('cleanup:dupes'); if (!r) return;
      rows = r.flatMap((g) => g.files.filter((f) => f.path !== g.keep).map((f) => ({ path: f.path, name: ckBase(f.path), size: f.size, note: ck('ซ้ำกับ ', 'copy of ') + ckBase(g.keep) })));
      label = ck('ไฟล์ซ้ำ (เก็บตัวเก่าสุดไว้)', 'Exact duplicates (oldest copy is kept)');
    } else if (kind === 'similar') {
      const r = await call('cleanup:similar'); if (!r) return;
      rows = r.groups.flatMap((g) => g.files.filter((f) => f.path !== g.keep).map((f) => ({ path: f.path, name: ckBase(f.path), size: f.size, note: `${g.similarity}% · ${f.w}×${f.h}` })));
      label = ck('ภาพคล้ายกัน (เก็บตัวชัดสุดไว้)', 'Look-alike images (the sharpest is kept)');
    } else {
      const r = await call('cleanup:unused'); if (!r) return;
      rows = (r.items || []).map((i) => ({ path: i.path, name: i.name, note: ck('ไม่ได้เปิดนานแล้ว', 'not opened for a while') }));
      label = ck('แอพไม่ได้เปิดนาน (ทางลัดบนหน้าจอ)', 'Unused apps (desktop shortcuts)');
    }
    if (!rows.length) return pcNote(a, '✨', ck('ไม่เจออะไรให้ล้าง โต๊ะสะอาดอยู่แล้ว 👍', 'Nothing to clear — all clean 👍'));
    const bytes = rows.reduce((n, x) => n + (x.size || 0), 0);
    const paths = rows.map((x) => x.path);
    const park = kind === 'unused';
    pcCard({
      via: a.via, icon: park ? '🗃️' : '🧹', title: `${label}: ${rows.length} ${ck('รายการ', 'items')}${bytes ? ' · ' + fmtSize(bytes) : ''}`,
      sub: park ? ck('จะย้ายไปเก็บในโฟลเดอร์ “ไม่ค่อยใช้” ไม่ลบ', 'They are moved into a “Rarely used” folder, not deleted') : ck('จะย้ายไปถังขยะ กู้คืนได้จากถังขยะของ Windows', 'They go to the Recycle Bin, so you can restore them'),
      preview: pcRows(rows, rows.length), confirm: park ? ck(`เก็บเข้าโฟลเดอร์ ${rows.length} รายการ`, `Park ${rows.length}`) : ck(`ย้ายลงถังขยะ ${rows.length} รายการ`, `Recycle ${rows.length}`), danger: !park, link: goClean,
      run: async () => {
        if (park) { const x = await call('cleanup:parkUnused', paths); if (!x) return { error: ck('ทำไม่สำเร็จ', 'Failed') }; return { text: ck(`เก็บให้แล้ว ${x.moved} รายการ`, `${x.moved} parked`), undo: x.batch ? async () => !!(await call('journal:undo', x.batch)) : null }; }
        const x = await call('cleanup:trash', paths);
        if (!x) return { error: ck('ทำไม่สำเร็จ', 'Failed') };
        return { text: ck(`ย้ายลงถังขยะแล้ว ${x.trashed} รายการ (กู้คืนได้จากถังขยะ)`, `${x.trashed} moved to the Recycle Bin (restorable there)`) };
      },
    });
  },

  /* organize now: show where the files would go, then do it */
  async organize(a) {
    pcBusy(ck('กำลังดูว่าไฟล์ไหนควรไปอยู่ตรงไหน…', 'Working out where each file belongs…'));
    const r = await call('plan:build', {}); if (!r) return;
    const items = r.sources.flatMap((s) => s.items).filter((i) => i.confidence !== 'low');
    const left = r.sources.reduce((n, s) => n + s.unmatched.length, 0);
    if (!items.length) return pcNote(a, '✨', ck('ไม่มีไฟล์ที่ต้องจัดตอนนี้ โต๊ะเรียบร้อยดี', 'Nothing to file right now'), left ? `<div class="muted" style="margin-top:8px">${ck(`มี ${left} ไฟล์ที่ยังไม่มีกฎรองรับ ลองถามว่า “ไฟล์ไหนยังไม่ถูกจัดหมวด”`, `${left} files have no rule yet — try asking “which files are not filed yet”`)}</div>` : '');
    const by = new Map();
    for (const i of items) by.set(i.rel, (by.get(i.rel) || 0) + 1);
    const groups = [...by.entries()].sort((x, y) => y[1] - x[1]);
    const preview = `<div class="pc-groups">${groups.slice(0, 8).map(([rel, n]) => `<div class="pc-g"><span class="pc-gn">${n}</span><span>📁 ${esc(rel)}</span></div>`).join('')}</div>${groups.length > 8 ? `<div class="muted" style="font-size:12px;margin-top:4px">+${groups.length - 8} ${ck('โฟลเดอร์', 'folders')}</div>` : ''}`;
    pcCard({
      via: a.via, icon: '🗂️', title: ck(`จัดไฟล์ ${items.length} ไฟล์เข้า ${groups.length} โฟลเดอร์`, `File ${items.length} files into ${groups.length} folders`),
      sub: left ? ck(`ข้าม ${left} ไฟล์ที่ยังไม่มีกฎ`, `${left} files without a rule are skipped`) : '', preview, confirm: ck('จัดเลย', 'File them'),
      link: { label: ck('ดู/เลือกทีละไฟล์', 'Review file by file'), go: () => { go('organize'); ACTS.scan(); } },
      run: async () => {
        const x = await call('plan:apply', { items, label: ck('จัดจากแถบคำสั่ง', 'From command bar') });
        if (!x) return { error: ck('ทำไม่สำเร็จ', 'Failed') };
        const n = x.results.filter((q) => q.ok).length;
        return { text: ck(`จัดให้แล้ว ${n} ไฟล์`, `${n} files filed`), undo: x.batch ? async () => !!(await call('journal:undo', x.batch.id)) : null };
      },
    });
  },

  /* switch a setting on/off (whitelist) */
  async setting(a) {
    const S = { widget: ['วิดเจ็ตบนหน้าจอ', 'Desktop widget'], widgetTop: ['วิดเจ็ตอยู่บนสุดเสมอ', 'Widget always on top'], notify: ['การแจ้งเตือนมุมจอ', 'Corner notifications'], watch: ['ติดตามและจัดไฟล์อัตโนมัติ', 'Watch & auto-organize'], startup: ['เปิดพร้อม Windows', 'Start with Windows'], includeShortcuts: ['รวมทางลัดโปรแกรมตอนจัดไฟล์', 'Include program shortcuts when filing'] };
    const key = a.key, on = a.value === true || a.value === 'true';
    if (!S[key]) return CK.goto({ ...a, tab: 'settings' });
    const now = key === 'notify' ? cfg.notify !== false : !!cfg[key];
    const name = ck(S[key][0], S[key][1]);
    if (now === on) return pcNote(a, '✅', ck(`“${name}” ${on ? 'เปิด' : 'ปิด'}อยู่แล้ว`, `“${name}” is already ${on ? 'on' : 'off'}`));
    pcCard({
      via: a.via, icon: on ? '🟢' : '⚪', title: ck(`${on ? 'เปิด' : 'ปิด'} “${name}”`, `Turn ${on ? 'on' : 'off'} “${name}”`), sub: ck('เปลี่ยนได้อีกทีในตั้งค่า', 'You can change it again in Settings'), confirm: on ? ck('เปิดเลย', 'Turn on') : ck('ปิดเลย', 'Turn off'),
      run: async () => {
        const c = await call('cfg:set', { [key]: on }); if (!c) return { error: ck('เปลี่ยนไม่สำเร็จ', 'Could not change') };
        cfg = c;
        return { text: ck(`${on ? 'เปิด' : 'ปิด'}“${name}” แล้ว`, `“${name}” is ${on ? 'on' : 'off'}`), undo: async () => { const b = await call('cfg:set', { [key]: !on }); if (b) cfg = b; return !!b; } };
      },
    });
  },

  /* anything with its own page: open it (so nothing is ever a dead end) */
  async goto(a) {
    const tab = ckTabs.includes(a.tab) ? a.tab : 'organize';
    closeModal(); go(tab);
  },
};
window.CK = CK;
