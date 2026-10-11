# Quickstart & Validation: Calendar Events and Quick Create (009)

Setup as in `README.md`. Contracts: [openapi.yaml](./contracts/openapi.yaml),
[ui-calendar.md](./contracts/ui-calendar.md). Data: [data-model.md](./data-model.md). Decisions:
[research.md](./research.md).

## Automated

```bash
cd backend && uv run pytest                       # contract (all 009 operations) + integration (incl. migration 0010)
cd backend && uv run python -m unihelper.export_openapi ../frontend/openapi.json
cd frontend && pnpm gen:api && pnpm typecheck && pnpm lint && pnpm test
cd frontend && pnpm e2e tests/e2e/events.spec.ts tests/e2e/quick-create.spec.ts tests/e2e/trash.spec.ts
```

Critical flows that must stay green (Constitution VI): `test_record_save_flow`,
`test_recording_recovery`, `test_transcribe_append_flow`, `test_recurring_class_creation`.

## Manual scenarios

| # | Scenario (spec ref) | Expected |
|---|---|---|
| 1 | Course "Calculus" (Fall 2026) open → New event "AI Seminar", Thu 14:00–15:30, room, link (US1) | Semester preselected; blue Event block with icon in day/week/month; absent from Calculus timeline and counts |
| 2 | New event weekly on Thu until semester end (US1) | Appears every Thu to the semester end |
| 3 | Event overlapping a class and another event (US1, FR-008) | Three blocks side by side, each focusable, tooltip with full title on hover and focus |
| 4 | Open the past seminar, write a note, record 10 s, upload a PDF (US2) | Files in `<user>/2026/Fall 2026/_Events/2026-10-15 AI Seminar/{notes,audios,documents}` |
| 5 | Left card → Fall 2026 → Events (US2) | Timeline in date order; upcoming muted with "Upcoming" badge |
| 6 | Create a course named `_events` or `_Events.` (US2) | Refused: "`_Events` is reserved for events" |
| 7 | Weekly event, add a note to week 3, edit "All events" title (US3) | Week 3 keeps its title; dialog "1 … left unchanged" |
| 8 | Change the semester of an event with a note (US3) | Semester field disabled with the reason |
| 9 | Delete the seminar (with content) (US3, US4) | Dialog lists counts and Trash; event gone from calendar; files still on disk; listed in Settings → Trash → Deleted events |
| 10 | Restore it (US4) | Back on the calendar with note, recording, PDF; same folder |
| 11 | Delete semester Fall 2026, then restore one class from the Trash (US4, FR-022a/b) | One Trash entry per class/event; restore recreates 2026 / Fall 2026 / course by name |
| 12 | Trash → Delete → No, then Delete → Yes (US4) | No: nothing changes. Yes: entry gone, its folder removed from disk, other folders untouched |
| 13 | Week view: press Tue 13:00, drag to 14:45, cross into Wed, near bottom edge (US5) | Label updates; stays in Tue; grid scrolls; release opens quick form |
| 14 | Escape during drag; drag across an existing class (US5) | Nothing left; class stays visible beside the draft |
| 15 | Click (no drag) at 10:20; month view click on an empty day (US5) | 10:15–11:15 draft; 09:00–10:00 draft for that date |
| 16 | Quick form: Event "Study group", change end time, Save, then Undo (US6) | Draft resizes live; entry created in place; Undo within 10 s removes it and nothing else |
| 17 | Quick form: Class with a new course "Robotics" (US6) | Year/Semester requested; class titled "Robotics" |
| 18 | Type a title then click outside; with empty form click outside (US6) | Stays open; discarded |
| 19 | Stop the backend, Save (US6) | Form keeps values, shows error; Save works after restart |
| 20 | More options / Repeat → Custom (US6) | Full form with every entered value |
| 21 | Keyboard only: focus grid, arrows, Shift+↓ ×3, Enter, fill, Save (US7) | Screen reader hears "New entry, from 10:00 to 11:00"; focus in form, then back on the grid |
| 22 | Dark theme, a custom theme, reduced motion (FR-045) | Event marker visible; draft readable; no animation; axe AA passes |

## Validation results (2026-10-11)

Final runs: backend `uv run pytest` 549 passed (contract coverage guard included), `ruff check`,
`ruff format --check` and `mypy` clean; frontend `pnpm test` 588 passed, `pnpm typecheck` and
`pnpm lint` clean; full `pnpm e2e` 120 passed, 4 failed, 4 skipped — the 4 failures (two
`transcription` and `calendar-performance` in dark, `quick-create-performance` in light) were
timeouts or a blank page from the dev server and passed when re-run on their own (see
`specs/KNOWN-ISSUES.md`, "Flaky end-to-end tests").

| # | Verified by |
|---|---|
| 1 | e2e `events.spec.ts` US1 (preselection, marker, not on the course page); contract `test_sessions_events.py` (counts) |
| 2 | e2e `events.spec.ts` US1 (weekly every Thursday); contract `test_create_event_weekly_until_semester_end` |
| 3 | e2e `events.spec.ts` US1 overlap test; `a11y-themes.spec.ts` 009 (tooltip on focus) |
| 4 | e2e `events.spec.ts` US2; integration `test_event_content_lands_under_events_folder` |
| 5 | e2e `events.spec.ts` US2; contract `test_semester_events_timeline` |
| 6 | e2e `events.spec.ts` US2; contract `test_hierarchy.py`; unit `test_event_naming.py` |
| 7 | e2e `events.spec.ts` US3; contract `test_series_edit_leaves_occurrences_with_content_unchanged` |
| 8 | e2e `events.spec.ts` US3; contract `test_change_semester` |
| 9 | e2e `events.spec.ts` US3 and `trash.spec.ts`; integration `test_delete_moves_to_trash` |
| 10 | e2e `trash.spec.ts` US4; integration `test_restore_after_delete_is_exact` |
| 11 | e2e `trash.spec.ts` (semester); integration `test_hierarchy_delete_trash.py` |
| 12 | e2e `trash.spec.ts` (No, then Yes; files checked on disk); integration `test_permanent_delete_removes_only_that_folder` |
| 13 | e2e `quick-create.spec.ts` drag test (label, start day kept); auto-scroll near the edge checked only in unit `draft.test.ts`, not end to end |
| 14 | e2e `quick-create.spec.ts` (Escape mid-drag); overlap with an entry in unit `overlap-layout.test.ts` |
| 15 | e2e `quick-create.spec.ts` (click → 1 h snapped; month click 09:00–10:00) |
| 16 | e2e `quick-create.spec.ts` drag test (live time edit, Undo) |
| 17 | e2e `quick-create.spec.ts` new-course test (same entry as the full form) |
| 18 | e2e `quick-create.spec.ts` discard test (incl. a click on an existing entry keeps a filled form) |
| 19 | e2e `quick-create.spec.ts` discard test — the failure is simulated with a 500 response, not by stopping the backend |
| 20 | unit `quick-create.test.tsx` (router state carries every value); e2e new-course test uses More options |
| 21 | e2e `quick-create.spec.ts` US7 (live-region text and focus); not checked with a real screen reader |
| 22 | e2e `a11y-themes.spec.ts` 009 (axe AA in light, dark, a preset and a user theme; no running animation under reduced motion) |

Performance (SC-003): `quick-create-performance.spec.ts` — no long task and no frame gap over
100 ms while dragging in a week with 50 entries; `GET /sessions` for that week under 300 ms.
