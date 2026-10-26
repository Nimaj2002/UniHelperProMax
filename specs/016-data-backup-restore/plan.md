# Implementation Plan: Full Data Backup and Restore

**Branch**: `016-data-backup-restore` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-data-backup-restore/spec.md` (3 clarifications
of 2026-10-26; Assumptions corrected during planning to **account** scope — see research R1).

## Summary

A new **Settings → Backup & restore** page lets a student download one zip of everything they
have and later upload it to replace their data. "Everything" is every row of their account and
every file in their account folder. Provider and AI keys are the one exception: they are never
included.

Technical approach:

- **Archive** (R2–R4):
  - Contents: `manifest.json` (versions, counts, per-entry size + SHA-256), `data/<table>.jsonl`
    for every user-owned table, and `files/…` mirroring `<files_root>/<username>/`.
  - Compression: media is stored as is, text is deflated, and ZIP64 lifts the size limits.
  - Table selection: an explicit allow/deny list of tables, with a test that fails on any
    unclassified table, keeps future tables from being silently missed and keeps `secrets` out.
- **Backup** (R5, R6): an in-process background job.
  - It reads rows in one WAL read transaction (a consistent snapshot without blocking the
    student) and then streams the files.
  - It writes `<data_dir>/backups/exports/<user>/<job>.zip`.
  - The client polls progress, then downloads through a plain attachment link. The browser
    streams it to disk; the desktop app shows its save dialog (015).
- **Restore** (R7–R10):
  1. **Upload**: streamed to the existing `.uploads/` staging.
  2. **Validate in the background**, with nothing changed yet. The checks cover the manifest,
     hashes, safe paths, version, and whether any id is already used by another account. The
     result is a summary.
  3. **Confirm.** Run the gate (nothing recording, transcribing or answering), then lock the
     account (other requests get 423). Then:
     1. Write the safety backup, keeping only the newest.
     2. Load the rows into a scratch SQLite at the backup's schema revision and run the
        existing Alembic migrations to head.
     3. Extract the files beside the account folder and re-index the notes.
     4. Swap the account folder by rename, then replace the account's rows (and delete its
        `secrets`) in **one** DB transaction.
  4. **Recovery**: a journal plus `users.data_epoch` lets startup finish or undo an interrupted
     swap, so the data is all-old or all-new.
- **Other tabs** (R11): `X-Data-Epoch` on every response, with the client reloading when it
  changes. This needs migration `0014` (one column).
- **No new dependencies**: `zipfile`, `hashlib`, `json` and `shutil` are in the standard library.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5 / React 19 (frontend), Electron 44.9.3
main/preload (desktop, one bridge call).

**Primary Dependencies**:

- Backend, existing: FastAPI, SQLAlchemy 2, Alembic, anyio
- Backend, standard library: `zipfile` (ZIP64), `hashlib`, `json`, `shutil`
- Frontend, existing: shadcn/ui, TanStack Query, the `uploadFile` XHR helper
- No new packages

**Storage**:

- SQLite: new column `users.data_epoch`; migration `0014_data_epoch`.
- The file system:
  - `<data_dir>/backups/{exports,safety}/…`, scratch DB, journal
  - `<files_root>/.restore-<job>[-old]/` swap folders
  - the existing `<files_root>/.uploads/` staging

**Testing**:

- Backend: pytest (contract, unit and integration with the real API, real SQLite and temp dirs)
- Frontend: vitest + vitest-axe for the page
- End to end: Playwright for backup → restore

**Target Platform**: Web (self-hosted Linux/Docker) and the desktop app on Windows, macOS and
Linux (015).

**Project Type**: Web application (backend + frontend), packaged as a desktop app.

**Performance Goals**: SC-003. A 1 GB backup builds in < 2 min and restores in < 3 min; the bound
is SHA-256 and disk throughput. Progress updates at least every 500 ms.

**Constraints**:

- Memory stays flat for any size (streaming in 1 MiB blocks; JSONL row by row).
- Up to 20 GB per backup (FR-023).
- The student is never blocked during a backup.
- Restore is all-or-nothing, including on a crash.
- Nothing is ever written outside the staging and account folders.

**Scale/Scope**:

- One account per job.
- At most 1 restore and 2 exports at a time per server.
- About 35 tables classified.
- Thousands of files, many GB of audio.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Check | Result |
|---|---|---|
| I. User work is never lost | Restore is destructive. It has an explicit AlertDialog confirmation (FR-012), takes an automatic safety backup first and deletes the previous one only after the new one is complete (FR-014), and is atomic with crash recovery (R7). It is blocked while recording, while audio waits on the device, while uploads or note drafts are pending, and while transcribing or answering (FR-017). A backup never interrupts a recording (FR-008). | ✅ |
| II. Data ownership & open formats | The backup keeps the human-readable layout and original formats under `files/`. Row data is plain JSONL, and a README is included. The DB is still not the sole location of any content. Restore writes the normal hierarchy back. | ✅ |
| III. Frontend/backend separation | New versioned endpoints `/api/v1/backup/*` with a contract ([contracts/backup-api.md](./contracts/backup-api.md)). The frontend never touches the file system; downloads and uploads go through the API. The desktop `revealPath` is a preload call restricted to the safety folder, the same pattern as 015's `openDataFolder`. | ✅ |
| IV. Providers & secrets | `secrets` and `secret_store_meta` are never exported (R4). The account's secrets are deleted on restore (FR-016). Logs carry codes and sizes only. A test greps backup bytes for keys (SC-006). | ✅ |
| V. UI quality & accessibility | shadcn Card, Progress, AlertDialog and Alert; theme tokens only; keyboard operable; live regions for progress; the overlay traps focus without actions ([contracts/ui-contract.md](./contracts/ui-contract.md)). | ✅ |
| VI. Tests | Contract tests for every endpoint and error, and integration tests for the round trip, atomicity (kill per phase), upgrade from an older revision and account isolation. The existing critical-flow tests are unaffected and must stay green. | ✅ |
| VII. Simplicity & spec discipline | SQLite only. In-process jobs (like `RunRegistry`), no queue. No new packages. The spec's assumption was corrected *before* design (account scope). The scratch-DB upgrade reuses existing migrations instead of a second upgrade path. | ✅ (see Complexity Tracking) |
| VIII. Desktop data safety | The data folder location is unchanged by a restore. Migration `0014` gets 015's pre-migration DB backup automatically. The safety backup lives in backend data, outside the data folder, so a restore can't remove it. The server stays loopback-only. | ✅ |

Gate result: **PASS**. There are no unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/016-data-backup-restore/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R14 decisions
├── data-model.md        # data_epoch column, manifest, jobs, journal, working areas
├── quickstart.md        # validation scenarios
├── contracts/
│   ├── backup-api.md    # /api/v1/backup/* endpoints and error codes
│   └── ui-contract.md   # Settings → Backup & restore, other-tab behaviour, bridge call
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
backend/src/unihelper/
├── backup/                          # new package
│   ├── __init__.py
│   ├── tables.py                    # R4 classification: INCLUDED / EXCLUDED / row filters
│   ├── manifest.py                  # manifest model, counts, keysLeftOut, validation errors
│   ├── rows.py                      # JSONL encode/decode of rows (types, $b64)
│   ├── writer.py                    # build a backup zip from a snapshot (export + safety)
│   ├── reader.py                    # validate a zip: entries, hashes, safe paths, versions
│   ├── restore.py                   # gate, scratch-DB upgrade, staging, swap, commit, rollback
│   ├── recovery.py                  # startup: journal → finish or undo; sweep stale files
│   ├── jobs.py                      # BackupJobs registry, AccountLocks, capacity limits
│   └── errors.py                    # stable error codes → ApiError
├── storage/
│   └── backup_fs.py                 # new: the backup's file-system operations (walk, extract,
│                                    #   swap renames) — keeps "only storage/ touches files"
├── api/v1/backup.py                 # new router (contracts/backup-api.md)
├── api/deps.py                      # 423 restore_in_progress check; X-Data-Epoch header
├── db/migrations/versions/0014_data_epoch.py
├── models/user.py                   # data_epoch column
├── main.py                          # register router; run backup.recovery at startup
├── transcription/worker.py          # skip accounts under AccountLocks
└── chat/runs.py                     # refuse new runs for locked accounts

backend/tests/
├── contract/test_backup_api.py
├── unit/test_backup_tables.py, test_backup_archive.py, test_backup_rows.py
├── integration/test_backup_roundtrip.py, test_restore_atomicity.py,
│   test_restore_upgrade.py, test_backup_account_isolation.py
└── fixtures/backups/                # small fixture zips (older revision, damaged, unsafe)

frontend/src/
├── features/settings/backup/        # new
│   ├── BackupPage.tsx               # three cards (ui-contract)
│   ├── CreateBackupCard.tsx
│   ├── RestoreCard.tsx              # upload → summary → confirm → overlay
│   ├── SafetyBackupCard.tsx
│   ├── RestoreOverlay.tsx           # also used by the 423/epoch handler
│   ├── useRestoreBlockers.ts        # recording / chunk store / uploads / drafts signals
│   └── api.ts
├── features/settings/routes.tsx     # route "backup"; nav entry in SettingsLayout
├── features/desktop/bridge.ts       # revealPath()
└── lib/api/client.ts                # X-Data-Epoch watch + 423 handling

frontend/tests/unit/backup/…, frontend/tests/e2e/backup-restore.spec.ts

desktop/src/
├── preload.ts                       # expose revealPath
└── main.ts                          # ipc handler: resolve, check under backups/safety, showItemInFolder
```

**Structure Decision**: This keeps the existing web-application layout (`backend/` +
`frontend/`) plus the `desktop/` shell from 015.

- **Backend**: the logic is a self-contained `unihelper.backup` package. Its file-system work goes
  through `storage/backup_fs.py`, which keeps the rule that only `storage/` touches files.
- **Frontend**: the feature is one more Settings page under `features/settings/backup/`.

## Delivery Phases

1. **Foundation**:
   - migration `0014` + `data_epoch`
   - `backup/tables.py` with its coverage test
   - JSONL rows; the manifest
   - `storage/backup_fs.py`
2. **US1 Backup (P1)**: `writer.py`, the export job and endpoints, `CreateBackupCard`, and the
   download.
3. **US2 Restore (P1)**:
   - `reader.py` validation and the summary
   - gate, lock, 423
   - safety backup; staging, swap, commit, rollback; journal recovery
   - `RestoreCard` and overlay
   - epoch reload
   - `SafetyBackupCard` and `revealPath`
4. **US3 Older versions (P2)**: the scratch-DB upgrade path is exercised by an older-revision
   fixture; `backup_too_new` handling.
5. **Polish**: README section (proxy upload limits, R13), logs, accessibility pass in light and
   dark themes, performance check against SC-003.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New `unihelper.backup` package (≈9 modules) | Backup and restore span DB snapshot, archive, validation, atomic swap and recovery. One module would be > 1,500 lines. | Putting it in existing services mixes it with unrelated features and hides the R4 classification. |
| Scratch SQLite DB during restore | Upgrades older backups with the **existing** Alembic migrations (FR-019). | Hand-written per-version row converters would duplicate every migration and drift. |
| `users.data_epoch` column (migration 0014) | Tells other tabs, browsers and devices that data was replaced, and survives restarts (FR-018); it is also the commit marker for crash recovery. | An in-memory counter is lost on restart, and BroadcastChannel only reaches one browser. |
| In-process job registry + account lock | Progress, cancel and the 423 lock without new infrastructure (Principle VII). | A task queue or separate worker process would be new infrastructure. |
