---

description: "Task list for 016 Full Data Backup and Restore"
---

# Tasks: Full Data Backup and Restore

**Input**: Design documents from `/specs/016-data-backup-restore/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/backup-api.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included. Constitution Principle VI requires automated tests for every API endpoint (success + primary errors) and integration tests on the real API, SQLite and file system; the contract lists the required tests.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = Download a full backup (P1), US2 = Restore from a backup file (P1), US3 = Restore a backup from an older app version (P2)

## Path Conventions

Web app + desktop shell:

| Part | Source | Tests |
|---|---|---|
| Backend | `backend/src/unihelper/` | `backend/tests/` |
| Frontend | `frontend/src/` | `frontend/tests/` |
| Desktop | `desktop/src/` | — |

Run backend commands from `backend/` (`uv run pytest …`) and frontend commands from
`frontend/` (`pnpm test`, `pnpm e2e`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new package and folders the plan defines.

- [X] T001 Create the package `backend/src/unihelper/backup/__init__.py`. Its docstring summarises the feature and points to `specs/016-data-backup-restore/research.md`. Also create the folders `backend/tests/fixtures/backups/` and `frontend/src/features/settings/backup/`.
- [X] T002 [P] Create `backend/src/unihelper/backup/errors.py` with one factory per stable error code from `contracts/backup-api.md`. Each factory returns `unihelper.api.errors.ApiError` with the listed status and extra fields:
  - `backup_busy` (409, `jobId`)
  - `backup_capacity` (503)
  - `restore_capacity` (503)
  - `insufficient_storage` (507, `neededBytes`, `freeBytes`, optional `where`)
  - `not_a_backup`, `backup_damaged`
  - `backup_unsafe` (`paths`, max 20), `backup_names_invalid` (`paths`, max 20)
  - `backup_too_new` (`appVersion`), `backup_ids_in_use`
  - `not_awaiting_confirmation` (409)
  - `restore_blocked` (409, `reasons`, `items`)
  - `restore_running` (409)
  - `restore_in_progress` (423, `jobId`)
  - `files_in_use` (`path`), `restore_failed`
  
  Also add a `JobError` dataclass `{code, title, detail}` for errors recorded on a job instead of being raised.
- [X] T003 [P] Add `exports_dir`, `safety_dir` and `journal_path(user_id)` to `Settings` in `backend/src/unihelper/config.py`:
  - `exports_dir` = `backups_dir / "exports"`
  - `safety_dir` = `backups_dir / "safety"`
  - `journal_path(user_id)` = `backups_dir / f"restore-{user_id}.journal.json"`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pieces every story needs: the epoch column, table classification, row encoding, manifest, file-system helpers and the job registry.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add the migration `backend/src/unihelper/db/migrations/versions/0014_data_epoch.py`:
  - `revision = "0014"`, `down_revision = "0013"`
  - adds `users.data_epoch INTEGER NOT NULL DEFAULT 0` through `batch_alter_table`
  - DB-only, like `0001`–`0013`
  - downgrade drops the column
- [X] T005 Add `data_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")` to `User` in `backend/src/unihelper/models/user.py` (depends on T004).
- [X] T006 [P] Write `backend/src/unihelper/backup/tables.py` (research R4).
  - `INCLUDED`: an ordered tuple in FK-safe insert order:
    1. `years`, `semesters`, `courses`
    2. `class_series`, `class_links`, `event_series`, `event_links`, `session_exceptions`
    3. `trash_entries`, `session_folders`
    4. `notes`, `recordings`, `transcription_jobs`
    5. `documents`, `document_positions`, `annotation_ops`
    6. `chats`, `chat_drafts`, `chat_uploads`
    7. `task_columns`, `tasks`, `task_checklist_items`, `task_quick_notes`
    8. `themes`, `ui_preferences`, `workspace_states`
    9. `transcription_settings`, `provider_configs`
    10. `ai_settings`, `ai_endpoints`, `ai_models`
    11. `calendar_import_sources`, `calendar_import_runs`

    Verify the order against the real FKs in `backend/src/unihelper/models/`. Delete order is the reverse.
  - `EXCLUDED`: a dict from table to reason: `users`, `auth_sessions`, `secrets`, `secret_store_meta`, `chat_runs`, `calendar_import_uploads`.
  - `ROW_FILTERS`: extra SQL conditions per table:
    - `recordings`: `status != 'recording'`
    - `transcription_jobs`: `status NOT IN ACTIVE_STATUSES` (from `models/transcription.py`)
  - Tables without a `user_id` column (child tables such as `ai_models` or `task_checklist_items`, if any) must declare the parent join used to filter them by account.
- [X] T007 [P] Write `backend/tests/unit/test_backup_tables.py`. Assert that:
  - every table in `unihelper.models.Base.metadata.tables` is in exactly one of `INCLUDED` or `EXCLUDED`
  - no included table has a column whose name contains `key`, `secret`, `token` or `password`, except allow-listed non-secret columns (e.g. `name_key`, `file_key`, `folder_key`, `session_key`), each listed with a reason
  - every FK from an included table points to an included table or to `users`
  - `INCLUDED` order satisfies all FKs
