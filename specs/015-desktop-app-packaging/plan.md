# Implementation Plan: Desktop App for Windows, macOS and Linux

**Branch**: `015-desktop-app-packaging` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-desktop-app-packaging/spec.md` (2 clarifications
of 2026-10-26).

## Summary

The app ships as an **Electron 44.9.3** program. Its window loads the real app from a bundled
**PyInstaller onedir** backend at `http://127.0.0.1:47813`. The Electron main process owns the
backend's whole life.

Technical approach:

- **Backend lifecycle** (research R5, R6):
  - Main spawns `unihelper-backend` with the desktop environment and passes a per-launch
    `launchToken` and `clientSecret` on stdin.
  - It verifies the backend's identity with an HMAC nonce proof before loading the window.
  - To stop it, main sends a token-authenticated shutdown request, waits 5 s, then kills.
  - Three safeguards prevent orphans: the backend exits on stdin EOF, on Windows a job object
    kills it with the app, and a run marker lets the next start replace a stale backend.
  - The single-instance lock, a busy-port check and the existing `server.lock` each lead to an
    explicit message.
- **Backend changes** (contracts/backend-desktop-mode.md):
  - A `unihelper.desktop` package with:
    - the `serve` entry, which finally honours `UNIHELPER_PORT`; the default becomes 47813, and
      the web scripts keep 8000
    - the stdin handshake and watchdog
    - an admission middleware that checks Host, the client secret and Origin, plus an opt-in
      Host check for the web
    - single-user mode in place of login
    - `/api/v1/desktop/*` endpoints for identity, shutdown, busy state and data-folder
      operations
    - structured start-up errors with exit codes
  - Also: `UNIHELPER_FILES_DIR`, so the data folder is separate from backend data, and a
    verified online **backup before every migration**. The backup runs in every mode.
- **Electron main**:
  - Only the microphone is allowed, only for our origin, through both permission handlers.
    macOS TCC is handled through `systemPreferences`.
  - External links open in the default browser. The window can never navigate away, including
    through `window.open` and `target=_blank`.
  - Downloads go through a save dialog.
  - A `persist:unihelper` partition keeps window storage.
  - A **close protocol** with the renderer's guard state replaces Electron's silent
    `beforeunload` refusal (R12).
  - Window bounds are remembered.
  - Hardening: context isolation, sandbox and fuses, with no devtools in release builds.
- **Frontend** (`features/desktop/`):
  - a bridge wrapper that does nothing in the web build
  - `DesktopCloseGuard`
  - the microphone explanation and denied-state help
  - a Settings → Desktop section: version, data folder, port and logs
  - `RequireAuth` honouring `mode: "desktop"`
- **Packaging**: electron-builder 26.17.0.
  - Windows: per-user NSIS x64.
  - macOS: arm64 and x64 DMGs, ad-hoc signed, with `NSMicrophoneUsageDescription` and the
    audio-input entitlement.
  - Linux: AppImage and deb. No Snap.
  - Update metadata is generated so auto-update can be added later.
- **Delivery order**:
  - Phase A: the recorder probe on Windows.
  - Phase B: the same probe on macOS and Linux.
  - Phase C: installers, the README and the tag-triggered GitHub Actions release. Phase C starts
    only after every system passes P1–P9 (quickstart.md).

## Technical Context

**Language/Version**:
- Python 3.12: the backend, plus PyInstaller 6.22.3.
- TypeScript 5.9: Electron main and preload in a new `desktop/` package, and the frontend, which
  stays React 19.3 + Vite 8.
- Node 24.22.1 LTS for build tooling. Electron bundles Node 24.22.0 and Chromium 152.

**Primary Dependencies** (research R1, all exact pins):
- **New desktop**:
  - `electron@44.9.3`
  - `electron-builder@26.17.0`
  - `koffi@3.3.2` (Windows job object and process-image lookup only)
  - `@playwright/test@1.64.1`
  - `typescript` (same pin as the frontend)
