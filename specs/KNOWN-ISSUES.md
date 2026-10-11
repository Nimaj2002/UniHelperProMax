# Known issues

Problems that are known but not fixed yet, grouped by the batch planned to fix them. Each entry
says what goes wrong, when, and where in the code. Move an entry into the feature's `tasks.md`
when its batch is scheduled.

## Batch B

### Renaming or deleting a note while a transcript is being appended (found 2026-10-06, 004 T035)

`note_service.rename_note` and `note_service.delete_note` change the note's file without taking
`note_file_lock`, the per-note lock that saves and transcript appends now hold (004-D1).

- **Rename during an append**: the append may write to the old file path after the rename moved
  the file. The transcript then lands in a new file with the old name that the app doesn't list,
  and the renamed note doesn't contain it.
- **Delete during an append**: if the file is deleted between the append's check and its write,
  the append recreates the file with just the transcript, then fails to update the deleted note
  row, so the job ends `failed` ("unknown") and the file is left in `notes/` without a note in the
  app. **Retry** then puts the transcript in a fallback note, so it exists twice. If the delete
  commits just before the append takes the lock, the job fails the same way but writes nothing,
  and Retry works. (A delete before the job reaches the append is handled: fallback note, FR-011.)

**When**: only if the rename or delete request arrives within the few milliseconds of the
append itself. The provider call that comes before it takes much longer and isn't affected.

**Fix**: take `note_file_lock(note_id)` in `rename_note` and `delete_note` too, committing under
it as `save_content` does. **Test**: the same interleaving as
`test_save_racing_an_append_keeps_the_transcript` in
`backend/tests/integration/test_transcribe_append_flow.py`, pausing the rename or delete
inside its file operation while `append_result` runs.

## Not scheduled

### Flaky end-to-end tests (found 2026-10-11, 009 T075)

- **`frontend/tests/e2e/annotations.spec.ts`**: a different test fails on some runs (timeouts
  waiting for the PDF reader, or "two windows editing the same comment"). It predates 009: on a
  clean checkout of `6ed05df` (before 009) one of three runs of the spec failed
  ("US6: by keyboard — …", element not visible), the other two passed.
- **Dev-server hiccups during the full suite**: in long `pnpm e2e` runs a page sometimes stays
  blank because the Vite dev server fails to deliver a module (`ERR_NETWORK_CHANGED`, or module
  requests aborted), or a request times out after 60 s. Seen in `a11y-themes`, `transcription`,
  `calendar-performance` and `quick-create-performance`; each passed when re-run on its own.

**When**: only in Playwright runs, more often in the full 45-minute suite on WSL `/mnt/c`.

**Fix**: not investigated yet. Running the suite against the production build
(`pnpm build` + the backend serving `UNIHELPER_STATIC_DIR`) would rule out the dev server.