- [X] T008 [P] Write `backend/src/unihelper/backup/rows.py`:
  - `encode_row(table, row) -> dict` and `decode_row(table, obj) -> dict`, typed per data-model.md: "TEXT/INTEGER/REAL as JSON values; BOOLEAN as true/false; DATE/TIME as ISO strings; BLOB as {"$b64": "..."}"
  - `iter_jsonl(fh)`, which yields parsed objects one line at a time and raises `backup_damaged` on any unparsable line
  - `write_jsonl(fh, rows)`
- [X] T009 [P] Write `backend/tests/unit/test_backup_rows.py`: round-trip every column type (str, int, float, bool, date, time, bytes, None), plus a bad line → `backup_damaged`.
- [X] T010 [P] Write `backend/src/unihelper/backup/manifest.py`. It defines the `Manifest` pydantic model with exactly the data-model.md fields:
  - `kind: Literal["unihelper-backup"]`
  - `formatVersion: int` (current `FORMAT_VERSION = 1`)
  - `appVersion: str`, `schemaRevision: str`, `createdAt` (ISO-8601 UTC)
  - `source: Literal["web","desktop"]`
  - `account: {timezone: str}`
  - `counts` with keys `semesters`, `courses`, `sessions`, `events`, `notes`, `recordings`, `documents`, `chats`, `tasks`, `themes`, `files`, `bytes`
  - `keysLeftOut: list[{kind: "transcription_provider"|"ai_endpoint", id, name}]`
  - `excluded: list[{reason: "recording_in_progress", name}]`
  - `entries: list[{path, size, sha256}]`, sorted by path

  Also `README_TEXT` (what the file is and how to restore it) and `known_revisions()`, which returns this app's Alembic revision ids in order (from `alembic.script.ScriptDirectory` over `db/migrate.MIGRATIONS_DIR`).
- [X] T011 [P] Write `backend/src/unihelper/storage/backup_fs.py`, the only place the feature touches files. It provides:
  - `walk_account(user_root) -> Iterator[(rel_posix_path, abs_path, size)]`
    - sorted
    - skips `.*.tmp-*` temp files and `*.part` files
    - never follows symlinks
  - `free_bytes(path)` through `shutil.disk_usage`
  - `check_space(path, needed, where)`, which raises `insufficient_storage` with `neededBytes`/`freeBytes`/`where` using a 64 MiB margin (same as `api/uploads.FREE_SPACE_MARGIN`)
  - `safe_extract_target(staging_root, rel_path) -> Path`: resolves the path and asserts it stays under `staging_root`
  - `swap_dirs(account_dir, staging_dir, old_dir)` and `unswap_dirs(...)`
    - use `os.replace`, with the retry used by `storage_service._replace_with_retry`
    - raise `files_in_use(path)` on `PermissionError`
  - `remove_tree(path)` for `.restore-*` folders only; it asserts the folder name starts with `.restore-`

  Update the module docstring in `backend/src/unihelper/storage/storage_service.py` to name `backup_fs.py` as the second file-system module.
- [X] T012 Write `backend/src/unihelper/backup/jobs.py` (research R12, data-model "Backup job" and "Account lock"):
  - **`BackupJob` dataclass**: `id` (uuid7), `user_id`, `kind`, `phase`, `bytes_done`, `bytes_total`, `error`, `summary`, `file_name`, `size`, `expires_at`, plus internal file paths and a `cancel` event.
  - **`BackupJobs` registry**:
    - `start_export(user)`, which raises `backup_busy` / `backup_capacity`
    - `create_restore(user, staged_upload)`
    - `get(user_id, job_id)`, returning 404 for another account
    - `cancel(user_id, job_id)`
    - `run_in_thread(job, fn)` through `anyio.to_thread`
    - `expire()` sweep: removes finished exports and validated uploads past `expires_at` (1 h)
    - limits: one job per account, 2 concurrent exports, 1 restore per server
  - **`AccountLocks`**: `lock(user_id, job_id)`, `unlock(user_id)`, `locked_job(user_id) -> str | None`.
  - Phase names exactly as in `contracts/backup-api.md` `BackupJob.phase`.
- [X] T013 Wire the registry and the epoch header in `backend/src/unihelper/main.py`:
  - create `app.state.backup_jobs = BackupJobs(...)` and `app.state.account_locks = AccountLocks()` in `create_app`
  - add a middleware that sets `X-Data-Epoch` on every authenticated `/api/v1` response, using the epoch the auth dependency stores on `request.state`

  In `backend/src/unihelper/api/deps.py`, extend `current_auth`:
  - store `user.data_epoch` on `request.state.data_epoch`
  - raise `restore_in_progress(jobId)` when `account_locks.locked_job(user.id)` is set, unless the route is `GET /api/v1/backup/jobs/{id}`

  Depends on T005 and T012.
- [X] T014 [P] Write `backend/tests/unit/test_backup_archive.py` (start here; T020 and T030 extend it) with helpers to build in-memory zips. Test `safe_extract_target` with three cases:
  - absolute paths → rejected
  - `..` → rejected
  - a normal nested path → resolves under the root

**Checkpoint**: Migration applies, the table coverage test passes, and every response carries `X-Data-Epoch`.

---

## Phase 3: User Story 1 - Download a full backup (Priority: P1) 🎯 MVP

