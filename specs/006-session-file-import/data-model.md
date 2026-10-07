# Data Model: Import Audio and Notes into a Session (006)

Changes only; everything else as in 002/003/004. Migration `0008_recording_origin`.

## `recordings` (changed)

| Column | Change | Notes |
|---|---|---|
| `origin` | **new** `String(16)`, NOT NULL, default `'recorded'` | CHECK `origin IN ('recorded', 'imported')`; existing rows become `recorded` |
| `original_file_name` | **new** `String(255)`, nullable | The file name as uploaded; NULL for recordings |
| `mime_type` | CHECK widened | `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/flac`, `audio/aac` |
| `status` | unchanged | imports are inserted as `complete` |
| `started_at` | meaning extended | recordings: start of capture; imports: time the import completed |
| `next_seq`, `last_chunk_at` | unchanged | imports: `0` / NULL; chunk upload to an import returns 409 `recording_finished` (existing rule) |

**Validation (imports)**

- Extension (case-insensitive) ∈ {`.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg`, `.oga`, `.opus`,
  `.webm`, `.flac`} → `mime_type` per research I3.
- `size` ≤ 1 073 741 824 bytes (1 GB); `Content-Length` must equal bytes received.
- `audio_probe.probe` must recognise the bytes as the expected format.
- `name`: `normalize_display(stem)`, 1–120 chars, empty → "Imported audio"; unique by `name_key`
  in the session folder, else " (n)" suffix (never renames the existing row).
- `file_name`: `unique_sibling(safe_name(name) + ext)` against DB rows **and** existing files on
  disk; keeps the uploaded extension (lower-cased).

**Rules affected**

- Rename: new file name keeps the row's own extension (replaces the fixed `EXT[mime_type]` map).
- Delete: `delete_content_file` allows all the extensions above in `audios/`.
- `duration_ms`: from the server probe, else the client's `durationMs`, else 0.
- Imported rows are never `active`; `is_active` already requires `status = 'recording'`.

**State (imports)**: no lifecycle — a row exists only once the file is fully stored and verified
(`complete`). Upload states live only on the client (below).

## Migration 0008 (research I2)

1. `db/migrate.py`: open the connection, `PRAGMA foreign_keys=OFF` (outside a transaction), begin,
   run Alembic, `PRAGMA foreign_key_check` → abort on any row, commit, `PRAGMA foreign_keys=ON`.
2. `0008`: `batch_alter_table("recordings", recreate="always")` adding `origin` (server default
   `'recorded'`), `original_file_name`, the `origin` CHECK, and the widened `mime` CHECK.
   Downgrade: refuse if any row has `origin = 'imported'` or a new mime type (would violate the
   old CHECK); otherwise rebuild back.

## `notes` (unchanged schema)

- Imported notes are ordinary `Note` rows created by `create_note`; origin is not stored (spec:
  "need not be shown").
- New server validation on create: content containing `U+0000` → 422 `content_not_text`.
- New operation **import-replace** (research I11): replaces the file content, bumps `version`,
  updates `content_hash`, `size`, `updated_at`; name and file name unchanged.

## Staging files (file system only)

- `files/.uploads/<token>.part` — a single in-flight upload. Created by the import request,
  deleted by it on any failure, or moved into `…/<class-date>/audios/<file_name>` on success.
  Swept on startup when older than 1 hour. Never referenced by the DB.

## Client-side entities (not persisted)

### Upload (importQueue entry)

| Field | Notes |
|---|---|
| `id` | client UUID |
| `sessionKey`, `courseId`, `sessionLabel` | where it goes; label shown if the user navigates away |
| `file` | the `File` |
| `durationMs` | from the browser probe, optional |
| `state` | `checking` → `queued` → `uploading` → `verifying` → `done` · or `cancelled` / `failed` / `rejected` |
| `loaded`, `total` | progress bytes |
| `error` | `{ code, message }` for `failed` / `rejected` |
| `recordingId` | set on `done` |

Transitions: `checking` (extension, size, browser probe) → `rejected` (unsupported/oversized; no
request sent) or `queued`; `queued` → `uploading` when fewer than 2 are uploading; `uploading` →
`verifying` when the body is fully sent; `verifying` → `done` (201) or `failed` (4xx/5xx/network);
`queued | uploading` → `cancelled` on Cancel; `failed` → `queued` on Retry. `done`/`cancelled`
entries disappear; `failed`/`rejected` stay until dismissed.

### Note import run

| Field | Notes |
|---|---|
| `files` | picked files in order, each `{ file, name, result? }` |
| `applyToAll` | `null` or `rename | replace | skip` chosen with "Apply to all" |
| `result` per file | `imported` · `renamed(newName)` · `replaced` · `skipped` · `rejected(reason)` |

Per file: read & validate → create → on 409 `name_taken` → conflict prompt (or `applyToAll`) →
rename (create with new name; 409 again → prompt again) · replace (guard unsaved edits → confirm
→ import-replace; 409/412 → `rejected` with the reason, note untouched) · skip.
