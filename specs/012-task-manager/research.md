# Research: Task Manager and Home Page Panels

All Technical Context unknowns are resolved below. Format per decision: **Decision**,
**Rationale**, **Alternatives considered**. Paths are relative to the repo root.

## R1. Board drag-and-drop: own pointer hook, no new dependency

- **Decision**: Port the drag core of `design/reference/astryx-kanban-board.tsx` (pointer
  threshold, element registries, `getBoundingClientRect` hit-testing, flat-list rebuild) into
  `frontend/src/features/tasks/board/useBoardDrag.ts`, rebuilt on shadcn/ui and our tokens. Add
  what the template lacks: `setPointerCapture`, `pointercancel` / `lostpointercapture` / window
  `blur` → cancel, Escape → cancel, auto-scroll at board edges (horizontal) and column edges
  (vertical) using `edgeSpeed` from `features/calendar/draft.ts`, click vs drag via `isClick`
  (4 px, `CLICK_PX`), suppression of the click that follows a drag, rAF-throttled pointer updates.
  The ported file carries the MIT notice: "Portions adapted from Astryx, © Meta Platforms, Inc.,
  MIT License".
- **Rationale**: Constitution V (shadcn/ui base) and VII (no unjustified dependency). The template
  logic does not depend on Astryx/StyleX; `useGridDrag` already proves the cancel/auto-scroll
  patterns in this codebase.
- **Alternatives considered**: Installing `@astryxdesign/core` + StyleX (second token system,
  `data-theme` collision, beta library — rejected in the earlier analysis); `@dnd-kit` (a new
  dependency needing Complexity Tracking; our needs are one list-of-lists board, which ~300 lines
  cover).

## R2. Keyboard moving

- **Decision**: A separate reducer `features/tasks/board/keyboardMove.ts`: Enter/Space on a focused
  card picks it up (`aria-pressed` + announcement "Picked up X, position 2 of 5 in To do"),
  ArrowUp/Down move within the column, ArrowLeft/Right move to the neighbouring column at the
  nearest index, Enter drops (one move request), Escape restores. Columns use the same pattern
  on their header handle. The same reducer drives a ghost placeholder so pointer and keyboard
  look identical.
- **Rationale**: FR-016, SC-002; a pure reducer is unit-testable without DOM.
- **Alternatives considered**: Only menu-based "Move to" (template) — cannot reorder within a
  column; rejected by FR-016.

## R3. Order storage

- **Decision**: Integer `position` per column (tasks) and per board (columns). One endpoint moves a
  task: `POST /tasks/{id}/move {columnId, index}`; the server removes the task from its column,
  inserts at `index` in the target column, renumbers both columns 0..n-1, and records/clears
  `completedAt` by the target column's `countsAsDone`. Columns reorder with
  `PUT /task-columns/order {columnIds}` using the two-pass renumbering of
  `hierarchy_service._renumber_years` (negative then 0..n-1, `order_mismatch` 409).
- **Rationale**: Mirrors the existing year-order pattern; columns ≤ 12 and tasks per column small,
  so renumbering is cheap; index semantics match the template's `DropTarget`.
- **Alternatives considered**: Fractional/lexicographic ranks (no renumbering but drift and
  harder tests); client-sent full order arrays per column (racey with filtered views where hidden
  tasks exist — index is resolved against the *full* column on the server, see R11).

## R4. Linking a task to an event occurrence

- **Decision**: A task stores `event_key` = the existing session key `"{lineage_id}:{original_date}"`
  (stable across moves and series splits, `domain/recurrence.parse_session_key`) plus cached
  `title`, `due_date`, `due_time`. A partial unique index `(user_id, event_key)` where
  `event_key IS NOT NULL AND deleted_at IS NULL AND trash_entry_id IS NULL` enforces one task per
  occurrence (FR-038). A new `services/task_link_service.sync_lineage(db, user, lineage_id)`
  recomputes cached fields from the current `SessionView`s (title, effective date = moved date,
  start time) and is called after every event mutation: `event_service.apply_scope_edit`,
  `change_semester`, calendar import (`calendar_import_service`) and creation undo. If a linked
  key is no longer generated and not in the Trash (a recurrence change dropped it), the task is
  unlinked and keeps its last title and date.
- **Rationale**: Sync-on-write keeps `GET /tasks` a plain table read (SC-006) and makes SC-008 hold
  "within one refresh". Session keys never change, so links survive edits of any scope.
