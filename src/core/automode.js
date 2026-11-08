// Decides which screen mode should be active, from running processes and a weekly schedule.
// Pure function so it can be unit-tested without Electron.

const DEFAULT_RULES = {
  game: ['valorant-win64-shipping.exe', 'valorant.exe', 'leagueclient.exe', 'league of legends.exe', 'riotclientservices.exe', 'steam.exe', 'epicgameslauncher.exe', 'minecraft.exe', 'javaw.exe', 'genshinimpact.exe', 'fortniteclient-win64-shipping.exe', 'dota2.exe', 'cs2.exe', 'robloxplayerbeta.exe', 'slaythespire.exe'],
  meeting: ['zoom.exe', 'ms-teams.exe', 'teams.exe', 'webex.exe', 'slack.exe'],
};

// steam.exe / javaw.exe / slack.exe are launchers that stay open for hours; only treat them as a hint when nothing else matches.
const WEAK = new Set(['steam.exe', 'epicgameslauncher.exe', 'javaw.exe', 'slack.exe', 'riotclientservices.exe']);

const DEFAULT_CFG = {
  enabled: false,
  processes: DEFAULT_RULES,
  // weekday = 1..7 (Mon..Sun); from/to are "HH:MM"
  schedule: [{ mode: 'work', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }],
  fallback: 'all', // mode used when nothing matches
};

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * @param {string[]} running lower-cased process image names, e.g. ['chrome.exe']
 * @param {Date} now
 * @param {object} cfg automode config
 * @returns {{mode: string, reason: string, detail: string}}
 */
function decideMode(running, now, cfg = DEFAULT_CFG) {
  const set = new Set(running.map((p) => p.toLowerCase()));
  const procs = cfg.processes || DEFAULT_RULES;

  // 1) strong process signals, in priority order: meeting beats game (you cannot miss a meeting)
  for (const mode of ['meeting', 'game']) {
    const hit = (procs[mode] || []).map((p) => p.toLowerCase()).find((p) => set.has(p) && !WEAK.has(p));
    if (hit) return { mode, reason: 'process', detail: hit };
  }
  // 2) weekly schedule
  const day = ((now.getDay() + 6) % 7) + 1;
  const min = now.getHours() * 60 + now.getMinutes();
  for (const s of cfg.schedule || []) {
    if (!(s.days || []).includes(day)) continue;
    const a = toMin(s.from), b = toMin(s.to);
    if (a <= b ? (min >= a && min < b) : (min >= a || min < b)) return { mode: s.mode, reason: 'schedule', detail: `${s.from}-${s.to}` };
  }
  // 3) weak process hints (launchers)
  for (const mode of ['game', 'meeting']) {
    const hit = (procs[mode] || []).map((p) => p.toLowerCase()).find((p) => set.has(p) && WEAK.has(p));
    if (hit) return { mode, reason: 'process-weak', detail: hit };
  }
  return { mode: cfg.fallback || 'all', reason: 'fallback', detail: '' };
}

/**
 * Hysteresis: a new mode must be proposed on `needed` consecutive checks before we switch,
 * so a process starting/stopping for a few seconds does not flip the desktop around.
 */
class Switcher {
  constructor({ needed = 3 } = {}) { this.needed = needed; this.pending = null; this.count = 0; }
  feed(proposed, current) {
    if (proposed === current) { this.pending = null; this.count = 0; return null; }
    if (this.pending === proposed) this.count++; else { this.pending = proposed; this.count = 1; }
    if (this.count >= this.needed) { this.pending = null; this.count = 0; return proposed; }
    return null;
  }
}

module.exports = { decideMode, Switcher, DEFAULT_CFG, DEFAULT_RULES };
