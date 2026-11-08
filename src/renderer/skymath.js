// Sun position maths, shared by the main process (tests) and the page (UMD: works with require() and as a <script>).
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(); else root.SkyMath = make();
})(this, function () {
  /**
   * Where the sun is: weights for night/dawn/day/dusk (sum 1) that cross-fade for ~50 min around sunrise and sunset,
   * plus `sun` = progress 0..1 along the daytime arc (-1 at night) and `moon` = progress 0..1 along the night arc (-1 by day).
   * `nowMin` is minutes after local midnight at the place. Falls back to 6:00 / 18:00 when there is no data.
   */
  function skyAt(nowMin, sunriseMin, sunsetMin) {
    const rise = Number.isFinite(sunriseMin) ? sunriseMin : 360, set = Number.isFinite(sunsetMin) ? sunsetMin : 1080;
    const W = 50;
    const ramp = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
    const m = ((nowMin % 1440) + 1440) % 1440;
    const dayness = ramp((m - (rise - W)) / (2 * W)) * (1 - ramp((m - (set - W)) / (2 * W)));
    const near = (c) => Math.max(0, 1 - Math.abs(m - c) / W);
    const dawn = near(rise) * 0.9, dusk = near(set) * 0.9, edge = Math.max(dawn, dusk) * 0.5;
    const day = Math.max(0, dayness - edge), night = Math.max(0, 1 - dayness - edge);
    const sum = day + night + dawn + dusk || 1;
    const sun = m >= rise && m <= set ? (m - rise) / Math.max(1, set - rise) : -1;
    const sinceSet = m >= set ? m - set : m + 1440 - set;
    return { w: { night: night / sum, dawn: dawn / sum, day: day / sum, dusk: dusk / sum }, sun, moon: sun >= 0 ? -1 : Math.min(1, sinceSet / (1440 - (set - rise))) };
  }
  return { skyAt };
});
