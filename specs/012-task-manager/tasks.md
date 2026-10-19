---

description: "Task list for 012 — Task Manager and Home Page Panels"
---

# Tasks: Task Manager and Home Page Panels

**Input**: Design documents from `/specs/012-task-manager/`

**Prerequisites**: plan.md, spec.md (Part A US1–US7, Part B US8–US13), research.md (R1–R21),
data-model.md, contracts/openapi.yaml, contracts/ui-home-tasks.md, quickstart.md

**Tests**: Included. Constitution VI requires endpoint tests (success + primary errors) and the
contract coverage guard (`backend/tests/contract/test_coverage.py`, `conftest.pytest_sessionfinish`)
fails the full run unless every operation in `specs/012-task-manager/contracts/openapi.yaml` is
implemented and hit with a 2xx. Validate bodies with
`backend/tests/contract/openapi_check.py` `check(body, "<Schema>", spec="012")`.

**Organization**: Phases follow the plan's implementation order: Part B P1 panels (US8–US10) come
before Part A P1 (US1–US4) because the task manager lives in the Tasks panel.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: user story from spec.md (US1–US13)

## Conventions (apply to every task)

- Backend root `backend/src/unihelper/`: models in `models/` (re-export in `models/__init__.py`
  `__all__`), Pydantic in `schemas/` (subclass `schemas/common.py` `ApiModel`: camelCase aliases,
  `from_attributes`), logic in `services/`, routers in `api/v1/` (registered in
  `main.build_api_router()` module tuple). Use `api/deps.py` `DbSession`, `CurrentUser`,
  `IfMatch` + `check_version` (412 `version_conflict`, 428 when missing) and `api/errors.py`
  `ApiError(status, code, title, detail=None, errors=None)`, `not_found(what)`,
  `validation_error(field, code, message)`. Mixins from `models/base.py`: `IdMixin` (uuid7 `id`),
  `TimestampMixin`, `VersionMixin`. Every query filters on `user.id`.
- Frontend root `frontend/src/`: API via `lib/api` `apiFetch<T>(path, {method, body, version,
  query})`, types `Schemas[...]` from `lib/api/schema.d.ts` (regenerate with `pnpm gen:api` after
  backend schema changes), TanStack Query, `sonner` `toast(..., {duration: 10_000, action:
  {label: "Undo", onClick}})`, `lib/storage.ts` `readLocal/writeLocal`, `lib/shortcuts.ts`
  `isTypingTarget/hasModifier`, shadcn/ui primitives in `components/ui/`, colors only from theme
  tokens (`bg-muted`, `bg-surface-*`, `text-text-muted`, `border-divider`, `border-draft-border`,
  `text-warning`, `text-danger`), Phosphor icons, `motion-reduce:` variants.