- **Alternatives considered**: Resolving links at read time (expands every linked lineage on each
  list — slower and couples tasks to recurrence expansion); freezing linked occurrences as
  `detached` like content (would change event behaviour on series edits, violating FR-057/FR-098).

## R5. Event and hierarchy deletion with linked tasks; Trash (Clarification 2)

- **Decision**: Linked tasks deleted with their event are **kept in the database and flagged**
  with `trash_entry_id` (same pattern as `session_folders.trash_entry_id`), hidden from every task
  query. `DELETE /sessions/{key}` and the year/semester/course delete endpoints gain
  `linkedTasks=keep|delete` (default `keep`). `keep` → unlink (`event_key = NULL`, cached
  title/date stay). `delete` → set `trash_entry_id` to the new entry. Deletion-impact responses
  gain `linkedTaskCount`; `TrashEntryOut` gains `taskCount`. `trash_service.restore` clears the
  flag (task re-linked because `event_key` was kept; if its column is gone it goes to the first
  column at the end; if the unique link is taken meanwhile it is restored unlinked).
  `trash_service.purge` deletes flagged tasks with their checklist items and quick notes. The
  `trash_entries.kind` CHECK stays `('class','event')`; no new Trash kind.
- **Rationale**: Clarification Q2 (Option B). Flagging rows avoids versioning `TrashPayloadV1` and
  reuses the folder pattern already restored/purged by the same service.
- **Alternatives considered**: Snapshotting tasks into `payload_json` (payload v2 migration, larger
  restore code); a separate `task` Trash kind (spec says the task goes into the event's entry).

## R6. Deleting a task, quick note, checklist item or empty column — Undo

- **Decision**: Tasks and quick notes are soft-deleted (`deleted_at`), restored with
  `POST /tasks/{id}/restore` / `POST /quick-notes/{id}/restore`; rows with `deleted_at` older than
  24 h are hard-deleted at startup (`task_service.purge_expired`). The client shows a Sonner toast
  with "Undo" for 10 s (`duration: 10_000`, as `QuickCreateForm.save`). Checklist items are
  re-created by the client on Undo (they have no identity worth preserving). An empty column is
  deleted immediately and re-created on Undo with its name, position and done flag; a column with
  tasks requires the move-target confirmation (FR-011) and has no Undo.
- **Rationale**: FR-026/FR-027/FR-030; the soft-delete keeps position, checklist, quick notes and
  event link intact on Undo, including after a reload within the toast window.
- **Alternatives considered**: Client-side delayed delete (lost if the tab closes — risky for
  Principle I); reusing `creations/undo` (creation-only semantics).

## R7. Saving and concurrency

- **Decision**: Every task, column and quick-note row uses `VersionMixin`; writes send `If-Match`
  (`IfMatch` / `check_version` → 412 `version_conflict`). Detail-sheet fields autosave debounced
  (600 ms, as notes) through `PATCH /tasks/{id}`; the sheet shows the state via the existing
  `useSaveStatus` (`sessions/autosave.ts`) and a status label in the same style as
  `StatusLabel`. Moves are optimistic in the TanStack Query cache and rolled back on error with a
  retry toast (FR-020). On 412 the client refetches and re-applies the user's unsaved field
  values; nothing typed is discarded (FR-027).
- **Rationale**: Same conventions as notes and events; meets Principle I.
- **Alternatives considered**: Last-write-wins without versions (silent overwrite across tabs).

## R8. Data loading

- **Decision**: One query `["tasks"]` → `GET /tasks` returns all of the user's live tasks with
  checklist summary (done/total), quick-note count and linked-event summary; `["task-columns"]`
  → `GET /task-columns`. Board, list, filters, rail count/overdue, course lists and calendar
  markers are all derived client-side (pure functions in `features/tasks/model/`). Details load
  `GET /tasks/{id}` (checklist items) and quick notes `GET /tasks/{id}/quick-notes` on demand.
- **Rationale**: Scale is a single student (SC-006: 300 tasks); one cache makes every view
  consistent and the rail current (FR-017) without extra endpoints.
- **Alternatives considered**: Server-side grouping/filtering endpoints (more contract surface, no
  benefit at this scale).

## R9. Overdue, Today, This week

- **Decision**: Pure `features/tasks/model/dates.ts` using the user's time zone (`User.timezone`,
  same `tz` the calendar uses via `@date-fns/tz`) and the calendar's week start. Overdue = not
  Done and (`due_time` set and now > due) or (date only and today > due_date). A 60 s clock tick
  (`useNow`) re-evaluates so the rail's indicator appears without reload (FR-017).
