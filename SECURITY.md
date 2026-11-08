# Security policy

## Reporting a vulnerability
Please do **not** open a public issue. Use GitHub's private "Report a vulnerability" (Security → Advisories) on this repository.
Include the version (Settings → About), what you did, and what happened. I aim to reply within a few days.

## What the app does and does not do
* Works on your own PC. No account, no analytics, no telemetry.
* The only network access is opt-in: weather (open-meteo.com) and the AI provider you add yourself. See `docs/security-testing.md` for the exact list and how to verify it with a proxy.
* Files are only touched inside the folders you let it manage; every move can be undone.
* The vault uses AES-256-GCM with a key wrapped by your passphrase (scrypt) and by a one-time recovery key. Lose both and the files cannot be recovered.

## How it is checked
* Built-in: `node scripts/security-audit.js` (dependency audit, Defender scan, source checks, attack-string test) → shown in Settings → About.
* Standard tools: Semgrep, OSV-Scanner, Gitleaks, Electronegativity, Electron fuses → `scripts/run-security-tools.ps1`, raw reports in `docs/security-results/`.
* GitHub: CodeQL, Dependabot and OpenSSF Scorecard (`.github/`), once the repository is public.

## Known limits
* The installer is not code-signed yet, so Windows may warn when installing.
* No independent third-party audit yet.
