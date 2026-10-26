# Research: Full Data Backup and Restore

**Feature**: 016-data-backup-restore | **Date**: 2026-10-26

Findings from reading the current code (backend `unihelper`, frontend `features/settings`,
desktop `src/`), then one decision per open question.

## Facts from the codebase

- **Accounts**: web mode has one owner plus member accounts (`users.role`); every user-owned
  table carries `user_id` with `ON DELETE CASCADE`. Desktop mode has one implicit owner.
- **Files**: everything a user has lives under `<files_root>/<username>/`. The username is the
  top folder, and stored paths (`session_folders.origin_path`, `chat_uploads.rel_path`) are
  relative to that folder. Folder names come from metadata names, so the data can move to
  another account folder without any path rewriting.
- **Staging**: `<files_root>/.uploads/` is the import staging area. Usernames can't start with
  ".", so dot-folders in `files_root` never clash with an account. `api/uploads.py` streams raw
  uploads there in 1 MiB writes and checks the declared size and free space first.
- **Secrets**: keys live in `secrets`, AES-GCM-encrypted under a master key outside the data
  folder. `secret_store_meta` is installation-wide.
- **Database**: SQLite in WAL mode, with schema changes through Alembic (revisions
  `0001`…`0013`, all database-only; no migration touches files). `upgrade_to_head` runs at
  startup. Feature 015 already makes a verified database backup in `<data_dir>/backups/` before
  every migration.
- **Long-running work**: recordings in progress are `recordings.status = 'recording'`.
  Transcription jobs are active in `queued|uploading|transcribing|appending`. Chat answers run
  in the in-process `RunRegistry` (`chat_runs`). Audio not yet uploaded is held on the device
  (`features/recordings/chunkStore.ts`, IndexedDB), and only the frontend knows about it.
- **Downloads and uploads**: the desktop app routes every download through a save dialog
  (015). The frontend's `uploadFile` (XHR) gives upload progress and cancel.

## R1 — What one backup covers

**Decision**: One backup covers **one account**, the signed-in one. Two kinds of data go in:

- every row of the user-owned tables, filtered by `user_id`
- the whole `<files_root>/<username>/` folder

The account row itself is not restored: user name, password hash, role and disabled state stay
as they are. Only `timezone` is restored.

**Rationale**:

- In the web version, several students share one server. A restore must not touch the other
  students' data.
- Keeping the identity means the student stays signed in, and the owner/member structure
  survives.

**Alternatives considered**:

- **Copy the whole SQLite file and `files_root`.** This would back up every account at once,
  and restoring it would overwrite everyone. It also can't skip `secrets`.
- **Owner-only "server backup".** Out of scope; the spec covers the student's own data.

The spec's Assumptions bullet was corrected to say this (account scope, not installation
scope).

## R2 — Archive layout and format

**Decision**: A standard zip (ZIP64) with this layout:

```text
UniHelperProMax-backup-2026-10-26-1430.zip
├── manifest.json          # format/app/schema versions, counts, per-entry size + SHA-256
├── README.txt             # what this file is and how to restore it
├── data/<table>.jsonl     # one JSON object per row, the account's rows of that table
└── files/<year>/…         # the account folder, same relative paths (no username level)
```

- Media that is already compressed (audio, PDF, images) is stored as is (`ZIP_STORED`); text
  and JSON are deflated.
- The data rows are written as JSON Lines, one file per table. Column values are typed as JSON
  (dates and times as ISO strings, binary as base64). Each object also carries
  `_schema: <alembic revision>`, recorded once in the manifest.

**Rationale**:

- **Browsable.** Any archive tool can open the zip, and `files/` mirrors the folder the student
  already knows (FR-003, SC-007).
- **Safe to read.** JSONL is human-readable and can be streamed row by row. It is independent
  of SQLite internals, and it is the only way to carry *one* account's rows.
- **Small memory use.** Storing media without compression keeps a 1 GB backup well within
  SC-003 (CPU time goes to SHA-256 only).

**Alternatives considered**:

- **A per-account SQLite file inside the zip.** Possible, but not readable without tools, and
  it needs the same row filtering anyway.
- **tar.gz.** Not openable by default on Windows, and the user asked for zip.

## R3 — Integrity and "modified" detection (FR-005, SC-005)

**Decision**:

