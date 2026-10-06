# Implementation Plan: Transcribe Recordings into Notes

**Branch**: `004-recording-transcription` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-recording-transcription/spec.md`

## Summary

A "Transcribe" action on every finished recording opens a dialog to pick a note of the session
(or name a new one) and a language. The server queues a job in SQLite; an in-process asyncio
worker sends the audio to the user's provider, which speaks the OpenAI transcription API (Voice
Studio without a key, OpenAI-compatible with one). Long WebM recordings are split in pure Python
at cluster boundaries. On success the transcript section (heading with recording name, date/time
and duration) is appended with an fsync'd append-only write, exactly once even across restarts;
an open editor merges it at the end without losing unsaved typing. One job per user at a time;
progress, cancel, retry, history and notifications are shown in the audio panel, an activity-bar
item and toasts. Provider settings are read from per-user tables that feature 005's Settings
screens will write.

## Technical Context

**Language/Version**: Python 3.12+, TypeScript 5.9 / React 19 — as 001–003

**Primary Dependencies**: backend adds **httpx** (async HTTP client, already a dev dependency) as
a runtime dependency; frontend adds shadcn `Progress` and `Alert`. No other new packages.

**Storage**: tables `transcription_settings`, `provider_configs`, `transcription_jobs` (revision
`0006_transcription`); transcripts are appended to the existing note `.md` files (002).

**Testing**: pytest — provider client against `tests/fake_transcriber.py` via
`httpx.MockTransport`, WebM split unit tests, contract tests for every path, the Constitution VI
critical flow "transcribe → append" integration test (existing content byte-identical, restart
mid-job, exactly once, fallback note); Vitest — dialog, status row, polling hooks,
`NoteSaver.applyServerAppend` merge rules; Playwright — fake transcriber as a third web server,
full flow with an open editor, failure + retry, cancel, light/dark, axe.

**Target Platform**: as 003 (evergreen desktop browsers; server runs wherever the backend runs).

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: 3 user actions to start (SC-001); 1 h recording ≤ 15 min with a typical
provider (SC-003, provider-bound); stage/progress updates ≥ every 10 s (SC-005, design 2 s
polling + per-second elapsed time); 4 h recordings (FR-022).

**Constraints**: Constitution I (append-only, exactly once, failed jobs never touch notes), III
(all via `/api/v1`), IV (one provider interface, keys never returned/logged, UI discovers
providers), V (keyboard, AA, state by text), VII (SQLite only — no broker, no ffmpeg).

**Scale/Scope**: one active job per user; worker concurrency 2 jobs per server; transcripts up
to ~300 KB per section.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 004 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Transcription only appends; failures/cancel don't touch notes; no double append | PASS | PASS — `append_to_note` writes only after the old end (fsync); exactly-once via `appending` state + tail check (B8); failed/cancelled jobs never write; open editors merge without losing typing (B10); deleted target → fallback note (FR-011) |
| II. Data ownership | Transcript lives in the Markdown note | PASS | PASS — plain Markdown section in the note's `.md`; no transcript stored only in the DB (the job keeps a copy for exactly-once/merge) |
| III. Separation | UI only via `/api/v1`, documented contracts | PASS | PASS — 9 paths in `contracts/openapi.yaml`; provider HTTP happens server-side only |
| IV. Pluggable transcription | One interface; UI discovers providers; keys server-side, never returned or logged | PASS | PASS — `contracts/provider-interface.md`; `GET /transcription/providers`; key read at request time, never in job rows/responses/logs; error messages built from categories |
| V. UI quality | shadcn, taste-skill, tokens, keyboard, AA | PASS | PASS — `contracts/ui-transcription.md`; new primitives Progress/Alert from shadcn; text + icon states |
| VI. Testing | Endpoint tests; **transcribe → append** integration test | PASS | PASS — contract tests per path; `integration/test_transcribe_append_flow.py` with real SQLite + files |
| VII. Simplicity | No new infrastructure; justify new deps | PASS | PASS — SQLite is the job queue, in-process worker, pure-Python WebM split; httpx justified below |

**Result**: all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/004-recording-transcription/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · provider-interface.md · ui-transcription.md
└── tasks.md            (/speckit-tasks)
```

### Source Code (changes)