**Goal**: From Settings → Backup & restore, the student gets one zip with every row and file of their account, without keys, while they keep working.

**Independent Test**: Seed an account with one of every item, create a backup, then open the zip with an archive tool. Check that:
- `files/` mirrors the account folder
- `manifest.json` has the counts and entries
- no key is in the bytes

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T015 [P] [US1] Write contract tests in `backend/tests/contract/test_backup_api.py` for these endpoints:
  - `POST /api/v1/backup/exports`: 202 `BackupJob`, 409 `backup_busy`, 503 `backup_capacity`, 507 `insufficient_storage` (monkeypatch free space)
  - `GET /api/v1/backup/jobs/{id}`: 200, and 404 for another account's job, using the `make_member` fixture
  - `DELETE /api/v1/backup/jobs/{id}`: 204, and the partial file is gone
  - `GET /api/v1/backup/exports/{id}/file`: 200 with `Content-Disposition: attachment; filename="UniHelperProMax-backup-YYYY-MM-DD-HHMM.zip"` and `Content-Length`; 404 before ready or after expiry
  - Also: the `X-Data-Epoch` header is present on an unrelated authenticated endpoint

  Run jobs synchronously in tests (a `BackupJobs` flag like `transcription_autorun=False`).
- [X] T016 [P] [US1] Write `backend/tests/integration/test_backup_contents.py`. Seed every kind of item with the existing test helpers (`tests/e2e_seed.py`, `tests/contract/*_helpers.py`); seed both a transcription key and an AI endpoint key. Then:
  1. Build a backup.
  2. Assert that every file under `<files_root>/<username>/` appears under `files/` with identical bytes, including a hand-added `extra.txt`.
  3. Assert that `.tmp-`/`.part` files are absent.
  4. Assert that every `INCLUDED` table has a `data/<table>.jsonl` with exactly the account's rows.
  5. Assert that a recording with `status='recording'` and its audio are left out and listed in `excluded`.
  6. Assert that both keys are listed in `keysLeftOut`.
  7. Assert that neither key's plaintext, nor any `secrets.ciphertext`, appears anywhere in the zip bytes (SC-006).
  8. Assert that another account's rows and files are absent.

### Implementation for User Story 1

- [X] T017 [US1] Write `backend/src/unihelper/backup/writer.py` with `write_backup(settings, engine, storage, user, out_path, progress, cancel) -> Manifest` (research R5, R6):
  1. Open one dedicated connection with `BEGIN` (WAL read snapshot), read `INCLUDED` rows for the user with `ROW_FILTERS`, and stream them through `rows.write_jsonl` into `data/<table>.jsonl` entries.
  2. Compute `counts` and `keysLeftOut`: providers and AI endpoints that have a `secrets` row, by id and display name. Read only `owner_kind`/`owner_id`, never the ciphertext.
  3. Collect the `excluded` recordings and their audio paths.
  4. Stream `walk_account` files into `files/<rel>` in 1 MiB blocks, computing SHA-256 and size per entry.
     - Store `.webm .m4a .mp3 .aac .wav .ogg .oga .opus .flac .pdf .png .jpg .jpeg .gif .webp` with `ZIP_STORED`; deflate everything else.
     - ZIP64 is always allowed.
  5. Write `README.txt` and finally `manifest.json` with `entries` sorted by path.
  6. Write to `out_path.with_suffix(".zip.part")`, fsync, then rename. Delete the `.part` on any exception or cancel.
  7. Report `bytes_done`/`bytes_total` (total = file bytes + row estimate) at least every 500 ms.
