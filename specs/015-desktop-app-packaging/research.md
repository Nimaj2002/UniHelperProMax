# Research: Desktop App for Windows, macOS and Linux

Phase 0 of [plan.md](./plan.md). Versions and platform support were checked on 2026-10-26
against:

- Electron: releases.electronjs.org, electronjs.org/docs/latest (electron-timelines,
  breaking-changes, api/session, api/web-contents, api/download-item) and the Electron README's
  "Platform support" section
- npm registry entries for `electron`, `electron-builder`, `@playwright/test` and `koffi`
- electron-builder 26.18.0's configuration schema (`packages/app-builder-lib/scheme.json` at
  the `electron-builder@26.18.0` tag); the electron.build pages returned 404
- playwright.dev (release notes, `class-electron`)
- pyinstaller.org and PyPI `pyinstaller`
- nodejs.org previous-releases
- The shell comparison done before the spec: Tauri was rejected because its system web engines
  cannot guarantee WebM/Opus recording (WebKitGTK needs GStreamer ≥ 1.24.9, so Ubuntu 22.04/24.04
  fail; WKWebView needs Safari 18.4+).

Every item gives the **decision**, the **rationale** and the **alternatives considered**.

---

## R1. Pinned versions

- **Decision**:

  | Component | Pin | Released | Notes |
  |---|---|---|---|
  | `electron` | **44.9.3** | 2026-10-21 | Chromium 152.0.7977.167, Node 24.22.0; a supported line (43, 44, 45) |
  | `electron-builder` | **26.17.0** | 2026-09-26 | 26.18.0 came out 2026-10-20; 27.x is alpha |
  | `koffi` (Windows job object only) | **3.3.2** | 2026-09-27 | 3.3.3/3.3.4 are under three weeks old |
  | `@playwright/test` | **1.64.1** | 2026-10-14 | Electron support is experimental, Electron v21+ |
  | `pyinstaller` | **6.22.3** | 2026-09-12 | Supports Python 3.8–3.15 |
  | Python (build) | **3.12** (latest patch) | — | Same as `Dockerfile` `PYTHON_VERSION` |
  | Node.js (build tooling) | **24.22.1** LTS | 2026-10-20 | Same major as Electron's bundled Node |

  All npm pins are exact (no `^`), and `package-lock.json` is committed.
- **Rationale**:
  - 45.0.0 is a `.0` release only five days old. 44.9.3 is the newest patch of a line that has
    shipped nine minor releases and is supported until 47 ships.
  - The plan moves to 45.x in a later release, once it has a few patches.
  - The electron-builder options this plan uses (`mac.entitlements`, `mac.entitlementsInherit`,
    `mac.extendInfo`, `mac.identity`, `mac.hardenedRuntime`, `mac.minimumSystemVersion`,
    `nsis.deleteAppDataOnUninstall`, `nsis.include`, `nsis.perMachine`, `nsis.oneClick`,
    `extraResources`, `asarUnpack`, `publish`) were confirmed in the 26.18.0 schema. All of them
    predate 26.17.0.
- **Alternatives considered**:
  - Electron 45.0.0: too new.
  - electron-builder 27 alpha: has breaking changes to update signing.
  - A native Node addon for the job object: needs a compiler per platform. koffi ships
    prebuilt binaries.

## R2. Oldest supported systems (FR-008)

- **Decision**: These are Electron 44's own limits.

  | System | Oldest supported | Source |
  |---|---|---|
  | Windows | **Windows 10** (x64) | README "Windows 10 and up"; Windows 7/8/8.1 were dropped in Electron 23 |
  | macOS | **macOS 13 Ventura**, Apple Silicon and Intel | Breaking changes 44.0 "Removed: macOS 12 support"; README "Ventura and up" |
  | Linux | **Ubuntu 22.04 LTS**, Debian 12, Fedora 42 (x64; X11 and Wayland) | README: distributions "still supported by both Chromium and the distro maker (without requiring a paid subscription)" |

  - The Linux list is our reading of that policy. Ubuntu 22.04's standard support ends in April
    2027, and the policy then drops it.
  - The Linux backend is built on Ubuntu 22.04 (glibc 2.35), so it runs on every newer distro
    in the list.
  - `mac.minimumSystemVersion` is set to `13.0`, and macOS itself refuses to open the app on
    older versions.
  - The NSIS installer refuses Windows versions older than 10.
  - Linux has no gate before launch. The AppImage and the `.deb` start Electron, which fails on
    an unsupported glibc. The README states the minimum, and the probe confirms the oldest
    distro.
