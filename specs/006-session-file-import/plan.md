# Implementation Plan: Import Audio and Notes into a Session

**Branch**: `006-session-file-import` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-session-file-import/spec.md`

## Summary

Imported audio becomes an ordinary `recordings` row with `origin = imported`, so the existing list,
player, rename, delete, Transcribe and timeline work unchanged. Each file is streamed in one
request into a staging folder outside the user's folders, checked by a small pure-Python header
probe (format + duration), and only then moved atomically into the session's `audios/` folder
and inserted; a cancel, failure or disconnect leaves nothing behind. Note import reads `.md`/`.txt`
in the browser and reuses `POST /sessions/{key}/notes`, whose 409 `name_taken` drives a
Rename / Replace / Skip prompt; Replace is a separate, confirmed, lock-protected operation that
refuses while the note has unsaved edits or a transcription is about to append to it.

## Technical Context

**Language/Version**: Python 3.12+, TypeScript 5.9 / React 19 — as 001–005

**Primary Dependencies**: no new packages. Backend: FastAPI streaming request body, `anyio`
thread offload, new `domain/audio_probe.py` (header parsing for MP3, M4A, AAC, WAV, OGG, FLAC;
WebM via existing `domain/webm.py`). Frontend: `XMLHttpRequest` for upload progress, existing
shadcn `Progress`, `AlertDialog`, `Checkbox`, `Badge`; `TextDecoder` (fatal UTF-8).

**Storage**: `recordings` gains `origin`, `original_file_name`, wider `mime_type` CHECK
(migration `0008_recording_origin`, table rebuild with foreign keys off — research I2). Files:
`files/.uploads/*.part` (staging) → `…/<class-date>/audios/<name>.<ext>`; notes unchanged.

**Testing**: pytest (audio_probe unit tests on generated fixtures; contract tests for the 2 new
operations and the new 422; integration: import → play → transcribe, "import never damages
existing data", Replace guards, migration 0008 keeps transcription history); Vitest (pre-checks,
upload queue with fake XHR, conflict-flow state machine); Playwright (upload/cancel/drag-drop,
note import with every conflict choice, keyboard, axe light/dark).

**Target Platform**: evergreen desktop browsers (as 003); server on the same machine as `files/`.

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: rejection message < 1 s after pick (SC-002); progress ≥ 1 update/s
(SC-003, XHR `progress` events, throttled to 4/s for rendering); cancel effective < 1 s; server
memory flat during a 1 GB upload (streamed in 1 MB writes).

**Constraints**: Constitution I (nothing overwritten; staged → atomic move; confirmed Replace
only), II (files stored unchanged in `audios/`, readable names), III (all through `/api/v1`, only
`StorageService` touches files), V (keyboard, AA, text not colour), VII (SQLite only, no ffmpeg).
Single backend process (004) — `note_file_lock` and the free-space check rely on it.

**Scale/Scope**: ≤ 1 GB per audio file, ≤ 2 concurrent uploads per browser, ≤ 5 MB per note file;
one user's imports at a time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 006 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Imports never overwrite/damage notes or recordings; destructive actions confirmed | PASS | PASS — staging outside user folders + atomic move + `on_rollback` cleanup; names and file names never reuse an existing row or on-disk file; note Replace needs a second confirmation, `If-Match`, `note_file_lock`, and refuses during transcription or with unsaved edits; migration 0008 runs with FKs off so transcription history isn't cascade-deleted (I2) |
| II. Data ownership | Standard audio + Markdown files in the readable hierarchy | PASS | PASS — imported audio stored byte-for-byte in `audios/` (standard formats only); imported notes are plain `.md` files in `notes/`; `.uploads/` staging is outside user folders and swept |
| III. Separation | UI only via `/api/v1`; documented contracts | PASS | PASS — 2 new operations + additive schema changes in `contracts/openapi.yaml`; file handling only in `StorageService` |
| IV. Pluggable transcription | Providers unchanged; failures don't touch notes | PASS | PASS — no provider changes; `prepare` stats size before reading (I8); existing "too long" error path |
| V. UI quality | shadcn, taste-skill, tokens, keyboard, AA | PASS | PASS — `contracts/ui-import.md`; "Imported" badge + "Imported/Recorded" date text; drag-and-drop has a keyboard equivalent; live-region announcements |
| VI. Testing | Endpoint tests; critical flows stay green | PASS | PASS — contract test per new operation/error; integration tests listed in research I14, including import → transcribe → append (extends critical flow 2) |
| VII. Simplicity | No new infrastructure/dependencies | PASS | PASS — no new packages; one new domain module; reuse of `recordings` and `create_note` |

**Notes**

- `StorageService` gains a second narrow delete exception: `*.part` files inside `files/.uploads/`
  (request cleanup + startup sweep). It still never deletes folders or user content.
- `db/migrate.py` changes how *every* future migration runs (FKs off + `foreign_key_check`). This
  is the documented SQLite procedure and makes table rebuilds safe; the check aborts the upgrade
  rather than committing dangling references.

**Result**: all gates pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/006-session-file-import/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · ui-import.md
├── checklists/requirements.md
└── tasks.md                (next: /speckit-tasks)
```

### Source Code (changes)

```text
backend/src/unihelper/
├── db/migrate.py                         # FKs off during upgrade + foreign_key_check (I2)
├── db/migrations/versions/0008_recording_origin.py
├── models/recording.py                   # origin, original_file_name, wider mime CHECK
├── domain/audio_probe.py                 # NEW: format sniff + duration (I4)
├── storage/storage_service.py            # staging: open_upload/commit_upload/discard, sweep_uploads,
│                                         #   free_space; delete_content_file accepts new extensions
├── services/recording_service.py         # import_audio(); view() adds origin fields; per-row extension on rename
├── services/note_service.py              # import_replace(); NUL check in create_note
├── services/transcription_service.py     # prepare(): stat before read for non-WebM (I8)
├── schemas/recordings.py · schemas/notes.py
├── api/v1/recordings.py                  # POST /sessions/{key}/recordings/import (async, streamed)
├── api/v1/notes.py                       # PUT /notes/{id}/import-replace
└── main.py                               # lifespan: sweep stale .uploads/*.part
backend/tests/
├── audio_fixtures.py                     # generated WAV/FLAC/OGG/ADTS bytes (+ 2 tiny real MP3/M4A)
├── unit/test_audio_probe.py
├── contract/test_recording_import.py · contract/test_note_import_replace.py
└── integration/test_import_flow.py · integration/test_migration_0008.py

frontend/src/
├── features/imports/                     # NEW module
│   ├── audioFiles.ts                     # extension/size pre-checks, browser duration probe
│   ├── importQueue.ts                    # singleton upload queue (XHR, concurrency 2, cancel, retry)
│   ├── UploadAudioButton.tsx · AudioDropZone.tsx · UploadList.tsx
│   ├── noteFiles.ts                      # read + validate .md/.txt (fatal UTF-8, BOM, NUL)
│   ├── noteImport.ts                     # per-file run: create → conflict → rename/replace/skip
│   ├── ImportNoteButton.tsx · NoteConflictDialog.tsx · ReplaceConfirmDialog.tsx
│   ├── ImportSummaryDialog.tsx
│   └── routes.tsx                        # beforeunload + sign-out guard while uploads run
├── features/recordings/RecordingPanel.tsx  # Upload button, drop zone, upload rows, Imported badge/date text
├── features/recordings/Player.tsx        # format-specific "can't play" message for imports
├── features/recordings/api.ts            # importAudio() via XHR
├── features/sessions/NoteList.tsx        # Import note button; Alt+Shift+N
├── features/sessions/api.ts              # importReplaceNote()
├── features/sessions/autosave.ts         # NoteSaver.adoptServerReplace + listener (I11)
└── lib/api/schema.d.ts                   # regenerated (pnpm gen:api)
frontend/tests/
├── unit/import-queue.test.ts · unit/note-files.test.ts · unit/note-import.test.tsx
└── e2e/import.spec.ts

specs/003-session-audio-recording/contracts/openapi.yaml   # Recording gains origin fields (cross-ref 006)
```

**Structure Decision**: a new `features/imports` frontend module that plugs into the existing
`RecordingPanel` and `NoteList` (both get a button slot and render import state), mirroring how 004
attached to recordings through `extensions.ts`; backend changes stay inside the existing
recordings/notes services, with one new pure domain module.

## Phase 0 — Research

Complete: [research.md](./research.md) (I1–I14). No NEEDS CLARIFICATION remained in the spec;
defaults chosen there (1 GB, 5 MB, six formats, import date, auto-suffix, permanent Replace) are
carried through unchanged.

## Phase 1 — Design & Contracts

Complete: [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-import.md](./contracts/ui-import.md), [quickstart.md](./quickstart.md).
Post-design Constitution Check: PASS.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Table rebuild in 0008 cascade-deletes transcription jobs | FKs off during migration + `foreign_key_check`; dedicated migration test on a populated 0007 DB; back up `app.db` before upgrade (startup already single-process) |
| Header probe accepts a file that won't actually play | Probe checks structure beyond magic bytes (valid frame/box/page headers, non-zero duration); player already shows a playback error state; user can delete it |
| Probe rejects a valid but unusual file (e.g., MP3 with huge ID3 art, `moov` at end of a large M4A) | Probe seeks rather than reads sequentially; tests with real phone/recorder files; client duration as fallback |
| Large upload exhausts disk mid-stream | Up-front free-space check; `ENOSPC` aborts and deletes the `.part` |
| Server restarted during an upload leaves `.part` files | Startup sweep of `.uploads/*.part` older than 1 h |
| Large non-WebM import loaded into memory for transcription | `prepare` stats first; files over the provider limit fail before reading; no-limit providers read once as today (documented; ≤ 1 GB) |
| Browser can't decode a valid format (Safari + OGG/FLAC) | Pre-upload probe failure is not a rejection; the existing Player error state names the format (ui-import.md) and Transcribe still works |
| Replace races a transcript append or an editor save | `note_file_lock` + `If-Match` + active-job check on the server; client unsaved-edits guard; 412/409 surface as "nothing was replaced" |

## Complexity Tracking

None — no constitution violations.
