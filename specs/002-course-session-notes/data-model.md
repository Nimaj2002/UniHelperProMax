# Data Model: Course Timeline & Session Notes (002)

New tables (Alembic revision `0004_notes`). 001 conventions apply (UUIDv7 ids, UTC ISO timestamps,
`version`, every row scoped by `user_id`). Sessions themselves stay computed (001 data-model).

## session_folders

One dated folder per session that has content. Created lazily on the first note (or, in 003,
recording). Never renamed or recomputed.

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK→users ON DELETE CASCADE | |
| course_id | text FK→courses ON DELETE CASCADE | metadata cascades; files stay (FR-019) |
| lineage_id | text | with `original_date` = the session key |
| original_date | date | UNIQUE (lineage_id, original_date) |
| folder_name | text | `YYYY-MM-DD`, else `YYYY-MM-DD HHmm`, else ` (2)`… (001 `class_date_folder_name`) |
| folder_key | text | casefold(folder_name); UNIQUE (course_id, folder_key) |
| start_time, end_time | time | snapshot at creation (for "No longer scheduled" display) |
| title, location | text null | snapshot |
| created_at | text | |

Path: `files/<username>/<year.folder_name>/<semester.folder_name>/<course.folder_name>/<folder_name>/notes/`.

## notes

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK→users ON DELETE CASCADE | |
| session_folder_id | text FK→session_folders ON DELETE CASCADE | |
| name | text | 1–120 chars, display name as typed (trimmed, NFC) |
| name_key | text | casefold; UNIQUE (session_folder_id, name_key) (FR-014) |
| file_name | text | `safe_name(name) + ".md"`, collision-suffixed; UNIQUE (session_folder_id, file_key) |
| file_key | text | casefold(file_name) |
| content_hash | text | SHA-256 hex of the file bytes last written or adopted |
| size | int | bytes |
| version | int | +1 on every content save, rename, or adoption of an external edit |
| created_at, updated_at | text | list order = created_at (FR-016) |

Validation: name required, ≤ 120 chars, not only whitespace; content ≤ 5 MB (≈ 800k words).

States: `ok` → `changed_on_disk` (hash differs) → resolved by adoption (GET) or user choice (PUT);
`missing` (file deleted outside the app) → resolved by "Use mine" (recreate) or deleting the note.

## workspace_states

| Column | Type | Rules |
|---|---|---|
| user_id | text FK→users ON DELETE CASCADE | PK part |
| lineage_id | text | PK part |
| original_date | date | PK part |
| open_note_ids | text (JSON array) | ids of notes in tab order; unknown ids dropped on read |
| active_note_id | text null | must be in `open_note_ids` |
| updated_at | text | |

## ui_preferences

| Column | Type | Rules |
|---|---|---|
| user_id | text PK FK→users ON DELETE CASCADE | |
| data | text (JSON object) | known keys: `editorMode` (`live`\|`raw`, default `live`), `workspaceLeftCollapsed` (bool), `workspaceRightCollapsed` (bool); unknown keys rejected |
| updated_at | text | |

## Timeline entry (computed)

| Field | Source |
|---|---|
| session fields | 001 `Session` (`key`, `date`, `start`, `end`, `title`, `location`, `color`, `status`, …) |
| scheduled | `false` for a session folder whose key the rules no longer generate (FR-006); times/title/location then come from the folder snapshot |
| noteCount | `count(notes)` grouped by session folder |
| audioCount | 0 in 002 (feature 003 adds recordings) |

Range: from the earliest `start_date` of the course's classes to the latest resolved end
(`until`, semester end, or last occurrence of a `count` rule).

## Relationships to 001

- `GET /sessions/{key}` additionally returns unscheduled sessions that have a session folder,
  with `scheduled: false` (additive field; default `true`).
- Deleting a course cascades `session_folders` and `notes` rows (metadata); files stay.
  `workspace_states` rows for sessions that no longer exist are ignored (and dropped on read). Renaming a year/semester/course moves the folder tree that contains session folders (001
  rename logic, unchanged).
