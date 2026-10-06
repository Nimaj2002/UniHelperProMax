# Phase 0 Research: Transcribe Recordings into Notes (004)

Builds on 001 (API conventions, `StorageService`, CSRF, problems), 002 (notes, `NoteSaver`
autosave and conflict handling, session folders) and 003 (recordings, `domain/webm.py`, the
shell activity registry). Decisions confirmed with the user on 2026-10-05 are marked ✔.

## B1. Provider protocol ✔

- **Decision**: Both first-release providers speak the **OpenAI audio transcription API**:
  `POST {address}/v1/audio/transcriptions` (multipart: `file`, `model`, optional `language`,
  `response_format=json`) → `{"text": "…"}`. "Voice Studio" = that API **without** a key (only
  an address; model optional, sent as `whisper-1` if the server needs one); "OpenAI-compatible"
  = the same API **with** `Authorization: Bearer <key>` and a user-chosen model. One HTTP client
  (`OpenAITranscriptionClient`) serves both; each provider is a small declaration + adapter.
- **Address handling**: base address with or without trailing slash or `/v1` suffix all work
  (normalise: strip `/`, strip a trailing `/v1`, then append `/v1/audio/transcriptions`).
- **Rationale**: The user confirmed Voice Studio is OpenAI-style without a key. One client keeps
  the code small; providers remain pluggable (B2).
- **Alternatives**: A bespoke Voice Studio adapter (no API known); provider SDKs (heavier, one
  per vendor).

## B2. Pluggable provider interface (Constitution IV, FR-021)

- **Decision**: `backend/src/unihelper/transcription/` holds a `TranscriptionProvider` protocol
  and a registry (`providers.py`). Each provider declares a `ProviderSpec`: `id`, `name`,
  `fields` (each: `key`, `label`, `kind` = `url | secret | text`, `required`, `placeholder`),
  `maxUploadBytes` (or none). Calls: `transcribe(part, language, config, on_progress) -> str`
  and (for 005) `test(config)`. Failures raise `ProviderError(category, message, settings_related)`.
  The UI only ever reads `GET /transcription/providers` and job/status endpoints, so a new
  provider is a backend-only change. Contract: [contracts/provider-interface.md](./contracts/provider-interface.md).
- **Error categories** (FR-016): `not_configured`, `invalid_credentials`, `unavailable`,
  `file_rejected` (too large/unsupported), `quota_exceeded`, `unknown`; plus
  `settings_related: bool` for FR-020 links (unreachable address, invalid key, unknown model).
  HTTP mapping: 401/403 → invalid_credentials; 404 with model wording / `model_not_found` →
  unknown model (settings_related); 413/415/400 about the file → file_rejected; 429 with
  `insufficient_quota` → quota_exceeded, other 429 → retried (B6) then unavailable; 5xx,
  connection errors, timeouts → unavailable.
- **Secrets** (FR-017, FR-019): the key is read from the database immediately before each HTTP
  request (never held in the job row, never logged); error messages are built from categories,
  never from raw response bodies or exception strings that could echo headers.

## B3. Provider configuration source (shared with 005)

- **Decision**: 004 creates the per-user storage that 005's Settings screens will write:
  `transcription_settings` (active provider, default language) and `provider_configs` (one row
  per user × provider: non-secret values as JSON, the API key in its own column). 004 only
  **reads** them (`transcription/config.py`) and exposes `GET /transcription/status`
  (configured?, provider id/name, default language — no values, no key). Writing, masking,
  connection testing and the http/https rule are 005. Until 005 ships, tests configure the
  provider by writing these tables (pytest fixtures; an E2E seeding helper in
  `backend/tests/e2e_seed.py`).
- **Rationale**: The user asked for a configuration source that 005 fills; reading through one
  module keeps 004 independent of 005's UI and API shape.
- **Alternatives**: Implement 005's settings API now (scope creep, spec discipline VII);
  environment variables (not per user, contradicts 005 FR-002).

## B4. Running jobs in the background without new infrastructure (FR-014, VII)