- Frontend tests: Vitest in `frontend/tests/unit/` (helpers `tests/unit/test-utils.tsx`
  `mockFetch`, `renderWithProviders`; axe via `vitest-axe`); Playwright in `frontend/tests/e2e/`
  (helpers `helpers.ts` `signIn`, `seedClass`, `newHierarchy`; `layout-helpers.ts` `VIEWPORT`
  1366×768; `@axe-core/playwright`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: migration, models and module skeletons every story needs.

- [X] T001 Create migration `backend/src/unihelper/db/migrations/versions/0012_tasks.py` (`revision="0012"`, `down_revision="0011"`, batch ops for SQLite) creating: `task_columns` (id, user_id FK users ON DELETE CASCADE, name str(40) NOT NULL, name_key str(40) NOT NULL, position int NOT NULL, counts_as_done bool NOT NULL default false, created_at, updated_at, version; `UniqueConstraint(user_id, name_key)`, `UniqueConstraint(user_id, position)`); `tasks` (id, user_id FK CASCADE, column_id FK task_columns NOT NULL, position int NOT NULL, title str(200) NOT NULL, description text NOT NULL default '', due_date date NULL, due_time time NULL, course_id FK courses NULL, event_key str NULL, completed_at str NULL, previous_column_id str NULL, deleted_at str NULL, trash_entry_id FK trash_entries NULL, timestamps, version; indexes `ix_tasks_user_column_position(user_id, column_id, position)`, `ix_tasks_course(user_id, course_id)`, `ix_tasks_trash(trash_entry_id)`, partial unique `uq_tasks_event_key(user_id, event_key) WHERE event_key IS NOT NULL AND deleted_at IS NULL AND trash_entry_id IS NULL`); `task_checklist_items` (id, user_id FK CASCADE, task_id FK tasks ON DELETE CASCADE, text str(500) NOT NULL, done bool NOT NULL default false, position int NOT NULL, timestamps); `task_quick_notes` (id, user_id FK CASCADE, task_id FK tasks ON DELETE CASCADE, title str(200) NOT NULL default '', body text NOT NULL default '', deleted_at str NULL, timestamps, version); downgrade drops them in reverse order
- [X] T002 [P] Create `backend/src/unihelper/models/task_column.py` `TaskColumn` (table `task_columns`, mixins IdMixin/TimestampMixin/VersionMixin, fields per T001) and export it in `backend/src/unihelper/models/__init__.py`
- [X] T003 [P] Create `backend/src/unihelper/models/task.py` with `Task`, `TaskChecklistItem` (relationship ordered by position, cascade delete-orphan) and `TaskQuickNote`, fields per T001, plus a `Task.is_live` hybrid/helper meaning `deleted_at IS NULL AND trash_entry_id IS NULL`; export all three in `backend/src/unihelper/models/__init__.py`
- [X] T004 [P] Create `backend/src/unihelper/schemas/tasks.py` with Pydantic models matching `specs/012-task-manager/contracts/openapi.yaml` exactly: `TaskColumnOut`, `TaskColumnCreate` (name 1–40 chars trimmed, countsAsDone default false, extra forbid), `TaskColumnPatch` (min 1 field), `TaskColumnOrder` (columnIds 1–12), `LinkedEventOut`, `TaskOut` (all required fields incl. checklistDone/Total, quickNoteCount, event), `TaskDetailOut` (+ checklist), `TaskCreate` (title 1–200 unless eventKey, columnId, courseId, dueDate, dueTime "HH:MM", description ≤ 20000, eventKey), `TaskPatch` (min 1), `TaskMove` (columnId, index ≥ 0), `ChecklistReplace` (items ≤ 200, text 1–500), `QuickNoteOut`, `QuickNoteWrite` (title ≤ 200, body ≤ 20000, min 1)
- [X] T005 [P] Write migration test `backend/tests/integration/test_migration_0012.py` following `test_migration_0011.py`: upgrade from 0011 creates the four tables, constraints and the partial unique index; downgrade removes them; existing data untouched
- [X] T006 Create router module `backend/src/unihelper/api/v1/tasks.py` exposing three routers (`columns_router` prefix `/task-columns`, `tasks_router` prefix `/tasks`, `notes_router` prefix `/quick-notes`, tags ["tasks"]) as an empty skeleton, and register them in `backend/src/unihelper/main.py` `build_api_router()` (extend the loop to include each router); make the lifespan in `main.py` call `task_service.purge_expired(db)` once at startup (T016)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: column + task core API (read/create/move), the home route with a bare main column, and
panel state — needed by every story. **No story work before this phase is complete.**

### Backend core

- [X] T007 Implement `backend/src/unihelper/services/task_column_service.py`: `list_columns(db, user)` seeding To do (0), In progress (1), Done (2, counts_as_done=True) idempotently when the user has none; `create_column` (trim; "Column names are required, unique (ignoring case), up to 40 characters" → 422 `validation`; duplicate `name_key = name.casefold()` → 409 `name_taken`; 13th column → 409 `column_limit`; position = count); `patch_column` (rename with same checks; `counts_as_done` true → set `completed_at = now` on live tasks of the column, false → clear it); `reorder_columns(db, user, ids)` with the two-pass renumbering of `hierarchy_service._renumber_years` (negative then 0..n-1; set mismatch → 409 `order_mismatch`); `delete_column(db, user, column, move_to)` (only column → 409 `last_column`; live tasks present and no `move_to` → 409 `move_target_required`; move_to unknown → 404; append tasks to target in current order and re-evaluate `completed_at` by the target flag; renumber remaining columns); each output includes `taskCount` of live tasks
- [X] T008 Implement `backend/src/unihelper/services/task_service.py` core: `task_out(task)` building `TaskOut` (course name/color via the course row, `event` from cached title/due_date/due_time when `event_key` set, checklist counts, live quick-note count); `list_tasks(db, user)` (live tasks only, ordered by column position then task position, batch-loading counts); `get_task`; `create_task(db, user, body)` (column default = first; course must belong to user → 404; `dueTime` without `dueDate` → 422 `time_without_date`; append at end; if column counts as done set `completed_at`); `move_task(db, user, task, column_id, index, version)` (remove from old column, insert at `min(index, len)` among the target's live tasks, renumber both columns 0..n-1; entering a done column from a not-done one sets `completed_at=now` and `previous_column_id=old column`; leaving a done column clears `completed_at`)
- [X] T009 Implement the column endpoints in `backend/src/unihelper/api/v1/tasks.py`: `GET /task-columns`, `POST /task-columns` (201), `PUT /task-columns/order`, `PATCH /task-columns/{columnId}` (IfMatch), `DELETE /task-columns/{columnId}?moveTo=` (IfMatch, returns remaining columns)
- [X] T010 Implement the core task endpoints in `backend/src/unihelper/api/v1/tasks.py`: `GET /tasks`, `POST /tasks` (201), `GET /tasks/{taskId}` (TaskDetailOut), `POST /tasks/{taskId}/move` (IfMatch, body TaskMove) — declare `GET /tasks/export` route position before `/{taskId}` routes for later
- [X] T011 [P] Contract tests `backend/tests/contract/test_task_columns.py`: seeding of 3 columns, create/rename/duplicate (case-insensitive) 409, 40-char limit 422, 12-column limit 409, reorder + `order_mismatch`, counts-as-done toggling sets/clears `completedAt` of its tasks, delete empty, delete with tasks requires `moveTo` (409) and moves them, last column 409, 412/428 on stale/missing If-Match, another user's column 404; validate with `check(..., "TaskColumn", spec="012")`
- [X] T012 [P] Contract tests (core part) `backend/tests/contract/test_tasks.py`: create with title only lands at end of first column, all-fields create, `time_without_date` 422, foreign course 404, list order, get detail, move within and across columns (positions renumbered, completion recorded/cleared, `previousColumnId` set), index clamped, stale version 412; validate `Task`/`TaskDetail`
- [X] T013 Run `pnpm gen:api` in `frontend/` to regenerate `frontend/src/lib/api/schema.d.ts` from the backend OpenAPI

### Frontend core

- [X] T014 [P] Create `frontend/src/features/tasks/api.ts`: query keys `taskKeys = { all: ["tasks"], detail: (id) => ["task", id], notes: (id) => ["task", id, "quick-notes"] }`, `columnKeys = ["task-columns"]`; hooks `useTasks()`, `useTaskColumns()`, `useTask(id)`, `useCreateTask()`, `useMoveTask()` (optimistic: reorder the cached `["tasks"]` list with `features/tasks/model/order.ts` `applyMove`, rollback on error and `toast.error("Couldn't move the task", {action: {label: "Retry"}})`), `useCreateColumn`, `usePatchColumn`, `useReorderColumns`, `useDeleteColumn`; mutations send `version`
- [X] T015 [P] Create pure model helpers `frontend/src/features/tasks/model/order.ts` (`applyMove(tasks, taskId, columnId, index)` mirroring the server rule, `tasksByColumn(tasks, columns)`), `frontend/src/features/tasks/model/dates.ts` (`isDone(task, columns)`, `isOverdue(task, now, tz)` — date-only overdue after end of due day, `dueBucket(task, now, tz, weekStartsOn)` → `overdue|today|thisWeek|later|noDate|done`, `dueLabel(task, now, tz)` returning "Today"/"Overdue"/formatted date) using `@date-fns/tz` and the week start from `frontend/src/lib/dates.ts`, and `frontend/src/features/tasks/model/counts.ts` (`openCount`, `overdueCount`)
- [X] T016 Add `purge_expired(db)` to `backend/src/unihelper/services/task_service.py` (hard-delete tasks and quick notes whose `deleted_at` is older than 24 h) — wired at startup by T006
- [X] T017 Add a `bareMain` flag to the shell: in `frontend/src/app/shell/layout.tsx` add `bareMain: boolean` + `useBareMain()` (a hook that sets it true while the calling component is mounted, restoring false on unmount) to the layout context (and to the no-op `OUTSIDE` object); in `frontend/src/app/shell/AppShell.tsx` render the main grid column without the `Card` chrome (plain `div` with `id="main"`, `min-w-0 h-full flex gap-2`, still containing `<Outlet/>` and `<ActivityPills/>`) when `bareMain` is true
- [X] T018 Create `frontend/src/features/home/homeWidths.ts` (pure): constants `CAL_MIN=480`, `TASKS_MIN=320`, `TASKS_DEFAULT=420`, `TASKS_MAX_RATIO=0.6`, reuse `RAIL_W`, `GAP` from `frontend/src/app/shell/widths.ts`; `bothFit(mainWidth)` = `mainWidth >= CAL_MIN + TASKS_MIN + GAP`; `clampTasks(width, mainWidth, windowWidth)` = clamp to [320, min(0.6×window, mainWidth − 480 − GAP)]; `resolvePanels({open, mainWidth, wide, opening?})` returning `{open, closedAutomatically?: "calendar"|"tasks"}` implementing: at least one open; narrow (< 1100 px) → at most one open; opening a panel that doesn't fit closes the other; shrink that breaks the fit closes Tasks; `panelWidths(...)` returning effective widths (Tasks fills when Calendar closed)
- [X] T019 Create `frontend/src/features/home/usePanels.ts`: state `{calendar, tasks}` in localStorage `uh.home.panels` and width in `uh.home.tasksWidth` via `readLocal/writeLocal`; first use: both open if `useMediaQuery(WIDE_QUERY)` (from `frontend/src/lib/useMediaQuery.ts`) else `{calendar: true, tasks: false}`; applies `resolvePanels` on load silently and on window/left-card width changes (returns the auto-close so the page can notify); exposes `toggle(panel)`, `open(panel)`, `close(panel)` (no-op returning `"last-open"` for the last open panel), `tasksWidth`, `setTasksWidth`
- [X] T020 Create `frontend/src/features/home/HomeLayout.tsx` (`<HomePage/><Outlet/>`) and `frontend/src/features/home/routes.tsx`; in `frontend/src/app/router.tsx` replace the index `<Navigate to="/calendar">` with `HomeLayout`, and in `frontend/src/features/calendar/routes.tsx` make the layout route element `HomeLayout` instead of `CalendarLayout` so `calendar/:view?/:date?` and the overlay children (`classes/new`, `events/new`, `sessions/:sessionKey`, `…/edit`, `…/delete`) stay children of the home page; register the new routes in `frontend/src/app/features.ts`
- [X] T021 [P] Unit tests `frontend/tests/unit/homeWidths.test.ts` covering SC-011's matrix (window 800, 1024, 1099, 1100, 1366, 1920 × left card open/closed): Calendar never < 480, Tasks never < 320 or > 60 %, auto-close choices, narrow at-most-one; and `frontend/tests/unit/taskModel.test.ts` for `applyMove`, `isOverdue`, `dueBucket` with a fixed clock in `Europe/Istanbul`

**Checkpoint**: tasks API core works; "/" renders the home layout shell.

---

## Phase 3: User Story 8 — See the calendar and tasks side by side (P1) 🎯 MVP

**Goal**: "/" shows left card, Calendar panel and Tasks panel as three cards, each with one ~40 px header.

**Independent Test**: First use at 1366×768 → three bordered rounded cards, no full-width bar, the calendar works exactly as before (views, Today, New class/event, its shortcuts).

- [X] T022 [US8] Create `frontend/src/features/home/HomePage.tsx`: calls `useBareMain()`, uses `usePanels()`, renders `<CalendarPanel/>` and `<TasksPanel/>` (or their `PanelRail`s) side by side with `gap-2` inside the main column; both panels stay mounted when closed (`hidden` + `inert`) so their state survives (FR-075); includes a sr-only `role="status" aria-live="polite"` `data-testid="home-announcer"`
- [X] T023 [P] [US8] Create `frontend/src/features/home/CalendarPanel.tsx`: shell `Card` (`frontend/src/app/shell/Card.tsx`) `as="section"`, `id="calendar-panel"`, `data-panel="calendar"`, `label="Calendar"`, containing the existing `CalendarPage` content; header is the calendar toolbar in a new `compact` mode
- [X] T024 [US8] Add a `compact` prop to `frontend/src/features/calendar/CalendarToolbar.tsx`: one `h-10` row with (narrow mode only) the left-card reopen button, Today, prev/next, range title, D/W/M `ToggleGroup`, `NewClassButton`/`NewEventButton` (moved into a `DropdownMenu` "More" when the panel is narrower than 640 px via a container query `@container/calendar`), `FocusModeButton`, and a slot for the panel close button; make `CalendarPage` accept `compact` and pass it through; keep the non-compact layout unchanged for any other caller
- [X] T025 [P] [US8] Create `frontend/src/features/home/TasksPanel.tsx`: `Card` `as="section"`, `id="tasks-panel"`, `data-panel="tasks"`, `label="Tasks"`, width from `usePanels().tasksWidth` (or flex-1 when Calendar is closed), header `<TasksHeader/>` (T030) and body showing the board/list (placeholder text "No tasks yet" until US1)
- [X] T026 [US8] Guard `frontend/src/features/calendar/useCalendarKeyboard.ts`: return early when `(e.target as Element)?.closest('[data-panel="tasks"]')` or when the Calendar panel is closed (read a flag exported by `usePanels` through context or a `data-calendar-closed` attribute on `#calendar-panel`) — FR-095
- [X] T027 [P] [US8] E2E `frontend/tests/e2e/home-panels.spec.ts` (first block): fresh account at 1366×768 → `#course-panel`, `#calendar-panel`, `#tasks-panel` visible as cards; each panel's header height ≤ 40 px; no element spanning the full width above the panels; calendar shortcuts `w`, `t` work with focus in the calendar and do nothing with focus inside `#tasks-panel`; `/calendar/week/<date>` deep link opens the home page on that week

**Checkpoint**: Home page shows both panels; calendar unchanged.

---

## Phase 4: User Story 9 — Close and reopen a panel to a rail (P1)

**Goal**: Each panel closes to a 44 px rail with reopen button, icon, vertical label (Tasks: count + overdue), restoring all state.

**Independent Test**: Close/reopen each panel by button, rail and shortcut; check rail content, ≤ 200 ms animation, focus moves, announcements, preserved state.

- [X] T028 [P] [US9] Create `frontend/src/features/home/PanelRail.tsx`: 44 px (`RAIL_W`) `Card` styled like `frontend/src/app/shell/Rail.tsx`, with a reopen button (`id="show-calendar"` / `id="show-tasks"`, accessible name "Show calendar" / "Show tasks, N open, M overdue", `aria-keyshortcuts="Shift+C"` / `"Shift+T"`, tooltip with the shortcut), a Phosphor icon (`CalendarBlank` / `Kanban`), a vertical label (`[writing-mode:vertical-rl]`) "Calendar" / "Tasks"; for Tasks also the open-task count as text and, when overdue > 0, a "!" glyph with sr text "M overdue" (`text-warning`, never color alone)
- [X] T029 [US9] Add close buttons (`id="close-calendar"` "Close calendar", `id="close-tasks"` "Close tasks", Phosphor `X`/`SidebarSimple`) to both panel headers, and implement in `HomePage.tsx`: close/open transitions ≤ 200 ms on width/opacity with `motion-reduce:transition-none`; after closing focus moves to the panel's rail button, after reopening to the first focusable control in the panel header; announcements "Calendar closed", "Tasks opened", etc. into `home-announcer`
- [X] T030 [P] [US9] Create `frontend/src/features/tasks/TasksHeader.tsx` (initial): one `h-10` row with the title "Tasks", Board/List `ToggleGroup` (`aria-label="Task view"`, stored in `uh.tasks.view`), "New task" button, close button slot; search and Filter buttons are added in US4
- [X] T031 [US9] Add Shift+C / Shift+T to `HomePage.tsx`: a `window` keydown listener using `e.code === "KeyC"|"KeyT"` with `e.shiftKey`, skipped when `hasModifier(e)` or `isTypingTarget(e.target)` (`frontend/src/lib/shortcuts.ts`), calling `usePanels().toggle`; add both to `frontend/src/features/calendar/ShortcutsDialog.tsx` (`CALENDAR_SHORTCUTS` list or a new "Panels" group)
- [X] T032 [US9] Wire the Tasks rail counts: `TasksPanel`/`PanelRail` read `useTasks()` + `useTaskColumns()` and `openCount`/`overdueCount` from `frontend/src/features/tasks/model/counts.ts`; add `frontend/src/features/tasks/useNow.ts` (a 60 s ticking `Date`) so the overdue indicator appears when a due time passes without reload (FR-074); when tasks fail to load show no count
- [X] T033 [P] [US9] E2E in `frontend/tests/e2e/home-panels.spec.ts`: close Tasks → rail 44 px with label "Tasks" and count, focus on `#show-tasks`, announcer text; reopen by rail and by Shift+T → focus on the first header control; with a task overdue the rail shows "!" and sr text; calendar view/date unchanged after close/reopen; a half-typed "Add task" text survives close/reopen

**Checkpoint**: Panels close to rails and come back unchanged.

---

## Phase 5: User Story 10 — At least one panel stays open (P1)

**Goal**: The last open panel cannot be closed; the reason is shown and announced.

**Independent Test**: Close one panel, then try the other's button and shortcut → nothing closes; "At least one panel stays open" shown/announced.

- [X] T034 [US10] In `HomePage.tsx`/panel headers: when only one panel is open, its close button is `disabled` with `aria-describedby` pointing to visible tooltip text "At least one panel stays open" (wrap in a span so the tooltip works on a disabled button); its shortcut does nothing except announcing the same text
- [X] T035 [P] [US10] Unit test `frontend/tests/unit/usePanels.test.ts` (renderHook): `close` on the last open panel returns `"last-open"` and keeps it open; first-use defaults for wide/narrow; persistence keys `uh.home.panels`/`uh.home.tasksWidth`
- [X] T036 [P] [US10] E2E in `frontend/tests/e2e/home-panels.spec.ts`: close Tasks, then `#close-calendar` is disabled with the reason; Shift+C leaves the Calendar open and the announcer says "At least one panel stays open"

**Checkpoint**: Part B P1 complete — the Tasks panel is ready to host the task manager.

---

## Phase 6: User Story 1 — Capture and track tasks on a board (P1)

**Goal**: Board with columns, cards, create (title only), pointer drag and keyboard move, persisted order.

**Independent Test**: Create tasks (title only and full), move by pointer and keyboard within/between columns, cancel with Escape, reload → same order.

- [X] T037 [P] [US1] Create `frontend/src/features/tasks/board/dropTarget.ts` (pure): `computeTarget(px, py, columnRects, cardRects, draggedId)` → `{columnId, index}` measured against the cards remaining after removing the dragged one (index = first card whose vertical midpoint is below the pointer; end of column otherwise; null outside all columns)
- [X] T038 [P] [US1] Create `frontend/src/features/tasks/board/keyboardMove.ts` (pure reducer): state `{taskId, origin: {columnId, index}, target: {columnId, index}} | null`; actions `pickUp`, `up`, `down`, `left`, `right` (to the neighbouring column at `min(index, len)`), `drop`, `cancel`; plus `announcement(state, columns, tasks)` → "Picked up Read ch. 4. Position 2 of 5 in To do." / "Moved to In progress, position 1 of 3." / "Move cancelled."
- [X] T039 [US1] Create `frontend/src/features/tasks/board/useBoardDrag.ts` with the header comment "Portions adapted from Astryx (github.com/facebook/astryx), © Meta Platforms, Inc., MIT License" and the MIT permission notice; port the drag core of `design/reference/astryx-kanban-board.tsx` (element registries with stable ref callbacks, `DragState {id,width,height,offsetX,offsetY,pointerX,pointerY,target}`) and add: start only after `isClick` (from `frontend/src/features/calendar/draft.ts`) is false (4 px), ignore presses inside `button, a, input, textarea, [role=menuitem], [role=menu], [data-no-drag]`, `setPointerCapture`, cancel on `pointercancel`, `lostpointercapture`, window `blur` and Escape (capture phase) returning the card, rAF-throttled `setDrag`, horizontal auto-scroll of the board scroller and vertical auto-scroll of the hovered column using `edgeSpeed` (from `draft.ts`), suppress the click that follows a completed drag, `document.body.style.userSelect="none"` while dragging; returns `{drag, onCardPointerDown, registerColumn, registerCard, boardRef}` and calls `onDrop(taskId, target)` only when the target differs from the origin
- [X] T040 [P] [US1] Create `frontend/src/features/tasks/board/TaskCard.tsx` (`data-task-id`, shadcn styling `rounded-lg border bg-card p-3`, `cursor-grab`, `touch-none select-none`): title as a button opening details (US3; until then no-op), course chip (color dot `style={{backgroundColor: courseColor}}` + name), due chip with text "Today" / "Overdue" + `Warning` glyph via `dueLabel`, checklist "done/total" when total > 0, quick-note button "Quick notes (n)" (`data-no-drag`, wired in US3), Event marker (Phosphor `CalendarCheck` + sr "Event") when `task.event`; keyboard: card is focusable (`tabIndex=0`), Enter/Space dispatch `pickUp` and show `aria-pressed="true"` and a ring while picked up
- [X] T041 [P] [US1] Create `frontend/src/features/tasks/board/AddTaskField.tsx`: input "Add task" at the bottom of a column; Enter creates via `useCreateTask({title, columnId})` at the end of that column and keeps focus/clears; empty input does nothing; Escape clears
- [X] T042 [US1] Create `frontend/src/features/tasks/board/BoardColumn.tsx` (fixed `w-70` ≈ 280 px, own vertical scroll, header with name, count, "Done column" text badge when `countsAsDone`, body list with ghost placeholder `bg-muted border border-dashed border-draft-border rounded-lg` of the dragged card's height at the drop index, empty text "No tasks", footer `AddTaskField`) and `frontend/src/features/tasks/board/Board.tsx` (horizontal `overflow-x-auto` scroller with `boardRef`, renders columns from `tasksByColumn`, floating drag clone `fixed pointer-events-none shadow-lg z-50` positioned by transform, keyboard-move state via `useReducer(keyboardMove)` rendering the same ghost, a sr-only live region `data-testid="tasks-announcer"` for move announcements, `onDrop` → `useMoveTask`)
- [X] T043 [US1] Add "New task" behaviour in `frontend/src/features/tasks/TasksHeader.tsx`: opens a small inline title field (Popover) — Enter creates in the first column via `useCreateTask`; mount `<Board/>` in `TasksPanel.tsx` body (replacing the placeholder)
- [X] T044 [P] [US1] Unit tests `frontend/tests/unit/dropTarget.test.ts` and `frontend/tests/unit/keyboardMove.test.ts` (all actions, column edges, cancel restores origin, announcements text)
- [X] T045 [P] [US1] Component test `frontend/tests/unit/TaskCard.test.tsx`: renders course name, "Today"/"Overdue" text, "2/5", quick-note count, Event marker sr text; axe has no violations
- [X] T046 [P] [US1] E2E `frontend/tests/e2e/tasks-board.spec.ts`: new account shows To do / In progress / Done; create by "New task" and by column field; pointer drag to another column and to top of the same column, reload keeps order; drag cancelled by Escape returns; move < 4 px opens nothing as a drag (click); keyboard Enter → ArrowRight → ArrowDown → Enter moves and announces, Enter → Escape cancels; long column auto-scrolls when dragging at its bottom edge; moving into Done records completion (visible later in details)

**Checkpoint**: Working board — MVP of the task manager.

---

## Phase 7: User Story 2 — Shape the board's columns (P1)

**Goal**: Add, rename, reorder (pointer + keyboard), mark as done, delete with move-target.

**Independent Test**: Exercise limits and validations; no task is ever lost.

- [X] T047 [P] [US2] Create `frontend/src/features/tasks/board/ColumnMenu.tsx` (DropdownMenu on the column header: Rename (inline input, Enter saves, Escape cancels, errors "A column with this name already exists" / "Names can be at most 40 characters" from 409 `name_taken` / 422), "Counts as done" checkbox item, Move left / Move right, Delete) and an "Add column" button at the end of the board in `Board.tsx` (disabled with tooltip "A board holds at most 12 columns" at 12)
- [X] T048 [P] [US2] Create `frontend/src/features/tasks/DeleteColumnDialog.tsx`: AlertDialog shown when the column has live tasks (count includes tasks hidden by filters): "Move its N tasks to" Select of the other columns + Delete/Cancel; nothing changes until confirmed; empty column deletes immediately with Undo toast that re-creates it (`POST /task-columns` then `PUT /task-columns/order` to its old position, then `PATCH` countsAsDone if it was set); "Delete" disabled with tooltip "The board needs at least one column" when only one column exists
- [X] T049 [US2] Column reordering in `Board.tsx`/`BoardColumn.tsx`: drag by a header handle (reuse `useBoardDrag` in a `mode: "column"` computing the target index from column rects) and keyboard on the focused handle (Enter/Space pick up, ←/→ move, Enter drop, Escape cancel, announced) → `useReorderColumns` (optimistic, rollback with Retry toast)
- [X] T050 [P] [US2] E2E in `frontend/tests/e2e/tasks-board.spec.ts`: add "Waiting", duplicate name in other case rejected, rename, reorder by keyboard and pointer (reload keeps), toggle "Counts as done", delete a column with tasks asks for target and moves them, last column cannot be deleted, 13th column refused

**Checkpoint**: Columns fully user-defined.

---

## Phase 8: User Story 3 — Task details, quick notes and safe deletion (P1)

**Goal**: Details sheet with autosave + checklist, quick-note pop-up, Undo for every delete.

**Independent Test**: Edit every field, see save states, fail a save, delete and undo task / quick note / checklist item.

### Backend

- [X] T051 [US3] Extend `backend/src/unihelper/services/task_service.py`: `patch_task` (fields of TaskPatch; for linked tasks `title`, `dueDate`, `dueTime` → 409 `linked_field_read_only`; course ownership; `time_without_date`), `replace_checklist(db, user, task, items, version)` (keep ids given, create new, delete missing, positions = array order, bump task version), `soft_delete_task` (sets `deleted_at`, renumbers the column's live tasks), `restore_task` (only if `deleted_at` set and not expired else 404; reinserts at its old position clamped; column gone → first column end; event_key taken meanwhile → restore with `event_key=None`)
- [X] T052 [US3] Create `backend/src/unihelper/services/quick_note_service.py`: `list_notes(task)` live notes newest first; `create_note` (both title and body empty after trim → 422 `empty_quick_note`); `patch_note` (IfMatch); `soft_delete_note`; `restore_note` (404 if not deleted or expired)
- [X] T053 [US3] Add endpoints to `backend/src/unihelper/api/v1/tasks.py`: `PATCH /tasks/{taskId}`, `DELETE /tasks/{taskId}` (204), `POST /tasks/{taskId}/restore`, `PUT /tasks/{taskId}/checklist`, `GET|POST /tasks/{taskId}/quick-notes`, `PATCH|DELETE /quick-notes/{noteId}`, `POST /quick-notes/{noteId}/restore` — all IfMatch where the contract says so
- [X] T054 [P] [US3] Extend `backend/tests/contract/test_tasks.py` (patch fields, linked read-only 409 using a task created with `eventKey` once US5 exists — mark that case `skip` until T081, checklist replace keeps ids/order, delete + restore restores position/checklist/notes, restore of a non-deleted task 404) and create `backend/tests/contract/test_quick_notes.py` (list/create/empty 422/patch/stale 412/delete/restore, other user 404); validate with `check(..., spec="012")`
- [X] T055 [P] [US3] Unit test `backend/tests/unit/test_task_order.py`: move/soft-delete/restore renumbering invariants (positions 0..n-1, no duplicates) and `purge_expired` age rule

### Frontend

- [X] T056 [US3] Run `pnpm gen:api` in `frontend/` and add to `frontend/src/features/tasks/api.ts`: `usePatchTask` (debounced 600 ms autosave with `useSaveStatus` from `frontend/src/features/sessions/autosave.ts`; on 412 refetch then re-apply the unsaved fields; on network error keep values and expose retry), `useReplaceChecklist`, `useDeleteTask` (toast "Task deleted" with Undo → `POST /tasks/{id}/restore`, 10 s), `useQuickNotes`, `useCreateQuickNote`, `usePatchQuickNote` (autosave), `useDeleteQuickNote` (Undo toast)
- [X] T057 [P] [US3] Create `frontend/src/features/tasks/ChecklistEditor.tsx`: list of items (Checkbox + inline text input, Enter adds a new item below, Backspace on empty removes it), reorder by Alt+↑/↓ and drag handle, delete button per item with Undo toast that re-inserts the item via `useReplaceChecklist`
- [X] T058 [US3] Create `frontend/src/features/tasks/TaskDetails.tsx`: panel-covering sheet (`absolute inset-0` inside `#tasks-panel`, `role="dialog" aria-modal="false" aria-labelledby`), header with "Back to tasks" button, title and save state text ("Saving…", "Saved", "Couldn't save — Retry", `aria-live="polite"`, `data-testid="task-save-state"`); fields Title (1–200), Description textarea, Column Select (uses `useMoveTask`), Due date + optional time, Course Select (incl. "No course"), `ChecklistEditor`, quick notes section (list + "New quick note" opening the pop-up), completion date when Done, Delete button; Escape/Back closes and returns focus to the opener; closing while a save failed shows an AlertDialog "Your last change isn't saved" with "Keep editing" / "Retry" — never discards
- [X] T059 [US3] Create `frontend/src/features/tasks/QuickNotesPopover.tsx`: Popover portalled into the `#tasks-panel` container (`container` prop), anchored to the card's quick-note button; lists notes (title input + plain textarea, per-note save state), "New quick note" (creates on first non-empty input; empty note discarded on close), Delete with Undo toast; Escape or close button returns focus to the card's quick-note button; closing the Tasks panel closes the pop-up after flushing pending saves
- [X] T060 [US3] Wire details and quick notes into the board: `TaskCard` title button and plain click (from `useBoardDrag` click detection) open `TaskDetails`; the quick-note button opens `QuickNotesPopover`; add a card `DropdownMenu` (Open, Move to → column list, Delete) in `frontend/src/features/tasks/board/TaskCard.tsx`
- [X] T061 [P] [US3] Component test `frontend/tests/unit/TaskDetails.test.tsx` with `mockFetch`: autosave status transitions, failed save keeps text and warns on close, delete shows Undo and calls restore, axe clean
- [X] T062 [P] [US3] E2E `frontend/tests/e2e/tasks-list-details.spec.ts` (details part): edit description → "Saved"; offline (route abort) → "Couldn't save — Retry", Back warns, Retry saves; checklist 1/3 on the card; quick notes add/edit/delete+Undo, Escape returns focus to the card; delete task → Undo restores position, checklist and notes

**Checkpoint**: Part A P1 core editing done; every delete is undoable.

---

## Phase 9: User Story 4 — The list view and filters (P1)

**Goal**: List grouped by due bucket; filters + search remembered per browser.

**Independent Test**: Tasks across all groups; switch views; each filter; reload keeps choices.

- [X] T063 [P] [US4] Create `frontend/src/features/tasks/model/group.ts` (`groupForList(tasks, columns, now, tz, weekStartsOn)` → ordered groups Overdue, Today, This week, Later, No date, Done; sorted by due date then time then title) and `frontend/src/features/tasks/model/filters.ts` (`TaskFilters {course: string|"personal"|null, eventLinked: boolean, search: string, showDone: boolean}`, `applyFilters`, `activeFilterCount` counting search when non-empty, `hiddenCount`), persisted in localStorage `uh.tasks.filters`
- [X] T064 [US4] Create `frontend/src/features/tasks/list/TaskList.tsx`: disclosure button per group with count (Done collapsed by default; collapse state kept in module memory), rows with title button (opens details), column name, course chip, due chip, checklist, quick-note button, row menu with the same actions as cards (Open, Move to, Delete, Open note when linked — added in US5); keyboard: rows focusable, Enter opens
- [X] T065 [US4] Extend `frontend/src/features/tasks/TasksHeader.tsx`: search button "Search tasks" expanding into an input over the header row (Escape or clearing collapses, focus returns to the button); "Filter" button with a badge (`aria-label="Filter, N active"`) opening `frontend/src/features/tasks/TaskFilters.tsx` (Popover: Course Select incl. "Personal tasks", "Event-linked only" Switch, "Show done" Switch, "Clear filters"); everything must fit one row at 320 px panel width
- [X] T066 [US4] Apply filters in both views (`Board.tsx`, `TaskList.tsx`) and show "N hidden by filters" plus an empty state "No tasks match" with "Clear filters"; filtered-out cards are not rendered but moves still use full-column indexes (pass the full column order to `computeTarget`/`applyMove`, mapping the visible index to the full index before calling `useMoveTask`)
- [X] T067 [P] [US4] Unit tests `frontend/tests/unit/taskGroups.test.ts` and `frontend/tests/unit/taskFilters.test.ts` (bucket boundaries at midnight in `Europe/Istanbul`, week start, sorting, every filter, count)
- [X] T068 [P] [US4] E2E in `frontend/tests/e2e/tasks-list-details.spec.ts` (list part): groups and Done collapsed; filters by course/personal/event-linked/search/show done; Filter badge count; reload keeps view and filters; header fits at 320 px (resize divider later in US11 — here set `uh.home.tasksWidth=320` in localStorage before load)

**Checkpoint**: Part A P1 complete (US1–US4).

---

## Phase 10: User Story 11 — Resize the Tasks panel (P2)

**Goal**: Pointer + keyboard divider between Calendar and Tasks within limits; width remembered.

**Independent Test**: Resize past limits by pointer and keyboard; reload restores (clamped).

- [X] T069 [US11] Place `frontend/src/components/PanelResizeHandle.tsx` between the panels in `HomePage.tsx` (only when both are open): `grow="left"`, `value=tasksWidth`, `min=320`, `max=clampTasks` upper bound, `defaultValue=420`, `step=16`, `label="Resize tasks panel"`, `controls="tasks-panel"`, `data-testid="tasks-divider"`; set `data-resizing` on the shell while dragging to disable transitions (as `AppShell` does); persist via `setTasksWidth` (store the user's value; display the clamped one)
- [X] T070 [P] [US11] E2E in `frontend/tests/e2e/home-panels.spec.ts`: drag beyond limits stops at 320 px and at min(60 %, Calendar 480 px); ArrowLeft/Right/Home/End/Enter on the divider; reload keeps the width; with Calendar closed Tasks fills the width and returns to the stored width when Calendar reopens

---

## Phase 11: User Story 12 — Smaller windows and width conflicts (P2)

**Goal**: Below the fit or below 1100 px only one panel is open; automatic closes are announced and shown.

**Independent Test**: Window widths 800–1366 px, left card open/closed; open each panel; resize.

- [X] T071 [US12] In `HomePage.tsx`, react to `usePanels` auto-closes: show a Sonner toast ("Tasks closed to make room for the calendar" / "Calendar closed to make room for tasks") and announce it, except on initial load (silent, FR-085); measure the main column width with a `ResizeObserver` on the main column so left-card open/close/resize triggers the rule (FR-080)
- [X] T072 [US12] Narrow mode (< 1100 px, `WIDE_QUERY`): left card already overlays (shell); render the left-card reopen button (`ShowSidePanelButton` from `frontend/src/app/shell/MainBarControls.tsx`) at the start of the first open panel's header; enforce at most one open panel via `resolvePanels`
- [X] T073 [P] [US12] E2E in `frontend/tests/e2e/home-panels.spec.ts`: at 900 px both open → Tasks closes with a toast; opening Tasks closes Calendar with a toast; fresh localStorage at 1024 px → Calendar open, Tasks rail; at 1366 px opening the left card at max width closes Tasks if they no longer fit

---

## Phase 12: User Story 5 — Add events to the board and open their notes (P2)

**Goal**: Add to kanban (forms + details), linked tasks follow events, deletion choice, Trash restore, Open note.

**Independent Test**: Quickstart scenario 6.

### Backend

- [X] T074 [US5] Create `backend/src/unihelper/services/task_link_service.py`: `occurrence_view(db, user, key)` (via `services/session_query.py` `find_event_session`/`get_session`; 404 `not_found("Event")`, class key → 422 `not_an_event`); `sync_lineage(db, user, lineage_id)` (for live tasks with `event_key` starting `f"{lineage_id}:"`: recompute `title`, `due_date` (moved date if moved), `due_time` (start) from current session views; if the key is no longer generated and not trashed → set `event_key=None`, keep cached values); `linked_count(db, user, keys|lineage_ids)`; `unlink(db, user, keys)`; `trash_linked(db, user, keys, entry_id)` (set `trash_entry_id`); `restore_for_entry(db, user, entry_id)` (clear flag; column gone → first column end; key already linked → unlink); `purge_for_entry(db, user, entry_id)` (hard delete with checklist and notes); `task_ids_for_keys(db, user, keys)` → dict key→task id
- [X] T075 [US5] `POST /tasks` with `eventKey` in `backend/src/unihelper/services/task_service.py`: title/due from `occurrence_view` (title not required in body), occurrence already has a live task → 409 `event_has_task`
- [X] T076 [US5] Event creation with `addToBoard`: add `add_to_board: AddToBoard | None` (`columnId`) to `EventCreate` in `backend/src/unihelper/schemas/events.py`; in `backend/src/unihelper/services/event_service.py` `create_event` create the linked task for the first occurrence (unknown column → 404) in the same transaction; in `backend/src/unihelper/services/creation_undo.py` `undo_creation` hard-delete tasks whose `event_key` starts with `f"{lineage_id}:"`
- [X] T077 [US5] Call `task_link_service.sync_lineage` after every event mutation: end of `event_service.apply_scope_edit` and `change_semester` in `backend/src/unihelper/services/event_service.py`, and after applying event changes in `backend/src/unihelper/services/calendar_import_service.py` (lineages it edits)
- [X] T078 [US5] Deletion choice: add query `linkedTasks: Literal["keep","delete"] = "keep"` to `DELETE /sessions/{session_key}` (`backend/src/unihelper/api/v1/sessions.py`) and `DELETE /years/{id}`, `/semesters/{id}`, `/courses/{id}` (`backend/src/unihelper/api/v1/hierarchy.py`); pass it to `trash_service.move_to_trash` and `hierarchy_service.delete_year`/`delete_entity`→`_trash_contents`; for removed event occurrences: keep → `unlink`, delete → `trash_linked(..., entry.id)` (for hierarchy deletes, the entry of each lineage)
- [X] T079 [US5] Impact counts and Trash: add `linkedTaskCount` to `SessionDeletionImpact` (session deletion impact service) and to hierarchy `DeletionImpact` (`hierarchy_service.deletion_impact`); add `taskCount` to `TrashEntryOut` in `backend/src/unihelper/schemas/trash.py` / `trash_service.entry_out`; call `task_link_service.restore_for_entry` in `trash_service.restore` and `purge_for_entry` in `trash_service.purge`
- [X] T080 [US5] Add `taskId: str | None` to `SessionOut` in `backend/src/unihelper/schemas/classes.py`, filled in `backend/src/unihelper/services/session_query.py` `list_sessions` (one batch `task_ids_for_keys` over the event keys, like `trashed_keys`) and in `get_session`; always None for classes
- [X] T081 [P] [US5] Contract tests: extend `backend/tests/contract/test_tasks.py` (create with `eventKey`, `event_has_task` 409, `not_an_event` 422, linked read-only 409 — remove the skip from T054), `backend/tests/contract/test_sessions_events.py` (`taskId` in sessions; `linkedTasks` keep/delete; `linkedTaskCount`; `POST /events` with `addToBoard`; `/creations/undo` removes the task), `backend/tests/contract/test_trash.py` (`taskCount`, restore re-links, purge deletes), `backend/tests/contract/test_hierarchy_manage.py` (`linkedTasks` on year/semester/course delete, `linkedTaskCount`)
- [X] T082 [P] [US5] Integration test `backend/tests/integration/test_task_event_links.py`: edit "this" time → task due follows; "following"/"all" title change → follows; weekly series weekday change drops the linked date → task unlinked with last values; move (moved_date) → due date follows; semester change keeps link; calendar import editing the event → follows
- [X] T083 [P] [US5] Integration test `backend/tests/integration/test_task_trash.py`: delete occurrence keep → unlinked; delete → hidden, Trash `taskCount=1`, restore → linked again (column deleted meanwhile → first column), occurrence already re-linked → restored unlinked; purge → task, checklist and quick notes gone; semester delete with `linkedTasks=delete` puts each lineage's tasks in its own entry; extend `backend/tests/integration/test_account_isolation.py` with tasks/columns/quick notes

### Frontend

- [X] T084 [US5] Run `pnpm gen:api`; create `frontend/src/features/tasks/AddToKanbanFields.tsx` ("Add to kanban" Switch, off by default; column Select defaulting to the first column; helper text "Only the first occurrence is added to the board" when repeat ≠ none) and add it to `frontend/src/features/events/EventForm.tsx` (create mode only) and to `frontend/src/features/calendar/QuickCreateForm.tsx` for type Event (after the Repeat select, before the footer ≈ line 395); include `addToBoard` in `eventPayload` and in the quick form's save; invalidate `["tasks"]` after create and after Undo
- [X] T085 [P] [US5] Create `frontend/src/features/tasks/AddToKanbanAction.tsx` and register it with `registerSessionAction({id: "add-to-kanban", component, priority})` (`frontend/src/features/classes/session-actions.ts`): shown for events whose `session.taskId` is null; opens a column Select + Add; calls `POST /tasks {eventKey}`; invalidates `["tasks"]`, `["sessions"]`
- [X] T086 [US5] Create `frontend/src/features/tasks/LinkedTasksChoice.tsx` (RadioGroup "Linked tasks: Keep as tasks (default) / Delete with the event", shown only when `linkedTaskCount > 0`) and use it in `frontend/src/features/classes/DeleteSessionFlow.tsx` and in the delete dialog of `frontend/src/features/courses/HierarchyMenu.tsx` (pass `linkedTasks` query param); extend `trashSentence`/`impactSentence` with "and N linked tasks"; show `taskCount` ("1 task") on `frontend/src/features/settings/trash/TrashPage.tsx` `EntryCard`; invalidate `["tasks"]` after delete/restore/purge
- [X] T087 [US5] Linked tasks in the UI: `TaskDetails.tsx` shows title and due read-only with an "Edit event" link (navigates to `/sessions/<key>/edit`); `TaskCard.tsx` and list row menus add "Open note" for linked tasks only, navigating to the event workspace route used by `SessionDetails` (same behaviour, first note created by the existing flow); invalidate `["tasks"]` when any session mutation succeeds (extend `invalidateSchedule(qc)` in `frontend/src/features/classes/api.ts` to include `["tasks"]`)
- [X] T088 [US5] Restore the home page after "Open note" and Back: create `frontend/src/features/home/scrollMemory.ts` (module-level map: calendar grid scrollTop, board scrollLeft, each column scrollTop by id, list scrollTop) saved on unmount and restored on mount by `CalendarPanel`, `Board`, `BoardColumn`, `TaskList`; the open details/quick-note state is not restored
- [X] T089 [P] [US5] E2E `frontend/tests/e2e/tasks-events-calendar.spec.ts` (events part): quick form with Add to kanban → linked task with Event marker; Undo creation removes it; repeating event helper text and only first occurrence linked; add from details; edit event time → due follows; delete with "Delete with the event" → Trash shows "1 task" → Restore brings it back linked; default keep → unlinked; Open note → workspace → Back → home with same scroll

---

## Phase 13: User Story 6 — Tasks on the calendar (P2)

**Goal**: "Show tasks" switch; checkbox markers and due strips; "on board" indicator on events.

**Independent Test**: Quickstart scenario 7.

- [X] T090 [US6] Add the "Show tasks" Switch (`id="show-tasks-on-calendar"`, localStorage `uh.calendar.showTasks`, default off) to the compact header in `frontend/src/features/calendar/CalendarToolbar.tsx`
- [X] T091 [P] [US6] Create `frontend/src/features/tasks/calendar/TaskMarker.tsx`: `button role="checkbox" aria-checked` (ticked = Done) + title button; Done → `line-through opacity-60`, overdue → "!" glyph + sr "overdue"; tick → `useMoveTask` to the first `countsAsDone` column (none → disabled with tooltip "No column counts as done"); untick → `previousColumnId` if it exists and is not done, else the first not-done column; title → open details in the Tasks panel (`usePanels().open("tasks")` honouring width rules, then open `TaskDetails`)
- [X] T092 [US6] Timed markers in `frontend/src/features/calendar/TimeGrid.tsx`: a separate absolutely positioned layer per day column (outside `layoutOverlaps` and `ColumnEntries`, so entries never shrink) placing `TaskMarker`s at their due time (`HOUR_PX`), compact (`h-5`, `max-w-[60%]` right-aligned); only live, unlinked tasks with `dueTime`, when "Show tasks" is on
- [X] T093 [US6] Create `frontend/src/features/tasks/calendar/DueStrip.tsx` (row of date-only `TaskMarker`s per day, max 2 visible then "+N more" Popover) and render it in `TimeGrid.tsx` as a new grid row right after the day-header row (≈ lines 180–197, same `gridTemplateColumns`) with `data-testid="due-strip"`; in `frontend/src/features/calendar/MonthView.tsx` list task chips inside each `[data-month-cell]` after the event chips sharing the existing "+N" overflow
- [X] T094 [US6] "On board" indicator: in `frontend/src/features/calendar/EventBlock.tsx` when `session.taskId` render a small Phosphor `Kanban` glyph with sr text "On board" (regardless of "Show tasks"); activating it (separate small button, `data-no-drag`) opens that task's details in the Tasks panel; event-linked tasks get no separate marker
- [X] T095 [P] [US6] E2E in `frontend/tests/e2e/tasks-events-calendar.spec.ts` (calendar part): switch off → no markers; on → timed marker at its time and date-only in `due-strip`, month cell chips; tick → task in Done, untick → previous column; 15 date-only tasks → "+N more"; event block widths unchanged with markers on (compare bounding boxes); "On board" opens the task with the Tasks panel closed beforehand

---

## Phase 14: User Story 7 — Course tasks and export (P2)

**Goal**: Course task lists with quick add; course deletion keeps tasks as personal; CSV export.

**Independent Test**: Quickstart scenario 8.

- [X] T096 [US7] Course deletion in `backend/src/unihelper/services/hierarchy_service.py` `delete_entity` (course) and `delete_year`/semester paths: `UPDATE tasks SET course_id = NULL` for the affected courses' tasks (all, live or soft-deleted); add `taskCount` (live tasks that become personal) to the course `deletion_impact`
- [X] T097 [US7] CSV export: `export_csv(db, user)` in `backend/src/unihelper/services/task_service.py` (UTF-8 with BOM, RFC 4180 quoting via `csv` module, header `Title,Description,Column,Due date,Due time,Course,Linked event,Checklist,Quick notes,Completed at`; checklist cell lines `[x] text`/`[ ] text`; quick notes `Title: body` blocks separated by blank lines; linked event `title (YYYY-MM-DD)`; live tasks in board order) and `GET /tasks/export` in `backend/src/unihelper/api/v1/tasks.py` returning `Response(content, media_type="text/csv; charset=utf-8")` with `Content-Disposition: attachment; filename="{fn}"; filename*=UTF-8''{quote(fn)}` and `Cache-Control: no-store`, filename `{APP}-tasks-{user-local date}.csv` built like `calendar_export_service._filename`
- [X] T098 [P] [US7] Tests: `backend/tests/unit/test_task_csv.py` (quoting, newlines, BOM, Turkish characters, empty export = header only) and `backend/tests/integration/test_task_course_delete.py` (course delete → tasks personal, impact `taskCount`, restoring the course's classes from Trash does not reassign); extend `backend/tests/contract/test_hierarchy_manage.py` for `taskCount` and `backend/tests/contract/test_tasks.py` for `GET /tasks/export` headers
- [X] T099 [US7] Create `frontend/src/features/tasks/CourseTasks.tsx` (open tasks of a course from `useTasks()` filtered by `courseId`, quick add with course preselected via `useCreateTask({title, courseId})`, each task a link to `/?task=<id>`) and render it as a "Tasks" section on `frontend/src/features/courses/CoursePage.tsx` and as a side-panel section registered with `registerSidePanelSection` (`frontend/src/features/sessions/workspace-panels.ts`) for course sessions; "New task" from a course page preselects the course (FR-007)
- [X] T100 [US7] Handle `?task=<id>` in `frontend/src/features/home/HomePage.tsx`: open the Tasks panel (width rules apply), open `TaskDetails` for that id, then `replace` the URL without the param so Back returns to the previous page (the course page)
- [X] T101 [P] [US7] Course delete UI: `impactSentence` in `frontend/src/features/courses/HierarchyMenu.tsx` adds "N tasks will become personal tasks" when `taskCount > 0`; invalidate `["tasks"]` after deletion
- [X] T102 [P] [US7] Create `frontend/src/features/tasks/ExportTasksCard.tsx` (fetch `/api/v1/tasks/export` with raw `fetch` → blob → `saveFile` from `frontend/src/features/settings/calendar-io/api.ts`, `toast.success("Tasks exported")`) and add it to the Import & export settings page next to `ExportCard`
- [X] T103 [P] [US7] E2E in `frontend/tests/e2e/tasks-events-calendar.spec.ts` (course part): course page "Tasks" lists open tasks, quick add preselects the course, activating a task opens home with details, Back returns; course delete dialog shows the count and tasks become personal; Export tasks downloads a CSV whose first line is the header and that contains "ş"

---

## Phase 15: User Story 13 — Focus mode and coming back to the page (P3)

**Goal**: Focus mode hides the left card and rails; navigation away and back restores everything.

**Independent Test**: Quickstart scenario 10.

- [X] T104 [US13] In `HomePage.tsx`, when the shell `focus` flag (`useLayout().focus`) is on, do not render panel rails (open panels stay); closing a panel while in focus mode moves focus to the first control of the other open panel (FR-093) and the shortcut still reopens it; leaving focus restores rails (panel flags are never changed by focus); make sure `FocusModeButton` stays in the Calendar header and add it to the Tasks header when the Calendar panel is closed
- [X] T105 [P] [US13] E2E in `frontend/tests/e2e/home-panels.spec.ts`: `\` hides `#course-panel` and rails, open panels remain; again restores; scroll board and week grid, open a course page, come back → same open state, widths and scroll; a course page and a session workspace look as before (main card present, no Tasks panel)

---

## Phase 16: Polish & Cross-Cutting Concerns

- [X] T106 [P] Extend `frontend/tests/e2e/a11y-themes.spec.ts`: axe on the home page (both panels, rails), `TaskDetails`, `QuickNotesPopover`, Filter popover and `DeleteColumnDialog` in light, dark and one custom theme; no unnamed buttons; two named panel landmarks
- [X] T107 [P] Reduced motion pass: verify panel open/close, card lift, drag clone and toasts have `motion-reduce:` variants or are skipped (`useReducedMotion` from `motion/react` where `motion` is used); add an assertion with `page.emulateMedia({reducedMotion: "reduce"})` in `frontend/tests/e2e/home-panels.spec.ts`
- [X] T108 [P] Performance check: Playwright spec `frontend/tests/e2e/tasks-board.spec.ts` seeds 300 tasks in 12 columns via the API and asserts a drag across columns completes and a filter change renders within 100 ms (`performance.now()` around the interaction), following `calendar-performance.spec.ts`
- [X] T109 Update `frontend/src/features/calendar/ShortcutsDialog.tsx` and tooltips: Shift+C, Shift+T, card keyboard moving (Enter/Space, arrows, Enter, Escape); keep existing entries
- [X] T110 Run the full backend suite (`cd backend && uv run pytest && uv run ruff check . && uv run mypy`) and confirm the contract coverage guard passes with all 19 new operations exercised; fix any gaps
- [X] T111 Run frontend checks (`cd frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test`) and fix failures
- [ ] T112 Walk through `specs/012-task-manager/quickstart.md` manual scenarios 1–10 and record any deviation in `specs/KNOWN-ISSUES.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T006)** → **Foundational (T007–T021)** → all stories.
- **US8 → US9 → US10** (Part B P1, sequential: same files `HomePage.tsx`, panel headers).
- **US1** needs US10 complete (board mounts in the Tasks panel). **US2, US3** need US1 (board,
  card). **US4** needs US3 (details opened from list rows) — its model files (T063, T067) can start
  right after Foundational.
- **US11, US12** need US10 (panels) and can run in parallel with US1–US4 except for `HomePage.tsx`
  edits (serialize T069, T071, T072 with other `HomePage.tsx` tasks).
- **US5** needs US3 (details, card menu); backend T074–T083 can start right after Foundational.
- **US6** needs US5's T080 (`taskId`) for T094 and US3 for opening details; T090–T093 only need US1.
- **US7** backend T096–T098 can start after Foundational; T099–T100 need US3 (details) and US10.
- **US13** needs US9 (rails) and T088 (scroll memory).
- **Polish** after all stories.

### Within each story

Backend model/service → endpoints → contract tests green → `pnpm gen:api` → frontend api hooks →
components → e2e.

## Parallel Opportunities

- Setup: T002, T003, T004, T005 together after T001.
- Foundational: T011 + T012 (tests) with T014 + T015 (frontend model) and T017/T018.
- US1: T037, T038, T040, T041, T044, T045 together; then T039, T042.
- US3: backend T051–T055 in parallel with frontend T057 once `gen:api` ran.
- US5: backend T074–T083 can be built entirely while frontend works on US2–US4.
- US7: T096–T098 backend in parallel with T101–T102 frontend.

### Parallel example: User Story 1

```bash
Task: "T037 dropTarget.ts in frontend/src/features/tasks/board/dropTarget.ts"
Task: "T038 keyboardMove.ts in frontend/src/features/tasks/board/keyboardMove.ts"
Task: "T040 TaskCard.tsx in frontend/src/features/tasks/board/TaskCard.tsx"
Task: "T041 AddTaskField.tsx in frontend/src/features/tasks/board/AddTaskField.tsx"
Task: "T044 unit tests dropTarget/keyboardMove in frontend/tests/unit/"
```

### Parallel example: User Story 5 (backend while frontend does US2–US4)

```bash
Task: "T074 task_link_service.py"
Task: "T081 contract tests for links"
Task: "T082 integration test_task_event_links.py"
Task: "T083 integration test_task_trash.py"
```

## Implementation Strategy

### MVP first

1. Setup + Foundational.
2. US8 → US9 → US10 (panels and rails).
3. US1 (board) → **stop and validate**: a student can capture and move tasks on the home page.

### Incremental delivery (single `/speckit-implement` run, in this order)

US2 → US3 → US4 (Part A P1 complete) → US11 → US12 (Part B P2) → US5 → US6 → US7 (Part A P2) →
US13 (P3) → Polish. Each checkpoint leaves the app working; the full backend and frontend suites
run in T110–T111.

## Notes

- Format: every task is `- [ ] T### [P?] [US?] description with path`.
- [P] = different files and no dependency on an incomplete task.
- Commit after each task or logical group; never weaken the contract coverage guard.
