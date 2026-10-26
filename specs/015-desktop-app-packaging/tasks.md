---

description: "Task list for 015 — Desktop App for Windows, macOS and Linux"
---

# Tasks: Desktop App for Windows, macOS and Linux

**Input**: Design documents from `/specs/015-desktop-app-packaging/`

**Prerequisites**:
- plan.md and spec.md (US1–US7, 5 clarifications)
- research.md (R1–R19) and data-model.md
- contracts/backend-desktop-mode.md, preload-bridge.md, packaging.md and ui-contract.md
- quickstart.md (probe P1–P9, Phase C checks)

**Tests**: Included. Constitution VI requires endpoint tests for success and the primary errors.
The user's plan input also lists the desktop scenarios.
- The contract coverage guard (`backend/tests/contract/test_coverage.py`,
  `conftest.pytest_sessionfinish`) reads every `specs/NNN-*/contracts/openapi.yaml`.
- T012 therefore writes `specs/015-desktop-app-packaging/contracts/openapi.yaml` for the
  `/desktop/*` operations.
- The desktop router is **always registered**: its routes return `404 not_desktop` in web mode,
  so the live API and the contract match in the default test app.
- Validate bodies with `check(body, "<Schema>", spec="015")`.

**Organization**: the plan's delivery order.
1. **Phase 2 is the recorder-probe slice**, and ends with the probe gate: Windows first, then
   macOS and Linux.
2. User-story phases follow. Installers, the README and CI (US1 packaging, Phase 10) start only
   after the gate passes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: the user story in spec.md (US1–US7).

## Conventions (apply to every task)

**Backend** (root `backend/src/unihelper/`):
- New desktop code lives in `desktop/`.
- Routers are registered in `main.build_api_router()`.
- Errors use the existing problem+json helpers, with the `type` values from
  contracts/backend-desktop-mode.md.
- Tests go in `backend/tests/{unit,contract,integration}/desktop/`.
- A `desktop_app` fixture in `backend/tests/conftest.py` builds the app with
  `UNIHELPER_DESKTOP=1`, temporary `DATA_DIR`/`FILES_DIR` and a known
  `launchToken`/`clientSecret` injected through `unihelper.desktop.handshake.set_for_tests()`.

**Desktop** (root `desktop/`):
- TypeScript in `desktop/src/`, compiled with `tsc` to `desktop/dist/`.
- Every npm pin is exact (research R1).
- **Main must never**:
  - log `launchToken`, `clientSecret` or note, chat or recording content
  - kill a process that is not the backend it spawned or a stale backend it recognises
- IPC handlers validate payload shapes and the sender's `webContents.id`.

**Frontend** (root `frontend/src/`):
- Desktop-only UI lives in `features/desktop/`, and every bridge call goes through
  `features/desktop/bridge.ts`. In the web build these calls are no-ops or return `null`, and
  the web build's behavior must not change (FR-054).
- shadcn/ui primitives and theme tokens only (Principle V).

**Never**:
- `--onefile` for PyInstaller
- `--no-sandbox` for Electron
- Snap targets
- secrets in environment variables or on the command line

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The new `desktop/` package, the build-only backend dependency group and pinned
tooling.

- [X] T001 Create `desktop/package.json`:
  - `name: "unihelperpromax-desktop"`, `productName: "UniHelperProMax"`, `version: "0.1.0"`
    (equal to `backend/pyproject.toml`), `main: "dist/main.js"`
  - exact pins: `electron@44.9.3`, `electron-builder@26.17.0`, `koffi@3.3.2`,
    `@playwright/test@1.64.1`, and `typescript` at the frontend's version
  - scripts: `build` (`tsc -p .`), `probe` (`electron-builder --dir`), `dist`
    (`electron-builder --publish never`), `e2e` (`playwright test`)
  - Then commit `desktop/package-lock.json` from `npm install`.
- [X] T002 [P] Create `desktop/tsconfig.json`: `strict`, `module: commonjs`, `target: ES2022`,
  `outDir: dist`, `rootDir: src`. Create `desktop/.gitignore` for `dist/`, `release/`,
  `node_modules/` and `test-results/`.
- [X] T003 [P] Add `[dependency-groups] packaging = ["pyinstaller==6.22.3"]` to
  `backend/pyproject.toml`, keep runtime dependencies unchanged, and refresh `backend/uv.lock`
  with `uv lock`.
- [X] T004 [P] Create `desktop/electron-builder.yml` with the probe-level configuration
  (research R15, contracts/packaging.md):
  - `appId: io.github.nimaj2002.unihelperpromax`, `productName: UniHelperProMax`,
    `directories.output: release`, `files: [dist/**, package.json]`
  - `extraResources`: `{from: ../backend/dist/unihelper-backend, to: backend}` and
    `{from: ../frontend/dist, to: frontend}`
  - `mac`:
    - `minimumSystemVersion: "13.0"`, `hardenedRuntime: true`, `identity: "-"`
    - `entitlements` and `entitlementsInherit: build/entitlements.mac.plist`
    - `extendInfo.NSMicrophoneUsageDescription: "UniHelperProMax records lectures with your
      microphone."`
  - `electronFuses`: `runAsNode: false`, `enableNodeCliInspectArguments: false`,
    `enableNodeOptionsEnvironmentVariable: false`, `onlyLoadAppFromAsar: true`
  - no `snap` target anywhere
- [X] T005 [P] Create `desktop/build/entitlements.mac.plist` with
  `com.apple.security.device.audio-input`, `com.apple.security.cs.allow-jit`,
  `com.apple.security.cs.allow-unsigned-executable-memory` and
  `com.apple.security.cs.disable-library-validation`, all `true`. A comment explains that the
  last one is needed only while builds are ad-hoc signed (research R15).
- [X] T006 [P] Create `desktop/scripts/afterPack.cjs`, referenced as `afterPack` in
  `desktop/electron-builder.yml`. On macOS it runs `codesign --force --options runtime -s -` on
  every Mach-O file under `<app>/Contents/Resources/backend`, innermost first, before
  electron-builder signs the app. It is a no-op on other platforms.

---

## Phase 2: Foundational — the recorder-probe slice (Blocking Prerequisites)

**Purpose**: Everything the probe needs (quickstart P1–P9), and the base every user story builds
on: backend desktop mode, the PyInstaller backend and the Electron lifecycle core.

**⚠️ CRITICAL**: No user-story work and no installer, README or CI work begins until the
**probe gate (T042–T044)** passes on every system.

### Tests for the foundation

- [X] T007 [P] Unit tests `backend/tests/unit/desktop/test_handshake.py`:
  - a valid line parses
  - missing, short, non-hex or extra-field lines → `HandshakeError`
  - `proof(nonce)` equals `hmac.new(token, bytes.fromhex(nonce), sha256).hexdigest()`
  - nonce length outside 32–128 hex → error
  - secrets never appear in `repr()` or `str()` of the handshake object
- [X] T008 [P] Unit tests `backend/tests/unit/desktop/test_config_desktop.py`:
  - `UNIHELPER_PORT` default `47813`; `UNIHELPER_FILES_DIR` default `<data_dir>/files`
  - desktop mode forces host `127.0.0.1` even when `UNIHELPER_HOST=0.0.0.0`
  - `UNIHELPER_ALLOWED_HOSTS` parsing
  - `Settings.check()` refuses a files dir inside `<data_dir>/backups` and a key file inside the
    files dir
- [X] T009 [P] Contract tests `backend/tests/contract/desktop/test_admission.py` (`desktop_app`):
  - Host `evil.example` → `421 misdirected_request`
  - missing or wrong `X-UniHelper-Client` → `403 not_from_app`, including on `GET /` (static)
    and on `/api/v1/health`
  - Origin `http://evil.example` → `403 bad_origin`
  - correct headers → 200
  - `GET /desktop/identity` is admitted without the client header
  - Web mode with a loopback bind: Host `localhost:5173` is allowed and `evil.example` → 421;
    with a `0.0.0.0` bind and no variable, there is no Host check
