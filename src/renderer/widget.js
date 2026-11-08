const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = {
  th: { title: 'เก็บล่าสุด · ไฟล์ไปอยู่ไหน', todayShort: 'วันนี้', today: (n) => `วันนี้จัดแล้ว ${n} ไฟล์`, none: 'ยังไม่มีไฟล์ที่จัด รอไฟล์ใหม่เข้ามา…', auto: 'อัตโนมัติ', now: 'เมื่อกี้', m: (n) => `${n} นาทีก่อน`, h: (n) => `${n} ชม.ก่อน`, d: (n) => `${n} วันก่อน`, open: 'เปิดจัดโต๊ะ', fold: 'ย่อ', unfold: 'ขยาย', hide: 'ซ่อน', foldTip: 'ย่อวิดเจ็ตให้เหลือแค่หัว', unfoldTip: 'ขยายดูรายการล่าสุด', hideTip: 'ซ่อนวิดเจ็ต (เปิดกลับได้จากไอคอนถาดระบบ/ตั้งค่า)', openTip: 'เปิดหน้าต่างจัดโต๊ะ', reveal: 'ดูไฟล์' },
  en: { title: 'Recently filed · and where', todayShort: 'today', today: (n) => `${n} filed today`, none: 'Nothing filed yet — waiting for new files…', auto: 'auto', now: 'just now', m: (n) => `${n} min ago`, h: (n) => `${n} h ago`, d: (n) => `${n} d ago`, open: 'Open Bank JadToh', fold: 'Collapse', unfold: 'Expand', hide: 'Hide', foldTip: 'Shrink to the header', unfoldTip: 'Show recent files', hideTip: 'Hide widget (bring it back from the tray icon / Settings)', openTip: 'Open the Bank JadToh window', reveal: 'Show file' },
};
const ICON = { captures: '📸', images: '🖼️', documents: '📄', spreadsheets: '📊', presentations: '📽️', videos: '🎬', audio: '🎵', archives: '🗜️', installers: '💿', code: '💻', design: '🎨', fonts: '🔤', project: '🧩' };
let lang = 'th', data = { items: [], todayCount: 0 }, collapsed = false;

const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000), t = L[lang];
  if (s < 60) return t.now;
  if (s < 3600) return t.m(Math.floor(s / 60));
  if (s < 86400) return t.h(Math.floor(s / 3600));
  return t.d(Math.floor(s / 86400));
};

const COL = { captures: '#38bdf8', images: '#34d399', documents: '#60a5fa', spreadsheets: '#4ade80', presentations: '#fb923c', videos: '#f472b6', audio: '#c084fc', archives: '#fbbf24', installers: '#facc15', code: '#22d3ee', design: '#fb7185', fonts: '#a3a3a3', project: '#a78bfa' };
const SC = '<svg class="scico" viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5" fill="#fff" stroke="currentColor" stroke-width="1.8"/><path d="M9.2 14.8 L15 9 M10.2 9 H15 V13.8" fill="none" stroke="#2f6bff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function render() {
  const t = L[lang], th = window.__theme || {};
  $('t1').textContent = 'แบงค์ จัดโต๊ะ';
  $('t2').textContent = t.title;
  $('n1').textContent = data.todayCount; $('n2').textContent = t.todayShort;
  $('dc').textContent = th.deco || '';
  $('hi').textContent = th.hi ? th.hi[lang] : '';
  $('openT').textContent = t.open; $('closeT').textContent = t.hide; $('foldT').textContent = collapsed ? t.unfold : t.fold;
  $('open').title = t.openTip; $('close').title = t.hideTip; $('fold').title = collapsed ? t.unfoldTip : t.foldTip;
  $('foldI').innerHTML = collapsed ? '<path d="M6 9l6 6 6-6"/>' : '<path d="M6 15l6-6 6 6"/>';
  $('w').classList.toggle('col', collapsed);
  $('empty').hidden = data.items.length > 0 || collapsed;
  $('emptyT').textContent = t.none;
  $('list').innerHTML = data.items.map((i, n) => {
    const cat = i.category || '', col = i.category && i.category.startsWith('sc:') ? '#38c8a0' : cat.startsWith('rule:') ? '#8b9dff' : COL[cat] || '#8e9bb8';
    const icon = ICON[cat] || (cat.startsWith('rule:') ? '📐' : cat.startsWith('sc:') ? SC : '📁');
    return `<li class="${Date.now() - i.time < 120000 ? 'new' : ''}" data-p="${esc(i.full)}" style="animation-delay:${n * 45}ms" title="${esc(i.full)}">
    <div class="ic" style="--c:${col}">${icon}</div>
    <div class="tx"><div class="nm">${esc(i.name)}</div><div class="to">📁 ${esc(i.folder)}</div></div>
    <div class="tm">${esc(ago(i.time))}${i.auto ? `<br><span class="a">⚡ ${t.auto}</span>` : ''}</div><span class="go">${t.reveal} ›</span></li>`;
  }).join('');
  requestAnimationFrame(() => window.api.invoke('widget:size', { h: Math.ceil(document.body.scrollHeight) }));
}

async function refresh() {
  const r = await window.api.invoke('widget:data');
  if (r && !r.error) { data = r; lang = r.lang || lang; collapsed = !!r.collapsed; render(); }
}

$('list').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) window.api.invoke('widget:reveal', li.dataset.p); });
$('fold').onclick = async () => { collapsed = !collapsed; await window.api.invoke('widget:collapse', collapsed); render(); };
$('close').onclick = () => window.api.invoke('widget:hide');
$('open').onclick = () => window.api.invoke('widget:open');
window.api.on('widget', refresh);
window.addEventListener('themechange', render);
setInterval(render, 30000); // keep "x min ago" fresh
refresh();