- **Rationale**: FR-008 ties support to the pinned runtime. Electron's Chromium sets the floor,
  and PyInstaller's floor (macOS 10.15, Windows 8) is lower.
- **Alternatives considered**: Electron 37 (macOS 12): it is no longer supported by the Electron
  team, which rules it out for a security-sensitive shell.

## R3. Shell: Electron with its own Chromium

- **Decision**: Electron. The window loads `http://127.0.0.1:<port>/` from the bundled backend.
- **Rationale**: One Chromium build on every system gives:
  - `MediaRecorder` with `audio/webm;codecs=opus` (FR-040)
  - identical WebM output for `domain/webm.py split()` (Feature 004)
  - one permission API
  - the same IndexedDB and localStorage behavior that Feature 003's recovery relies on

  This matches the web version's primary browser.
- **Alternatives considered**:
  - Tauri: system web engines, so no WebM on Ubuntu LTS or older macOS (see the header).
  - A browser-only package: out of scope in the spec.

## R4. Backend packaging: PyInstaller onedir

- **Decision**: `backend/packaging/unihelper-backend.spec`, `--onedir`, console app (stdin/stdout
  pipes needed), entry `unihelper.desktop.serve:main`. The spec:
  - Adds `unihelper/db/migrations/**` (`env.py`, `versions/*.py`) as **data files** at
    `unihelper/db/migrations`. Alembic loads revision scripts from disk, so imports alone are not
    enough. `migrate.py` resolves the folder through `Path(__file__)`, which works under
    PyInstaller because `__file__` points into `_internal/`.
  - Collects hidden imports:
    - `uvicorn.lifespan.on`, `uvicorn.protocols.http.h11_impl`, `uvicorn.protocols.http.httptools_impl`,
      `uvicorn.loops.asyncio`
    - the `keyring.backends.*` modules for each OS (Windows, macOS, SecretService through
      `jeepney`)
    - `alembic.ddl.sqlite`
  - Bundles no frontend: `frontend/dist` ships separately as an Electron `extraResources` folder,
    and `UNIHELPER_STATIC_DIR` points to it.
  - Is built on each target OS. PyInstaller does not cross-compile.
  - A post-build smoke test runs the binary with temporary folders: it checks that
    `/api/v1/health` responds and that migrations reach head on an empty database.
- **Rationale**: In `--onefile` mode a bootloader parent starts the Python child. Killing the
  parent, which is all `TerminateProcess` and `child.kill()` do, leaves the child running on
  Windows. Onedir has one process, and it also starts faster because nothing is unpacked into
  a temp folder.