- [X] T010 [P] Contract tests `backend/tests/contract/desktop/test_desktop_auth.py`:
  - desktop mode: the owner is auto-created with the username from `UNIHELPER_DESKTOP_USER`,
    sanitised, falling back to `student` (FR-025)
  - `GET /auth/me` works without cookies and returns `mode: "desktop"`
  - mutating requests succeed without `X-CSRF-Token`
  - `POST /setup/owner`, `POST /auth/login`, `POST /auth/logout`, `PUT /auth/password` →
    `404 not_in_desktop`
  - `GET /setup/status` → `{needs_owner: false, mode: "desktop"}`
  - web mode: `mode: "web"` and every existing auth behavior unchanged; the existing auth
    contract tests still pass untouched
- [X] T011 [P] Contract tests `backend/tests/contract/desktop/test_desktop_endpoints.py`:
  - `GET /desktop/identity` → proof correct; bad nonce → 400
  - `POST /desktop/shutdown` without or with the wrong bearer → 401; correct → 202 and the
    server's `should_exit` set
  - `GET /desktop/busy` reflects an active recording, a transcription job, a chat run and an
    import (shape from contracts §5)
  - every `/desktop/*` route in web mode → `404 not_desktop`
  - `GET /health` includes `version` and `mode` in both modes

### Contract and backend core

- [X] T012 Write `specs/015-desktop-app-packaging/contracts/openapi.yaml` (OpenAPI 3.1, same
  style as `specs/014-session-ai-chat/contracts/openapi.yaml`). Document:
  - `GET /desktop/identity`, `POST /desktop/shutdown`, `GET /desktop/busy`,
    `POST /desktop/data-folder/check`, `POST /desktop/data-folder/move`,
    `GET /desktop/data-folder/move`, `POST /desktop/data-folder/cleanup`,
    `POST /desktop/data-folder/use`
  - the new `mode` field on `SetupStatus` and `Me`, and `version`/`mode` on `Health`

  Use the request, response and error shapes in contracts/backend-desktop-mode.md §5–§6
  verbatim.
- [X] T013 Extend `backend/src/unihelper/config.py`:
  - `files_dir` from `UNIHELPER_FILES_DIR`, defaulting to `data_dir / "files"`; `files_root`
    returns it
  - `port` default `47813`
  - `desktop: bool` from `UNIHELPER_DESKTOP`
  - `desktop_user` from `UNIHELPER_DESKTOP_USER`, `app_version` from `UNIHELPER_APP_VERSION`
    (falling back to the package version), `allowed_hosts` from `UNIHELPER_ALLOWED_HOSTS`
  - in desktop mode `host` is always `127.0.0.1`
  - the new `check()` refusals from T008

  Leave `start.sh`, `start.ps1` and the `Dockerfile` passing `8000` explicitly, unchanged
  (FR-054).
- [X] T014 [P] Create `backend/src/unihelper/desktop/handshake.py`:
  - `read_handshake(stream) -> Handshake`: reads exactly one line of
    `{"launchToken","clientSecret"}`, each 64 lowercase hex characters, and raises
    `HandshakeError` otherwise
  - `Handshake.proof(nonce_hex)` and `Handshake.check_client(value)` using
    `hmac.compare_digest`
  - a module-level `current()` accessor and `set_for_tests()`
  - no logging of values
- [X] T015 [P] Create `backend/src/unihelper/desktop/startup_errors.py`:
  - an enum of the codes and exit numbers in contracts §2: `port_in_use` 10,
    `data_dir_unwritable` 11, `files_dir_missing` 12, `database_damaged` 13, `database_newer` 14,
    `migration_failed` 15, `another_server` 16, `low_disk_for_backup` 17, `handshake_failed` 20,
    `unexpected` 1
  - `write_startup_error(data_dir, code, message, details, log_file)`: writes
    `startup-error.json` atomically (temp file, fsync, rename) and returns the exit number
- [X] T016 Create `backend/src/unihelper/desktop/admission.py`, an ASGI middleware:
  - desktop mode: the Host check (`421`), the client-secret check, exempt only for
    `GET /api/v1/desktop/identity` (`403 not_from_app`), and the Origin check (`403 bad_origin`)
  - maintenance mode returns `503 maintenance` for mutating methods (a flag set by
    `data_folder.py`)
  - web mode: the allow-list from `allowed_hosts`. Otherwise, with a loopback bind, allow the
    host names `localhost`, `127.0.0.1` and `[::1]` on any port; with a non-loopback bind and
    no variable, skip the check
  - Register it in `backend/src/unihelper/main.py` before the existing `security_headers`
    middleware.
- [X] T017 Create `backend/src/unihelper/desktop/owner.py`, `ensure_desktop_owner(db,
  settings)`:
  - if no owner exists, create one with the username from `safe_name(settings.desktop_user)` or
    `student`, a random unusable password hash and `must_change_password = false`
  - return the owner's id
  - call it from the lifespan in `main.py` after migrations, in desktop mode only
- [X] T018 Update `backend/src/unihelper/api/deps.py`. In desktop mode:
  - `current_auth` returns the desktop owner without cookies; admission has already verified
    the client secret
  - `csrf_protect` is a no-op
  - account routes raise `404 not_in_desktop`: `setup.py` owner creation, login, logout,
    password change and owner account management in `backend/src/unihelper/api/v1/`

  Add `mode` to `GET /setup/status` (`api/v1/setup.py`) and to `GET /auth/me`. Web behavior is
  byte-for-byte unchanged.
- [X] T019 Create `backend/src/unihelper/desktop/routes.py` (router `/desktop`, always
  registered in `main.build_api_router()`, every route `404 not_desktop` in web mode):
  - `GET /identity`
  - `POST /shutdown`: bearer `launchToken`; sets the uvicorn server's `should_exit` through
    `serve.request_shutdown()` and returns 202
  - `GET /busy`: active recordings, transcription jobs, chat runs and imports, from the existing
    services
  - Add `version` and `mode` to `backend/src/unihelper/api/v1/health.py`.
- [X] T020 Create `backend/src/unihelper/desktop/serve.py`, `main()`:
  1. Load settings. In desktop mode, `read_handshake(sys.stdin)` or exit 20.
  2. Start a daemon watchdog thread that blocks on `sys.stdin.read()`. On EOF it calls
     `request_shutdown()` and, after 5 s, `os._exit(0)`.
  3. Install handlers: SIGTERM and SIGINT on POSIX; `SIGBREAK` and
     `SetConsoleCtrlHandler` (CTRL_CLOSE, CTRL_LOGOFF, CTRL_SHUTDOWN) on Windows, all calling
     `request_shutdown()`.
  4. Pre-flight before binding:
     - `data_dir` writable → else 11
     - `files_dir` exists → else 12; main creates it on first run
     - port bindable → else 10
  5. Run `uvicorn.Server(Config(app, host=settings.host, port=settings.port, workers=1,
     log_config=…))`.
  6. Map these startup failures to `write_startup_error`: `AnotherServerRunning` → 16,
     SQLite "file is not a database" or a failed `integrity_check` → 13, anything else → 1.

  Also runnable as `python -m unihelper.desktop.serve`.
