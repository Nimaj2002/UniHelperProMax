# Validation Record: Session Audio Recording & Playback (003)

**Date**: 2026-10-05

## Automated checks

| Check | Result |
|---|---|
| `ruff check` / `ruff format --check` | ✅ |
| `mypy` (strict, 69 files) | ✅ |
| `pytest` (unit, contract, integration) | ✅ 187 passed; coverage guard: every operation in all three feature contracts exercised with a 2xx |
| `eslint .`, `tsc -b` | ✅ |
| `vitest` | ✅ 262 passed (adds recorder, uploader, player with axe) |
| `playwright` light + dark | ✅ 24 passed (001 + 002 + 003 flows; Chromium fake microphone) |
| Production build | ✅ (main bundle 276 kB gzip; existing >500 kB chunk warning) |

## Quickstart scenarios → evidence (automated)

- [x] 1 Record, stop → "Recording HH:MM", duration, file in `audios/` that plays and seeks — `e2e/recording.spec.ts`, `integration/test_record_save_flow.py`, `unit/test_webm.py`
- [x] 2 Upcoming session can record — `contract/test_recordings.py::test_upcoming_session_records_and_timeline_counts_audio`
- [x] 3 Permission denied → nothing created — `unit/recorder.test.ts` (state + no server call); the panel's message text has no automated test
- [x] 4 Reload mid-recording → "Recovered (interrupted)", plays — `e2e/recording.spec.ts`, `integration/test_recording_recovery.py`, `unit/recorder.test.ts`
- [x] 5 Offline → "Upload pending" → complete, no gap — `e2e/recording.spec.ts`, `unit/uploader.test.ts`, `contract/test_recordings.py` (`chunk_gap`)
- [x] 6 Navigate to the calendar while recording, Stop from the bar — `e2e/recording.spec.ts`
- [x] 7 Player: play/pause/stop, seek, ±5 s clamped, keyboard, one at a time, volume/mute remembered — `unit/player.test.tsx`, `e2e/recording.spec.ts`, `contract/test_preferences.py`
- [x] 8 Rename / delete; blocked while recording — `contract/test_recordings_manage.py`
- [x] 9 Second window sees the active recording — `contract/test_recordings.py` (`GET /recordings/active`, 409 `recording_in_progress`)
- [x] 10 Timeline audio indicator — `contract/test_recordings.py::test_upcoming_session_records_and_timeline_counts_audio`
- [x] 11 Keyboard + themes + axe — E2E in light and dark; axe while recording and with the player open

Not yet done: a manual check with a real microphone, and a desktop-player check of a long
(≥ 1 h) recording.
- **SC-004** (manual check) — record or import a 4-hour recording into a session, play it from
  the start, then seek to the middle and to the last minute; each seek must start playback
  within 2 seconds, and playback must reach the end.

Success criteria without automated evidence (to be verified by hand, analysis 2026-10-06):
SC-001 (start within 1 s), SC-002 (repeated crash tests on recordings of 5 min or more),
SC-003 (30-minute recording without gaps), SC-004 (see above),
SC-005 (playing every file in an external player), SC-006 (15-minute network outage).

Open findings from the 2026-10-06 analysis that need code changes are tracked outside this
record (second tab/window handling, sign-out with pending uploads, sleep detection, busy
microphone message, Safari recovered duration, IndexedDB failures, badge flicker).

## Bugs found and fixed during implementation

- The shadcn `Slider` put `aria-label`/`aria-valuetext` on the Radix root, but `role="slider"`
  is on the thumb, so the Seek and Volume sliders had no accessible name. The labels are now
  forwarded to the thumb, and the E2E axe scan also runs with the player open.
- Ruff reformatting made some scripted edits apply silently to stale text (router registration,
  timeline audio count); found by the contract coverage guard and fixed.
