# แบงค์ จัดโต๊ะ

แอพ Windows สำหรับจัดไฟล์และหน้าจอ Desktop อัตโนมัติ — Electron + JavaScript, ไม่มีฐานข้อมูลภายนอก ทำงานบนเครื่องทั้งหมด
Smart, automatic desktop & file organizer for Windows. UI in Thai and English.

## Run / Build
```bash
npm install
npm test          # core engine tests (no Electron needed)
npm start         # run the app (lives in the system tray; Ctrl+Alt+J = command bar, Ctrl+Alt+D = drop pad)
npm run dist      # NSIS installer in dist/
```

## Features
| Feature | Where | Notes |
|---|---|---|
| Rule-based organizer, preview + undo | `core/planner.js`, `journal.js` | Extension / pattern / custom rules; reuses existing folders (`images`, `ISO_ONE`…); screenshots by month; name clashes get ` (1)` |
| Project clustering | `core/projects.js` | Files sharing a name prefix, or matching an existing folder name |
| Folder watcher, per-folder on/off, trust ladder | `main/main.js` | `ask` → `smart` → `full`; offers trust after 10 approvals; moving a file back pins it ("learning") |
| Live desktop widget + corner pop-ups | `renderer/widget.*`, `notify.*` | Always-on-screen "recently filed → where", click to reveal; pop-ups with Undo |
| Secret guard + encrypted vault | `core/guard.js`, `vault.js` | Local scan, never prints secrets. Vault v2: one passphrase + hint + one-time recovery key (envelope encryption, AES-256-GCM + scrypt), auto-lock after 5 idle minutes, *view temporarily* (self-deleting) and *restore* (moves out, no copies), per-file ignore. Old per-file entries still open and can be upgraded |
| Clean-up | `core/cleanup.js` | Old captures/installers, exact duplicates, dead shortcuts → Recycle Bin |
| Similar images | `core/phash.js` | dHash perceptual hash (resized / re-saved copies), keeps the highest-resolution copy |
| Unused apps | `core/usage.js` | Reads Windows UserAssist launch history; parks old shortcuts in a "Rarely used" folder |
| Screen modes (work / game / meeting) | `core/modes.js` | Moves only shortcuts known to belong to another group into a hidden folder; reads user **and** Public Desktop |
| Automatic mode switching | `core/automode.js` | By running programs (e.g. VALORANT, Zoom) and a weekly schedule; hysteresis; 30 min pause after a manual switch |
| Wallpaper-aware icon layout | `core/wallpaper.js`, `desktopicons.js` | Finds the picture's focal area, places icons in free cells; saves previous positions for one-click restore |
| Search | `core/search.js` | Name + text content, Thai-aware term matching (whole term, or all segments of it), date phrases (เมื่อวาน / last month …); results say *why* they matched and show a snippet |
| Time machine | `core/snapshots.js` | Day-strip of activity, daily desk snapshot, then-vs-now diff, restore via journal |
| Rules: visual builder, live match preview, packs, import/export | `core/rulepacks.js`, `renderer/app.js` | Plain-words rule builder shows which desk files a rule matches before saving; imported rules cannot target absolute paths |
| Drop pad | `renderer/drop.*` | Always-on-top widget: drop files, they are filed into `Documents\Bank JadToh\…` |
| Updater plumbing | `main/main.js` | `electron-updater`; inactive until a publish server is configured (see below) |
| Optional AI (Claude) | `core/ai.js` | **Written but not yet exercised against the real API.** Off by default; user's own key (DPAPI-encrypted) |

## Known limits (please read)
- **Icon layout needs "Auto arrange icons" OFF** (right-click desktop → View). With it on, Windows re-sorts icons itself; Bank JadToh detects this, shows the preview, and disables *Apply*. Only the **primary** monitor is laid out. The apply path was verified up to reading the real icons and planning; moving was not run on a real desktop because auto-arrange was on there.
- Wallpaper analysis is a heuristic (edge detail + brightness contrast), not an understanding of the picture. Wallpaper Engine / Lively / slideshows may have no still image to analyse.
- UserAssist only records launches made through Explorer/Start/shortcuts. Games started from Steam/Riot may show "no launch recorded".
- Similar-image search is capped at 1,500 images per scan and uses a conservative threshold (≤ 4 of 64 bits).
- Auto mode switching treats launchers (Steam, Riot client, Java, Slack) as weak hints so they do not flip the desktop for hours.
- Not done: reading PDF/Office content for AI classification (plain-text files only).

## Releasing (needs things only the publisher has)
1. **Code signing** — without a certificate Windows SmartScreen warns on first run. With one, set before `npm run dist`:
   `CSC_LINK` (path/URL to the .pfx) and `CSC_KEY_PASSWORD`.
2. **Auto-update** — add a `publish` block to `build` in `package.json`, e.g. GitHub Releases:
   ```json
   "publish": [{ "provider": "github", "owner": "<you>", "repo": "<repo>" }]
   ```
   then `npx electron-builder --win --publish always` (needs `GH_TOKEN`). Until then the Settings → "Check for updates" button reports "not configured".

## Privacy
Everything runs locally. The only network call is the optional Claude API request, made only when AI is enabled with the user's key.
Journal, snapshots, layouts, config and the vault live in `%APPDATA%\Bank JadToh`.
