# Implementation Plan: Task Manager and Home Page Panels

**Branch**: `012-task-manager` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-task-manager/spec.md` (Part A task manager,
Part B home page panels, merged from the former 011; 5 clarifications of 2026-10-15).

## Summary

Students get a per-user kanban task manager (custom columns, board and list views, details sheet
with autosave and checklist, quick notes, filters, Undo everywhere) living in a new **Tasks
panel** on the home page, next to a **Calendar panel** and the existing left card. Both panels
close to 44 px rails under width rules (Calendar ≥ 480 px, Tasks 320 px–60 %), with Shift+C /
Shift+T, focus-mode and back-navigation restoration. Priority 2 links tasks to event occurrences
(Add to kanban, sync on every event change, Trash entry inclusion and restore, Open note), shows
tasks on the calendar behind a "Show tasks" switch, lists course tasks, and exports CSV.

Technical approach: three new SQLite tables plus a checklist table, one new backend router family
(`tasks`, `task-columns`, `quick-notes`) following the existing layer split, link sync-on-write
keyed by the stable session key, linked tasks flagged into Trash entries (R5). Frontend: new
`features/home` (panels, rails, width rules) and `features/tasks` (board with a ported,
dependency-free pointer drag, keyboard move reducer, list, details, quick notes), small
extensions to the shell, calendar, events, courses and settings.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.9 / React 19.3 (frontend) — as 001–010.

**Primary Dependencies**: no new packages. Backend FastAPI, SQLAlchemy, Alembic, Pydantic;
frontend shadcn/ui (Radix: Sheet, Popover, AlertDialog, DropdownMenu, Select, Switch, ToggleGroup,
Tooltip, Checkbox), TanStack Query, Sonner (Undo toasts), Phosphor icons, `@date-fns/tz`, the
existing `PanelResizeHandle`, `lib/shortcuts.ts`, `lib/storage.ts`, `calendar/draft.ts`
(`edgeSpeed`, `isClick`). Drag logic ported from `design/reference/astryx-kanban-board.tsx` (MIT,
attributed) — no Astryx/StyleX install (R1).

**Storage**: SQLite migration `0012_tasks`: new `task_columns`, `tasks`, `task_checklist_items`,
`task_quick_notes` (data-model.md). No file-system content; no change to `trash_entries` columns
or `ui_preferences`. Browser-only state in localStorage (`uh.home.*`, `uh.tasks.*`,
`uh.calendar.showTasks`).

**Testing**: pytest unit/contract/integration (R21) with the contract coverage guard
(`tests/contract/test_coverage.py`, `conftest.pytest_sessionfinish`) covering the 19 new
operations in `contracts/openapi.yaml`; migration test 0012; Vitest (width rules, keyboard move
reducer, drag target math, grouping/overdue, filters); Playwright light + dark (panels, board,
list/details, events/calendar, a11y with axe incl. a custom theme).

**Target Platform**: evergreen desktop browsers, window widths ≥ 800 px (phones/tablets out of
scope).

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: SC-006 — 300 tasks / 12 columns: drag follows the pointer every frame
(rAF-throttled, no network or cache writes during drag), move/filter/view switch < 100 ms
perceived (optimistic cache updates, derived views memoized); `GET /tasks` ≤ 150 ms for 300 tasks;
panel open/close ≤ 200 ms.

**Constraints**: Constitution v1.2.0 I (autosave with visible state, Undo or confirmation for
every delete, failed saves keep data), III (only `/api/v1`, documented contracts), V (shadcn/ui,
tokens, keyboard, AA, reduced motion), VI (endpoint + flow tests), VII (no new dependency or
service). Feature 008 shell rules (card look, 1100 px rule, focus mode, `[ / \` shortcuts) unchanged.

**Scale/Scope**: one board per user, ≤ 12 columns, hundreds of tasks; ~19 new endpoints, ~6
amended; ~35 new frontend modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — still passing.*

| Principle | Assessment |
|---|---|
| I. User work is never lost | **Pass.** Details and quick notes autosave with a visible state (`useSaveStatus`); failed saves keep values and warn on close (R7); deletes of tasks, quick notes, checklist items and empty columns offer ≥ 10 s Undo (R6); column-with-tasks, event and course deletions confirm and name counts; linked tasks deleted with events go to the Trash and come back on restore (R5); version conflicts never drop typed input. |
| II. Data ownership & open formats | **Pass (interpretation to confirm).** No notes, audio or documents are created; tasks and quick notes are short plain-text metadata of a task stored in SQLite, not Markdown session notes (R20). CSV export (FR-053) keeps them portable. Event folders and the reserved events folder are untouched. |
| III. Frontend/backend separation | **Pass.** All access via `/api/v1`; every new and amended operation is in `contracts/openapi.yaml`; additive fields only, so no new API version. |
| IV. Transcription & secrets | **N/A.** Not touched. |
| V. UI quality & accessibility | **Pass.** shadcn/ui primitives only; the board is ported onto them (no Astryx); token colors only (`bg-muted`, `border-draft-border`, `--warning`, course color + name); never color alone (text/glyph for Today/Overdue/Done/columns); full keyboard moving, landmarks, announcements, focus return; reduced motion; axe in light/dark/custom. |
| VI. Tests | **Pass.** Contract tests for every new/amended operation; integration flows for event link sync, Trash restore/purge with tasks, course deletion, creation undo, isolation; critical flows 1–3 unchanged and still run. |
| VII. Simplicity & spec discipline | **Pass.** No new dependency, service or infrastructure; scope = merged spec (scope changes went through `/speckit-clarify`); the shell gains one context flag (`bareMain`) rather than a new layout system. |

## Project Structure

### Documentation (this feature)

```text
specs/012-task-manager/
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R21)
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── openapi.yaml     # 19 new operations + amended ones
│   └── ui-home-tasks.md # routes, ids, roles, keys, components
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/src/unihelper/
├── models/task_column.py                 # TaskColumn (new)
├── models/task.py                        # Task, TaskChecklistItem, TaskQuickNote (new)
├── models/__init__.py                    # export new models
├── schemas/tasks.py                      # TaskColumn*, Task*, ChecklistReplace, QuickNote* (new)
├── schemas/classes.py                    # SessionOut + taskId
├── schemas/events.py                     # event create + addToBoard
├── schemas/trash.py, schemas/hierarchy.py# + taskCount / linkedTaskCount
├── services/task_column_service.py       # seed, create, rename, done flag, reorder, delete+moveTo (new)
├── services/task_service.py              # list, get, create, patch, move, checklist, soft delete/restore, purge_expired, export CSV (new)
├── services/quick_note_service.py        # list, create, patch, soft delete/restore (new)
├── services/task_link_service.py         # sync_lineage, unlink/trash/restore/purge hooks, impact counts (new)
├── services/event_service.py             # call sync_lineage after edits/semester change; addToBoard on create
├── services/creation_undo.py             # record + undo the addToBoard task
├── services/trash_service.py             # linkedTasks keep|delete, restore/purge flagged tasks, taskCount
├── services/hierarchy_service.py         # course → personal tasks; linkedTasks on year/semester/course delete
├── services/session_query.py             # taskId batch lookup
├── services/calendar_import_service.py   # sync_lineage after applying an import that edits events
├── api/v1/tasks.py                       # tasks, task-columns, quick-notes routers (new; export before {taskId})
├── api/v1/sessions.py, api/v1/hierarchy.py, api/v1/events.py  # new query param / body field
├── main.py                               # register tasks router; purge_expired at startup
└── db/migrations/versions/0012_tasks.py  # new

