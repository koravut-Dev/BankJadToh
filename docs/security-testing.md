# Security testing Bank JadToh with ZAP (with the LLM Support add-on)

Bank JadToh is a desktop app with no server of its own, so a web scanner has nothing to attack.
What ZAP *is* good for here is **watching every request the app makes** and letting an AI help read the capture.
The goal: prove the app only talks to the addresses it says it does, and only sends what it says it sends.

## What the app is allowed to contact

| Feature | Address | What is sent | When |
|---|---|---|---|
| Weather (off by default) | `geocoding-api.open-meteo.com`, `api.open-meteo.com` | the city name you type to search; latitude/longitude of the city you picked | only while "Classic theme follows the weather" is on |
| AI (off by default) | the provider you added (e.g. `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`) | file names (or + first lines of text files if you chose that) and your API key in the header | only when AI is on and you scan / use the command bar |
| Local AI | `localhost` | same as above, never leaves the PC | when a local provider is selected |
| Updates | none configured in this build | – | – |

Anything else showing up in ZAP is a bug.

## Setup (you do this; nothing here is installed by the project)

1. Install ZAP from <https://www.zaproxy.org/download/> (it is branded "ZAP by Checkmarx" now).
2. In ZAP: **Manage Add-ons → Marketplace** → install **LLM Support** and **MCP**.
3. **Tools → Options → LLM**: pick a provider. To keep captured traffic on your PC, use **Ollama** (local).
   Never paste a key you are not happy to send to that provider: the capture can contain request headers.
4. Make sure ZAP listens on `127.0.0.1:8080` (default).

## Run the app through ZAP

Use a throw-away data folder so your real settings and files are untouched:

```powershell
$env:JADTOH_TEST_DIR = "$env:TEMP\jt-zap"
.\node_modules\electron\dist\electron.exe . --proxy-server=http://127.0.0.1:8080 --ignore-certificate-errors
```

* `--proxy-server` routes the app's network calls through ZAP (the app uses Electron's network stack for weather and AI).
* `--ignore-certificate-errors` lets ZAP read HTTPS without installing its CA into Windows.
  It switches off certificate checking, so use it **only for this test session**, never for normal use.
* Because `JADTOH_TEST_DIR` is set, the app works on `%TEMP%\jt-zap\desk` instead of your Desktop/Downloads.

Then in the app (Settings):

1. Turn on **Classic theme follows the weather**, search a city, pick it.
2. Add an AI provider, turn AI on, put a few files in `%TEMP%\jt-zap\desk`, and run **Scan** with "use AI".
3. Click around every page for a minute.

## What to check in ZAP

* **History / Sites tree:** only the addresses in the table above. No analytics, no unknown hosts.
* **Weather requests:** the query string contains only `name=` (search) or `latitude=`/`longitude=` (current) – nothing identifying.
* **AI requests:** the body contains file *names* only (unless you chose "names + first lines"); the key is only in the auth header; secret files (found by the secret guard) are never in the body.
* In the **LLM Chat** panel you can ask, for example: *"List every host in the history and flag anything that is not open-meteo.com or an AI provider"* and *"Does any request body contain an email address, a Windows user name, or a full file path?"*
  Treat the answer as a lead, and confirm by reading the request yourself.

## Already tested (automatic, repeatable)

`node scripts/security-audit.js` writes `assets/security-report.json` (shown in Settings → About). Besides the dependency audit, Defender scan and source checks it now runs:

* **Attack-string test** in the real app, in a throw-away folder: HTML/script in rule names, AI labels, city names and odd file names, opened across every page, the quick-rule dialog, the command palette, the notification popup and the widget. Result: nothing executed, and the strings appear as plain text.
* **File-path guard**: asking the main process to open, reveal, trash or encrypt a file outside the folders Bank JadToh manages is refused; programs and scripts (.exe, .bat, .ps1 …) are never launched from a click, only shown in Explorer.

## Standard third-party tools (reproducible)

`scripts/run-security-tools.ps1` runs Semgrep, OSV-Scanner, Gitleaks, Electronegativity and reads the Electron fuses of the built app; raw reports are in `docs/security-results/`
and summarised in Settings → About. What they found so far:

* **Semgrep** found a real weakness: the vault's AES-GCM decryption did not fix the authentication-tag length, so a shortened (e.g. 4-byte) tag was accepted. Fixed (`authTagLength: 16` plus an explicit length check) with a test that fails on the old code. Its other finding is a false positive in a developer-only script.
* **Electronegativity** flagged windows without an explicit `sandbox: true`, middle-click windows and a loose Content-Security-Policy. Fixed: every window is sandboxed, middle-click is off, and the CSP is now strict (no inline scripts or style blocks, no network from the page, `base-uri`/`form-action`/`object-src` closed). Remaining: informational notes only.
* **Electron fuses** were all at defaults. Now: run-as-Node off, `NODE_OPTIONS` and `--inspect` off, cookie encryption on, app loads only from the integrity-checked archive. Turning off `grantFileProtocolExtraPrivileges` was tried and breaks loading the app from the archive, so it stays on.
* **OSV-Scanner** and `npm audit` agree: the only advisory is `minimatch` inside build tooling, not shipped in the app. **Gitleaks**: no leaked secrets.

## Not covered

* ZAP's active scanner, Burp, Shannon and PentestGPT target web servers / networks; Bank JadToh exposes none, so they would only test the static pages and miss the real surface (the app's internal messages).
* No independent third-party audit yet. The installer is not code-signed.
