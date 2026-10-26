# Recorder Probe Results (T042–T044)

The probe gate from [quickstart.md](./quickstart.md) (checks P1–P9) and
[tasks.md](./tasks.md) Phase 2. Installers, the README and CI (user story phases and Phase 10)
start only after **every** row below passes.

## How to run the probe on a system

```bash
# 1. frontend
pnpm --dir frontend install --frozen-lockfile && pnpm --dir frontend build
# 2. backend (Python 3.12 on the release runners)
cd backend && uv sync --frozen --group packaging
uv run pyinstaller --noconfirm packaging/unihelper-backend.spec
uv run python -m unihelper.desktop.smoke dist/unihelper-backend
# 3. desktop: unpacked app with DevTools enabled for the probe
cd ../desktop && npm ci && npm run probe
UNIHELPER_PROBE=1 release/<platform>-unpacked/<executable>
#    Windows: release\win-unpacked\UniHelperProMax.exe
#    macOS:   open "release/mac-arm64/UniHelperProMax.app" (or mac/ for Intel)
#    Linux:   release/linux-unpacked/unihelperpromax
# 4. automated part (same machine)
npm run build:e2e && UNIHELPER_E2E_EXECUTABLE=<release-e2e executable> npm run e2e
```

With `UNIHELPER_PROBE=1`, `main.log` records the first permission `details` object of each
kind. Use those lines to confirm the field names for P6. Logs are in the folder that Settings
shows; on Linux that is `~/.config/UniHelperProMax/logs`.

## Gate table

Fill in one row per system: ✅ pass, ❌ fail (with notes), — not run.

| System | CPU | Session | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | Date | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Windows 10 22H2 | x64 | — | — | — | — | — | — | — | — | — | — | | |
| Windows 11 | x64 | — | — | — | — | — | — | — | — | — | — | | |
| macOS 13 Ventura | Intel | — | — | — | — | — | — | — | — | — | — | | |
| macOS 15 | Apple Silicon | — | — | — | — | — | — | — | — | — | — | | |
| Ubuntu 22.04 | x64 | X11 | — | — | — | — | — | — | — | — | — | | |
| Ubuntu 22.04 | x64 | Wayland | — | — | — | — | — | — | — | — | — | | |
| Ubuntu 24.04 | x64 | X11 | — | — | — | — | — | — | — | — | — | | |
| Ubuntu 24.04 | x64 | Wayland | — | — | — | — | — | — | — | — | — | | |
| Fedora 42 | x64 | Wayland | — | — | — | — | — | — | — | — | — | | |

## Development machine (not a gate row)

This machine was used while building the probe slice: WSL2 on Windows, Linux kernel 6.18, WSLg
(Wayland + X), Python 3.14 backend build, 2026-10-26. It is not one of the supported systems,
so it does not count toward the gate.

- The backend smoke test on the PyInstaller onedir build (88 MB) passes: identity proof,
  migrations at head, graceful shutdown exit 0, and exit 0 within 5 s when stdin closes.
- Desktop e2e, run against both `electron .` and the packaged `release-e2e/linux-unpacked`
  build: 5 of 5 pass.
  - the app loads from `http://127.0.0.1:<port>` with no login screen
  - no backend remains after a normal quit (within 5 s) or after killing the app with SIGKILL
    (within 10 s)
  - `getUserMedia({audio})` is allowed with the fake microphone; video, geolocation and
    notifications are denied without a prompt
  - the deny switch works
  - IndexedDB and localStorage survive a restart
- Not covered here: P2–P4 with a real microphone, P5's clock change, P7 and P9 by hand.
  Recording (user story 2) and the close dialogs (user story 3) are built after the gate.

## Findings to carry into the gate

- **Permission field names (P6)**: to be confirmed from `main.log` on each system.
  `permissions.ts` reads `details.mediaTypes` (request) and `details.mediaType` (check).
- **Ubuntu 24.04 sandbox**: record whether the unpacked app and the AppImage start with the
  Chromium sandbox. If they need it, record the AppArmor profile chosen for the `.deb`.
  `--no-sandbox` is not an accepted remedy.
- **Windows job object**: P3 on Windows must show the backend gone within 5 s after the app
  process is ended in Task Manager. This is the only check that exercises `winJob.ts`.

## Gate decision (T044)

- [ ] Every row passes
- [ ] Permission field names confirmed (`desktop/src/permissions.ts` updated if they differ)
- [ ] Ubuntu 24.04 sandbox outcome and remedy recorded

Decision: _pending_
