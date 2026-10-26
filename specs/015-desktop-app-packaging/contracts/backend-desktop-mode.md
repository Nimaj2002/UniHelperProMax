# Contract: Backend in Desktop Mode

How the Electron main process starts, verifies, talks to and stops the bundled backend
(`unihelper-backend`, PyInstaller onedir). Research: R4–R10, R16.

## 1. Launch

Executable: `<resources>/backend/unihelper-backend` (`.exe` on Windows).
Entry point: `unihelper.desktop.serve:main`. The same entry runs from source with
`python -m unihelper.desktop.serve`.

### Environment set by main

| Variable | Value in desktop mode | Web/Docker |
|---|---|---|
| `UNIHELPER_DESKTOP` | `1` | unset (web behavior) |
| `UNIHELPER_PORT` | `desktop.json` `port` (default **47813**) | `start.sh`/`start.ps1`/`Dockerfile` keep passing 8000 |
| `UNIHELPER_HOST` | ignored; always `127.0.0.1` in desktop mode | unchanged |
| `UNIHELPER_DATA_DIR` | per-user backend data (research R10) | `./data` default unchanged |
| `UNIHELPER_FILES_DIR` (**new**) | the user's data folder | default `<data_dir>/files` |
| `UNIHELPER_STATIC_DIR` | `<resources>/frontend` | unchanged |
| `UNIHELPER_KEY_FILE` | `<backend data>/../keys/master.key` (fallback only; key store preferred) | unchanged |
| `UNIHELPER_DESKTOP_USER` | the OS account name (the backend sanitises it) | — |
| `UNIHELPER_DESKTOP_TZ` | the computer's IANA time zone, for the owner | — |
| `UNIHELPER_APP_FILES_ROOTS` | install dir, resources, `.app` bundle, AppImage mount (`path.delimiter`-separated) | — |
| `UNIHELPER_LOG_FILE` | path of `backend.log`, quoted in `startup-error.json` | — |
| `UNIHELPER_APP_VERSION` | `app.getVersion()` | — (pyproject version used) |
| `UNIHELPER_ALLOWED_HOSTS` (**new**) | not needed (desktop forces `127.0.0.1:<port>`) | optional comma list (`host` or `host:port`); unset = no Host check, as before |

`Settings.check()` additionally refuses:
- `UNIHELPER_FILES_DIR` inside `UNIHELPER_DATA_DIR`'s `backups/`
- the key file inside the files dir

### stdin handshake

1. Main writes exactly one line of UTF-8 JSON and does not close the pipe:
   `{"launchToken":"<64 hex>","clientSecret":"<64 hex>"}`
2. The backend reads that line before binding. A missing or malformed line in desktop mode
   exits with code `20`.
3. A watchdog thread then blocks on stdin. **EOF** triggers a graceful shutdown, and
   `os._exit(0)` follows if shutdown has not finished within 5 s.
4. The secrets are never logged and never written to disk.

### stdout/stderr

Main appends both to `backend.log`. The backend never prints secrets or note, chat or
recording content.

## 2. Exit codes and `startup-error.json`

Before exiting with a non-zero code, the backend writes `<UNIHELPER_DATA_DIR>/startup-error.json`:

```json
{ "code": "port_in_use", "exitCode": 10, "message": "Port 47813 is already in use.",
  "details": { "port": 47813 }, "logFile": "<path>", "at": "2026-10-26T10:00:00Z" }
```

| Exit | `code` | `details` |
|---|---|---|
| 10 | `port_in_use` | `port` |
| 11 | `data_dir_unwritable` | `path`, `reason` |
| 12 | `files_dir_missing` | `path` (never auto-created except on first run, when main creates it) |
| 13 | `database_damaged` | `path`, `latestBackup` (nullable) |
| 14 | `database_newer` | `dbRevision`, `appRevision` |
| 15 | `migration_failed` | `backup`, `fromRevision`, `toRevision`, `error` |
| 16 | `another_server` | `lockFile` (`server.lock` held) |
| 17 | `low_disk_for_backup` | `neededBytes`, `freeBytes` |
| 20 | `handshake_failed` | — |
| 1 | `unexpected` | `error` (no content, no secrets) |

Main deletes a stale `startup-error.json` before each spawn.

## 3. Request admission (desktop mode only)

A middleware runs before routing on every request, including static files:

