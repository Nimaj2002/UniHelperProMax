# Data Model: Full Data Backup and Restore

**Feature**: 016-data-backup-restore | **Date**: 2026-10-26

This feature adds one database column. Every other entity below lives in the backup file, in
memory (jobs) or in small JSON files under `<data_dir>/backups/`.

## Database change (migration `0014_data_epoch`)

### `users` (existing table)

| Column | Type | Rules |
|---|---|---|
| `data_epoch` | INTEGER NOT NULL DEFAULT 0 | Bumped by 1 in the restore's commit transaction. Sent as the `X-Data-Epoch: <userId>.<epoch>` header on every authenticated response (research R11). |

Nothing else changes. The migration is DB-only, like `0001`–`0013`.

## Backup file (zip)

```text
manifest.json
README.txt
data/<table>.jsonl        one per included table (research R4), may be empty
files/<relative path>     every file under <files_root>/<username>/, minus R5 exclusions
```

### Backup manifest (`manifest.json`)

| Field | Type | Rules |
|---|---|---|
| `kind` | `"unihelper-backup"` | Must match exactly, or the file is `not_a_backup`. |
| `formatVersion` | integer | `1` for this feature. Greater than supported → `backup_too_new`. |
| `appVersion` | string | Shown in the summary. |
| `schemaRevision` | string | Alembic revision at backup time. Not in this app's history → `backup_too_new`. |
| `createdAt` | ISO-8601 UTC | Shown in the summary; also in the file name, in local time. |
| `source` | `"web"` \| `"desktop"` | Informational (FR-021). |
| `account` | `{ "timezone": string }` | The only account field that gets restored. User name, password and role are never stored. |
| `counts` | object | `semesters`, `courses`, `sessions` (session folders), `events`, `notes`, `recordings`, `documents`, `chats`, `tasks`, `themes`, `files`, `bytes` (sum of file sizes). |
| `keysLeftOut` | array of `{ "kind": "transcription_provider" \| "ai_endpoint", "id": string, "name": string }` | Providers and endpoints that had a key at backup time (FR-016). |
| `excluded` | array of `{ "reason": "recording_in_progress", "name": string }` | What was deliberately left out (FR-008). |
| `entries` | array of `{ "path": string, "size": integer, "sha256": string }` | Every zip entry except `manifest.json` and `README.txt`, sorted by path (research R3). |

**Validation rules** (each failure maps to one error code, see contracts):

- Kind, format and schema are known.
- The zip contains exactly `entries ∪ {manifest.json, README.txt}`.
- Every path is safe (research R9).
- Every entry streams to its manifest size and SHA-256.
- Every JSONL line parses, and it names only columns that exist at `schemaRevision`.
- No id is used by another account.

### Data rows (`data/<table>.jsonl`)

There is one JSON object per row, keyed by column name. Value types:

| Column type | Encoded as |
|---|---|
| TEXT / INTEGER / REAL | JSON values |
| BOOLEAN | `true` / `false` |
| DATE / TIME | ISO strings |
| BLOB | `{"$b64": "..."}` |

`user_id` is written as is and replaced with the current account's id on restore.

## Runtime entities (not in the database)

### Backup job (in memory, `BackupJobs` registry)

| Field | Notes |
|---|---|
| `id` | uuid7 |
| `userId` | owner of the job; other accounts get 404 |
| `kind` | `export` \| `restore` |
| `phase` | see the state machines below |
| `bytesDone`, `bytesTotal` | progress for the current phase |
| `error` | `{ code, title, detail }` when `phase = failed` |
| `summary` | restore only, after validation (see contracts `RestoreSummary`) |
| `fileName`, `size` | export only, when `ready` |
| `expiresAt` | an export file or validated upload is deleted after this time |

**Export states**:

```text
preparing → writing → ready → (downloaded | expired) → gone
        ↘ cancelled / failed   (the .part file is deleted)
```

**Restore states**:

```text
uploading* → validating → awaiting_confirmation → safety_backup → staging → swapping
           → cleanup → done
validating ↘ failed (rejected: nothing changed)
safety_backup | staging | swapping ↘ rolled_back (data exactly as before) → failed
awaiting_confirmation ↘ cancelled | expired (upload deleted)
```

\* `uploading` is client-side: the job is created when the upload completes.

Only `awaiting_confirmation` can be cancelled. Once the student confirms, the job runs to `done`
or `rolled_back`.

### Account lock (in memory, `AccountLocks`)

`userId → "restoring"` from confirmation until the job reaches `done` or `rolled_back`.

- While it is set, every `/api/v1` request from that account except `GET /backup/jobs/{id}`
  and `GET /auth/me` gets 423. The lock is released before the job reports its final phase, so
  a client that reloads on "done" never meets it.
- The transcription worker and chat runs skip that account.

### Restore journal (`<data_dir>/backups/restore-<userId>.journal.json`)

| Field | Notes |
|---|---|
| `jobId` | |
| `username` | the account folder name at the time |
| `phase` | `swapping` \| `cleanup` |
| `epochBefore` | `users.data_epoch` before the commit; at startup, an unchanged value means "not committed" |
| `stagingDir`, `oldDir` | names of the `.restore-<job>` and `.restore-<job>-old` folders under `files_root` |
| `scratchDb` | path of the scratch database |

It is written with temp-file + fsync + rename and removed after cleanup. Startup recovery
(research R7.5) runs right after `upgrade_to_head`, before any request is served.

### Safety backup (`<data_dir>/backups/safety/<userId>/safety-<timestamp>.zip`)

- Same format as any backup, keyed by user id so a later rename of the account doesn't orphan it.
- At most one exists per account. A new one is completed before the old one is deleted
  (FR-014).
- Exposed through `GET /backup/safety` (metadata) and `GET /backup/safety/file` (download).

### On-disk working areas

| Path | Purpose | Cleaned |
|---|---|---|
| `<data_dir>/backups/exports/<userId>/` | finished/partial export zips | 1 h after it's ready, new export, startup |
| `<files_root>/.uploads/<token>.part` | restore upload staging (existing area) | after validation fails, expiry, or after restore |
| `<data_dir>/backups/restore-<job>.sqlite3` | scratch DB for upgrade | after the restore finishes either way; startup |
| `<files_root>/.restore-<job>/`, `.restore-<job>-old/` | file swap | after the restore finishes either way; startup via journal |

## Relationships to existing data

- All restored rows keep their ids. `user_id` is remapped to the current account. The FK graph
  among included tables is complete: no included table references an excluded one, except
  `users`, which is always the current account.
- `secrets` rows of the account are deleted at restore. `provider_configs` and `ai_endpoints`
  therefore report "not configured" until a key is entered (FR-016).
- `chat_runs` are not restored. Chats whose last run was interrupted already show as
  interrupted from their JSON files (014 behaviour).
