# Runs the standard free security tools against this project and stores their raw reports in docs/security-results.
# Nothing here is hand-written: re-run it yourself and compare.  Then:  node scripts/security-tools-import.js
#
# Needs (install them yourself; versions used for the committed results are in docs/security-results/README.md):
#   Semgrep        pip install semgrep                         (path: -Semgrep  or  semgrep on PATH)
#   OSV-Scanner    https://github.com/google/osv-scanner/releases  (path: -Osv)
#   Gitleaks       https://github.com/gitleaks/gitleaks/releases   (path: -Gitleaks)
#   Electronegativity  runs through npx, no install
param(
  [string]$Semgrep = 'semgrep',
  [string]$Osv = 'osv-scanner',
  [string]$Gitleaks = 'gitleaks'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'docs\security-results'
New-Item -ItemType Directory -Force $out | Out-Null
Set-Location $root
$env:PYTHONUTF8 = '1'

function Run($file, $args2, $name) {
  Write-Host "== $name"
  Start-Process -FilePath $file -ArgumentList $args2 -RedirectStandardOutput (Join-Path $out "$name.log") -RedirectStandardError (Join-Path $out "$name.err.log") -Wait -NoNewWindow
}

# 1. Semgrep (static analysis; rules from the public registry, no code is uploaded, metrics off)
Run $Semgrep @('--config', 'p/javascript', '--config', 'p/nodejs', '--config', 'p/security-audit', '--metrics', 'off', '--sarif', '--output', (Join-Path $out 'semgrep.sarif'), '--exclude', 'node_modules', '--exclude', 'dist', '--exclude', '*.woff2', 'src', 'scripts', 'test') 'semgrep'

# 2. OSV-Scanner (known vulnerabilities in every package in package-lock.json)
Run $Osv @('scan', 'source', '--lockfile', 'package-lock.json', '--format', 'json', '--output-file', (Join-Path $out 'osv-scanner.json')) 'osv-scanner'

# 3. Gitleaks (secrets in files)
Run $Gitleaks @('dir', '.', '--no-banner', '--redact', '--report-format', 'json', '--report-path', (Join-Path $out 'gitleaks.json'), '--exit-code', '0') 'gitleaks'

# 4. Electronegativity (Electron misconfiguration). It needs package.json next to src, so use a clean copy.
$tmp = Join-Path $env:TEMP ('jt-egy-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $tmp | Out-Null
Copy-Item package.json $tmp
Copy-Item src (Join-Path $tmp 'src') -Recurse
Run 'npx.cmd' @('--yes', '@doyensec/electronegativity', '-i', $tmp, '-r', '-v', 'false', '-o', (Join-Path $out 'electronegativity.sarif')) 'electronegativity'
Remove-Item $tmp -Recurse -Force

# 5. Electron fuses of the packaged app (run `npx electron-builder --win` first)
$exe = Join-Path $root 'dist\win-unpacked\Bank JadToh.exe'
if (Test-Path $exe) { Run 'npx.cmd' @('--yes', '@electron/fuses', 'read', '--app', $exe) 'fuses' }
# versions used for this run
$v = @()
try { $v += 'Semgrep ' + ((& $Semgrep --version) -join ' ') } catch { }
try { $v += 'osv-scanner ' + ((& $Osv --version 2>&1) -join ' ') } catch { }
try { $v += 'gitleaks ' + ((& $Gitleaks version) -join ' ') } catch { }
$v += 'node ' + (node -v)
Set-Content -Path (Join-Path $out 'versions.txt') -Value $v -Encoding utf8
Write-Host 'done. Now run: node scripts/security-tools-import.js'