1. `Host` header ≠ `127.0.0.1:<port>` → `421` `{"type":"misdirected_request"}`.
2. `X-UniHelper-Client` ≠ `clientSecret`, compared in constant time → `403`
   `{"type":"not_from_app"}`.
   - Exempt: only `GET /api/v1/desktop/identity`, which needs the nonce proof instead.
3. `Origin` present and ≠ `http://127.0.0.1:<port>` → `403 {"type":"bad_origin"}`.
4. In maintenance (§5), mutating methods → `503 {"type":"maintenance"}`.

Web mode: a Host allow-list only when `UNIHELPER_ALLOWED_HOSTS` is set; otherwise no Host check,
exactly as today (FR-054). (Changed during implementation from a loopback default: the test
client, the Vite proxy and existing installs send other Host values.)

## 4. Auth in desktop mode

- On start-up: ensure a single owner exists with
  - username = sanitised `UNIHELPER_DESKTOP_USER`, falling back to `student`
  - an unusable random password hash
  - `must_change_password = false`
- `current_auth` returns that owner for every admitted request; there are no cookies.
- `csrf_protect` is a no-op; admission step 2 replaces it.
- `GET /api/v1/setup/status` → `{"needs_owner": false, "mode": "desktop"}`. The web build
  returns `"mode": "web"` (an additive field).
- `POST /setup/owner`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password` and every
  `/admin/users` route → `404 {"code":"not_in_desktop"}`.
- `GET /auth/me` and `PATCH /auth/profile` (time zone) work unchanged; the mode is read from
  `GET /setup/status`.

## 5. Desktop endpoints (`/api/v1/desktop/*`, desktop mode only; 404 in web mode)

All of them except `identity` require admission. `shutdown` additionally requires
`Authorization: Bearer <launchToken>`.

### `GET /desktop/identity?nonce=<32–128 hex>`
- `200` `{"proof":"<hex HMAC-SHA256(key = bytes of launchToken, message = bytes of nonce)>","version":"1.0.0","pid":1234,"port":47813}`
- `400 bad_nonce`

### `POST /desktop/shutdown`
- `202` `{"status":"stopping"}`. Afterwards:
  - active recordings are finalised (Feature 003 `stop` semantics)
  - workers stop, and the transcription and chat runs end as Interrupted via `recover()` on
    the next start
  - `PRAGMA wal_checkpoint(TRUNCATE)`, engine closed, `server.lock` released, exit `0`
- `401 bad_token`

### `GET /desktop/busy`
- `200` `{"recording": bool, "transcribing": bool, "chatRunning": bool}`.
  Server-side activity; the window's own pending state (including import uploads) comes through
  the bridge.

### `POST /desktop/data-folder/check` `{"path": "<abs>"}`
- `200` `{"state": "empty" | "this_installation" | "other_installation" | "not_empty_unknown" | "not_writable" | "inside_app_files" | "missing", "freeBytes": n, "neededBytes": n}`
- `this_installation` means the folder's `.unihelperpromax.json` marker has our
  `installationId`.

### `POST /desktop/data-folder/move` `{"path": "<abs empty folder>"}`
1. `409 busy` if `/desktop/busy` reports any activity.
2. Otherwise `202`. The backend enters maintenance, then copies the files root into the target
   with per-file SHA-256 verification and writes the marker.
3. Progress: `GET /desktop/data-folder/move` →
   `{"state":"copying"|"verified"|"failed","copiedBytes":n,"totalBytes":n,"error":null}`.
4. On `verified`, main saves the new path and restarts the backend. On `failed`, maintenance
   ends and the old folder stays in use, untouched.

### `POST /desktop/data-folder/cleanup` `{"oldPath": "<abs>"}`
- Called by main after a successful restart on the new folder.
- Deletes the old copy only if its files match the stored verification manifest.
- `200` or `409 mismatch` (nothing deleted).

### `POST /desktop/data-folder/use` `{"path": "<abs>"}`
- Validates only (`this_installation` → `200`; otherwise `409 not_this_installation`).
- Main then saves the path and restarts the backend.
- Data from another installation is refused (spec FR-055).

## 6. Health

`GET /api/v1/health` → `{"status":"ok","version":"<app version>","mode":"desktop"|"web"}`.
These are additive fields; Docker's HEALTHCHECK is unaffected.

## 7. Migration backup (all modes)

See research R16 and [data-model.md](../data-model.md#migration-backup). Backups go to
`<UNIHELPER_DATA_DIR>/backups/`, and the newest three are kept.
