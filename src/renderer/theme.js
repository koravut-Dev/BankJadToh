// Applies the current theme to whichever window loads this file: sets <html data-theme>, draws the floating particles
// and the little decoration on the logo. The page chooses how lively it is with <html data-fx="main|widget|notice|none">.
(function () {
  const FX = {
    loy: { items: ['🪷', '🪷', '✨', '🏮'], motion: 'fx-rise', size: [14, 22], o: 0.8, deco: '🪷', hi: { th: 'สุขสันต์วันลอยกระทง', en: 'Happy Loy Krathong' } },
    xmas: { items: ['❄️', '❄️', '❄', '⭐'], motion: 'fx-fall', size: [10, 18], o: 0.85, deco: '🎅', hi: { th: 'Merry Christmas', en: 'Merry Christmas' } },
    newyear: { items: ['✨', '🎆', '🎉', '✨'], motion: 'fx-twinkle', size: [14, 24], o: 0.9, deco: '🥂', hi: { th: 'สวัสดีปีใหม่', en: 'Happy New Year' } },
    valentine: { items: ['💗', '💖', '💕', '🌹'], motion: 'fx-rise', size: [12, 20], o: 0.8, deco: '💘', hi: { th: 'Happy Valentine’s', en: 'Happy Valentine’s' } },
    songkran: { items: ['💦', '💧', '💦', '🌼'], motion: 'fx-fall', size: [12, 20], o: 0.8, deco: '🔫', hi: { th: 'สุขสันต์วันสงกรานต์', en: 'Happy Songkran' } },
    halloween: { items: ['🦇', '🎃', '👻', '🦇'], motion: 'fx-drift', size: [14, 22], o: 0.85, deco: '🎃', hi: { th: 'Happy Halloween', en: 'Happy Halloween' } },
  };
  // weather looks, used only by the Classic theme when the user links it to the weather
  const WX = {
    sun: { items: ['✨', '☀️', '🌼', '✨'], motion: 'fx-twinkle', size: [12, 20], o: 0.85, deco: '☀️', th: 'อากาศแจ่มใส', en: 'Clear and sunny' },
    night: { items: ['⭐', '✨', '🌙', '⭐'], motion: 'fx-twinkle', size: [10, 18], o: 0.9, deco: '🌙', th: 'ท้องฟ้ายามค่ำ', en: 'Clear night' },
    cloud: { items: ['☁️', '☁️', '⛅'], motion: 'fx-drift', size: [22, 36], o: 0.55, deco: '⛅', th: 'มีเมฆ', en: 'Cloudy', speed: 1.5 },
    rain: { items: ['💧', '💧', '💦', '💧'], motion: 'fx-fall', size: [11, 18], o: 0.8, deco: '🌂', th: 'ฝนตก', en: 'Rainy', speed: 0.35 },
    storm: { items: ['⚡', '💧', '⛈️', '💧'], motion: 'fx-fall', size: [12, 20], o: 0.85, deco: '⛈️', th: 'พายุฝนฟ้าคะนอง', en: 'Thunderstorm', speed: 0.3 },
    snow: { items: ['❄️', '❄', '☃️', '❄️'], motion: 'fx-fall', size: [10, 18], o: 0.9, deco: '☃️', th: 'หิมะตก', en: 'Snowing', speed: 1.1 },
    fog: { items: ['🌫️', '☁️', '🌫️'], motion: 'fx-drift', size: [26, 40], o: 0.35, deco: '🌫️', th: 'หมอกลง', en: 'Foggy', speed: 1.6 },
  };
  // shapes mode: soft drawn particles instead of emoji
  const SHAPE = { loy: ['lantern', 'fx-rise'], xmas: ['flake', 'fx-fall'], newyear: ['spark', 'fx-twinkle'], valentine: ['heart', 'fx-rise'], songkran: ['bubble', 'fx-rise'], halloween: ['bat', 'fx-drift'],
    sun: ['spark', 'fx-twinkle'], night: ['spark', 'fx-twinkle'], cloud: ['puff', 'fx-drift'], rain: ['streak', 'fx-rain'], storm: ['streak', 'fx-rain'], snow: ['flake', 'fx-fall'], fog: ['puff', 'fx-drift'] };
  const COUNT = { main: 12, widget: 7, notice: 6, none: 0 };
  const root = document.documentElement;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function build(id, wx, style) {
    style = style || 'icons';
    // "sky" = weather-driven scene; only for the main window with a live weather reading, otherwise fall back to floating icons
    if (style === 'sky' && !(id === 'default' && wx && WX[wx.kind] && root.dataset.fx === 'main' && window.Sky)) style = 'icons';
    if (style !== 'sky' && window.Sky) window.Sky.stop();
    const old = document.getElementById('fx'); if (old) old.remove();
    document.querySelectorAll('.brand .deco, .scene').forEach((e) => e.remove());
    let f = FX[id];
    if (!f && id === 'default' && wx && WX[wx.kind]) {
      const w = WX[wx.kind];
      const line = (l) => `${wx.place ? wx.place + ' · ' : ''}${wx.temp}°C · ${w[l]}`;
      f = { ...w, hi: { th: line('th'), en: line('en') } };
    }
    const key = id === 'default' ? (wx && WX[wx.kind] ? wx.kind : 'default') : id;
    const scene = style === 'scene' && key !== 'default' && window.SCENES ? window.SCENES[key] : null;
    window.__theme = { id, hi: f ? f.hi : null, deco: f && style === 'icons' ? f.deco : null, wx: wx || null, style, scene };
    if (scene) {
      const mk = (cls) => { const d = document.createElement('div'); d.className = 'scene ' + cls; d.innerHTML = scene; return d; };
      const aside = document.querySelector('aside'); if (aside) aside.appendChild(mk('s-aside'));
      const w = document.querySelector('.w'); if (w) w.insertBefore(mk('s-widget'), w.firstChild);
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: window.__theme }));
    if (style === 'sky') { window.Sky.start(wx); return; }
    if (!f || style === 'calm') return;
    const brand = document.querySelector('.brand');
    if (brand && style === 'icons') { const d = document.createElement('span'); d.className = 'deco'; d.textContent = f.deco; brand.appendChild(d); }
    const n = Math.round((COUNT[root.dataset.fx || 'none'] || 0) * (style === 'scene' ? 0.6 : 1));
    if (!n) return;
    const layer = document.createElement('div'); layer.id = 'fx';
    for (let k = 0; k < n; k++) {
      const el = document.createElement('i');
      const sh = style !== 'icons' ? SHAPE[id === 'default' ? (wx && wx.kind) : id] : null;
      if (sh) { el.className = 'sh sh-' + sh[0]; } else el.textContent = f.items[k % f.items.length];
      const mo = sh ? sh[1] : f.motion;
      const dur = (mo === 'fx-twinkle' ? rnd(2.4, 4.6) : mo === 'fx-drift' ? rnd(14, 24) : mo === 'fx-rain' ? rnd(1.4, 2.6) : rnd(9, 17)) * (mo === 'fx-rain' ? 1 : f.speed || 1);
      const motion = sh ? sh[1] : f.motion;
      el.style.cssText = `--x:${rnd(2, 96).toFixed(1)}%;--s:${Math.round(rnd(f.size[0], f.size[1]))}px;--d:${dur.toFixed(1)}s;--dl:${(-rnd(0, dur)).toFixed(1)}s;--sw:${Math.round(rnd(-30, 30))}px;--o:${f.o};--y:${Math.round(rnd(5, 85))}vh;--m:${motion}`;
      if (motion === 'fx-twinkle') el.style.top = '0';
      layer.appendChild(el);
    }
    document.body.appendChild(layer);
  }

  function apply(id, wx, style) {
    root.dataset.theme = id || 'default';
    if (wx && wx.kind && root.dataset.theme === 'default') root.dataset.wx = wx.kind; else delete root.dataset.wx;
    const w = root.dataset.wx ? wx : null;
    if (document.body) build(root.dataset.theme, w, style); else document.addEventListener('DOMContentLoaded', () => build(root.dataset.theme, w, style));
  }
  window.applyTheme = apply;
  window.api.invoke('theme:get').then((r) => r && apply(r.id, r.wx, r.fx)).catch(() => {});
  window.api.on('theme', (r) => r && apply(r.id, r.wx, r.fx));
})();
