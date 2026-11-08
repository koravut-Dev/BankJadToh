const fs = require('fs');
const path = require('path');
const { walk } = require('./util');

const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'json', 'log', 'html', 'xml', 'yml', 'yaml', 'js', 'ts', 'py', 'sql', 'tsv']);
const STOP = new Set(['ไฟล์', 'เรื่อง', 'ที่', 'ของ', 'ใน', 'และ', 'หา', 'ค้นหา', 'file', 'files', 'the', 'about', 'of', 'a', 'my', 'find', 'search', 'ทำ', 'เมื่อ']);

let seg = null;
try { seg = new Intl.Segmenter('th', { granularity: 'word' }); } catch { /* ICU without Thai */ }

function splitWords(s) {
  const out = [];
  if (seg) for (const x of seg.segment(s)) { if (x.isWordLike) out.push(x.segment); }
  else out.push(...s.split(/\s+/));
  return out.map((w) => w.toLowerCase()).filter((w) => w && !STOP.has(w));
}

const DAY = 864e5;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

/** Understands a few Thai/English date phrases and returns {from,to,rest}. */
function parseDates(q, now = Date.now()) {
  const today = startOfDay(now);
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const prevMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const weekStart = today - dow * DAY;
  const rules = [
    [/เมื่อวาน|yesterday/gi, today - DAY, today],
    [/วันนี้|today/gi, today, today + DAY],
    [/สัปดาห์ที่แล้ว|อาทิตย์ที่แล้ว|last week/gi, weekStart - 7 * DAY, weekStart],
    [/สัปดาห์นี้|อาทิตย์นี้|this week/gi, weekStart, today + DAY],
    [/เดือนที่แล้ว|last month/gi, prevMonthStart, monthStart],
    [/ต้นเดือน|early (this )?month/gi, monthStart, monthStart + 10 * DAY],
    [/เดือนนี้|this month/gi, monthStart, today + DAY],
    [/ปีนี้|this year/gi, new Date(d.getFullYear(), 0, 1).getTime(), today + DAY],
  ];
  let from = null, to = null, rest = q;
  for (const [re, f, t] of rules) {
    if (re.test(rest)) { from = f; to = t; rest = rest.replace(re, ' '); break; }
  }
  return { from, to, rest };
}

let cache = { at: 0, key: '', entries: [] };

async function buildIndex(dirs, { force = false } = {}) {
  const key = dirs.join('|');
  if (!force && cache.key === key && Date.now() - cache.at < 60000) return cache.entries;
  const entries = [];
  for (const dir of dirs) {
    await walk(dir, {
      depth: 4,
      max: 30000,
      onFile: async (p, name) => {
        let st;
        try { st = await fs.promises.stat(p); } catch { return; }
        const ext = path.extname(name).toLowerCase().slice(1);
        let text = '', raw = '';
        if (TEXT_EXTS.has(ext) && st.size < 2 * 1048576) {
          try {
            const fh = await fs.promises.open(p, 'r');
            const buf = Buffer.alloc(4096);
            const { bytesRead } = await fh.read(buf, 0, 4096, 0);
            await fh.close();
            raw = buf.subarray(0, bytesRead).toString('utf8');
            text = raw.toLowerCase();
          } catch { /* skip */ }
        }
        entries.push({ path: p, name, lname: name.toLowerCase(), lpath: p.toLowerCase(), ext, size: st.size, mtime: st.mtimeMs, text, raw });
      },
    });
  }
  cache = { at: Date.now(), key, entries };
  return entries;
}

/** A short readable excerpt around the first content match (original case, single line). */
function snippetOf(e, words) {
  if (!e.text) return '';
  let at = -1, len = 0;
  for (const w of words) { const i = e.text.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; } }
  if (at < 0) return '';
  const from = Math.max(0, at - 40), to = Math.min(e.raw.length, at + len + 80);
  return (from > 0 ? '…' : '') + e.raw.slice(from, to).replace(/\s+/g, ' ').trim() + (to < e.raw.length ? '…' : '');
}

/**
 * Terms are what the user typed, split on spaces. A term matches a field when the WHOLE term is present, or - for
 * languages without spaces such as Thai, where the segmenter may split one word in two - when EVERY segment of it is.
 * (Any-segment matching made "ใบเสร็จ" match every file containing just "ใบ".)
 */
function termsOf(rest) {
  return rest.split(/\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x && !STOP.has(x)).map((term) => ({ term, segs: [...new Set(splitWords(term))] }));
}
const fieldHit = (field, t) => (!field ? 0 : field.includes(t.term) ? 2 : t.segs.length > 1 && t.segs.every((g) => field.includes(g)) ? 1 : 0);

/** Ranked results plus *why* each matched (name / folder / content), the highlight words and the date range used. */
async function searchDetailed(dirs, query, { limit = 60, now = Date.now() } = {}) {
  const entries = await buildIndex(dirs);
  const { from, to, rest } = parseDates(query, now);
  const terms = termsOf(rest);
  const words = [...new Set(terms.flatMap((t) => (t.segs.length > 1 ? [t.term, ...t.segs] : [t.term])))];
  const res = [];
  for (const e of entries) {
    if (from !== null && (e.mtime < from || e.mtime >= to)) continue;
    let score = 0, inName = false, inPath = false, inText = false;
    for (const t of terms) {
      const n = fieldHit(e.lname, t), p = fieldHit(e.lpath, t), c = fieldHit(e.text, t);
      if (n) { score += n === 2 ? 3 : 2; inName = true; } else if (p) { score += 1; inPath = true; }
      if (c) { score += c === 2 ? 1.5 : 1; inText = true; }
    }
    if (terms.length && score === 0) continue;
    if (terms.length === 0 && from === null) continue;
    res.push({ path: e.path, name: e.name, ext: e.ext, size: e.size, mtime: e.mtime, score, hit: { name: inName, path: inPath, content: inText }, snippet: inText ? snippetOf(e, words) : '' });
  }
  res.sort((x, y) => y.score - x.score || y.mtime - x.mtime);
  return { results: res.slice(0, limit), total: res.length, words, terms: terms.map((t) => t.term), range: from === null ? null : { from, to }, indexed: entries.length, indexedAt: cache.at };
}

async function search(dirs, query, opts) { return (await searchDetailed(dirs, query, opts)).results; }
const stats = () => ({ indexed: cache.entries.length, indexedAt: cache.at });

module.exports = { search, searchDetailed, stats, buildIndex, parseDates, splitWords };