- [X] T021 In `backend/src/unihelper/main.py` lifespan shutdown (desktop and web), make sure that
  in this order:
  1. active recordings are finalised as `stop` does (Feature 003)
  2. the transcription and chat workers are cancelled so `recover()` marks them Interrupted on
     the next start
  3. `PRAGMA wal_checkpoint(TRUNCATE)` runs
  4. the engine is disposed
  5. `server.lock` is released

  Add the integration test `backend/tests/integration/desktop/test_graceful_stop.py`:
  - shutdown with an active recording leaves a playable, finalised file
  - stdin EOF on a real subprocess of `python -m unihelper.desktop.serve` exits within 5 s with
    code 0 and leaves no `-wal` content

### PyInstaller backend

- [X] T022 Create `backend/packaging/unihelper-backend.spec`:
  - `--onedir` (`exclude_binaries=True`, a `COLLECT` step), `console=True`, entry
    `src/unihelper/desktop/serve.py`, name `unihelper-backend`
  - `datas`: `src/unihelper/db/migrations` → `unihelper/db/migrations`, including
    `versions/*.py`
  - `hiddenimports`: `uvicorn.lifespan.on`, `uvicorn.protocols.http.h11_impl`,
    `uvicorn.protocols.http.httptools_impl`, `uvicorn.loops.asyncio`, `alembic.ddl.sqlite`, and
    `collect_submodules("keyring.backends")` plus `jeepney` on Linux
  - a comment forbidding `--onefile` (research R4)
- [X] T023 Create `backend/src/unihelper/desktop/smoke.py` (`python -m unihelper.desktop.smoke
  <dist dir>`). It:
  1. starts the built binary with temporary `DATA_DIR`/`FILES_DIR` and a generated handshake
     on stdin
  2. polls identity until the proof matches (≤ 30 s)
  3. checks that the migration revision is head
  4. posts shutdown and asserts exit 0 within 5 s
  5. closes stdin on a second run and asserts exit within 5 s

  It exits non-zero on any failure.

### Electron core

- [X] T024 [P] Create `desktop/src/paths.ts` (research R10). It returns:
  - `userData`
  - `backendData`: `%LOCALAPPDATA%\UniHelperProMax\backend` on Windows,
    `<userData>/backend` on macOS, and `$XDG_DATA_HOME/UniHelperProMax/backend` (default
    `~/.local/share/…`) on Linux
  - `keyFile`: `<backendData>/../keys/master.key`
  - `logs`: `app.getPath('logs')`
  - `backendExe` and `frontendDir` under `process.resourcesPath`, or `../backend/dist` and
    `../frontend/dist` when `!app.isPackaged`
  - `appFilesRoots`: the install dir, `process.resourcesPath`, the `.app` bundle and the
    AppImage mount from `process.env.APPDIR`

  It honours `UNIHELPER_DESKTOP_PROFILE` (tests only) by rooting every per-user path under that
  folder.
- [X] T025 [P] Create `desktop/src/settingsStore.ts` for `desktop.json` (data-model.md):
  - fields and defaults: `schemaVersion: 1`, `port: 47813` ("1024–65535"),
    `dataFolder: null`, `firstRunComplete: false`, `micExplained: false`, `window`,
    `lastGuardState`, `pendingCleanup: null`
  - atomic writes (temp file, fsync, rename)
  - a corrupt file → rename to `desktop.json.corrupt-<stamp>` and use defaults
  - an unknown higher `schemaVersion` → defaults without overwriting the file, and a log entry
- [X] T026 [P] Create `desktop/src/logs.ts`:
  - `main.log` and `backend.log` in `paths.logs`
  - rotation at start: keep the last 10 runs, each file capped at 10 MB (FR-006)
  - a redaction helper that drops anything matching the 64-hex secrets
- [X] T027 [P] Create `desktop/src/winJob.ts` (win32 only; other platforms export no-ops), using
  koffi with `kernel32`:
  - `createKillOnCloseJob()`: `CreateJobObjectW` + `SetInformationJobObject(
    JobObjectExtendedLimitInformation, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)`
  - `assign(job, pid)`: `OpenProcess(PROCESS_SET_QUOTA|PROCESS_TERMINATE)` +
    `AssignProcessToJobObject`
  - `imagePath(pid)`: `QueryFullProcessImageNameW`

  Keep the job handle referenced for the life of the process.
- [X] T028 Create `desktop/src/backend.ts` (research R5):
  - `start({port, dataFolder})`:
    1. generate `launchToken` and `clientSecret` with `crypto.randomBytes(32).toString('hex')`
    2. delete any stale `startup-error.json`
    3. spawn `paths.backendExe` with the environment of contracts §1 (`UNIHELPER_DESKTOP=1`,
       `UNIHELPER_PORT`, `UNIHELPER_DATA_DIR`, `UNIHELPER_FILES_DIR`, `UNIHELPER_STATIC_DIR`,
       `UNIHELPER_KEY_FILE`, `UNIHELPER_DESKTOP_USER` from `os.userInfo().username`,
       `UNIHELPER_APP_VERSION`), `windowsHide: true`, piped stdio
    4. write the handshake line without closing stdin
    5. on Windows, call `winJob.assign` immediately
    6. pipe stdout and stderr to `backend.log`
    7. poll `GET /api/v1/desktop/identity?nonce=` every 200 ms for up to 30 s, verifying the
       HMAC
    8. on exit before verification, read `startup-error.json` and reject with it
  - `stop()`: `POST /desktop/shutdown` with the bearer token, wait for exit up to 5 s, then
    `child.kill('SIGKILL')` (TerminateProcess on Windows)
  - `clientSecret()` for header injection; secrets are never logged
- [X] T029 Create `desktop/src/window.ts`:
  - a `BrowserWindow` with `webPreferences: {partition: 'persist:unihelper', contextIsolation:
    true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged ||
    process.env.UNIHELPER_PROBE === '1', preload}`
  - `session.webRequest.onBeforeSendHeaders({urls: ['http://127.0.0.1:<port>/*']})`, which adds
    `X-UniHelper-Client`
  - in packaged builds, the application menu has no devtools items
  - `loadStartup(state)` loads `startup/startup.html`; `loadApp()` loads
    `http://127.0.0.1:<port>/`
- [X] T030 Create `desktop/src/permissions.ts` (research R13):
  - `setPermissionRequestHandler`: allow only when `permission === 'media'`,
    `details.mediaTypes` includes `'audio'` and not `'video'`, the origin equals `appOrigin`,
    `webContents.id` is the main window's, and the request comes from the main frame
  - `setPermissionCheckHandler`: `permission === 'media' && details.mediaType === 'audio' &&
    requestingOrigin === appOrigin`
  - `setDevicePermissionHandler(() => false)`
  - `UNIHELPER_E2E_DENY_MIC=1` makes both deny
  - log the full `details` objects once per kind when `UNIHELPER_PROBE=1`, to confirm the
    `mediaTypes`/`mediaType` field names (probe P6)
- [X] T031 Create `desktop/src/preload.ts`, which exposes `window.uhDesktop` through
  `contextBridge`, with exactly the calls and events in contracts/preload-bridge.md (`info`,
  `setGuardState`, `respondToClose`, `setPort`, `chooseDataFolder`, `changeDataFolder`,
  `openDataFolder`, `openLogsFolder`, `microphone.{status,request,markExplained}`, and the events
  `close-requested`, `navigate`, `data-folder-progress`). The object is frozen and has no other
  surface.
- [X] T032 Create `desktop/src/main.ts`:
  - `app.requestSingleInstanceLock()` first; on failure, `app.quit()` before anything else
  - `second-instance`: restore, show and focus the current window
  - `whenReady`:
    1. register the permission handlers
    2. show the startup page
    3. start the backend
    4. load the app, or show the error page
  - `window-all-closed` quits on every platform, including macOS (FR-015)
  - `will-quit` → `preventDefault()` until `backend.stop()` resolves, then `app.exit(0)`
  - `webContents.on('will-prevent-unload')`: `preventDefault()` when `quitConfirmed`; otherwise
    a native "Leave and lose unsaved changes?" / "Stay" box, calling `preventDefault()` only on
    Leave. The full close protocol comes in US3.
  - `UNIHELPER_PROBE=1` enables devtools for the probe build only.
