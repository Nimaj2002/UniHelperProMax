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

### Calendar import: what is deferred (010)

- **All-day and multi-day events** are skipped ("all-day events are not supported yet"): the app's
  entries have start and end times on one day.
- **Daily rules** (`FREQ=DAILY`) are reported as not supported, as the spec says, even when they
  could be written exactly as "weekly on every day". Easy to add in `domain/ical_rules.parse_rule`
  if wanted.
- **Interoperability is checked by hand**: the import into Google Calendar, Apple Calendar and
  Outlook of an exported file (quickstart scenario 6) needs those apps; results are recorded in
  `specs/010-calendar-ics-import-export/checklists/interop.md`.

### Task manager and home panels: open items (012, found 2026-10-16)

- **Crowded overlaps in a narrow Calendar panel**: with the Tasks panel open at 1366 px, a week
  column is about 80 px wide. When many entries overlap (seen in the full e2e run, where specs
  share one database and pile events on Monday 10:00), each lane gets narrower than an event
  block's padding and border (about 16 px). The blocks then spill into each other, and the
  covered one can't be clicked at its centre. Lanes come from `calendar/layoutOverlaps.ts`
  (`TimeGrid.tsx` `ColumnEntries`). **Fix idea**: past a lane count that no longer fits, show
  "+N" like the month view. `calendar-navigation.spec.ts` US2 and `a11y-themes.spec.ts` "across
  screens" now start with Tasks closed, as `quick-create.spec.ts` does.
- **300-task filter timing is borderline**: `tasks-board.spec.ts` "SC: with 300 tasks…" measured
  101 ms against the 100 ms limit (SC-006) once, in the dark project of the full WSL run, and
  passed on reruns. **Fix idea**: memoize the filtered column lists in `board/Board.tsx`, or
  measure with the production build.
- **E2E specs broken before 012** (left unchanged by this feature):
  - The notes, documents, events US2, import, layout US1/US4/SC-002, notes-resilience,
    recording, transcription and workspace-switch specs wait for `.cm-content` in
    `tests/e2e/notes-helpers.ts`. That is the old CodeMirror editor, which commit 9744665
    replaced with MDXEditor.
  - `annotations.spec.ts`, `documents.spec.ts` and `a11y-themes.spec.ts` (007) wait for
    `getByTestId("reader-status")`. Commit cbd1be9 ("Move from pdf-json to embedPDF") removed
    that test id.
  - `a11y-themes.spec.ts` (006) reports a colour-contrast violation in MDXEditor's own
    select (`._selectTrigger_…`) in a custom theme.
- **Unit test broken before 012**: `no-hardcoded-colors` flags `app/shell/MadeBy.tsx`
  (`text-red-500`, commit 17d5183).

## Found while building 013 (diagrams and math in notes)

- **Find in note and a read-only note mode don't exist** (since the editor switched to MDXEditor
  in commit 9744665). Spec 013 FR-016a (a find match inside a formula or diagram opens its
  source) and FR-035 (read-only mode draws but never edits) are built and unit-tested against
  hooks (`diagram-math/reveal.ts` `revealSource`/`conceal`, and `editor.isEditable()` checks with
  MDXEditor's `readOnly`). They can only be checked end to end once those features exist.
  **Fix idea**: a small spec for find in note (MDXEditor has no search plugin) and a read-only
  switch that passes `readOnly` to `MDXEditor`.
- **The conflict dialog doesn't open** when a note is changed outside the app while it's open.
  The save is refused (409) and the save state shows "Conflict", but `ConflictDialog` never
  appears. This happens with the 013 plugins switched off too (checked 2026-10-19), so it comes
  from the MDXEditor switch. `notes-resilience.spec.ts` would catch it once its `.cm-content`
  selectors are fixed. `diagrams-math.spec.ts` checks only the part 013 is responsible for: the
  outside version isn't overwritten, and the refused save kept formulas exact.
- **Diagram rendering off the main thread is Chromium-only.** The renderer frame is sandboxed
  with an opaque origin, and Chromium runs it in its own process, so slow Mermaid layouts don't
  block typing and the 5 s limit can stop them. Other browsers may run the frame on the main
  thread. Drawing is still queued one diagram at a time and the limit still applies, but a very
  slow diagram can make typing stutter there.
- **The note editor chunk grew 7.6 % (gzip, +20 KB)** with the 013 editor code (see
  `specs/013-note-diagrams-math/quickstart.md` "Measurements"). KaTeX, DOMPurify and Mermaid
  load only when needed. **Fix idea**: load `DiagramView`/`DecisionDialog`/`DiagramViewer`
  with `React.lazy`.
- **Typed `$x$` becomes a formula when the caret moves on**, not at the moment the closing `$` is
  typed. This is deliberate (so `$x$5` never flickers into a formula). It is listed here because
  it differs from editors that convert immediately.

## Found while building 022 (AI teacher)

### Reasoning models with a small output budget often answer nothing (found 2026-11-06, 022 T076)

Tested with `nvidia/nemotron-3.5-lightning:free` on an OpenAI-compatible server whose free tier
caps a reply at 2,000 output tokens. The model sometimes spends the whole budget on reasoning
and stops (`finish_reason: length`) before writing any answer.

- **Lessons**: in a 4-lesson run, 3 of 13 teacher replies had no answer. The run now ends as
  failed with "The model sent back no answer — it may have used all of its output on thinking"
  (`chat/runs.py`, `EMPTY_ANSWER`); the student sends again or picks another model. When replies
  did arrive, the method held: probing questions first in 4/4 lessons, and every reply after a
  wrong answer repaired the specific confusion in the student's thinking and ended with a new
  check question.
- **Knowledge graph**: every extraction with this model came back empty (`empty_reply`), so the
  graph stayed empty. The lesson is unaffected and the chat shows "Graph not updated — Retry".
- **Plans**: the model never wrote a `uh-plan` block, so the Plan button didn't appear.

**Fix (needs a spec decision)**: send a provider-specific "low reasoning effort" setting (for
example OpenRouter's `reasoning: {effort: "low"}`), or let Settings choose a separate model for
graph extraction. Both are beyond 022's spec. Until then, models without long hidden reasoning,
or with a larger output budget, work best for the teacher.
