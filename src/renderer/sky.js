// Weather-driven sky for the main window: a layered scene drawn on one canvas behind the UI.
//   1. sky gradient   - cross-fades dawn / day / dusk / night from the real sunrise and sunset of the saved city
//   2. celestial      - sun or moon travelling along an arc, stars at night (hidden by cloud)
//   3. conditions     - clouds, rain, snow, fog, lightning (particle counts are capped)
// The UI above it is translucent "glass" (see themes.css, html[data-sky]) so text stays readable in every scene.
// Cost control: ~30 fps, paused while the window is hidden, static single frame when the user asks for reduced motion.
(function () {
  const SM = window.SkyMath;
  const PAL = { // top / middle / bottom, RGB
    night: [[10, 14, 40], [24, 28, 70], [48, 44, 100]],
    dawn: [[60, 70, 140], [240, 150, 130], [255, 205, 140]],
    day: [[25, 105, 235], [60, 165, 250], [140, 210, 252]],
    dusk: [[50, 50, 120], [220, 100, 110], [255, 170, 100]],
  };
  // how each condition changes the sky: grey = desaturate toward grey, dark/light = shift brightness, shine = how much sun/moon shows through
  const KIND = {
    sun: { grey: 0, dark: 0, shine: 1, clouds: 2, stars: 1 }, night: { grey: 0, dark: 0, shine: 1, clouds: 1, stars: 1 },
    cloud: { grey: 0.45, dark: 0.05, shine: 0.45, clouds: 7, stars: 0.35 }, rain: { grey: 0.6, dark: 0.18, shine: 0.15, clouds: 8, stars: 0 },
    storm: { grey: 0.7, dark: 0.32, shine: 0.05, clouds: 9, stars: 0 }, snow: { grey: 0.5, dark: -0.12, shine: 0.25, clouds: 6, stars: 0.1 },
    fog: { grey: 0.65, dark: -0.08, shine: 0.2, clouds: 0, stars: 0.05 },
  };
  const ALPHA = 0.62; // how strongly the sky tints the app background
  const MAX_DROPS = 110, MAX_FLAKES = 55;
  const reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const root = document.documentElement;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  let cv = null, ctx = null, raf = 0, timer = 0, W = 0, H = 0, wx = null, kind = 'sun', last = 0;
  let drops = [], flakes = [], clouds = [], stars = [], flash = 0, nextBolt = 0, fog = [];

  function minutesNow() {
    if (wx && Number.isFinite(wx.utcOffset)) return Math.floor((Date.now() / 1000 + wx.utcOffset) / 60) % 1440; // time at the saved city
    const d = new Date(); return d.getHours() * 60 + d.getMinutes();
  }
  function skyNow() {
    const s = SM.skyAt(minutesNow(), wx && wx.sunriseMin, wx && wx.sunsetMin);
    const k = KIND[kind] || KIND.sun;
    const cols = [0, 1, 2].map((i) => {
      let c = [0, 0, 0];
      for (const p of ['night', 'dawn', 'day', 'dusk']) { const w = s.w[p]; if (w) c = [c[0] + PAL[p][i][0] * w, c[1] + PAL[p][i][1] * w, c[2] + PAL[p][i][2] * w]; }
      const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      c = mix(c, [lum, lum, lum * 1.04], k.grey);
      return k.dark >= 0 ? mix(c, [0, 0, 8], k.dark) : mix(c, [255, 255, 255], -k.dark);
    });
    const top = Object.entries(s.w).sort((a, b) => b[1] - a[1])[0][0];
    return { s, cols, k, phase: top };
  }

  function seed() {
    const k = KIND[kind] || KIND.sun, area = Math.max(0.5, Math.min(1.6, (W * H) / (1280 * 800)));
    clouds = Array.from({ length: k.clouds }, (_, i) => ({ x: rnd(-0.1, 1.1), y: rnd(0.04, 0.5), s: rnd(0.7, 1.5), v: rnd(0.004, 0.012) * (1 + (i % 3) * 0.3), a: rnd(0.55, 0.9) }));
    const rain = kind === 'rain' || kind === 'storm';
    drops = rain ? Array.from({ length: Math.round(Math.min(MAX_DROPS, (kind === 'storm' ? 110 : 80) * area)) }, () => ({ x: rnd(0, 1), y: rnd(0, 1), l: rnd(10, 22), v: rnd(0.9, 1.5) })) : [];
    flakes = kind === 'snow' ? Array.from({ length: Math.round(Math.min(MAX_FLAKES, 50 * area)) }, () => ({ x: rnd(0, 1), y: rnd(0, 1), r: rnd(1.2, 3.2), v: rnd(0.04, 0.12), p: rnd(0, 6.28) })) : [];
    stars = Array.from({ length: 70 }, () => ({ x: rnd(0, 1), y: rnd(0, 0.65), r: rnd(0.5, 1.5), p: rnd(0, 6.28) }));
    fog = kind === 'fog' ? [0.25, 0.5, 0.75].map((y, i) => ({ y, x: rnd(0, 1), v: 0.002 + i * 0.001 })) : [];
    nextBolt = performance.now() + rnd(2500, 7000);
  }

  function draw(now, animate) {
    if (!ctx) return;
    const { s, cols, k, phase } = skyNow();
    if (root.dataset.phase !== phase) root.dataset.phase = phase;
    const dt = animate ? Math.min(60, now - last) / 16.7 : 0; last = now;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(cols[0], ALPHA)); g.addColorStop(0.55, css(cols[1], ALPHA)); g.addColorStop(1, css(cols[2], ALPHA));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const nightA = s.w.night * k.stars;
    if (nightA > 0.04) { // stars
      for (const t of stars) { const a = nightA * (0.45 + 0.55 * Math.sin(now / 900 + t.p)); ctx.fillStyle = `rgba(255,255,255,${Math.max(0, a).toFixed(3)})`; ctx.beginPath(); ctx.arc(t.x * W, t.y * H, t.r, 0, 6.283); ctx.fill(); }
    }
    // sun / moon on an arc
    const R = Math.min(W, H);
    if (s.sun >= 0) {
      const x = W * (0.12 + 0.76 * s.sun), y = H * (0.78 - 0.62 * Math.sin(Math.PI * s.sun));
      const warm = Math.max(s.w.dawn, s.w.dusk), c = mix([255, 244, 200], [255, 150, 80], warm);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R * 0.55);
      gr.addColorStop(0, css(c, 0.95 * k.shine)); gr.addColorStop(0.12, css(c, 0.55 * k.shine)); gr.addColorStop(1, css(c, 0));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    } else if (s.moon >= 0) {
      const x = W * (0.12 + 0.76 * s.moon), y = H * (0.7 - 0.55 * Math.sin(Math.PI * s.moon));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R * 0.22);
      gr.addColorStop(0, `rgba(235,240,255,${0.5 * k.shine})`); gr.addColorStop(1, 'rgba(235,240,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(240,244,255,${0.9 * k.shine})`; ctx.beginPath(); ctx.arc(x, y, Math.max(14, R * 0.028), 0, 6.283); ctx.fill();
    }
    // clouds: lit white by day, pink at the edges of the day, blue-grey at night, dark in rain
    const lit = mix(mix([120, 130, 170], [255, 255, 255], Math.min(1, s.w.day + s.w.dawn * 0.6 + s.w.dusk * 0.4)), [255, 190, 170], Math.max(s.w.dawn, s.w.dusk) * 0.5);
    const cc = mix(lit, [70, 78, 96], Math.min(0.85, k.dark * 2 + k.grey * 0.3));
    for (const c of clouds) {
      c.x += c.v * dt * 0.06; if (c.x > 1.2) c.x = -0.2;
      const cx = c.x * W, cy = c.y * H, r = R * 0.1 * c.s;
      for (const [dx, dy, m] of [[-1.2, 0.2, 0.8], [0, -0.3, 1.1], [1.1, 0.1, 0.9], [0.1, 0.35, 1]]) {
        const gr = ctx.createRadialGradient(cx + dx * r, cy + dy * r, 0, cx + dx * r, cy + dy * r, r * m * 1.5);
        gr.addColorStop(0, css(cc, 0.5 * c.a)); gr.addColorStop(1, css(cc, 0));
        ctx.fillStyle = gr; ctx.fillRect(cx + dx * r - r * 2, cy + dy * r - r * 2, r * 4, r * 4);
      }
    }
    for (const f of fog) { // fog: slow translucent bands
      f.x += f.v * dt * 0.1; const x = ((f.x % 1) - 0.5) * W * 0.4;
      const gr = ctx.createLinearGradient(0, f.y * H - 70, 0, f.y * H + 70);
      gr.addColorStop(0, 'rgba(225,230,236,0)'); gr.addColorStop(0.5, `rgba(225,230,236,${0.28 + 0.1 * Math.sin(now / 4000 + f.y * 9)})`); gr.addColorStop(1, 'rgba(225,230,236,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - W * 0.2, f.y * H - 70, W * 1.4, 140);
    }
    if (drops.length) { // rain
      ctx.strokeStyle = 'rgba(200,225,255,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (const d of drops) {
        d.y += d.v * dt * 0.035; d.x -= d.v * dt * 0.004; if (d.y > 1.05) { d.y = -0.05; d.x = rnd(0, 1); }
        const x = d.x * W, y = d.y * H; ctx.moveTo(x, y); ctx.lineTo(x - d.l * 0.25, y + d.l);
      }
      ctx.stroke();
    }
    if (flakes.length) { // snow
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const f of flakes) {
        f.y += f.v * dt * 0.03; f.p += dt * 0.02; if (f.y > 1.03) { f.y = -0.03; f.x = rnd(0, 1); }
        ctx.beginPath(); ctx.arc((f.x + Math.sin(f.p) * 0.012) * W, f.y * H, f.r, 0, 6.283); ctx.fill();
      }
    }
    if (kind === 'storm' && animate) { // lightning: a quick double flash, then it decays
      if (now > nextBolt) { flash = 1; nextBolt = now + rnd(5000, 12000); }
      if (flash > 0.02) { ctx.fillStyle = `rgba(235,235,255,${(flash * 0.28).toFixed(3)})`; ctx.fillRect(0, 0, W, H); flash *= Math.pow(0.9, dt); }
    }
  }

  function fit() {
    if (!cv) return;
    W = cv.width = Math.max(320, innerWidth); H = cv.height = Math.max(240, innerHeight); // 1 canvas pixel = 1 css pixel (cheap)
    seed(); draw(performance.now(), false);
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return; // ~30 fps is plenty for slow weather
    draw(now, true);
  }
  function vis() {
    cancelAnimationFrame(raf); raf = 0;
    if (document.hidden || reduce.matches) return;
    last = performance.now(); raf = requestAnimationFrame(loop);
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; clearInterval(timer); timer = 0;
    document.removeEventListener('visibilitychange', vis); window.removeEventListener('resize', fit);
    if (cv) cv.remove(); cv = ctx = null;
    root.removeAttribute('data-sky'); root.removeAttribute('data-phase');
  }
  function start(w) {
    stop();
    if (!w || !window.SkyMath) return;
    wx = w; kind = KIND[w.kind] ? w.kind : 'sun';
    cv = document.createElement('canvas'); cv.id = 'sky'; cv.setAttribute('aria-hidden', 'true');
    ctx = cv.getContext('2d'); if (!ctx) { cv = null; return; }
    document.body.insertBefore(cv, document.body.firstChild);
    root.dataset.sky = '1';
    fit();
    document.addEventListener('visibilitychange', vis); window.addEventListener('resize', fit);
    reduce.addEventListener && reduce.addEventListener('change', vis);
    timer = setInterval(() => { if (reduce.matches || document.hidden) draw(performance.now(), false); }, 60000); // static mode: still follows the sun, once a minute
    vis();
  }
  window.Sky = { start, stop };
})();
