# Quickstart: validating the Task Manager and Home Page Panels

How to prove feature 012 works end to end. Contracts: [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-home-tasks.md](./contracts/ui-home-tasks.md); data: [data-model.md](./data-model.md);
decisions: [research.md](./research.md).

## Prerequisites

- No new packages (backend or frontend).
- Migration `0012_tasks` applied (runs on startup).
- Frontend API types regenerated after the backend changes (`cd frontend && pnpm gen:api`).
- A user with: one semester, two courses (one with a distinctive color), one weekly class, one
  single event and one weekly event; time zone `Europe/Istanbul`.

## Automated checks

```bash
cd backend
uv run pytest tests/unit -k "task"
uv run pytest tests/contract/test_tasks.py tests/contract/test_task_columns.py tests/contract/test_quick_notes.py \
              tests/contract/test_trash.py tests/contract/test_sessions_events.py tests/contract/test_hierarchy_manage.py \
              tests/contract/test_coverage.py
uv run pytest tests/integration/test_task_event_links.py tests/integration/test_task_trash.py \
              tests/integration/test_task_course_delete.py tests/integration/test_migration_0012.py \
              tests/integration/test_account_isolation.py
uv run pytest            # full suite incl. critical flows (Principle VI)
uv run ruff check . && uv run mypy

cd ../frontend
pnpm typecheck && pnpm lint && pnpm test
pnpm exec playwright test tests/e2e/home-panels.spec.ts tests/e2e/tasks-board.spec.ts \
     tests/e2e/tasks-list-details.spec.ts tests/e2e/tasks-events-calendar.spec.ts tests/e2e/a11y-themes.spec.ts
```

Expected: all green; the coverage guard reports the 19 new operations documented and exercised;
axe finds no violations on the home page, details sheet and quick-note pop-up in light, dark and
one custom theme.

## Manual scenarios (1366 × 768 unless stated)

1. **First use, panels (Stories 8–10)**: sign in → "/" shows left card, Calendar panel and Tasks
   panel (~420 px) as three bordered cards; one 40 px header each, no other bar. Close Tasks →
   44 px rail "Tasks", count "0", focus on the rail button, "Tasks closed" announced. Close
   Calendar is now disabled with "At least one panel stays open"; Shift+C announces the same.
   Shift+T reopens Tasks; focus lands on its first header control.
2. **Board (Story 1)**: three columns To do / In progress / Done. "New task" → type "Read ch. 4"
   → created in To do. Add "Problem set 3", due Friday 23:59, course Linear Algebra → card shows
   course chip, "Fri 23:59", no "Overdue". Drag it to In progress, then to the top of To do;
   reload → order kept. Focus a card, Enter, → , ↓, Enter → moved; again Enter, →, Escape →
   back in place; each step announced. Drag and release after moving 2 px → details open (click).
   Drag toward the right edge of a narrow panel → board scrolls; in a column with 30 tasks drag to
   the bottom edge → column scrolls. Start a drag, press Escape → card returns.
3. **Columns (Story 2)**: add "Waiting", rename to "waiting" in another column → "already exists";
   move it before Done with the keyboard; mark it "Counts as done" → its tasks show completion;
   delete it while it holds tasks → asked where to move them; delete the last column → disabled.
   Add columns up to 12 → 13th refused.
4. **Details, quick notes, Undo (Story 3)**: open a task → sheet covers the Tasks panel; edit the
   description → "Saving…" → "Saved". Stop the backend, edit → "Couldn't save — Retry"; Back →
   warning, text kept; restart, Retry → "Saved". Add a checklist of 3, tick 1 → card "1/3".
   Quick-note button → pop-up inside the panel; add two notes; delete one → Undo restores it;
   Escape → focus back on the card. Delete the task → Undo within 10 s restores position,
   checklist and notes.
5. **List and filters (Story 4)**: switch to List → groups Overdue/Today/This week/Later/No date,
   Done collapsed; filter by course, by "Personal", "Event-linked only", search "lab", hide Done;
   reload → same view and filters; Filter button shows the active count.
6. **Events (Story 5)**: quick-create an event with "Add to kanban" (column In progress) → task
   appears linked (Event marker), title/due read-only with "Edit event". Undo the creation → task
   gone too. Create a weekly event with the switch on → helper text; only the first occurrence
   has a task; add another occurrence from its details. Edit the event time with "This event" →
   task due follows; change the series' weekday with "All" → linked occurrence still linked or,
   if dropped, task unlinked with its last date. Delete the event with "Delete with the event" →
   task gone; Settings → Trash shows "1 task"; Restore → event and linked task back. Delete
   another with the default → task stays, unlinked. "Open note" on a linked card → event
   workspace (first note created); browser Back → home exactly as left.
7. **Calendar (Story 6)**: "Show tasks" off → no markers. On → timed task as a checkbox marker at
   its time, date-only in the strip under the day header, month cells list them; tick → task in
   Done (dimmed), untick → back to its previous column. 15 tasks on one day → "+N more"; every
   class/event block keeps its width. The linked event shows "On board" in both switch states.
8. **Course page (Story 7)**: open Linear Algebra → "Tasks" lists its open tasks; quick add →
   course preselected; activate a task → "/" with its details open in the Tasks panel; Back →
   course page. Delete the course → dialog says "2 tasks will become personal tasks"; afterwards
   they show no course. Settings → Export tasks → CSV opens in a spreadsheet with all columns and
   Turkish characters intact.
9. **Width rules (Stories 11–12)**: drag the divider beyond limits → stops at 320 px and at 60 % /
   Calendar 480 px; arrow keys/Home/End on the divider; reload → width kept. Resize the window to
   900 px → Tasks closes to its rail with a notice; open Tasks → Calendar closes with a notice.
   At 1024 px first use (clear localStorage) → Calendar open, Tasks rail.
10. **Focus and navigation (Story 13)**: focus mode (`\`) → left card and rails hidden, open panels
    stay; again → all back. Scroll the board and the week grid, open a course page, come back →
    same open state, widths and scroll positions. Course pages and session workspaces look as
    before.