- [X] T033 [P] Create the minimal `desktop/src/startup/startup.html`, `startup.css` and
  `startup.ts` (states `starting` and `error` from contracts/ui-contract.md). They use theme
  tokens copied into `startup.css` for light and dark, are keyboard operable, and have a strict
  CSP with no remote resources.
- [X] T034 [P] Frontend `frontend/src/features/desktop/bridge.ts`: a typed wrapper over
  `window.uhDesktop` (contracts/preload-bridge.md) that returns `null` or does nothing when it
  is absent. Add `isDesktop()`. Add the vitest
  `frontend/tests/unit/desktop/bridge.test.ts`: every call is safe without the bridge.
- [X] T035 Frontend `frontend/src/features/auth/RequireAuth.tsx`: read `mode` from
  `setup/status` and render children directly when `mode === "desktop"`. Hide Sign out, Change
  password and the Account settings page in desktop mode (`frontend/src/app/shell/AccountMenu.tsx`,
  `frontend/src/features/settings/routes.tsx`). Add the vitest
  `frontend/tests/unit/desktop/requireAuth.test.tsx` for both modes.

### Probe build and gate

- [X] T036 Add `desktop/tests/e2e/playwright.config.ts` and `desktop/tests/e2e/helpers.ts`:
  - `launchApp({profile, env, args})` uses `_electron.launch({executablePath: <release unpacked
    exe>, args, env: {UNIHELPER_DESKTOP_PROFILE: tmp, ...}})`
  - `backendPids()` scans the process list for `unihelper-backend`
  - `fakeMicArgs` = `--use-fake-device-for-media-stream`,
    `--use-file-for-fake-audio-capture=<fixtures>/tone-125s.wav`
  - Add a fixture `desktop/tests/e2e/fixtures/tone-125s.wav`: 48 kHz mono, generated by a
    committed script `desktop/tests/e2e/fixtures/make-tone.cjs`.
- [X] T037 [P] e2e `desktop/tests/e2e/lifecycle.spec.ts`:
  - launch → the app loads from `http://127.0.0.1:<port>` and no login appears
  - normal quit → no backend PIDs within 5 s (FR-010)
  - SIGKILL or TerminateProcess of `electronApp.process()` → no backend PIDs within 5 s
- [X] T038 [P] e2e `desktop/tests/e2e/permissions.spec.ts`:
  - `getUserMedia({audio:true})` resolves
  - `getUserMedia({video:true})` and the geolocation and notification requests are denied
    without a prompt
  - with `UNIHELPER_E2E_DENY_MIC=1`, audio is denied
- [X] T039 [P] e2e `desktop/tests/e2e/storage.spec.ts`: an IndexedDB and localStorage marker
  survives quit and relaunch with the same profile (FR-016)
- [X] T040 Probe packaging: `npm --prefix desktop run probe` builds
  `desktop/release/<platform>-unpacked` after `frontend` build, the PyInstaller build and
  `smoke.py`. Document the exact command sequence in a comment at the top of
  `desktop/electron-builder.yml`, matching quickstart.md "Build".
- [X] T041 Create `specs/015-desktop-app-packaging/probe-results.md`: a table per system (OS
  version, CPU, session type, P1–P9 result, evidence, notes, date), plus a section for the
  Ubuntu 24.04 AppImage sandbox finding and the observed permission `details` shapes.

**Probe gate** (manual, quickstart.md Phase A/B; record everything in `probe-results.md`)

- [ ] T042 **Phase A**: run P1–P9 on Windows 10 22H2 and Windows 11 x64. If anything fails, fix
  it in the Phase 2 tasks above and re-run.
- [ ] T043 **Phase B**: run P1–P9 on:
  - macOS 13 (Intel, x64 build) and macOS 15 (Apple Silicon, arm64 build)
  - Ubuntu 22.04 and 24.04, each on X11 and Wayland
  - Fedora 42

  For each Linux system, also record whether the unpacked app starts with the Chromium sandbox.
- [ ] T044 Gate decision in `probe-results.md`: every row passes, and the permission field names
  are confirmed (update `desktop/src/permissions.ts` if they differ). The Ubuntu 24.04 sandbox
  outcome and its chosen remedy (AppArmor profile in the `.deb` and README guidance for the
  AppImage) are recorded. `--no-sandbox` is not acceptable. **Stop here if the gate fails.**

**Checkpoint**: The probe passes on every system, and user-story work and packaging may begin.

---

## Phase 3: User Story 1 — Install and open the app like any other program (Priority: P1) 🎯 MVP

**Goal**: Installers for every system. First run asks for the data folder. The app opens without
login, works offline and runs a single copy.

**Independent Test**: On a clean, offline machine of each system, install, open, accept the
suggested folder, create a class, a session and a note, quit and reopen. The note is there, and
a `.md` file exists under `<data folder>/<login name>/…`.

### Tests for User Story 1

- [ ] T045 [P] [US1] e2e `desktop/tests/e2e/first-run.spec.ts`:
  - a fresh profile shows the first-run page with `<Documents>/UniHelperProMax` pre-filled
    (dialog stubbed to a temp folder)
  - Continue creates the folder and the app opens without login
  - creating a note writes `<folder>/<sanitised login>/…/notes/*.md`
  - the database is in `backendData`, not in the folder
  - relaunch does not ask again (FR-024–FR-026, FR-032)
- [ ] T046 [P] [US1] e2e `desktop/tests/e2e/single-instance.spec.ts`: launching a second process
  with the same profile exits within 5 s, there is still exactly one backend PID, and the first
  window is focused and restored from minimized (FR-004).
- [ ] T047 [P] [US1] e2e `desktop/tests/e2e/offline.spec.ts`: with `session.enableNetworkEmulation
  ({offline: true})` applied to non-loopback traffic through a test hook, the app loads, fonts
  render and a bundled PDF opens. A `webRequest` log shows no request to any host other than
  `127.0.0.1` (FR-051, SC-008).

### Implementation for User Story 1

- [ ] T048 [US1] First-run flow in `desktop/src/main.ts` and `desktop/src/startup/*`:
  - when `firstRunComplete` is false, show the `first-run` state of contracts/ui-contract.md
    with the default `path.join(app.getPath('documents'), 'UniHelperProMax')`
  - Choose folder… uses `dialog.showOpenDialog({properties: ['openDirectory','createDirectory']})`
  - validate: not inside `paths.appFilesRoots` (FR-027, with an explanation) and writable
  - create the folder, write `firstRunComplete` and `dataFolder`, then start the backend
- [ ] T049 [US1] Data-folder marker: `backend/src/unihelper/desktop/data_folder.py`
  `ensure_marker(files_dir, installation_id, app_version)` writes
  `<data folder>/.unihelperpromax.json` `{installationId, createdAt, appVersion}` (no secrets) on
  start in desktop mode when it is missing. Call it from the lifespan. Add a unit test in
  `backend/tests/unit/desktop/test_marker.py`.
- [ ] T050 [US1] Windows target in `desktop/electron-builder.yml`:
  - `win.target: [{target: nsis, arch: [x64]}]`
  - `nsis`: `oneClick: false`, `perMachine: false` (current user only, no administrator prompt,
    FR-001), `allowToChangeInstallationDirectory: true`, `deleteAppDataOnUninstall: false`,
    `include: build/installer.nsh`
  - `artifactName: UniHelperProMax-Setup-${version}-${arch}.${ext}`
  - refuse Windows < 10 through electron-builder's NSIS minimum OS check