backend/tests/
├── contract/test_tasks.py, test_task_columns.py, test_quick_notes.py          # new
├── contract/test_trash.py, test_sessions_events.py, test_hierarchy_manage.py  # extended
├── integration/test_task_event_links.py, test_task_trash.py, test_task_course_delete.py, test_migration_0012.py  # new
├── integration/test_account_isolation.py                                       # extended
└── unit/test_task_order.py, test_task_csv.py                                   # new

frontend/src/
├── app/router.tsx                        # index → HomeLayout (calendar routes moved under it)
├── app/shell/layout.tsx, AppShell.tsx    # bareMain flag (main column without Card chrome)
├── features/home/
│   ├── routes.tsx, HomeLayout.tsx, HomePage.tsx      # panels, shortcuts, announcer, ?task=
│   ├── CalendarPanel.tsx, TasksPanel.tsx, PanelRail.tsx
│   ├── homeWidths.ts, usePanels.ts, scrollMemory.ts
├── features/tasks/
│   ├── api.ts                            # queries/mutations, optimistic move, Undo helpers
│   ├── model/dates.ts, model/group.ts, model/filters.ts, model/counts.ts
│   ├── TasksHeader.tsx, TaskFilters.tsx, TaskSearch.tsx
│   ├── board/Board.tsx, BoardColumn.tsx, TaskCard.tsx, ColumnMenu.tsx, AddTaskField.tsx
│   ├── board/useBoardDrag.ts (MIT-attributed port), board/keyboardMove.ts, board/dropTarget.ts
│   ├── list/TaskList.tsx
│   ├── TaskDetails.tsx, ChecklistEditor.tsx, QuickNotesPopover.tsx, DeleteColumnDialog.tsx
│   ├── CourseTasks.tsx                   # course page + side-panel section
│   ├── calendar/TaskMarkers.tsx, calendar/DueStrip.tsx, calendar/OnBoardIndicator.tsx
│   ├── AddToKanbanFields.tsx, AddToKanbanAction.tsx (session action), LinkedTasksChoice.tsx
│   └── ExportTasksCard.tsx
├── features/calendar/                    # CalendarToolbar compact mode + Show tasks; TimeGrid strip/markers layer; MonthView chips; EventBlock indicator; useCalendarKeyboard guard; ShortcutsDialog entries
├── features/events/EventForm.tsx, features/calendar/QuickCreateForm.tsx   # Add to kanban fields
├── features/classes/DeleteSessionFlow.tsx, features/courses/HierarchyMenu.tsx  # linked-task choice, counts
├── features/courses/CoursePage.tsx       # CourseTasks section
└── features/settings/calendar-io/…       # Export tasks card

