// Seasonal themes: ids, names, and which one applies on a given date (used when "follow the season" is on).
// Pure functions, no Electron, so they can be tested.

const THEMES = [
  { id: 'default', emoji: '🗂️', th: 'ปกติ', en: 'Classic', whenTh: 'ตลอดปี', whenEn: 'All year' },
  { id: 'loy', emoji: '🪷', th: 'ลอยกระทง', en: 'Loy Krathong', whenTh: 'คืนเพ็ญเดือน 12 (±4 วัน)', whenEn: 'Full moon of the 12th month (±4 days)' },
  { id: 'xmas', emoji: '🎄', th: 'คริสต์มาส', en: 'Christmas', whenTh: '15–26 ธ.ค.', whenEn: '15–26 Dec' },
  { id: 'newyear', emoji: '🎆', th: 'ปีใหม่', en: 'New Year', whenTh: '27 ธ.ค. – 3 ม.ค.', whenEn: '27 Dec – 3 Jan' },
  { id: 'valentine', emoji: '💗', th: 'วาเลนไทน์', en: 'Valentine', whenTh: '10–14 ก.พ.', whenEn: '10–14 Feb' },
  { id: 'songkran', emoji: '💦', th: 'สงกรานต์', en: 'Songkran', whenTh: '11–16 เม.ย.', whenEn: '11–16 Apr' },
  { id: 'halloween', emoji: '🎃', th: 'ฮาโลวีน', en: 'Halloween', whenTh: '24–31 ต.ค.', whenEn: '24–31 Oct' },
];
const IDS = new Set(THEMES.map((t) => t.id));
const DAY = 86400000;

/** Loy Krathong = full moon of the 12th lunar month, i.e. the full moon that falls between 29 Oct and 27 Nov (Thai local date). */
function loyKrathong(year) {
  const REF = Date.UTC(2000, 0, 21, 4, 40), SYN = 29.530588853 * DAY; // a known full moon, and the mean lunar cycle
  const from = Date.UTC(year, 9, 29) - 7 * 3600e3;
  const n = Math.ceil((from - REF) / SYN);
  const t = REF + n * SYN + 7 * 3600e3; // shift to Thai time
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); // midnight (UTC-labelled) of that Thai date
}

/** Which theme fits this date. `d` is a Date; only its local calendar day matters. */
function themeForDate(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const today = Date.UTC(y, m - 1, day);
  const within = (a, b) => today >= a && today <= b;
  if (Math.abs(today - loyKrathong(y)) <= 4 * DAY) return 'loy';
  if (m === 12 && day >= 27 || m === 1 && day <= 3) return 'newyear';
  if (m === 12 && day >= 15 && day <= 26) return 'xmas';
  if (m === 2 && day >= 10 && day <= 14) return 'valentine';
  if (m === 4 && day >= 11 && day <= 16) return 'songkran';
  if (m === 10 && day >= 24 && day <= 31) return 'halloween';
  void within;
  return 'default';
}

/** The theme actually shown: the user's pick, or the seasonal one when auto is on. */
function effectiveTheme(cfg, d = new Date()) {
  if (cfg && cfg.themeAuto) { const s = themeForDate(d); if (s !== 'default') return s; }
  return cfg && IDS.has(cfg.theme) ? cfg.theme : 'default';
}

module.exports = { THEMES, IDS, loyKrathong, themeForDate, effectiveTheme };
