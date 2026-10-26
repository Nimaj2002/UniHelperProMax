# Data Model: Desktop App

Nothing in this feature changes the SQLite schema, so there is **no new migration**. The new
state lives in small JSON files and in the existing `users` table (the desktop owner). The
paths are in research R10.

## Desktop settings — `<userData>/desktop.json` (Electron main)

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | int | `1`. Unknown higher versions are left untouched and treated as defaults, with a log entry. |
| `port` | int | 1024–65535, default `47813` |
| `dataFolder` | string \| null | Absolute path. `null` until first run completes. Never inside the app files (FR-027). |
| `firstRunComplete` | bool | — |
| `micExplained` | bool | FR-042 |
| `window` | `{x, y, width, height, maximized}` | Validated against current displays on restore |
| `lastGuardState` | `{pending: bool, recording: bool, at: ISO}` | Written on every guard change. Read at start-up to block a port change (FR-022). |
| `pendingCleanup` | `{oldPath, manifestId}` \| null | Set between data-folder move and cleanup |

- Writes are atomic: temporary file, fsync, rename.
- A corrupt file is renamed to `desktop.json.corrupt-<stamp>` and defaults are used. The data
  folder is then asked for again, with the previous path pre-filled if it can be read.

## Run marker — `<backend data>/backend.run.json` (main)

`{pid, port, exe, launchId, startedAt}`. Written after identity verification and removed after a
clean stop. Its presence at start-up means the previous run did not stop cleanly (research R6).

## Data folder marker — `<data folder>/.unihelperpromax.json` (backend)

`{installationId, createdAt, appVersion}`. It identifies "this installation's data" for the
**Use this folder** action, and it lets the app refuse another installation's folder (FR-055).
It contains no secrets. `installationId` is the existing installation id used by the master
key.

## Startup error — `<backend data>/startup-error.json` (backend → main)

Shape and codes: [contracts/backend-desktop-mode.md §2](./contracts/backend-desktop-mode.md).

## Migration backup

- **File**: `<backend data>/backups/unihelper-<fromRev>-to-<toRev>-<YYYYMMDDTHHMMSSZ>.sqlite3`.
- **Rules**: it is created only when the revision changes and passes `integrity_check`
  before the migration starts. The newest **3** are kept; older ones are deleted only after a
  new backup is verified.

## Guard state (renderer, in memory)

`{recording: bool, pendingUploads: int, unsavedNotes: int, other: int}`, where
`pending = recording || pendingUploads + unsavedNotes + other > 0`.

Sources:
- `recorder.ts` (active)
- `uploader.anyPending` and the IndexedDB `chunks` count
- `autosave.hasUnsaved`
- import uploads
- the annotation `opQueue`

## Desktop owner (existing `users` row)

- Created by the backend in desktop mode when no owner exists.
- `username` = sanitised OS account name or `student`.
- Unusable password hash; `must_change_password = false`.
- Files live under the existing per-user root `<data folder>/<username>/…` (Principle II layout
  unchanged).

## State transitions

### App lifecycle (main)

```text
launch ─▶ single-instance? ──no──▶ exit (first copy focuses)
            │yes
            ▼
   first run? ──yes──▶ first-run page ──Continue──▶
            │no                                    │
            ▼                                      ▼
   stale marker? ──ours──▶ kill + wait ──▶ port free? ──no──▶ error: port_in_use
            │none/not ours                         │yes
            ▼                                      ▼
        spawn backend ──▶ handshake ──▶ identity ok (≤30 s) ──▶ load app URL ──▶ READY
                              │ exit≠0 / timeout
                              ▼
                       error page (startup-error.json)
READY ──close/quit──▶ close-requested ──quit──▶ STOPPING (shutdown, ≤5 s, kill) ──▶ exit
                                  └──stay──▶ READY
```

### Data folder change

```text
idle ─check─▶ (empty) ─move─▶ maintenance+copying ─verified─▶ restart on new ─▶ cleanup old ─▶ idle
                                       └─failed─▶ maintenance off, old kept ─▶ idle
      (this_installation) ─use─▶ restart on new ─▶ idle
      (other/not writable/inside app/missing) ─▶ refused with reason
```