- `manifest.json` lists every entry with its exact byte size and SHA-256.
- On validation, the app checks that:
  - the zip directory has exactly the manifest's entries plus `manifest.json` and `README.txt`
  - every entry streams to its recorded size and hash (zip CRC is checked too)
  - `manifest.json` itself parses and has a supported `formatVersion`
- Any mismatch, missing entry or extra entry → `backup_damaged`.

**Rationale**: This detects truncation, damage and hand edits to content. It isn't
tamper-*proof* (someone who rewrites the manifest too can pass), but the threat is accidental
damage, not an adversary. The spec asks to detect a "damaged, incomplete or modified" file.

**Alternatives considered**:

- **HMAC signing.** Rejected because the key would have to travel with the backup (restoring on
  another machine) or stay on this installation (breaking FR-021), so it adds nothing.

## R4 — Table classification (FR-002, FR-016)

**Decision**: Every table in `Base.metadata` is classified explicitly in one module
(`backup/tables.py`), and a unit test fails if any table is unclassified. That way a future
table can't be silently left out of backups.

**Included**, all rows where `user_id` = the account:

| Group | Tables |
|---|---|
| Structure | `years`, `semesters`, `courses` |
| Classes and events | `class_series`, `class_links`, `session_exceptions`, `event_series`, `event_links`, `session_folders` |
| Notes, recordings, transcriptions | `notes`, `recordings`, `transcription_jobs` |
| Documents | `documents`, `document_positions`, `annotation_ops` |
| Chats | `chats`, `chat_drafts`, `chat_uploads` |
| Tasks | `tasks`, `task_checklist_items`, `task_quick_notes`, `task_columns` |
| Trash | `trash_entries` |
| Settings and preferences | `themes`, `ui_preferences`, `workspace_states`, `transcription_settings`, `provider_configs`, `ai_settings`, `ai_endpoints`, `ai_models` |
| Calendar imports | `calendar_import_sources`, `calendar_import_runs` |

Rows are left out in two cases:

- `recordings` with `status = 'recording'`
- `transcription_jobs` in an active status

**Excluded**:

| Table | Reason |
|---|---|
| `users` | identity; only `timezone` goes into the manifest |
| `auth_sessions` | login sessions |
| `secrets` | FR-016 |
| `secret_store_meta` | installation-wide |
| `chat_runs` | transient run state; the chat JSON files are the source of truth |
| `calendar_import_uploads` | short-lived previews |

At backup time the manifest records which providers and AI endpoints **had** a key
(`keysLeftOut`). The restore summary uses this list to name the keys to re-enter.

**Rationale**: An explicit allow/deny list with a coverage test is the only reliable way to get
"everything" without ever exporting a secret.

## R5 — Consistent snapshot while the student keeps working (FR-007, FR-008)

**Decision**:

1. Read all rows inside **one read transaction** on a dedicated connection. WAL gives a
   consistent snapshot, and writers are not blocked.
2. Then stream the account folder, skipping three kinds of file:
   - temp files of atomic writes (`.*.tmp-*`)
   - `*.part` files
   - the audio files of recordings left out under R4
3. Each file is read whole, in one pass. Notes are written by temp-file + rename, so a reader
   sees either the old or the new file, never a torn one.
4. A note edited after the snapshot may be newer than its row's `content_hash`. That is allowed,
   because restore re-indexes notes from the files (R7, step 6).

**Rationale**: Nothing locks the student out, and nothing half-written gets in.

**Alternatives considered**:

- **Pausing all writes during backup.** Rejected by FR-008.

## R6 — Backup flow, progress and delivery (FR-006, FR-009)

**Decision**: A two-step job.

1. `POST /backup/exports` starts an in-process background job. It first checks free space
   (estimated size + 64 MiB margin), then writes
   `<data_dir>/backups/exports/<user>/<job>.zip.part`. It renames the file to `.zip` on success
   and deletes it on failure or cancel.
2. The client polls `GET /backup/jobs/{id}` every ~500 ms to read the phase, bytes done and
   bytes total.
3. When the job is done, the client navigates a hidden link to
   `GET /backup/exports/{id}/file`. That response has `Content-Disposition: attachment`, the
   file name and `Content-Length`.
   - **Browser**: streams the download straight to disk (no blob in memory). The file stays an
     hour, so "Download again" works.
   - **Desktop**: shows its save dialog (015).
4. Finished export files are deleted in four cases:
   - after a successful full transfer
   - when the student starts a new backup
   - 1 hour after they finish
   - at startup (sweep)

