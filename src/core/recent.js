const fs = require('fs');
const path = require('path');

/**
 * Latest files Bank JadToh filed (from the journal), newest first. Skips undone batches, files the user moved away
 * again, and shortcut moves made by screen modes.
 */
function recentFiled(journal, { limit = 6, exists = fs.existsSync, now = Date.now() } = {}) {
  const out = [];
  let todayCount = 0;
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  for (const b of [...journal.data.batches].reverse()) {
    if (b.undone || b.kind !== 'organize') continue;
    for (const m of [...b.moves].reverse()) {
      if (m.restored || !exists(m.to)) continue;
      if (b.time >= startOfDay.getTime()) todayCount++;
      if (out.length < limit) {
        const dir = path.dirname(m.to);
        out.push({
          name: path.basename(m.to),
          full: m.to,
          folder: dir.split(/[\\/]/).slice(-2).join('\\'), // last two segments, e.g. Captures\2026-11
          folderFull: dir,
          category: m.category || '',
          auto: b.label === 'Auto',
          time: b.time,
        });
      }
    }
  }
  return { items: out, todayCount };
}

module.exports = { recentFiled };