frontend/tests/
├── unit/homeWidths.test.ts, usePanels.test.ts, keyboardMove.test.ts, dropTarget.test.ts,
│   taskGroups.test.ts, taskDates.test.ts, taskFilters.test.ts, TaskCard.test.tsx, TaskDetails.test.tsx
└── e2e/home-panels.spec.ts, tasks-board.spec.ts, tasks-list-details.spec.ts,
    tasks-events-calendar.spec.ts, a11y-themes.spec.ts (extended)
```

**Structure Decision**: Existing web-application layout. Backend follows the layer split
(`models/`, `schemas/`, `services/`, `api/v1/`), registered in `main.build_api_router()`. Frontend
adds two feature folders (`home`, `tasks`) and small, listed extensions to existing features.

## Implementation Order (for one `/speckit-implement` run)

1. **Foundation**: migration + models + column/task services and routers + contract tests;
   `gen:api`; shell `bareMain`; home route; `homeWidths`/`usePanels`.
2. **Part B P1 (Stories 8–10)**: Calendar and Tasks panels, rails, close/reopen, at least one
   open, shortcuts, announcements — prerequisite for every Part A story.
3. **Part A P1 (Stories 1–4)**: board + drag + keyboard move, columns, details + checklist +
   autosave + Undo, quick notes, list + filters.
4. **Part B P2/P3 (Stories 11–13)**: divider, width rules/notices, narrow windows, focus mode,
   scroll memory and back navigation.
5. **Part A P2 (Stories 5–7)**: link sync + Add to kanban + deletion choices + Trash + Open note;
   calendar markers; course tasks; course deletion; CSV export.
6. **Polish**: axe in all themes, reduced motion, shortcuts dialog, quickstart run.

## Complexity Tracking

No constitution violations to justify. Recorded interpretation for the owner: quick notes are
task metadata stored in SQLite (Principle II applies to Markdown session notes) — R20.
