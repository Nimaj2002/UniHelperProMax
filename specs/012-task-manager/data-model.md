# Data Model: Task Manager and Home Page Panels

SQLite via SQLAlchemy; Alembic migration `backend/src/unihelper/db/migrations/versions/0012_tasks.py`
(`revision="0012"`, `down_revision="0011"`). All new tables use the existing mixins from
`models/base.py`: `IdMixin` (uuid7 string `id`), `TimestampMixin` (`created_at`, `updated_at`),
`VersionMixin` (`version`, bumped on every update, used by `If-Match`). Every table carries
`user_id → users.id ON DELETE CASCADE`; every query filters on the current user.

## task_columns — `models/task_column.py` `TaskColumn`

| Field | Type | Rules |
|---|---|---|
| id, user_id, created_at, updated_at, version | mixins | |
| name | str(40) | required, trimmed, 1–40 chars; unique per user ignoring case → `UniqueConstraint` on (`user_id`, `name_key`) |
| name_key | str(40) | `casefold(name)`; maintained by the service |
| position | int | 0..n-1; `UniqueConstraint(user_id, position)`; renumbered in two passes (R3) |
| counts_as_done | bool | default false |

- A user has 1–12 columns (service check: `column_limit` 409 at 13, `last_column` 409 when
  deleting the only one).
- **Seeding**: on first `GET /task-columns` for a user with none, the service creates
  To do (0), In progress (1), Done (2, `counts_as_done=true`) — idempotent.
- **Changing `counts_as_done`**: true → every live task in the column gets `completed_at = now`
  (and `previous_column_id` unchanged); false → their `completed_at` is cleared.
- **Delete**: empty column → hard delete (client offers Undo by re-creating, R6). Column with live
  tasks → requires `moveTo` (another column id); tasks are appended to it in their current order,
  `completed_at` re-evaluated by the target's flag. Soft-deleted and trashed tasks whose
  `column_id` points at a deleted column are re-homed to the first column when restored.

## tasks — `models/task.py` `Task`

| Field | Type | Rules |
|---|---|---|
| id, user_id, created_at, updated_at, version | mixins | |
| column_id | str FK → task_columns.id | required (no DB cascade; service moves tasks before deleting a column) |
| position | int | 0..n-1 within the column among live tasks |
| title | str(200) | required, trimmed, 1–200 chars; for linked tasks = cached event title (read-only via API) |
| description | text | optional, plain text, ≤ 20 000 chars |
| due_date | date | optional; for linked tasks = occurrence's effective date (moved date if moved) |
| due_time | time | optional, requires `due_date`; for linked tasks = occurrence start |
| course_id | str FK → courses.id, nullable | optional; must belong to the user; set NULL by the service when the course is deleted |
| event_key | str, nullable | `"{lineage_id}:{original_date}"`; must be an event (not class) occurrence of the user |
| completed_at | ISO datetime, nullable | set when entering a `counts_as_done` column, cleared when leaving |
| previous_column_id | str, nullable | column the task was in before completion (calendar untick, R16) |
| deleted_at | ISO datetime, nullable | soft delete for Undo (R6); hard-deleted after 24 h |
| trash_entry_id | str FK → trash_entries.id, nullable | set when deleted together with its event (R5) |

Indexes / constraints:
- `ix_tasks_user_column_position` (`user_id`, `column_id`, `position`).
- Partial unique `uq_tasks_event_key` on (`user_id`, `event_key`) WHERE `event_key IS NOT NULL AND
  deleted_at IS NULL AND trash_entry_id IS NULL` (FR-038).
- `ix_tasks_course` (`user_id`, `course_id`), `ix_tasks_trash` (`trash_entry_id`).

**Live task** = `deleted_at IS NULL AND trash_entry_id IS NULL`. Only live tasks appear in any
list, count, calendar or export.

### State transitions

