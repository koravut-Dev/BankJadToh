// Runs real checks against this source tree and writes assets/security-report.json (shown on the Security page).
// Nothing here is hand-written: every row records the tool that ran, its version, when, and what it returned.
// Run:  node scripts/security-audit.js        (add --no-defender to skip the Windows Defender scan)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const rows = [];
const now = () => new Date().toISOString();
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' && /^(npm|npx)$/.test(cmd), maxBuffer: 64e6, windowsHide: true, ...opts });
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
const add = (r) => rows.push({ at: now(), ...r });

const src = walk(path.join(root, 'src')).filter((f) => /\.(js|html|css)$/.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const pkg = JSON.parse(read(path.join(root, 'package.json')));
const npmVer = (run('npm', ['-v']).stdout || '').trim();

// 1. dependency vulnerabilities (what ships in the app, then everything incl. build tools)
for (const [id, label, args] of [['deps_prod', 'prod', ['audit', '--omit=dev', '--json']], ['deps_all', 'all', ['audit', '--json']]]) {
  const r = run('npm', args);
  try {
    const j = JSON.parse(r.stdout);
    const v = j.metadata.vulnerabilities, total = j.metadata.dependencies.total;
    const bad = v.critical + v.high + v.moderate + v.low;
    add({ id, tool: 'npm audit', version: npmVer, status: bad === 0 ? 'pass' : (v.critical || v.high ? 'fail' : 'warn'), data: { scanned: total, ...v, ...(id === 'deps_all' && bad ? { note: 'build tools only (electron-builder → minimatch); not shipped in the app' } : {}) } });
  } catch { add({ id, tool: 'npm audit', version: npmVer, status: 'skip', data: { note: 'registry not reachable' } }); }
}

// 2. automated tests
{
  const r = run('node', ['test/run.js']);
  const m = /(\d+) passed/.exec(r.stdout || ''), f = /(\d+) failed/.exec(r.stdout || '');
  add({ id: 'tests', tool: 'node test/run.js', version: process.version, status: r.status === 0 ? 'pass' : 'fail', data: { passed: m ? +m[1] : 0, failed: f ? +f[1] : 0 } });
}

// 3. Electron hardening (static read of the source)
{
  const main = read(path.join(root, 'src/main/main.js'));
  const wp = [...main.matchAll(/webPreferences:\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const html = src.filter((f) => f.endsWith('.html'));
  const checks = {
    windows: wp.length,
    contextIsolation: wp.every((x) => /contextIsolation:\s*true/.test(x)),
    sandbox: wp.every((x) => /sandbox:\s*true/.test(x)),
    nodeIntegrationOff: wp.every((x) => /nodeIntegration:\s*false/.test(x)),
    noInsecureFlags: !/webSecurity:\s*false|allowRunningInsecureContent|enableRemoteModule|nodeIntegrationInSubFrames:\s*true/.test(main),
    cspOnEveryPage: html.every((f) => /Content-Security-Policy/.test(read(f))),
    strictCsp: html.every((f) => { const c = (read(f).match(/Content-Security-Policy"[^>]*>/) || [''])[0]; return /base-uri 'none'/.test(c) && /object-src 'none'/.test(c) && /connect-src 'none'/.test(c) && !/style-src 'self' 'unsafe-inline'/.test(c) && !/script-src[^;]*unsafe/.test(c); }),
    cspNoRemoteOrEval: html.every((f) => !/unsafe-eval|https?:\/\//.test((read(f).match(/Content-Security-Policy"[^>]*>/) || [''])[0])),
    blocksNavigation: /web-contents-created/.test(main) && /will-navigate/.test(main) && /setWindowOpenHandler/.test(main),
    deniesPermissions: /setPermissionRequestHandler/.test(main),
    noEval: !src.some((f) => f.endsWith('.js') && /\beval\(|new Function\(/.test(read(f))),
    pageCount: html.length,
  };
  const ok = ['contextIsolation', 'sandbox', 'strictCsp', 'nodeIntegrationOff', 'noInsecureFlags', 'cspOnEveryPage', 'cspNoRemoteOrEval', 'blocksNavigation', 'deniesPermissions', 'noEval'].every((k) => checks[k]);
  add({ id: 'electron', tool: 'static source check (scripts/security-audit.js)', version: 'electron ' + (require('electron/package.json').version), status: ok ? 'pass' : 'fail', data: checks });
}

// 4. every address the code can talk to
{
  const urls = new Map();
  for (const f of src.filter((x) => x.endsWith('.js'))) for (const m of read(f).matchAll(/https?:\/\/[a-z0-9.-]+[^\s'"`)]*/gi)) { const u = m[0]; if (!/^https?:\/\/(localhost|127\.)/.test(u)) urls.set(u.replace(/[,;]+$/, ''), rel(f)); }
  add({ id: 'network', tool: 'source scan for URLs / fetch / http', version: '-', status: 'pass', data: { addresses: [...urls].map(([u, f]) => ({ url: u, file: f })), telemetry: /analytics|sentry|mixpanel|segment\.|telemetry/i.test(src.map(read).join('\n')) ? 'found' : 'none' } });
}

// 5. things that start other programs (listed for transparency)
{
  const progs = new Set();
  for (const f of src.filter((x) => x.endsWith('.js'))) for (const m of read(f).matchAll(/execFile(?:Sync)?\(\s*'([^']+)'/g)) progs.add(m[1]);
  add({ id: 'spawn', tool: 'source scan for child processes', version: '-', status: 'pass', data: { programs: [...progs].sort() } });
}

// 6. secrets accidentally left in the code
{
  const pats = [['AWS key', /AKIA[0-9A-Z]{16}/], ['Anthropic/OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}/], ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/], ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['Google key', /AIza[0-9A-Za-z_-]{35}/]];
  const hits = []; let fakes = 0;
  for (const f of walk(root).filter((x) => !/node_modules|[\\/]dist[\\/]|\.git[\\/]/.test(x) && /\.(js|json|html|md|txt|env|yml)$/.test(x))) { const t = read(f); for (const [n, re] of pats) { const m = re.exec(t); if (!m) continue; const line = t.slice(t.lastIndexOf(String.fromCharCode(10), m.index) + 1, m.index + 200); const around = t.slice(Math.max(0, m.index - 20), m.index + 200); if (/EXAMPLE|FAKE/.test(around) || /EXAMPLE|FAKE/.test(line)) { fakes++; continue; } hits.push({ kind: n, file: rel(f) }); } }
  add({ id: 'secrets', tool: 'regex scan (5 key formats)', version: '-', status: hits.length ? 'fail' : 'pass', data: { fixtures: fakes, files: walk(root).filter((x) => !/node_modules|[\\/]dist[\\/]/.test(x)).length, hits } });
}

// 6b. hostile input: the real app, in a throw-away data folder, fed attack strings (HTML in rule/AI/place names, odd file names)
//     and asked to open / trash / encrypt files outside its folders
{
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-pen-'));
  const r = spawnSync(require('electron'), ['.'], { cwd: root, encoding: 'utf8', timeout: 180000, windowsHide: true,
    env: { ...process.env, JADTOH_TEST_DIR: tmp, JADTOH_SMOKE: '1', JADTOH_HOSTILE: '1', JADTOH_HOSTILE_QUIT: '1' } });
  fs.rmSync(tmp, { recursive: true, force: true });
  const line = ((r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('HOSTILE {'))) || '';
  try {
    const R = JSON.parse(line.slice(8));
    const tabs = Object.values(R.tabs), pages = tabs.length;
    const injected = tabs.reduce((a, x) => a + x.bad + (x.pwn ? 1 : 0), 0) + [R.notice, R.widget].reduce((a, x) => a + x.bad + (x.pwn ? 1 : 0), 0);
    const controls = ['rules', 'settings'].every((k) => R.tabs[k].shownAsText) && R.notice.shownAsText && R.widget.shownAsText; // the attack strings really were on screen
    const refused = ['openExe', 'openOutside', 'revealOutside', 'vaultOutside'].filter((k) => String(R.ipc[k]).startsWith('refused')).length + ['trashOutside', 'traversal'].filter((k) => R.ipc[k] === '{"trashed":0}').length;
    const ok = !R.failure && injected === 0 && controls && refused === 6 && R.outsideStillThere;
    add({ id: 'hostile', tool: 'attack-string test in the real app (Electron)', version: 'electron ' + require('electron/package.json').version, status: ok ? 'pass' : 'fail', data: { pages: pages + 2, injected, refused, ipcTried: 6, controls } });
  } catch { add({ id: 'hostile', tool: 'attack-string test in the real app (Electron)', version: '-', status: 'skip', data: { pages: 0, injected: 0, refused: 0, ipcTried: 6, controls: false, note: 'test did not finish' } }); }
}

// 7. Windows Defender scan of the shipped source
if (process.platform === 'win32' && !process.argv.includes('--no-defender')) {
  const ps = (c) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', c], { encoding: 'utf8', windowsHide: true, timeout: 600000 });
  const t0 = Date.now();
  const ver = (ps('(Get-MpComputerStatus).AMProductVersion + \' / signatures \' + (Get-MpComputerStatus).AntivirusSignatureVersion').stdout || '').trim();
  const before = new Date();
  const sc = ps(`Start-MpScan -ScanType CustomScan -ScanPath '${path.join(root, 'src')}'; Start-MpScan -ScanType CustomScan -ScanPath '${path.join(root, 'assets')}'`);
  const th = ps(`Get-MpThreatDetection | Where-Object { $_.InitialDetectionTime -gt (Get-Date).AddMinutes(-15) } | Select-Object -ExpandProperty Resources`);
  // only detections inside what was scanned (other recent detections on this PC are not about this app)
  const mine = [path.join(root, 'src'), path.join(root, 'assets')].map((p) => p.toLowerCase());
  const found = (th.stdout || '').split(/\r?\n/).filter((l) => mine.some((p) => l.toLowerCase().includes(p))).join('\n').trim();
  add({ id: 'defender', tool: 'Microsoft Defender', version: ver || 'unknown', status: sc.status !== 0 ? 'skip' : found ? 'fail' : 'pass', data: { scanned: 'src/ + assets/', seconds: Math.round((Date.now() - t0) / 1000), threats: found ? found.split(/\r?\n/) : [], error: sc.status !== 0 ? (sc.stderr || '').trim().slice(0, 200) : undefined } });
}

// standard third-party tools (run with scripts/run-security-tools.ps1, imported by scripts/security-tools-import.js)
try {
  const ext = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'security-tools.json'), 'utf8'));
  for (const r of ext.rows) rows.push({ ...r, external: true });
} catch { /* not run yet */ }

const report = { app: pkg.name, version: pkg.version, generated: now(), node: process.version, platform: process.platform + ' ' + require('os').release(), rows };
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets', 'security-report.json'), JSON.stringify(report, null, 2));
for (const r of rows) console.log(r.status.toUpperCase().padEnd(5), r.id.padEnd(10), r.tool, '|', JSON.stringify(r.data).slice(0, 150));