- **New backend build-only**: `pyinstaller==6.22.3`, in a `packaging` dependency group. It is
  not a runtime dependency.
- **Reused**: FastAPI, uvicorn, Alembic, `platformdirs`, `keyring`, `secrets/master_key.py`,
  `single_process.py`, `db/migrate.py`, `domain/webm.py`, the recorder, uploader and chunk store
  (Feature 003), and autosave (Feature 002).
- No runtime dependency is added to the backend or the frontend.

**Storage**:
- SQLite is unchanged and gets **no new migration**.
- New files:
  - `desktop.json`
  - `backend.run.json`
  - `startup-error.json`
  - `.unihelperpromax.json` (data folder marker)
  - `backups/*.sqlite3`
- Locations per system are in research R10. The details are in data-model.md.

**Testing**:
- **pytest**:
  - **contract**: every `/desktop/*` endpoint, admission (421/403 cases), single-user mode (and
    login routes returning 404), `setup/status` `mode` in both modes, the web Host allow-list
    default and the opt-in variable, `health` fields.
  - **unit**: handshake parsing, HMAC proof, exit-code mapping, data-folder `check` states,
    move with copy and verification plus cleanup against the manifest, marker handling.
  - **integration** (real SQLite and file system):
    - backup before migration, prune to 3, integrity check
    - **failed migration leaves the database byte-identical** and writes `migration_failed`
    - newer database → 14
    - low disk → 17 (simulated `disk_usage`)
    - a lock conflict → 16
    - stdin EOF → graceful exit within 5 s
    - shutdown finalises an active recording
- **vitest**: the bridge no-ops in the web build, guard-state aggregation, close-dialog choices,
  microphone-denied steps per platform, and `RequireAuth` in desktop mode.
- **Playwright desktop e2e** (`desktop/tests/e2e`, packaged app, research R19):
  - first run with a fresh profile
  - second launch focuses the first window
  - busy port
  - stale backend replaced
  - crash then relaunch recovers an unfinished recording
  - quit during a blocked upload, then "Quit anyway", then relaunch uploads
  - close during a recording, both choices
  - microphone denied (`UNIHELPER_E2E_DENY_MIC=1`)
  - no orphaned backend after a normal quit and after SIGKILL or TerminateProcess
  - external link opens externally (`shell.openExternal` stubbed through a test hook)
  - export shows a save dialog (`dialog` stubbed)
  - window bounds restored
  - The fake microphone (`--use-fake-device-for-media-stream
    --use-file-for-fake-audio-capture`) runs the recording tests on Linux (xvfb) and Windows in
    CI. On macOS, CI runs everything except the microphone tests, because TCC cannot be granted
    on hosted runners. macOS recording is covered by the probe and the manual release checks.
- **Installer tests**:
  - Windows CI installs N silently, creates data, installs N+1, uninstalls, and compares hash
    lists.
  - Linux CI does the same with `dpkg -i` and `apt remove`.
  - macOS is manual (quickstart Phase C).
- **Existing suites** (backend pytest, frontend vitest and the web Playwright suite) run
  unchanged. This proves FR-054.

**Target Platform**:
- Windows 10+ x64
- macOS 13 Ventura+, Apple Silicon and Intel
- Linux x64: Ubuntu 22.04/24.04, Debian 12, Fedora 42+, on X11 and Wayland (research R2)

**Project Type**: web application (FastAPI + React) plus a new desktop shell package.

**Performance Goals**:
- The app window is usable within 10 s of launch after first run (SC-002). Identity polling
  gives up after 30 s.
- The backend stops within 5 s of the shutdown request.
- At most one 5 s chunk of audio is lost on a crash (SC-005).

**Constraints**:
- Offline except for user-configured providers: everything is bundled, and fonts and PDFium are
  already local.
- No secrets in the environment, the command line or logs.
- The default port is fixed, because it is part of the storage origin.
- The web and Docker versions are unchanged (FR-054).
- No Snap. No signing or notarization in this release.

