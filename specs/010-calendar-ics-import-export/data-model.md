# Data Model: Calendar Import and Export (.ics)

Migration `0011_calendar_import` adds three tables. No existing table changes: imported classes
and events are ordinary `class_series` / `event_series` / `session_exceptions` rows (Feature
001/009), so everything downstream (sessions, timelines, workspace, Trash, folders on first
content) works unchanged (FR-035).

## New tables

### `calendar_import_uploads` — a staged file awaiting apply (research R2)

| Column | Type | Rules |
|---|---|---|
| `id` | str (uuid7) | PK; the `uploadId` in the API |
| `user_id` | FK users, CASCADE | owner; every lookup filters by it |
| `file_name` | str ≤ 255 | original name, display only (sanitised) |
| `size` | int | 1 … 5,242,880 |
| `sha256` | str(64) | of the staged bytes |
| `staged_name` | str | `<token>.part` inside `files/.uploads/` (never a user path) |
| `event_count` | int | `VEVENT` components, ≤ 5,000 |
| `created_at` / `expires_at` | ISO str | expiry = created + 1 h |

Lifecycle: created by `POST /calendar-imports` → deleted (row + file) on apply success, on
`DELETE`, or when expired (startup sweep and before each upload). A failed apply keeps it so the
user can retry.

### `calendar_import_runs` — one confirmed import (research R13)

| Column | Type | Rules |
|---|---|---|
| `id` | str (uuid7) | PK; `runId` |
| `user_id` | FK users, CASCADE | |
| `file_name` | str ≤ 255 | |
| `file_sha256` | str(64) | |
| `destination_semester_id` | FK semesters, SET NULL | nullable after the semester is deleted |
| `created_json` | text (JSON) | `{lineages: [{id, kind}], courseIds: [], semesterIds: [], yearIds: []}` |
| `updated_json` | text (JSON) | `{lineages: [{id, kind}]}` |
| `summary_json` | text (JSON) | counts + skipped list (`ImportResult` minus ids) |
| `created_at` | ISO str | |
| `undone_at` | ISO str nullable | set once; a second undo → 409 `undo_unavailable` |

### `calendar_import_sources` — where an imported lineage came from (research R11)

| Column | Type | Rules |
|---|---|---|
| `id` | str (uuid7) | PK |
| `user_id` | FK users, CASCADE | |
| `source_uid` | str ≤ 1024 | `UID` from the file |
| `recurrence_key` | str | `""` for a master/one-time entry; ISO local date-time of `RECURRENCE-ID` for an override imported as its own class (R7) |
| `kind` | `class` \| `event` | |
| `lineage_id` | str | the lineage it created/updates (no FK: lineages are segment groups) |
| `first_run_id` | FK calendar_import_runs, SET NULL | |
| `last_run_id` | FK calendar_import_runs, SET NULL | |

Unique `(user_id, source_uid, recurrence_key)`. Index `(user_id, lineage_id)`. Rows are removed
by undo of the creating run and when their lineage is permanently deleted from the Trash (the
purge already deletes by lineage); a row pointing at a lineage in the Trash makes the re-import
skip it.

## Transient structures (not stored)

### Parsed source entry (`domain/ical_read.py`)

`uid`, `title` (trimmed, plain text), `location`, `links: [(label|None, url)]`,
`start_local`, `end_local` (user zone), `source_tz`, `rule: WeeklyRule | Unsupported(reason) |
None`, `rdates`, `exdates`, `overrides: [{recurrence_local, cancelled, start, end, location,
title, links}]`, `app: {kind, year, semester, semesterStart, semesterEnd, course, color,
lineage, originalDate} | None`, `skip_reason | None` (`all_day`, `cancelled`, `invalid_times`),
`notes: [str]` (truncations, dropped links, DST split dates).

### Preview group (`services/calendar_import_service.py`, research R6)

`groupId`, `title`, `entries` (source entry ids), `occurrenceCount`, `patterns`
(`[{weekdays, start, end}]`), `location`, `repeating`, `unsupported` (bool + reason),
`openEnded` (+ suggested `endDate`), defaults (`selected`, `importAs`, `course`, `semester`,
`color`), `matches` (`create | update | unchanged | skip` counts with reasons), `issues`
(`reserved_name`, `title_required`, `kind_mismatch`).

### Import plan (request to apply)

`destination: RefId | RefNewSemester` plus per group: `selected`, `importAs` (`class`|`event`),
`course` (`{existing: id} | {new: name}`; Class only), `semester` (`saved` | `destination`;
app-exported groups only), `endDate` (open-ended repeating groups), `unsupported`
(`first_only` | `skip`; required when the group is unsupported), `title` (when the file's title
is empty).

## Validation rules (from the spec)

| Rule | Where | Error |
|---|---|---|
| File not empty, ≤ 5 MB, valid iCalendar, ≤ 5,000 `VEVENT`s | upload | `file_empty`, 413 `file_too_large`, `not_icalendar`, `too_many_events` |
| Destination required; new semester needs a name (1–80) and a year | apply | 422 `destination_required` / validation |
| Course names 1–120, not the reserved `_Events` | preview issue, apply | 422 `reserved_name` |
| Unsupported group needs a choice | apply | 422 `choice_required` (pointer to the group) |
| Open-ended repeating group: `endDate` ≥ first occurrence, ≤ 500 occurrences | apply | 422 `invalid_end_date` |
| Empty title needs a title (Event) or course (Class) | apply | 422 `title_required` |
| Nothing selected | apply | 422 `nothing_selected` |
| Plan refers to the file it was made for | apply | 409 `upload_expired` (unknown/expired upload) |
| Links: http/https, ≤ 2048 chars, ≤ 10 per entry | read | dropped + preview note |

## State transitions

```text
upload:  (none) ──POST──▶ staged ──apply ok──▶ (deleted)
                           │  └──apply fails──▶ staged (retry)
                           ├──DELETE──▶ (deleted)
                           └──expires──▶ (deleted)
run:     applied ──undo──▶ undone (terminal)
source:  created ──re-import──▶ updated (last_run_id)
         └── lineage trashed ──▶ skipped on re-import ── purge ──▶ (deleted)
```

## Entity relationships

```text
users 1─* calendar_import_uploads
users 1─* calendar_import_runs 1─* calendar_import_sources (first/last run)
calendar_import_sources *─1 lineage (class_series | event_series by lineage_id)
calendar_import_runs *─1 semesters (destination, nullable)
```