**Rationale**:

- Building first gives real progress and a known `Content-Length`.
- Cancelling builds no partial file, and a failed build never reaches the student's disk.
- It works the same in the browser and the desktop app.

**Alternatives considered**:

- **Streaming the zip while it is built.** No total size, no clean cancel, and a failure
  mid-stream leaves a corrupt download the browser calls "complete".
- **Building in the browser.** Would need every file sent to the frontend, and big files in
  memory.

## R7 — Restore pipeline (FR-010…FR-015, FR-018)

**Decision**: Restore runs in three steps: upload, validate, confirm.

**Upload.** `POST /backup/restores` (raw body, max 20 GB, streamed to staging with the existing
`receive_upload`).

**Validate.** Runs as a background job (R3 checks and safe-path checks) and also checks two more
things:

- the schema revision is known to this app (R8)
- no row id in the backup is already used by a *different* account (`backup_ids_in_use`)

The second check matters because restoring IDs as they are keeps every cross-reference valid,
and a collision is only possible when one server's account restores another account's backup.
The result is a **summary**: the manifest dates and versions, the counts, `keysLeftOut`, and
the current safety backup. It is stored with the job.

**Confirm.** `POST /backup/restores/{id}/confirm` runs these steps:

1. **Gate** (FR-017): refuse with 409 `restore_blocked` and the reasons when any of these hold:
   - a recording of this account has `status = 'recording'`
   - an active transcription job exists
   - a chat answer is running in `RunRegistry`
   - another backup/restore job of the account is running

   The frontend additionally refuses while device-held audio, pending uploads or unsaved note
   drafts exist (the same signals as the desktop close guard). While a restore runs, the page
   asks before closing through `beforeunload` (the desktop app shows its native "Leave?" box).
   It does not report a desktop guard state: no renderer code answers the close request yet, so
   reporting one would make every close wait 3 s for a "not responding" box.
2. **Lock the account**: mark it `restoring` in the in-process `AccountLocks`. Every other
   `/api/v1` request from that account then returns 423 `restore_in_progress`, except
   `GET /backup/jobs/{id}`. The transcription worker and chat runs check the same lock before
   starting new work for that account.
3. **Safety backup** (FR-014): build a full backup of the current data, exactly as R6 does,
   into `<data_dir>/backups/safety/<user>/safety-<timestamp>.zip`. Only after it is complete,
   delete the previous safety file.
4. **Upgrade the backup's data in a scratch database.** Create
   `<data_dir>/backups/restore-<job>.sqlite3` at the backup's schema revision (Alembic
   `upgrade <rev>`). Insert a stub `users` row with the current account's id, load the JSONL
   rows (`user_id` remapped to the current account), then run `upgrade head` on it. Migrations
   are DB-only (verified), so this reuses them as they are (FR-019).
5. **Extract the files** to `<files_root>/.restore-<job>/`, on the same volume so the swap below
   is a rename. Safe-path rules apply (R9).
6. ~~Re-index notes~~: not needed (found during implementation). The notes service already
   treats a note file whose hash differs from its row as edited outside the app and takes the
   file as the truth (002 N5), on read and on save.
7. **Write the journal** `<data_dir>/backups/restore-<user>.journal.json` with
   `phase = swapping`.
8. **Swap**, in this order:
   1. rename `<files_root>/<username>` → `<files_root>/.restore-<job>-old`
   2. rename `.restore-<job>` → `<username>`
   3. in **one** `BEGIN IMMEDIATE` transaction on the main DB:
      - delete the account's rows in all included tables, plus its `secrets` (FR-016: no old
        keys survive)
      - insert the upgraded rows from the scratch DB, in FK order
      - set `users.timezone`, bump `users.data_epoch`
      - check `PRAGMA foreign_key_check`
      - commit
4. **Commit point** = the DB commit. Before it, any failure renames the folders back and rolls
   back (FR-015). After it, the journal moves to `phase = cleanup`, the old folder and scratch
   files are deleted, and the lock is released.
5. **Startup recovery**: a journal still in `swapping` means the app died mid-swap. Startup
   compares `users.data_epoch` with the journal's `epochBefore`. If it's unchanged, it renames
   the folders back; otherwise it finishes the cleanup. Either way the data is all-old or
   all-new (SC-004).

**Rationale**:

- The single DB transaction plus two renames gives the all-or-nothing behaviour.
- The scratch-DB upgrade reuses tested migrations instead of writing a second upgrade path.

