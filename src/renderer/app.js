'use strict';
const bridge = window.api;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(e.message));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));

const TABS = [['organize', '🗂️'], ['auto', '⚡'], ['guard', '🛡️'], ['cleanup', '🧹'], ['modes', '🖥️'], ['layout', '🪟'], ['search', '🔎'], ['history', '⏳'], ['rules', '📐'], ['settings', '⚙️']];
const state = { tab: 'organize', plan: null, sel: new Set(), useName: new Set(), inbox: [], cl: null, searchQ: '' };
let cfg = null;

const t = (k, v) => {
  let s = (window.I18N[cfg?.lang || 'th'] || {})[k] ?? window.I18N.en[k] ?? k;
  if (v) for (const x in v) s = s.split('{' + x + '}').join(v[x]);
  return s;
};
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
const fmtDate = (ms) => new Date(ms).toLocaleString(cfg?.lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
let viewTab = null;
const view = (html) => {
  const m = $('#view'), same = viewTab === state.tab, y = m.scrollTop;
  m.innerHTML = html;
  m.scrollTop = same ? y : 0;
  viewTab = state.tab;
  if (same && m.scrollTop < y - 2) { pendingY = y; clearTimeout(pendingTimer); pendingTimer = setTimeout(() => { pendingY = 0; }, 4000); } // page got shorter for a moment (loading): come back when it grows
};
let pendingY = 0, pendingTimer = 0;
new MutationObserver(() => {
  if (!pendingY) return;
  const m = $('#view'); m.scrollTop = pendingY;
  if (m.scrollTop >= pendingY - 2) pendingY = 0;
}).observe($('#view'), { childList: true, subtree: true });
['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => $('#view').addEventListener(ev, () => { pendingY = 0; }, { passive: true }));
const toTop = () => { pendingY = 0; requestAnimationFrame(() => $('#view').scrollTo({ top: 0, behavior: 'smooth' })); };
/** bring something that just appeared (a form, a result) into the middle of the screen */
const reveal = (sel) => requestAnimationFrame(() => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
const base = (p) => String(p).split(/[\\/]/).pop();

async function call(ch, payload) {
  const r = await bridge.invoke(ch, payload);
  if (r && r.error) { toast(t('errp', { e: r.error })); return null; }
  return r;
}

/* ---------- toast & modal ---------- */
let toastTimer;
function toast(msg, { undoId, ms = 8000 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (undoId ? `<button class="sm" data-act="undo" data-id="${esc(undoId)}">${t('undo')}</button>` : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function ask({ title, body = '', password = false, placeholder = '', confirmOnly = false }) {
  return new Promise((resolve) => {
    openModal(`<div class="dlg"><h3>${esc(title)}</h3>${body ? `<p class="muted">${body}</p>` : ''}${confirmOnly ? '' : `<input id="askIn" type="${password ? 'password' : 'text'}" placeholder="${esc(placeholder)}" autocomplete="off">`}<div class="acts"><button id="askNo">${t('cancel')}</button><button class="primary" id="askYes">${t('confirm')}</button></div></div>`);
    const done = (v) => { closeModal(); resolve(v); };
    $('#askNo').onclick = () => done(null);
    $('#askYes').onclick = () => done(confirmOnly ? true : $('#askIn').value);
    const inp = $('#askIn');
    if (inp) { inp.focus(); inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); }; }
  });
}

/* ---------- shell ---------- */
function renderNav() {
  $('#nav').innerHTML = TABS.map(([id, ico]) =>
    `<button data-act="go" data-tab="${id}" class="${state.tab === id ? 'on' : ''}"><span>${ico}</span>${t(id)}${id === 'auto' && state.inbox.length ? `<span class="badge">${state.inbox.length}</span>` : ''}</button>`).join('');
  $('#palLabel').textContent = t('palette');
  document.documentElement.lang = cfg.lang;
}
function go(tab) { state.tab = tab; renderNav(); RENDER[tab](); }

/* ---------- organize (visual) ---------- */
// colour + icon per category, so a glance tells you what is what
const CAT = {
  captures: ['#ff7a8a', '📸'], images: ['#4fd1a5', '🖼️'], documents: ['#6ea8ff', '📄'], spreadsheets: ['#3fbf7f', '📊'], presentations: ['#ffb454', '📽️'],
  videos: ['#b583ff', '🎬'], audio: ['#ff86c8', '🎵'], archives: ['#c9a36a', '🗜️'], installers: ['#8f9bb3', '💿'], code: ['#4cc9e6', '💻'],
  design: ['#ff8a5b', '🎨'], fonts: ['#9aa6c4', '🔤'], project: ['#a78bfa', '🧩'], ai: ['#f2c94c', '✨'],
};
const SC_ICON = '<svg class="scico" viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5" fill="#fff" stroke="currentColor" stroke-width="1.8"/><path d="M9.2 14.8 L15 9 M10.2 9 H15 V13.8" fill="none" stroke="#2f6bff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const catStyle = (id) => (String(id).startsWith('rule:') ? ['#8b9dff', '📐'] : String(id).startsWith('sc:') ? ['#38c8a0', SC_ICON] : CAT[id] || ['#8e9bb8', '📄']);
state.expanded = new Set();
state.thumbs = new Map();
state.done = null;

function renderOrganize() {
  view(`<div class="org-head"><div><h1>${t('organize')}</h1></div>
      <div class="org-opts"><label class="pill"><input type="checkbox" data-chg="includeShortcuts" ${cfg.includeShortcuts ? 'checked' : ''}><span>${SC_ICON} ${t('inc_shortcuts')}</span></label>
      ${cfg.aiEnabled && cfg.hasKey ? `<label class="pill"><input type="checkbox" id="useAI"><span>✨ ${t('use_ai')}</span></label>` : ''}
      <button data-act="scan">↻ ${t('rescan')}</button></div></div>
    <div id="planBox">${state.plan ? planHTML() : skeletonHTML()}</div>`);
  if (state.plan) afterPlanRender();
  else if (!state.scanning) ACTS.scan();
}

const skeletonHTML = () => `<div class="hero skel"><div class="shimmer" style="height:150px;flex:1"></div></div><div class="fgrid">${'<div class="fcard skel"><div class="shimmer" style="height:150px"></div></div>'.repeat(3)}</div><p class="muted" style="text-align:center">${t('scanning')}</p>`;

function groupPlan(p) {
  const groups = [];
  for (const s of p.sources) {
    const by = new Map();
    for (const it of s.items) (by.get(it.dest) || by.set(it.dest, []).get(it.dest)).push(it);
    for (const [dest, items] of by) {
      const counts = {};
      for (const i of items) counts[i.category] = (counts[i.category] || 0) + 1;
      const cat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      groups.push({ key: dest, dest, rel: items[0].rel, items, cat, exists: items[0].destExists, source: s.sourceDir, label: items[0].categoryLabel });
    }
  }
  return groups.sort((x, y) => y.items.length - x.items.length || x.rel.localeCompare(y.rel)); // biggest piles first
}

function heroHTML(groups, all) {
  const scatter = all.slice(0, 44).map((it, i) => {
    const [c] = catStyle(it.category);
    return `<i class="sc-tile" style="--cc:${c};left:${(i * 37) % 88}%;top:${(i * 53) % 74}%;transform:rotate(${((i * 29) % 44) - 22}deg);animation-delay:${i * 18}ms"></i>`;
  }).join('');
  const minis = groups.slice(0, 8).map((g) => `<div class="mini-folder" style="--cc:${catStyle(g.cat)[0]}"><i></i><b>${g.items.length}</b></div>`).join('');
  return `<div class="hero"><div class="hero-side"><div class="scatter">${scatter}</div><div class="cap"><b>${all.length}</b> ${t('org_files')} · ${t('org_now')}</div></div>
    <div class="hero-arrow"><span>➜</span></div>
    <div class="hero-side"><div class="minis">${minis}${groups.length > 8 ? `<span class="muted">+${groups.length - 8}</span>` : ''}</div><div class="cap"><b>${groups.length}</b> ${t('org_folders')} · ${t('org_after')}</div></div></div>`;
}

function tileHTML(it, left = false) {
  const [c, ico] = catStyle(it.category);
  const sel = !left && state.sel.has(it.src);
  const why = left ? t('left_in_place', { n: '' }) : t('r_' + it.reason.k, { v: it.reason.v });
  return `<button class="tile ${sel ? 'sel' : ''} ${left ? 'left' : 'conf-' + it.confidence}" data-act="${left ? 'qrOpen' : 'tileTog'}" data-src="${esc(it.src)}" style="--cc:${c}" title="${esc(it.name)} — ${esc(left ? t('qr_tip') : why)} · ${fmtSize(it.size)}">
    <div class="thumb" data-thumb="${esc(it.src)}"><span>${ico}</span></div><span class="tn">${esc(it.newName && state.useName.has(it.src) ? it.newName : it.name)}</span>
    ${left ? '<i class="lock plus">＋</i>' : `<i class="cdot"></i><i class="tick">✓</i>`}${it.newName ? `<u class="nm ${state.useName.has(it.src) ? 'on' : ''}" data-act="nameTog" data-src="${esc(it.src)}" title="${esc(t('use_name'))}: ${esc(it.newName)}">✨</u>` : ''}</button>`;
}

function cardHTML(g) {
  const [c] = catStyle(g.cat);
  const open = state.expanded.has(g.key), shown = open ? g.items : g.items.slice(0, 8);
  const selN = g.items.filter((i) => state.sel.has(i.src)).length;
  const reasons = [...new Map(g.items.map((i) => [i.reason.k + i.reason.v, t('r_' + i.reason.k, { v: i.reason.v })])).values()].slice(0, 2);
  return `<div class="fcard" data-key="${esc(g.key)}" style="--cc:${c}">
    <div class="fhead"><div class="folder-ico"><i></i></div>
      <div class="ftitle"><b title="${esc(g.dest)}">${esc(g.rel)}</b><small><span class="badge ${g.exists ? '' : 'new'}">${g.exists ? t('fld_exist') : '＋ ' + t('fld_new')}</span> ${g.items.length} ${t('org_files')}</small></div>
      <button class="chk ${selN === g.items.length ? 'all' : selN ? 'some' : ''}" data-act="cardTog" data-key="${esc(g.key)}" title="${t('sel_all')}"><span>✓</span></button></div>
    <div class="tiles">${shown.map((i) => tileHTML(i)).join('')}${!open && g.items.length > 8 ? `<button class="tile more" data-act="expand" data-key="${esc(g.key)}">+${g.items.length - 8}</button>` : ''}</div>
    <div class="why">${reasons.map((r) => `<span>${esc(r)}</span>`).join('')}</div></div>`;
}

function planHTML() {
  const p = state.plan, groups = groupPlan(p), all = p.sources.flatMap((s) => s.items);
  let html = '';
  if (state.done) {
    const d = state.done;
    html += `<div class="done"><div class="done-ring">✓</div><div class="grow"><b>${t('done_title')}</b><br><span>${t('done_sub', { n: d.n, m: d.m })}${d.bad ? ' · ' + t('failed_n', { n: d.bad }) : ''}</span></div>${d.batch ? `<button data-act="undo" data-id="${esc(d.batch)}">↩ ${t('undo')}</button>` : ''}<button data-act="doneClose">✕</button></div>`;
  }
  if (state.note) {
    const n = all.filter((i) => i.reason.k === 'rule' && i.reason.v === state.note.name).length;
    html += `<div class="done note"><div class="done-ring">🧩</div><div class="grow"><b>${t('qr_done_t', { name: esc(state.note.name) })}</b><br><span>${t('qr_done_s', { n })}</span></div><button data-act="noteClose">✕</button></div>`;
  }
  for (const s of p.sources) if (s.aiError) html += `<div class="card warn">${esc(t('ai_err', { e: s.aiError }))}</div>`;
  const left = p.sources.flatMap((s) => s.unmatched);
  if (!all.length) {
    html += `<div class="tidy"><div class="tidy-ico">🧼<b>✨</b></div><h2>${t('tidy_title')}</h2><p class="muted">${t('tidy_sub')}</p></div>`;
  } else {
    if (all.length >= 4) html += heroHTML(groups, all); // the before/after picture only helps when there is a mess
    html += `<div class="actbar"><div class="legend"><span><i class="cdot c-high"></i>${t('conf_high')}</span><span><i class="cdot c-medium"></i>${t('conf_medium')}</span><span><i class="cdot c-low"></i>${t('conf_low')}</span><span class="muted">· ${t('tap_hint')}</span></div>
      <div class="acts"><button class="sm" data-act="selAll">${t('sel_all')}</button><button class="sm" data-act="selHigh">${t('sel_high')}</button><button class="sm" data-act="selNone">${t('sel_none')}</button>
      <button class="primary go" id="goBtn" data-act="apply"><span id="goTxt"></span></button></div></div>`;
    for (const s of p.sources) {
      const mine = groups.filter((g) => g.source === s.sourceDir);
      if (!mine.length && !s.warnings.length) continue;
      html += `<div class="src"><span class="src-ico">🖥️</span><b>${esc(s.sourceDir.split(/[\\/]/).pop())}</b><span class="muted">${esc(s.sourceDir)}</span><span class="src-arrow">➜</span></div>`;
      if (s.warnings.length) html += `<div class="chip warn">⚠️ ${esc(t('dev_warn', { n: s.warnings.map((w) => w.name).join(', ') }))}</div>`;
      html += `<div class="fgrid">${mine.map(cardHTML).join('')}</div>`;
    }
  }
  if (left.length) {
    html += `<div class="leftbox"><div class="lefthead">🧩 ${t('left_title')} <span class="muted">· ${left.length}</span></div><div class="muted" style="font-size:12.5px;margin:-4px 0 10px">${t('qr_hint')}</div><div class="tiles wide">${left.slice(0, 24).map((u) => tileHTML({ ...u, category: 'x', reason: { k: 'ext', v: '' }, confidence: 'low' }, true)).join('')}${left.length > 24 ? `<span class="muted">+${left.length - 24}</span>` : ''}</div></div>`;
  }
  return html;
}

function refreshSelection() {
  const p = state.plan;
  if (!p) return;
  document.querySelectorAll('.tile[data-src]:not(.left)').forEach((el) => el.classList.toggle('sel', state.sel.has(el.dataset.src)));
  for (const g of groupPlan(p)) {
    const card = [...document.querySelectorAll('.fcard')].find((c) => c.dataset.key === g.key);
    if (!card) continue;
    const n = g.items.filter((i) => state.sel.has(i.src)).length;
    const chk = card.querySelector('.chk');
    chk.classList.toggle('all', n === g.items.length); chk.classList.toggle('some', n > 0 && n < g.items.length);
  }
  const n = state.sel.size, goTxt = $('#goTxt'), btn = $('#goBtn');
  if (goTxt) goTxt.textContent = n ? t('go_tidy', { n }) : t('go_none');
  if (btn) btn.disabled = n === 0;
}

async function loadThumbs() {
  const els = [...document.querySelectorAll('[data-thumb]')];
  const paint = (el) => { const u = state.thumbs.get(el.dataset.thumb); if (u) { el.style.backgroundImage = `url("${u}")`; el.classList.add('has'); } };
  els.forEach(paint);
  const need = [...new Set(els.map((e) => e.dataset.thumb).filter((p) => !state.thumbs.has(p)))];
  for (let i = 0; i < need.length; i += 24) {
    const r = await call('thumb:get', need.slice(i, i + 24));
    if (!r) return;
    for (const p of need.slice(i, i + 24)) state.thumbs.set(p, r[p] || '');
    document.querySelectorAll('[data-thumb]').forEach(paint);
  }
}

function afterPlanRender() { refreshSelection(); loadThumbs(); }

/* ---------- quick rule: create a rule straight from a "left in place" file ---------- */
const qr = { file: null, d: null, timer: null, prev: null };

function qrSuggestWord(stem) {
  const tok = stem.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3 && !/^\d+$/.test(x));
  return (tok[0] || stem).slice(0, 24);
}
const qrGroupOf = (ext) => Object.keys(TYPE_GROUPS).find((g) => TYPE_GROUPS[g][1].split(',').includes(ext));

function qrRule() {
  const d = qr.d, word = d.word.trim();
  const exts = d.useExt && d.ext ? [d.ext] : [];
  const pattern = d.useWord && word ? escRe(word) : '';
  const name = pattern && exts.length ? `${word} .${d.ext}` : exts.length ? `*.${d.ext}` : word || d.dest.trim();
  return { name, pattern, exts, dest: d.dest.trim(), monthly: !!d.monthly };
}
const qrValid = (r) => !!r.dest && (!!r.pattern || r.exts.length > 0);

function qrPrevHTML() {
  const p = qr.prev, r = qrRule();
  if (!r.pattern && !r.exts.length) return `<span class="muted">${t('qr_pick_one')}</span>`;
  if (!p) return `<span class="muted">${t('scanning')}</span>`;
  if (!p.count) return `<span class="muted">${t('qr_prev_0')}</span>`;
  return `<div><b>✨ ${t('qr_prev_n', { n: p.count })}</b></div><div class="prev-chips">${p.names.map((n) => `<span class="fchip" style="--cc:#6ea8ff"><em>${extIcon((n.split('.').pop() || '').toLowerCase())}</em>${esc(n)}</span>`).join('')}${p.count > p.names.length ? `<span class="muted">+${p.count - p.names.length}</span>` : ''}</div>`;
}

async function qrTest() {
  const r = qrRule();
  const save = $('#qrSave'); if (save) save.disabled = !qrValid(r);
  if (!r.pattern && !r.exts.length) { qr.prev = null; const p = $('#qrPrev'); if (p) p.innerHTML = qrPrevHTML(); return; }
  const res = await call('rules:test', [{ pattern: r.pattern, exts: r.exts }]);
  if (!res || !qr.d) return;
  qr.prev = res[0];
  const p = $('#qrPrev'); if (p) p.innerHTML = qrPrevHTML();
}

function qrDialog() {
  const d = qr.d, f = qr.file;
  const sugs = [...new Set([d.ext ? (qrGroupOf(d.ext) ? t('sg_' + qrGroupOf(d.ext)) : '') : '', d.ext ? d.ext.toUpperCase() : '', d.word.trim()].filter(Boolean))];
  openModal(`<div class="dlg qrdlg"><h3>🧩 ${t('qr_title')}</h3>
    <div class="qr-file"><div class="thumb" data-thumb="${esc(f.src)}"><span>${extIcon(d.ext)}</span></div><div><b>${esc(f.name)}</b><small>${fmtSize(f.size)}${d.ext ? ' · .' + esc(d.ext) : ''}</small></div></div>
    <div class="qr-q"><b>1 · ${t('qr_q1')}</b>
      <label class="qr-opt ${d.ext ? '' : 'dis'}"><input type="checkbox" id="qrUseExt" ${d.useExt ? 'checked' : ''} ${d.ext ? '' : 'disabled'}><span>${t('qr_ext', { ext: d.ext ? '<code>.' + esc(d.ext) + '</code>' : '—' })}</span></label>
      <label class="qr-opt"><input type="checkbox" id="qrUseWord" ${d.useWord ? 'checked' : ''}><span>${t('qr_word')}</span><input type="text" id="qrWord" value="${esc(d.word)}"></label></div>
    <div class="qr-q"><b>2 · ${t('qr_q2')}</b><input type="text" id="qrDest" list="qrfolders" value="${esc(d.dest)}" placeholder="${esc(t('qr_dest_ph'))}"><datalist id="qrfolders">${rl.folders.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="qr-sugs"><span class="muted">${t('qr_sug')}</span>${sugs.map((x) => `<button class="exchip" data-act="qrSug" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <label class="pill" style="margin-top:8px"><input type="checkbox" id="qrMonthly" ${d.monthly ? 'checked' : ''}><span>📅 ${t('rl_monthly')}</span></label></div>
    <div class="rb-prev" id="qrPrev">${qrPrevHTML()}</div>
    <div class="acts"><button id="qrCancel">${t('cancel')}</button><button class="primary" id="qrSave" ${qrValid(qrRule()) ? '' : 'disabled'}>＋ ${t('qr_save')}</button></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">${t('qr_foot')}</p></div>`);
  const upd = () => {
    d.useExt = $('#qrUseExt').checked; d.useWord = $('#qrUseWord').checked; d.word = $('#qrWord').value; d.dest = $('#qrDest').value; d.monthly = $('#qrMonthly').checked;
    clearTimeout(qr.timer); qr.timer = setTimeout(qrTest, 250);
    const sv = $('#qrSave'); if (sv) sv.disabled = !qrValid(qrRule());
  };
  ['#qrUseExt', '#qrUseWord', '#qrMonthly'].forEach((s) => { $(s).onchange = upd; });
  $('#qrWord').oninput = () => { $('#qrUseWord').checked = true; upd(); };
  $('#qrDest').oninput = upd;
  $('#qrCancel').onclick = () => { qr.d = null; closeModal(); };
  $('#qrSave').onclick = qrSaveRule;
  $('#qrDest').focus();
  loadThumbs();
  qrTest();
}

async function qrSaveRule() {
  const rule = qrRule();
  if (!qrValid(rule)) return;
  $('#qrSave').disabled = true;
  const c = await call('rules:add', rule);
  if (!c) { $('#qrSave').disabled = false; return; }
  cfg = c; qr.d = null; closeModal();
  state.note = { name: rule.name };
  await ACTS.scan({ keepDone: true, keepNote: true });
  document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- auto (visual) ---------- */
const LEVELS = [['ask', '🙋', 'lvl_ask', 'lvl_ask_d'], ['smart', '🤝', 'lvl_smart', 'lvl_smart_d'], ['full', '🚀', 'lvl_full', 'lvl_full_d']];
const timeShort = (ms) => new Date(ms).toLocaleTimeString(cfg.lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
function agoText(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return t('ago_now');
  if (s < 3600) return t('ago_m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago_h', { n: Math.floor(s / 3600) });
  return t('ago_d', { n: Math.floor(s / 86400) });
}
const lastSeg = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
const catLabel = (id) => { const c = (cfg.categories || []).find((x) => x.id === id); return c ? c[cfg.lang] : String(id).replace(/^(rule:|sc:)/, ''); };

async function renderAuto() {
  state.inbox = (await call('inbox:list')) || [];
  const st = (await call('auto:status')) || { watching: [], recent: [], folders: [], pinned: [], todayTotal: 0 };
  renderNav();
  if (state.tab !== 'auto') return;
  const on = !!cfg.watch && st.watching.length > 0;
  const lvlIdx = Math.max(0, LEVELS.findIndex((l) => l[0] === cfg.autoMode));

  const hero = `<div class="apilot ${on ? 'on' : ''}"><div class="radar"><i></i><i></i><i></i><div class="core">${on ? '🛰️' : cfg.watch ? '⚠️' : '💤'}</div></div>
    <div class="ap-main"><div class="ap-title">${on ? t('ap_on', { n: st.watching.length }) : cfg.watch ? t('ap_nofolder') : t('ap_off')}</div>
      <div class="ap-sub"><span class="ap-chip ok">⚡ ${t('ap_today', { n: st.todayTotal })}</span>${state.inbox.length ? `<span class="ap-chip wait">📥 ${t('ap_wait', { n: state.inbox.length })}</span>` : ''}</div></div>
    <button class="switch big ${cfg.watch ? 'on' : ''}" data-act="watchTog" title="${t('watch_on')}"><i></i></button></div>`;

  const dial = `<div class="card"><h3>🎚️ ${t('lvl_title')}</h3><div class="dial"><div class="dial-line"><i style="width:${lvlIdx * 50}%"></i></div>
    ${LEVELS.map(([id, ico, k], i) => `<button class="stop ${i <= lvlIdx ? 'fill' : ''} ${i === lvlIdx ? 'cur' : ''}" data-act="setLevel" data-mode="${id}"><span class="st-ico">${ico}</span><b>${t(k)}</b></button>`).join('')}</div>
    <p class="dial-desc">${t(LEVELS[lvlIdx][3])}</p></div>`;

  const pipe = `<div class="card"><h3>🔄 ${t('pipe_title')}</h3><div class="pipe">
    <div class="pstep">📥<b>${t('pipe_new')}</b></div><i class="parr">➜</i><div class="pstep">⏳<b>${t('pipe_wait')}</b></div><i class="parr">➜</i><div class="pstep">🧠<b>${t('pipe_rules')}</b></div><i class="parr">➜</i>
    <div class="pfork"><div class="pstep ${cfg.autoMode === 'ask' ? 'dim' : 'go'}"><span class="pi">⚡</span><b>${t('pipe_auto')}</b><small>${t('pipe_auto_' + cfg.autoMode)}</small></div>
    <div class="pstep ${cfg.autoMode === 'full' ? 'dim' : 'ask'}"><span class="pi">🙋</span><b>${t('pipe_inbox')}</b><small>${t('pipe_inbox_' + cfg.autoMode)}</small></div></div></div></div>`;

  const folders = `<div class="card"><h3>👁️ ${t('watch_folders')}</h3><div class="wgrid">${(st.folders || []).map((f) => `<div class="wcard ${f.watch && on ? 'live' : ''} ${f.exists ? '' : 'miss'}">
      <div class="w-ico"><i class="pulse"></i>📁</div><div class="w-main"><b>${esc(lastSeg(f.path))}</b><small title="${esc(f.path)}">${esc(f.path)}</small><span class="w-count">${f.exists ? '⚡ ' + t('ap_today', { n: f.today }) : t('not_found')}</span></div>
      <button class="switch sm ${f.watch ? 'on' : ''}" data-act="folderTog" data-path="${esc(f.path)}" ${f.exists ? '' : 'disabled'}><i></i></button>
      ${st.folders.length > 1 ? `<button class="x" data-act="autoRmFolder" data-path="${esc(f.path)}" title="${t('remove')}">✕</button>` : ''}</div>`).join('')}
    <button class="wcard add" data-act="autoAddFolder"><span>＋</span>${t('add_folder')}</button></div></div>`;

  const inbox = `<div class="card"><h3>📥 ${t('inbox')} <span class="muted">· ${state.inbox.length}</span>${state.inbox.length ? `<button class="primary sm" style="margin-left:auto" data-act="inboxAll">✓ ${t('apply_all')}</button>` : ''}</h3>
    ${state.inbox.length ? `<div class="igrid">${state.inbox.map((it) => { const [c, ico] = catStyle(it.category); return `<div class="icard conf-${it.confidence}" style="--cc:${c}"><div class="thumb big" data-thumb="${esc(it.src)}"><span>${ico}</span></div>
        <div class="i-main"><b title="${esc(it.name)}">${esc(it.name)}</b><div class="i-to"><i class="cdot"></i>➜ ${esc(it.rel)}</div></div>
        <div class="i-act"><button class="primary sm" data-act="inboxApply" data-src="${esc(it.src)}" title="${t('apply')}">✓</button><button class="sm" data-act="inboxDismiss" data-src="${esc(it.src)}" title="${t('dismiss')}">✕</button></div></div>`; }).join('')}</div>`
    : `<div class="inbox-empty"><span>✨</span><b>${t('inbox_empty')}</b></div>`}</div>`;

  const tl = `<div class="card"><h3>⚡ ${t('auto_recent')}</h3>${st.recent.length ? `<div class="tl">${st.recent.map((b) => `<div class="tl-row ${b.undone ? 'undone' : ''}"><i class="tl-dot"></i><div class="tl-time"><b>${timeShort(b.time)}</b><small>${agoText(b.time)}</small></div>
      <div class="tl-body">${b.files.slice(0, 4).map((f) => { const [c, ico] = catStyle(f.category); return `<span class="fchip" style="--cc:${c}"><em>${ico}</em>${esc(f.name)}<u>➜ ${esc(f.to)}</u></span>`; }).join('')}${b.files.length > 4 ? `<span class="muted">+${b.files.length - 4}</span>` : ''}</div>
      <div>${b.undone ? `<span class="tag">${t('undone_tag')}</span>` : `<button class="sm" data-act="undo" data-id="${b.id}">↩ ${t('undo')}</button>`}</div></div>`).join('')}</div>` : `<div class="inbox-empty"><span>⏳</span><b>${t('auto_none')}</b></div>`}</div>`;

  const stats = cfg.stats || {}, trusted = cfg.trusted || {};
  const ids = [...new Set([...Object.keys(stats), ...Object.keys(trusted)])].sort((a, b) => (trusted[b] ? 1 : 0) - (trusted[a] ? 1 : 0) || ((stats[b] || {}).approved || 0) - ((stats[a] || {}).approved || 0)).slice(0, 9);
  const ladder = `<div class="card"><h3>🤝 ${t('trusted')}</h3><p class="muted" style="margin:0 0 10px;font-size:12.5px">${t('trust_how')}</p>${ids.length ? `<div class="lgrid">${ids.map((id) => {
    const n = Math.min(10, (stats[id] || {}).approved || 0), [c, ico] = catStyle(id), isT = !!trusted[id];
    return `<div class="lrow ${isT ? 'trusted' : ''}" style="--cc:${c}"><span class="l-ico">${ico}</span><b>${esc(catLabel(id))}</b>
      <div class="l-bar">${Array.from({ length: 10 }, (_, i) => `<i class="${isT || i < n ? 'on' : ''}"></i>`).join('')}</div>
      ${isT ? `<button class="sm" data-act="revoke" data-cat="${esc(id)}" title="${t('revoke')}">🤝 ✕</button>` : n >= 10 ? `<button class="sm primary" data-act="trustOn" data-cat="${esc(id)}">${t('trust_add')}</button>` : `<span class="l-n">${n}/10</span>`}</div>`;
  }).join('')}</div>` : `<span class="muted">${t('trusted_none')}</span>`}</div>`;

  const pins = (st.pinned || []).length ? `<div class="card"><h3>📌 ${t('pinned_title')}</h3><p class="muted" style="margin:0 0 10px;font-size:12.5px">${t('pinned_note')}</p><div class="igrid">${st.pinned.map((p) => `<div class="icard" style="--cc:#8e9bb8"><div class="thumb big" data-thumb="${esc(p.path)}"><span>📌</span></div><div class="i-main"><b title="${esc(p.path)}">${esc(p.name)}</b></div><div class="i-act"><button class="primary sm" data-act="unpin" data-path="${esc(p.path)}">${t('unpin')}</button></div></div>`).join('')}</div></div>` : '';
  const sugs = (cfg.suggestions || []).length ? `<div class="card"><h3>🧠 ${t('suggestions')}</h3>${cfg.suggestions.map((s) => `<div class="sug"><span>💡 ${esc(t('sug_ignore', { ext: s.ext }))}</span><span><button class="primary sm" data-act="sugAccept" data-ext="${esc(s.ext)}">${t('accept')}</button> <button class="sm" data-act="sugDismiss" data-ext="${esc(s.ext)}">${t('dismiss')}</button></span></div>`).join('')}</div>` : '';

  view(`<h1>${t('auto')}</h1>${hero}${inbox}<div class="two">${dial}${pipe}</div>${folders}${tl}${ladder}${pins}${sugs}`);
  loadThumbs();
}

/* ---------- guard (visual) ---------- */
// one glanceable icon per reason, so "what was found" reads without text
const GREASON = {
  'name:credential': '🪪', 'name:password': '🔐', 'name:secret': '🤫', 'name:env': '⚙️', 'name:sshkey': '🗝️', 'name:keyfile': '🔑', 'name:token': '🎫', 'name:apikey': '🧩', 'name:privatekey': '🗝️', 'name:wallet': '👛',
  'content:privateKey': '🗝️', 'content:awsKey': '☁️', 'content:anthropicKey': '🤖', 'content:openaiKey': '🤖', 'content:githubToken': '🐙', 'content:slackToken': '💬', 'content:googleKey': '🔎', 'content:jwt': '🎫', 'content:passwordAssign': '🔐', 'content:dbUrl': '🗄️',
};
state.gd = { findings: null, vault: [], busy: false, scanned: 0 };

const gdLevel = () => { const g = state.gd; if (g.busy) return 'busy'; if (g.findings === null) return 'idle'; if (g.findings.some((f) => f.severity === 'high')) return 'danger'; if (g.findings.length) return 'warn'; return 'safe'; };

function renderGuard() {
  view(`<h1>${t('guard')}</h1><div id="gdBox">${gdHTML()}</div>`);
  if (!state.gd.busy && (!state.gd.scanned || Date.now() - state.gd.scanned > 120000)) ACTS.guardScan();
}
function gdRerender() { const b = $('#gdBox'); if (b) b.innerHTML = gdHTML(); }

function fileGlyph(f) {
  const n = f.name.toLowerCase();
  if (/\.(pem|key|pfx|p12|ppk|jks|keystore)$/.test(n)) return '🔑';
  if (/id_(rsa|ed25519|dsa|ecdsa)/.test(n)) return '🗝️';
  if (/\.env|env$/.test(n)) return '⚙️';
  if (/\.kdbx$/.test(n)) return '🗃️';
  return '📄';
}

function gdHero() {
  const g = state.gd, L = gdLevel();
  const high = (g.findings || []).filter((f) => f.severity === 'high').length, med = (g.findings || []).filter((f) => f.severity !== 'high').length;
  const title = { idle: t('sh_idle'), busy: t('sh_scanning'), safe: t('sh_safe'), warn: t('sh_warn', { n: med }), danger: t('sh_danger', { n: high }) }[L];
  const glyph = { idle: '?', busy: '', safe: '✓', warn: '!', danger: '!' }[L];
  const chips = g.findings === null ? '' : `<span class="gchip high ${high ? '' : 'zero'}">🔴 ${t('sh_high', { n: high })}</span><span class="gchip med ${med ? '' : 'zero'}">🟠 ${t('sh_med', { n: med })}</span><span class="gchip vault">🔐 ${t('sh_vault', { n: g.vault.length })}</span>`;
  return `<div class="shero lv-${L}"><div class="shield"><svg viewBox="0 0 100 110"><path d="M50 6 L90 20 V52 C90 78 72 96 50 104 C28 96 10 78 10 52 V20 Z"/></svg><span class="sh-glyph">${glyph}</span><i class="sweep"></i></div>
    <div class="sh-main"><div class="sh-title">${title}</div><div class="sh-chips">${chips}</div><div class="sh-priv">🏠 ${t('sh_priv')}</div></div>
    <button data-act="guardScan" ${g.busy ? 'disabled' : ''}>↻ ${t('rescan')}</button></div>`;
}

function gdCard(f) {
  const loc = f.path.split(/[\\/]/).slice(0, -1).slice(-2).join(' › ');
  return `<div class="gcard sev-${f.severity}" data-path="${esc(f.path)}"><div class="g-ico"><span>${fileGlyph(f)}</span><i class="g-sev">${f.severity === 'high' ? '!' : '?'}</i></div>
    <div class="g-main"><div class="g-top"><b title="${esc(f.path)}">${esc(f.name)}</b><span class="tag sev-${f.severity}">${t('sev_' + f.severity)}</span></div>
      <div class="g-loc">🖥️ ${esc(loc)}</div>
      <div class="g-redact" title="${esc(t('g_hidden'))}"><div class="bars"><i style="width:${58 + (f.name.length * 7) % 30}%"></i><i style="width:${34 + (f.name.length * 11) % 40}%"></i><i style="width:${46 + (f.name.length * 5) % 36}%"></i></div><span>🙈 ${t('g_hidden')}</span></div>
      <div class="g-why">${f.reasons.map((x) => `<span>${GREASON[x] || '❓'} ${esc(t('g_' + x.replace(':', '_')))}</span>`).join('')}</div></div>
    <div class="g-act"><button class="primary" data-act="toVault" data-path="${esc(f.path)}">🔐 ${t('to_vault')}</button><div class="row" style="gap:6px"><button class="sm" data-act="reveal" data-path="${esc(f.path)}">📂 ${t('reveal')}</button><button class="sm danger" data-act="trashOne" data-path="${esc(f.path)}">🗑️ ${t('trash')}</button></div>
      <button class="sm" data-act="gdIgnore" data-path="${esc(f.path)}" title="${esc(t('g_ignore_tip'))}">✓ ${t('g_ignore')}</button></div></div>`;
}

function gdSafe() {
  const g = state.gd, v = g.vault, st = g.vst || {};
  const open = st.unlocked;
  const status = !st.initialized ? `<span class="vstat none">${t('v_not_set')}</span>` : open ? `<span class="vstat open">🔓 ${t('v_status_open')}</span>` : `<span class="vstat">🔒 ${t('v_status_locked')}</span>`;
  const tools = !st.initialized ? `<button class="sm primary" data-act="vSetupNow">🔐 ${t('v_setup_now')}</button>` : `${open ? `<button class="sm" data-act="vLock">🔒 ${t('v_lock_now')}</button>` : ''}<button class="sm" data-act="vChange">💡 ${t('v_manage')}</button>`;
  return `<div class="safe ${open ? 'is-open' : ''}"><div class="safe-door"><span>${open ? '🔓' : '🔐'}</span><b>${v.length}</b></div>
    <div class="safe-main"><h3>${t('vault')}</h3><div class="vbar">${status}<span class="grow"></span>${tools}</div>
      <div class="sflow"><span class="fstep warn">⚠️ ${t('sf1')}</span><i>➜</i><span class="fstep ok">🔐 ${t('sf2')}</span><i>➜</i><span class="fstep">🗑️ ${t('sf3')}</span></div><p class="muted" style="margin:8px 0 0;font-size:12px">${t('vault_note')}</p></div></div>
    ${v.length ? `<div class="vgrid">${[...v].sort((a, b) => b.added - a.added).map((e) => {
      const legacy = e.v !== 2;
      const from = e.origin ? `<small>${esc(t('v_from', { p: e.origin.split(/[\\/]/).slice(-2, -1)[0] || '' }))}</small>` : '';
      return `<div class="vcard ${legacy ? 'legacy' : ''}" data-id="${e.id}"><div class="v-ico">🔒<i>${esc((e.name.split('.').pop() || '').slice(0, 4))}</i></div><div class="v-main"><b title="${esc(e.name)}">${esc(e.name)}</b><small>${fmtSize(e.size)} · ${fmtDate(e.added)}</small>${from}${legacy ? `<small class="lg-tag">⚠ ${t('v_legacy')}</small>` : ''}</div>
      <div class="v-act">${legacy
        ? `<button class="sm" data-act="vLegacyRestore" data-id="${e.id}" title="${esc(t('v_legacy_restore'))}">↩️ ${t('v_restore')}</button><button class="sm" data-act="vMigrate" data-id="${e.id}" title="${esc(t('v_upgrade_hint'))}">⬆️</button>`
        : `<button class="sm" data-act="vView" data-id="${e.id}">👁️ ${t('v_view')}</button><button class="sm" data-act="vRestore" data-id="${e.id}">↩️ ${t('v_restore')}</button>`}<button class="sm danger" data-act="vRemove" data-id="${e.id}" title="${t('remove')}">✕</button></div></div>`;
    }).join('')}</div>` : `<div class="inbox-empty"><span>🗄️</span><b>${t('vault_empty')}</b></div>`}`;
}

function gdHTML() {
  const g = state.gd;
  let body = '';
  if (g.busy && g.findings === null) body = `<div class="gcard skel"><div class="shimmer" style="height:96px;flex:1"></div></div>`;
  else if (g.findings && g.findings.length) body = `<h2 class="gh">⚠️ ${t('g_found')} <span class="muted">· ${g.findings.length}</span></h2><div class="ggrid">${g.findings.map(gdCard).join('')}</div>`;
  else if (g.findings) body = `<div class="chip" style="border-color:#37d39b;font-size:13.5px">✓ ${t('g_ok_sub')}</div>`;
  const ign = (g.ignored || []).length ? `<details class="ignbox"><summary>🙈 ${t('g_ignored', { n: g.ignored.length })}</summary>${g.ignored.map((f) => `<div class="row" style="margin:4px 0"><span class="grow muted" title="${esc(f.path)}">${esc(f.name)}</span><button class="sm" data-act="gdUnignore" data-path="${esc(f.path)}">${t('g_unignore')}</button></div>`).join('')}</details>` : '';
  return `${gdHero()}${body}${ign}<div style="height:18px"></div>${gdSafe()}`;
}

/* ---------- vault dialogs: set up once, unlock with a hint, recovery key shown once ---------- */
function vaultStrength(p) {
  const s = (p.length >= 8) + (p.length >= 12) + (p.length >= 16) + (/[A-Z]/.test(p) && /[a-z]/.test(p)) + (/\d/.test(p)) + (/[^\w\s]/.test(p));
  return Math.min(4, Math.floor(s * 4 / 6));
}

function vaultSetupFlow() {
  return new Promise((resolve) => {
    openModal(`<div class="dlg vdlg"><h3>🔐 ${t('vs_title')}</h3><p class="muted">${t('vs_sub')}</p>
      <label class="vf">${t('vs_pass')}<input id="vp1" type="password" autocomplete="new-password"></label><div class="strength" id="vstr"><i></i><i></i><i></i><i></i></div>
      <label class="vf">${t('vs_confirm')}<input id="vp2" type="password" autocomplete="new-password"></label>
      <label class="vf">💡 ${t('vs_hint')}<input id="vh" type="text" maxlength="160" placeholder="${esc(t('vs_hint_ph'))}"></label><p class="vwarn">⚠️ ${t('vs_hint_warn')}</p>
      <div id="vmsg" class="vmsg"></div><div class="acts"><button id="vcancel">${t('cancel')}</button><button class="primary" id="vok">${t('vs_next')} ➜</button></div></div>`);
    $('#vp1').focus();
    $('#vp1').oninput = () => { const n = vaultStrength($('#vp1').value); document.querySelectorAll('#vstr i').forEach((el, i) => el.className = i < n ? 'on s' + n : ''); };
    $('#vcancel').onclick = () => { closeModal(); resolve(false); };
    $('#vok').onclick = async () => {
      const p1 = $('#vp1').value, p2 = $('#vp2').value;
      if (p1.length < 8) { $('#vmsg').textContent = t('vs_err_short'); return; }
      if (p1 !== p2) { $('#vmsg').textContent = t('vs_err_match'); return; }
      $('#vok').disabled = true;
      const r = await bridge.invoke('vault:setup', { pass: p1, hint: $('#vh').value.trim() });
      if (r && r.error) { $('#vmsg').textContent = r.error; $('#vok').disabled = false; return; }
      await recoveryDialog(r.recoveryKey);
      resolve(true);
    };
  });
}

function recoveryDialog(key) {
  return new Promise((resolve) => {
    openModal(`<div class="dlg vdlg nodismiss"><h3>🗝️ ${t('rk_title')}</h3><p class="muted">${t('rk_sub')}</p><div class="rkey" id="rkey">${esc(key)}</div>
      <div class="row" style="justify-content:center;margin:8px 0 12px"><button id="rkcopy">📋 ${t('rk_copy')}</button></div>
      <label class="row" style="align-items:flex-start"><input type="checkbox" id="rkok" style="margin-top:4px"> <span>${t('rk_ok')}</span></label>
      <div class="acts"><button class="primary" id="rkdone" disabled>${t('rk_done')}</button></div></div>`);
    $('#rkcopy').onclick = async () => { try { await navigator.clipboard.writeText(key); $('#rkcopy').textContent = '✓ ' + t('rk_copied'); } catch { /* clipboard blocked */ } };
    $('#rkok').onchange = () => { $('#rkdone').disabled = !$('#rkok').checked; };
    $('#rkdone').onclick = () => { closeModal(); resolve(true); };
  });
}

/** Windows Hello reasons come back as plain codes from the PowerShell bridge. */
function helloMsg(code) {
  if (/Cancel|UserPrefersPassword|Timeout|timeout/i.test(code || '')) return t('vh_cancel');
  if (/NotRepeatable/i.test(code || '')) return t('vh_notrep');
  return t('vh_fail');
}

function vaultUnlockFlow(hint, hasHello) {
  return new Promise((resolve) => {
    let mode = 'pass', fails = 0;
    openModal(`<div class="dlg vdlg"><h3>🔓 ${t('vu_title')}</h3><div id="vmsg" class="vmsg"></div>
      <input id="vsec" type="password" placeholder="${esc(t('vu_pass'))}" autocomplete="off">
      <div class="vhint" id="vhint">${hint ? `💡 ${t('vu_hint')}: <b>${esc(hint)}</b>` : `<span class="muted">${t('vu_nohint')}</span>`}</div>
      <a href="#" id="vmode" class="vlink">${t('vu_forgot')}</a>
      <div class="acts">${hasHello ? `<button id="vhello">🪪 ${t('vh_btn')}</button>` : ''}<button id="vcancel">${t('cancel')}</button><button class="primary" id="vok">${t('vu_title')}</button></div></div>`);
    const inp = $('#vsec'); inp.focus();
    const viaHello = async () => {
      const b = $('#vhello'); if (!b || b.disabled) return;
      b.disabled = true; $('#vmsg').textContent = t('vh_wait');
      const r = await bridge.invoke('vault:helloUnlock');
      if (r && r.ok) { closeModal(); resolve(true); return; }
      b.disabled = false; $('#vmsg').textContent = helloMsg(r && r.error); inp.focus();
    };
    if (hasHello) { $('#vhello').onclick = viaHello; viaHello(); } // ask Windows right away; the passphrase stays available
    const submit = async () => {
      if (!inp.value) return;
      $('#vok').disabled = true;
      const r = await bridge.invoke('vault:unlock', { secret: inp.value, mode });
      if (r && r.ok) { closeModal(); resolve(true); return; }
      fails++;
      $('#vok').disabled = false; inp.value = ''; inp.focus();
      $('#vmsg').textContent = (mode === 'recovery' ? t('vu_wrong_rk') : t('vu_wrong', { n: fails })) + (fails >= 2 && mode === 'pass' ? ' — ' + t('vu_try_hint') : '');
      const d = $('.vdlg'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      if (fails >= 2 && mode === 'pass') { $('#vhint').classList.add('pulse'); $('#vmode').classList.add('pulse'); }
    };
    $('#vok').onclick = submit;
    inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { closeModal(); resolve(false); } };
    $('#vcancel').onclick = () => { closeModal(); resolve(false); };
    $('#vmode').onclick = (e) => {
      e.preventDefault();
      mode = mode === 'pass' ? 'recovery' : 'pass';
      inp.type = mode === 'pass' ? 'password' : 'text'; inp.value = ''; inp.placeholder = mode === 'pass' ? t('vu_pass') : t('vu_rk');
      $('#vmode').textContent = mode === 'pass' ? t('vu_forgot') : t('vu_back'); $('#vmsg').textContent = ''; inp.focus();
    };
  });
}

function vaultChangeFlow(hint) {
  return new Promise(async (resolve) => {
    const hi = (await bridge.invoke('vault:helloInfo')) || {};
    openModal(`<div class="dlg vdlg"><h3>💡 ${t('vc_title')}</h3>
      <label class="vf">💡 ${t('vs_hint')}<input id="vh" type="text" maxlength="160" value="${esc(hint || '')}" placeholder="${esc(t('vs_hint_ph'))}"></label><p class="vwarn">⚠️ ${t('vs_hint_warn')}</p>
      <label class="vf">${t('vc_new')}<input id="vp1" type="password" autocomplete="new-password"></label><label class="vf">${t('vs_confirm')}<input id="vp2" type="password" autocomplete="new-password"></label>
      <div class="vf" style="margin-top:10px"><b>🪪 ${t('vh_title')}</b><div class="muted" style="font-size:12px;margin:4px 0">${hi.available || hi.enabled ? t('vh_desc') : t('vh_unavail')}</div>${hi.available || hi.enabled ? `<button class="sm" id="vhsw">${hi.enabled ? '✓ ' + t('vh_is_on') + ' — ' + t('vh_off') : t('vh_on')}</button>` : ''}</div>
      <div id="vmsg" class="vmsg"></div><div class="acts"><button id="vcancel">${t('cancel')}</button><button class="primary" id="vok">${t('confirm')}</button></div></div>`);
    const sw = $('#vhsw');
    if (sw) sw.onclick = async () => {
      sw.disabled = true; $('#vmsg').textContent = hi.enabled ? '' : t('vh_wait');
      const r = await bridge.invoke(hi.enabled ? 'vault:helloDisable' : 'vault:helloEnable');
      if (r && r.error) { sw.disabled = false; $('#vmsg').textContent = helloMsg(r.error); return; }
      closeModal(); toast(hi.enabled ? t('vh_disabled') : t('vh_enabled'), { ms: 4000 }); resolve(true);
    };
    $('#vcancel').onclick = () => { closeModal(); resolve(false); };
    $('#vok').onclick = async () => {
      const p1 = $('#vp1').value, p2 = $('#vp2').value;
      if (p1 && p1.length < 8) { $('#vmsg').textContent = t('vs_err_short'); return; }
      if (p1 !== p2) { $('#vmsg').textContent = t('vs_err_match'); return; }
      const r = await bridge.invoke('vault:setHint', { hint: $('#vh').value.trim(), newPass: p1 || undefined });
      if (r && r.error) { $('#vmsg').textContent = r.error; return; }
      closeModal(); resolve(true);
    };
  });
}

async function vaultEnsureUnlocked() {
  const st = await call('vault:status');
  if (!st) return false;
  if (!st.initialized) { if (!(await vaultSetupFlow())) return false; }
  else if (!st.unlocked) { if (!(await vaultUnlockFlow(st.hint, st.hello))) return false; }
  state.gd.vst = await call('vault:status');
  gdRerender();
  return true;
}

/* ---------- cleanup (visual) ---------- */
const CL = {
  captures: { icon: '📸', color: '#ff7a8a', kind: 'trash' },
  installers: { icon: '💿', color: '#f2c94c', kind: 'trash' },
  dupes: { icon: '👯', color: '#6ea8ff', kind: 'trash', deep: true },
  similar: { icon: '🖼️', color: '#4fd1a5', kind: 'trash', deep: true },
  dead: { icon: '🔗', color: '#ff9f6b', kind: 'trash' },
  unused: { icon: '💤', color: '#b583ff', kind: 'park' },
};
const CL_ORDER = ['captures', 'installers', 'dupes', 'similar', 'dead', 'unused'];
const clInit = () => ({ data: {}, status: {}, sel: new Set(), selUn: new Set(), open: null, done: null, quickDone: false });

/** Normalised, flat list of removable/parkable items for one cleaner. */
function clItems(key) {
  const d = state.cl.data[key];
  if (!d) return [];
  const nm = (p) => String(p).split(/[\\/]/).pop();
  if (key === 'captures' || key === 'installers') return d.map((r) => ({ path: r.path, name: r.name, size: r.size, note: t('days', { n: r.ageDays }) }));
  if (key === 'dead') return d.map((r) => ({ path: r.path, name: r.name.replace(/\.lnk$/i, ''), size: 0, note: nm(r.target || '') }));
  if (key === 'dupes') return d.flatMap((g) => g.files.filter((f) => f.path !== g.keep).map((f) => ({ path: f.path, name: nm(f.path), size: f.size, note: t('dup_of', { n: nm(g.keep) }) })));
  if (key === 'similar') return d.groups.flatMap((g) => g.files.filter((f) => f.path !== g.keep).map((f) => ({ path: f.path, name: nm(f.path), size: f.size, thumb: f.thumb, note: `${g.similarity}% · ${f.w}×${f.h}` })));
  if (key === 'unused') return d.items.filter((i) => i.status === 'old' || i.status === 'never').map((i) => ({ path: i.path, name: i.name.replace(/\.lnk$/i, ''), size: 0, status: i.status, note: i.status === 'old' ? t('last_used', { n: i.ageDays }) : t('never_seen') }));
  return [];
}
const clBytes = (key) => clItems(key).reduce((a, i) => a + (i.size || 0), 0);
/** bytes per cleaner counted once: a file listed by two cleaners (exact duplicate that is also a look-alike) is not double-counted */
function clUniqueBytes() {
  const seen = new Set(), out = {};
  for (const k of ['captures', 'installers', 'dupes', 'similar']) { out[k] = 0; for (const i of clItems(k)) if (!seen.has(i.path)) { seen.add(i.path); out[k] += i.size || 0; } }
  return out;
}
const clTitle = (k) => t('cc_' + k);

function clDefaultSel(key) {
  const items = clItems(key);
  if (key === 'unused') { state.cl.selUn = new Set(items.filter((i) => i.status === 'old').map((i) => i.path)); return; }
  if (key === 'similar') return; // look-alikes are never pre-selected: the user decides
  for (const i of items) state.cl.sel.add(i.path);
}

function renderCleanup() {
  if (!state.cl) state.cl = clInit();
  view(`<h1>${t('cleanup')}</h1><div id="clBox">${clHTML()}</div>`);
  clAfter();
  if (!state.cl.quickDone && !state.cl.quickBusy) ACTS.clQuick();
}

function donutSVG(segs, total) {
  const R = 48, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = segs.map((s) => {
    const len = C * s.size / total, dash = Math.max(0, len - 2);
    const a = `<circle class="seg" r="${R}" cx="60" cy="60" fill="none" stroke="${s.color}" stroke-width="14" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len;
    return a;
  }).join('');
  return `<svg viewBox="0 0 120 120"><circle r="${R}" cx="60" cy="60" fill="none" stroke="var(--line)" stroke-width="14" opacity=".45"/>${arcs}</svg>`;
}

function clHero() {
  const c = state.cl;
  const uniq = clUniqueBytes();
  const segs = CL_ORDER.filter((k) => CL[k].kind === 'trash').map((k) => ({ k, size: uniq[k] || 0, color: CL[k].color })).filter((s) => s.size > 0);
  const total = segs.reduce((a, s) => a + s.size, 0);
  const allDone = CL_ORDER.every((k) => c.status[k] === 'done');
  const anyBusy = CL_ORDER.some((k) => c.status[k] === 'busy');
  const selBytes = [...c.sel].reduce((a, p) => { for (const k of ['captures', 'installers', 'dupes', 'similar']) { const it = clItems(k).find((x) => x.path === p); if (it) return a + (it.size || 0); } return a; }, 0);
  const center = total ? `<b>${fmtSize(total)}</b><small>${t('cl_reclaim')}</small>` : anyBusy || !allDone ? `<span class="spin">⟳</span><small>${t('scanning')}</small>` : `<span style="font-size:34px">✨</span><small>${t('cl_clean')}</small>`;
  const legend = CL_ORDER.filter((k) => CL[k].kind === 'trash').map((k) => {
    const n = clItems(k).length, st = c.status[k];
    return `<div class="lg ${n ? '' : 'off'}"><i style="background:${CL[k].color}"></i><span>${CL[k].icon} ${clTitle(k)}</span><b>${st === 'busy' ? '…' : st === 'done' ? (n ? (uniq[k] ? fmtSize(uniq[k]) : clBytes(k) ? '≈0' : n) : '—') : '·'}</b></div>`;
  }).join('');
  const d = c.done ? `<div class="done"><div class="done-ring">✓</div><div class="grow"><b>${t('cl_done_title')}</b><br><span>${t('cl_done_sub', { n: c.done.n, s: fmtSize(c.done.bytes) })} · ${t('cl_bin')}</span></div><button data-act="clDoneClose">✕</button></div>` : '';
  return `${d}<div class="clhero"><div class="donut ${total ? '' : 'empty'}">${donutSVG(segs, total || 1)}<div class="d-mid">${center}</div></div>
    <div class="cl-side"><div class="cl-legend">${legend}</div>
      <div class="cl-cta"><button class="primary go" id="clGo" data-act="clTrash" ${c.sel.size ? '' : 'disabled'}>🗑️ ${c.sel.size ? t('cl_trash_n', { n: c.sel.size, s: fmtSize(selBytes) }) : t('cl_pick')}</button><span class="muted">${t('cl_hero_sub')}</span></div></div></div>`;
}

function clCards() {
  const c = state.cl;
  return `<div class="ccgrid">${CL_ORDER.map((k) => {
    const m = CL[k], st = c.status[k] || 'idle', items = clItems(k), n = items.length;
    const desc = k === 'captures' ? t('cc_captures_d', { d: cfg.staleDays }) : k === 'installers' ? t('cc_installers_d', { d: cfg.installerDays }) : t('cc_' + k + '_d');
    const prev = items.slice(0, 4).map((i) => `<div class="mt ${i.thumb ? 'has' : ''}" ${i.thumb ? `style="background-image:url('${i.thumb}')"` : `data-thumb="${esc(i.path)}"`}><span>${m.icon}</span></div>`).join('');
    const badge = st === 'busy' ? '<span class="spin">⟳</span>' : st === 'done' ? (n ? `<b>${n}</b>` : '✓') : '';
    const foot = st === 'idle' ? `<button class="sm primary" data-act="clScanKey" data-key="${k}">🔍 ${m.deep ? t('cc_deep') : t('scan')}</button>${m.deep ? `<span class="muted">${t('cc_deep_note')}</span>` : ''}` : st === 'busy' ? `<span class="muted">${t('scanning')}</span>` : n ? `<span class="muted">${k === 'unused' ? '' : fmtSize(clBytes(k))}</span><span class="cc-open">${c.open === k ? '▾' : '▸'} ${t('cc_view')}</span>` : `<span class="ok">✓ ${t('cc_none')}</span>`;
    return `<div class="ccard st-${st} ${c.open === k ? 'open' : ''} ${n ? 'has' : ''}" style="--cc:${m.color}" ${st === 'done' && n ? `data-act="clOpen" data-key="${k}"` : ''}>
      <div class="cc-top"><span class="cc-ico">${m.icon}</span><div class="cc-t"><b>${clTitle(k)}</b><small>${desc}</small></div><span class="cc-badge">${badge}</span></div>
      <div class="cc-prev">${prev || '<div class="mt ghost"></div><div class="mt ghost"></div><div class="mt ghost"></div>'}</div><div class="cc-foot">${foot}</div></div>`;
  }).join('')}</div>`;
}

function clTile(i, selSet, key) {
  const m = CL[key], sel = selSet.has(i.path);
  return `<button class="tile ${sel ? 'sel' : ''}" data-act="clTog" data-key="${key}" data-path="${esc(i.path)}" style="--cc:${m.color}" title="${esc(i.path)}">
    <div class="thumb ${i.thumb ? 'has' : ''}" ${i.thumb ? `style="background-image:url('${i.thumb}')"` : `data-thumb="${esc(i.path)}"`}><span>${m.icon}</span></div>
    <span class="tn">${esc(i.name)}</span><span class="tsub">${i.size ? fmtSize(i.size) + ' · ' : ''}${esc(i.note || '')}</span><i class="tick">✓</i></button>`;
}

function clPanel() {
  const c = state.cl, key = c.open;
  if (!key || c.status[key] !== 'done') return '';
  const m = CL[key], items = clItems(key), selSet = key === 'unused' ? c.selUn : c.sel;
  let body;
  if (key === 'dupes' || key === 'similar') {
    const groups = key === 'dupes' ? c.data.dupes : c.data.similar.groups;
    const nm = (p) => String(p).split(/[\\/]/).pop();
    body = groups.slice(0, 40).map((g) => {
      const keep = g.files.find((f) => f.path === g.keep);
      const keepTile = `<div class="tile left keep" style="--cc:${m.color}" title="${esc(g.keep)}"><div class="thumb ${keep.thumb ? 'has' : ''}" ${keep.thumb ? `style="background-image:url('${keep.thumb}')"` : `data-thumb="${esc(g.keep)}"`}><span>${m.icon}</span></div><span class="tn">${esc(nm(g.keep))}</span><span class="tsub">✔ ${t('keep')}</span></div>`;
      return `<div class="grp">${keepTile}<i class="garr">➜</i><div class="tiles">${items.filter((i) => g.files.some((f) => f.path === i.path)).map((i) => clTile(i, selSet, key)).join('')}</div></div>`;
    }).join('');
  } else body = `<div class="tiles">${items.map((i) => clTile(i, selSet, key)).join('')}</div>`;
  const extra = key === 'unused' ? `<button class="primary sm" data-act="parkUnused" ${c.selUn.size ? '' : 'disabled'}>📦 ${t('park')} (${c.selUn.size})</button>` : '';
  const note = key === 'unused' ? `<p class="muted" style="font-size:12px">${t('unused_note', { n: c.data.unused.history })}</p>` : key === 'similar' ? `<p class="muted" style="font-size:12px">${t('sim_scanned', { n: c.data.similar.scanned })}</p>` : '';
  return `<div class="cpanel" style="--cc:${m.color}"><div class="cp-head"><span class="cc-ico">${m.icon}</span><b>${clTitle(key)}</b><span class="muted">· ${items.length}</span>
    <span class="grow"></span><button class="sm" data-act="clSelAll" data-key="${key}">${t('sel_all')}</button><button class="sm" data-act="clSelNone" data-key="${key}">${t('sel_none')}</button>${extra}</div>${body}${note}</div>`;
}

function clHTML() { return clHero() + clCards() + clPanel(); }

function clAfter() {
  const box = $('#clBox');
  if (!box) return;
  loadThumbs();
}

function clRerender() { const box = $('#clBox'); if (box) { box.innerHTML = clHTML(); clAfter(); } }

function clRefreshSel() {
  const c = state.cl;
  document.querySelectorAll('.cpanel .tile[data-path]').forEach((el) => {
    const set = el.dataset.key === 'unused' ? c.selUn : c.sel;
    el.classList.toggle('sel', set.has(el.dataset.path));
  });
  const go = $('#clGo');
  if (go) { go.disabled = c.sel.size === 0; go.textContent = '🗑️ ' + (c.sel.size ? t('cl_trash_n', { n: c.sel.size, s: fmtSize([...c.sel].reduce((a, p) => { for (const k of ['captures', 'installers', 'dupes', 'similar']) { const it = clItems(k).find((x) => x.path === p); if (it) return a + (it.size || 0); } return a; }, 0)) }) : t('cl_pick')); }
  const pk = document.querySelector('[data-act=parkUnused]');
  if (pk) { pk.disabled = c.selUn.size === 0; pk.textContent = `📦 ${t('park')} (${c.selUn.size})`; }
}

async function clRun(key) {
  const c = state.cl;
  const quick = ['captures', 'installers', 'dead'].includes(key);
  const keys = quick ? ['captures', 'installers', 'dead'] : [key];
  keys.forEach((k) => { c.status[k] = 'busy'; });
  if (state.tab === 'cleanup') clRerender();
  const ch = key === 'dupes' ? 'cleanup:dupes' : key === 'similar' ? 'cleanup:similar' : key === 'unused' ? 'cleanup:unused' : 'cleanup:scan';
  const r = await call(ch);
  const here = () => { if (state.tab === 'cleanup' && state.cl === c) clRerender(); }; // results are kept even if the user left the page meanwhile
  if (!r) { keys.forEach((k) => { c.status[k] = 'idle'; }); here(); return; }
  if (quick) { c.data.captures = r.captures; c.data.installers = r.installers; c.data.dead = r.dead; } else c.data[key] = r;
  keys.forEach((k) => { c.status[k] = 'done'; clDefaultSel(k); });
  here();
}

/* ---------- modes (visual) ---------- */
const MODE_META = { work: ['💼', '#5b8cff'], game: ['🎮', '#ff5a7a'], meeting: ['📹', '#37d39b'], all: ['👁️', '#b583ff'] };
const GCOL = { games: '#ff7a8a', dev: '#4cc9e6', comms: '#4fd1a5', office: '#6ea8ff', creative: '#ff8a5b', system: '#9aa6c4' };
const GICO = { games: '🎮', dev: '💻', comms: '💬', office: '📝', creative: '🎨', system: '🖥️' };
state.md = { items: [], modes: {}, groups: [], sel: null, active: 'all', as: null, loaded: false, open: new Set() };

const mdVisible = (it, mode) => { const show = state.md.modes[mode]; return !it.group || !show || show.includes(it.group); };
function mdDiff(mode) {
  const hide = [], show = [];
  for (const it of state.md.items) { const now = !it.hidden, after = mdVisible(it, mode); if (now && !after) hide.push(it); if (!now && after) show.push(it); }
  return { hide, show };
}

function renderModes() {
  view(`<h1>${t('modes')}</h1><div id="mdBox">${state.md.loaded ? mdHTML() : `<div class="empty">${t('scanning')}</div>`}</div>`);
  if (state.md.loaded) loadThumbs();
  loadModes();
}
async function loadModes() {
  const [ov, as] = await Promise.all([call('mode:overview'), call('autoswitch:get')]);
  if (!ov || state.tab !== 'modes') return;
  Object.assign(state.md, { items: ov.items, modes: ov.modes, groups: ov.groups, active: ov.active, as, loaded: true });
  if (!state.md.sel) state.md.sel = ov.active;
  mdRerender();
}
function mdRerender() { const b = $('#mdBox'); if (b) { b.innerHTML = mdHTML(); loadThumbs(); } }

function mdStage() {
  const m = state.md, mode = m.sel, { hide, show } = mdDiff(mode);
  const hs = new Set(hide.map((i) => i.path)), ss = new Set(show.map((i) => i.path));
  const order = Object.fromEntries(m.groups.map((g, i) => [g, i]));
  const sorted = [...m.items].sort((a, b) => (order[a.group] ?? 99) - (order[b.group] ?? 99) || a.name.localeCompare(b.name));
  const items = sorted.slice(0, 80);
  const nowN = m.items.filter((i) => !i.hidden).length, afterN = m.items.filter((i) => mdVisible(i, mode)).length;
  const tiles = items.map((it) => `<div class="stile ${it.hidden ? 'off' : ''} ${hs.has(it.path) ? 'willhide' : ''} ${ss.has(it.path) ? 'willshow' : ''}" style="--gc:${it.group ? GCOL[it.group] : '#8e9bb8'}" title="${esc(it.name)} — ${it.group ? esc(t('grp_' + it.group)) : esc(t('md_unknown_tip'))}">
      <div class="si ${it.group ? '' : 'unk'}" data-thumb="${esc(it.path)}"><span>${it.group ? GICO[it.group] : '📦'}</span></div><small>${esc(it.name)}</small>${hs.has(it.path) ? '<i class="bx">−</i>' : ss.has(it.path) ? '<i class="bp">＋</i>' : ''}</div>`).join('');
  const act = hide.length || show.length
    ? `<button class="primary go" data-act="mdApply">✓ ${t('md_apply', { h: hide.length, s: show.length })}</button>`
    : `<span class="ok-note">✓ ${t(mode === m.active ? 'md_active_same' : 'md_same')}</span>`;
  return `<div class="stagewrap"><div class="stage"><div class="screen">${tiles || `<div class="empty">${t('md_empty')}</div>`}${m.items.length > 80 ? `<span class="muted">+${m.items.length - 80}</span>` : ''}</div><div class="stand"></div></div>
    <div class="stage-side"><div class="stage-cap"><span>${t('md_now', { n: nowN })}</span><i>➜</i><b>${t('md_after', { n: afterN })}</b></div>
      <div class="stage-key"><span class="k off">${t('md_k_hidden')}</span><span class="k wh">${t('md_k_hide')}</span><span class="k ws">${t('md_k_show')}</span></div>${act}</div></div>`;
}

function mdCards() {
  const m = state.md;
  return `<div class="mgrid">${Object.keys(MODE_META).map((k) => {
    const [ico, col] = MODE_META[k], show = m.modes[k] || [];
    return `<button class="mcard ${m.sel === k ? 'sel' : ''}" style="--mc:${col}" data-act="mdPick" data-mode="${k}"><div class="m-ico">${ico}</div><b>${t('m_' + k)}</b><small>${t('m_' + k + '_d')}</small>
      <div class="m-groups">${show.map((g) => `<i style="background:${GCOL[g]}" title="${esc(t('grp_' + g))}">${GICO[g]}</i>`).join('')}</div>${m.active === k ? `<span class="m-badge">${t('mode_active')}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

function mdLegend() {
  const m = state.md, cnt = {};
  let unk = 0;
  for (const it of m.items) it.group ? (cnt[it.group] = (cnt[it.group] || 0) + 1) : unk++;
  return `<div class="legend2">${m.groups.filter((g) => cnt[g]).map((g) => `<span class="lchip" style="--gc:${GCOL[g]}"><i>${GICO[g]}</i>${t('grp_' + g)} <b>${cnt[g]}</b></span>`).join('')}${unk ? `<span class="lchip" style="--gc:#8e9bb8"><i>📦</i>${t('md_unknown', { n: unk })}</span>` : ''}</div>`;
}

const asDays = () => t('days_short').split('|');
const tmPct = (s) => { const [h, mi] = String(s).split(':').map(Number); return (((h || 0) * 60 + (mi || 0)) / 1440) * 100; };

function mdAuto() {
  const r = state.md.as;
  if (!r) return '';
  const a = r.cfg, d = r.decision, s0 = a.schedule[0], sched = s0 || { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
  const decision = !a.enabled ? '' : d ? `<div class="as-now"><span>🤖 ${t('as_now')}</span><b>${MODE_META[d.mode][0]} ${t('m_' + d.mode)}</b><em>${d.reason === 'process' || d.reason === 'process-weak' ? t('why_process', { v: esc(d.detail) }) : d.reason === 'schedule' ? t('why_schedule', { v: esc(d.detail) }) : t('why_none')}${r.holdMin ? ` · ⏸ ${t('as_hold', { n: r.holdMin })}` : ''}</em></div>` : `<div class="as-now"><span>${t('scanning')}</span></div>`;
  const chips = (kind) => { const list = a.processes[kind], open = state.md.open.has(kind), shown = open ? list : list.slice(0, 6); return `<div class="pchips">${shown.map((p) => `<span class="pchip">${esc(p)}<button data-act="asDel" data-kind="${kind}" data-v="${esc(p)}">✕</button></span>`).join('')}${list.length > 6 ? `<button class="pmore" data-act="asMore" data-kind="${kind}">${open ? '▴' : `+${list.length - 6} ▾`}</button>` : ''}<input class="padd" data-kind="${kind}" placeholder="${esc(t('as_add_ph'))}" autocomplete="off"></div>`; };
  const f = tmPct(sched.from), e = tmPct(sched.to), segs = f <= e ? [[f, e - f]] : [[f, 100 - f], [0, e]];
  return `<div class="card asv ${a.enabled ? 'on' : ''}"><div class="as-head"><div class="as-ico">🤖</div><div class="grow"><h3 style="margin:0">${t('as_title')}</h3><p class="muted" style="margin:2px 0 0;font-size:12.5px">${t('as_sub')}</p></div>
      <button class="switch big ${a.enabled ? 'on' : ''}" data-act="asTog"><i></i></button></div>${decision}
    <div class="as-grid"><div class="as-tile"><div class="as-t">🎮 <b>${t('as_game_t')}</b><small>${t('as_game_d')}</small></div>${chips('game')}</div>
      <div class="as-tile"><div class="as-t">📹 <b>${t('as_meeting_t')}</b><small>${t('as_meeting_d')}</small></div>${chips('meeting')}</div>
      <div class="as-tile wide"><div class="as-t">💼 <b>${t('as_sched')}</b><small>${t('as_sched_d')}</small><button class="switch sm ${s0 ? 'on' : ''}" data-act="asSched" style="margin-left:auto"><i></i></button></div>
        <div class="as-sched ${s0 ? '' : 'dim'}"><div class="dpills">${asDays().map((l, i) => `<button class="dpill ${(sched.days || []).includes(i + 1) ? 'on' : ''}" data-act="asDay" data-d="${i + 1}">${esc(l)}</button>`).join('')}</div>
          <div class="trow"><input type="time" class="tin" data-chg="astime" data-w="from" value="${esc(sched.from)}"><i>➜</i><input type="time" class="tin" data-chg="astime" data-w="to" value="${esc(sched.to)}"></div>
          <div class="tbar">${segs.map(([l, w]) => `<i style="left:${l}%;width:${w}%"></i>`).join('')}<span style="left:0">0</span><span style="left:25%">6</span><span style="left:50%">12</span><span style="left:75%">18</span><span style="left:100%">24</span></div></div></div></div></div>`;
}

function mdHTML() {
  return `${mdCards()}<div class="card stagecard"><h3>🖥️ ${t('md_stage')} <span class="muted">· ${t('md_hint')}</span></h3>${mdStage()}${mdLegend()}</div>${mdAuto()}`;
}

async function asSave(patch) {
  const cur = JSON.parse(JSON.stringify(state.md.as.cfg));
  patch(cur);
  const r = await call('autoswitch:set', cur);
  if (!r) return;
  state.md.as = await call('autoswitch:get');
  mdRerender();
}
const asSched0 = (cur) => { if (!cur.schedule.length) cur.schedule.push({ mode: 'work', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }); return cur.schedule[0]; };
function asAdd(input) {
  let v = input.value.trim().toLowerCase();
  if (!v) return;
  if (!/\.\w{2,4}$/.test(v)) v += '.exe';
  asSave((cur) => { if (!cur.processes[input.dataset.kind].includes(v)) cur.processes[input.dataset.kind].push(v); });
}
function asTime(el) { asSave((cur) => { asSched0(cur)[el.dataset.w] = el.value || '09:00'; }); }

async function modeFlow(m) {
  // command-bar entry point: open the page with that mode previewed on the stage
  state.md.sel = m;
  go('modes');
  toast(t('md_preview_toast'), { ms: 5000 });
}

/* ---------- wallpaper-aware icon layout (visual) ---------- */
const lay = { mode: 'wallpaper', plan: null, level: 30, sort: 'current', dir: 'asc', mask: true, img: null, anim: null, busy: false, backup: { has: false, time: 0 }, done: null, error: null, prev: null };
const LAY_SORTS = [['current', '📌', 'lay_sort_cur'], ['name', '🔤', 'lay_sort_name'], ['size', '📏', 'lay_sort_size'], ['type', '🧩', 'lay_sort_type'], ['date', '🕒', 'lay_sort_date']];
const LAY_LEVELS = [[15, '🌤️', 'lay_l1', 'lay_l1_d'], [30, '⚖️', 'lay_l2', 'lay_l2_d'], [50, '🛡️', 'lay_l3', 'lay_l3_d']];

const layVariant = () => { const p = lay.plan; if (!p || !p.plans) return p; const e = p.plans[lay.level] || p.plans[30]; return e.by[e.best]; };
const layNowIcons = () => {
  const p = lay.plan;
  return p.current.map((i) => ({ name: i.name, x: i.x - p.origin.x, y: i.y - p.origin.y })).filter((i) => i.x > -p.cell.w && i.x < p.screen.w && i.y > -p.cell.h && i.y < p.screen.h);
};

/** Share of the icon's cell that sits on the protected (busy) part of the wallpaper. Same rule the planner uses. */
function layBusyFrac(x, y, v) {
  const p = lay.plan, g = v.grid;
  const x0 = Math.max(0, Math.floor(x / p.screen.w * g.cols)), x1 = Math.min(g.cols - 1, Math.max(x0, Math.floor((x + p.cell.w - 1) / p.screen.w * g.cols)));
  const y0 = Math.max(0, Math.floor(y / p.screen.h * g.rows)), y1 = Math.min(g.rows - 1, Math.max(y0, Math.floor((y + p.cell.h - 1) / p.screen.h * g.rows)));
  let tot = 0, hit = 0;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { tot++; hit += g.mask[yy * g.cols + xx]; }
  return tot ? hit / tot : 0;
}
const layHit = (x, y, v) => layBusyFrac(x, y, v) > 0.3;

function renderLayout() {
  view(`<div class="org-head"><div><h1>${t('layout')}</h1></div><div class="org-opts"><button data-act="layPlan" ${lay.busy ? 'disabled' : ''}>↻ ${t('lay_recheck_short')}</button></div></div><div id="layBox">${layHTML()}</div>`);
  call('layout:hasBackup').then((b) => { if (b && state.tab === 'layout') { lay.backup = b; const box = $('#layBox'); if (box && lay.plan && !lay.busy) { box.innerHTML = layHTML(); layDraw(false); } } });
  if (lay.plan && !lay.busy) layDraw(false); else if (!lay.busy) ACTS.layPlan();
}

function layoutMessage(code) {
  return ({ 'no-listview': t('lay_err_listview'), nowallpaper: t('lay_err_wallpaper'), autoarrange: t('lay_err_auto'), nobackup: t('lay_err_nobackup') })[code] || code;
}

function layStepper() {
  const mock = (cls, inner) => `<div class="lmock ${cls}">${inner}</div>`;
  const m1 = `<i class="cur">🖱️</i><span>⋯</span><div class="ctx"><b>${t('lay_m_view')}</b><b>${t('lay_m_sort')}</b><b>${t('lay_m_new')}</b></div>`;
  const m2 = `<div class="ctx"><b class="hot">${t('lay_m_view')} ▸</b><b>${t('lay_m_sort')}</b></div><div class="ctx sub"><b>${t('lay_m_icons')}</b><b class="chk">✓ ${t('lay_m_auto')}</b><b>${t('lay_m_grid')}</b></div>`;
  const m3 = `<div class="ctx sub"><b>${t('lay_m_icons')}</b><b class="hot">${t('lay_m_auto')}</b><b>${t('lay_m_grid')}</b></div><u>✓ ➜ ☐</u>`;
  return `<div class="card lblock"><h3>⚠️ ${t('lay_auto_on')}</h3><div class="lsteps">
    <div class="lstep"><span class="rb-n">1</span>${mock('m1', m1)}<p>${t('lay_s1')}</p></div><i class="parr">➜</i>
    <div class="lstep"><span class="rb-n">2</span>${mock('m2', m2)}<p>${t('lay_s2')}</p></div><i class="parr">➜</i>
    <div class="lstep"><span class="rb-n">3</span>${mock('m3', m3)}<p>${t('lay_s3')}</p></div></div>
    <div style="margin-top:12px"><button class="primary" data-act="layPlan">✅ ${t('lay_recheck')}</button></div></div>`;
}

/** Two big choices at the top: arrange around the picture, or the normal tidy grid. */
function layModeBar() {
  const m = (id, ico, k) => `<button class="mcard ${lay.mode === id ? 'sel' : ''}" data-act="layMode" data-v="${id}" ${lay.busy ? 'disabled' : ''}><span class="mc-ico">${ico}</span><b>${t(k)}</b><small>${t(k + '_d')}</small></button>`;
  return `<h2 class="gh">🧭 ${t('lay_mode_title')}</h2><div class="mgrid lvgrid lay-modes">${m('wallpaper', '🖼️', 'lay_mode_wp')}${m('plain', '📐', 'lay_mode_plain')}</div>`;
}

function layHTML() {
  if (lay.busy && !lay.plan) return `<div class="lay-skel"><div class="spin">⟳</div><b>${t('lay_analyzing')}</b><div class="lay-steps"><span>🖼️ ${t('lay_a1')}</span><span>🧠 ${t('lay_a2')}</span><span>🧩 ${t('lay_a3')}</span></div></div>`;
  if (lay.error) return `${layModeBar()}<div class="card bad"><h3>😕 ${esc(layoutMessage(lay.error))}</h3><button data-act="layPlan">↻ ${t('lay_recheck_short')}</button>${lay.error === 'nowallpaper' && lay.mode !== 'plain' ? ` <button class="primary" data-act="layMode" data-v="plain">📐 ${t('lay_mode_plain_use')}</button>` : ''}</div>`;
  const p = lay.plan;
  if (!p) return '';
  const v = layVariant();
  const now = layNowIcons(), nowHits = now.filter((i) => layHit(i.x, i.y, v)).length, afterHits = v.icons.filter((i) => layHit(i.x, i.y, v)).length;
  const done = lay.done ? `<div class="done"><div class="done-ring">✓</div><div class="grow"><b>${t('lay_done_t', { n: lay.done.n })}</b><br><span>${t('lay_done_s')}</span></div><button data-act="layDoneClose">✕</button></div>` : '';
  const chips = `<div class="lchips">${p.mode === 'plain' || !p.wallpaper.source ? '' : `<span class="gchip">🖼️ ${esc(p.wallpaper.source)} · ${esc(p.wallpaper.mode)}</span>`}<span class="gchip">🖥️ ${p.screen.w}×${p.screen.h}${p.displays > 1 ? ' · ' + t('lay_multi_s', { n: p.displays }) : ''}</span><span class="gchip">🧷 ${p.count} ${t('lay_icons')}</span></div>`;
  const levels = `<div class="mgrid lvgrid">${LAY_LEVELS.map(([pct, ico, k, kd]) => { const vv = p.plans ? p.plans[pct].by[p.plans[pct].best] : v; const busyPct = Math.round(100 * vv.grid.mask.reduce((a, b) => a + b, 0) / vv.grid.mask.length); return `<button class="mcard ${lay.level === pct ? 'sel' : ''}" style="--mc:#ff5a6e" data-act="layLevel" data-v="${pct}"><div class="m-ico">${ico}</div><b>${t(k)}</b><small>${t(kd)}</small><div class="lv-meter"><i style="width:${Math.min(100, busyPct * 1.6)}%"></i></div><small>${t('lay_free', { f: vv.freeCells, n: vv.totalCells })}</small></button>`; }).join('')}</div>`;
  const sorts = `<div class="lchips">${LAY_SORTS.map(([k, ico, tk]) => `<button class="gchip ${lay.sort === k ? 'sel' : ''}" data-act="laySort" data-v="${k}" ${lay.busy ? 'disabled' : ''}>${ico} ${t(tk)}${lay.sort === k && k !== 'current' ? (lay.dir === 'desc' ? ' ▼' : ' ▲') : ''}</button>`).join('')}</div><p class="muted" style="font-size:12px;margin:4px 0 0">${t('lay_sort_hint')}</p>`;
  return `${layModeBar()}${done}${chips}${p.autoArrange ? layStepper() : ''}
    <div class="lcompare"><div class="lframe"><div class="lf-title"><b>${t('lay_now')}</b>${lay.mode === 'plain' ? '' : `<span class="lf-badge ${nowHits ? 'bad' : 'ok'}" id="layNowBadge">${nowHits ? t('lay_cover', { n: nowHits }) : t('lay_cover0')}</span>`}</div><canvas id="layNow"></canvas></div>
      <div class="lf-arrow">➜</div>
      <div class="lframe"><div class="lf-title"><b>${t('lay_after')}</b>${lay.mode === 'plain' ? '' : `<span class="lf-badge ${afterHits ? 'bad' : 'ok'}" id="layAfterBadge">${afterHits ? t('lay_cover', { n: afterHits }) : t('lay_cover0')}</span>`}</div><canvas id="layAfter"></canvas></div></div>
    <div class="lsum" ${lay.mode === 'plain' ? 'hidden' : ''}><span>${t('lay_summary')}</span><b class="${nowHits ? 'bad' : 'ok'}">${nowHits}</b><i>➜</i><b class="${afterHits ? 'bad' : 'ok'}">${afterHits}</b>
      ${lay.mode === 'plain' ? '' : `<label class="pill" style="margin-left:auto"><input type="checkbox" data-chg="laymask" ${lay.mask ? 'checked' : ''}><span>👁️ ${t('lay_zone')}</span></label>`}</div>
    <h2 class="gh">↕️ ${t('lay_sort')}</h2>${sorts}
    ${lay.mode === 'plain' ? '' : `<h2 class="gh">🎚️ ${t('lay_protect')}</h2>${levels}`}
    <div class="lactions"><button class="primary go" data-act="layApply" ${p.autoArrange ? 'disabled' : ''}>🪄 ${t('lay_apply')}</button>
      <button data-act="layRestore" ${lay.backup.has ? '' : 'disabled'}>↩ ${t('lay_restore_t')}${lay.backup.has ? ` <small class="muted">· ${t('lay_restore_when', { t: fmtDate(lay.backup.time) })}</small>` : ''}</button>
      <span class="muted" style="font-size:12px">${t('lay_safe_note')}</span></div>`;
}

function layPaint(cv, items, v, withMask) {
  const p = lay.plan, W = 560, H = Math.round(W * p.screen.h / p.screen.w);
  if (cv.width !== W) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  if (lay.img) g.drawImage(lay.img, 0, 0, W, H);
  else { const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#2a3a5e'); bg.addColorStop(1, '#141b30'); g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  if (withMask && lay.mode !== 'plain') {
    const cw = W / v.grid.cols, ch = H / v.grid.rows;
    g.fillStyle = 'rgba(255,70,100,.30)';
    v.grid.mask.forEach((m, i) => { if (m) g.fillRect((i % v.grid.cols) * cw, Math.floor(i / v.grid.cols) * ch, cw + 0.6, ch + 0.6); });
  }
  const k = W / p.screen.w, s = p.cell.w * 0.5 * k;
  for (const it of items) {
    const hit = layHit(it.x, it.y, v), x = it.x * k + (p.cell.w * k - s) / 2, y = it.y * k + p.cell.h * 0.08 * k;
    g.fillStyle = hit ? 'rgba(255,90,110,.96)' : 'rgba(126,224,184,.96)';
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, s, s, 4); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + s * 0.12, y + s + 3, s * 0.76, 2.2); // the icon's text label
  }
}

function layDraw(animate) {
  const p = lay.plan, v = layVariant(), now = $('#layNow'), after = $('#layAfter');
  if (!p || !now || !after) return;
  const draw = () => {
    layPaint(now, layNowIcons(), v, lay.mask);
    const apply = (list) => layPaint(after, list, v, lay.mask);
    return apply;
  };
  const doAfter = draw();
  cancelAnimationFrame(lay.anim);
  const finish = () => { doAfter(v.icons); const hits = v.icons.filter((i) => layHit(i.x, i.y, v)).length; const b = $('#layAfterBadge'); if (b) { b.textContent = hits ? t('lay_cover', { n: hits }) : t('lay_cover0'); b.className = 'lf-badge ' + (hits ? 'bad' : 'ok'); } };
  if (!animate) return finish();
  // icons glide from where they are now to where they will be
  const from = new Map((lay.prev || layNowIcons()).map((i) => [i.name, i])), to = v.icons, t0 = performance.now(), D = 800;
  const step = (now2) => {
    const e = Math.min(1, (now2 - t0) / D), q = 1 - Math.pow(1 - e, 3);
    doAfter(to.map((i) => { const a = from.get(i.name) || i; return { name: i.name, x: a.x + (i.x - a.x) * q, y: a.y + (i.y - a.y) * q }; }));
    if (e < 1) lay.anim = requestAnimationFrame(step); else finish();
  };
  lay.anim = requestAnimationFrame(step);
}

function layRefresh(animate) {
  const box = $('#layBox'); if (!box) return;
  box.innerHTML = layHTML();
  layDraw(animate);
}

/* ---------- search (visual) ---------- */
const FILE_GROUPS = {
  docs: ['📄', ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'html']],
  images: ['🖼️', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'psd', 'ai']],
  sheets: ['📊', ['xls', 'xlsx', 'xlsm', 'csv', 'ods', 'tsv']],
  slides: ['📽️', ['ppt', 'pptx', 'key', 'odp']],
  media: ['🎬', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'mp3', 'wav', 'flac', 'm4a']],
  code: ['💻', ['js', 'ts', 'py', 'java', 'cs', 'cpp', 'go', 'rs', 'php', 'css', 'json', 'sql', 'sh', 'ps1', 'yml', 'yaml', 'xml']],
  archives: ['🗜️', ['zip', 'rar', '7z', 'tar', 'gz', 'iso']],
};
const extGroup = (ext) => Object.keys(FILE_GROUPS).find((g) => FILE_GROUPS[g][1].includes(ext)) || 'other';
const extIcon = (ext) => (FILE_GROUPS[extGroup(ext)] || ['📦'])[0];
state.sr = { q: '', data: null, filter: null, busy: false, ms: 0 };
let searchTimer;

/** Highlight the typed terms; split Thai segments only where the whole term is absent from this text. */
function hl(text, d) {
  const lower = String(text).toLowerCase();
  const whole = (d.terms || []).filter((x) => lower.includes(x));
  const words = whole.length ? whole : d.words;
  const ws = [...new Set((words || []).filter(Boolean))].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!ws.length) return esc(text);
  return String(text).split(new RegExp('(' + ws.join('|') + ')', 'iu')).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}

function renderSearch() {
  if (state.searchQ) { state.sr.q = state.searchQ; state.searchQ = ''; }
  const dates = t('sd_list').split('|');
  view(`<h1>${t('search')}</h1>
    <div class="sbox"><span class="s-ico">🔎</span><input type="text" id="q" placeholder="${esc(t('sr_ph'))}" value="${esc(state.sr.q)}" autocomplete="off"><button class="s-clear" data-act="sClear" ${state.sr.q ? '' : 'hidden'}>✕</button></div>
    <div class="sdate"><span class="muted">🗓️ ${t('sr_when')}</span>${dates.map((d) => `<button class="dchip ${state.sr.q.includes(d) ? 'on' : ''}" data-act="sDate" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
    <div id="srBody">${srBodyHTML()}</div>`);
  $('#q').focus();
  if (state.sr.q) runSearch(); else call('search:query', ' ').then((r) => { if (r && state.tab === 'search' && !state.sr.q) { state.sr.idx = r; const b = $('#srBody'); if (b) b.innerHTML = srBodyHTML(); } }); // warm the index
}

function srEmpty() {
  const ex = t('sr_examples').split('|');
  const idx = state.sr.idx;
  return `<div class="sempty"><div class="s-big">🔭</div><h2>${t('sr_empty_t')}</h2><div class="sex">${ex.map((e) => `<button class="exchip" data-act="sExample" data-v="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <div class="stips"><div><b>🔤 ${t('sr_tip1_t')}</b><small>${t('sr_tip1')}</small></div><div><b>📝 ${t('sr_tip2_t')}</b><small>${t('sr_tip2')}</small></div><div><b>🗓️ ${t('sr_tip3_t')}</b><small>${t('sr_tip3')}</small></div></div>
    <p class="muted" style="font-size:12px">${idx ? t('sr_indexed', { n: idx.indexed }) : t('scanning')} <button class="sm" data-act="reindex">↻ ${t('reindex')}</button></p></div>`;
}

function srBodyHTML() {
  const sr = state.sr, d = sr.data;
  if (sr.busy && !d) return `<div class="rlist">${'<div class="rcard skel"><div class="shimmer" style="height:74px;flex:1"></div></div>'.repeat(4)}</div>`;
  if (!sr.q.trim()) return srEmpty();
  if (!d) return '';
  if (!d.results.length) return `<div class="sempty"><div class="s-big">🫥</div><h2>${t('sr_none_t')}</h2><p class="muted">${t('sr_none')}</p><button data-act="reindex">↻ ${t('reindex')}</button></div>`;
  const counts = {};
  for (const r of d.results) { const g = extGroup(r.ext); counts[g] = (counts[g] || 0) + 1; }
  const list = sr.filter ? d.results.filter((r) => extGroup(r.ext) === sr.filter) : d.results;
  const top = Math.max(...d.results.map((r) => r.score), 1);
  const chips = Object.keys(counts).map((g) => `<button class="tchip ${sr.filter === g ? 'on' : ''}" data-act="sFilter" data-g="${g}">${(FILE_GROUPS[g] || ['📦'])[0]} ${t('sg_' + g)} <b>${counts[g]}</b></button>`).join('');
  return `<div class="srbar"><span><b>${d.total}</b> ${t('sr_found')} · ${sr.ms} ms</span><span class="grow"></span><span class="tchips">${chips}</span></div>
    <div class="rlist">${list.map((r) => {
      const folder = r.path.split(/[\\/]/).slice(0, -1).slice(-2).join(' › ');
      const why = [r.hit.name ? `<span>🔤 ${t('sr_w_name')}</span>` : '', r.hit.content ? `<span>📝 ${t('sr_w_content')}</span>` : '', r.hit.path && !r.hit.name ? `<span>📁 ${t('sr_w_folder')}</span>` : ''].join('');
      return `<div class="rcard" data-act="rOpen" data-path="${esc(r.path)}" title="${esc(r.path)}"><div class="thumb r" data-thumb="${esc(r.path)}"><span>${extIcon(r.ext)}</span></div>
        <div class="r-main"><div class="r-name">${hl(r.name, d)}</div><div class="r-path">🖥️ ${esc(folder)}</div>${r.snippet ? `<div class="r-snip">“${hl(r.snippet, d)}”</div>` : ''}<div class="r-why">${why}</div></div>
        <div class="r-side"><span class="r-size">${fmtSize(r.size)}</span><span class="r-date">${agoText(r.mtime)}</span>${d.words.length ? `<div class="r-bar" title="${t('sr_rel')}"><i style="width:${Math.round(100 * r.score / top)}%"></i></div>` : ''}
          <div class="r-act"><button class="sm" data-act="rOpen" data-path="${esc(r.path)}">▶ ${t('sr_open')}</button><button class="sm" data-act="reveal" data-path="${esc(r.path)}" title="${t('reveal')}">📂</button><button class="sm" data-act="rCopy" data-path="${esc(r.path)}" title="${t('sr_copy')}">📋</button></div></div></div>`;
    }).join('')}</div>${d.total > d.results.length ? `<p class="muted" style="text-align:center">${t('sr_more', { n: d.total - d.results.length })}</p>` : ''}`;
}

async function runSearch() {
  const q = ($('#q')?.value || '').trim();
  state.sr.q = q;
  const clr = document.querySelector('.s-clear'); if (clr) clr.hidden = !q;
  document.querySelectorAll('.dchip').forEach((c) => c.classList.toggle('on', !!q && q.includes(c.dataset.v)));
  if (!q) { state.sr.data = null; state.sr.filter = null; const b = $('#srBody'); if (b) b.innerHTML = srBodyHTML(); return; }
  state.sr.busy = true;
  if (!state.sr.data) { const b = $('#srBody'); if (b) b.innerHTML = srBodyHTML(); }
  const t0 = performance.now();
  const r = await call('search:query', q);
  state.sr.busy = false;
  if (!r || state.tab !== 'search' || state.sr.q !== q) return;
  state.sr.data = r; state.sr.idx = r; state.sr.ms = Math.round(performance.now() - t0);
  if (state.sr.filter && !r.results.some((x) => extGroup(x.ext) === state.sr.filter)) state.sr.filter = null;
  const b = $('#srBody'); if (b) { b.innerHTML = srBodyHTML(); loadThumbs(); }
}

/* ---------- history (visual time machine) ---------- */
state.hs = { day: null, batches: [], snaps: [], diff: null, diffDate: null };
const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function batchMeta(b) {
  if (b.kind === 'mode') return ['🖥️', t('h_mode') + ' · ' + String(b.label).replace(/^Mode:\s*/i, '')];
  const m = { Auto: ['⚡', t('h_auto')], Organize: ['🗂️', t('h_org')], Inbox: ['📥', t('h_inbox')], 'Drop pad': ['🧲', t('h_drop')], 'Unused apps': ['💤', t('h_unused')] }[b.label];
  return m || ['🧹', b.label];
}

async function renderHistory() {
  view(`<h1>${t('history')}</h1><div id="hsBox"><div class="empty">${t('scanning')}</div></div>`);
  const [batches, snaps] = await Promise.all([call('journal:list'), call('snap:list')]);
  if (state.tab !== 'history') return;
  state.hs.batches = batches || []; state.hs.snaps = snaps || [];
  hsRerender();
  if (state.hs.day && state.hs.snaps.includes(state.hs.day)) hsLoadDiff(state.hs.day);
}
function hsRerender() { const b = $('#hsBox'); if (b) b.innerHTML = hsHTML(); }

function hsDays(n = 21) {
  const days = [], now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getTime() - i * 864e5); days.push({ key: dayKeyOf(d.getTime()), d }); }
  return days;
}

function hsStrip() {
  const hs = state.hs, days = hsDays(), count = {};
  for (const b of hs.batches) if (!b.undone && b.kind === 'organize') count[dayKeyOf(b.time)] = (count[dayKeyOf(b.time)] || 0) + b.count;
  const max = Math.max(1, ...Object.values(count));
  const totalFiles = days.reduce((a, x) => a + (count[x.key] || 0), 0);
  const totalBatches = hs.batches.filter((b) => !b.undone && b.kind === 'organize' && days.some((x) => x.key === dayKeyOf(b.time))).length;
  const cols = days.map((x, i) => {
    const n = count[x.key] || 0, has = hs.snaps.includes(x.key), mo = x.d.getDate() === 1 || i === 0;
    return `<button class="tday ${hs.day === x.key ? 'sel' : ''} ${n ? 'act' : ''}" data-act="tmDay" data-date="${x.key}" title="${esc(x.key)} · ${t('h_files', { n })}">
      <span class="tcnt">${n || ''}</span><span class="tbarw"><i style="height:${n ? Math.max(8, Math.round(100 * n / max)) : 3}%"></i></span><em>${x.d.getDate()}</em>${has ? '<b class="tsnap">📸</b>' : '<b class="tsnap off"></b>'}${mo ? `<small>${x.d.toLocaleDateString(cfg.lang === 'th' ? 'th-TH' : 'en-GB', { month: 'short' })}</small>` : '<small></small>'}</button>`;
  }).join('');
  return `<div class="card tm"><div class="tm-head"><h3>⏳ ${t('tm_title')}</h3><span class="muted">${t('tm_days_sum', { d: 21, b: totalBatches, n: totalFiles })}</span><span class="grow"></span>${hs.day ? `<button class="sm" data-act="tmDay" data-date="${hs.day}">✕ ${t('tm_all')}</button>` : ''}<button class="primary sm" data-act="snapNow">📸 ${t('tm_snap')}</button></div>
    <div class="tm-strip">${cols}</div><div class="tm-legend"><span><i class="lg1"></i>${t('tm_leg_act')}</span><span>📸 ${t('tm_snap_marker')}</span></div></div>`;
}

function hsDiffPanel() {
  const hs = state.hs;
  if (!hs.day) return '';
  if (!hs.snaps.includes(hs.day)) return `<div class="card diffp"><div class="muted">📸 ${t('tm_no_snap')}</div></div>`;
  if (!hs.diff || hs.diffDate !== hs.day) return `<div class="card diffp"><div class="empty">${t('scanning')}</div></div>`;
  const tile = (n, cls) => { const ext = (n.split('.').pop() || '').toLowerCase(); return `<div class="dtile ${cls}" title="${esc(n)}"><span>${extIcon(ext)}</span><small>${esc(n)}</small></div>`; };
  const folders = hs.diff.map((x) => `<div class="dfold"><div class="dfold-h">📁 ${esc(x.folder.split(/[\\/]/).pop())} <span class="muted">${esc(x.folder)}</span></div>
      ${!x.missing.length && !x.added.length ? `<div class="ok-note">${t('tm_same')}</div>` : `${x.missing.length ? `<div class="dsec"><b class="dm">− ${t('tm_missing', { n: x.missing.length })}</b><div class="dtiles">${x.missing.slice(0, 40).map((n) => tile(n, 'miss')).join('')}</div></div>` : ''}${x.added.length ? `<div class="dsec"><b class="da">＋ ${t('tm_added', { n: x.added.length })}</b><div class="dtiles">${x.added.slice(0, 40).map((n) => tile(n, 'add')).join('')}</div></div>` : ''}`}</div>`).join('');
  const anyMissing = hs.diff.some((x) => x.missing.length);
  return `<div class="card diffp"><div class="tm-head"><h3>📸 ${t('tm_then')} ${esc(hs.day)} <span class="muted">➜ ${t('tm_now')}</span></h3><span class="grow"></span>${anyMissing ? `<button class="primary sm" data-act="snapRestore" data-date="${hs.day}">↩ ${t('tm_restore')}</button>` : ''}</div>${folders}</div>`;
}

function hsTimeline() {
  const hs = state.hs;
  let list = hs.batches;
  if (hs.day) list = list.filter((b) => dayKeyOf(b.time) === hs.day);
  if (!list.length) return `<div class="card"><div class="inbox-empty"><span>🕰️</span><b>${hs.day ? t('tm_day_empty') : t('tl_empty')}</b></div></div>`;
  const today = dayKeyOf(Date.now()), yest = dayKeyOf(Date.now() - 864e5);
  const groups = new Map();
  for (const b of list) { const k = dayKeyOf(b.time); (groups.get(k) || groups.set(k, []).get(k)).push(b); }
  return `<div class="card"><h3>🕘 ${t('batches')}</h3><div class="tl">${[...groups.entries()].map(([k, arr]) => `<div class="tl-day">${k === today ? t('today') : k === yest ? t('yesterday') : esc(k)}</div>${arr.map((b) => {
    const [ico, name] = batchMeta(b);
    return `<div class="tl-row ${b.undone ? 'undone' : ''}"><i class="tl-dot"></i><div class="tl-time"><b>${timeShort(b.time)}</b><small>${agoText(b.time)}</small></div>
      <div class="tl-body"><span class="hbadge">${ico} ${esc(name)} · ${t('h_files', { n: b.count })}</span>${(b.moves || []).map((f) => { const [c, ic] = catStyle(f.category || ''); return `<span class="fchip" style="--cc:${c}"><em>${ic}</em>${esc(f.name)}${f.to ? `<u>➜ ${esc(f.to)}</u>` : ''}</span>`; }).join('')}${b.count > (b.moves || []).length ? `<span class="muted">+${b.count - (b.moves || []).length}</span>` : ''}</div>
      <div>${b.undone ? `<span class="tag">${t('undone_tag')}</span>` : `<button class="sm" data-act="undo" data-id="${b.id}">↩ ${t('undo')}</button>`}</div></div>`;
  }).join('')}`).join('')}</div></div>`;
}

function hsHTML() { return hsStrip() + hsDiffPanel() + hsTimeline(); }

async function hsLoadDiff(date) {
  const r = await call('snap:diff', date);
  if (state.tab !== 'history' || state.hs.day !== date) return;
  state.hs.diff = r; state.hs.diffDate = date;
  hsRerender();
}

/* ---------- rules (visual builder) ---------- */
const TYPE_GROUPS = {
  docs: ['📄', 'pdf,doc,docx,txt,rtf,odt'], images: ['🖼️', 'jpg,jpeg,png,gif,webp,heic'], sheets: ['📊', 'xls,xlsx,csv'], slides: ['📽️', 'ppt,pptx,key'],
  video: ['🎬', 'mp4,mkv,mov,avi'], audio: ['🎵', 'mp3,wav,flac,m4a'], archives: ['🗜️', 'zip,rar,7z'], code: ['💻', 'js,ts,py,json,sql,html'],
};
const PACK_ART = { finance: '💰', developer: '💻', student: '🎓', gamer: '🎮', designer: '🎨' };
const rl = { draft: null, edit: null, counts: {}, folders: [], prev: null, open: false, timer: null };
const rlBlank = () => ({ name: '', words: '', types: [], extra: '', dest: '', monthly: false, advanced: false, raw: '' });
const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turn what the user filled in (plain words, type buttons, folder) into a rule object. */
function rlRule(d) {
  const words = d.words.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
  const exts = [...new Set([...d.types.flatMap((g) => TYPE_GROUPS[g][1].split(',')), ...d.extra.split(/[,\s]+/).map((x) => x.replace(/^\./, '').trim().toLowerCase()).filter(Boolean)])];
  return { name: d.name.trim() || words[0] || d.dest.trim(), pattern: d.advanced ? d.raw.trim() : words.map(escRe).join('|'), exts, dest: d.dest.trim(), monthly: !!d.monthly };
}
const rlValid = (r) => !!r.dest && (!!r.pattern || r.exts.length > 0);

/** An existing rule back into the form. Anything with real regex syntax opens in advanced mode. */
function rlFromRule(r) {
  const plain = !r.pattern || !/[\\^$*+?()[\]{}]/.test(r.pattern);
  const groups = Object.keys(TYPE_GROUPS).filter((g) => TYPE_GROUPS[g][1].split(',').every((e) => (r.exts || []).includes(e)));
  const covered = new Set(groups.flatMap((g) => TYPE_GROUPS[g][1].split(',')));
  return { name: r.name, words: plain ? (r.pattern || '').split('|').join(', ') : '', types: groups, extra: (r.exts || []).filter((e) => !covered.has(e)).join(', '), dest: r.dest, monthly: !!r.monthly, advanced: !plain, raw: plain ? '' : r.pattern };
}

function renderRules() {
  view(`<div class="org-head"><div><h1>${t('rules')}</h1></div><div class="org-opts"><button data-act="rulesExport">⬆ ${t('export')}</button><button data-act="rulesImport">⬇ ${t('import')}</button></div></div>
    <div id="rlBox">${rlHTML()}</div>`);
  rlLoadCounts();
  call('rules:folders').then((f) => { if (f) { rl.folders = f; const dl = $('#rlfolders'); if (dl) dl.innerHTML = f.map((x) => `<option value="${esc(x)}">`).join(''); } });
}
function rlRerender() { const b = $('#rlBox'); if (b) b.innerHTML = rlHTML(); }

async function rlLoadCounts() {
  const rows = cfg.rules.map((r) => ({ pattern: r.pattern, exts: r.exts, minAgeDays: r.minAgeDays }));
  if (!rows.length) { rl.counts = {}; return; }
  const res = await call('rules:test', rows);
  if (!res || state.tab !== 'rules') return;
  rl.counts = {};
  cfg.rules.forEach((r, i) => { rl.counts[r.id] = res[i]; });
  rlRerender();
}

async function rlTest() {
  const r = rlRule(rl.draft);
  const save = $('#rlSave'); if (save) save.disabled = !rlValid(r);
  if (!r.pattern && !r.exts.length) { rl.prev = null; rlPrevPaint(); return; }
  const res = await call('rules:test', [{ pattern: r.pattern, exts: r.exts }]);
  if (!res || !rl.open) return;
  rl.prev = res[0]; rlPrevPaint();
}
function rlPrevPaint() { const p = $('#rlPrev'); if (p) p.innerHTML = rlPrevHTML(); }

function rlPrevHTML() {
  const p = rl.prev, r = rlRule(rl.draft);
  if (!r.pattern && !r.exts.length) return `<span class="muted">👀 ${t('rl_prev_idle')}</span>`;
  if (!p) return `<span class="muted">${t('scanning')}</span>`;
  if (p.bad) return `<span style="color:#ff5a6e">⚠️ ${t('rl_bad')}</span>`;
  if (!p.count) return `<span class="muted">🫧 ${t('rl_prev_none')}</span>`;
  return `<div><b>✨ ${t('rl_prev_n', { n: p.count })}</b> ${r.dest ? `<span class="muted">➜ ${esc(r.dest)}</span>` : ''}</div><div class="prev-chips">${p.names.map((n) => `<span class="fchip" style="--cc:#6ea8ff"><em>${extIcon((n.split('.').pop() || '').toLowerCase())}</em>${esc(n)}</span>`).join('')}${p.count > p.names.length ? `<span class="muted">+${p.count - p.names.length}</span>` : ''}</div>`;
}

function rlBuilder() {
  const d = rl.draft, r = rlRule(d);
  const chips = Object.entries(TYPE_GROUPS).map(([g, [ic, ex]]) => `<button class="tgchip ${d.types.includes(g) ? 'on' : ''}" data-act="rlType" data-g="${g}" title=".${esc(ex.split(',').join(' .'))}">${ic} ${t((g === 'video' || g === 'audio' ? 'tg_' : 'sg_') + g)}</button>`).join('');
  return `<div class="card rb"><h3>${rl.edit ? '✎ ' + t('rl_edit') : '➕ ' + t('rl_new')}</h3>
    <div class="rb-steps">
      <div class="rb-step"><span class="rb-n">1</span><div class="grow"><b>${t('rl_s1')}</b><small>${t('rl_s1_d')}</small>${d.advanced ? `<input type="text" class="rl-in" data-f="raw" value="${esc(d.raw)}" placeholder="regex: invoice|ใบเสร็จ">` : `<input type="text" class="rl-in" data-f="words" value="${esc(d.words)}" placeholder="${esc(t('rl_s1_ph'))}">`}</div></div>
      <div class="rb-step"><span class="rb-n">2</span><div class="grow"><b>${t('rl_s2')}</b><small>${t('rl_s2_d')}</small><div class="tgroups">${chips}</div><input type="text" class="rl-in" data-f="extra" value="${esc(d.extra)}" placeholder="${esc(t('rl_s2_ph'))}"></div></div>
      <div class="rb-step"><span class="rb-n">3</span><div class="grow"><b>${t('rl_s3')}</b><small>${t('rl_s3_d')}</small><input type="text" class="rl-in" data-f="dest" value="${esc(d.dest)}" list="rlfolders" placeholder="${esc(t('rl_s3_ph'))}"><datalist id="rlfolders">${rl.folders.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <label class="pill" style="margin-top:8px"><input type="checkbox" data-chg="rlchk" data-f="monthly" ${d.monthly ? 'checked' : ''}><span>📅 ${t('rl_monthly')}</span></label></div></div>
      <div class="rb-step"><span class="rb-n">4</span><div class="grow"><b>${t('rl_s4')}</b><input type="text" class="rl-in" data-f="name" value="${esc(d.name)}" placeholder="${esc(r.name || t('rl_s4_ph'))}"></div></div>
    </div>
    <label class="pill"><input type="checkbox" data-chg="rlchk" data-f="advanced" ${d.advanced ? 'checked' : ''}><span>⚙️ ${t('rl_adv')}</span></label>
    <div class="rb-prev" id="rlPrev">${rlPrevHTML()}</div>
    <div class="acts"><button data-act="rlCancel">${t('cancel')}</button><button class="primary" id="rlSave" data-act="rlSave" ${rlValid(r) ? '' : 'disabled'}>💾 ${t('rl_save')}</button></div></div>`;
}

function ruleCard(r) {
  const c = rl.counts[r.id];
  const terms = (r.pattern || '').split('|').filter(Boolean);
  const conds = [...terms.slice(0, 5).map((w) => `<span class="cchip">🔤 ${esc(w)}</span>`), terms.length > 5 ? `<span class="muted">+${terms.length - 5}</span>` : '', ...(r.exts || []).slice(0, 6).map((e) => `<span class="cchip ext">.${esc(e)}</span>`), (r.exts || []).length > 6 ? `<span class="muted">+${r.exts.length - 6}</span>` : ''].join('');
  return `<div class="rule ${r.enabled ? '' : 'off'}"><div class="r-if"><span class="r-lbl">${t('rl_if')}</span><div class="cchips">${conds || `<span class="muted">—</span>`}</div></div>
    <div class="r-arrow">➜</div>
    <div class="r-then"><div class="folder-ico mini" style="--cc:#8b9dff"><i></i></div><div><b>${esc(r.dest)}</b>${r.monthly ? `<small>📅 ${t('rl_monthly_s')}</small>` : ''}</div></div>
    <div class="r-tail"><div class="r-name">${esc(r.name)}</div>${c ? `<div class="r-match ${c.count ? 'has' : ''}">${c.count ? '✨ ' + t('rl_match_n', { n: c.count }) : t('rl_match_0')}</div>` : ''}${c && c.count ? `<div class="prev-chips">${c.names.slice(0, 3).map((n) => `<span class="fchip" style="--cc:#6ea8ff"><em>${extIcon((n.split('.').pop() || '').toLowerCase())}</em>${esc(n)}</span>`).join('')}${c.count > 3 ? `<span class="muted">+${c.count - 3}</span>` : ''}</div>` : ''}</div>
    <div class="r-act"><button class="switch sm ${r.enabled ? 'on' : ''}" data-act="ruleTog" data-id="${r.id}" title="${t('rl_toggle')}"><i></i></button><button class="sm" data-act="rlEdit" data-id="${r.id}" title="${t('rl_edit')}">✎</button><button class="sm danger" data-act="ruleDel" data-id="${r.id}" title="${t('del')}">✕</button></div></div>`;
}

function rlHTML() {
  const mine = cfg.rules.length ? `<div class="rules">${cfg.rules.map(ruleCard).join('')}</div>` : `<div class="inbox-empty"><span>📐</span><b>${t('rules_empty')}</b><small class="muted">${t('rl_empty_hint')}</small></div>`;
  const packs = cfg.packs.map((p) => {
    const have = p.ruleIds.filter((id) => cfg.rules.some((r) => r.id === id)).length, done = have === p.ruleIds.length;
    return `<div class="pack ${done ? 'done' : ''}"><div class="pk-art">${PACK_ART[p.id] || '📦'}</div><div class="pk-main"><b>${esc(p[cfg.lang])}</b><div class="pk-rules">${p.rules.map((r) => `<div><span>${esc(r.name)}</span><i>➜</i><code>${esc(r.dest)}</code></div>`).join('')}</div></div>
      ${done ? `<span class="pk-ok">✓ ${t('pack_done')}</span>` : `<button class="primary sm" data-act="packAdd" data-id="${p.id}">＋ ${t('pack_add')}${have ? ` (${p.ruleIds.length - have})` : ''}</button>`}</div>`;
  }).join('');
  const builtin = cfg.categories.filter((c) => c.exts.length).map((c) => { const [col, ico] = catStyle(c.id); return `<div class="bcat" style="--cc:${col}"><i>${ico}</i><div><b>${esc(c[cfg.lang])}</b><small>.${esc(c.exts.slice(0, 6).join(' .'))}${c.exts.length > 6 ? ' …' : ''}</small></div></div>`; }).join('');
  return `${rl.open ? rlBuilder() : `<button class="newrule" data-act="rlNew"><span>＋</span> ${t('rl_new')}<small>${t('rl_new_d')}</small></button>`}
    <h2 class="gh">📐 ${t('rl_mine')} <span class="muted">· ${cfg.rules.length}</span></h2>${mine}
    <h2 class="gh">📦 ${t('packs')}</h2><div class="packs">${packs}</div>
    <details class="builtin"><summary>🏗️ ${t('rl_builtin')}</summary><p class="muted" style="font-size:12.5px">${t('rl_builtin_d')}</p><div class="bgrid">${builtin}</div></details>`;
}

/* ---------- settings (visual) ---------- */
const sw = (key, on, def = false) => `<button class="switch ${on ? 'on' : ''}" data-act="setTog" data-k="${key}" data-def="${def ? 1 : 0}" role="switch" aria-checked="${on}"><i></i></button>`;
const seg = (key, opts, cur, dis = false) => `<div class="seg ${dis ? 'dis' : ''}">${opts.map(([v, label]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="setSeg" data-k="${key}" data-v="${v}" ${dis ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
const srow = (ico, title, desc, ctrl, extra = '') => `<div class="srow ${extra}"><div class="s-i">${ico}</div><div class="s-t"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div><div class="s-c">${ctrl}</div></div>`;
const srange = (key, ico, title, min, max, val, unit) => `<div class="srow col"><div class="s-i">${ico}</div><div class="s-t"><b>${title} <em id="val-${key}">${val}</em> ${unit}</b><input type="range" class="srange" data-chg="srange" data-k="${key}" min="${min}" max="${max}" value="${val}"><div class="rmm"><span>${min}</span><span>${max}</span></div></div></div>`;
const keycap = (...keys) => keys.map((k) => `<kbd class="kc">${k}</kbd>`).join('<i>+</i>');

const THEME_PREVIEW = { default: ['#5b8cff', '#7ee0b8', '#1e2742'], loy: ['#ffb347', '#4fd1e0', '#1b2a55'], xmas: ['#ff5a5f', '#46c987', '#1d3a2e'], newyear: ['#ffd24d', '#a78bff', '#1f1a38'], valentine: ['#ff6b9d', '#ffb3c8', '#42182f'], songkran: ['#38bdf8', '#34e0c0', '#0f3a55'], halloween: ['#ff8a1f', '#a78bfa', '#2a1740'] };
const WX_ICON = { sun: '☀️', night: '🌙', cloud: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️', fog: '🌫️' };
let wxFound = [], wxEditing = false, wxMsg = '';
function wxBlock(ts) {
  const w = ts.weather || {}, place = w.place, on = !!w.on, now = w.now;
  const reading = !on ? '' : now ? `<div class="wx-now"><span class="wx-i">${WX_ICON[now.kind]}</span><div><b>${now.temp}°C · ${t('wx_k_' + now.kind)}</b><small>${t('wx_at', { t: new Date(now.at).toLocaleTimeString(cfg.lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) })}</small></div></div>` : w.error ? `<p class="wx-err">⚠️ ${t('wx_err')}</p>` : `<p class="muted">${t('scanning')}</p>`;
  const onClassic = ts.id === 'default';
  const picker = !place || wxEditing ? `<div class="wx-find"><input type="text" id="wxQ" placeholder="${t('wx_city')}" autocomplete="off"><button class="primary sm" data-act="wxSearch">🔎 ${t('wx_search')}</button></div><div class="wx-res">${wxMsg ? `<p class="muted">${wxMsg}</p>` : ''}${wxFound.map((p, i) => `<button class="wx-pick" data-act="wxPick" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(p.area)}</small></button>`).join('')}</div>` : `<div class="wx-place">📍 <b>${esc(place.name)}</b><small class="muted">${esc(place.area || '')}</small><button class="sm" data-act="wxChange">${t('wx_change')}</button></div>`;
  return `<div class="wxbox ${on ? 'on' : ''}">
    <div class="srow"><div class="s-i">🌦️</div><div class="s-t"><b>${t('wx_title')}</b><small>${t('wx_d')}</small></div><div class="s-c"><button class="switch ${on ? 'on' : ''}" data-act="wxTog" role="switch" aria-checked="${on}"><i></i></button></div></div>
    ${on && !onClassic ? `<p class="wx-note">ℹ️ ${t('wx_needs', { n: esc((ts.list.find((x) => x.id === ts.id) || {})[cfg.lang] || '') })}</p>` : ''}
    ${reading}${picker}</div>`;
}
let themeCache = null, trustCache = null;
async function themeRefresh(ts) { ts = ts || await call('theme:get'); if (ts) themeCache = ts; const b = $('#themeBox'); if (b && ts) b.innerHTML = themeCard(ts); }

function themeCard(ts) {
  const list = ts.list || [];
  const tiles = list.map((x) => { const [a, b, bg] = THEME_PREVIEW[x.id] || THEME_PREVIEW.default; return `<button class="thm ${ts.picked === x.id ? 'on' : ''} ${ts.id === x.id ? 'live' : ''}" data-act="setSeg" data-k="theme" data-v="${x.id}" style="--ta:${a};--tb:${b};--tbg:${bg}">
      <div class="thm-art"><span class="thm-e">${x.emoji}</span><i></i><i></i><i></i></div>
      <b>${esc(x[cfg.lang])}</b><small>${esc(cfg.lang === 'th' ? x.whenTh : x.whenEn)}</small><em>✓</em></button>`; }).join('');
  const now = list.find((x) => x.id === ts.id);
  return `<div class="thgrid">${tiles}</div>` + srow('🖌️', t('fx_title'), t('fx_d'), seg('themeFx', [['sky', t('fx_sky')], ['icons', t('fx_icons')], ['shapes', t('fx_shapes')], ['scene', t('fx_scene')], ['calm', t('fx_calm')]], ts.fx || 'sky'), 'wrap') + wxBlock(ts) + srow('📅', t('theme_auto'), t('theme_auto_d'), sw('themeAuto', !!ts.auto)) + (ts.auto && ts.id !== ts.picked ? `<p class="muted" style="margin:6px 0 0;font-size:12.5px">${now ? now.emoji : ''} ${t('theme_now', { n: now ? esc(now[cfg.lang]) : '' })}</p>` : '');
}

/* ---------- AI connections (several providers / keys) ---------- */
const AI_LOGO = { anthropic: ['A', '#d97757'], openai: ['O', '#10a37f'], gemini: ['G', '#4285f4'], openrouter: ['R', '#6467f2'], deepseek: ['D', '#4d6bfe'], groq: ['Q', '#f55036'], ollama: ['🦙', '#8a8f98'], lmstudio: ['🖥️', '#7c5cff'], custom: ['⚙️', '#64748b'] };
const aiui = { form: null, res: {} };
const aiLogo = (p) => { const [ch, col] = AI_LOGO[p] || AI_LOGO.custom; return `<span class="ai-logo" style="--pc:${col}">${ch}</span>`; };
const aiPreset = (id) => (cfg.aiPresets || []).find((p) => p.id === id) || (cfg.aiPresets || []).slice(-1)[0] || {};

function aiConnCard(c) {
  const on = c.id === cfg.aiActive || (!cfg.aiActive && cfg.aiConns[0] === c), r = aiui.res[c.id];
  const where = c.local ? `<span class="chip loc">🏠 ${t('ai_local')}</span>` : `<span class="chip net">☁️ ${esc(c.host)}</span>`;
  const key = aiPreset(c.provider).local ? '' : c.hasKey ? `<span class="chip ok">🔑 ${t('ai_key_saved_s')}</span>` : `<span class="chip bad">🔑 ${t('ai_nokey')}</span>`;
  const res = !r ? '' : r.busy ? `<small class="muted">⏳ ${t('ai_testing')}</small>` : r.ok ? `<small class="aic-ok">✓ ${t('ai_ok')} · ${r.ms} ms${r.reply ? ' · “' + esc(r.reply) + '”' : ''}</small>` : `<small class="aic-bad">⚠️ ${esc(r.msg)}</small>`;
  return `<div class="aic ${on ? 'on' : ''}">${aiLogo(c.provider)}
    <div class="grow"><b>${esc(c.label)}</b><small class="muted"> · ${esc(c.model)}</small><div class="aic-chips">${where}${key}</div>${res}</div>
    <div class="aic-act">${on ? `<span class="aic-badge">✓ ${t('ai_active')}</span>` : `<button class="sm" data-act="aiUse" data-id="${c.id}">${t('ai_use')}</button>`}
      <button class="sm" data-act="aiTest" data-id="${c.id}">⚡ ${t('ai_test')}</button><button class="sm" data-act="aiEdit" data-id="${c.id}" title="${t('rl_edit')}">✎</button><button class="sm danger" data-act="aiDel" data-id="${c.id}" title="${t('del')}">✕</button></div></div>`;
}

function aiFormHTML() {
  const f = aiui.form, p = aiPreset(f.provider);
  const tiles = (cfg.aiPresets || []).map((x) => `<button class="aip ${x.id === f.provider ? 'on' : ''}" data-act="aiPickProv" data-p="${x.id}">${aiLogo(x.id)}<b>${esc(x.id === 'custom' ? t('ai_custom') : x.name)}</b>${x.local ? `<small>🏠 ${t('ai_local')}</small>` : ''}</button>`).join('');
  const needKey = !p.local;
  const warn = p.custom || (f.baseUrl && f.baseUrl !== p.baseUrl) ? `<p class="wx-note">⚠️ ${t('ai_base_warn')}</p>` : '';
  return `<div class="aiform"><h4>${f.id ? '✎ ' + t('ai_edit_t') : '＋ ' + t('ai_add_t')}</h4><div class="aipgrid">${tiles}</div>
    <div class="aif-row"><label>${t('ai_f_label')}<input type="text" id="aiLabel" value="${esc(f.label)}" placeholder="${esc(p.name || '')}"></label>
      <label>${t('ai_f_model')}<input type="text" id="aiModel" value="${esc(f.model)}" placeholder="${esc(p.model || 'model-name')}" autocomplete="off"></label></div>
    ${needKey ? `<label class="aif-key">${t('ai_f_key')}<input type="password" id="aiKeyIn" value="" placeholder="${f.id ? '•••••••• (' + t('ai_keep') + ')' : esc(p.keyHint || 'key')}" autocomplete="off"></label>` : `<p class="muted" style="font-size:12.5px">🏠 ${t('ai_local_d')}</p>`}
    <details ${p.custom || p.local ? 'open' : ''}><summary>${t('ai_adv')}</summary><label>${t('ai_f_base')}<input type="text" id="aiBase" value="${esc(f.baseUrl)}" placeholder="${esc(p.baseUrl || 'https://…/v1')}" autocomplete="off"></label>${warn}</details>
    <div class="acts"><button data-act="aiCancel">${t('cancel')}</button><button class="primary" data-act="aiSaveConn">💾 ${t('ai_save_test')}</button></div></div>`;
}

function aiBody(aiOn) {
  const conns = cfg.aiConns || [];
  const list = conns.length ? conns.map(aiConnCard).join('') : `<div class="inbox-empty"><span>🔌</span><b>${t('ai_none')}</b><small class="muted">${t('ai_none_d')}</small></div>`;
  return srow('✨', t('ai_enable'), t('st_ai_off'), sw('aiEnabled', aiOn))
    + `<div class="${aiOn ? '' : 'dim'}"><h4 class="gh" style="margin:12px 0 6px">🔑 ${t('ai_conns')} <span class="muted">· ${conns.length}</span></h4><div class="aic-list">${list}</div>${aiui.form ? aiFormHTML() : `<button class="aic add" data-act="aiAdd">＋ ${t('ai_add')}</button>`}`
    + (conns.length > 1 ? srow('🔁', t('ai_fb'), t('ai_fb_d'), sw('aiFallback', cfg.aiFallback !== false, true)) : '')
    + `<div class="pgrid"><button class="pcard ${cfg.aiPrivacy !== 'content' ? 'on' : ''}" data-act="setSeg" data-k="aiPrivacy" data-v="names"><span>🔤</span><b>${t('ai_priv_names')}</b><small>${t('st_priv_names_d')}</small></button><button class="pcard ${cfg.aiPrivacy === 'content' ? 'on' : ''}" data-act="setSeg" data-k="aiPrivacy" data-v="content"><span>📝</span><b>${t('ai_priv_content')}</b><small>${t('st_priv_content_d')}</small></button></div>`
    + srow('🏷️', t('ai_rename'), '', sw('aiRename', !!cfg.aiRename))
    + srow('⚡', ck('ทำเองโดยไม่ถามจากแถบคำสั่ง', 'Act without asking from the command bar'), ck('เมื่อถามเรื่องโฟลเดอร์ ระบบจะย้ายไฟล์ที่ตรงกฎและมั่นใจให้ทันที (ย้อนกลับได้) ปิดไว้ = ถามยืนยันก่อนเสมอ', 'When you ask about a folder, confident rule-matched files are moved right away (undoable). Off = always ask first.'), sw('cmdAuto', !!cfg.cmdAuto)) + `</div>`;
}

function renderSettings() {
  const notifyOn = cfg.notify !== false, aiOn = !!cfg.aiEnabled, sec = cfg.notifySec ?? 12;
  const card = (ico, title, body, cls = '') => `<div class="card scard ${cls}"><h3><span class="sc-ico">${ico}</span>${title}</h3>${body}</div>`;
  view(`<h1>${t('settings')}</h1><div class="sgrid">
    ${card('🎨', t('st_theme'), `<div id="themeBox">${themeCache ? themeCard(themeCache) : ''}</div>`, 'wide')}
    ${card('🌐', t('st_general'), srow('🗣️', t('set_lang'), t('st_lang_d'), seg('lang', [['th', 'ไทย'], ['en', 'English']], cfg.lang)) + srow('🚀', t('startup'), t('st_startup_d'), sw('startup', !!cfg.startup)))}
    ${card('🔔', t('st_notice'), srow('💬', t('notify_on'), t('st_notice_d'), sw('notify', notifyOn, true)) + srow('⏱️', t('st_dur'), '', seg('notifySec', [[8, '8s'], [12, '12s'], [20, '20s'], [30, '30s'], [0, '∞']], sec, !notifyOn) + `<button class="sm" data-act="noticeTest" ${notifyOn ? '' : 'disabled'}>🔔 ${t('notify_test')}</button>`, 'wrap')
      + srow('🗂️', t('widget_on'), t('st_widget_d'), sw('widget', cfg.widget !== false, true)) + srow('📌', t('widget_top'), '', sw('widgetTop', cfg.widgetTop !== false, true)))}
    ${card('🧹', t('st_clean'), `<p class="muted" style="margin:0 0 8px;font-size:12.5px">${t('st_clean_d')}</p>` + srange('staleDays', '🖼️', t('stale_days'), 7, 180, cfg.staleDays || 30, t('st_days')) + srange('installerDays', '💿', t('inst_days'), 3, 90, cfg.installerDays || 14, t('st_days')) + srange('unusedDays', '💤', t('st_unused_days'), 30, 365, cfg.unusedDays || 60, t('st_days')))}
    ${card('⌨️', t('st_keys'), `<div class="keys"><div>${keycap('Ctrl', 'Alt', 'J')}<span>${t('st_k1')}</span></div><div>${keycap('Ctrl', 'Alt', 'D')}<span>${t('st_k2')}</span><button class="sm" data-act="dropOpen">🧲 ${t('drop_open')}</button></div><div>${keycap('Ctrl', 'K')}<span>${t('st_k3')}</span></div></div>`)}
    ${card('📁', t('set_folders'), `<p class="muted" style="margin:0 0 8px;font-size:12.5px">${t('st_folders_d')}</p><div class="sfold">${cfg.folders.map((f, i) => `<div class="sf"><span class="sf-ico">📁</span><div class="grow"><b>${esc(f.split(/[\\/]/).filter(Boolean).pop() || f)}</b><small title="${esc(f)}">${esc(f)}</small></div>${cfg.folders.length > 1 ? `<button class="sm danger" data-act="rmFolder" data-i="${i}" title="${t('remove')}">✕</button>` : ''}</div>`).join('')}<button class="sf add" data-act="addFolder">＋ ${t('add_folder')}</button></div>`, 'wide')}
    ${card('✨', t('set_ai'), aiBody(aiOn), 'wide')}
    ${card('⬆️', t('st_about'), `<div class="about"><div class="ab-logo"><img src="../../assets/icon.png" alt=""></div><div class="grow"><b>แบงค์ จัดโต๊ะ</b><small class="muted" style="display:block">${t('st_privacy')}</small></div></div><div class="row" id="updBox" style="margin-top:12px"></div><div class="trust"><h4 class="tr-h">🔒 ${t('tr_title')}</h4><div id="trustBox">${trustCache ? trHTML(trustCache) : `<p class="muted">${t('scanning')}</p>`}</div></div>`, 'wide')}
  </div>`);
  renderUpdate();
  loadTrust();
  themeRefresh();
}

/* ---------- security transparency (inside Settings → About) ---------- */
const TR_ICON = { semgrep: '🔬', osv: '🧬', gitleaks: '🗝️', electronegativity: '⚛️', fuses: '🔩', hostile: '🧨', deps_prod: '📦', deps_all: '🧰', tests: '🧪', electron: '🛡️', network: '🌐', spawn: '⚙️', secrets: '🔑', defender: '🦠' };
const TR_ORDER = ['defender', 'semgrep', 'electronegativity', 'fuses', 'gitleaks', 'osv', 'hostile', 'deps_prod', 'electron', 'network', 'secrets', 'tests', 'spawn', 'deps_all'];

function trDetail(r) {
  const d = r.data || {};
  switch (r.id) {
    case 'deps_prod': return d.total ? t('tr_d_deps_bad', { n: d.total }) : t('tr_d_deps_prod', { n: d.scanned });
    case 'deps_all': return d.total ? t('tr_d_deps_all', { n: d.total }) : t('tr_d_deps_ok', { n: d.scanned });
    case 'tests': return t('tr_d_tests', { p: d.passed, n: d.passed + d.failed });
    case 'electron': return t('tr_d_electron', { n: d.windows });
    case 'network': { const host = [...new Set((d.addresses || []).map((a) => a.url.replace(/^https?:\/\//, '').split('/')[0]))].join(', '); return d.addresses && d.addresses.length ? t('tr_d_network', { h: host }) : t('tr_d_network0'); }
    case 'spawn': return t('tr_d_spawn', { l: (d.programs || []).join(', ') });
    case 'semgrep': return t('tr_d_semgrep', { r: d.rules, f: d.files, n: d.findings, x: d.fixed, fp: d.falsePositives });
    case 'osv': return d.findings ? t('tr_d_osv_bad', { p: d.packages, n: d.findings, i: esc((d.items || []).join(', ')) }) : t('tr_d_osv', { p: d.packages });
    case 'gitleaks': return d.leaks ? t('tr_d_gitleaks_bad', { n: d.leaks }) : t('tr_d_gitleaks', { s: esc(d.scanned || '') });
    case 'electronegativity': return t('tr_d_ele', { w: d.warnings + d.errors, n: d.notes });
    case 'fuses': return t('tr_d_fuses', { on: d.on, of: d.of });
    case 'hostile': return d.controls || d.pages ? t('tr_d_hostile', { p: d.pages, i: d.injected, r: d.refused, n: d.ipcTried }) : t('tr_skip');
    case 'secrets': return d.hits && d.hits.length ? t('tr_d_secrets_bad', { n: d.hits.length }) : t('tr_d_secrets', { n: d.files });
    case 'defender': return d.threats && d.threats.length ? t('tr_d_def_bad', { n: d.threats.length }) : d.error ? esc(d.error) : t('tr_d_defender', { s: d.seconds });
    default: return '';
  }
}

// short names for the one-line summary; the full explanation of each row sits in the folded details
const TR_SHORT = { semgrep: 'Semgrep', electronegativity: 'Electronegativity', hostile: 'tr_s_hostile', gitleaks: 'Gitleaks', secrets: 'tr_s_secrets', deps_prod: 'npm audit', osv: 'OSV-Scanner', deps_all: 'tr_s_build', fuses: 'Electron Fuses', electron: 'tr_s_windows', spawn: 'tr_s_spawn', network: 'tr_s_network', defender: 'Microsoft Defender', tests: 'tr_s_tests' };
const TR_GROUPS = [
  ['code', '🔬', ['semgrep', 'electronegativity', 'gitleaks', 'secrets', 'hostile']],
  ['deps', '📦', ['deps_prod', 'osv', 'deps_all']],
  ['app', '🛡️', ['fuses', 'electron', 'spawn']],
  ['net', '🌐', ['network']],
  ['mal', '🦠', ['defender']],
  ['test', '🧪', ['tests']],
];
const trWorst = (rs) => (rs.some((r) => r.status === 'fail') ? 'fail' : rs.some((r) => r.status === 'warn') ? 'warn' : rs.every((r) => r.status === 'pass') ? 'pass' : 'skip');
const trMark = (st) => (st === 'pass' ? '✓' : st === 'warn' ? '!' : st === 'fail' ? '✕' : '–');

function trHTML(info) {
  const rep = info && info.report, live = info && info.live;
  if (!rep) return `<p class="muted">${t('tr_none')}</p>`;
  const rows = TR_ORDER.map((id) => rep.rows.find((r) => r.id === id)).filter(Boolean);
  const ok = rows.filter((r) => r.status === 'pass').length, bad = rows.filter((r) => r.status === 'fail').length;
  const when = new Date(rep.generated).toLocaleDateString(cfg.lang === 'th' ? 'th-TH-u-ca-buddhist' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmt = (iso) => new Date(iso).toLocaleDateString(cfg.lang === 'th' ? 'th-TH-u-ca-buddhist' : 'en-GB', { day: 'numeric', month: 'short' }) + ' ' + new Date(iso).toLocaleTimeString(cfg.lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const hero = `<div class="tr-hero ${bad ? 'bad' : 'good'}"><div class="tr-shield">${bad ? '⚠️' : '🛡️'}</div><div class="grow"><b>${t('tr_score', { p: ok, n: rows.length })}</b><small>${t('tr_when', { d: when })} · v${esc(rep.version)}</small></div><div class="tr-ring" style="--p:${Math.round(100 * ok / rows.length)}"><span>${ok}/${rows.length}</span></div></div>`;

  const cards = TR_GROUPS.map(([k, ico, ids]) => {
    const rs = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    if (!rs.length) return '';
    const st = trWorst(rs);
    const chips = rs.map((r) => { const nm = TR_SHORT[r.id]; return `<span class="tr-chip st-${r.status}">${trMark(r.status)} ${nm.startsWith('tr_') ? t(nm, { n: r.data && r.data.passed }) : esc(nm)}</span>`; }).join('');
    const detail = rs.map((r) => `<div class="tr-d st-${r.status}"><b>${trMark(r.status)} ${t('tr_' + r.id)}</b><small>${trDetail(r)}</small><div class="tr-meta"><span>🔧 ${esc(r.tool)}${r.version && r.version !== '-' ? ' · ' + esc(r.version) : ''}</span>${r.external ? `<span class="ext">🌐 ${t('tr_ext')}</span>` : ''}<span>🕒 ${fmt(r.at)}</span></div></div>`).join('');
    return `<details class="tr-card st-${st}"><summary><span class="tr-ico">${ico}<i>${trMark(st)}</i></span><span class="grow"><b>${t('tr_g_' + k)}</b><span class="tr-chips">${chips}</span></span><em>${t('tr_more')}</em></summary><div class="tr-dl">${detail}</div></details>`;
  }).join('');

  const liveItems = live ? [
    [live.isolated, t('tr_l_iso', { n: live.windows })],
    [live.keyStore !== 'weak', live.keyStore === 'none' ? t('tr_l_key_none') : live.keyStore === 'windows' ? t('tr_l_key_win') : t('tr_l_key_weak')],
    ...(live.weather ? [[true, t('tr_l_wx', { c: esc(live.weather) })]] : []),
    [!live.ai || (live.aiTo || []).every((x) => x.local), live.ai ? t('tr_l_ai_on', { m: live.aiPrivacy === 'content' ? t('ai_priv_content') : t('ai_priv_names'), h: (live.aiTo || []).map((x) => x.local ? t('ai_local') : esc(x.host)).join(', ') }) : t('tr_l_ai_off')],
    [true, t('tr_l_data', { p: esc(live.dataDir) })],
  ] : [];
  const liveGood = liveItems.every(([g]) => g);
  const liveHTML = live ? `<details class="tr-live-box"><summary>🔴 ${t('tr_live_title')} <span class="tr-chip st-${liveGood ? 'pass' : 'warn'}">${liveGood ? '✓' : '!'} ${liveItems.filter(([g]) => g).length}/${liveItems.length}</span><em>${t('tr_more')}</em></summary>${liveItems.map(([good, txt]) => `<div class="tr-live ${good ? '' : 'warn'}"><i>${good ? '✓' : '!'}</i><span>${txt}</span></div>`).join('')}<small class="muted">Electron ${esc(live.electron)} · Chromium ${esc(live.chrome)}</small></details>` : '';
  const gaps = `<div class="tr-gaps"><b>⏳ ${t('tr_pending')}</b> ${t('tr_nosign_s')} · ${t('tr_noaudit_s')}</div>`;
  return `${hero}<div class="tr-cards">${cards}</div>${liveHTML}${gaps}`;
}

async function loadTrust() {
  const box = $('#trustBox');
  if (!box) return;
  const info = await call('trust:info');
  if (info) trustCache = info;
  const b2 = $('#trustBox');
  if (b2 && state.tab === 'settings') b2.innerHTML = trHTML(info);
}

async function renderUpdate(state) {
  const box = $('#updBox');
  if (!box) return;
  const s = state || await call('update:state');
  if (!s) return;
  const msg = { idle: '', dev: t('upd_dev'), checking: t('scanning'), latest: t('upd_latest'), unconfigured: t('upd_unconfigured'), error: t('errp', { e: esc(s.message || '') }), available: t('upd_available', { v: esc(s.version) }), downloading: t('upd_downloading', { n: s.percent || 0 }), ready: t('upd_ready', { v: esc(s.version) }) }[s.status] || '';
  const btn = s.status === 'available' ? `<button class="sm primary" data-act="updDownload">${t('upd_download')}</button>` : s.status === 'ready' ? `<button class="sm primary" data-act="updInstall">${t('upd_install')}</button>` : `<button class="sm" data-act="updCheck">${t('upd_check')}</button>`;
  box.innerHTML = `<span class="muted">v${esc(s.version)}</span>${btn}<span class="muted grow">${msg}</span>`;
}

const RENDER = { organize: renderOrganize, auto: renderAuto, guard: renderGuard, cleanup: renderCleanup, modes: renderModes, layout: renderLayout, search: renderSearch, history: renderHistory, rules: renderRules, settings: renderSettings };

/* ---------- command palette ---------- */
/** Home tiles: icon first, one or two words. Also what the user sees when they say something the app can't act on. */
function homeTiles() {
  const tiles = [
    ['🗂️', ck('จัดโต๊ะ', 'Tidy up'), 'palAsk', ck('จัดโต๊ะ', 'tidy up')],
    ['📥', ck('เช็ก Downloads', 'Downloads'), 'palAsk', ck('ไฟล์ใน Downloads เหมาะสมไหม', 'are my Downloads files in a good place')],
    ['🧹', ck('ล้างไฟล์เก่า', 'Clean up'), 'palAsk', ck('ล้างไฟล์เก่า', 'clean up old files')],
    ['💼', ck('โหมดงาน', 'Work mode'), 'palAsk', ck('โหมดงาน', 'work mode')],
    ['🔍', ck('ค้นหาไฟล์', 'Find file'), 'palGo', 'search'],
    ['↩️', ck('ย้อนกลับ', 'Undo'), 'palAsk', ck('ย้อนกลับ', 'undo')],
  ];
  return `<div class="pal-tiles">${tiles.map(([ico, label, act, q]) => `<button class="pal-tile" data-act="${act}" data-q="${esc(q)}" data-tab="${esc(q)}"><i>${ico}</i><b>${esc(label)}</b></button>`).join('')}</div>`;
}
function openPalette() {
  const aiOn = !!(cfg.aiEnabled && cfg.hasKey);
  const chips = homeTiles();
  openModal(`<div class="dlg pal"><div class="pal-bar"><input type="text" id="palIn" placeholder="${esc(ck('พิมพ์ที่นี่…', 'Type here…'))}" autocomplete="off"><span class="pal-ai ${aiOn ? 'on' : ''}" id="palMode" title="${esc(t(aiOn ? 'pal_ai_on' : 'pal_ai_off'))}">${aiOn ? '✨ AI' : 'AI ✕'}</span></div><div class="pal-wrap"><div class="pal-res" id="palRes">${chips}</div><button class="pal-cue" id="palCue">↓ ${t('pal_more')}</button></div></div>`);
  palWatch();
  const inp = $('#palIn');
  inp.focus();
  let busy = false;
  inp.onkeydown = async (e) => {
    if (e.key === 'Escape') return closeModal();
    if (e.key !== 'Enter' || !inp.value.trim() || busy) return;
    busy = true; inp.disabled = true; document.querySelector('.dlg.pal')?.classList.add('run');
    $('#palRes').innerHTML = `<div class="pal-busy"><span class="dots"><i></i><i></i><i></i></span> ${t(aiOn ? 'pal_busy_ai' : 'pal_busy_local')}</div>`;
    try {
      const q = inp.value.trim();
      const a = await call('cmd:run', { text: q, history: palHistory() });
      if (!a) { $('#palRes').innerHTML = ''; return; }
      await runAction(a);
      palRemember('user', q); palRemember('app', palSummary(a));
      inp.value = '';
    } finally { busy = false; inp.disabled = false; if ($('#palIn')) inp.focus(); }
  };
}
const viaBadge = (a) => (a.via ? `<div class="pal-via ${a.via}">${t(a.via === 'ai' ? 'pal_via_ai' : 'pal_via_local')}</div>` : '');
/* Continuous conversation: the palette remembers the last few turns (10 min) and every answer ends in a recommendation + a one-click action. */
const palMem = { list: [], at: 0 };
const palHistory = () => { if (Date.now() - palMem.at > 600000) palMem.list = []; return palMem.list.slice(-6); };
const palRemember = (role, text) => { palMem.list.push({ role, text: String(text).slice(0, 300) }); palMem.list = palMem.list.slice(-12); palMem.at = Date.now(); };
function palSummary(a) {
  if (a.action === 'inbox' && a.result && !a.auto) {
    const r = a.result, ad = r.advice || {};
    return `Showed ${r.total} files${r.filter.folder ? ' in folder "' + r.filter.folder + '"' : ''}. ` +
      (ad.movable ? `Offered to move ${ad.movable} files to: ${(ad.groups || []).map((g) => g.to).join(', ')}. ` : 'Nothing has a destination yet. ') +
      (ad.unplaced ? `${ad.unplaced} files have no destination.` : '');
  }
  if (a.action === 'inbox' && a.auto) return `Auto mode: moved ${a.done ?? 0} files without asking (undo available).`;
  if (a.action === 'moveLast') return `Moved ${a.done ?? 0} files as the user confirmed.`;
  return a.message ? String(a.message) : `Ran action ${a.action}.`;
}
function palChips(items) {
  return `<div class="pal-chips">${items.map(([q, label]) => `<button class="sm" data-act="palAsk" data-q="${esc(q)}">${esc(label)}</button>`).join('')}</div>`;
}
function inboxHTML(a) {
  const r = a.result, ad = r.advice || {};
  state.palOffer = ad.movableSrcs || [];
  state.palFolder = r.filter.folder || '';
  if (!r.total) return `<p>${t('pal_inbox_none')}</p>` + palChips([[ck('ไฟล์ไหนยังไม่ถูกจัดหมวดบ้าง', 'which files are not filed yet'), ck('ดูไฟล์ที่ยังไม่ถูกจัด', 'Show unfiled files')]]);
  const head = t(r.filter.scope === 'all' ? 'pal_inbox_head_all' : 'pal_inbox_head', { n: r.total, s: fmtSize(r.bytes) });
  const where = r.filter.folder ? ` <span class="muted">· ${esc(r.filter.folder)}</span>` : '';
  const rows = r.items.map((f) => `<div class="pal-file"><div class="thumb" data-thumb="${esc(f.src)}"><span>${extIcon(f.ext)}</span></div><div class="pf-main"><b title="${esc(f.src)}">${esc(f.name)}</b><small>${esc(f.folder)} · ${fmtSize(f.size)} · ${fmtDate(f.mtime)}${f.sorted && f.conf !== 'low' && f.to ? ' → 📁 ' + esc(f.to) : ''}</small></div><button class="sm" data-act="reveal" data-path="${esc(f.src)}" title="${t('reveal')}">📂</button></div>`).join('');
  // step 2: recommendation, step 3: one-click action
  const rec = ad.movable
    ? `<div class="pal-rec"><b>💡 ${ck(`แนะนำ: ย้าย ${ad.movable} ไฟล์เข้าโฟลเดอร์ที่เหมาะสม`, `Suggestion: file ${ad.movable} files into suitable folders`)}</b>${(ad.groups || []).map((g) => `<div>📁 ${esc(g.to)} <span class="muted">· ${g.n}</span></div>`).join('')}</div>`
    : `<div class="pal-rec"><b>💡 ${ck('ยังไม่มีกฎที่ระบุที่เก็บไฟล์เหล่านี้', 'No rule says where these files belong yet')}</b></div>`;
  const aiOn = !!(cfg.aiEnabled && cfg.hasKey);
  const btns = `<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">`
    + (ad.movable ? `<button class="sm primary" data-act="palMove">⚡ ${ck(`จัดเลย ${ad.movable} ไฟล์`, `File ${ad.movable} files now`)}</button>` : '')
    + (ad.unplaced && aiOn && !a.result.ai ? `<button class="sm" data-act="palAI">✨ ${ck(`ให้ AI ช่วยดูอีก ${ad.unplaced} ไฟล์`, `Let AI look at the other ${ad.unplaced}`)}</button>` : '')
    + `<button class="sm" data-act="palOrganize">${t('pal_inbox_open')}</button><span class="muted" style="font-size:12px">🔒 ${t('pal_inbox_priv')}</span></div>`;
  const chips = palChips([
    ...(ad.unplaced ? [[ck('ไฟล์ที่เหลือล่ะ', 'what about the rest'), ck('ไฟล์ที่เหลือล่ะ', 'And the rest?')]] : []),
    [ck('ล้างไฟล์เก่าที่ไม่ใช้แล้ว', 'clean up old files'), ck('ล้างไฟล์เก่า', 'Clean up old files')],
  ]);
  return `<div class="pal-inbox"><b>${head}</b>${where}${r.total > r.items.length ? ` <span class="muted">· ${t('pal_inbox_more', { n: r.items.length })}</span>` : ''}<div class="pal-files">${rows}</div>${rec}${btns}${chips}</div>`;
}
async function palMove(srcs) {
  const res = $('#palRes');
  pcBusy(ck('กำลังจัดไฟล์…', 'Filing…'));
  const x = await call('cmd:moveSuggested', srcs);
  if (!x) { res.innerHTML = `<p>${ck('ทำไม่สำเร็จ', 'Failed')}</p>`; return 0; }
  res.innerHTML = moveDoneHTML(x, false);
  return x.results.filter((q) => q.ok).length;
}
function moveDoneHTML(x, auto) {
  const ok = x.results.filter((q) => q.ok).length, bad = x.results.length - ok;
  const title = auto ? ck(`⚡ โหมดอัตโนมัติ: จัดให้แล้ว ${ok} ไฟล์`, `⚡ Auto mode: ${ok} files filed`) : ck(`จัดให้แล้ว ${ok} ไฟล์`, `${ok} files filed`);
  return `<div class="pc"><div class="pc-head"><span class="pc-ico">🎉</span><div><b>${title}</b>${bad ? ` <span class="muted">· ${ck(`ไม่สำเร็จ ${bad}`, `${bad} failed`)}</span>` : ''}</div></div>${x.batch ? `<button class="sm" data-act="palUndo" data-id="${esc(x.batch.id)}">↩ ${t('undo')}</button>` : ''}${palChips([[`${state.palFolder || 'downloads'} ${ck('ไฟล์อยู่ในที่ที่เหมาะสมหรือยัง', 'are the files in a suitable place')}`, ck('ดูอีกครั้งว่าเรียบร้อยไหม', 'Check again')]])}</div>`;
}

/* ---------- folder review: scan -> AI -> approve -> apply (visual, animated) ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RV_ICONS = ['🔍', '🤖', '✨'];
const rvTrack = () => `<div class="rv-track" data-at="1"><div class="rv-line-bg"><i></i></div>${[1, 2, 3].map((k) => `<div class="rv-node" id="rvS${k}" data-s="${k === 1 ? 'run' : 'wait'}"><span class="rv-ico">${RV_ICONS[k - 1]}</span><small>${t('rv_s' + k)}</small></div>`).join('')}</div><div class="rv-cap" id="rvCap">${t('rv_step1')}</div>`;
function rvSet(k, s) {
  const el = $('#rvS' + k); if (el) el.dataset.s = s;
  if (s === 'run') { const tr = $('.rv-track'); if (tr) tr.dataset.at = k; const c = $('#rvCap'); if (c) { c.textContent = t('rv_step' + k); c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); } }
}
const scoreTone = (n) => (n >= 75 ? 'good' : n >= 50 ? 'mid' : 'low');
async function reviewFlow(a) {
  const res = $('#palRes');
  res.innerHTML = viaBadge(a) + `<div class="rv">${rvTrack()}<div class="rv-desk" id="rvDesk"></div><div id="rvOut"></div></div>`;
  const sc = await call('review:scan');
  if (!sc) { rvSet(1, 'fail'); return; }
  const desk = $('#rvDesk');
  for (const f of sc.folders.slice(0, 18)) { // folders drop onto the "desk" one by one
    desk.insertAdjacentHTML('beforeend', `<div class="rv-fold ${f.locked ? 'lock' : ''}"><span>${f.locked ? '🔒' : '📁'}</span><small>${esc(f.name)}</small></div>`);
    await sleep(45);
  }
  if (sc.folders.length > 18) desk.insertAdjacentHTML('beforeend', `<div class="rv-fold more"><span>＋${sc.folders.length - 18}</span></div>`);
  rvSet(1, 'done'); rvSet(2, 'run');
  desk.dataset.thinking = '1';
  const r = await call('review:analyze');
  desk.dataset.thinking = '';
  if (!r) { rvSet(2, 'fail'); return; }
  rvSet(2, 'done'); rvSet(3, 'run'); await sleep(300); rvSet(3, 'done');
  desk.classList.add('fold'); // the scan picture folds away so the answer is what you see
  const cap = $('#rvCap'); if (cap) cap.remove();
  const locked = sc.folders.filter((f) => f.locked).length;
  const out = $('#rvOut');
  const hero = `<div class="rv-hero ${scoreTone(r.score)}"><div class="rv-ring"><svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15.5"/><circle class="fg" cx="18" cy="18" r="15.5" style="--p:${r.score}"/></svg><b data-count="${r.score}">0</b></div><div class="rv-say"><small>${t('rv_score')}</small><p>${esc(r.summary)}</p></div></div>`;
  if (!r.suggestions.length) { out.innerHTML = hero + `<div class="rv-fin ok">👍 ${t('rv_none')}</div>`; rvCount(); return; }
  const cards = r.suggestions.map((s, n) => {
    const ico = s.ext ? extIcon(s.ext) : '📁';
    const to = s.type === 'rename' ? `<div class="rv-tile new"><span class="rv-ti">✏️</span><b>${esc(s.to)}</b></div>` : `<div class="rv-tile new"><span class="rv-ti">📥</span><b>${esc(s.into)}</b><small>${t('rv_nest')}</small></div>`;
    return `<label class="rv-card" id="rvc_${s.id}" style="--d:${n * 110}ms"><input type="checkbox" checked data-rv="${s.id}"><span class="rv-tick"></span><div class="rv-pair"><div class="rv-tile old"><span class="rv-ti">${ico}</span><b>${esc(s.folder)}</b></div><div class="rv-flow"><i></i><i></i><i></i></div>${to}</div><span class="rv-state" id="rvst_${s.id}"></span><small class="rv-why">${esc(s.reason)}</small></label>`;
  }).join('');
  out.innerHTML = hero + `<div class="rv-list">${cards}</div><div class="rv-foot"><button class="primary rv-go" id="rvGo">⚡ ${t('rv_apply')} <span id="rvN">${r.suggestions.length}</span></button><span class="muted rv-note">🔒 ${t('rv_priv')}${locked ? ' · ' + t('rv_locked', { n: locked }) : ''}</span></div><div id="rvDone"></div>`;
  rvCount();
  const upd = () => { const n = document.querySelectorAll('[data-rv]:checked').length; const e = $('#rvN'); if (e) e.textContent = n; const b = $('#rvGo'); if (b) b.disabled = !n; };
  document.querySelectorAll('[data-rv]').forEach((x) => { x.onchange = upd; });
  $('#rvGo').onclick = reviewApply;
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function rvCount() { // the score counts up while the ring fills
  const b = document.querySelector('.rv-ring b[data-count]'); if (!b) return;
  const to = +b.dataset.count, t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / 900); b.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function reviewApply() {
  const ids = [...document.querySelectorAll('[data-rv]:checked')].map((x) => x.dataset.rv);
  if (!ids.length) return;
  const btn = $('#rvGo');
  btn.disabled = true; btn.innerHTML = `<span class="dots"><i></i><i></i><i></i></span> ${t('rv_applying')}`;
  document.querySelectorAll('[data-rv]').forEach((x) => { x.disabled = true; });
  for (const id of ids) { const st = $('#rvst_' + id), c = $('#rvc_' + id); if (st) st.innerHTML = '<span class="rv-spin"></span>'; if (c) c.classList.add('busy'); }
  const r = await call('review:apply', ids);
  const reset = () => { btn.disabled = false; btn.innerHTML = `⚡ ${t('rv_apply')}`; document.querySelectorAll('[data-rv]').forEach((x) => { x.disabled = false; }); document.querySelectorAll('.rv-card').forEach((c) => c.classList.remove('busy')); document.querySelectorAll('.rv-state').forEach((s) => { s.innerHTML = ''; }); };
  if (!r) { reset(); return; }
  let ok = 0, bad = 0;
  for (const x of r.results) { // one after another: the old tile slides into the new name, the check pops
    const st = $('#rvst_' + x.id), card = $('#rvc_' + x.id);
    if (card) card.classList.remove('busy');
    if (x.ok) { ok++; if (st) st.innerHTML = '<span class="rv-ok">✓</span>'; if (card) { card.classList.add('done'); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
    else { bad++; if (st) st.innerHTML = '<span class="rv-bad">✕</span>'; if (card) card.classList.add('fail'); }
    await sleep(260);
  }
  btn.remove();
  const done = $('#rvDone');
  done.innerHTML = `<div class="rv-fin ${bad ? '' : 'ok'}"><span class="rv-party">🎉</span><b>${t('rv_done', { n: ok })}</b>${bad ? `<span class="muted">· ${t('rv_fail', { n: bad })}</span>` : ''}${r.batchId ? `<button class="sm" id="rvUndo">↩ ${t('rv_undo')}</button>` : ''}</div>`;
  done.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if ($('#rvUndo')) $('#rvUndo').onclick = async () => {
    const u = await call('journal:undo', r.batchId);
    if (!u) return;
    done.innerHTML = `<div class="rv-fin"><b>${t('rv_undone')}</b></div>`;
    document.querySelectorAll('.rv-card').forEach((c) => { c.classList.remove('done'); c.classList.add('undone'); });
  };
}
/** Tell the user there is more below: a floating arrow shows whenever the answer is taller than the box. */
function palWatch() {
  const res = $('#palRes'), cue = $('#palCue');
  if (!res || !cue) return;
  const upd = () => { cue.classList.toggle('show', res.scrollHeight - res.scrollTop - res.clientHeight > 28); };
  res.addEventListener('scroll', upd);
  new MutationObserver(() => requestAnimationFrame(upd)).observe(res, { childList: true, subtree: true });
  window.addEventListener('resize', upd);
  cue.onclick = () => res.scrollBy({ top: Math.max(160, res.clientHeight * 0.7), behavior: 'smooth' });
}
async function runAction(a) {
  if (window.CK && Object.prototype.hasOwnProperty.call(CK, a.action)) return CK[a.action](a); // layout / clean / organize / setting / goto: preview, then wait for the click
  if (a.action === 'search') { closeModal(); state.searchQ = a.query || ''; go('search'); }
  else if (a.action === 'mode') { closeModal(); await modeFlow(a.mode); }
  else if (a.action === 'review') { await reviewFlow(a); }
  else if (a.action === 'organize') { closeModal(); go('organize'); ACTS.scan(); }
  else if (a.action === 'undo') {
    closeModal();
    const b = ((await call('journal:list')) || []).find((x) => !x.undone);
    if (b) ACTS.undo({ dataset: { id: b.id } });
  } else if (a.action === 'rule' && a.rule) {
    const r = a.rule;
    $('#palRes').innerHTML = viaBadge(a) + `<div class="card" style="margin-top:10px"><b>${t('rule_proposal')}</b><p><b>${esc(r.name || '')}</b><br>${r.pattern ? '<code>' + esc(r.pattern) + '</code> ' : ''}${(r.exts || []).map((e) => '.' + esc(e)).join(' ')} → ${esc(r.dest)}${r.monthly ? ' / yyyy-mm' : ''}</p><button class="primary" id="palAdd">${t('rule_add')}</button></div>`;
    $('#palAdd').onclick = async () => { const c = await call('rules:add', r); if (c) { cfg = c; closeModal(); toast(t('done')); go('rules'); } };
  } else if (a.action === 'inbox' && a.result && a.auto) { state.palFolder = a.result.filter.folder || ''; $('#palRes').innerHTML = viaBadge(a) + moveDoneHTML(a.auto, true); a.done = a.auto.results.filter((q) => q.ok).length; }
  else if (a.action === 'inbox' && a.result) { $('#palRes').innerHTML = viaBadge(a) + inboxHTML(a); loadThumbs(); }
  else if (a.action === 'moveLast') { a.done = await palMove(a.srcs); }
  else { $('#palRes').innerHTML = viaBadge(a) + (a.message ? `<div class="pal-say">💬 ${esc(String(a.message).slice(0, 180))}</div>` : '') + homeTiles(); }
}

/* ---------- actions ---------- */
const ACTS = {
  go: (el) => go(el.dataset.tab),
  palette: openPalette,
  palOrganize() { closeModal(); go('organize'); ACTS.scan(); },
  async palMove() { const n = await palMove(state.palOffer || []); palRemember('app', `Moved ${n} files after the user clicked the button.`); },
  async palAI() {
    pcBusy(ck('ให้ AI ดูไฟล์ที่เหลือ…', 'Asking AI about the remaining files…'));
    const r = await call('cmd:suggestAI', state.palFolder || '');
    if (!r) { $('#palRes').innerHTML = ''; return; }
    const a = { action: 'inbox', result: r, via: 'ai' };
    await runAction(a); palRemember('app', palSummary(a));
  },
  async palUndo(el) { const u = await call('journal:undo', el.dataset.id); if (u) { $('#palRes').innerHTML = `<div class="pc"><b>↩ ${ck('ย้อนกลับให้แล้ว', 'Undone')}</b></div>`; palRemember('app', 'User undid the move.'); } },
  palGo(el) { closeModal(); go(el.dataset.tab); },
  palAsk(el) { const inp = $('#palIn'); if (!inp) return; inp.value = el.dataset.q; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); },
  async scan(opts) {
    state.scanning = true;
    if (!(opts && opts.keepDone === true)) state.done = null;
    if (!(opts && opts.keepNote === true)) state.note = null;
    const box = $('#planBox');
    if (box && !state.plan) box.innerHTML = skeletonHTML(); else if (box) box.style.opacity = '.55';
    const r = await call('plan:build', { useAI: !!$('#useAI')?.checked });
    state.scanning = false;
    if (box) box.style.opacity = '';
    if (!r) { if (box && !state.plan) box.innerHTML = ''; return; }
    state.plan = r;
    state.sel = new Set(r.sources.flatMap((s) => s.items).filter((i) => i.confidence !== 'low').map((i) => i.src));
    state.useName = new Set();
    if (state.tab === 'organize' && $('#planBox')) { $('#planBox').innerHTML = planHTML(); afterPlanRender(); }
  },
  selAll() { state.sel = new Set(state.plan.sources.flatMap((s) => s.items).map((i) => i.src)); refreshSelection(); },
  selHigh() { state.sel = new Set(state.plan.sources.flatMap((s) => s.items).filter((i) => i.confidence === 'high').map((i) => i.src)); refreshSelection(); },
  selNone() { state.sel = new Set(); refreshSelection(); },
  tileTog(el) { const k = el.dataset.src; state.sel.has(k) ? state.sel.delete(k) : state.sel.add(k); refreshSelection(); },
  cardTog(el) {
    const g = groupPlan(state.plan).find((x) => x.key === el.dataset.key);
    if (!g) return;
    const all = g.items.every((i) => state.sel.has(i.src));
    for (const i of g.items) all ? state.sel.delete(i.src) : state.sel.add(i.src);
    refreshSelection();
  },
  nameTog(el) { const k = el.dataset.src; state.useName.has(k) ? state.useName.delete(k) : state.useName.add(k); $('#planBox').innerHTML = planHTML(); afterPlanRender(); },
  expand(el) { state.expanded.add(el.dataset.key); $('#planBox').innerHTML = planHTML(); afterPlanRender(); },
  noteClose() { state.note = null; $('#planBox').innerHTML = planHTML(); afterPlanRender(); },
  async qrOpen(el) {
    const f = state.plan.sources.flatMap((x) => x.unmatched).find((u) => u.src === el.dataset.src);
    if (!f) return;
    const ext = (f.ext || '').toLowerCase(), stem = f.name.replace(/\.[^.]+$/, ''), g = qrGroupOf(ext);
    qr.file = f; qr.prev = null;
    qr.d = { ext, useExt: !!ext, word: qrSuggestWord(stem), useWord: !ext, dest: g ? t('sg_' + g) : ext ? ext.toUpperCase() : qrSuggestWord(stem), monthly: false };
    if (!rl.folders.length) rl.folders = (await call('rules:folders')) || [];
    qrDialog();
  },
  qrSug(el) { $('#qrDest').value = el.dataset.v; $('#qrDest').dispatchEvent(new Event('input')); },
  doneClose() { state.done = null; $('#planBox').innerHTML = planHTML(); afterPlanRender(); },
  async apply() {
    const items = state.plan.sources.flatMap((s) => s.items).filter((i) => state.sel.has(i.src)).map((i) => ({ ...i, newName: state.useName.has(i.src) ? i.newName : null }));
    if (!items.length) return;
    $('#goBtn').disabled = true;
    // files fly into their folders
    document.querySelectorAll('.tile.sel:not(.left)').forEach((el, i) => { el.style.transitionDelay = Math.min(i * 22, 500) + 'ms'; el.classList.add('fly'); });
    await new Promise((r) => setTimeout(r, Math.min(900, 380 + items.length * 22)));
    const r = await call('plan:apply', { items, label: 'Organize' });
    if (!r) { ACTS.scan({ keepDone: true }); return; }
    const okSrc = new Set(r.results.filter((x) => x.ok).map((x) => x.src));
    state.done = { n: okSrc.size, bad: r.results.length - okSrc.size, m: new Set(items.filter((i) => okSrc.has(i.src)).map((i) => i.dest)).size, batch: r.batch?.id };
    for (const o of r.trustOffers || []) {
      if (await ask({ title: t('trust_add'), body: esc(t('trust_offer', { c: o.label })), confirmOnly: true })) cfg = await call('trust:set', { category: o.category, value: true });
    }
    await ACTS.scan({ keepDone: true }); toTop();
  },
  async undo(el) {
    const r = await call('journal:undo', el.dataset.id);
    if (!r) return;
    toast(t('undone', { n: r.ok }));
    if (state.tab === 'history') renderHistory(); else if (state.tab === 'organize') ACTS.scan();
  },
  async inboxApply(el) { const r = await call('inbox:apply', [el.dataset.src]); if (r) toast(t('moved_n', { n: r.results.filter((x) => x.ok).length }), { undoId: r.batch?.id }); renderAuto(); },
  async inboxAll() { const r = await call('inbox:apply', state.inbox.map((i) => i.src)); if (r) toast(t('moved_n', { n: r.results.filter((x) => x.ok).length }), { undoId: r.batch?.id }); renderAuto(); },
  async inboxDismiss(el) { await call('inbox:dismiss', [el.dataset.src]); renderAuto(); },
  async autoAddFolder() { const c = await call('cfg:addFolder'); if (c) { cfg = c; renderAuto(); } },
  async autoRmFolder(el) {
    const c = await call('cfg:set', { folders: cfg.folders.filter((f) => f !== el.dataset.path) });
    if (c) { cfg = c; renderAuto(); }
  },
  async watchTog() { const c = await call('cfg:set', { watch: !cfg.watch }); if (c) { cfg = c; renderAuto(); } },
  async setLevel(el) { const c = await call('cfg:set', { autoMode: el.dataset.mode }); if (c) { cfg = c; renderAuto(); } },
  async folderTog(el) {
    const off = new Set(cfg.watchOff || []);
    off.has(el.dataset.path) ? off.delete(el.dataset.path) : off.add(el.dataset.path);
    const c = await call('cfg:set', { watchOff: [...off] });
    if (c) { cfg = c; renderAuto(); }
  },
  async trustOn(el) { const c = await call('trust:set', { category: el.dataset.cat, value: true }); if (c) { cfg = c; renderAuto(); } },
  async unpin(el) { await call('pin:remove', { path: el.dataset.path }); toast(t('done')); setTimeout(renderAuto, 600); },
  async revoke(el) { cfg = await call('trust:set', { category: el.dataset.cat, value: false }); renderAuto(); },
  async sugAccept(el) { cfg = await call('suggest:accept', { ext: el.dataset.ext }); renderAuto(); },
  async sugDismiss(el) { cfg = await call('suggest:dismiss', { ext: el.dataset.ext }); renderAuto(); },

  async guardScan() {
    const g = state.gd;
    g.busy = true; gdRerender();
    const [r, vst] = await Promise.all([call('guard:scan'), call('vault:status')]);
    g.busy = false;
    if (vst) g.vst = vst;
    if (!r) { g.findings = g.findings || []; g.scanned = Date.now(); gdRerender(); return; }
    g.findings = r.findings; g.vault = r.vault; g.ignored = r.ignored || []; g.scanned = Date.now();
    gdRerender();
  },
  async toVault(el) {
    if (!(await vaultEnsureUnlocked())) return;
    const card = [...document.querySelectorAll('.gcard')].find((c) => c.dataset.path === el.dataset.path);
    const r = await call('vault:add', { file: el.dataset.path });
    if (!r) return;
    if (card) { card.classList.add('fly'); await new Promise((res) => setTimeout(res, 450)); }
    state.gd.findings = state.gd.findings.filter((f) => f.path !== el.dataset.path);
    state.gd.vault.push(r);
    state.gd.vst = await call('vault:status');
    gdRerender();
    toast(t('g_vaulted'), { ms: 6000 });
  },
  async trashOne(el) {
    const card = [...document.querySelectorAll('.gcard')].find((c) => c.dataset.path === el.dataset.path);
    const r = await call('cleanup:trash', [el.dataset.path]);
    if (!r) return;
    if (card) { card.classList.add('fly'); await new Promise((res) => setTimeout(res, 450)); }
    state.gd.findings = state.gd.findings.filter((f) => f.path !== el.dataset.path);
    gdRerender();
    toast(t('trashed', { n: r.trashed }));
  },
  async gdIgnore(el) {
    await call('guard:ignore', { path: el.dataset.path });
    ACTS.guardScan();
  },
  async gdUnignore(el) { await call('guard:unignore', { path: el.dataset.path }); ACTS.guardScan(); },
  async vSetupNow() { if (await vaultSetupFlow()) { state.gd.vst = await call('vault:status'); gdRerender(); } },
  async vLock() { await call('vault:lock'); state.gd.vst = await call('vault:status'); gdRerender(); },
  async vChange() {
    if (!(await vaultEnsureUnlocked())) return;
    if (await vaultChangeFlow(state.gd.vst.hint)) { state.gd.vst = await call('vault:status'); toast(t('vc_saved'), { ms: 4000 }); gdRerender(); }
  },
  async vView(el) {
    if (!(await vaultEnsureUnlocked())) return;
    const r = await call('vault:view', { id: el.dataset.id });
    if (r) toast(t('v_view_toast', { n: r.minutes }), { ms: 9000 });
  },
  async vRestore(el) {
    if (!(await vaultEnsureUnlocked())) return;
    if (!(await ask({ title: t('v_restore'), body: esc(t('v_restore_confirm')), confirmOnly: true }))) return;
    const r = await call('vault:restore', { id: el.dataset.id });
    if (!r) return;
    state.gd.vault = state.gd.vault.filter((v) => v.id !== el.dataset.id);
    toast(t('v_restored'), { ms: 6000 });
    ACTS.guardScan();
  },
  async vLegacyRestore(el) {
    const pass = await ask({ title: t('v_legacy_restore'), password: true, placeholder: t('v_pass_old') });
    if (!pass) return;
    const r = await call('vault:legacyRestore', { id: el.dataset.id, pass });
    if (!r) return;
    state.gd.vault = state.gd.vault.filter((v) => v.id !== el.dataset.id);
    toast(t('v_restored'), { ms: 6000 });
    ACTS.guardScan();
  },
  async vMigrate(el) {
    if (!(await vaultEnsureUnlocked())) return;
    const pass = await ask({ title: t('v_upgrade'), body: esc(t('v_upgrade_hint')), password: true, placeholder: t('v_pass_old') });
    if (!pass) return;
    const r = await call('vault:migrate', { id: el.dataset.id, pass });
    if (r) { state.gd.vault = r; gdRerender(); toast(t('done')); }
  },
  async vRemove(el) {
    if (!(await ask({ title: t('remove'), body: esc(t('v_remove_confirm')), confirmOnly: true }))) return;
    await call('vault:remove', el.dataset.id);
    state.gd.vault = state.gd.vault.filter((v) => v.id !== el.dataset.id);
    gdRerender();
  },

  async clQuick() {
    const c = state.cl;
    c.quickBusy = true;
    await Promise.all([clRun('captures'), clRun('unused')]);
    c.quickBusy = false; c.quickDone = true;
  },
  clScanKey(el) { return clRun(el.dataset.key); },
  clOpen(el) { const c = state.cl; c.open = c.open === el.dataset.key ? null : el.dataset.key; clRerender(); if (c.open) setTimeout(() => document.querySelector('.cpanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60); },
  clTog(el) {
    const c = state.cl, set = el.dataset.key === 'unused' ? c.selUn : c.sel, p = el.dataset.path;
    set.has(p) ? set.delete(p) : set.add(p);
    clRefreshSel();
  },
  clSelAll(el) { const c = state.cl, set = el.dataset.key === 'unused' ? c.selUn : c.sel; clItems(el.dataset.key).forEach((i) => set.add(i.path)); clRefreshSel(); },
  clSelNone(el) { const c = state.cl, set = el.dataset.key === 'unused' ? c.selUn : c.sel; clItems(el.dataset.key).forEach((i) => set.delete(i.path)); clRefreshSel(); },
  clDoneClose() { state.cl.done = null; clRerender(); },
  async clTrash() {
    const c = state.cl, paths = [...c.sel];
    if (!paths.length) return;
    const bytes = ['captures', 'installers', 'dupes', 'similar'].flatMap((k) => clItems(k)).filter((i) => c.sel.has(i.path)).reduce((a, i) => a + (i.size || 0), 0);
    if (!(await ask({ title: t('cl_trash_n', { n: paths.length, s: fmtSize(bytes) }), body: esc(t('cl_confirm')), confirmOnly: true }))) return;
    document.querySelectorAll('.cpanel .tile.sel').forEach((el, i) => { el.style.transitionDelay = Math.min(i * 20, 400) + 'ms'; el.classList.add('fly'); });
    await new Promise((r) => setTimeout(r, Math.min(800, 350 + paths.length * 20)));
    const r = await call('cleanup:trash', paths);
    if (!r) { clRerender(); return; }
    const gone = new Set(paths);
    const d = c.data;
    if (d.captures) d.captures = d.captures.filter((x) => !gone.has(x.path));
    if (d.installers) d.installers = d.installers.filter((x) => !gone.has(x.path));
    if (d.dead) d.dead = d.dead.filter((x) => !gone.has(x.path));
    if (d.dupes) d.dupes = d.dupes.map((g) => ({ ...g, files: g.files.filter((f) => f.path === g.keep || !gone.has(f.path)) })).filter((g) => g.files.length > 1);
    if (d.similar) d.similar = { ...d.similar, groups: d.similar.groups.map((g) => ({ ...g, files: g.files.filter((f) => f.path === g.keep || !gone.has(f.path)) })).filter((g) => g.files.length > 1) };
    c.sel = new Set();
    c.done = { n: r.trashed, bytes };
    clRerender(); toTop();
  },
  async parkUnused() {
    const c = state.cl, paths = [...c.selUn];
    if (!paths.length) return;
    const r = await call('cleanup:parkUnused', paths);
    if (!r) return;
    toast(t('moved_n', { n: r.moved }) + (r.failed ? ' · ' + t('failed_n', { n: r.failed }) : ''), { undoId: r.batch, ms: 12000 });
    c.status.unused = 'idle'; c.data.unused = undefined; c.open = null;
    clRun('unused');
  },

  async layPlan() {
    if (lay.busy) return;
    lay.busy = true; lay.error = null; lay.prev = lay.plan ? layNowIcons() : null; lay.done = null;
    if (!lay.plan) layRefresh(false); else { const btn = document.querySelector('[data-act=layPlan]'); if (btn) btn.disabled = true; }
    const r = await call('layout:plan', { protectPct: lay.level, sort: lay.sort, dir: lay.dir, mode: lay.mode });
    lay.busy = false;
    if (state.tab !== 'layout') return;
    if (!r) { lay.error = lay.error || 'unknown'; layRefresh(false); return; }
    if (r.error) { lay.error = r.error; lay.plan = null; layRefresh(false); return; }
    lay.plan = r;
    if (!r.wallpaper.thumb) lay.img = null; // plain mode on a PC without a readable wallpaper: paint a neutral backdrop
    else if (!lay.img || lay.img.dataset.src !== r.wallpaper.thumb) {
      lay.img = new Image(); lay.img.dataset.src = r.wallpaper.thumb;
      await new Promise((res) => { lay.img.onload = res; lay.img.onerror = res; lay.img.src = r.wallpaper.thumb; });
    }
    const b = await call('layout:hasBackup'); if (b) lay.backup = b;
    renderLayout();
    layDraw(true);
  },
  layMode(el) {
    if (lay.busy || el.dataset.v === lay.mode) return;
    lay.mode = el.dataset.v === 'plain' ? 'plain' : 'wallpaper';
    lay.prev = lay.plan ? layNowIcons() : null;
    lay.error = null; lay.plan = null; // the plan depends on the mode: build it again
    ACTS.layPlan();
  },
  layLevel(el) {
    if (!lay.plan) return;
    lay.prev = layVariant().icons;
    lay.level = Number(el.dataset.v);
    layRefresh(true);
  },
  laySort(el) {
    if (lay.busy) return;
    const k = el.dataset.v;
    if (k === lay.sort && k !== 'current') lay.dir = lay.dir === 'asc' ? 'desc' : 'asc'; // click the active key again to flip direction
    else { lay.sort = k; lay.dir = 'asc'; }
    ACTS.layPlan();
  },
  layDoneClose() { lay.done = null; layRefresh(false); },
  async layApply() {
    const v = layVariant();
    const ok = await ask({ title: t('lay_apply'), body: esc(t('lay_confirm', { n: lay.plan.count })), confirmOnly: true });
    if (!ok) return;
    const r = await call('layout:apply', { protectPct: lay.level, sort: lay.sort, dir: lay.dir, mode: lay.mode });
    if (!r) return;
    if (r.error) { toast(layoutMessage(r.error), { ms: 12000 }); return; }
    lay.done = { n: r.moved };
    lay.plan = null;
    const b = await call('layout:hasBackup'); if (b) lay.backup = b;
    renderLayout(); toTop();
    void v;
  },
  async layRestore() {
    const r = await call('layout:restore');
    if (!r) return;
    if (r.error) { toast(layoutMessage(r.error)); return; }
    toast(t('lay_restored', { n: r.moved }), { ms: 10000 });
    lay.plan = null; lay.done = null;
    renderLayout();
  },
  mdPick(el) { state.md.sel = el.dataset.mode; mdRerender(); },
  async mdApply() {
    const m = state.md, mode = m.sel;
    const r = await call('mode:apply', mode);
    if (!r) return;
    cfg = await call('cfg:get');
    toast(t('mode_applied', { n: r.moved }) + (r.failed ? ' · ' + t('failed_n', { n: r.failed }) : ''), { ms: 6000 });
    state.md.loaded = false; state.md.sel = r.failed ? mode : mode;
    loadModes();
  },
  asMore(el) { const s = state.md.open; s.has(el.dataset.kind) ? s.delete(el.dataset.kind) : s.add(el.dataset.kind); mdRerender(); },
  asTog() { asSave((cur) => { cur.enabled = !cur.enabled; }); },
  asSched() { asSave((cur) => { cur.schedule = cur.schedule.length ? [] : [{ mode: 'work', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }]; }); },
  asDay(el) { asSave((cur) => { const s0 = asSched0(cur), d = Number(el.dataset.d); s0.days = s0.days.includes(d) ? s0.days.filter((x) => x !== d) : [...s0.days, d].sort(); }); },
  asDel(el) { asSave((cur) => { cur.processes[el.dataset.kind] = cur.processes[el.dataset.kind].filter((p) => p !== el.dataset.v); }); },
  async reindex() { await call('search:reindex'); state.sr.data = null; const q = $('#q'); q && q.value ? runSearch() : renderSearch(); },
  sClear() { const q = $('#q'); q.value = ''; runSearch(); q.focus(); },
  sDate(el) {
    const all = [...t('sd_list').split('|'), ...I18N.th.sd_list.split('|'), ...I18N.en.sd_list.split('|')];
    const q = $('#q'); let v = q.value;
    const had = v.includes(el.dataset.v);
    for (const d of all) v = v.split(d).join(' ');
    v = v.replace(/\s+/g, ' ').trim();
    q.value = had ? v : (v + ' ' + el.dataset.v).trim();
    runSearch(); q.focus();
  },
  sExample(el) { $('#q').value = el.dataset.v; runSearch(); },
  sFilter(el) { state.sr.filter = state.sr.filter === el.dataset.g ? null : el.dataset.g; const b = $('#srBody'); if (b) { b.innerHTML = srBodyHTML(); loadThumbs(); } },
  rOpen(el) { call('shell:open', el.dataset.path); },
  async rCopy(el) { try { await navigator.clipboard.writeText(el.dataset.path); toast(t('sr_copied'), { ms: 2500 }); } catch { /* blocked */ } },
  reveal: (el, e) => { e?.preventDefault?.(); call('shell:reveal', el.dataset.path); },

  async snapNow() { await call('snap:take'); renderHistory(); },
  async tmDay(el) {
    const d = el.dataset.date, hs = state.hs;
    hs.day = hs.day === d ? null : d;
    hs.diff = null; hs.diffDate = null;
    hsRerender();
    if (hs.day && hs.snaps.includes(hs.day)) hsLoadDiff(hs.day);
  },
  async snapRestore(el) { const r = await call('snap:restore', el.dataset.date); if (r) { toast(t('restored_n', { r: r.restored.length, n: r.notFound.length }), { ms: 7000 }); hsLoadDiff(el.dataset.date); const [bt] = await Promise.all([call('journal:list')]); if (bt) { state.hs.batches = bt; hsRerender(); } } },

  async rlNew() { rl.draft = rlBlank(); rl.edit = null; rl.prev = null; rl.open = true; rlRerender(); setTimeout(() => document.querySelector('.rl-in')?.focus(), 50); },
  async rlEdit(el) {
    const r = cfg.rules.find((x) => x.id === el.dataset.id);
    if (!r) return;
    rl.draft = rlFromRule(r); rl.edit = r.id; rl.open = true; rl.prev = null; rlRerender(); rlTest();
    document.querySelector('.rb')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  rlCancel() { rl.open = false; rl.edit = null; rlRerender(); },
  rlType(el) { const g = el.dataset.g, a = rl.draft.types; rl.draft.types = a.includes(g) ? a.filter((x) => x !== g) : [...a, g]; rlRerender(); rlTest(); },
  async rlSave() {
    const rule = rlRule(rl.draft);
    if (!rlValid(rule)) return;
    const c = rl.edit ? await call('rules:update', { id: rl.edit, rule }) : await call('rules:add', rule);
    if (!c) return;
    cfg = c; rl.open = false; rl.edit = null; rlRerender(); rlLoadCounts();
    toast(t('rl_saved'), { ms: 4000 });
  },
  async ruleTog(el) { const c = await call('rules:toggle', el.dataset.id); if (c) { cfg = c; rlRerender(); } },
  async ruleDel(el) { if (!(await ask({ title: t('del'), body: esc(t('rl_del_confirm')), confirmOnly: true }))) return; cfg = await call('rules:delete', el.dataset.id); rlRerender(); rlLoadCounts(); },
  async packAdd(el) { const c = await call('rules:pack', el.dataset.id); if (c) { cfg = c; renderRules(); } },
  async rulesExport() { const r = await call('rules:export'); if (r && r.file) toast(t('done')); },
  async rulesImport() { const r = await call('rules:import'); if (r && r.cfg) { cfg = r.cfg; toast(t('imported_n', { n: r.imported })); renderRules(); } },

  async addFolder() { const c = await call('cfg:addFolder'); if (c) { cfg = c; renderSettings(); } },
  async rmFolder(el) { const f = cfg.folders.filter((_, i) => i !== Number(el.dataset.i)); const c = await call('cfg:set', { folders: f }); if (c) { cfg = c; renderSettings(); } },
  aiAdd() { aiui.form = { id: null, provider: 'anthropic', label: '', model: '', baseUrl: '' }; renderSettings(); reveal('.aiform'); },
  aiCancel() { aiui.form = null; renderSettings(); },
  aiEdit(el) {
    const c = cfg.aiConns.find((x) => x.id === el.dataset.id); if (!c) return;
    aiui.form = { id: c.id, provider: c.provider, label: c.label, model: c.model, baseUrl: c.baseUrl || '' }; renderSettings(); reveal('.aiform');
  },
  aiPickProv(el) {
    const f = aiui.form; if (!f) return;
    const old = aiPreset(f.provider);
    f.label = (($('#aiLabel') || {}).value || '').trim(); f.model = (($('#aiModel') || {}).value || '').trim(); f.baseUrl = (($('#aiBase') || {}).value || '').trim();
    if (f.label === old.name) f.label = ''; // untouched default name follows the provider
    if (f.model === old.model) f.model = '';
    if (f.baseUrl === old.baseUrl) f.baseUrl = '';
    f.provider = el.dataset.p; renderSettings();
  },
  async aiSaveConn() {
    const f = aiui.form; if (!f) return;
    const val = (id) => (($(id) || {}).value || '').trim();
    const r = await call('ai:conn:save', { id: f.id, provider: f.provider, label: val('#aiLabel'), model: val('#aiModel'), baseUrl: val('#aiBase'), key: val('#aiKeyIn') });
    if (!r) return;
    cfg = r.cfg; aiui.form = null; renderSettings();
    ACTS.aiTest({ dataset: { id: r.id } });
  },
  async aiUse(el) { const c = await call('ai:conn:activate', el.dataset.id); if (c) { cfg = c; renderSettings(); } },
  async aiDel(el) {
    const ok = await ask({ title: t('ai_del_t'), body: esc(t('ai_del_b')), confirmOnly: true });
    if (!ok) return;
    const c = await call('ai:conn:remove', el.dataset.id); if (c) { cfg = c; delete aiui.res[el.dataset.id]; renderSettings(); }
  },
  async aiTest(el) {
    const id = el.dataset.id;
    aiui.res[id] = { busy: true }; renderSettings();
    const r = await bridge.invoke('ai:test', id);
    aiui.res[id] = r && !r.error ? { ok: true, ms: r.ms, reply: r.reply } : { ok: false, msg: String((r && r.error) || 'failed').slice(0, 240) };
    if (state.tab === 'settings') renderSettings();
  },
  dropOpen: () => call('drop:open'),
  noticeTest: () => call('notice:test'),
  async setTog(el) {
    const k = el.dataset.k, cur = cfg[k] === undefined ? el.dataset.def === '1' : !!cfg[k];
    const c = await call('cfg:set', { [k]: !cur });
    if (c) { cfg = c; renderSettings(); }
  },
  async setSeg(el) {
    const k = el.dataset.k, v = /^\d+$/.test(el.dataset.v) ? Number(el.dataset.v) : el.dataset.v;
    const c = await call('cfg:set', { [k]: v });
    if (!c) return;
    cfg = c;
    if (k === 'lang') { renderNav(); RENDER[state.tab](); } else renderSettings();
  },
  async wxTog() {
    const ts = await call('theme:get');
    if (!ts.weather.place) { wxEditing = true; wxMsg = t('wx_pick_first'); return themeRefresh(ts); }
    themeRefresh(await call('weather:set', { on: !ts.weather.on }));
  },
  async wxSearch() {
    const q = ($('#wxQ') || {}).value || '';
    const r = await call('weather:search', { q });
    wxFound = (r && r.places) || []; wxMsg = r && r.error ? t('wx_err') : wxFound.length ? '' : t('wx_nocity');
    themeRefresh();
  },
  async wxPick(el) {
    const p = wxFound[Number(el.dataset.i)];
    if (!p) return;
    wxEditing = false; wxFound = []; wxMsg = '';
    themeRefresh(await call('weather:set', { place: p, on: true }));
  },
  wxChange() { wxEditing = true; wxFound = []; wxMsg = ''; themeRefresh().then(() => { const q = $('#wxQ'); if (q) q.focus({ preventScroll: true }); reveal('.wx-find'); }); },
  async updCheck() { await renderUpdate({ status: 'checking', version: cfg.version || '' }); renderUpdate(await call('update:check')); },
  async updDownload() { await call('update:download'); renderUpdate(); },
  updInstall: () => call('update:install'),
};

document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'wxQ') ACTS.wxSearch(); });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTS[el.dataset.act];
  if (fn) { Promise.resolve(fn(el, e)).catch((err) => window.__errors.push(String(err))); }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-chg]');
  if (!el) return;
  const k = el.dataset.chg;
  if (k === 'astime') asTime(el);
  else if (k === 'laymask') { lay.mask = el.checked; layDraw(false); }
  else if (k === 'srange') { const c = await call('cfg:set', { [el.dataset.k]: Number(el.value) }); if (c) cfg = c; }
  else if (k === 'rlchk') { rl.draft[el.dataset.f] = el.checked; if (el.dataset.f === 'advanced') { rlRerender(); } rlTest(); }
  else if (k === 'ruleToggle') { cfg = await call('rules:toggle', el.dataset.id); }
  else if (['includeShortcuts', 'widget', 'widgetTop', 'notify', 'watch', 'autoMode', 'aiEnabled', 'aiFallback', 'aiPrivacy', 'aiRename', 'cmdAuto', 'startup', 'lang'].includes(k)) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const c = await call('cfg:set', { [k]: v });
    if (c && k === 'includeShortcuts') { cfg = c; if (state.tab === 'organize') ACTS.scan(); return; }
    if (c) { cfg = c; if (k === 'lang') { renderNav(); RENDER[state.tab](); } else if (k === 'aiEnabled') renderSettings(); }
  } else if (k === 'watchFolder') {
    const off = new Set(cfg.watchOff || []);
    el.checked ? off.delete(el.dataset.path) : off.add(el.dataset.path);
    const c = await call('cfg:set', { watchOff: [...off] });
    if (c) { cfg = c; renderAuto(); }
  } else if (k === 'notifySec') {
    const c = await call('cfg:set', { notifySec: parseInt(el.value, 10) });
    if (c) cfg = c;
  } else if (k === 'staleDays' || k === 'installerDays') {
    const n = Math.max(1, parseInt(el.value, 10) || 30);
    const c = await call('cfg:set', { [k]: n });
    if (c) cfg = c;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('srange')) { const v = $('#val-' + e.target.dataset.k); if (v) v.textContent = e.target.value; return; }
  if (e.target.classList && e.target.classList.contains('rl-in') && rl.draft) { rl.draft[e.target.dataset.f] = e.target.value; clearTimeout(rl.timer); rl.timer = setTimeout(rlTest, 280); const sv = $('#rlSave'); if (sv) sv.disabled = !rlValid(rlRule(rl.draft)); return; }
  if (e.target.id === 'q') { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('padd')) { e.preventDefault(); asAdd(e.target); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'Escape' && !$('#modal').hidden && !document.querySelector('.dlg.nodismiss')) closeModal();
});

/* ---------- boot ---------- */
(async function init() {
  cfg = await bridge.invoke('cfg:get');
  bridge.on('toast', (m) => toast(m, { ms: 10000 }));
  bridge.on('palette:open', openPalette);
  bridge.on('nav', (tab) => { if (RENDER[tab]) { go(tab); if (tab === 'organize') ACTS.scan(); } });
  bridge.on('inbox:changed', async () => { cfg = await bridge.invoke('cfg:get'); state.inbox = (await bridge.invoke('inbox:list')) || []; renderNav(); if (state.tab === 'auto') renderAuto(); });
  state.inbox = (await bridge.invoke('inbox:list')) || [];
  go('organize');
})();
