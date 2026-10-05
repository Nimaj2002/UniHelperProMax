# Implementation Plan: Session Audio Recording & Playback

**Branch**: `003-session-audio-recording` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-session-audio-recording/spec.md`

## Summary

Record lectures from any session's right panel with MediaRecorder; every 5 s the audio chunk is
stored in IndexedDB and appended to the session's `audios/<name>.webm` file on the server, so a
crash, reload or network loss loses at most a few seconds and pending audio is delivered later.
Recording is a singleton outside React and continues across the whole app with a global recording
bar. On stop (or when found interrupted) the server finalizes the WebM with a duration and a cue
index so long recordings play and seek instantly with HTTP Range streaming. Recordings can be
renamed and deleted; a player offers play/pause/stop, seek, ±5 s and remembered volume.

## Technical Context

**Language/Version**: Python 3.12+, TypeScript 5.9 / React 19 — as 001/002

**Primary Dependencies**: no new backend packages (pure-Python EBML in `domain/webm.py`);
frontend adds shadcn `Slider` (Radix) only. Browser APIs: MediaDevices, MediaRecorder,
Web Audio `AnalyserNode`, IndexedDB, StorageManager.

**Storage**: table `recordings` (revision `0005_recordings`); audio files in
`files/<user>/<Year>/<Semester>/<Course>/<class_date>/audios/`; client IndexedDB `uh-recordings`.

**Testing**: pytest (EBML unit tests on generated WebM, chunk/finalize contract tests, the
Constitution VI critical-flow integration test "record → save", including crash recovery);
Vitest (recorder state machine with fake MediaRecorder, upload queue with fake IndexedDB, player);
Playwright with Chromium's fake microphone (record, reload mid-recording, offline, seek).

**Target Platform**: evergreen desktop browsers (Chrome/Edge/Firefox record WebM/Opus, Safari
records MP4/AAC); unsupported browsers see an explanatory message.

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: recording starts < 1 s (SC-001); ≤ 10 s lost on crash (SC-002, design
≤ 5 s); continuous recording while typing (SC-003); 3 h playback seeks < 2 s (SC-004); recordings
≥ 4 h supported (FR-021).

**Constraints**: Constitution I (progressive persistence, confirmed deletes), II (standard audio
files in `audios/`), III (all via `/api/v1`), V (keyboard, AA, state not by colour), VII (SQLite
only, no ffmpeg/background services).

**Scale/Scope**: one active recording per user; chunks ≤ 10 MB (5 s ≈ 30 KB); files ≤ ~100 MB.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 003 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Progressive persistence; crash/close/offline keep audio; confirmed deletes | PASS | PASS — 5 s chunks → IndexedDB → fsync'd append; recovery worker on next start; stale → interrupted, never discarded; delete only after AlertDialog; in-progress recordings can't be deleted |
| II. Data ownership | Standard audio files in `audios/` | PASS | PASS — WebM/Opus (`.webm`) or MP4/AAC (`.m4a`); finalize only adds standard Duration/Cues elements |
| III. Separation | UI only via `/api/v1` | PASS | PASS — 8 paths in `contracts/openapi.yaml`; only `StorageService` writes files |
| IV. Pluggable transcription | Untouched | N/A | N/A (004 reads recordings through the API) |
| V. UI quality | shadcn, taste-skill, tokens, keyboard, AA | PASS | PASS — `ui-recording.md`; status text + icon, not colour; player keyboard map |
| VI. Testing | Endpoint tests; **record → save** integration test | PASS | PASS — contract tests per path; `integration/test_record_save_flow.py` (chunks → file → finalize → playable/seekable, crash → interrupted → late chunks) |
| VII. Simplicity | No new infrastructure | PASS | PASS — no ffmpeg, no queue/worker process; one new UI primitive |

**Note**: `StorageService.delete_note_file` becomes `delete_content_file` (notes `.md` and audio
`.webm`/`.m4a` in their folders only) — the spec requires deleting a recording's file (FR-015).

**Result**: all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/003-session-audio-recording/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · ui-recording.md
└── tasks.md
```

### Source Code (changes)

```text
backend/src/unihelper/
├── domain/webm.py                       # EBML read/write: duration, cues, finalize
├── models/recording.py · db/migrations/versions/0005_recordings.py
├── storage/storage_service.py           # + append_bytes (fsync), delete_content_file, open path
├── services/recording_service.py        # start, chunks, stop/finalize, stale detection, rename, delete
├── services/timeline_service.py         # audio_count
├── services/workspace_service.py        # player preference keys
├── schemas/recordings.py · api/v1/recordings.py
backend/tests/{unit/test_webm.py, contract/test_recordings*.py, integration/test_record_save_flow.py}

frontend/src/
├── components/ui/slider.tsx             # shadcn
├── features/recordings/
│   ├── routes.tsx                       # registers workspace panel, activity bar, sign-out guard, recovery
│   ├── api.ts · chunkStore.ts (IndexedDB) · uploader.ts · recorder.ts (singleton controller)
│   ├── RecordingPanel.tsx · RecordingList.tsx · RecordingBar.tsx · LevelMeter.tsx
│   ├── Player.tsx · nowPlaying.ts · RecordingDialogs.tsx
│   └── recovery.ts                      # resume uploads + final stop after crash
└── app/shell/registry.ts                # + registerSignOutGuard
frontend/tests/{unit/recorder.test.ts, uploader.test.ts, player.test.tsx, e2e/recording.spec.ts}
```

**Structure Decision**: new `features/recordings` module plugging into the 002 workspace panel
registry and the 001 shell activity registry.

## Phase 0 — Research

Complete: [research.md](./research.md) (A1–A9).

## Phase 1 — Design & Contracts

Complete: [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-recording.md](./contracts/ui-recording.md), [quickstart.md](./quickstart.md).
Post-design Constitution Check: PASS.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| WebM rewrite corrupts a file | Pure functions tested on generated and real (Chromium) recordings; rewrite is atomic; original kept if parsing fails (finalize is best-effort, file stays playable) |
| Browser throttles timers in background tabs | MediaRecorder emits chunks independent of timers; uploads are promise-driven |
| Chrome fake mic differs from real devices | E2E covers the pipeline; manual check with a real microphone listed in validation |
| IndexedDB unavailable (private mode) | Fall back to in-memory queue + warning that crash protection is reduced |

## Complexity Tracking

> No violations.