**Alternatives considered**:

- **Remapping every ID on restore.** Much more code: ids are embedded in `lineage_id`, session
  keys, `secrets.owner_id`, chat JSON and workspace JSON. It is needed only in the rare
  cross-account case, which is refused instead.
- **Restoring in place file by file.** Not atomic.

## R8 — Version compatibility (FR-019)

**Decision**: The manifest carries three version fields:

- `formatVersion` (starts at `1`)
- `schemaRevision` (the Alembic head at backup time)
- `appVersion`

Validation refuses with `backup_too_new` if either of these holds:

- `formatVersion` is greater than this app supports
- `schemaRevision` is not in this app's Alembic history

Older revisions upgrade through R7 step 4. Each future migration that adds or renames a column
needs no backup-specific code. A migration that adds a **new table** must also classify it in
`backup/tables.py`, and the coverage test enforces this.

## R9 — Unsafe archives (FR-020)

**Decision**: The app rejects (`backup_unsafe`) any entry that is:

- an absolute path, a drive letter or a UNC path
- a path containing `..`, a backslash, or a NUL byte
- outside `manifest.json`, `README.txt`, `data/*.jsonl` and `files/**`
- a symlink (by its Unix mode bits)
- a duplicate name, including names that differ only in case, which collide on Windows and macOS

Extraction resolves each target path and asserts it stays under the staging folder. The app
also rejects names that are invalid on the current OS (reserved Windows names, trailing dot or
space). These are reported with their paths (`backup_names_invalid`) rather than silently
dropped (spec edge case).

Compression-bomb guard: the sum of the manifest sizes must fit the free-space check, and every
entry must stream to exactly its manifest size. A larger entry is cut off and refused.

## R10 — Free space (FR-022)

**Decision**: Each phase checks free space before it starts (`shutil.disk_usage`, 64 MiB margin,
same as `api/uploads.py`):

| Phase | Space needed |
|---|---|
| Upload | `Content-Length` |
| Confirm, on `<data_dir>` | current account size (the safety backup) |
| Confirm, on `<files_root>` | backup's unpacked size |

If space runs short, the phase fails with 507 `insufficient_storage` and names how much is
needed.

## R11 — Other tabs and windows see the restored data (FR-018)

**Decision**: A new column `users.data_epoch INTEGER NOT NULL DEFAULT 0` (migration `0014`),
bumped by every restore.

- Every authenticated `/api/v1` response carries `X-Data-Epoch`.
- The API client remembers the first value it sees. On a change it shows a "Your data was
  restored — reloading" notice and reloads the page.
- While a restore runs, other tabs get 423 `restore_in_progress` and show a blocking
  "Restoring your data…" overlay until the epoch changes.

**Rationale**: This works across tabs, browsers and devices, and survives a server restart.
`BroadcastChannel` would only reach tabs in the same browser.

## R12 — Jobs, concurrency and limits

**Decision**: An in-process `BackupJobs` registry, like `RunRegistry`. Jobs run in worker
threads (`anyio.to_thread`).

- **Per account**: at most one backup or restore job at a time.
- **Server-wide**: at most one restore at a time, and at most 2 concurrent export jobs (disk I/O).
- **Job state** lives in memory. A server restart drops running exports (their `.part` files are
  swept at startup) and recovers restores through the journal (R7.5). Uploaded restore files
  waiting for confirmation expire after 1 hour.
- **Logging**: phase transitions, sizes and error codes are logged without file contents or
  keys (FR-024).

**Rationale**: No new infrastructure (Principle VII), and the pattern already exists in the
codebase.

## R13 — Upload size and reverse proxies (web)

**Decision**: The restore upload limit is **20 GB** (FR-023). For self-hosted setups behind a
proxy (nginx `client_max_body_size`, etc.), the README gets a note. The 413 error names the
limit. No chunked/resumable upload: XHR streams a `File` from disk, so memory use stays flat,
and the desktop app talks to loopback directly.

## R14 — Where the safety backup is shown (FR-014)

**Decision**:

- **Desktop**: the section shows the safety file's full path, with "Show in folder" through a
  new bridge call, `revealPath`.
- **Web**: the server path means nothing to the student, so the section offers "Download safety
  backup" (`GET /backup/safety/file`) and shows its date and size.

Either way the safety backup restores through the normal "Restore from backup" flow (spec
Assumption).