**Scale/Scope**:
- 1 user per installation.
- 5 artifacts per release.
- About 25 new backend files or modules, about 15 desktop files and about 8 frontend files.
- No schema change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-design | Post-design |
|---|---|---|---|
| I. Work never lost | Autosave and recordings persist progressively; nothing is lost on close or crash | PASS | PASS. A fixed origin keeps IndexedDB buffers (R7). The close protocol never drops pending work: "Quit anyway" keeps it on the device. Shutdown finalises recordings. Crash recovery is Feature 003's, proven per OS by P3. |
| II. Data ownership and open formats | Plain files in the existing hierarchy; DB not the sole store | PASS | PASS. The files root moves to the user-chosen data folder with the layout unchanged (`<username>/<year>/…`). WebM/Opus on every system (R3). The marker file is plain JSON with no secrets. |
| III. Frontend/backend separation | Frontend only through the versioned API | PASS | PASS. The bridge exposes shell actions only (dialogs, port, close, microphone status). Data-folder moves go through documented `/api/v1/desktop/*` endpoints. The frontend never touches files or the DB. |
| IV. Providers and secrets | Keys server-side, encrypted, key outside the DB and data folder | PASS | PASS. The key store is preferred. The fallback key file sits in backend data, outside both the data folder and the DB. The launch token and client secret go over stdin only and are never logged. |
| V. UI quality and accessibility | shadcn/ui, theme tokens, keyboard, AA contrast | PASS | PASS. Desktop dialogs and Settings use existing primitives. The startup page uses the same tokens and is keyboard-operable (ui-contract.md). |
| VI. Tests | Endpoint tests plus the critical flows | PASS | PASS. Every new endpoint has contract tests. Record → save gets new desktop e2e coverage (crash and relaunch). Migration and failed migration have integration tests. |
| VII. Simplicity and spec discipline | SQLite only; justify new dependencies | PASS (with justification) | PASS. No new infrastructure. The new build and tool dependencies are justified under Complexity Tracking. Nothing outside the spec: auto-update, signing and Snap are excluded. |
| VIII. Desktop data safety | Data folder visible, changeable and outside the install; uninstall/update never deletes it; loopback only; backup before schema change | PASS | PASS. FR-027 check (R10); `deleteAppDataOnUninstall: false` plus the uninstaller message; bind 127.0.0.1 plus Host, secret and Origin admission (R8); verified backup before migration in every mode (R16). |

Note: the constitution's Workflow and Governance sections still say "Principles I–VII" (v1.4.0
follow-up). This check covers VIII anyway.

## Project Structure

### Documentation (this feature)