```text
backend/src/unihelper/
├── domain/webm.py                         # + split(data, max_bytes) at cluster boundaries
├── domain/transcript.py                   # section heading/format, separator rule, duration text
├── transcription/
│   ├── base.py                            # ProviderSpec/Field, AudioPart, ProviderError, protocol
│   ├── openai_client.py                   # OpenAI-style multipart client with upload progress
│   ├── providers.py                       # registry: voice-studio, openai-compatible
│   ├── config.py                          # reads transcription_settings/provider_configs (005 writes)
│   └── worker.py                          # asyncio worker, restart recovery, cancellation
├── models/transcription.py · db/migrations/versions/0006_transcription.py
├── services/transcription_service.py      # start/retry/cancel/seen/list, run steps, exactly-once append
├── services/note_service.py               # + append_to_note
├── services/recording_service.py          # delete blocked while transcribing
├── schemas/transcription.py · api/v1/transcription.py
└── main.py                                # register router; start/stop worker in lifespan
backend/tests/
├── fake_transcriber.py · e2e_seed.py
├── unit/test_webm_split.py · unit/test_transcript_format.py · unit/test_openai_client.py
├── contract/test_transcription*.py
└── integration/test_transcribe_append_flow.py

frontend/src/
├── components/ui/progress.tsx · alert.tsx            # shadcn
├── features/recordings/extensions.ts                 # registerRecordingExtension (used by RecordingPanel)
├── features/sessions/autosave.ts                     # + NoteSaver.applyServerAppend, auto-resolve known appends
├── features/transcription/
│   ├── routes.tsx                                    # registers recording extension, activity, global host
│   ├── api.ts (incl. the active-job polling hook) · languages.ts · progress.ts (stage labels)
│   ├── TranscribeButton.tsx · TranscribeDialog.tsx · TranscriptionStatus.tsx
│   ├── TranscriptionBar.tsx · TranscriptionNotifier.tsx
│   └── mergeIntoEditor.ts                            # completed job → open NoteSaver/editor
frontend/tests/{unit/transcribe-dialog.test.tsx, transcription-status.test.tsx, autosave-append.test.ts, e2e/transcription.spec.ts}
```

**Structure Decision**: new `features/transcription` module plugging into a new recordings
extension registry (so 003's panel doesn't import 004), the shell activity/global-host
registries, and 002's autosave via one new method. Backend provider code is isolated in
`unihelper/transcription/`.

## Phase 0 — Research

Complete: [research.md](./research.md) (B1–B12). User decisions (2026-10-05): Voice Studio is
OpenAI-style without a key; long recordings are split in pure Python (WebM only).

## Phase 1 — Design & Contracts

Complete: [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/provider-interface.md](./contracts/provider-interface.md),
[contracts/ui-transcription.md](./contracts/ui-transcription.md), [quickstart.md](./quickstart.md).
Post-design Constitution Check: PASS.

## Dependency on Feature 005

Resolved: 005 is implemented, so providers are configured in Settings → Transcription
(`/settings/transcription`). 004 ships the tables, the read path, `GET /transcription/providers`
and `GET /transcription/status`; 005 writes the tables and adds the connection test. Automated
tests still configure providers with `tests/e2e_seed.py`. Coupling to note: a successful job marks
the provider "connected" via 005's `transcription_settings_service.mark_connected`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Server dies between file append and DB commit | `appending` state + stored section + tail check on recovery (B8) |
| Autosave races the append in an open editor | Known-append auto-resolution (B10); all other conflicts keep 002's dialog |
| Provider echoes secrets in error bodies | Messages built from categories only; logs carry category/status, never bodies |
| Split parts not decodable by a provider | Each part is a full WebM (header + Tracks + clusters, relative timecodes); unit tests re-parse parts; fake transcriber validates parts |
| Long provider calls block the event loop | Async HTTP; DB access in threads; worker concurrency capped |
| Multiple uvicorn workers would run duplicate workers | Job claiming is an atomic `UPDATE … WHERE status='queued'`; documented as single-process deployment (as 001) |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `httpx` runtime dependency | Async HTTP with streaming multipart upload (progress), timeouts and cancellation inside the asyncio worker | `urllib` is blocking (one thread per job, no cancellation, hand-written multipart); already used in tests so no new supply-chain surface |
| In-process asyncio worker | Jobs must outlive browser sessions and restarts (FR-014, US3 #7) | `BackgroundTasks` are lost on restart and can't be cancelled; a broker/worker process is forbidden infrastructure (VII) |
| Recording extension registry | 003's panel shows 004's actions without importing them (same pattern as 002's panel registry) | Importing transcription UI into recordings couples features and breaks the module boundary |