- [ ] T051 [US1] macOS targets in `desktop/electron-builder.yml`:
  - `mac.target: [{target: dmg}]`, with the architecture chosen per runner (`--arm64` or
    `--x64`)
  - `artifactName: UniHelperProMax-${version}-${arch}.${ext}`
  - `category: public.app-category.education`
- [ ] T052 [US1] Linux targets in `desktop/electron-builder.yml`:
  - `linux.target: [AppImage, deb]` (x64), `category: Education`, `maintainer`
  - `artifactName` per contracts/packaging.md
  - for the `.deb`, add the AppArmor profile chosen at T044 through `deb.afterInstall` and
    `afterRemove` scripts in `desktop/build/linux/`
  - no `snap`
- [ ] T053 [US1] Desktop owner folder naming: confirm `owner.py` uses
  `safe_name(os login name)`, so files land under `<data folder>/<login name>/<year>/…`
  (FR-025, clarification Q3). Add an integration test in
  `backend/tests/integration/desktop/test_owner_folder.py` with a login name that has spaces
  and non-ASCII characters.
- [ ] T054 [US1] Installer smoke test script `desktop/scripts/installer-smoke.mjs` (used by CI):
  - Windows: install the NSIS `.exe` silently (`/S`) as a non-admin and assert the install path
    is under `%LOCALAPPDATA%\Programs`
  - Linux: `dpkg -i` the `.deb` and run the AppImage with `--appimage-extract-and-run`
  - launch with a temp profile, wait for identity, quit, and assert no backend PIDs remain

**Checkpoint**: US1 is shippable as an MVP. Installers open the app offline with a single
instance.

---

## Phase 4: User Story 2 — Record lectures reliably on every system (Priority: P1)

**Goal**: The microphone is explained and requested at the first recording, and denial gets
per-OS help. Recordings are WebM/Opus everywhere, and crash recovery works as in Feature 003.

**Independent Test**: On each system, record 2 minutes, stop, play back, confirm WebM/Opus and
transcribe. Deny the microphone and confirm the per-OS steps.

### Tests for User Story 2

- [ ] T055 [P] [US2] e2e `desktop/tests/e2e/recording.spec.ts` (fake microphone; Linux and
  Windows CI):
  - first record → explanation dialog → Continue → recording starts
  - after 2 minutes, stop: the saved file has `audio/webm` with codec `opus`, its duration is
    120 s ± 1 s (backend `analyse`), and the IndexedDB `chunks` store is empty
  - a second recording shows no explanation
- [ ] T056 [P] [US2] e2e `desktop/tests/e2e/recording-crash.spec.ts`:
  1. record 60 s, then block chunk uploads with `page.route` so some stay in IndexedDB
  2. SIGKILL the app
  3. assert no backend PIDs
  4. relaunch with the same profile: the recording is interrupted, the leftover chunks upload,
     and at most 5 s of audio is lost (FR-044, SC-005)
- [ ] T057 [P] [US2] e2e `desktop/tests/e2e/recording-denied.spec.ts`: with
  `UNIHELPER_E2E_DENY_MIC=1`, pressing Record shows the denied help for the current platform and
  creates no recording (FR-043).
- [ ] T058 [P] [US2] vitest `frontend/tests/unit/desktop/microphone.test.tsx`: the explanation
  shows once (`micExplained`); `denied` shows the Windows, macOS or Linux steps from
  contracts/ui-contract.md, chosen by `info().platform`; web mode renders nothing extra.

### Implementation for User Story 2

- [ ] T059 [US2] Main microphone IPC in `desktop/src/permissions.ts`:
  - `microphone.status`: `systemPreferences.getMediaAccessStatus('microphone')` on darwin and
    win32, `'unknown'` on Linux
  - `microphone.request`: darwin `askForMediaAccess('microphone')`; elsewhere return the status
  - `microphone.markExplained` writes `micExplained`
- [ ] T060 [US2] Create `frontend/src/features/desktop/MicrophoneExplainer.tsx` and
  `MicrophoneDenied.tsx` (shadcn AlertDialog, ui-contract.md text). In
  `frontend/src/features/recordings/recorder.ts`, before the first `getUserMedia` in desktop mode:
  1. if not explained, show the explainer, then `markExplained()`
  2. call `microphone.request()`; `denied` or `restricted` → show `MicrophoneDenied` and abort
     without creating a recording
  3. a `NotAllowedError` from `getUserMedia` on Linux → `MicrophoneDenied`

  The web build is unchanged.
- [ ] T061 [US2] In `frontend/src/features/recordings/recorder.ts`, in desktop mode, require
  `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')` and use exactly that type. If it is
  unsupported, show an error naming the problem and its log location rather than falling back
  (FR-040). Web behavior, including the Safari MP4 fallback, is unchanged.

**Checkpoint**: Recording passes on every system with the same format.

---

## Phase 5: User Story 3 — Quit safely, with nothing left running (Priority: P1)

**Goal**: Pending work and running server jobs are confirmed before quitting, the app never
refuses silently, the backend stops gracefully, and stale backends are replaced.

**Independent Test**: Quit normally, kill the app and shut the system down. No backend remains,
or the leftover is removed on the next start, and the data is intact.

### Tests for User Story 3

- [ ] T062 [P] [US3] e2e `desktop/tests/e2e/close-recording.spec.ts`:
  - close during a recording → dialog "A recording is in progress"
  - Keep recording → the window stays and the recording continues
  - close again, then Stop recording and quit → the app exits, the recording is saved and
    complete after relaunch (FR-012)
- [ ] T063 [P] [US3] e2e `desktop/tests/e2e/close-pending.spec.ts`:
  - block chunk uploads, close → "Still saving" with counts
  - Quit anyway → the app exits
  - relaunch with uploads unblocked → the chunks upload (FR-013)
  - a second run with Wait and quit → it quits by itself once uploads finish
- [ ] T064 [P] [US3] e2e `desktop/tests/e2e/close-server-work.spec.ts`: with a transcription job
  running against the fake transcriber (slow mode), close shows "Quitting stops it; you can
  restart it later" with Keep app open and Quit anyway. Quit anyway exits, and after relaunch
  the job shows Interrupted (FR-013a). Repeat with a streaming chat answer from the fake LLM.
- [ ] T065 [P] [US3] e2e `desktop/tests/e2e/close-unresponsive.spec.ts`: with the renderer
  hung through a test hook (`webContents.forcefullyCrashRenderer` or a busy loop), close shows the
  native "isn't responding" box within 4 s. Quit anyway exits, so the close is never silently
  refused (FR-014).
- [ ] T066 [P] [US3] e2e `desktop/tests/e2e/stale-backend.spec.ts`:
  - start `unihelper-backend` by hand with a handshake and write a matching `backend.run.json`
  - launch the app → the old PID is gone, a new backend serves, and the app loads
  - a marker whose PID belongs to an unrelated process (e.g. `node -e "setInterval(()=>{},1e3)"`)
    is ignored and that process is not killed (FR-011)
- [ ] T067 [P] [US3] vitest `frontend/tests/unit/desktop/closeGuard.test.tsx`:
  - guard-state aggregation from the recorder, uploader, autosave, imports and annotation
    queue, plus `/desktop/busy`
  - the single dialog lists every pending kind
  - choices map to `respondToClose("quit"|"stay")`
  - with nothing pending, it answers `quit` immediately

### Implementation for User Story 3

- [ ] T068 [US3] Create `frontend/src/features/desktop/guardState.ts`:
  - subscribe to `recordings/recorder.ts` (active), `recordings/uploader.ts` (`anyPending`
    and count), `sessions/autosave.ts` (`hasUnsaved` and count), `imports` (pending uploads)
    and `documents/reader/annotations/opQueue.ts`
  - compute `{recording, pendingUploads, unsavedNotes, other}` (data-model.md "Guard state")
    and push it with `setGuardState` on every change
