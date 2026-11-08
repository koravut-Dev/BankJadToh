// Reads the raw reports in docs/security-results (written by scripts/run-security-tools.ps1) and writes assets/security-tools.json,
// which scripts/security-audit.js merges into the Settings -> Security card. The numbers come from the tools' own files.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'docs', 'security-results');
const rows = [];
const read = (n) => { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch { return null; } };
const mtime = (n) => { try { return fs.statSync(path.join(dir, n)).mtime.toISOString(); } catch { return new Date().toISOString(); } };
const notes = (() => { try { return JSON.parse(read('triage.json') || '{}'); } catch { return {}; } })(); // human triage: which findings were fixed or are false positives

// Semgrep
{
  const t = read('semgrep.sarif');
  if (t) {
    const run = JSON.parse(t).runs[0];
    const log = (read('semgrep.err.log') || '').replace(/[^\x20-\x7e\n]/g, '');
    const ruleCount = (/Rules run:\s*(\d+)/.exec(log) || [])[1];
    const files = (/Targets scanned:\s*(\d+)/.exec(log) || [])[1];
    const ver = (/Semgrep.*?(\d+\.\d+\.\d+)/.exec(read('versions.txt') || '') || [])[1];
    const n = run.results.length, ignored = (notes.semgrep && notes.semgrep.falsePositives) || 0;
    rows.push({ id: 'semgrep', tool: 'Semgrep OSS (p/javascript, p/nodejs, p/security-audit)', version: ver || run.tool.driver.version || '', at: mtime('semgrep.sarif'),
      status: n - ignored > 0 ? 'fail' : 'pass', data: { rules: Number(ruleCount) || 0, files: Number(files) || 0, findings: n, falsePositives: ignored, fixed: (notes.semgrep && notes.semgrep.fixed) || 0 } });
  }
}
// OSV-Scanner
{
  const t = read('osv-scanner.json');
  if (t) {
    const j = JSON.parse(t);
    const pk = [];
    for (const r of j.results || []) for (const p of r.packages || []) pk.push({ name: p.package.name, version: p.package.version, ids: (p.vulnerabilities || []).map((v) => v.id) });
    const log = (read('osv-scanner.err.log') || '');
    const scanned = (/found (\d+) packages/.exec(log) || [])[1];
    rows.push({ id: 'osv', tool: 'OSV-Scanner', version: (/osv-scanner[^\n]*?(\d+\.\d+\.\d+)/i.exec(read('versions.txt') || '') || [])[1] || '', at: mtime('osv-scanner.json'),
      status: pk.length ? 'warn' : 'pass', data: { packages: Number(scanned) || 0, findings: pk.length, items: pk.map((p) => `${p.name}@${p.version}`), note: pk.length ? 'build tools only; not shipped in the app' : undefined } });
  }
}
// Gitleaks
{
  const t = read('gitleaks.json');
  if (t !== null) {
    let n = 0; try { n = JSON.parse(t || '[]').length; } catch { /* empty file */ }
    const log = read('gitleaks.err.log') || '';
    rows.push({ id: 'gitleaks', tool: 'Gitleaks', version: (/gitleaks[^\n]*?(\d+\.\d+\.\d+)/i.exec(read('versions.txt') || '') || [])[1] || '', at: mtime('gitleaks.json'),
      status: n ? 'fail' : 'pass', data: { leaks: n, scanned: (/scanned ~?([\d.]+ ?\w+)/.exec(log) || [])[1] || '' } });
  }
}
// Electronegativity
{
  const t = read('electronegativity.sarif');
  if (t) {
    const run = JSON.parse(t).runs[0];
    const by = {}; for (const r of run.results) by[r.level || 'note'] = (by[r.level || 'note'] || 0) + 1;
    rows.push({ id: 'electronegativity', tool: 'Electronegativity (Doyensec)', version: run.tool.driver.version || '', at: mtime('electronegativity.sarif'),
      status: (by.error || 0) + (by.warning || 0) > 0 ? 'warn' : 'pass', data: { errors: by.error || 0, warnings: by.warning || 0, notes: by.note || 0 } });
  }
}
// Electron fuses (packaged app)
{
  const t = read('fuses.log');
  if (t) {
    const state = {}; for (const m of t.matchAll(/^\s+(\w+) is (Enabled|Disabled)/gm)) state[m[1]] = m[2] === 'Enabled';
    const want = { RunAsNode: false, EnableNodeOptionsEnvironmentVariable: false, EnableNodeCliInspectArguments: false, EnableCookieEncryption: true, EnableEmbeddedAsarIntegrityValidation: true, OnlyLoadAppFromAsar: true };
    const ok = Object.entries(want).every(([k, v]) => state[k] === v);
    rows.push({ id: 'fuses', tool: 'Electron fuses of the built app (@electron/fuses)', version: '', at: mtime('fuses.log'), status: ok ? 'pass' : 'fail', data: { on: Object.entries(want).filter(([k, v]) => state[k] === v).length, of: Object.keys(want).length } });
  }
}

fs.writeFileSync(path.join(root, 'assets', 'security-tools.json'), JSON.stringify({ rows }, null, 2));
for (const r of rows) console.log(r.status.toUpperCase().padEnd(5), r.id.padEnd(18), r.tool, r.version, JSON.stringify(r.data));