- **Decision**: An in-process **asyncio worker** started in the FastAPI lifespan
  (`transcription/worker.py`). Jobs live in SQLite (`transcription_jobs`); the worker picks the
  oldest `queued` job, runs it, and is woken by an `asyncio.Event` when a job is created,
  retried or cancelled (plus a 5 s poll as a safety net). It runs up to 2 jobs at once across
  users (`UNIHELPER_TRANSCRIPTION_CONCURRENCY`, default 2); a user never has more than one
  active job (partial unique index). Database work runs in a thread (`asyncio.to_thread`) with
  its own short sessions; HTTP uses `httpx.AsyncClient`.
- **Restart** (US3 #7, FR-010): on startup, jobs in `uploading`/`transcribing` return to
  `queued` and resume from the first part without a stored transcript (B5); a job found in
  `appending` is completed by the exactly-once check (B8). Nothing is silently dropped.
- **Rationale**: Jobs survive browser closes and sign-outs because they run on the server;
  SQLite is the queue, so no broker is needed.
- **Alternatives**: Celery/RQ + Redis (forbidden infrastructure); a separate worker process
  (another thing to run); FastAPI `BackgroundTasks` (lost on restart, no cancel).

## B5. Long recordings (FR-022) ✔

- **Decision**: Pure-Python splitting of **WebM** at Cluster boundaries
  (`domain/webm.py: split(data, max_bytes)`): each part = EBML header + Segment (unknown size)
  + Info (no Duration) + Tracks + a run of whole Clusters whose Timecodes are rewritten relative
  to the part start (same byte width), so every part is a valid, independently decodable file.
  Parts target 90 % of the provider's `maxUploadBytes` (OpenAI-compatible: 25 MB → ≈ 70 min at
  48 kbps; Voice Studio: no limit → one part). Part texts are stored as they complete
  (the job's `part_texts` JSON list), so a retry/restart continues with the next part, and are joined in order
  with a blank line. **MP4/M4A** (Safari) recordings are sent whole; if larger than the limit
  the job fails with `file_rejected` and a message explaining that this recording is too long
  for the provider (Safari at 48 kbps ≈ 1.5 h for 25 MB).
- **Rationale**: User-confirmed; reuses 003's EBML code, no ffmpeg (VII).
- **Trade-off**: a word spanning a cut may be split; cuts happen at most every ~70 min.
- **Alternatives**: ffmpeg (system dependency); re-encoding in Python (no pure-Python Opus).

## B6. Progress and retries inside a job (FR-013, SC-005)

- **Decision**: Status = stage: `queued → uploading → transcribing → appending → completed`
  (or `failed` / `cancelled`). `progress` (0–1) = (finished parts + upload fraction of the
  current part) / parts; upload fraction comes from a streaming multipart body that counts sent
  bytes. While a part is being transcribed the server has no percentage, so the job reports
  `partIndex`, `partCount` and `stageStartedAt`; the UI shows "Transcribing part 2 of 3 ·
  1:24" and updates every second locally. The client polls the active job every 2 s (B9), so
  updates appear well within 10 s.
- **Transient failures**: 429 (rate limit), 502/503/504 and connection resets are retried up
  to 3 times per part with backoff (2, 8, 30 s) before the job fails as `unavailable`.
- **Timeouts**: connect 10 s; per part read timeout = 10 min + 2 × audio minutes.

## B7. Appending to the note (FR-006–FR-009, FR-011, Principle I)

- **Decision**: `note_service.append_to_note(note, text)` (new) reads the file's current bytes,
  computes the separator (empty note → none; ends with `\n\n` → none; ends with `\n` → `\n`;
  otherwise `\n\n` — the existing last character is never touched), opens the file in append
  mode, writes `separator + section`, `fsync`s and updates `content_hash`/`size`/`updated_at`
  like a content save (which also bumps the note `version`). Only bytes after the old end are
  written: existing content cannot change.
- **Section format** (FR-007): `## Transcript — Recording 10:02 · 2026-10-05 10:02 · 1h 24m`,
  blank line, transcript paragraphs, trailing `\n`. Date/time in the user's time zone; duration
  `42s`, `12m 05s`, `1h 24m`. Empty provider text → `(No speech detected)`.
- **External edits**: the append uses the file as it is at completion time, including edits
  made outside the app (spec edge case).
- **Target note deleted** (FR-011): a new note `Transcript – Recording 10:02` (suffix ` (2)`…
  if taken) is created and receives the section; the job records `fallbackNoteCreated: true`
  and the notification says so.

## B8. Exactly once (FR-010, SC-002)

- **Decision**: Before appending, the full section text is stored in the job
  (`appended_text`), status becomes `appending`, and the note's pre-append hash is recorded.
  After the file write the job is marked `completed` in the same transaction that updates the
  note row. If the server dies in between, recovery sees `appending`: if the file ends with
  `appended_text` the job is just marked completed, otherwise the append is performed. A
  completed job is never appended again; Retry is only allowed for `failed`/`cancelled`.
- **Cancel race**: a cancel request that arrives once `appending` has started is ignored (the
  job completes) — the user sees the result instead of a half-state.

## B9. Client state, polling and notifications (FR-012, FR-015)

- **Decision**: `GET /transcriptions/active` is polled every 2 s while a job is active and on
  window focus otherwise (TanStack Query); all Transcribe buttons in every session read this
  query, and `POST …/transcriptions` returns 409 `transcription_in_progress` if another window
  started one meanwhile. Finished jobs carry `seen: false` until the client acknowledges them
  (`POST /transcriptions/{id}/seen`); on app start the client loads unseen jobs and shows one
  toast each ("Transcript added to Lecture notes" / "Transcription failed — Retry"), which
  covers users who were away (FR-015). A global activity-bar item (003's `registerActivity`)
  shows the running job everywhere, with Cancel.
- **Alternatives**: Server-Sent Events/WebSockets (long-lived connections through the Vite
  proxy and tests; polling at 2 s is enough for SC-005).

## B10. Open editor receives the transcript without losing typing (FR-009)

- **Decision**: A completed job returns `appended: {text, previousHash, hash, version}`. When
  the client sees a completed job for a note that has a live `NoteSaver`, it calls
  `saver.applyServerAppend(appended)`: if the saver's base (`savedContent` hash) equals
  `previousHash`, the saver adopts the new hash and version, its base becomes `base + text`, its
  content becomes `local + text`, and the editor inserts `text` at the end (cursor kept); any
  unsaved local edits then save normally on top. If an autosave races the append, the 409
  `file_changed_on_disk` whose `current.content` equals `savedContent + text` is resolved the
  same way automatically (as does a 412 `version_conflict` with the same content); every other conflict still opens 002's conflict dialog.
- **Rationale**: Keeps the user's edits (Principle I) and shows the text without reload, while
  002's conflict rules stay intact for real concurrent edits.

## B11. Interaction with recordings and notes

- Transcribe is offered only for recordings with status `complete` or `interrupted` and an
  existing file (003 `missing: false`).
- `DELETE /recordings/{id}` returns 409 `recording_transcribing` while one of its jobs is active
  (spec edge case). Renaming is allowed (the job reads the file at the start of each part via
  the recording row).
- Deleting/renaming the target note during a job is allowed (B7 handles deletion; renames keep
  the note id).
- Language list: "Auto-detect" + ISO 639-1 codes rendered with `Intl.DisplayNames` in the UI;
  `auto` is sent as no `language` field.

## B12. Testing without a real provider

- **Decision**: `backend/tests/fake_transcriber.py` — a small FastAPI app implementing
  `/v1/audio/transcriptions` with controllable behaviour (text derived from the uploaded file,
  delays, status codes, quota/auth errors, parts count). Contract and integration tests mount it
  through `httpx.MockTransport` (no ports); Playwright starts it with uvicorn as a third web
  server and seeds the provider config with `tests/e2e_seed.py`.
- Constitution VI critical flow "transcribe → append" =
  `tests/integration/test_transcribe_append_flow.py` (real SQLite, real files, existing content
  byte-identical, restart in the middle, exactly once).
