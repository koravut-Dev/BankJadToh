// "Which desktop shortcuts have I not launched in a long time?" from Windows' UserAssist history
// (HKCU\...\Explorer\UserAssist). It records launches made through Explorer/Start/shortcuts, NOT launches by
// other programs (e.g. games started from Steam/Riot), so "never seen" is reported separately from "old".

const { execFile } = require('child_process');
const path = require('path');

const GUIDS = ['{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}', '{F4E57C4B-2036-45F0-A9AB-443BCFE33D9F}'];
const PS = `
$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8
$out=@()
foreach($g in '${GUIDS[0]}','${GUIDS[1]}'){
  $k = Get-Item "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\$g\\Count"
  if(-not $k){continue}
  foreach($n in $k.GetValueNames()){ $v=$k.GetValue($n); if($v -is [byte[]]){ $out += [pscustomobject]@{n=$n; d=([BitConverter]::ToString($v) -replace '-','')} } }
}
$out | ConvertTo-Json -Compress`;

const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
const FILETIME_EPOCH_DIFF = 116444736000000000n;

/** rows: [{n: rot13 name, d: hex of the value}] -> [{name, base, runs, last}] (last = ms since epoch or 0) */
function parseUserAssist(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || typeof r.n !== 'string' || typeof r.d !== 'string' || r.d.length < 144) continue; // 72 bytes = Win7+ format
    const buf = Buffer.from(r.d, 'hex');
    const runs = buf.readUInt32LE(4);
    const ft = buf.readBigUInt64LE(60);
    const last = ft > FILETIME_EPOCH_DIFF ? Number((ft - FILETIME_EPOCH_DIFF) / 10000n) : 0;
    const name = rot13(r.n);
    out.push({ name, base: path.win32.basename(name).toLowerCase(), runs, last });
  }
  return out;
}

/** Best (most recent) history entry for a shortcut: by launched exe name or by the .lnk file name. */
function usageFor(entries, { lnkName, targetBase }) {
  const lnk = lnkName.toLowerCase();
  let best = null;
  for (const e of entries) {
    const hit = (targetBase && e.base === targetBase) || e.base === lnk || e.base === lnk.replace(/\.lnk$/, '');
    if (hit && (!best || e.last > best.last)) best = { last: e.last, runs: Math.max(e.runs, best ? best.runs : 0) };
  }
  return best;
}

/**
 * shortcuts: [{name, path, target}] -> sorted list with status:
 *  'old'     last launch older than `days`
 *  'never'   no launch recorded at all (may simply be started by another program)
 *  'recent'  launched within `days`
 *  'unknown' target cannot be judged (Store app, network path, no target)
 */
function classifyUnused(shortcuts, entries, { days = 60, now = Date.now() } = {}) {
  const out = [];
  for (const s of shortcuts) {
    const targetBase = s.target ? path.win32.basename(s.target).toLowerCase() : '';
    const judgeable = s.target && /\.(exe|bat|cmd|com)$/i.test(s.target);
    if (!judgeable) { out.push({ ...s, status: 'unknown', last: 0, runs: 0, ageDays: null }); continue; }
    const u = usageFor(entries, { lnkName: s.name, targetBase });
    if (!u || !u.last) { out.push({ ...s, status: 'never', last: 0, runs: 0, ageDays: null }); continue; }
    const ageDays = Math.floor((now - u.last) / 864e5);
    out.push({ ...s, status: ageDays >= days ? 'old' : 'recent', last: u.last, runs: u.runs, ageDays });
  }
  const rank = { old: 0, never: 1, recent: 2, unknown: 3 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || (b.ageDays || 0) - (a.ageDays || 0));
  return out;
}

function readUserAssistRaw() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { windowsHide: true, maxBuffer: 32e6, timeout: 20000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try { const j = JSON.parse(stdout); resolve(Array.isArray(j) ? j : [j]); } catch { resolve([]); }
    });
  });
}

module.exports = { rot13, parseUserAssist, usageFor, classifyUnused, readUserAssistRaw };