```text
specs/015-desktop-app-packaging/
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R19)
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1 (probe P1–P9, release checks)
├── contracts/
│   ├── backend-desktop-mode.md
│   ├── preload-bridge.md
│   ├── packaging.md
│   └── ui-contract.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml                         # + [dependency-groups] packaging = ["pyinstaller==6.22.3"]
├── packaging/unihelper-backend.spec       # onedir; migrations as data; hidden imports (R4)
├── src/unihelper/
│   ├── config.py                          # + files_dir, allowed_hosts, desktop flags; port default 47813
│   ├── main.py                            # admission middleware, desktop router, health fields
│   ├── db/migrate.py                      # + backup_before_upgrade, newer-DB detection
│   ├── api/deps.py                        # desktop owner auth; csrf no-op in desktop mode
│   ├── api/v1/setup.py, auth routes       # mode field; 404 not_in_desktop
│   └── desktop/
│       ├── serve.py                       # entry: handshake, watchdog, uvicorn.Server(host,port), exit codes
│       ├── handshake.py · admission.py · startup_errors.py
│       ├── owner.py                       # ensure desktop owner
│       ├── data_folder.py                 # check / move (copy+verify) / use / cleanup, marker
│       ├── routes.py                      # /api/v1/desktop/*
│       └── smoke.py                       # post-build smoke test
└── tests/{unit,contract,integration}/desktop/…

desktop/                                   # new package (Electron)
├── package.json · package-lock.json       # exact pins (R1); version = release version
├── electron-builder.yml                   # R15
├── build/entitlements.mac.plist · build/installer.nsh · build/icons/
├── scripts/afterPack.cjs                  # ad-hoc sign backend Mach-O files
├── src/
│   ├── main.ts                            # single-instance, app lifecycle, quit sequence
│   ├── backend.ts                         # spawn, handshake, identity, stop, stale marker, busy port
│   ├── winJob.ts                          # koffi job object + image path (win32 only)
│   ├── window.ts                          # BrowserWindow, partition, bounds, hardening
│   ├── permissions.ts · navigation.ts · downloads.ts · closeGuard.ts
│   ├── settingsStore.ts · logs.ts · paths.ts
│   ├── preload.ts                         # window.uhDesktop (contracts/preload-bridge.md)
│   └── startup/{startup.html, startup.ts, startup.css}
└── tests/e2e/                             # Playwright _electron (R19) + fixtures/tone-125s.wav

frontend/src/
├── features/desktop/{bridge.ts, DesktopCloseGuard.tsx, MicrophoneExplainer.tsx,
│                     MicrophoneDenied.tsx, DesktopSettings.tsx, guardState.ts}
├── features/auth/RequireAuth.tsx          # mode: "desktop" passthrough
└── features/recordings/…                  # call microphone explainer/request before first getUserMedia

.github/workflows/desktop-release.yml      # R18
README.md                                  # desktop install, unsigned warnings per OS, paths, port, restore backup
```

**Structure Decision**:
- The existing `backend/` and `frontend/` stay as they are, with additive desktop-mode code.
- A new top-level `desktop/` package holds the Electron shell, so the web build has no Electron
  dependency.
- The frontend detects the desktop only through `window.uhDesktop` and `setup/status.mode`.

## Delivery Phases

1. **Phase A — Windows probe**:
   - Backend: `serve`, handshake, port, `FILES_DIR`, desktop mode and admission.
   - The PyInstaller spec.
   - A minimal `desktop/` with backend lifecycle, job object, partition, permissions, close
     protocol and `will-prevent-unload`.
   - `electron-builder --dir`.
   - **Gate**: P1–P9 pass on Windows 10 and 11.
2. **Phase B — macOS and Linux probe**: the same build on macOS 13 Intel and macOS 15 Apple
   Silicon (ad-hoc, Info.plist and entitlements), Ubuntu 22.04 and 24.04 (X11 and Wayland) and
   Fedora 42.
   - **Gate**: P1–P9 on every system; the Ubuntu 24.04 AppImage sandbox question is settled.
3. **Phase C — product**:
   - first run, data-folder change, the Settings section, migration backup, the error pages
   - links and downloads, window state
   - installers, uninstaller message, README, CI release workflow, the full e2e suite
   - Starts only after A and B pass.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Electron + electron-builder (new `desktop/` package) | Own window, installers, and one Chromium so WebM/Opus and storage behave identically everywhere (FR-001, FR-040) | Tauri: system web engines can't record WebM/Opus on Ubuntu LTS or older macOS. Browser-only: out of scope. |
| PyInstaller (build-only) | Run the backend without Python installed (FR-002) | System Python: violates FR-002. onefile: leaves orphans on Windows. |
| koffi (Windows only) | Job object (kill backend with the app) and process-image lookup without a compiler | Native addon: per-OS C++ toolchain. `taskkill`: useless after main dies. |
| Playwright `_electron` (dev only) | Drive the packaged app with a fake microphone in CI | Manual-only testing can't meet Principle VI for record → save on every OS. |
| `/api/v1/desktop/*` + admission middleware | Identity, graceful stop, local-only access, data-folder moves | Signals only: no graceful stop on Windows. Cookie auth: reachable by other local programs. |
