# Quickstart: validating Study Time Tracking

## Prerequisites

- Backend: `cd backend && uv run alembic upgrade head` (applies `0017_time_tracking`).
- Run the app the usual way (`./start.sh`, or the desktop dev app).
- Tests: `cd backend && uv run pytest tests/contract/test_time_*.py tests/integration/test_time_*.py tests/unit/test_time_state_machine.py`;
  `cd frontend && pnpm vitest run src/features/time` and `pnpm playwright test time`.

## Scenarios

1. **Track survives everything** (US1, SC-002): start a Track timer, close the window, wait
   2 min, reopen; elapsed is ≈ 2 min in two windows at once. Stop → one entry in Today.
2. **Short run** (FR-011): start and stop within 3 s → "Not saved (under 5 seconds)" with Undo;
   Undo brings the timer back with its original start.
3. **Replace + undo** (FR-010): start A, then start B from a second window → A saved, B
   running, message with Undo; Undo → A running again, A's entry gone.
4. **Offline stop** (FR-012, SC-003): stop the backend, press Stop → "Not saved yet —
   retrying"; start the backend → the entry is saved with the moment Stop was pressed.
5. **Pomodoro settle** (US4, FR-025): set work to 1 min, start, close all windows for 2 min,
   reopen → "Work 1 finished at hh:mm", entry ends at the planned end, timer waits for Start.
6. **Hidden-window alert** (SC-004): 1-minute work phase, minimise the window → sound and
   system notification within 2 s of the end.
7. **Focus + layout** (US5): Focus 1 min with "Hide panels while focusing" → side cards hide;
   +5 min; Finish → entry saved, layout restored.
8. **Indicator** (US3, US9): with a recording running, try each `indicator_combo`; stopping
   either never affects the other; the pill hides while the timer card is visible.
9. **Tags** (US6): create "Homework", try "homework" (refused), rename, delete with 2 entries
   ("2 entries use this tag") → entries untagged.
10. **Calendar** (US7): entry 23:00–01:00 shows one hour on each day; overlapping entries side
    by side in the lane; pressing the lane creates nothing; "Show time" off hides only entries.
11. **Reports** (US10, SC-005): with known entries, totals and percentages per grouping match;
    a 2 % tag is in "Other" in the chart only; works at 320 px with the table first.
12. **Backup** (R9): back up and restore an account; tags, entries and the running timer return.
13. **Accessibility** (SC-006): axe passes for Time mode, pill, lane and reports in light and
    dark; everything reachable by keyboard.
