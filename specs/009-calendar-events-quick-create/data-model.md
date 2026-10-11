# Data Model: Calendar Events and Quick Create (009)

Migration **0010_events_trash** (`down_revision "0009"`). Conventions as 001–007: uuid7 string ids,
ISO timestamps, `VersionMixin` for `If-Match`, `name_key = casefold(nfc(trim))`, all rows scoped by
`user_id`. Decisions referenced as R# are in [research.md](./research.md).

## New tables

### event_series (R2)

One rule segment of an event, mirroring `class_series`.

| Column | Type | Rules |
|---|---|---|
| id | str PK | uuid7 |
| user_id | FK users CASCADE | |
| semester_id | FK semesters CASCADE | same for every segment of a lineage (FR-017) |
| lineage_id | str | shared by all segments; occurrence key `{lineage_id}:{YYYY-MM-DD}` |
| split_from_id | FK event_series SET NULL | as class_series |
| title | str 1–120 | required |
| location | str ≤ 200, null | |
| color | str | one of the 12 palette keys; default `blue` |
| start_date, start_time, end_time | date, time, time | end > start |
| freq, interval_weeks, by_weekday, end_kind, until_date, count | as class_series | same validation (`validate_rule`) |
| version, created_at, updated_at | | |

Index: (user_id, semester_id), (lineage_id).

### event_links

`id`, `series_id` FK event_series CASCADE (ORM delete-orphan), `label`, `url`, `position`; ≤ 10 per
series (as `class_links`).

### trash_entries (R6)

| Column | Type | Rules |
|---|---|---|
| id | str PK | |
| user_id | FK users CASCADE | |
| kind | `class` \| `event` | |
| lineage_id | str | the class/event lineage |
| label | str | course name (class) or event title |
| year_name, semester_name | str | for display and restore by name |
| course_name | str, null | class only |
| first_date, last_date | date | dates covered |
| occurrence_count | int ≥ 1 | |
| note_count, recording_count, document_count | int ≥ 0 | at deletion; recomputed on read |
| reason | `delete` \| `hierarchy_delete` | |
| payload_json | text | before-images: segments + links, exceptions removed/changed, ids of cancel exceptions created; schema `TrashPayloadV1` |
| purge_error | text, null | set when a permanent delete could not remove some files |
| deleted_at | ts | list order (newest first) |
| version | int | `If-Match` for restore/purge |

## Changed tables

### session_folders (rebuild, R5/R6)

| Change | Purpose |
|---|---|
| `course_id` → nullable (FK courses SET NULL) | event folders and trashed folders have none |
| + `semester_id` nullable FK semesters SET NULL | owner of event folders |
| + `kind` `class` \| `event` NOT NULL default `class` | which series table `lineage_id` refers to |
| + `trash_entry_id` nullable FK trash_entries SET NULL | set while the folder's occurrence is in the Trash |
| + `origin_path` text null | relative path (`year/semester/course-or-_Events/folder`) recorded when trashed; used to find files while parents may be gone |
| CHECK | `trash_entry_id IS NOT NULL OR (kind='class' AND course_id IS NOT NULL) OR (kind='event' AND semester_id IS NOT NULL)` |
| UNIQUE | (course_id, folder_key), (semester_id, folder_key), (lineage_id, original_date) kept |

Existing rows: `kind='class'`, other new columns NULL. Notes, recordings, documents keep their FK to
`session_folders` (CASCADE) — untouched.

### session_exceptions (ADD COLUMN, R3/R4)

+ `title` str null, `color` str null, `links_json` text null, `moved_date` date null,
`detached` bool default 0. For classes only `start_time`, `end_time`, `location` may be set (service
validation, unchanged behaviour). `detached=1` keeps an occurrence scheduled when the series rule no
longer generates its date (frozen event occurrence).

### courses / semesters / years

No schema change. Course validation: refuse a name whose `safe_name(...).casefold() == "_events"`
(R1). Courses already holding that folder are reported via `reservedNameConflict`.

### ui_preferences.data (JSON, whitelisted)

+ `lastSemesterId: string | null` (default null), `quickCreateType: "class" | "event"`
(default `"class"`).

## Derived objects (not stored)

- **Occurrence** (calendar row): from class or event series expansion, `kind` = class|event,
  `status` past|upcoming (start time rule), excluded when its folder is trashed.
- **Event timeline entry**: occurrence + folder counts (notes, recordings, documents); includes
  detached occurrences; never trashed ones.
- **Draft** (client only): `{date, startMin, endMin, origin: "drag"|"click"|"keyboard"|"month"}`,
  `startMin % 15 == 0`, `endMin - startMin ≥ 15`, `0 ≤ startMin < endMin ≤ 1440`; one at a time;
  form values `{type, courseRef|title+semesterRef, location, links, repeat}` and `dirty`.

## State transitions

```text
Event occurrence:  scheduled ──edit "this"──▶ modified (exception)
                   scheduled ──series edit, has content──▶ frozen (modified + detached)
                   any ──delete (scope)──▶ in Trash (folder.trash_entry_id set)
Trash entry:       created ──Restore──▶ (gone; series/exceptions re-inserted, folders re-attached)
                   created ──Delete + "Yes"──▶ purging ──ok──▶ (gone, files removed)
                                                     └─partial failure──▶ created + purge_error
Quick creation:    draft ──Save ok──▶ created (Undo ≤10 s, no content) ──Undo──▶ (gone)
                   draft ──Cancel/Escape/clean click-outside/leave page──▶ (gone)
```

## Validation rules (server)

- Event: title 1–120 after trim; semester exists and belongs to user; end > start; repeat rules as
  classes (incl. `semester_end` needs an end date → 422 `semester_end_missing`).
- Semester change: 409 `semester_locked` if any folder of the lineage (not trashed) has content.
- Course name: 422 `reserved_name` (R1). Event content in a semester with a conflicting course:
  409 `events_folder_conflict`.
- Restore: 409 `version_conflict` on stale `If-Match`; never overwrites an existing directory.
- Undo creation: 409 `undo_unavailable` if content exists or created hierarchy rows are in use.

## Storage layout

```text
<user>/<year>/<semester>/
├── <course>/<YYYY-MM-DD[ HHmm]>/{notes,audios,documents}/   # unchanged
└── _Events/<YYYY-MM-DD Title[ (n)]>/{notes,audios,documents}/
```

Trashed folders stay exactly where they were; only a permanent delete removes a folder directory.