- [X] T018 [US1] Add the export runner to `backend/src/unihelper/backup/jobs.py`:
  1. Run `check_space(settings.exports_dir, account_bytes)`.
  2. Run `writer.write_backup` into `exports_dir/<user_id>/<job_id>.zip`.
  3. Set phase `preparing` → `writing` → `ready`, with `file_name` `UniHelperProMax-backup-<local YYYY-MM-DD-HHMM>.zip` (in the account's timezone) and `expires_at` = +1 h.
  4. Starting a new export deletes the account's previous finished export.
- [X] T019 [US1] Write the router `backend/src/unihelper/api/v1/backup.py` with `POST /backup/exports`, `GET /backup/jobs/{id}`, `DELETE /backup/jobs/{id}` and `GET /backup/exports/{id}/file` exactly per `contracts/backup-api.md`.
  - Serve the file with `FileResponse` plus a background task that deletes the file only after the response body is fully sent.
  - Register the router in `build_api_router` in `backend/src/unihelper/main.py`.
  - Add the Pydantic response schemas `BackupJob` / `RestoreSummary` / `SafetyBackup` to `backend/src/unihelper/schemas/backup.py`.
- [X] T020 [P] [US1] Extend `backend/tests/unit/test_backup_archive.py` with writer tests:
  - manifest entries match the zip directory exactly
  - stored vs deflated choice by extension
  - cancel leaves no `.part` and no `.zip`
- [X] T021 [US1] Add a startup sweep, `backend/src/unihelper/backup/recovery.py::sweep_exports(settings)`, which deletes everything in `exports_dir`. Call it from the lifespan in `backend/src/unihelper/main.py` after `upgrade_to_head`.
- [X] T022 [US1] Regenerate the API types: run `uv run python -m unihelper.export_openapi` to refresh `frontend/openapi.json`, then `pnpm gen:api` to update `frontend/src/lib/api/schema.d.ts`.
- [X] T023 [P] [US1] Write `frontend/src/features/settings/backup/api.ts`:
  - `startExport()`, `getJob(id)` and `cancelJob(id)`, using `apiFetch` from `@/lib/api/client`
  - `downloadExport(id)`: creates a hidden `<a href="/api/v1/backup/exports/{id}/file">` and clicks it. No blob, so the browser streams the file and the desktop app shows its save dialog.
  - `useJobPolling(id)`, a TanStack Query hook that polls every 500 ms until the phase is terminal
- [X] T024 [US1] Write `frontend/src/features/settings/backup/CreateBackupCard.tsx` with the states idle / running / ready / failed and the recording note, using the exact texts in `contracts/ui-contract.md` §1.
  - Use shadcn `Card`, `Button` and `Progress`.
  - Announce progress through `role="status" aria-live="polite"`.
  - Download automatically when `ready`; "Download again" calls `downloadExport`.
- [X] T025 [US1] Write `frontend/src/features/settings/backup/BackupPage.tsx` (cards in order: Create, Restore placeholder, Safety placeholder).
  - Add the route `{ path: "backup", element: loading(<BackupPage />) }` (lazy import) in `frontend/src/features/settings/routes.tsx`.
  - Add the nav entry `{ to: "/settings/backup", label: "Backup & restore" }` after "Import and export" in `frontend/src/features/settings/SettingsLayout.tsx`.
- [X] T026 [P] [US1] Write `frontend/tests/unit/backup/CreateBackupCard.test.tsx`: every state renders, Cancel calls `cancelJob`, ready triggers the download, and vitest-axe reports no violations.

**Checkpoint**: US1 alone delivers a downloadable, browsable full backup. Run T015 and T016.

---

## Phase 4: User Story 2 - Restore from a backup file (Priority: P1)

**Goal**: The student uploads a backup and sees a summary. After they confirm, all of their account's data is replaced atomically:
- a safety backup is made first, and only the newest one is kept
- keys are dropped
- hand-added files not in the backup are removed
- other tabs reload

**Independent Test**:
1. Back up, then restore into an empty account. Files must be byte-identical and rows equal apart from `user_id`.
2. Restore into a populated account. Extra files must be gone and present in the safety backup.
3. Kill the backend at each phase. After restart, the data must be all-old or all-new.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T027 [P] [US2] Extend `backend/tests/contract/test_backup_api.py` with:
  - **`POST /backup/restores`**: 202 (phase `validating` → `awaiting_confirmation` with `summary`), 411 `length_required`, 413 `file_too_large` (`maxBytes`), 409 `backup_busy`, 507
  - **Validation failures**, each ending `failed` with no data changed: `not_a_backup`, `backup_damaged`, `backup_unsafe`, `backup_names_invalid`, `backup_too_new`, `backup_ids_in_use` (member restores the owner's backup)
  - **`POST /backup/restores/{id}/confirm`**: 202, 404, 409 `not_awaiting_confirmation`, 409 `restore_blocked` with each reason (`recording_in_progress`, `transcription_running`, `chat_answer_running`, `job_running`), 503 `restore_capacity`, 507 with `where`
  - **`DELETE` of an awaiting restore**: 204 and the upload is deleted; 409 `restore_running` once confirmed
  - **`GET /backup/safety`**: 204 when none, 200 after a restore
  - **`GET /backup/safety/file`**: 200 / 404
  - **Account lock**: any other endpoint returns 423 `restore_in_progress` during a restore, while `GET /backup/jobs/{id}` still returns 200
- [X] T028 [P] [US2] Write `backend/tests/integration/test_backup_roundtrip.py` with three cases:
  1. **Empty account**: back up the seeded account A, restore into a fresh installation, and compare every file byte for byte and every row field for field (`user_id` remapped). Providers and endpoints report not configured, `secrets` is empty for the account, and `users.data_epoch` went up by 1.
  2. **Populated account**: add a note and a hand-added `extra.txt`, then restore the earlier backup. Both are gone, and the safety backup zip contains both.
  3. **Second restore**: restore again. Exactly one safety file exists, the new one, and the old one was deleted only after the new one was complete.

  Notes re-indexed: `notes.content_hash`/`size` match the files.
- [X] T029 [P] [US2] Write `backend/tests/integration/test_restore_atomicity.py`. Inject failures, by monkeypatching `backup_fs.swap_dirs`, the DB insert and `os.replace`, at each step:
  - during the safety backup
  - during staging
  - after the folder rename but before the DB commit
  - after the DB commit but before cleanup

  For each, simulate a process stop (no cleanup run). Then create a new app on the same data dir, so startup recovery runs, and assert that the data is entirely old or entirely new (folder + rows + `data_epoch`), that no `.restore-*` folders or scratch DB remain, and that the journal is gone (SC-004).
- [X] T030 [P] [US2] Extend `backend/tests/unit/test_backup_archive.py` with reader tests. Each case has a fixture zip built in the test:
  - extra entry, missing entry, size mismatch, SHA mismatch → `backup_damaged`
  - absolute path, `C:\`, `\\server`, `..`, backslash, NUL, symlink mode bits, duplicate, case-only duplicate → `backup_unsafe`
  - Windows reserved name or trailing dot/space → `backup_names_invalid`
  - an entry larger than its manifest size is cut off and refused
- [X] T031 [P] [US2] Write `backend/tests/integration/test_backup_account_isolation.py`. A member restores their backup; the owner's rows, files, secrets and `data_epoch` stay unchanged. The member's username, password hash and role are unchanged, and their `timezone` is restored.

### Implementation for User Story 2

- [X] T032 [US2] Write `backend/src/unihelper/backup/reader.py` with `validate_backup(zip_path, settings, engine, user, progress) -> (Manifest, RestoreSummary)` (research R3, R8, R9):
  1. Open with `zipfile`; on `BadZipFile` or a missing or invalid `manifest.json` → `not_a_backup`.
  2. Check `formatVersion <= FORMAT_VERSION` and `schemaRevision in known_revisions()`; otherwise `backup_too_new` with the backup's `appVersion`.
  3. Check the directory set equals `entries ∪ {manifest.json, README.txt}`.
  4. Check every name against the R9 rules (collect up to 20 paths): unsafe names → `backup_unsafe`; names invalid on this OS → `backup_names_invalid`.
  5. Stream each entry with a hard cap at its manifest size, comparing SHA-256 and size → `backup_damaged`.
  6. Parse every `data/*.jsonl` line.
  7. Collect all `id` values and query whether any exists with a different `user_id` in the same table → `backup_ids_in_use`.
  8. Build the `RestoreSummary`, with every field from `contracts/backup-api.md`:
     - `willUpgrade` = revision != head
     - current counts
     - `filesNotInBackup` = account files not listed under `files/`
     - `safetyBackup.replaces` from the current safety file
- [X] T033 [US2] Add the restore upload to `backend/src/unihelper/api/v1/backup.py`: `POST /backup/restores` uses `api.uploads.declared_length(request, 20 * 1024**3, "A backup")` and `receive_upload` into `.uploads/`, then `backup_jobs.create_restore`, which runs `reader.validate_backup` in a thread. Outcomes:
  - validation fails → phase `failed`, upload deleted
  - validation passes → phase `awaiting_confirmation` with `expires_at` = +1 h
- [X] T034 [US2] Write the gate in `backend/src/unihelper/backup/restore.py::check_gate(db, user, chat_runs, jobs)`. It returns the `restore_blocked` reasons and items:
  - recordings with `status='recording'`
  - `transcription_jobs` in `ACTIVE_STATUSES`
  - `app.state.chat_runs.active(user.id)`
  - any other running job of the account
- [X] T035 [US2] Write the safety backup in `backend/src/unihelper/backup/restore.py::make_safety_backup`, which reuses `writer.write_backup`:
  - output: `settings.safety_dir/<user_id>/safety-<UTC timestamp>.zip`
  - delete any older `safety-*.zip` of the account only after the new file is renamed into place (FR-014)
  - check space on `backups_dir` first (`where="backups"`)
- [X] T036 [US2] Write the scratch DB in `backend/src/unihelper/backup/restore.py::build_scratch_db` (research R7 step 4):
  1. Create `backups_dir/restore-<job>.sqlite3`.
  2. Alembic `upgrade <manifest.schemaRevision>` using `db.migrate.alembic_config` and the FK-off migration engine pattern from `db/migrate.py`.
  3. Insert a stub `users` row with the current user's id, username, a placeholder password hash, and role.
  4. Insert the decoded rows of each `data/<table>.jsonl` in `INCLUDED` order, with `user_id` replaced by the current user's id.
  5. `upgrade head`.
  6. `PRAGMA foreign_key_check` must be empty, otherwise `restore_failed`.
- [X] T037 [US2] Write staging in `backend/src/unihelper/backup/restore.py::stage_files`:
  1. Check space on `files_root` (`where="files"`, needed = `counts.bytes`).
  2. Extract `files/**` into `<files_root>/.restore-<job>/` through `backup_fs.safe_extract_target`, re-checking size and SHA-256 while writing.
  3. Re-index notes in the scratch DB: recompute `content_hash` (sha256 hex) and `size` for each `notes` row from the extracted file at its folder path. Resolve paths the same way `services/note_service.py` does.
  - *Built differently:* notes are not re-indexed; the notes service already takes a note file whose hash differs as the truth (002 N5). See research R7 step 6.
- [X] T038 [US2] Write the swap and commit in `backend/src/unihelper/backup/restore.py::swap_and_commit` (research R7 steps 7–8):
  1. Write the journal `{jobId, username, phase:"swapping", epochBefore, stagingDir, oldDir, scratchDb}` through temp file + fsync + rename at `settings.journal_path(user.id)`.
  2. `backup_fs.swap_dirs(<files_root>/<username>, .restore-<job>, .restore-<job>-old)`.
  3. Open one `BEGIN IMMEDIATE` transaction on the main DB:
     - delete the account's rows in reverse `INCLUDED` order, plus `DELETE FROM secrets WHERE user_id=?`
     - insert rows from the scratch DB in `INCLUDED` order
     - `UPDATE users SET timezone=?, data_epoch=data_epoch+1`
     - `PRAGMA foreign_key_check`
     - commit
  4. On any failure before the commit: roll back, `unswap_dirs`, end in phase `rolled_back` with the error.
  5. After the commit: journal `phase:"cleanup"`, remove the old dir, scratch DB and upload, delete the journal.
- [X] T039 [US2] Add the confirm runner to `backend/src/unihelper/backup/jobs.py` with `confirm_restore(user, job_id)`:
  1. Phase must be `awaiting_confirmation` (else `not_awaiting_confirmation`).
  2. Run `check_gate`; check server capacity (`restore_capacity`).
  3. `account_locks.lock`.
  4. In a thread, move through phases `safety_backup` → `staging` → `swapping` → `cleanup` → `done`, with byte progress.
  5. Always `unlock` in `finally`.

  Add `POST /backup/restores/{id}/confirm` (body `{ "confirm": true }`) to `backend/src/unihelper/api/v1/backup.py`.
- [X] T040 [US2] Write startup recovery, `backend/src/unihelper/backup/recovery.py::recover_restores(settings, engine)`. For each `restore-*.journal.json`:
  - **`swapping` and `users.data_epoch == epochBefore`**: `unswap_dirs` if the old dir exists.
  - **`swapping` and the epoch has changed**: treat as committed.
  - **`cleanup`**: the restore committed.

  In every case, remove the stale `.restore-*` folders, the scratch DB and the journal. Also delete orphan `.restore-*` folders and `restore-*.sqlite3` files that no journal names. Call it in the lifespan in `backend/src/unihelper/main.py` right after `upgrade_to_head`, before `ensure_desktop_owner`.
- [X] T041 [US2] Respect the account lock in long-running work:
  - `RunRegistry.check_capacity` in `backend/src/unihelper/chat/runs.py` raises `restore_in_progress` when the account is locked (pass `AccountLocks` in the constructor from `main.py`)
  - `TranscriptionWorker._fill` in `backend/src/unihelper/transcription/worker.py` skips jobs whose `user_id` is locked (extend `svc.queued_ids` to return `(job_id, user_id)`, or filter after the fact)
- [X] T042 [US2] Add `GET /backup/safety` (200 `SafetyBackup` with `path` only when `settings.desktop`, otherwise `null`; 204 when none) and `GET /backup/safety/file` (download named `UniHelperProMax-safety-backup-<date>.zip`; 404 when none) to `backend/src/unihelper/api/v1/backup.py`.
- [X] T043 [US2] Regenerate the API types (`frontend/openapi.json`, `frontend/src/lib/api/schema.d.ts`) as in T022.
- [X] T044 [P] [US2] Add `uploadBackup(file, onProgress, signal)` (through `uploadFile` from `@/lib/api/upload`, path `/backup/restores`), `confirmRestore(id)`, `getSafety()` and `safetyDownloadUrl()` to `frontend/src/features/settings/backup/api.ts`.
- [X] T045 [P] [US2] Write `frontend/src/features/settings/backup/useRestoreBlockers.ts`, which returns `{ blocked: boolean, reasons: { key, message }[] }` from three sources:
  - the activity signals from `useActivitySignals()` in `@/app/shell/registry`: a recording in progress and a running transcription or chat answer
  - the recording chunk store from `features/recordings/chunkStore.ts`: stored recordings or chunks not yet uploaded
  - unsaved note drafts from `features/sessions/autosave.ts`: any draft with status `dirty` or `saving`

  If a needed signal isn't exported yet, add a small exported selector in that module. Messages are exactly those in `contracts/ui-contract.md` "Blocked state".
- [X] T046 [US2] Write `frontend/src/features/settings/backup/RestoreOverlay.tsx`, a full-page blocking overlay with the text "Restoring your data… Don't close the app." and an optional phase and progress.
  - It traps focus and offers no actions.
  - It uses `role="alertdialog"` and `aria-busy`.
  - In the desktop app, while it is shown, it reports `other: 1` in the guard state through `features/desktop/bridge.ts` `setGuardState`, so closing asks first.
  - *Built differently:* the overlay protects closing with `beforeunload` rather than a desktop guard state. Nothing in the renderer answers the desktop close request yet, so reporting a guard state would make closing hang for 3 s.
- [X] T047 [US2] Write `frontend/src/features/settings/backup/RestoreCard.tsx` with steps 1–7 from `contracts/ui-contract.md` §2:
  - file input (`accept=".zip"`), upload progress + Cancel
  - "Checking the backup…"
  - summary: a table of backup vs. current counts, `willUpgrade` note, `keysLeftOut` list, `excluded` list, `filesNotInBackup`
  - **Restore…** opens a destructive `AlertDialog` titled "Replace all your data?" with the exact body text, buttons **Replace my data** / **Cancel**, default focus on Cancel
  - `RestoreOverlay` while running
  - done: show the message and the links to Settings → Transcription / AI when `keysLeftOut` is non-empty, then `window.location.reload()`
  - `rolled_back`/`failed`: an Alert with the cause + "Nothing was changed."
  - disabled with the reasons from `useRestoreBlockers` and from the server's `restore_blocked`
- [X] T048 [P] [US2] Write `frontend/src/features/settings/backup/SafetyBackupCard.tsx` with the none / exists states from `contracts/ui-contract.md` §3:
  - desktop: shows `path` + **Show in folder** (`bridge.revealPath`)
  - web: **Download safety backup** link to `/api/v1/backup/safety/file`

  Replace the placeholders in `BackupPage.tsx` with `RestoreCard` and `SafetyBackupCard`.
- [X] T049 [US2] Handle the epoch and the lock in `frontend/src/lib/api/client.ts` `apiFetch`:
  - remember the first `X-Data-Epoch` seen; when it changes, show the toast "Your data was restored — reloading" and reload after 1.5 s
  - on `423 restore_in_progress`, publish `jobId` to a small store that a global host renders as `RestoreOverlay`, polling `GET /backup/jobs/{jobId}` until it ends, then reload
  - *Built differently:* `stream.ts` is unchanged. It uses EventSource, which can't read status codes or headers; `apiFetch` and `uploadFile` cover the lock and the epoch. `GET /auth/me` is allowed during a restore, so a tab that reloads can start up.

  Register that global host in `frontend/src/features/settings/routes.tsx` with `registerGlobalHost`. Make the same 423 check in `frontend/src/lib/api/upload.ts` and `frontend/src/lib/api/stream.ts`.
- [X] T050 [P] [US2] Add `revealPath(path: string): Promise<void>` to `DesktopApi` and the no-op wrapper in `frontend/src/features/desktop/bridge.ts`.
  - Expose it in `desktop/src/preload.ts`.
  - Handle it in `desktop/src/main.ts`: resolve the path and require it to be inside `<backend data folder>/backups/safety/`, otherwise refuse; then call `shell.showItemInFolder`.
- [X] T051 [P] [US2] Write `frontend/tests/unit/backup/RestoreCard.test.tsx`:
  - each step renders
  - the blocked state shows each message and disables **Restore…**
  - the dialog's default focus is Cancel
  - the error states show "Nothing was changed."
  - vitest-axe is clean

  Write `frontend/tests/unit/backup/epoch.test.ts` too: an epoch change triggers a reload, and a 423 shows the overlay.
- [X] T052 [US2] Write the end-to-end test `frontend/tests/e2e/backup-restore.spec.ts`:
  1. Seed, create a backup, and capture the download.
  2. Add a note.
  3. Restore the captured file and confirm.
  4. Check that the note is gone, the safety card is shown, and a second page open during the restore reloads with the restored data.
  - *Status:* the spec drives backup → change → restore through the UI and verifies the result through the API. Here, its final check after the page reload fails: the Vite dev server can't serve a reload of any Settings page in this environment (`ERR_INSUFFICIENT_RESOURCES`). That happens with the existing Import and export page too, with this feature's changes reverted.

**Checkpoint**: US1 + US2 together are the complete feature. Run T027–T031, T051 and T052.

---

## Phase 5: User Story 3 - Restore a backup from an older app version (Priority: P2)

**Goal**: Backups from older schema revisions restore and upgrade; backups from newer versions are refused with "update the app first".

**Independent Test**: Restore a fixture backup at a revision older than head, and check that all items open. Restore a backup whose manifest names an unknown revision, and check that it is refused with `backup_too_new` and nothing changes.

### Tests for User Story 3 ⚠️

- [X] T053 [P] [US3] Write `backend/tests/integration/test_restore_upgrade.py`:
  1. Build an "older" backup by monkeypatching `known_revisions()`/head so that `0014` is the backup's revision, and adding a temporary test-only migration `0015_test` (through a test migrations dir copied from `MIGRATIONS_DIR`) that adds a defaulted column to `notes`.
  2. Restore into the upgraded app. Assert that the rows load with the new column defaulted, that `summary.willUpgrade` is true, and that the files are identical.
  3. Assert that a manifest with `schemaRevision="9999"` or `formatVersion=2` fails with `backup_too_new`, includes the backup's `appVersion`, and changes nothing.
- [X] T054 [P] [US3] Add a committed fixture `backend/tests/fixtures/backups/rev0014-minimal.zip` and its generator script `backend/tests/fixtures/backups/make_fixtures.py`. The fixture is one semester, one course, one note and one PDF made at revision `0014`. A test in `backend/tests/integration/test_restore_upgrade.py` restores it against head, which keeps restore of real old backups working as future migrations land.

### Implementation for User Story 3

- [X] T055 [US3] In `backend/src/unihelper/backup/restore.py::build_scratch_db`, run the intermediate `upgrade head` only when `schemaRevision != head` (otherwise skip it). Record `willUpgrade` on the job, and log the from/to revisions (no data).
- [X] T056 [US3] In `frontend/src/features/settings/backup/RestoreCard.tsx`:
  - show "Upgraded from an older version (made with <appVersion>)" when `summary.willUpgrade`
  - map `backup_too_new` to "This backup was made with a newer version (<appVersion>). Update UniHelperProMax first."

**Checkpoint**: All three stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T057 [P] Add a "Backing up and restoring your data" section to `README.md`. It should cover:
  - what a backup includes and that keys are left out
  - where the safety backup is
  - the restore-replaces-everything warning
  - for self-hosted setups behind a proxy, raising the upload size limit (e.g. nginx `client_max_body_size 20g;`), per research R13
- [X] T058 [P] Add logging to `backend/src/unihelper/backup/jobs.py` and `restore.py`: job id, kind, phase transitions, byte counts and error codes through the `unihelper` logger. Add a test in `backend/tests/integration/test_backup_contents.py` that captures logs during a backup + restore and asserts that no key plaintext and no note text appear (FR-024).
- [X] T059 Write the performance check `backend/tests/integration/test_backup_performance.py`, marked `@pytest.mark.slow` and following the pattern of `test_sessions_performance.py`. It generates 1 GB of random audio files, then asserts that the backup takes < 120 s and the restore < 180 s (SC-003), and that peak RSS growth stays < 200 MB (FR-023 flat memory).
- [ ] T060 Run the accessibility pass on `/settings/backup` in light, dark and one custom theme, with keyboard-only navigation: tab order, the dialog's focus return and the overlay's focus trap. Fix any issues in `frontend/src/features/settings/backup/*.tsx`.
- [ ] T061 Run the full gates:
  - backend: `uv run pytest`, `uv run ruff check .`, `uv run mypy src`
  - frontend: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`

  Confirm the existing critical-flow tests still pass: `test_record_save_flow.py`, `test_recording_recovery.py`, `test_transcribe_append_flow.py`, `test_recurring_class_creation.py`.
- [ ] T062 Walk through manual scenarios 1–7 in `specs/016-data-backup-restore/quickstart.md` in the web build and the desktop app (desktop save dialog, Show in folder), and note the results in the PR description.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup and blocks all stories.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational. It reuses `writer.write_backup` from US1 (T017) for the safety backup and to build test fixtures, so implement **T017 before T035**.
- **US3 (Phase 5)**: depends on US2's restore pipeline (T032, T036).
- **Polish (Phase 6)**: after the desired stories.

### Within each story

- Tests first; they must fail before implementation.
- Backend order: modules → runner → router → regenerate the OpenAPI types. Frontend follows.
- `jobs.py` (T012, T018, T039) and `api/v1/backup.py` (T019, T033, T039, T042) are edited by several tasks; do those tasks in sequence.

### Key task dependencies

| Task | Depends on |
|---|---|
| T005 | T004 |
| T013 | T005, T012 |
| T017 | T006, T008, T010, T011 |
| T018 | T012, T017 |
| T019 | T018 |
| T032 | T008, T010, T011 |
| T036, T037, T038 | T032 |
| T039 | T034–T038 |
| T040 | T038 |
| T047 | T044, T045, T046 |
| T049 | T046 |
| T055 | T036 |

## Parallel Opportunities

- **Phase 1**: T002 ∥ T003.
- **Phase 2**: T006, T008, T010 and T011 run together (different new files), with their tests T007, T009 and T014. T004 → T005 → T013 is the sequential chain.
- **US1**: T015 ∥ T016 (tests); T020 ∥ T023 ∥ T026 once the backend endpoints exist.
- **US2**: T027–T031 all in parallel (separate test files except T027 and T030, which extend existing files). Frontend T044, T045, T048 and T050 run in parallel. Backend T034–T038 are one file (`restore.py`), so they run in sequence.
- **US3**: T053 ∥ T054.
- **Polish**: T057 ∥ T058.

### Parallel example: User Story 2 tests

```text
Task: "T027 contract tests for restore/safety endpoints in backend/tests/contract/test_backup_api.py"
Task: "T028 round-trip integration test in backend/tests/integration/test_backup_roundtrip.py"
Task: "T029 atomicity test in backend/tests/integration/test_restore_atomicity.py"
Task: "T030 reader tests in backend/tests/unit/test_backup_archive.py"
Task: "T031 isolation test in backend/tests/integration/test_backup_account_isolation.py"
```

### Parallel example: User Story 2 frontend

```text
Task: "T044 restore API calls in frontend/src/features/settings/backup/api.ts"
Task: "T045 useRestoreBlockers in frontend/src/features/settings/backup/useRestoreBlockers.ts"
Task: "T048 SafetyBackupCard in frontend/src/features/settings/backup/SafetyBackupCard.tsx"
Task: "T050 revealPath bridge in frontend/src/features/desktop/bridge.ts + desktop/src/"
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phases 1 and 2.
2. Phase 3 (US1). Students can already download a complete, browsable backup.
3. **Stop and validate**: T015 and T016, then quickstart scenario 1.

### Incremental delivery

1. MVP (US1) → backup available.
2. US2 → restore with safety backup and crash recovery. This is the complete feature; ship it.
3. US3 → long-term compatibility guard (an older-revision fixture in CI).
4. Polish → README, logs, performance, accessibility.

### Notes

- Every user-visible text comes from `contracts/ui-contract.md`. Every error code comes from `contracts/backup-api.md`.
- Never read or log `secrets.ciphertext`. Only `owner_kind` and `owner_id` are needed (for `keysLeftOut`).
- Commit after each task or logical group. Don't merge with failing tests (Constitution VI).
