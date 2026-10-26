# Contract: Backup & Restore API (`/api/v1/backup/*`)

These endpoints follow the existing API conventions:

- authenticated through the current account (desktop: the implicit owner)
- CSRF header on unsafe methods
- errors as RFC 9457 problem+json `{ status, code, title, detail?, ... }`

Every endpoint acts on the **signed-in account only**. A job id that belongs to another account
returns 404.

All authenticated `/api/v1` responses (not only these) gain the header
`X-Data-Epoch: <userId>.<epoch>` (research R11). The user id lets a client tell a restore (same
account, new epoch) from another account signing in.

While the account is being restored, every `/api/v1` request from it gets
`423 restore_in_progress` with `{ jobId }`. The exceptions are `GET /backup/jobs/{id}` and
`GET /auth/me` (so a tab reloaded meanwhile can start and show the restoring overlay).

---

## Shared shapes

```jsonc
// BackupJob
{
  "id": "0193…",
  "kind": "export" | "restore",
  "phase": "preparing" | "writing" | "ready" | "validating" | "awaiting_confirmation"
         | "safety_backup" | "staging" | "swapping" | "cleanup" | "done"
         | "rolled_back" | "failed" | "cancelled" | "expired",
  "bytesDone": 123456,
  "bytesTotal": 9876543,          // null while unknown
  "fileName": "UniHelperProMax-backup-2026-10-26-1430.zip",   // export, when ready
  "size": 9876543,                 // export, when ready
  "summary": RestoreSummary,       // restore, from awaiting_confirmation on
  "error": { "code": "...", "title": "...", "detail": "..." },  // failed / rolled_back
  "expiresAt": "2026-10-26T15:30:00Z"
}

// RestoreSummary
{
  "createdAt": "2026-09-01T10:12:00Z",
  "appVersion": "1.0.1",
  "source": "desktop",
  "willUpgrade": true,             // schemaRevision older than this app's head
  "counts": { "semesters": 2, "courses": 9, "sessions": 210, "events": 14, "notes": 388,
              "recordings": 97, "documents": 61, "chats": 23, "tasks": 40, "themes": 3,
              "files": 1205, "bytes": 4823011234 },
  "keysLeftOut": [ { "kind": "ai_endpoint", "id": "…", "name": "My Claude" } ],
  "excluded": [ { "reason": "recording_in_progress", "name": "Lecture 12" } ],
  "current": { "counts": { …same keys… } },          // what will be replaced
  "filesNotInBackup": 4,           // current files that a restore removes (FR-013)
  "safetyBackup": { "replaces": { "createdAt": "…", "size": 123 } | null }
}

// SafetyBackup
{ "createdAt": "…", "size": 123, "path": "/abs/path/safety-….zip" | null }  // path: desktop only
```

---

## Backup (export)

### `POST /backup/exports` → 202 `BackupJob`

Starts a backup of the account. It cancels and deletes any finished, undownloaded export of the
account first.

| Error | When |
|---|---|
| 409 `backup_busy` | another backup/restore job of this account is running (`{ jobId }`) |
| 503 `backup_capacity` | 2 exports are already running on the server (retry later) |
| 507 `insufficient_storage` | not enough free space (`{ neededBytes, freeBytes }`) |

### `GET /backup/jobs/{id}` → 200 `BackupJob`

Used for polling. It is allowed while the account is locked. 404 if unknown or not this
account's job.

### `DELETE /backup/jobs/{id}` → 204

Effect by job state:

| Job state | Effect |
|---|---|
| Running export | cancelled; the partial file is deleted |
| Finished export | file deleted |
| Restore in `awaiting_confirmation` or `validating` | cancelled; the upload is deleted |

Error: 409 `restore_running` once a restore is confirmed (it can't be stopped mid-swap; it
completes or rolls back).

### `GET /backup/exports/{id}/file` → 200 `application/zip`

Headers: `Content-Disposition: attachment; filename="<fileName>"`, `Content-Length`. The file
stays available for an hour so "Download again" works; it is deleted then, when the account starts
another backup, or at the next server start.

Error: 404 if not `ready` or expired.

---

## Restore

### `POST /backup/restores` → 202 `BackupJob` (phase `validating`)

- **Body**: the raw zip, `Content-Type: application/octet-stream`. `Content-Length` is required.
- **Max**: 20 GB.
- The body is streamed to staging and validated in the background. Validation ends in
  `awaiting_confirmation`, with a `summary`, or in `failed`.

| Error | When |
|---|---|
| 411 `length_required` | no `Content-Length` |
| 413 `file_too_large` | `{ maxBytes }` |
| 409 `backup_busy` | another job of this account is running |
| 507 `insufficient_storage` | not enough space for the upload |

Validation failures end the job in `failed` with these error codes. Nothing is changed:

| `error.code` | Meaning |
|---|---|
| `not_a_backup` | not a zip, or has no valid `manifest.json` of kind `unihelper-backup` |
| `backup_damaged` | entry missing/extra, size or SHA-256 mismatch, bad CRC, unreadable JSONL |
| `backup_unsafe` | unsafe path, link, duplicate or case-colliding name (`{ paths: [...] }`, max 20) |
| `backup_names_invalid` | names invalid on this OS (`{ paths: [...] }`, max 20) |
| `backup_too_new` | `formatVersion` or `schemaRevision` newer than this app (`{ appVersion }` of the backup) |
| `backup_ids_in_use` | rows belong to another account on this server |

### `POST /backup/restores/{id}/confirm` → 202 `BackupJob` (phase `safety_backup`)

- **Body**: `{ "confirm": true }`.
- Locks the account, then runs safety backup → staging → swapping → cleanup. The job ends in
  `done`, or in `rolled_back` with `error` (data unchanged, FR-015).

| Error | When |
|---|---|
| 404 | unknown job, or the job is not this account's |
| 409 `not_awaiting_confirmation` | job is in any other phase |
| 409 `restore_blocked` | `{ reasons: ["recording_in_progress" \| "transcription_running" \| "chat_answer_running" \| "job_running"], items: [{ reason, name }] }` (FR-017) |
| 503 `restore_capacity` | another account's restore is running on the server |
| 507 `insufficient_storage` | `{ neededBytes, freeBytes, where: "backups" \| "files" }` |

Failures *after* the account is locked (disk full while staging, rename refused, FK check
failed) don't come back as HTTP errors. The job ends `rolled_back` with one of these codes:

- `insufficient_storage`
- `files_in_use`: a file is held open by another program, with `{ path }`
- `restore_failed`

---

## Safety backup

### `GET /backup/safety` → 200 `SafetyBackup` | 204 (none)

### `GET /backup/safety/file` → 200 `application/zip`

The download is named `UniHelperProMax-safety-backup-<date>.zip`. Error: 404 if there is no
safety backup.

---

## Logging and secrets (FR-024)

- The server logs job id, kind, phase changes, byte counts and error codes.
- It never logs file contents, note text or key material.
- Backup files never contain `secrets` rows or any key field (SC-006).

## Tests required (Constitution VI)

**Contract tests**: every endpoint above, its success case and each listed error code,
including:

- 423 for other endpoints during a restore
- a 404 for another account's job

**Integration tests** (real API, real SQLite, temp dirs). A backup → restore round trip:

- into an empty account, checking byte-for-byte identical files and equal rows apart from
  `user_id`
- into a populated account, checking that hand-added files are removed and kept in the safety
  backup
- from a fixture backup at an older schema revision
- with a restore killed at each phase, then recovered at startup to all-old or all-new
- for account isolation, checking that a member's restore leaves the owner's rows and folder
  untouched
- checking that no key appears anywhere in the backup bytes
