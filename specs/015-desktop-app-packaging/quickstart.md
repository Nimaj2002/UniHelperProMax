# Quickstart: Validating the Desktop App

Run guide for the probe (phases A and B) and the release checks. The contracts hold the
details: [backend-desktop-mode](./contracts/backend-desktop-mode.md),
[preload-bridge](./contracts/preload-bridge.md), [packaging](./contracts/packaging.md) and
[ui-contract](./contracts/ui-contract.md).

## Prerequisites (build machine for each system)

- Python 3.12, `uv`, Node 24.22.1
- macOS: Xcode command-line tools, for `codesign`
- Linux: `libfuse2` (`libfuse2t64` on 24.04) to run the AppImage

## Build

```bash
cd frontend && npm ci && npm run build                     # → frontend/dist
cd ../backend && uv sync --frozen && uv run pyinstaller packaging/unihelper-backend.spec  # → backend/dist/unihelper-backend/
uv run python -m unihelper.desktop.smoke dist/unihelper-backend    # health + migrations on temp dirs
cd ../desktop && npm ci && npm run build                   # tsc → desktop/dist
npx electron-builder --dir        # probe: unpacked app with Info.plist/entitlements
npx electron-builder              # release: installers (Phase C only)
```

## Phase A/B — recorder probe (per system)

Run the unpacked app from `desktop/release/<platform>-unpacked`, or the `.app` on macOS. Create
a class and a session. Then check:

| # | Check | Pass when |
|---|---|---|
| P1 | DevTools are allowed in the probe build only: `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')`; record → `recorder.mimeType` | `true`; `audio/webm;codecs=opus` |
| P2 | Record 2 min with the real recorder (5 s chunks) | ~24 chunk uploads, no `chunk_gap`; file plays and seeks; backend `analyse` duration 120 s ± 1 s; IndexedDB `chunks` empty |
| P3 | Crash: at 60 s, kill the Electron main process (Task Manager / `kill -9`) | Backend process gone within 5 s (stdin EOF; job object on Windows); relaunch → recording shown interrupted, leftover chunks upload, ≤ 5 s audio lost |
| P4 | WebM split: `uv run python -m unihelper.domain.webm split <file> --max-bytes 200000` (test helper) | Every part re-parses, timecodes start at 0, concatenated payloads equal the original; the fake transcriber accepts every part |
| P5 | Storage persistence: write markers to IndexedDB + localStorage, note `navigator.storage.persisted()`; quit; move the system clock +40 days; relaunch | Markers present; an unfinished recording's chunks still in IndexedDB upload (research R11) |
| P6 | Permissions: mic from the app → allowed (macOS: one TCC prompt); `getUserMedia({video:true})`, geolocation, notifications → denied without prompt; log the request/check `details` objects | As stated; field names `mediaTypes` / `mediaType` confirmed |
| P7 | Close with unsaved note text (beforeunload active) | The app's dialog appears; never a silent no-op; "Quit anyway" closes |
| P8 | Normal quit | Backend exits ≤ 5 s after the shutdown request; no `-wal` growth; `PRAGMA integrity_check` ok; no backend process left |
| P9 | Start a second copy | No second backend; the first window is focused |

Linux additionally runs on X11 **and** Wayland sessions. On Ubuntu 24.04, record whether the
AppImage starts with the Chromium sandbox (research R17). The probe passes only if P1–P9 pass on
every listed system.

## Phase C — release checks

| Scenario | How | Expected |
|---|---|---|
| Clean first run | Fresh VM per system, no network, install, open | First-run page → data folder created → app without login (SC-001, SC-002) |
| Uninstall keeps data | Create data, uninstall (Windows `/S`, `apt remove`, delete .app) | Data folder and backend data byte-identical (hash list); Windows shows where data stays |
| Upgrade | Install N, create data, install N+1 with a migration | Backup in `backups/`, data intact (SC-006) |
| Failed migration | N+1 build with a test migration that raises | Error page `migration_failed` naming the backup; DB hash unchanged |
| Newer DB | Open N's app on N+1's database | `database_newer` page |
| Busy port | `python -m http.server 47813 --bind 127.0.0.1`, start app | `port_in_use` page; choose another port works when nothing is pending |
| Stale backend | Start `unihelper-backend` by hand with the run marker of a "previous run" | It is replaced; the app starts |
| Foreign request | From a browser: `fetch('http://127.0.0.1:47813/api/v1/health')`; curl with Host `evil.example`; curl from another machine | `403 not_from_app`; `421`; connection refused (SC-009) |
| Offline | Disconnect the network; use every feature except transcription and remote AI | Works; no outbound requests (SC-008) |
| Links and exports | External link in a chat answer; export `.ics`, theme, tasks CSV | Opens in the browser; save dialog each time |

## Automated

```bash
cd backend && uv run pytest                       # incl. desktop-mode contract + migration backup tests
cd desktop && npx playwright test                 # packaged app; fake mic on Linux/Windows
```

The Playwright desktop suite is described in plan.md, under Testing.
