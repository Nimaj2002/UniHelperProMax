# Data Model: Transcribe Recordings into Notes (004)

Alembic revision `0006_transcription`. 001–003 conventions apply (UUIDv7 text ids, UTC ISO
timestamps, `version` for optimistic concurrency, `ON DELETE CASCADE` from users).

## transcription_settings (written by 005, read by 004)

| Column | Type | Rules |
|---|---|---|
| user_id | text PK FK→users ON DELETE CASCADE | one row per user, created lazily |
| active_provider_id | text null | a registered provider id (`voice-studio`, `openai-compatible`); null = not configured |
| default_language | text | `auto` (default) or ISO 639-1 code |
| updated_at | text | |

## provider_configs (written by 005, read by 004)

| Column | Type | Rules |
|---|---|---|
| user_id | text FK→users ON DELETE CASCADE | PK (user_id, provider_id) |
| provider_id | text | registered provider id |
| values_json | text | JSON object of the provider's non-secret fields (e.g. `{"address": "…", "model": "…"}`) |
| secret | text null | API key; **never** serialized to any response or log |
| updated_at | text | |

A provider is **configured** for a user when `active_provider_id` is set and every required
field of its `ProviderSpec` has a value (`secret` counts for `kind: secret`).

## transcription_jobs

| Column | Type | Rules |
|---|---|---|
| id | text PK | UUIDv7 |
| user_id | text FK→users ON DELETE CASCADE | |
| recording_id | text FK→recordings ON DELETE CASCADE | recordings with an active job can't be deleted (409) |
| note_id | text null FK→notes ON DELETE SET NULL | target; null after the note was deleted (fallback at completion) |
| note_name | text | name at job start (for messages when the note is gone) |
| language | text | `auto` or ISO 639-1 |
| provider_id | text | snapshot at start/retry |
| provider_values_json | text | snapshot of non-secret values at start/retry (the key is read live) |
| status | text | `queued` \| `uploading` \| `transcribing` \| `appending` \| `completed` \| `failed` \| `cancelled` |
| part_index | int | 0-based current part |
| part_count | int | ≥ 1 once split |
| part_texts_json | text | JSON list of finished part transcripts (kept for retry/restart) |
| source_size | int | recording size when parts were made (parts are reused only if unchanged) |
| progress | real null | 0–1 when known |
| stage_started_at | text null | when the current stage began |
| error_category | text null | `not_configured` \| `invalid_credentials` \| `unavailable` \| `file_rejected` \| `quota_exceeded` \| `unknown` |
| error_message | text null | plain-language, key-free |
| settings_related | bool | error caused by provider settings (UI links to Settings) |
| cancel_requested | bool | set by Cancel; honoured before `appending` |
| appended_text | text null | exact section written (B8 exactly-once check); returned to the client |
| previous_hash | text null | note hash just before the append |
| result_hash | text null | note hash after the append |
| result_version | int null | note version after the append |
| fallback_note_created | bool | FR-011 |
| attempts | int | 1 + number of retries |
| seen | bool | completion/failure acknowledged by the user (FR-015) |
| created_at, started_at, finished_at, updated_at | text | |

**Indexes**: partial UNIQUE `(user_id) WHERE status IN ('queued','uploading','transcribing','appending')`
(one active job per user, FR-012); `(status, created_at)` for the worker; `(recording_id)`.

## State transitions

```text
 POST /recordings/{id}/transcriptions
            │
            ▼                     worker picks job
         queued ───────────────────▶ uploading ──▶ transcribing ──(next part)──┐
            ▲                          │   ▲            │                      │
            │                          │   └────────────┘◀─────────────────────┘
   retry (failed/cancelled)            │ all parts done
            │                          ▼
   failed ◀──── provider error ─── (any running stage)      appending ──▶ completed
   cancelled ◀── cancel_requested (checked between steps, before appending)
```

- **Restart**: `uploading`/`transcribing` → `queued` (continue after the last finished part);
  `appending` → exactly-once check (file ends with `appended_text` → `completed`, else append).
- **Retry**: only from `failed`/`cancelled`; status `queued`, `attempts + 1`, error cleared,
  provider re-snapshotted from current settings; `part_texts` kept if `source_size` unchanged.
- **Completed** jobs are immutable except `seen`.

## Transcript Section (in the note file)

```markdown
<existing content, untouched>⏎
⏎                                   ← separator only as needed (B7)
## Transcript — Recording 10:02 · 2026-10-05 10:02 · 1h 24m
⏎
<part 1 text>⏎
⏎
<part 2 text>⏎
```

## Derived views

- **Recording transcription history** (FR-023): jobs of a session's recordings, newest first,
  via `GET /sessions/{key}/transcriptions`; each item names the target note (current name if it
  still exists) and links to it.
- **Timeline / notes**: an append updates the note's `content_hash`, `size`, `updated_at` and
  `version` exactly like a content save (002), so note lists refresh normally.