- [ ] T069 [US3] Create `frontend/src/features/desktop/DesktopCloseGuard.tsx`, mounted in
  `frontend/src/app/shell/AppShell.tsx` only when `isDesktop()`. On `close-requested`:
  1. fetch `GET /api/v1/desktop/busy`
  2. if nothing is pending locally or on the server, answer `quit`
  3. otherwise show one AlertDialog listing each pending kind with the buttons and text of
     contracts/ui-contract.md
     - recording: Keep recording / Stop recording and quit
     - pending saves: Wait and quit with live progress / Quit anyway
     - transcription or AI answer (FR-013a): Keep app open / Quit anyway
  4. Stop recording and quit stops the recorder and waits up to 15 s for the last chunk and
     `stop` to upload, then answers `quit`
  5. Wait and quit answers `quit` when the counts reach 0
- [ ] T070 [US3] Update contracts/ui-contract.md "Close dialogs" and contracts/preload-bridge.md
  "Close protocol" with the FR-013a server-work row and the `/desktop/busy` lookup, matching
  T069.
- [ ] T071 [US3] Create `desktop/src/closeGuard.ts` and wire it in `main.ts`:
  - window `close` and app `before-quit` (Cmd+Q, menus): unless `quitConfirmed`,
    `preventDefault()` and send `close-requested`
  - start a 3 s timer; with no `respondToClose`, show the native box "UniHelperProMax isn't
    responding" (Wait / Quit anyway)
  - `quit` → `quitConfirmed = true`, close
  - `stay` → nothing
  - `will-prevent-unload` → `preventDefault()` when `quitConfirmed`
  - store each `setGuardState` and write `lastGuardState {pending, recording, at}` to
    `desktop.json`
- [ ] T072 [US3] Run marker and stale handling in `desktop/src/backend.ts` (research R6):
  - after verification, write `backend.run.json {pid, port, exe, launchId, startedAt}`
    atomically; delete it after a clean `stop()`
  - on start, if the marker exists, the PID is alive and the image path equals
    `paths.backendExe`, kill it and wait up to 5 s for the port and `server.lock` to free
  - image path: Windows `winJob.imagePath`, macOS `ps -o comm= -p`, Linux `readlink
    /proc/<pid>/exe`
  - otherwise ignore the marker; never kill a non-matching process
- [ ] T073 [US3] OS session end in `desktop/src/main.ts`:
  - Windows `query-session-end` and `session-end` on the main window → fast stop (shutdown
    request, 2 s wait, kill)
  - macOS and Linux: `before-quit` from the OS follows the confirmed path without dialogs when
    nothing is pending
  - the backend's own SIGTERM and CTRL_* handlers (T020) cover the rest
- [ ] T074 [US3] Integration test `backend/tests/integration/desktop/test_stop_paths.py`: SIGTERM
  (POSIX) and `CTRL_BREAK_EVENT` (Windows, skipped elsewhere) to a real `serve` subprocess each
  give a graceful exit within 5 s with `integrity_check` ok.

**Checkpoint**: Quitting never loses work, never refuses silently and never leaves a backend
running.

---

## Phase 6: User Story 4 — Keep data safe in a folder the student controls (Priority: P2)

**Goal**: The data folder is visible in Settings, can be moved or re-pointed safely, and survives
uninstall. The uninstaller says where the data is.

**Independent Test**: Create data, move the folder in Settings and confirm everything opens.
Uninstall and confirm the folder is byte-identical. Reinstall and confirm the same data is used.

### Tests for User Story 4

- [ ] T075 [P] [US4] Unit tests `backend/tests/unit/desktop/test_data_folder.py`:
  - `check()` returns every state of contracts §5: `empty`, `this_installation`,
    `other_installation`, `not_empty_unknown`, `not_writable`, `inside_app_files`, `missing`,
    with `freeBytes` and `neededBytes`
  - move: copy with SHA-256 verification, manifest written, failure mid-copy leaves the source
    untouched and the target cleaned
  - cleanup deletes only when the manifest matches
- [ ] T076 [P] [US4] Contract tests `backend/tests/contract/desktop/test_data_folder_endpoints.py`
  (`desktop_app`):
  - `POST /desktop/data-folder/check`
  - `POST /desktop/data-folder/move` → 202 then `GET` reaches `verified`; while busy → `409 busy`
  - mutating requests during the move → `503 maintenance`
  - `POST /desktop/data-folder/use` → 200 for `this_installation`, `409 not_this_installation`
    otherwise (FR-055)
  - `POST /desktop/data-folder/cleanup` → 200 or `409 mismatch`
- [ ] T077 [P] [US4] e2e `desktop/tests/e2e/data-folder.spec.ts`:
  - Settings → Desktop shows the path
  - Change… to an empty temp folder → Move → progress → the app restarts on the new folder,
    the notes open, and the old folder is removed
  - Change while recording → blocked with an explanation
  - Use this folder with another installation's marker → refused
- [ ] T078 [P] [US4] CI uninstall check in `desktop/scripts/installer-smoke.mjs`:
  1. after creating data, record a SHA-256 list of the data folder and `backendData`
  2. uninstall: Windows `Uninstall UniHelperProMax.exe /S`, Linux `apt-get remove -y
     unihelperpromax`
  3. assert both lists are unchanged (SC-007)
  4. reinstall, launch and assert there is no first-run page and the same data folder is used
     (FR-030, FR-032)

### Implementation for User Story 4

- [ ] T079 [US4] Complete `backend/src/unihelper/desktop/data_folder.py`:
  - `check(path)`: the states above; `inside_app_files` uses the roots main passes in
    `UNIHELPER_APP_FILES_ROOTS`, a path list added to contracts §1 by this task
  - `start_move(target)`: refuses when busy, sets maintenance, and copies the files root to
    `target` in a background thread with per-file SHA-256, a manifest
    `<backendData>/move-manifest-<id>.json` and progress
  - `cleanup(old_path, manifest_id)` and `use(path)`
  - an unwritable or full target fails before any change
- [ ] T080 [US4] Add the data-folder routes to `backend/src/unihelper/desktop/routes.py`
  (contracts §5) and keep `specs/015-desktop-app-packaging/contracts/openapi.yaml` in sync.
- [ ] T081 [US4] Main orchestration `desktop/src/dataFolder.ts`, behind the bridge's
  `chooseDataFolder` and `changeDataFolder`:
  1. refuse when `lastGuardState.pending`
  2. `check`
  3. for `move`: start, forward progress as `data-folder-progress`; on `verified`, save
     `dataFolder` and `pendingCleanup`, restart the backend and reload the window, then call
     cleanup and clear `pendingCleanup`
  4. for `use`: validate, save, restart and reload
  5. on failure, keep the old folder and report the reason

  On start, retry any leftover `pendingCleanup`.
- [ ] T082 [US4] Create `frontend/src/features/desktop/DesktopSettings.tsx` and register a
  "Desktop" section in `frontend/src/features/settings/routes.tsx`, desktop only:
  - version (`info().version`, FR-007)
  - data folder path with Open folder and Change… (dialog with Move here / Use this folder and
    a progress bar, disabled with an explanation while pending)
  - Port with Change… (US6 wires the behavior)
  - Open log folder

  Keyboard accessible; light and dark (Principle V).
- [ ] T083 [US4] Create `desktop/build/installer.nsh` with a `customUnInstall` macro that shows
  "Your notes, recordings and documents were kept in <data folder>. App settings and the
  database were kept in <backend data>." Read `<data folder>` from `desktop.json` with
  `nsJSON`, or fall back to the default path text. It deletes no user or app data (FR-031).

