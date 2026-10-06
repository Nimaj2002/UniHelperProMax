---

description: "Task list for feature 003 — Session Audio Recording & Playback"
---

# Tasks: Session Audio Recording & Playback

**Input**: `/specs/003-session-audio-recording/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: INCLUDED — Constitution VI names "record → save" as a critical flow needing an
integration test; every endpoint needs tests. Tests first in each story.

**Order**: US1 (record, MVP) → US2 (survive crashes/offline) → US3 (app-wide) → US4 (player) →
US5 (rename/delete) → Polish.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add the shadcn `slider` primitive to `frontend/src/components/ui/slider.tsx` (token classes only, Phosphor-free) and extend 002's `Preferences` schema in `specs/002-course-session-notes/contracts/openapi.yaml` with `playerVolume` (number 0–1) and `playerMuted` (boolean)
- [X] T002 [P] Playwright: launch Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and grant `microphone` permission in `frontend/playwright.config.ts`

---

## Phase 2: Foundational

- [X] T003 Implement `backend/src/unihelper/domain/webm.py`: EBML varint/ID read & write, element walker; `analyse(data) → {timecode_scale, clusters: [(offset, timecode)], duration_ms}` (last cluster timecode + last SimpleBlock/BlockGroup offset + 20 ms); `finalize(data) → bytes` writing `Info/Duration` (float64, scale-aware) and a `Cues` element before the first Cluster with fixed-width (8-byte) `CueClusterPosition`s computed for the final layout, dropping any existing SeekHead/Cues; raises `WebmError` on unparseable input
- [X] T004 [P] Unit tests `backend/tests/unit/test_webm.py` with a WebM generator helper (`tests/webm_fixture.py`, Opus-like SimpleBlocks every 20 ms in 1 s clusters, unknown-size Segment): duration within one frame; finalize keeps every cluster byte-identical, adds Duration and one CuePoint per cluster pointing at the right offsets (re-parse to verify); finalize is idempotent; a truncated last cluster (crash) still analyses; garbage → `WebmError`
- [X] T005 [P] `Recording` model `backend/src/unihelper/models/recording.py` per data-model.md (`name` "1–120 chars", UNIQUE (session_folder_id, name_key), UNIQUE (session_folder_id, file_key), `status` IN ('recording','complete','interrupted'), `mime_type` IN ('audio/webm','audio/mp4'), `next_seq` ≥ 0) + Alembic `0005_recordings`
- [X] T006 Extend `StorageService`: `append_bytes(parts, data)` (open `ab`, write, flush, fsync; returns new size), `replace_bytes_atomic(parts, data)`, `absolute_path(parts)` for streaming; rename `delete_note_file` → `delete_content_file` (only `.md` in `notes/`, `.webm`/`.m4a` in `audios/`); update 002 callers and `tests/unit/test_storage_service.py`
- [X] T007 [P] Schemas `backend/src/unihelper/schemas/recordings.py` (`Recording`, `RecordingStart`, `RecordingStop`, `RecordingRename`, `ChunkResult`) and add `player_volume` (0–1) / `player_muted` to `Preferences` + defaults in `workspace_service.py`
- [X] T008 [P] Frontend module skeleton `frontend/src/features/recordings/` (`api.ts` typed calls/hooks, `routes.tsx` registering a workspace panel and activity bar, imported from `app/features.ts`); `registerSignOutGuard` in `frontend/src/app/shell/registry.ts`, consulted by the TopBar sign-out item

---

## Phase 3: User Story 1 — Record a lecture (P1) 🎯 MVP

**Independent Test**: record 1 min in a session, stop → item "Recording HH:MM", ~1:00, file in `audios/` that plays.

- [X] T009 [P] [US1] Contract tests `backend/tests/contract/test_recordings.py`: `POST /sessions/{key}/recordings` (201, default name, unique name per session, 409 `recording_in_progress` while another is active, 422 bad mime, 404 foreign), `PUT …/chunks/{seq}` (append, idempotent repeat, 409 `chunk_gap` with `nextSeq`, 413 > 10 MB, 409 `recording_finished` after complete), `POST …/stop` (complete, duration from file), `GET /sessions/{key}/recordings` newest first, `GET /recordings/{id}`, `GET /recordings/active`, `GET /recordings/{id}/audio` (200, 206 with Range, 404 `file_missing`)
- [X] T010 [P] [US1] Integration test (Constitution VI "record → save") `backend/tests/integration/test_record_save_flow.py`: start → upload generated WebM in 5 chunks → stop → `…/2026-09-28/audios/Recording 10-02.webm` exists, is the uploaded bytes plus Duration/Cues, analyses to the right duration; audio endpoint streams it with ranges
- [X] T011 [US1] Implement `backend/src/unihelper/services/recording_service.py` (start incl. folder get-or-create and active check, chunk append with seq rules and fsync, stop/finalize via `webm.finalize` with atomic replace and fallback to client duration for mp4/parse errors, list/get with `active`/`missing`, active lookup) and routers `backend/src/unihelper/api/v1/recordings.py` (raw body for chunks; `FileResponse` for audio)
- [X] T012 [P] [US1] Unit tests `frontend/tests/unit/recorder.test.ts` with fake `MediaRecorder`/`getUserMedia`: start creates server recording then records with 5 s timeslice and picks the supported MIME; each chunk is queued; stop flushes and calls stop with duration; permission denied → `error: "permission"` and no server recording; track `ended` (mic unplugged) → stops safely
- [X] T013 [US1] Implement `frontend/src/features/recordings/recorder.ts` (singleton `RecorderController`: state `idle|starting|recording|stopping|error`, `getUserMedia`, MIME choice, `MediaRecorder.start(5000)`, elapsed timer, `AnalyserNode` level, chunk → `uploader.enqueue`, subscribe/useRecorder hook) and `uploader.ts` (ordered per-recording queue, retry with backoff, handles `chunk_gap`)
- [X] T014 [US1] Build `RecordingPanel.tsx` (the list is part of it; no separate `RecordingList.tsx`), `LevelMeter.tsx`: Record/Stop button, timer, level meter (with text, not colour-only), permission/unsupported messages, list newest first with name/date/duration and status badges; register as the workspace right panel

**Checkpoint**: MVP — record and see/download the file.

---

## Phase 4: User Story 2 — Survive crashes and closed pages (P1)

**Independent Test**: record 2 min, close the tab, reopen → "Recovered (interrupted)" ≈ 2 min, plays.

- [X] T015 [P] [US2] Contract/integration tests `backend/tests/integration/test_recording_recovery.py`: no chunk for 30 s → list returns `interrupted` with finalized duration and `active: false`; late chunks still append to an interrupted recording; `stop(interrupted=true)` re-finalizes; a new recording can start once the old one is stale; truncated final chunk still yields a playable file
- [X] T016 [P] [US2] Unit tests `frontend/tests/unit/uploader.test.ts` (fake IndexedDB via an in-memory `ChunkStore` interface): chunks persist before upload and are removed only after 2xx; offline → stays queued and retries; recovery after "reload" uploads leftovers in order then sends `stop(interrupted: true)`; storage-low warning threshold
- [X] T017 [US2] Implement `chunkStore.ts` (IndexedDB `uh-recordings`: `chunks`, `recordings`; in-memory fallback with warning) and crash recovery as `RecorderController.recover()` in `recorder.ts` (on app start: for each stored recording without a live recorder → upload remaining chunks → `stop(interrupted)`; note: "live" is only checked for the current tab, see analysis finding 003-F1); stale→interrupted handling in `recording_service.py`
- [X] T018 [US2] UI: "Upload pending" and "Recovered (interrupted)" badges, `beforeunload` while recording or pending, storage-low warning toast

---

## Phase 5: User Story 3 — Keep recording while working (P1)

**Independent Test**: record, switch note tabs, go to the calendar → bar visible, Stop from the bar, recording continuous.

- [ ] T019 [US3] `RecordingBar.tsx` registered with `registerActivity`: dot + "Recording" text, elapsed time, course · date, Stop, Go to session; other sessions' panels show "Recording another session — Go to it"; `GET /recordings/active` on load shows a recording from another window
  - **Not done (found 2026-10-06)**: no screen calls `GET /recordings/active` (`fetchActiveRecording` in `frontend/src/features/recordings/api.ts` is unused), so a second window offers "Record" instead of showing the running recording. The recording bar, Stop and "Recording another session — Go to it" in the same window are implemented.
- [X] T020 [US3] Sign-out guard: TopBar sign-out asks to stop first while recording (`registerSignOutGuard`)

---

## Phase 6: User Story 4 — Play back (P2)

**Independent Test**: select a recording → play, pause, stop, seek, ±5 s, volume/mute remembered.

- [X] T021 [P] [US4] Component tests `frontend/tests/unit/player.test.tsx` (stubbed `HTMLMediaElement`): controls and accessible names, ±5 s clamps, stop returns to 0, seek slider value text, keyboard map, one-at-a-time via `nowPlaying`, volume persisted through `/preferences`, axe clean
- [X] T022 [US4] Implement `Player.tsx` + `nowPlaying.ts` per `ui-recording.md`; contract test for the new preference keys in `backend/tests/contract/test_preferences.py`

---

## Phase 7: User Story 5 — Rename and delete (P2)

- [X] T023 [P] [US5] Contract tests `backend/tests/contract/test_recordings_manage.py`: rename (file renamed, 409 name taken, 409 while recording, 412 stale, rollback restores file name), delete (file removed, only that file, 409 while recording, 412 stale), deleting a recording with a missing file
- [X] T024 [US5] Implement rename/delete in `recording_service.py` + routes; `RecordingDialogs.tsx` (rename, delete confirmation naming the file); timeline `audio_count` in `timeline_service.py` with a contract test update

---

## Phase 8: Polish

- [X] T025 [P] Playwright `frontend/tests/e2e/recording.spec.ts` (light + dark, keyboard, axe): record ~6 s with the fake mic, stop, play, seek to the end, ±5 s; navigate to the calendar while recording and stop from the bar; reload mid-recording → recovered item plays; offline (route abort) → pending → complete
- [X] T026 Run all checks; record results in `specs/003-session-audio-recording/checklists/validation.md`; README (recordings on disk, player keys)

## Dependencies

Setup → Foundational → US1 → US2 → US3 → US4 → US5 → Polish. US4/US5 backend parts can run in parallel with US2/US3 frontend work.