```text
            create (title only)                        move into done column
   ──────────────► Open (column, position) ───────────────────────────► Done (completed_at)
                      ▲    │  move/reorder                                │
                      │    └──────────────┐   move out of done column     │
                      │                   └◄───────────────────────────────┘
   DELETE ──► SoftDeleted(deleted_at) ── restore (≤24 h, Undo) ──► Open/Done as before
                      └── 24 h ──► hard delete (checklist + quick notes with it)

   Linked:  event edit/move → title/due follow (sync_lineage)
            event deleted, linkedTasks=keep   → Unlinked (event_key NULL, cache kept)
            event deleted, linkedTasks=delete → Trashed(trash_entry_id) ── restore entry ──► Linked again
                                                                        ── purge entry ──► hard delete
            occurrence no longer generated (not trashed) → Unlinked
```

## task_checklist_items — `models/task.py` `TaskChecklistItem`

| Field | Type | Rules |
|---|---|---|
| id, user_id, created_at, updated_at | mixins | |
| task_id | FK → tasks.id ON DELETE CASCADE | |
| text | str(500) | required, trimmed |
| done | bool | default false |
| position | int | 0..n-1 within the task |

Edited through the task (`PUT /tasks/{id}/checklist` replaces the whole list with the task's
`If-Match`), keeping the task's version as the single concurrency token for its details.

## task_quick_notes — `models/task.py` `TaskQuickNote`

| Field | Type | Rules |
|---|---|---|
| id, user_id, created_at, updated_at, version | mixins | |
| task_id | FK → tasks.id ON DELETE CASCADE | |
| title | str(200) | optional (may be empty) |
| body | text | optional plain text, ≤ 20 000 chars |
| deleted_at | ISO datetime, nullable | soft delete for Undo; hard-deleted after 24 h |

A note with empty title and body is never persisted by the client (it is discarded when the
pop-up closes); the API rejects creating one (`empty_quick_note` 422).

## Changes to existing models and schemas

| Where | Change |
|---|---|
| `schemas/classes.py` `SessionOut` | + `taskId: str \| null` (events only; batch lookup of live linked tasks in `session_query.list_sessions` / `get_session`) |
| `schemas/...` `SessionDeletionImpact`, hierarchy `DeletionImpact` | + `linkedTaskCount: int` (live tasks linked to the occurrences/lineages being deleted); hierarchy course impact + `taskCount: int` (tasks that become personal) |
| `schemas/trash.py` `TrashEntryOut` | + `taskCount: int` (tasks flagged with the entry) |
| `schemas/events.py` event create body | + optional `addToBoard: { columnId: str }` |
| `DELETE /sessions/{key}`, `/years/{id}`, `/semesters/{id}`, `/courses/{id}` | + query `linkedTasks: keep \| delete` (default `keep`) |
| creation record (`services/creation_undo.py`) | records the task created by `addToBoard` so Undo removes it |
| `trash_service.restore` / `purge` | restore clears `trash_entry_id` (re-home column if needed, unlink if the occurrence already has a task); purge hard-deletes flagged tasks |
| `hierarchy_service.delete_entity` (course) | `UPDATE tasks SET course_id = NULL` for the course |

No change to `trash_entries` columns or its `kind` CHECK; no change to `ui_preferences`.

## Browser-only state (localStorage via `lib/storage.ts`)

| Key | Value | Feature |
|---|---|---|
| `uh.home.panels` | `{ calendar: bool, tasks: bool }` | which panels are open (FR-083) |
| `uh.home.tasksWidth` | number (px) | Tasks panel width (FR-067/068) |
| `uh.tasks.view` | `"board" \| "list"` | view (FR-034) |
| `uh.tasks.filters` | `{ course: string \| "personal" \| null, eventLinked: bool, search: string, showDone: bool }` | filters (FR-034) |
| `uh.calendar.showTasks` | bool | calendar markers (FR-046) |

In memory only (module-level, survives in-app navigation, not reload): panel scroll positions,
list group collapse state, pre-focus nothing (focus mode does not mutate panel flags).

## Derived values (client, `features/tasks/model/`)

- `isDone(task)` = its column `countsAsDone`.
- `isOverdue(task, now, tz)` and `dueBucket(task, now, tz, weekStart)` →
  `overdue | today | thisWeek | later | noDate | done` (R9).
- `openCount` = live tasks not Done; `overdueCount` = open and overdue (Tasks rail).
- `cardSummary` = checklist `done/total`, quick-note count, event marker.