**Checkpoint**: The data folder is visible, movable and survives uninstall.

---

## Phase 7: User Story 5 — Upgrade to a newer version without losing anything (Priority: P2)

**Goal**: Install over the old version and keep everything. Every schema change gets a verified
backup first. A failed migration changes nothing and explains how to restore. A newer database is
refused.

**Independent Test**: Install N, add data, install N+1 with a migration: the backup exists and
the data is intact. A forced failing migration leaves the database byte-identical and shows the
restore steps.

### Tests for User Story 5

- [ ] T084 [P] [US5] Integration tests `backend/tests/integration/desktop/test_migration_backup.py`
  (real SQLite, temp dirs, all modes):
  - an upgrade from a non-head revision creates
    `backups/unihelper-<from>-to-<to>-<YYYYMMDDTHHMMSSZ>.sqlite3` that passes `integrity_check`
    before any change
  - at head, there is no backup
  - pruning keeps the newest 3, and only after a new backup verifies
  - a test-only failing revision (`script_location` pointed at a fixture copy of the
    migrations plus a raising revision) leaves the database file's SHA-256 identical after the
    engine closes, and `serve` exits 15 with `startup-error.json` naming the backup
  - an unknown current revision → exit 14, untouched
  - simulated low disk (`shutil.disk_usage` patched) → exit 17, untouched
- [ ] T085 [P] [US5] CI upgrade check in `desktop/scripts/installer-smoke.mjs`: install the
  previous release's installer, downloaded from the latest published GitHub Release and skipped
  when none exists, then create data, install the new build over it, launch, and assert that the
  data is intact and that a backup exists when the revision changed (FR-045, SC-006).

### Implementation for User Story 5

- [ ] T086 [US5] In `backend/src/unihelper/db/migrate.py`, add
  `prepare_upgrade(engine, data_dir) -> BackupInfo | None`, called before `upgrade_to_head`:
  1. read the current revision; one unknown to the script directory → raise `DatabaseNewer`
  2. at head → `None`
  3. free space < DB + WAL + 50 MB → `LowDiskForBackup`
  4. `sqlite3.Connection.backup` into the name above, then fsync and `integrity_check`
  5. prune to the newest 3

  Wrap `upgrade_to_head` failures as `MigrationFailed(backup)`. Use it from the `main.py`
  lifespan and `cli.py`, in all modes (research R16).
- [ ] T087 [US5] Map `DatabaseNewer` → 14, `LowDiskForBackup` → 17 and `MigrationFailed` → 15
  in `backend/src/unihelper/desktop/serve.py`, with `details` per contracts §2. In web mode they
  fail startup with the same messages in the log.
- [ ] T088 [US5] Startup page error states in `desktop/src/startup/startup.ts`:
  `database_newer`, `migration_failed` (backup path, "Nothing was changed", README link
  "Restoring a backup"), `low_disk_for_backup` and `database_damaged`, with the text of
  contracts/ui-contract.md. There is never a delete action.

**Checkpoint**: Upgrades are safe and failed migrations recoverable.

---

## Phase 8: User Story 6 — Start-up problems are explained, never a blank window (Priority: P2)

**Goal**: Every start-up failure names its cause and the log location. The port-in-use case can
be fixed in the app, and a port change is blocked while work is pending.

**Independent Test**: Occupy the port, make the folders unwritable or missing, damage the
database. Each start shows a message naming the cause and the log location.

### Tests for User Story 6

- [ ] T089 [P] [US6] e2e `desktop/tests/e2e/busy-port.spec.ts` (fallback cases already written
  after the first Windows probe run: fallback kept, no fallback with pending work, all taken;
  add the Choose-another-port dialog cases):
  - hold 127.0.0.1:47813 with a Node `net.Server`, then launch → the `port_in_use` page names
    port 47813
  - Choose another port (dialog stubbed) → relaunch on the new port and the app loads
  - with `lastGuardState.pending = true` seeded in `desktop.json`, Choose another port is
    disabled with the explanation (FR-021, FR-022)
- [ ] T090 [P] [US6] e2e `desktop/tests/e2e/startup-errors.spec.ts`:
  - read-only backend data → `data_dir_unwritable`
  - data folder deleted → `files_dir_missing` with Retry, Choose folder and Quit, and the folder
    is not recreated
  - a garbage `unihelper.sqlite3` → `database_damaged`, file untouched
  - another backend holding `server.lock` → `another_server`
  - each page shows the log path with Open log folder and Copy error (FR-005, SC-010)
- [ ] T091 [P] [US6] e2e `desktop/tests/e2e/port-settings.spec.ts`: Settings → Port → Change… to a
  free port shows the warning, then relaunches on the new port. With pending uploads (blocked by
  `page.route`), it is refused with the explanation (FR-023).

### Implementation for User Story 6

- [ ] T092 [US6] Busy-port pre-check in `desktop/src/backend.ts`: before spawning, call
  `net.createServer().listen(port, '127.0.0.1')`. On `EADDRINUSE`, first run the stale check
  (T072); if the port is still busy, raise `port_in_use`. Exit 10 from the backend maps to the
  same state.
- [ ] T093 [US6] Startup page states in `desktop/src/startup/startup.ts` for `port_in_use`
  (Choose another port, a numeric input 1024–65535 with a free-port check, disabled when
  `lastGuardState.pending`), `data_dir_unwritable`, `files_dir_missing` (Retry, Choose folder,
  Quit; never auto-create), `another_server` and `unexpected` (after the 30 s identity
  timeout). Every state has Open log folder, Copy error, Retry and Quit (contracts/ui-contract.md).
- [ ] T094 [US6] Bridge `setPort` in `desktop/src/main.ts`: validate 1024–65535 and free; refuse
  with `pending_work` when `lastGuardState.pending`; otherwise save `port` and call
  `app.relaunch(); app.exit(0)` after `backend.stop()`. Wire the Port row in
  `frontend/src/features/desktop/DesktopSettings.tsx` with the warning text from
  contracts/ui-contract.md.

**Checkpoint**: No start-up path ends in a blank window.

---

## Phase 9: User Story 7 — The window only ever shows the app (Priority: P3)

**Goal**: External links open in the default browser. The window never leaves the app. Exports
use a save dialog. Window bounds are remembered.

**Independent Test**: Click external links in a chat answer and a note, export `.ics`, a theme
and tasks CSV, and move and resize the window, then relaunch.

### Tests for User Story 7

- [ ] T095 [P] [US7] e2e `desktop/tests/e2e/navigation.spec.ts`, with `shell.openExternal`
  stubbed through `electronApp.evaluate`:
  - a chat answer link `https://example.org` → `openExternal` called and the window URL unchanged
  - `window.open('https://example.org')` → external
  - `location.href = 'https://example.org'` → blocked and external
  - `javascript:` or `file:` → ignored
  - `mailto:` → external
  - a same-origin `target=_blank` link (`SessionChip`) → navigates in the same window without a
    reload (FR-035, FR-036)
- [ ] T096 [P] [US7] e2e `desktop/tests/e2e/downloads.spec.ts`, with `dialog.showSaveDialog`
  stubbed: exporting `.ics` (calendar), the theme JSON and the tasks CSV each opens the save
  dialog with the suggested name and writes the chosen file (FR-037).
- [ ] T097 [P] [US7] e2e `desktop/tests/e2e/window-state.spec.ts`:
  - resize and move, quit, relaunch → same bounds
  - maximized → maximized
  - bounds seeded off-screen in `desktop.json` → centred on the primary display (FR-038)

### Implementation for User Story 7

