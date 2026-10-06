# Validation Record: Transcribe Recordings into Notes (004)

**Date**: 2026-10-05

## Automated checks

| Check | Result |
|---|---|
| `ruff check` / `ruff format --check` | ✅ |
| `mypy` (strict, 81 files) | ✅ |
| `pytest` (unit, contract, integration) | ✅ 240 passed; coverage guard: every operation in all four feature contracts exercised with a 2xx |
| `eslint .`, `tsc -b` | ✅ |
| `vitest` | ✅ 301 passed (adds autosave append merge, transcribe dialog, status/notifier with axe) |
| `playwright` light + dark | ✅ 30 passed (001–004 flows; fake microphone + fake transcriber) |
| Production build | ✅ (main bundle 284 kB gzip; existing >500 kB chunk warning) |

## Quickstart scenarios → evidence (automated)

- [x] 1 Transcribe into a note with content; original bytes unchanged — `integration/test_transcribe_append_flow.py::test_transcribe_appends_without_touching_existing_bytes`, `e2e/transcription.spec.ts`
- [x] 2 Transcripts accumulate in completion order — same integration test (second recording)
- [x] 3 Open note with unsaved typing — typing kept, transcript appears without reload, no conflict dialog — `e2e/transcription.spec.ts` (US1), `unit/autosave-append.test.ts` (incl. racing saves)
- [x] 4 Session without notes → named new note created at once — `contract/test_transcription_lifecycle.py::test_new_note_is_created_before_queuing`, `e2e/transcription.spec.ts` (US2), `unit/transcribe-dialog.test.tsx`
- [x] 5 Duplicate / empty new note name refused — `contract/test_transcription_lifecycle.py`, `unit/transcribe-dialog.test.tsx`
- [x] 6 While running: buttons disabled everywhere, stage + progress + Cancel, activity bar — `e2e/transcription.spec.ts`, `unit/transcribe-dialog.test.tsx`, `unit/transcription-status.test.tsx`
- [x] 7 Job continues without the browser; notification on next visit — server-side worker (`test_background_worker_runs_jobs_on_its_own`), unseen/seen contract test, notifier unit test
- [x] 8 Provider failures → category, note unchanged, Retry; settings-related → Settings link — `contract/test_transcription_lifecycle.py::test_failures_leave_the_note_unchanged`, `unit/test_openai_client.py`, E2E (US2)
- [x] 9 Retry into the same note — `test_retry`, E2E
- [x] 10 Cancel appends nothing — `test_cancel_queued_and_finished`, `test_cancel_running_job_appends_nothing`, E2E
- [x] 11 Restart mid-job → resumed, appended exactly once — `test_restart_resumes_after_last_finished_part`, `test_restart_while_appending_appends_exactly_once`
- [x] 12 No provider configured → explanation + Settings link — `contract/test_transcription.py`, `unit/transcribe-dialog.test.tsx`
- [x] 13 History link; transcribing again warns — `test_session_history`, `unit/transcription-status.test.tsx`, `unit/transcribe-dialog.test.tsx`, E2E
- [x] 14 Target note deleted → fallback note — `test_deleted_target_note_gets_a_fallback`
- [x] 15 Long WebM split into parts, joined in order — `unit/test_webm_split.py`, `test_long_webm_is_split_and_joined_in_order`
- [x] 16 Recording delete refused while transcribing — `test_recording_delete_blocked_while_transcribing`
- [x] 17 Keyboard + themes + axe; key never in responses/logs — E2E (keyboard-only new-note path, axe with dialog and progress), `test_wrong_key_never_leaks`, `test_providers_and_status`

Not yet done: a check against a real OpenAI-compatible provider, and a ≥ 1 h real recording.
- **SC-003** (manual check, quickstart #18) — configure OpenAI-compatible with `whisper-1`, record
  (or use) a 1-hour WebM recording, start "Transcribe" and time it until the transcript appears
  in the note on a normal broadband connection; the target is 15 minutes or less. Record the
  measured time here.

Update 2026-10-06: Settings → Transcription now exists (feature 005), so the "Open Settings"
links work. The user confirmed transcription with a real local Voice Studio server. Two
follow-ups made that work: the connection test falls back to probing
`/v1/audio/transcriptions` when `/v1/models` doesn't exist, and the "unreachable" message
explains `localhost` when the server runs on another system (e.g. Windows vs. WSL). Open
findings from the 2026-10-06 analysis that need code changes (save/append race, activity-bar
Cancel, progress display, second-window and recovery merges, small UI items) are tracked
outside this record.

## Bugs found and fixed during implementation

- A save that raced a finished transcription would have opened the conflict dialog even though
  the server had only appended our transcript; the saver now waits briefly (only when a
  transcription targets that note) and merges it instead.
- Retrying a failed job reuses its id; the notifier had marked the id as handled, so the
  successful retry was never merged/announced — handled jobs are now keyed by id + attempt + status.
- The workspace's "open this note" link handling cancelled the initial tab-state load under
  React StrictMode's double effects; simplified to apply `?note=` while loading the tab state.
- A note's `version` changes on every content save (VersionMixin); the append result now returns
  the new version so an open editor's next save isn't rejected.