- **Alternatives considered**:
  - onefile: orphans (the user's constraint).
  - Nuitka: much longer builds and a heavier toolchain, with no gain for this app.
  - A system Python: violates FR-002.

## R5. Backend lifecycle owned by the Electron main process

- **Decision**:
  1. **Spawn**: `child_process.spawn(<resources>/backend/unihelper-backend[.exe])` with
     `stdio: ['pipe','pipe','pipe']`, `windowsHide: true`, and the environment from
     [contracts/backend-desktop-mode.md](./contracts/backend-desktop-mode.md).
  2. **Handshake on stdin**: main writes one JSON line `{launchToken, clientSecret}`. Each is 32
     random bytes, hex-encoded, newly generated for every launch. Main keeps the pipe open for
     the backend's whole life. The secrets never appear in the environment, the command line or
     the logs.
  3. **Health and identity**: main polls `GET /api/v1/desktop/identity?nonce=<random>` every
     200 ms for up to 30 s, and accepts only when `proof == HMAC-SHA256(launchToken, nonce)`.
     The window loads the app URL only after that. A process that merely listens on the port
     cannot produce the proof.
  4. **Stop**:
     - `POST /api/v1/desktop/shutdown` with `Authorization: Bearer <launchToken>`.
     - The backend sets uvicorn's `should_exit`. The lifespan then finalises active
       recordings, stops the workers, checkpoints the WAL and closes the engine.
     - Main waits up to **5 s** for the exit, then kills: TerminateProcess on Windows, SIGKILL
       elsewhere.
  5. **stdin watchdog**: a backend thread blocks on `stdin.read()`. EOF (main exited or crashed)
     triggers the same graceful shutdown, and `os._exit(0)` follows after 5 s if it has not
     finished. This works the same way on every OS.
  6. **Windows job object**: right after spawn, main calls `CreateJobObjectW`,
     `SetInformationJobObject(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)` and
     `AssignProcessToJobObject(OpenProcess(pid))` through koffi, and keeps the handle until it
     exits. If main dies, Windows closes the handle and kills the backend.
     - The race between spawn and assignment is harmless: the backend starts no children, and
       the stdin watchdog covers that window.
  7. **Linux**: also handled by the stdin watchdog. Plain `PR_SET_PDEATHSIG` cannot be set from
     Node, so it is not used.
  8. **Signals**: the backend handles SIGTERM, SIGINT and, on Windows, `CTRL_BREAK`/`CTRL_CLOSE`
     as a graceful shutdown. On Linux and macOS, the OS sends SIGTERM to the process group at
     logout or shutdown.
- **Rationale**: These are three independent safeguards: a graceful request, the stdin EOF that
  every OS delivers, and the Windows kernel job (FR-009, FR-010).
- **Alternatives considered**:
  - `taskkill /T`: only helps when main is still alive.
  - A separate Rust or Go launcher: another toolchain to maintain.

## R6. Stale backend, busy port, `server.lock`, second launch

- **Decision**:
  - **Run marker**: after a verified start, main writes
    `<backend data>/backend.run.json` `{pid, port, exe, launchId, startedAt}`, and deletes it
    after a clean stop.
  - **Stale backend**: on start, if the marker exists, the PID is alive and its executable path
    equals our backend executable, main kills that process and waits up to 5 s for the port and
    `server.lock` to be free. Executable path lookup:
    - Windows: `QueryFullProcessImageNameW` through koffi
    - macOS: `ps -o comm= -p <pid>`
    - Linux: `/proc/<pid>/exe`

    A reused PID that belongs to another program never matches, so FR-011's rule that only our
    own processes are stopped holds.
  - **Fallback ports** (added after the first Windows probe run): when the saved port is busy,
    main tries saved + 1 … saved + 4 and keeps the first free one in `desktop.json`, so the
    storage origin changes once, not every start. No fallback while `lastGuardState.pending`.
    Each refusal is logged with its OS code (`EADDRINUSE`, or `EACCES` for a port Windows
    reserves).
  - **Busy port**: before spawning, main does a trial `net.createServer().listen(port,
    '127.0.0.1')`.
    - If the port is busy and the owner is not our stale backend, the startup page shows "Port
      N is in use by another program" with Retry, Choose another port, Open logs and Quit.
    - Choose another port is blocked when `lastGuardState.pending` is true (R12, FR-022).
    - A bind race inside uvicorn is reported through exit code `10` and leads to the same
      page.
  - **`server.lock`**: stays in `UNIHELPER_DATA_DIR`, now the per-user backend data folder.
    - The single-instance lock plus stale handling make a conflict unlikely. If it happens
      anyway, for example because a developer runs a backend on the same folder, the backend
      exits with code `16`.
    - Main then shows "Another UniHelperProMax server is using your data" and never kills a
      process it did not start or recognise.
  - **Second launch**: `app.requestSingleInstanceLock()` is the first thing main does.
    - The second process exits before it spawns anything.
    - The first copy receives `second-instance` and restores, shows and focuses its window,
      or the first-run or error window if one is showing.
    - The lock is keyed to `userData`, so it is per user account. The AppImage and the `.deb`
      share one `productName`, and therefore one lock.
- **Rationale**: Every port or lock problem has a cause, a message and a way out (FR-005,
  FR-011, FR-021), and nothing kills a process that is not ours.

## R7. Fixed port and storage origin

- **Decision**:
  - Default desktop port: **47813**. It is fixed, stored in `desktop.json`, and passed as
    `UNIHELPER_PORT`.
  - `config.py`'s default changes from 8000 to 47813, and a new `unihelper.desktop.serve` entry
    is the first code that actually reads `settings.host` and `settings.port`.
  - `start.sh`, `start.ps1` and the `Dockerfile` keep passing `8000` explicitly, so the web and
    Docker versions are unchanged (FR-054).
  - The window origin is always `http://127.0.0.1:47813`: always `127.0.0.1`, never
    `localhost`, so the origin cannot change between IPv4 and IPv6 resolution.
  - A port change goes through the bridge (R12), is blocked while work is pending, warns, saves
    the new port and calls `app.relaunch()`.
- **Rationale**: IndexedDB (Feature 003's chunk store) and localStorage are keyed by
  scheme + host + port. A changed port silently strands buffered audio and drafts (FR-016).
- **Alternatives considered**:
  - A random free port: loses window storage on every start.
  - A custom `app://` protocol: would change the frontend's origin assumptions, cookies and the
    CSP, and the web version would diverge.

## R8. Local-only access: Host, Origin and client secret (FR-018–FR-020)

- **Decision**: three checks, enforced by a backend middleware in desktop mode:
  1. **Bind** `127.0.0.1` only. Desktop mode ignores `UNIHELPER_HOST`.
  2. **Host header** must equal `127.0.0.1:<port>`, otherwise `421 misdirected_request`. This
     blocks DNS rebinding.
     - Outside desktop mode, a Host allow-list is enforced only when `UNIHELPER_ALLOWED_HOSTS`
       is set; without it there is no check, so the web and Docker versions are unchanged
       (FR-054). A loopback default was dropped during implementation: the test client, the Vite
       proxy and existing installs send other Host values.
  3. **Client secret**: main adds `X-UniHelper-Client: <clientSecret>` to every request from
     the app session, through `session.webRequest.onBeforeSendHeaders` filtered to
     `http://127.0.0.1:<port>/*`.
     - The filter covers fetch, XHR, EventSource, workers, media range requests and
       navigations.
     - Missing or wrong secret → `403 not_from_app`.
     - Page JavaScript cannot read headers the main process adds, and other local programs
       never see the secret.
     - `Origin`, when present, must be `http://127.0.0.1:<port>`.
- **Rationale**: Binding to loopback stops other machines. The Host check stops websites using
  DNS rebinding. The per-launch secret stops other local programs and the user's own browser.
  The constitution's Principle VIII and the spec's "rejects requests that do not come from the
  app itself" both require this.
- **Alternatives considered**:
  - A cookie-only check: the user's browser on the same machine would still be able to reach
    the API with that cookie.
  - mTLS: heavy, and needs a local certificate authority.

## R9. Single-user mode replaces login (FR-033)

- **Decision**:
  - When `UNIHELPER_DESKTOP=1`, the backend:
    - ensures one owner exists on start-up. The username is the sanitised OS account name from
      `UNIHELPER_DESKTOP_USER`, falling back to `student`. The password hash is random and
      unusable, and no password change is required.
    - makes `current_auth` resolve every request that passed the client-secret check to that
      owner, with no cookie.
    - skips `csrf_protect`, because a custom header set by the main process is a stronger CSRF
      defence than the double-submit cookie.
    - returns `404 not_in_desktop` from `/setup/owner`, `/auth/login`, `/auth/logout`,
      `/auth/password` and other account-management routes.
    - adds `"mode": "desktop"` to `GET /api/v1/setup/status`. The web build gets `"mode": "web"`.
  - **Frontend**:
    - `RequireAuth` reads `mode`, and in desktop mode renders children directly.
    - The account menu hides Sign out and Change password when `mode === "desktop"`.
  - **The web build is unchanged**: without the variable the code paths are exactly as today.
    Contract tests cover both modes.
- **Rationale**: The storage layout keeps its per-user root (`files/<username>/…`), so the
  existing data model and Principle II hierarchy stay as they are. Desktop users never see a
  login screen.
- **Alternatives considered**:
  - An auto-login cookie: the session would expire after 90 days (`ABSOLUTE`), and the cookie
    is replayable by other local programs.
  - Removing users from the data model: too invasive.

## R10. Where data lives

- **Decision**:

  | Kind | Windows | macOS | Linux |
  |---|---|---|---|
  | Data folder (notes, recordings, documents, chats, attachments, as plain files) | User's choice; default `%USERPROFILE%\Documents\UniHelperProMax` | default `~/Documents/UniHelperProMax` | default `$XDG_DOCUMENTS_DIR/UniHelperProMax` (usually `~/Documents/…`) |
  | Backend data (`UNIHELPER_DATA_DIR`: SQLite DB, `server.lock`, `backups/`, `backend.run.json`, `startup-error.json`) | `%LOCALAPPDATA%\UniHelperProMax\backend` | `~/Library/Application Support/UniHelperProMax/backend` | `~/.local/share/UniHelperProMax/backend` (`$XDG_DATA_HOME`) |
  | Window storage (`persist:unihelper` partition: IndexedDB, localStorage, cache) and `desktop.json` | `%APPDATA%\UniHelperProMax` (Electron `userData`) | `~/Library/Application Support/UniHelperProMax` | `~/.config/UniHelperProMax` |
  | Logs (`main.log`, `backend.log`, rotated) | `%APPDATA%\UniHelperProMax\logs` | `~/Library/Logs/UniHelperProMax` | `~/.config/UniHelperProMax/logs` |
  | Master key | OS key store (Credential Manager, Keychain, Secret Service); fallback file `<backend data>/../keys/master.key` set through `UNIHELPER_KEY_FILE` | same | same |
  | App files (read-only) | `%LOCALAPPDATA%\Programs\UniHelperProMax` (per-user NSIS) | `/Applications/UniHelperProMax.app` | AppImage file wherever the user keeps it, or `/opt/UniHelperProMax` (`.deb`) |

  - A new `UNIHELPER_FILES_DIR` variable separates the files root from `UNIHELPER_DATA_DIR`. It
    defaults to `<data_dir>/files`, so the web layout is unchanged.
  - On Windows the backend data sits in Local AppData rather than Electron's roaming
    `userData`, so a large database does not roam with domain profiles.
  - A data folder inside the app files is refused (FR-027): the checked locations are the
    install directory, `process.resourcesPath`, the `.app` bundle and the AppImage mount.
- **Rationale**: Constitution VIII and FR-024–FR-026.

## R11. Can window storage be wiped after a period of disuse?

- **Decision / finding**:
  - **Time-based wiping, on any system: no.**
    - The 7-day cap on script-writable storage is a WebKit (Safari/WKWebView) Intelligent
      Tracking Prevention rule. Electron uses Chromium, which has no time-based expiry for
      IndexedDB or localStorage on Windows, macOS or Linux.
    - Login cookies cannot expire, because desktop mode uses none (R9).
  - **What can remove it**:
    - Chromium's **storage-pressure eviction** of "best-effort" origins, when the disk is
      nearly full.
    - The user, or a cleanup tool, deleting the app's data folder.
  - **Why we accept that risk**:
    - `persistent-storage` (`StorageManager.persist()`) would protect against eviction, but
      FR-041 allows only the microphone, so the origin stays best-effort.
    - IndexedDB only buffers chunks for seconds and drafts until autosave. The server copy is
      the source of truth.
    - If the probe shows eviction on a nearly full disk, granting `persistent-storage` for our
      origin is a one-line change that needs a spec amendment first.
- **How the probe checks it** (P5 in [quickstart.md](./quickstart.md)):
  1. Write a marker into IndexedDB and localStorage and record `navigator.storage.persisted()`
     and `estimate()`.
  2. Quit, move the system clock forward 40 days, relaunch, and confirm both markers survive.
  3. Repeat with an unfinished recording's chunks held in IndexedDB.

## R12. Close guard and quitting (FR-012–FR-015)

- **Decision**:
  - **The renderer is the source of truth for pending work.** A `DesktopCloseGuard` module
    reads:
    - the recorder (`recordings/recorder.ts`)
    - the uploader's `anyPending`
    - note autosave's `hasUnsaved`
    - import uploads (`imports/routes.tsx`)
    - the annotation op queue (`documents/reader/annotations`)

    It pushes `setGuardState({recording, pendingUploads, unsavedNotes, other})` to main on
    every change. Main stores the latest value and also writes `lastGuardState` into
    `desktop.json`.
  - **Window `close` and app `before-quit`**, including Cmd+Q and the taskbar or dock menu:
    1. Unless `quitConfirmed`, main calls `preventDefault()` and sends `close-requested`.
    2. The renderer answers `quit` when nothing is pending.
    3. Otherwise it shows the app's own AlertDialog:
       - while recording: "Stop recording and quit" / "Keep recording"
       - with pending saves: "Wait and quit" (progress, then quits by itself) / "Quit anyway"
         (work stays in IndexedDB and is saved on the next start)
    4. It answers `quit` or `stay`.
  - **Never silent**:
    - If the renderer does not answer within 3 s (hung or crashed), main shows a native dialog:
      "UniHelperProMax isn't responding. Quit anyway? Unsaved work stays on this computer and is
      saved next time." / "Wait".
    - Once the user confirms, main sets `quitConfirmed` and closes.
  - **`will-prevent-unload`**: the app's existing `beforeunload` handlers (autosave, recordings,
    imports, annotations) would make Electron cancel the close **silently**.
    - Main handles `will-prevent-unload`. If `quitConfirmed` (the user already chose), it calls
      `event.preventDefault()`, which ignores `beforeunload`.
    - Otherwise, for example on a reload, it shows a native "Leave and lose unsaved changes?" /
      "Stay" dialog, and `preventDefault()` only on Leave.
  - **"Stop recording and quit"**: stops the recorder, waits up to 15 s for the last chunk and
    `stop` to upload, then quits. Anything not uploaded stays in IndexedDB, and Feature 003's
    recovery worker sends it on the next start.
  - **After the window closes**: `will-quit` → stop the backend (R5) → `app.exit(0)`.
  - **All systems, including macOS**: `window-all-closed` → quit (FR-015).
  - **Windows logoff or shutdown**: Electron's `query-session-end` and `session-end` events run a
    fast stop (shutdown request, 2 s wait). The job object and the stdin watchdog cover the
    rest. Recordings are crash-safe by design, because every chunk is fsynced.

## R13. Permissions: microphone only, for our origin only (FR-041–FR-043)

- **Decision**:
  - **`setPermissionRequestHandler`**: grant only when all of these hold:
    - `permission === 'media'`
    - `details.mediaTypes` contains `'audio'` and not `'video'`
    - `new URL(details.requestingUrl).origin === appOrigin`
    - `webContents.id === mainWindow.webContents.id`
    - the request comes from the main frame

    Every other permission, including `display-capture`, `notifications`, `geolocation`,
    `persistent-storage`, `clipboard-read` and `midi`, gets `callback(false)`.
  - **`setPermissionCheckHandler`**: returns `true` only for `permission === 'media'`,
    `details.mediaType === 'audio'` and `requestingOrigin === appOrigin`. Everything else returns
    `false`.
    - The documentation names the request field `mediaTypes` (plural) and the check field
      `mediaType` (singular). The probe logs both objects to confirm the field names on 44.9.3.
  - **Device pickers**: `setDevicePermissionHandler` returns `false`. There is no
    `setDisplayMediaRequestHandler`, so screen capture stays denied.
  - **OS permission**:
    - Before the first recording, the app shows its explanation (FR-042). The renderer then
      calls `uhDesktop.microphone.request()`.
    - On macOS, main checks `systemPreferences.getMediaAccessStatus('microphone')`.
      `not-determined` leads to `askForMediaAccess('microphone')`. `denied` or `restricted`
      returns `denied`.
    - On Windows, the same status call reports the privacy setting.
    - On Linux there is no OS gate, so the result is `unknown` and `getUserMedia` errors decide.
    - `denied` shows per-OS steps (contracts/ui-contract.md) and creates no recording.
  - **macOS packaging**: Info.plist `NSMicrophoneUsageDescription` through `mac.extendInfo`, and
    the entitlement `com.apple.security.device.audio-input` (R15).

## R14. External links, navigation and downloads (FR-035–FR-037)

- **Decision**:
  - **`setWindowOpenHandler`**: always `{action: 'deny'}`.
    - `http:`, `https:` and `mailto:` URLs on another origin → `shell.openExternal(url)`.
    - Same-origin URLs, such as `SessionChip` and `SessionDetails` with `target=_blank` → main
      sends `navigate(path)` to the renderer, and react-router opens the route in the same
      window without a reload.
    - Any other scheme is ignored.
  - **`will-navigate` and `will-frame-navigate`** (main frame): allow same-origin; otherwise
    `preventDefault()` and open externally under the same scheme rules. `will-redirect` gets the
    same check.
  - **Downloads**: `session.on('will-download')`:
    - Only for our origin, including `blob:http://127.0.0.1:<port>/…`. Anything else is
      cancelled.
    - `item.setSaveDialogOptions({defaultPath: <Downloads>/<item.getFilename()>, filters})`.
    - Every export today uses fetch → blob → `<a download>`: `.ics`, theme JSON, tasks CSV,
      diagram image. All of them reach `will-download`, so no frontend change is needed.
  - **Window state**: bounds and maximized state go into `desktop.json`. On restore they are
    checked against `screen.getAllDisplays()`, and the window is centred if off-screen.
  - **Hardening**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
    `webSecurity: true`. Released builds have no devtools: `devTools: !app.isPackaged`, and the
    devtools menu items are removed.
  - **Fuses** (`@electron/fuses` through electron-builder `electronFuses`):
    - `RunAsNode` off
    - `EnableNodeCliInspectArguments` off
    - `EnableNodeOptionsEnvironmentVariable` off
    - `OnlyLoadAppFromAsar` on

## R15. Packaging with electron-builder

- **Decision** (`desktop/electron-builder.yml`):
  - **Identity**: `appId: io.github.nimaj2002.unihelperpromax`, `productName: UniHelperProMax`.
    Both are stable forever, because auto-update and the single-instance lock depend on them.
  - **Resources**: `extraResources` holds `backend/` (the PyInstaller onedir output) and
    `frontend/` (`frontend/dist`). Both sit outside the asar.
  - **Windows**: `nsis`.
    - `oneClick: false`, `perMachine: false`, so it is a per-user install with no admin
      prompt.
    - `allowToChangeInstallationDirectory: true`.
    - `deleteAppDataOnUninstall: false`.
    - `include: build/installer.nsh`, whose `customUnInstall` macro shows the data-folder path
      and says the data was kept (FR-031).
    - `x64` only.
  - **macOS**: `dmg`, with **separate `arm64` and `x64` builds**, each on a runner of its own
    architecture. PyInstaller cannot cross-build, and a universal Python with all
    universal2 wheels is not available.
    - `minimumSystemVersion: "13.0"`
    - `extendInfo.NSMicrophoneUsageDescription: "UniHelperProMax records lectures with your
      microphone."`
    - `hardenedRuntime: true`
    - entitlements: `com.apple.security.device.audio-input`, `cs.allow-jit`,
      `cs.allow-unsigned-executable-memory` and, for ad-hoc signing,
      `cs.disable-library-validation`
    - `identity: "-"`. The 26.x schema documents `"-"` as explicit ad-hoc signing and says
      hardened runtime then needs `disable-library-validation`.
    - An `afterPack` hook ad-hoc-signs every Mach-O file in `Resources/backend` (`codesign -s -
      --force --options runtime`) before the app is sealed.
  - **Linux**: `AppImage` and `deb` (x64). `category: Education`. No Snap. The `.deb` uses
    electron-builder's default SUID `chrome-sandbox`.
  - **Publishing**: `publish: github`. electron-builder also writes `latest.yml`,
    `latest-mac.yml` and `latest-linux.yml`, so electron-updater can be added later without
    changing names or the install layout.
  - **Proper signing later**:
    - Replace `identity: "-"` with a Developer ID, drop `disable-library-validation`, add
      `notarize: true` and the `APPLE_*` secrets.
    - Windows: add an Authenticode `win.signtoolOptions` or Azure signing.
    - None of the layout changes.
- **Rationale**: The user's packaging list. Every option was confirmed in the 26.x schema.

## R16. Database backup before migration (FR-046–FR-049)

- **Decision**: in `db/migrate.py`, before `upgrade_to_head` changes anything:
  1. Read the current revision. If it is unknown to the bundled scripts, the database is newer:
     exit with code `14`, untouched.
  2. If the current revision is head, do nothing.
  3. Check free space ≥ database size + WAL + 50 MB. Otherwise exit with code `17`.
  4. `sqlite3` online backup into
     `<data_dir>/backups/unihelper-<from>-to-<to>-<UTCstamp>.sqlite3`, then fsync and
     `PRAGMA integrity_check` on the copy.
  5. Prune to the newest three backups.

  The migration already runs in one `BEGIN IMMEDIATE` transaction with a foreign-key check.
  Any failure rolls back, so the database is left byte-identical, and the backend exits with
  code `15` and a `startup-error.json` naming the backup.
  - This applies in **all modes**, desktop and web. It is additive, the web database lives in
    the same `data_dir`, and Principle VIII asks for it.
- **Alternatives considered**: copying the file with `shutil.copy`: unsafe while WAL frames are
  pending.

## R17. Recorder probe before packaging

- **Decision**:
  - **Phase A: Windows 11 first.** It has the most students, and the job object and orphan
    behavior are the riskiest parts there.
  - **Phase B: macOS 13 (Intel) and macOS 15 (Apple Silicon), Ubuntu 22.04 and 24.04 (X11 and
    Wayland) and Fedora 42.**
  - The probe is the first slice of `desktop/` itself, not throwaway code. It contains:
    - the PyInstaller backend
    - `serve` and the stdin handshake
    - identity
    - the persist partition
    - the microphone handlers
    - `will-prevent-unload` handling
  - It is packaged with `electron-builder --dir`, unsigned or ad-hoc, so it has the macOS
    Info.plist.
  - Pass criteria are P1–P9 in [quickstart.md](./quickstart.md).
  - **Installers and CI start only after all systems pass.**
  - **Known risks the probe must settle on Linux**:
    - Ubuntu 24.04's AppArmor restriction on unprivileged user namespaces can stop the
      AppImage's Chromium sandbox. The `.deb`'s SUID sandbox is unaffected.
    - The AppImage needs `libfuse2` (`libfuse2t64` on 24.04).
    - The README covers both. Shipping `--no-sandbox` is **not** an accepted fix.

## R18. CI release workflow

- **Decision**: `.github/workflows/desktop-release.yml`.
  - **Triggers**: `push: tags: ['v*.*.*']`, plus `workflow_dispatch` for dry runs that do not
    publish.
  - **Matrix**, one runner per system plus one for each macOS architecture:

    | Runner | Builds |
    |---|---|
    | `windows-2022` | x64 NSIS |
    | `macos-14` | arm64 DMG |
    | `macos-15-intel` | x64 DMG |
    | `ubuntu-22.04` | AppImage + deb |

  - **Steps**:
    1. Check that the tag equals `desktop/package.json` `version` and `backend/pyproject.toml`
       `version`.
    2. Python 3.12 + `uv sync --frozen`.
    3. `npm ci` + `vite build` (Node 24.22.1).
    4. PyInstaller.
    5. The backend smoke test.
    6. `npm ci` in `desktop/` + `tsc`.
    7. `electron-builder --publish never`.
    8. Playwright desktop e2e: Linux under `xvfb-run`, Windows natively, macOS without the
       microphone tests (TCC cannot be granted on hosted runners).
    9. A final `publish` job uploads every artifact and `latest*.yml` to the tag's GitHub
       Release as a **draft**.

## R19. Playwright on Electron with a fake microphone

- **Decision**:
  - **Location**: `desktop/tests/e2e/`. Tests use `_electron.launch({ executablePath:
    <packaged app>, args: [...] })` against the **packaged** build.
  - **Chromium switches**: `--use-fake-device-for-media-stream` and
    `--use-file-for-fake-audio-capture=<fixtures>/tone-125s.wav`.
    - Not `--use-fake-ui-for-media-stream`: our permission handler is the code under test.
  - **Test-only environment**: `UNIHELPER_DESKTOP_PROFILE` gives each test a fresh `userData`,
    backend data folder and data folder.
    - `UNIHELPER_E2E_DENY_MIC=1` makes the handler deny. This can only reduce permissions, so
      shipping it is harmless.
  - Crash tests kill `electronApp.process()` with SIGKILL/TerminateProcess, then scan the
    process list for the backend executable.
  - Upload-blocking tests use `page.route()` on the chunk endpoint.
- **Test build**: Playwright attaches through Node's `--inspect`, which the release build's
  `enableNodeCliInspectArguments` fuse turns off (R14). `npm run build:e2e` builds the same app
  into `release-e2e/` with only that fuse flipped; released artifacts keep it off.
- **Rationale**: This is the only way to drive recording in CI. Playwright supports Electron
  21 and later, experimentally.