- [ ] T098 [US7] Create `desktop/src/navigation.ts` (research R14):
  - `setWindowOpenHandler` always returns `{action:'deny'}`. Another origin with `http:`,
    `https:` or `mailto:` → `shell.openExternal`. The same origin → send `navigate` with the
    path. Other schemes are ignored.
  - `will-navigate`, `will-frame-navigate` (main frame) and `will-redirect`: same origin is
    allowed; otherwise `preventDefault()` and open externally under the same rules
- [ ] T099 [US7] Frontend: in `frontend/src/features/desktop/bridge.ts`, subscribe to `navigate`
  and call the router's `navigate(path)`. Register it in `frontend/src/app/router.tsx` when
  `isDesktop()`.
- [ ] T100 [US7] Create `desktop/src/downloads.ts`: `session.on('will-download')` cancels unless
  the URL's origin, including `blob:` origins, is `appOrigin`, then calls
  `item.setSaveDialogOptions({defaultPath: path.join(app.getPath('downloads'),
  item.getFilename()), filters: <from the extension>})`.
- [ ] T101 [US7] Window bounds in `desktop/src/window.ts`:
  - save `{x, y, width, height, maximized}` on `resize`, `move`, `maximize` and `unmaximize`
    (debounced 500 ms) and on close
  - restore after validating against `screen.getAllDisplays()` work areas; centre on the
    primary display when not visible

**Checkpoint**: All user stories are complete.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Release workflow, documentation, version consistency and the final validation pass.

- [X] T102 Create `.github/workflows/desktop-release.yml` (research R18, contracts/packaging.md):
  - triggers: `push: tags: ['v*.*.*']` and `workflow_dispatch` (dry run, no publish)
  - matrix `windows-2022` (x64 NSIS), `macos-14` (arm64 DMG), `macos-15-intel` (x64 DMG),
    `ubuntu-22.04` (AppImage and deb)
  - steps:
    1. version check: tag = `desktop/package.json` = `backend/pyproject.toml`, else fail
    2. Python 3.12 + `uv sync --frozen --group packaging`
    3. Node 24.22.1, `npm ci`, frontend build
    4. PyInstaller with `backend/packaging/unihelper-backend.spec`
    5. `python -m unihelper.desktop.smoke`
    6. `npm ci` and `npm run build` in `desktop/`
    7. `electron-builder --publish never` with the per-runner architecture flag
    8. `desktop/scripts/installer-smoke.mjs` on Windows and Linux
    9. the Playwright desktop e2e (Linux under `xvfb-run`; Windows; macOS with
       `--grep-invert @microphone`, tagging the US2 and recording-related specs `@microphone`)
    10. upload artifacts
  - a `publish` job (tags only) creates a **draft** GitHub Release with every artifact and
    `latest*.yml`, using `GITHUB_TOKEN` only
  - Done early at the user's request (2026-10-26). The workflow calls `scripts/build-desktop.sh`
    / `.ps1`, the same one-command builds used locally. **Still to add** when T054 lands: the
    `desktop/scripts/installer-smoke.mjs` step (install, launch, uninstall checks).
- [ ] T103 [P] Add a "Desktop app" section to `README.md`:
  - downloads per system
  - supported systems: Windows 10+ x64, macOS 13+ Apple Silicon and Intel, Ubuntu 22.04/24.04,
    Debian 12, Fedora 42+ (x64)
  - unsigned-release warnings and how to proceed:
    - Windows SmartScreen "Windows protected your PC" → More info → Run anyway, and that Smart
      App Control or the stricter protection setting may block unsigned programs entirely
    - macOS "cannot be opened" → System Settings → Privacy & Security → Open Anyway
    - Linux `chmod +x` for the AppImage, `libfuse2`/`libfuse2t64`, and the Ubuntu 24.04 sandbox
      guidance from T044
  - the default port 47813 and how to change it
  - per-OS paths for the data folder, backend data, logs and backups (research R10)
  - manual removal of data on macOS and Linux (FR-031)
  - "Restoring a backup"
  - that the web and Docker versions are unchanged (FR-052, FR-053)
- [ ] T104 [P] Add a "Desktop" note to `start.sh` and `start.ps1` comments only (no behavior
  change), stating that they still default to port 8000 and that the desktop app uses 47813.
- [ ] T105 Run the full existing suites unchanged (backend `uv run pytest`, frontend `npm test`
  and the web Playwright suite in `frontend/tests/e2e`) to prove FR-054. Fix only regressions
  caused by this feature.
- [ ] T106 Run quickstart.md Phase C on clean VMs of every system:
  - clean first run, uninstall keeps data, upgrade, failed migration, newer DB, busy port,
    stale backend, foreign requests (browser `fetch` → 403, Host `evil.example` → 421, another
    machine → refused), offline, links and exports
  - record the results in `specs/015-desktop-app-packaging/probe-results.md` under "Release
    checks"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup.
  - T012 (contract) comes before the contract tests can pass. T013–T021 are the backend core.
  - T022–T023 are the PyInstaller build. T024–T035 are the Electron core and frontend bridge.
  - T036–T041 are the probe tooling. **T042–T044 (the probe gate) block everything after.**
- **US1 (Phase 3)**: after the gate. This is the MVP.
- **US2 (Phase 4)** and **US3 (Phase 5)**: after the gate. They are independent of US1's
  installers, because they run on the unpacked build.
- **US4 (Phase 6)**: after the gate. T082's Settings section is reused by US6 (T094).
- **US5 (Phase 7)**: after the gate. Independent.
- **US6 (Phase 8)**: after US3's T072 (stale check reused by T092) and US4's T082 (Settings
  section).
- **US7 (Phase 9)**: after the gate. Independent.
- **Polish (Phase 10)**: T102 after US1 (targets) and the e2e specs it runs. T106 after all
  stories.

### Within Each Story

Tests first; they must fail before implementation. Then backend, then main process, then
frontend, then the checkpoint.

### Parallel Opportunities

- Setup: T002–T006 are parallel after T001.
- Foundation:
  - tests T007–T011 are parallel
  - T014 and T015 are parallel
  - T024–T027 are parallel
  - T033–T035 are parallel
  - T037–T039 are parallel
- After the gate, US1, US2, US3, US4, US5 and US7 can proceed in parallel by different people.
  US6 waits for T072 and T082.
- Every [P] test task within a story is parallel.

## Parallel Example: after the probe gate

```text
Developer A: US1 — T045–T054 (first run, installers)
Developer B: US3 — T062–T074 (close protocol, stale backend)
Developer C: US5 — T084–T088 (migration backup)
Developer D: US7 — T095–T101 (links, downloads, window state)
```

## Parallel Example: User Story 3 tests

```text
T062 close-recording.spec.ts · T063 close-pending.spec.ts · T064 close-server-work.spec.ts
T065 close-unresponsive.spec.ts · T066 stale-backend.spec.ts · T067 closeGuard.test.tsx
```

## Implementation Strategy

### MVP first

1. Phase 1, Phase 2, then **the probe gate on every system** (T042–T044).
2. Phase 3 (US1): installers that open the app offline, without login, as a single instance.
3. Phase 4 (US2) and Phase 5 (US3): recording and safe quitting complete the P1 promise, so
   ship only with all three P1 stories.

### Incremental delivery

- Add P2 (US4 data folder, US5 upgrades, US6 start-up errors) before the first public tag:
  US5's backup protects every later release.
- US7 (P3) can land in the same release or the next.
- Tag `v0.1.0` → T102 builds and drafts the release, and T106 validates before it is published.

### Notes

- Never weaken the probe gate. A failing system blocks installers and CI.
- Proper code signing, notarization and auto-update are out of scope. The layout, `appId`,
  artifact names and `latest*.yml` already allow adding them later without restructuring.
