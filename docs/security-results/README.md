# Raw reports from the standard security tools

Produced by `scripts/run-security-tools.ps1` (see its header for how to get each tool). Nothing is edited by hand except `triage.json`,
which records, for each finding, whether it was fixed or judged a false positive and why.

| Tool | Version used | File |
|---|---|---|
| Semgrep OSS (p/javascript, p/nodejs, p/security-audit) | 1.184.0 | `semgrep.sarif` |
| OSV-Scanner | 2.7.0 | `osv-scanner.json` |
| Gitleaks | 8.30.1 | `gitleaks.json` (empty list = no leaks) |
| Electronegativity (Doyensec) | 1.10.3 | `electronegativity.sarif` |
| @electron/fuses | via npx | `fuses.log` (state of the built app) |

Downloaded binaries (OSV-Scanner, Gitleaks) were checked against the SHA-256 lists published with their official GitHub releases.
Run the same script yourself and compare; a difference worth reporting is a new finding or a tool version change.