- **Rationale**: Matches spec Assumptions; deterministic unit tests with a fixed clock.

## R10. Home page composition in the shell

- **Decision**: New feature `frontend/src/features/home/`. The index route `"/"` and
  `calendar/:view?/:date?` both render `HomeLayout` (= `HomePage` + `<Outlet/>`, replacing
  `CalendarLayout`), so existing calendar URLs and the overlay child routes (`classes/new`,
  `events/new`, `sessions/:sessionKey[/edit|/delete]`) keep working and lead to the home page with
  the same view and date. The shell gets a `bareMain` flag in `layout.tsx` context (set by
  `HomePage` via `useBareMain()`), so `AppShell` renders the main grid column without its `Card`
  chrome and the page renders two `Card`s (`features/home/CalendarPanel.tsx`, `TasksPanel.tsx`)
  plus rails (`PanelRail.tsx`, same 44 px, `RAIL_W`, styling as `Rail.tsx`).
- **Rationale**: Keeps `/calendar/...` deep links, the 008 grid, left card and focus logic intact;
  the home page owns only the main column.
- **Alternatives considered**: Moving view/date into search params on `/` (breaks `calendarPath`
  consumers and history); a fourth shell grid column (would leak home rules into every page).

## R11. Width rules

- **Decision**: Pure `features/home/homeWidths.ts`: input = main-column width, panel open flags,
  stored tasks width, wide/narrow mode; output = effective widths, whether both fit, and which
  panel to close. Constants: `CAL_MIN=480`, `TASKS_MIN=320`, `TASKS_DEFAULT=420`,
  `TASKS_MAX_RATIO=0.6`, `RAIL_W=44`, `GAP=8` (from `app/shell/widths.ts`). Both fit iff
  `main ≥ 480 + 320 + GAP` (rails excluded because both are open). Rules: opening a panel that
  does not fit closes the other (notice); a shrink that breaks the fit closes Tasks (notice);
  load applies silently; below 1100 px at most one open. The divider is the existing
  `PanelResizeHandle` (`grow="left"`, `step=16`, Home/End, Enter resets to 420).
- **Rationale**: Unit-testable for SC-010/SC-011 matrix; reuses the shell constants and handle.

## R12. Panel state, focus mode and restoration

- **Decision**: `features/home/usePanels.ts` holds `{calendar, tasks}` open flags in localStorage
  `uh.home.panels` and width in `uh.home.tasksWidth` via the existing `readLocal`/`writeLocal`.
  First use: both open if ≥ 1100 px, else calendar only. Focus mode reuses the shell `focus` flag:
  when on, `HomePage` hides panel rails (left card already hidden by the shell). Scroll positions
  (calendar grid, board horizontal, each column, list) are kept in a module-level map (same
  approach as `calendar/state.ts`) and restored on mount; panels stay mounted while closed
  (`hidden` + `inert`) so filters, unsaved inputs and open forms survive (FR-075).
- **Rationale**: FR-083–FR-089; mounting-but-hidden is the simplest way to keep any in-progress
  input.

## R13. Shortcuts and calendar key scoping (Clarification 5)

- **Decision**: Shift+C / Shift+T handled in `HomePage`'s window keydown listener, skipped when
  `isTypingTarget(e.target)` or ctrl/meta/alt (`lib/shortcuts.ts`); `e.code` (`KeyC`/`KeyT`) with
  `shiftKey` so non-US layouts work. When the target panel is the last open one, the shortcut only
  announces "At least one panel stays open". `useCalendarKeyboard` gets one guard: return if the
  event target is inside `[data-panel="tasks"]` or the Calendar panel is closed (FR-095). Both
  added to `ShortcutsDialog` and to the buttons' `aria-keyshortcuts` and tooltips.

## R14. Announcements

- **Decision**: One `role="status" aria-live="polite"` region in `HomePage` for panel open/close,
  automatic closes and "at least one" messages, and one in `TasksPanel` for drag/keyboard moves
  and Undo results; the visible notice for automatic closes is a Sonner toast (FR-079).
- **Rationale**: Follows the existing inline-region pattern; no new helper (Principle VII).

## R15. Add to kanban on event creation

