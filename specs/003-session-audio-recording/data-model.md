# Data Model: Session Audio Recording & Playback (003)

Alembic revision `0005_recordings`. 001/002 conventions apply.

## recordings

| Column | Type | Rules |
|---|---|---|
| id | text PK | UUIDv7 |
| user_id | text FK→users ON DELETE CASCADE | |
| session_folder_id | text FK→session_folders ON DELETE CASCADE | folder created on first recording (002 lazy folders) |
| name | text | 1–120 chars; default "Recording HH:MM" |
| name_key | text | UNIQUE (session_folder_id, name_key) |
| file_name | text | `safe_name(name)` + `.webm`/`.m4a`; UNIQUE (session_folder_id, file_key) |
| file_key | text | casefold(file_name) |
| mime_type | text | `audio/webm` or `audio/mp4` |
| status | text | `recording` \| `complete` \| `interrupted` |
| started_at | text | UTC ISO; also the "recording date and start time" shown |
| duration_ms | int | 0 while recording; set on finalize |
| size | int | bytes on disk |
| next_seq | int | next expected chunk number (0-based) |
| last_chunk_at | text null | UTC ISO of the last stored chunk |
| version, created_at, updated_at | | `version` bumps on rename/finalize |

## State transitions

```text
          start                chunks (seq = next_seq)
  (none) ───────▶ recording ─────────────────────────┐
                    │  │ stop                        │
                    │  └──────────▶ complete ◀───────┘ (stop after interruption-with-resume)
                    │ no chunk for 30 s, read by any client
                    ▼
               interrupted ──chunks/stop(interrupted)──▶ interrupted (re-finalized)
                    └──stop(interrupted: false) from the live recorder──▶ complete
```

- "Active" recording of a user = status `recording` with `last_chunk_at` (or `started_at`)
  within the last 30 s. At most one active per user (FR-003).
- Finalize (on stop or stale read): compute duration and, for WebM, write Duration + Cues
  (research A4); update `size`, `duration_ms`, `version`.
- Derived flags in responses: `missing` (file not on disk), `active` (as above).

## ui_preferences (002) — added keys

| Key | Type | Default |
|---|---|---|
| `playerVolume` | number 0–1 | 1 |
| `playerMuted` | boolean | false |

## Client-side (IndexedDB `uh-recordings`)

| Store | Key | Value |
|---|---|---|
| `chunks` | `[recordingId, seq]` | `{ recordingId, seq, blob }` |
| `recordings` | `recordingId` | `{ recordingId, sessionKey, courseId, label, startedAt, stopped: boolean, interrupted: boolean, durationMs? }` — lets recovery finish uploads and send the final stop after a crash; `label` is the course · date shown in the recording bar, `durationMs` the client-measured length sent on stop |
