const stack = document.getElementById('stack');
const DURATION = 7000;
const EXTI = { pdf: '📕', doc: '📄', docx: '📄', txt: '📝', md: '📝', xls: '📊', xlsx: '📊', csv: '📊', ppt: '📽️', pptx: '📽️', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🎨', mp4: '🎬', mov: '🎬', mkv: '🎬', mp3: '🎵', wav: '🎵', zip: '🗜️', rar: '🗜️', '7z': '🗜️', exe: '💿', msi: '💿', js: '💻', py: '💻', html: '💻', lnk: '🔗' };
const extIcon = (n) => EXTI[String(n).split('.').pop().toLowerCase()] || '📄';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function resize() {
  requestAnimationFrame(() => window.api.invoke('notice:size', { h: stack.children.length ? document.body.scrollHeight : 0 }));
}

function dismiss(card) {
  if (!card.isConnected || card.classList.contains('out')) return;
  card.classList.add('out');
  card._life?.stop();
  setTimeout(() => { card.remove(); resize(); }, 300);
}

/**
 * One clock drives BOTH the progress bar and the auto-dismiss, so they can never disagree.
 * Frame-based (requestAnimationFrame) so the bar shrinks smoothly; pausing freezes both together.
 */
function startLife(card, ms) {
  const bar = card.querySelector('.bar i');
  let total = ms, left = ms, last = performance.now(), paused = false, raf = 0, done = false;
  const tick = (now) => {
    if (done) return;
    if (!paused) left -= now - last;
    last = now;
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left / total)})`;
    if (left <= 0) { done = true; dismiss(card); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame((t) => { last = t; tick(t); });
  return {
    pause() { paused = true; },
    resume() { paused = false; last = performance.now(); },
    restart(newMs) { total = left = newMs; paused = false; last = performance.now(); if (done) { done = false; raf = requestAnimationFrame(tick); } },
    stop() { done = true; cancelAnimationFrame(raf); },
  };
}

window.api.on('notice', (n) => {
  while (stack.children.length >= 3) stack.firstChild.remove(); // keep the stack short
  const card = document.createElement('div');
  card.className = 'card ' + (n.kind === 'warn' ? 'warn' : '');
  const items = (n.items || []).slice(0, 3);
  const more = (n.items || []).length - items.length;
  const dur = n.duration === 0 ? 0 : (n.duration || DURATION); // 0 = stay until closed
  const th = window.__theme || {};
  const lang = /[\u0E00-\u0E7F]/.test(n.title || '') ? 'th' : 'en';
  const deco = th.deco ? `<span class="deco">${th.deco}</span>` : '';
  const hi = th.hi ? `<span class="hi">${esc(th.hi[lang])}</span>` : '';
  const scene = th.scene ? `<div class="scene s-notice">${th.scene}</div>` : '';
  card.innerHTML = `${scene}${hi}<div class="top"><div class="ico">${n.kind === 'warn' ? '📥' : '✨'}</div><div class="tx"><div class="t">${esc(n.title)}</div>${n.sub ? `<div class="s">${esc(n.sub)}</div>` : ''}</div><button class="x" title="${esc(n.closeLabel || '')}"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div>` +
    (items.length ? `<ul>${items.map((i) => `<li><span class="fi">${extIcon(i.name)}</span><b>${esc(i.name)}</b><i>➜</i><span class="fo">📁 ${esc(i.to)}</span></li>`).join('')}${more > 0 ? `<li class="more">+${more}</li>` : ''}</ul>` : '') +
    `<div class="btns">${n.undoId ? `<button class="p" data-undo><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>${esc(n.undoLabel)}</button>` : ''}${n.tab ? `<button data-open><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${esc(n.viewLabel)}</button>` : ''}</div>${dur ? '<div class="bar"><i></i></div>' : ''}${deco}`;

  stack.appendChild(card);
  if (dur) {
    const life = (card._life = startLife(card, dur));
    // Hover intent: pause on enter, resume only after the pointer has been away a moment.
    // (Resizing the window can make the pointer flicker in/out; the delay absorbs that.)
    let leaveTimer = null;
    card.addEventListener('pointerenter', () => { clearTimeout(leaveTimer); life.pause(); });
    card.addEventListener('pointerleave', () => { clearTimeout(leaveTimer); leaveTimer = setTimeout(() => life.resume(), 450); });
  }

  card.querySelector('.x').onclick = () => dismiss(card);
  const u = card.querySelector('[data-undo]');
  if (u) u.onclick = async () => {
    u.disabled = true;
    await window.api.invoke('journal:undo', n.undoId);
    card.querySelector('.t').textContent = n.undoneLabel;
    card.querySelector('ul')?.remove(); u.remove();
    if (card._life) card._life.restart(2500);
    else card._life = startLife(card, 2500);
    resize();
  };
  const o = card.querySelector('[data-open]');
  if (o) o.onclick = () => { window.api.invoke('notice:open', n.tab); dismiss(card); };
  resize();
});