- **Decision**: `POST /events` (full form) and the quick form's event create accept optional
  `addToBoard: { columnId }`. The server creates the linked task for the first occurrence in the
  same transaction and includes it in the creation record so `POST /creations/undo` removes it.
  For an existing occurrence: `POST /tasks` with `eventKey`. `SessionOut` gains `taskId` (batch
  lookup in `session_query.list_sessions`, like `trashed_keys`) for the "on board" indicator and
  for hiding "Add to kanban" on occurrences that have a task. The details action is a registered
  session action (`registerSessionAction`, `classes/session-actions.ts`).

## R16. Calendar markers

- **Decision**: "Show tasks" in localStorage `uh.calendar.showTasks` (per browser). Timed tasks:
  a small checkbox marker absolutely positioned at its time in `TimeGrid` columns, rendered in a
  separate layer **outside** `layoutOverlaps` so entries never shrink (FR-051). Date-only tasks:
  a new strip row under the day headers in `TimeGrid` (after the header row) and inside month
  cells, collapsing to "+N more" (popover, as month "+N"). Ticking calls the move endpoint to the
  first done column; unticking uses `previousColumnId` (data model). Marker = checkbox glyph +
  title, Done = strikethrough + dimmed, Overdue = "!" glyph + accessible "overdue" text.

## R17. Course task lists (Clarification 3) and the side card

- **Decision**: No "Sessions and notes" section exists in code; the side card's course context is
  the course page and a course session's workspace. A `CourseTasks` component lists open tasks of
  the course with a quick add; it is rendered on `CoursePage` and registered as a side-panel
  section (`registerSidePanelSection`, `sessions/workspace-panels.ts`) titled "Tasks" for course
  sessions. Activating a task navigates to `/` with `?task=<id>`; `HomePage` opens the Tasks panel
  (width rules apply) and the details sheet, then removes the param; Back returns to the course
  page (FR-052).

## R18. Course deletion

- **Decision**: `hierarchy_service.delete_entity` (course) sets `tasks.course_id = NULL` for the
  course's tasks explicitly (SQLite FK actions are not relied on) and counts them;
  `GET /courses/{id}/deletion-impact` gains `taskCount`; `HierarchyMenu`'s `impactSentence` adds
  "N tasks will become personal tasks". Restoring the course's classes from the Trash does not
  reassign tasks (FR-058).

## R19. CSV export

- **Decision**: `GET /tasks/export` returns `text/csv; charset=utf-8` with a UTF-8 BOM (Excel opens
  non-ASCII correctly), RFC 4180 quoting, header row
  `Title,Description,Column,Due date,Due time,Course,Linked event,Checklist,Quick notes,Completed at`.
  Checklist cell: one line per item `[x] text` / `[ ] text`; quick-notes cell: `Title: text`
  blocks separated by blank lines. Headers and filename as `calendar_io.export_calendar`
  (`{APP}-tasks-{local date}.csv`). UI card in Settings → Import & export next to `ExportCard`.

## R20. Constitution Principle II and quick notes

- **Decision**: Tasks, checklists and quick notes are stored in SQLite only. Quick notes are short
  plain-text fields of a task (spec FR-029), not Markdown session notes, which Principle II
  governs ("note bodies", `<class-date>/notes/`). Openness is provided by the CSV export
  (FR-053). Recorded under Constitution Check as an interpretation for the owner to confirm.
- **Alternatives considered**: Mirroring tasks into a Markdown file tree (`_Tasks/…`) — a second
  write path and conflict handling for a feature whose content is metadata-like.

## R21. Testing strategy

- **Backend**: migration test `test_migration_0012.py`; contract tests per new/changed operation
  (`tests/contract/test_tasks.py`, `test_task_columns.py`, `test_quick_notes.py`, changes in
  `test_trash.py`, `test_sessions_events.py`, `test_hierarchy_manage.py`), validated with
  `check(..., spec="012")`; integration: event edit/move → linked task follows, series edit drops
  a date → task unlinked, event delete keep/delete → Trash restore re-links, purge deletes, course
  delete → personal, creation undo removes the task, account isolation for tasks.
- **Frontend unit (Vitest)**: `homeWidths`, `usePanels` rules, `keyboardMove` reducer, drag
  target math, list grouping/sorting, overdue/today, filters, CSV-free (server), rail counts.
- **E2E (Playwright, light + dark)**: home panels (open/close/rails/at-least-one/resize/narrow
  window/focus/back navigation), board pointer drag and keyboard move with Escape, column CRUD,
  details autosave + Undo, quick notes, list view, add to kanban + Open note, calendar markers,
  course page tasks, export download; axe on home, details sheet and quick-note pop-up in light,
  dark and one custom theme.
