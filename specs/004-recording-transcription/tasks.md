---

description: "Task list for feature 004 — Transcribe Recordings into Notes"
---

# Tasks: Transcribe Recordings into Notes

**Input**: `/specs/004-recording-transcription/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: INCLUDED — Constitution VI names "transcribe → append to note" as a critical flow
needing an integration test; every endpoint needs tests. Tests first in each story.

**Order**: Setup → Foundational → US1 (transcribe into an existing note, MVP) → US2 (new note) →
US3 (progress, failure, retry, cancel, restart) → US4 (provider from settings) → US5 (history) →
Polish.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add `httpx>=0.28` to `[project] dependencies` in `backend/pyproject.toml` (keep it in the dev group too) and `uv sync`; add shadcn `progress` and `alert` to `frontend/src/components/ui/` (token classes only — replace any hard-coded colours, fix `cn` import to `@/lib/utils`)
- [X] T002 [P] `backend/tests/fake_transcriber.py`: FastAPI app with `POST /v1/audio/transcriptions` (multipart `file`, `model`, optional `language`, `response_format`) returning `{"text": "Transcript of <file name> (<n> bytes)[ lang=<language>]"}`; behaviour controlled by `model` values (`fail-401`, `fail-404-model`, `fail-413`, `fail-429-quota`, `fail-429-once`, `fail-503`, `slow-<seconds>`, `silent` → `""`); `GET /v1/models` → 200; validates that WebM uploads start with the EBML magic; records calls in `app.state.calls`
- [X] T003 [P] `backend/tests/e2e_seed.py`: `python -m tests.e2e_seed set-provider --data <dir> --user <username> --provider <id> --address <url> [--model m] [--api-key k] [--language auto]` writing `transcription_settings` + `provider_configs` with SQLAlchemy against `<dir>/unihelper.sqlite3`; Playwright config: third web server running `uv run uvicorn tests.fake_transcriber:app --port ${E2E_TRANSCRIBER_PORT ?? 8020}` in `frontend/playwright.config.ts`

---

## Phase 2: Foundational

- [X] T004 Models `backend/src/unihelper/models/transcription.py` per data-model.md: `TranscriptionSettings` (`user_id` PK FK users CASCADE, `active_provider_id` null, `default_language` default `'auto'`, `updated_at`), `ProviderConfig` (PK `(user_id, provider_id)`, `values_json`, `secret` null, `updated_at`), `TranscriptionJob` (all columns of data-model.md; `status` CHECK IN ('queued','uploading','transcribing','appending','completed','failed','cancelled'); `error_category` CHECK IN ('not_configured','invalid_credentials','unavailable','file_rejected','quota_exceeded','unknown') or NULL; `note_id` FK notes ON DELETE SET NULL; `recording_id` FK recordings ON DELETE CASCADE; partial UNIQUE index `(user_id) WHERE status IN ('queued','uploading','transcribing','appending')`; index `(status, created_at)`; index `(recording_id)`); export from `models/__init__.py`; Alembic `0006_transcription` (autogenerate, then check the partial index is emitted with `sqlite_where`)
- [X] T005 [P] Provider interface `backend/src/unihelper/transcription/base.py` exactly as `contracts/provider-interface.md` (`ProviderField`, `ProviderSpec`, `AudioPart`, `ProviderConfig` protocol, `ProviderError(category, message, settings_related, retryable)` whose `str()` is the message, `TranscriptionProvider` protocol) and plain-language messages per category in one table
- [X] T006 [P] `backend/src/unihelper/transcription/openai_client.py`: `OpenAITranscriptionClient(http: httpx.AsyncClient)` with `transcribe(base, part, model, language, api_key, on_progress)` — base normalisation (strip `/`, strip trailing `/v1`), streaming multipart body (64 KB chunks counting sent bytes → `on_progress`), `language` omitted for `auto`, timeouts (connect 10 s, read 10 min + 2 × audio minutes), status mapping per research B2 (401/403 invalid_credentials+settings; 404 model → unknown+settings "The model isn't available on this server."; 413/415/400 file_rejected; 429 `insufficient_quota` → quota_exceeded, other 429/502/503/504/connect/reset → unavailable retryable; other → unknown); never includes response bodies or headers in messages; `test(base, model, api_key)` = `GET {base}/v1/models` for 005
- [X] T007 [P] `backend/src/unihelper/transcription/providers.py`: registry (`all_specs()`, `get(id)`) with `voice-studio` (fields `address` url required, `model` text optional placeholder `whisper-1`; no auth; `max_upload_bytes=None`) and `openai-compatible` (`address` url, `apiKey` secret, `model` text — all required; Bearer auth; `max_upload_bytes=25*1024*1024`), both delegating to the client; `transcription/config.py`: `load_status(db, user)` and `load_config(db, user) -> (spec, values, secret_reader)`; "configured" = active provider set and all required fields present (secret counts for `kind: secret`)
- [X] T008 [P] `backend/src/unihelper/domain/webm.py`: `split(data, max_bytes) -> list[tuple[bytes, int]]` (part bytes, duration ms) at Cluster boundaries — each part = EBML header + Segment (unknown size) + Info without Duration + other kept elements (Tracks…) + whole clusters whose Timecode values are rewritten relative to the part's first cluster using the same byte width; one part when `max_bytes` is None or the file fits; a single cluster larger than `max_bytes` → `WebmError`
- [X] T009 [P] `backend/src/unihelper/domain/transcript.py`: `format_duration(ms)` (`42s`, `12m 05s`, `1h 24m`), `heading(name, started_at_local, duration_ms)` → `## Transcript — Recording 10:02 · 2026-10-05 10:02 · 1h 24m`, `separator_for(existing: bytes)` (empty → `""`; ends `\n\n` → `""`; ends `\n` → `"\n"`; else `"\n\n"`), `section(heading, part_texts)` (blank line after heading, parts joined by a blank line, empty/whitespace → `(No speech detected)`, trailing `\n`)
- [X] T010 [P] Unit tests: `backend/tests/unit/test_webm_split.py` (parts re-parse with `analyse`, timecodes start at 0, concatenated cluster payloads equal the original's, every part ≤ max, one part when unlimited, oversize cluster raises), `backend/tests/unit/test_transcript_format.py` (durations, heading, all separator cases, no-speech), `backend/tests/unit/test_openai_client.py` (against `fake_transcriber` via `httpx.ASGITransport`: success text, language omitted for auto, Bearer only when a key exists, URL normalisation with/without `/v1` and trailing slash, every error mapping, upload progress reaches 1.0, the key never appears in `str(error)` or captured logs)
- [X] T011 Schemas `backend/src/unihelper/schemas/transcription.py` (`ProviderField`, `ProviderSpec`, `TranscriptionStatus`, `TranscriptionStart` — exactly one of `note_id`/`new_note_name`, name 1–120 chars, language `auto` or 2-letter lowercase code, `AppendResult`, `TranscriptionJob` per `contracts/openapi.yaml`); `note_service.append_to_note(db, storage, user, note_id, text) -> {text, previous_hash, hash, version}` — reads current bytes, opens append mode, writes, fsync, updates `content_hash`/`size`/`updated_at` and bumps `version` like a content save; `StorageService.append_bytes` reused; a file deleted outside the app is recreated with just the section
- [X] T012 [P] Frontend skeleton: `frontend/src/features/recordings/extensions.ts` (`registerRecordingExtension({ id, Action?: ComponentType<{recording, sessionKey}>, Details?: ComponentType<{recording, sessionKey}> })` + `useRecordingExtensions()`), rendered by `RecordingPanel.tsx` (actions beside the item menu, details under each item); `frontend/src/features/transcription/{api.ts, routes.tsx}` imported from `app/features.ts`; regenerate `frontend/src/lib/api/schema.d.ts`

---

## Phase 3: User Story 1 — Transcribe into an existing note (P1) 🎯 MVP

**Independent Test**: with the fake provider configured, transcribe a recording into a note with content → original bytes unchanged, followed by the heading and text; open editor shows it without reload.

- [X] T013 [P] [US1] Contract tests `backend/tests/contract/test_transcription.py`: `GET /transcription/providers` (both specs, no secrets), `GET /transcription/status` (configured true/false, never values), `POST /recordings/{id}/transcriptions` with `noteId` (202 queued; 404 foreign recording/note; 409 `recording_not_finished` for an active recording; 409 `file_missing`; 409 `transcription_in_progress`; 409 `provider_not_configured`; 422 both/neither target, bad language), `GET /transcriptions/active`, `GET /transcriptions/{id}`; response schemas checked with `openapi_check(spec="004")`
- [X] T014 [P] [US1] Critical-flow integration test (Constitution VI "transcribe → append") `backend/tests/integration/test_transcribe_append_flow.py`: real SQLite + files; record a generated WebM (003 helpers), note with content without trailing newline → run the worker to completion (fake provider through `httpx.ASGITransport`) → file = original bytes + `\n\n` + exact section; second transcription accumulates after the first; external edit before completion is kept; job `appended` = written text with previous/new hash
- [X] T015 [US1] `backend/src/unihelper/services/transcription_service.py`: `start(db, user, recording_id, body)` (validations above, provider snapshot, job `queued`, wakes worker), `get/active/view(job)` (joins recording, current note name, provider name), and the run steps used by the worker: claim (`UPDATE … SET status='uploading' WHERE id=? AND status='queued'`), make parts (WebM split by spec limit, mp4 whole or `file_rejected` if over limit with message "This recording is too long for <provider>."), per part: uploading → transcribing (progress, `part_index`, `stage_started_at`, `part_texts` saved after each part, in-job retries 2/8/30 s for retryable errors), then appending per research B7/B8 (store `appended_text` + status `appending` first; append; mark completed with hashes in one commit)
- [X] T016 [US1] `backend/src/unihelper/transcription/worker.py`: `TranscriptionWorker(sessionmaker, storage, http_client_factory, concurrency=2)` with `start()/stop()/wake()`, loop picking queued jobs oldest first, one asyncio task per job, cancellation support; started/stopped in `main.py` lifespan (`UNIHELPER_TRANSCRIPTION_CONCURRENCY` setting); tests can run one job synchronously via `await worker.run_once()`
- [X] T017 [US1] Router `backend/src/unihelper/api/v1/transcription.py` (providers, status, start, active, get) registered in `main.py`; key never serialized (assert in tests by searching responses for the seeded key)
- [X] T018 [P] [US1] Unit tests `frontend/tests/unit/autosave-append.test.ts`: `applyServerAppend` when base hash matches (content = local + text, base advanced, unsaved edits kept and saved with the new hash), when it doesn't match (no-op, later conflict handled normally), and the racing save whose 409 `current.content === savedContent + text` auto-resolves without opening the conflict dialog; any other 409 still yields `conflict`
- [X] T019 [US1] `frontend/src/features/sessions/autosave.ts`: `NoteSaver.applyServerAppend({text, previousHash, hash})` + known-append auto-resolution per research B10; `frontend/src/features/sessions/editor/MarkdownEditor.tsx` handle method `appendContent(noteId, text)` inserting at the end without moving the cursor/scroll; `frontend/src/features/transcription/mergeIntoEditor.ts` wiring completed jobs to the saver/editor (via a small event emitted by the sessions module so transcription doesn't reach into the editor directly)
- [X] T020 [US1] UI: `TranscribeButton.tsx` (recording extension Action; disabled reasons per `ui-transcription.md`), `TranscribeDialog.tsx` (notes `RadioGroup`, language `Select` with `languages.ts` using `Intl.DisplayNames`, "Using <provider name>", inline errors, Enter submits), `useActiveTranscription.ts` (2 s polling while active, focus refetch otherwise; invalidates notes/note queries and calls `mergeIntoEditor` on completion), completion toast "Transcript added to “<note>”" with "Open note"
- [X] T021 [P] [US1] Component tests `frontend/tests/unit/transcribe-dialog.test.tsx` (lists notes, default language, submits `noteId`, inline 409 errors, disabled states with reasons, axe clean)

**Checkpoint**: MVP — a recording's transcript lands at the end of the chosen note.

---

## Phase 4: User Story 2 — Transcribe when the session has no notes (P1)

**Independent Test**: session with a recording and no notes → name a note → note created at once, later contains only heading + transcript.

- [X] T022 [P] [US2] Contract tests in `backend/tests/contract/test_transcription.py`: `newNoteName` creates the note before queuing (visible in `GET /sessions/{key}/notes` immediately, empty file), 409 `name_taken`, 422 empty name; integration case in `test_transcribe_append_flow.py`: new empty note gets heading + transcript with no leading blank line
- [X] T023 [US2] `transcription_service.start` new-note branch via `note_service.create_note` (002 rules) in the same request; dialog: no-notes mode (just "Note name", pre-filled "Transcript" or the next free "Transcript (n)"), "New note…" radio when notes exist; note list query invalidated on start

---

## Phase 5: User Story 3 — Progress, failure, retry, cancel, restart (P1)

**Independent Test**: start a job → all Transcribe buttons disabled with progress; provider failure → category message, note unchanged, Retry works; Cancel appends nothing; restart mid-job → resumed, appended once.

- [X] T024 [P] [US3] Contract tests `backend/tests/contract/test_transcription_lifecycle.py`: each fake failure mode → `failed` with the right `errorCategory`/`settingsRelated` and a message without the key, note bytes unchanged; `POST /transcriptions/{id}/retry` (202 same note/language, attempts+1, 409 `job_not_retryable` on completed/active, 409 `transcription_in_progress`); `POST /transcriptions/{id}/cancel` (queued → cancelled at once; running → cancelled before appending, nothing written; completed → 409 `job_finished`); `GET /transcriptions?unseen=true` + `POST /transcriptions/{id}/seen` (204, no longer listed); `DELETE /recordings/{id}` → 409 `recording_transcribing` while active
- [X] T025 [P] [US3] Integration tests in `backend/tests/integration/test_transcribe_append_flow.py`: restart recovery — job left in `transcribing` resumes after the last stored part; job left in `appending` with the section already in the file is completed without a second append, and without it is appended once; multi-part WebM (limit forced small) → one section with parts in order; target note deleted mid-job → fallback note `Transcript – <recording name>` with `fallbackNoteCreated`
- [X] T026 [US3] Service + worker: retry/cancel/seen/unseen in `transcription_service.py`, cancellation checks between steps and task cancellation of in-flight HTTP, restart recovery on worker start, fallback note (FR-011), `recording_service.delete_recording` 409 `recording_transcribing`; routes for retry, cancel, seen, unseen list in `api/v1/transcription.py`
- [ ] T027 [US3] UI: `TranscriptionStatus.tsx` (recording extension Details: stage text, determinate/indeterminate `Progress` with `aria-valuetext`, "part n of m · m:ss" elapsed ticking locally, Cancel; failed → message + Retry (+ Settings link when `settingsRelated`); cancelled → Retry; live region throttled to stage changes/10 %), `TranscriptionBar.tsx` (activity item: stage, progress, "Recording → Note", Go to session, Cancel), `TranscriptionNotifier.tsx` (global host: unseen jobs on start → toasts → `seen`; failure toast with Retry)
  - **Not done (found 2026-10-06)**: `TranscriptionBar.tsx` has no **Cancel** (it renders the compact progress view, which hides Cancel), and the progress bar is always determinate, so it sits at 50 % while the provider transcribes instead of showing an indeterminate bar. Everything else in T027 is implemented.
- [X] T028 [P] [US3] Component tests `frontend/tests/unit/transcription-status.test.tsx` (running stages and progress text, elapsed timer, Cancel/Retry calls, settings link only when settings-related, all Transcribe buttons disabled while a job is active, notifier shows unseen jobs once and acknowledges them, axe clean)

---

## Phase 6: User Story 4 — Provider from Settings (P2)

**Independent Test**: no provider → dialog explains and links to Settings; configured provider and default language are used.

- [X] T029 [P] [US4] Contract tests: job uses the active provider and default language when `language` is omitted; dialog-language override is sent to the provider (fake transcriber echoes `lang=`); key replaced during a job → next part uses the new key, key removed → `invalid_credentials`; a provider configured with an empty required field reports `configured: false`
- [X] T030 [US4] Dialog not-configured state ("Set up a transcription provider first." + "Open Settings → Transcription" link to `/settings/transcription`, no other controls) and default language from `GET /transcription/status`; settings links in failure states

---

## Phase 7: User Story 5 — See which recordings were transcribed (P3)

**Independent Test**: after success the recording shows "Transcribed → <note>" linking to the note; transcribing again into it warns.

- [X] T031 [P] [US5] Contract test: `GET /sessions/{key}/transcriptions` newest first, current note names after a rename, 404 foreign session
- [X] T032 [US5] Route + service for session history; `TranscriptionStatus` completed state with note link (opens the workspace with that note's tab active) and "+N earlier" disclosure; dialog "already transcribed into <note> on <date>" alert and "Transcribe again" label

---

## Phase 8: Polish

- [X] T033 [P] Playwright `frontend/tests/e2e/transcription.spec.ts` (light + dark, keyboard, axe): seed provider with `e2e_seed`; record ~6 s with the fake mic; type unsaved text in an open note; Transcribe into it → text kept and transcript appended in the editor without reload, toast, file content checked via API; second session without notes → new note; failure (`fail-401` model) → error + Settings link → fix (re-seed) → Retry succeeds; Cancel during `slow-5`; buttons disabled while running in another session
- [X] T034 Run all checks (ruff, mypy, pytest incl. coverage guard over 4 contracts, eslint, tsc, vitest, Playwright light+dark, build); record in `specs/004-recording-transcription/checklists/validation.md`; README (transcription, provider setup until 005, fake transcriber for development)

## Dependencies

Setup → Foundational → US1 → (US2, US3, US4, US5 in priority order; US2 and US4 touch only the
dialog/service branches and can run in parallel with US3's backend tasks). Polish last.

## Parallel examples

- Foundational: T005, T006, T007, T008, T009, T012 in parallel after T004; T010 after T006/T008/T009.
- US1: T013, T014, T018, T021 (tests) in parallel; then T015 → T016 → T017; T019 → T020.
- US3: T024, T025, T028 in parallel; T026 → T027.

## Implementation strategy

MVP = Phases 1–3 (transcribe into an existing note, exactly once, editor merge). Then US2 and US3
(both P1) before US4/US5. Each phase ends with its tests green.
