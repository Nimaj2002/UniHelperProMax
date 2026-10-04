# Data Model: Class Schedule Calendar (001)

SQLite metadata schema for feature 001, designed so features 002–005 add tables without changing
these. Conventions: ids are UUIDv7 text; timestamps are UTC ISO 8601 text (`created_at`,
`updated_at`); mutable user-facing rows carry an integer `version` (optimistic concurrency, R12);
every user-owned row carries `user_id` and **every query is scoped by it** (FR-002, FR-003c).
Name uniqueness is case-insensitive on the trimmed, NFC-normalised name (`name_key` column =
`casefold(nfc(trim(name)))`).

## Entity overview

```text
users ─┬─< auth_sessions
       └─< years ─< semesters ─< courses ─< class_series ─┬─< class_links
                                                           └─< session_exceptions
(class_series rows sharing a lineage_id form one logical "class" across splits)
```

## users

| Column | Type | Rules |
|---|---|---|
| id | text PK | UUIDv7 |
| username | text | 3–32 chars `[a-z0-9._-]`, stored lowercase, UNIQUE; also the top storage folder |
| password_hash | text | Argon2id |
| role | text | `owner` \| `member`; partial UNIQUE index ensures exactly one `owner` |
| must_change_password | bool | true after owner creates/resets a password (FR-003d) |
| timezone | text | IANA zone, from browser at creation (R5) |
| disabled_at | text null | set when owner disables; disabled users cannot sign in, sessions revoked |
| created_at, updated_at | text | |

Validation: password ≥ 10 characters, not equal to username. State: `active` ↔ `disabled`
(owner only; the owner cannot disable or delete themselves). Deleting a member removes their DB
rows; their storage folder is **kept** on disk (Principle I) and the owner is told its path.

## auth_sessions

| Column | Type | Rules |
|---|---|---|
| id | text PK | SHA-256 of the cookie token (raw token never stored) |
| user_id | text FK→users ON DELETE CASCADE | |
| csrf_token | text | random, mirrored in readable cookie |
| created_at, last_seen_at, expires_at | text | sliding expiry 30 days, absolute max 90 days |

## years

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK→users ON DELETE CASCADE | |
| name | text | 1–80 chars free-form (e.g. "2026", "2026–2027") |
| name_key | text | UNIQUE (user_id, name_key) |
| folder_name | text | safe name (R6); UNIQUE (user_id, casefold(folder_name)) |
| position | int | user-defined display order (FR-022a); 0 = top; UNIQUE (user_id, position); new years get position 0 and existing years shift down by 1 |
| version, created_at, updated_at | | |

Years are listed by `position` ascending. Reordering replaces all positions of the user's years in
one transaction (`PUT /years/order`); deleting a year closes the gap.

## semesters

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK | |
| year_id | text FK→years ON DELETE CASCADE | |
| name, name_key | text | 1–80 chars; UNIQUE (year_id, name_key) |
| folder_name | text | UNIQUE (year_id, casefold(folder_name)) |
| start_date | date null | |
| end_date | date null | if both set, `end_date ≥ start_date` |
| version, created_at, updated_at | | |

Sort order within a year in the course panel (FR-022): by `start_date` desc (nulls last), then
`created_at` desc.

## courses ("syllabus")

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK | |
| semester_id | text FK→semesters ON DELETE CASCADE | |
| name, name_key | text | 1–120 chars; UNIQUE (semester_id, name_key) — same name allowed in other semesters |
| folder_name | text | UNIQUE (semester_id, casefold(folder_name)) |
| default_color | text | palette key (e.g. `blue`), set from the first class's colour (FR-021) |
| version, created_at, updated_at | | |

Search (FR-023): `name_key LIKE '%' || casefold(q) || '%'`, plus an optional SQLite FTS later if
needed (not required at ≤ 200 courses, SC-005).

## class_series

One row per contiguous rule segment of a class. A class edited with "This and following" becomes
two rows sharing `lineage_id`.

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK | |
| course_id | text FK→courses ON DELETE CASCADE | |
| lineage_id | text | = id of the first series of this class; shared across splits; part of the session key |
| split_from_id | text null FK→class_series | previous segment, for history |
| title | text null | optional label shown with the course name (e.g. "Lecture", "Lab"), ≤ 60 chars |
| location | text null | ≤ 120 chars |
| color | text | palette key (12 presets, R10) |
| start_date | date | DTSTART date (first possible session) |
| start_time, end_time | time | local wall-clock; `end_time > start_time` (no midnight crossing) |
| freq | text | `none` \| `weekly` |
| interval_weeks | int | ≥ 1 (weekly only) |
| by_weekday | text | comma list of `MO,TU,WE,TH,FR,SA,SU`; required non-empty for weekly |
| end_kind | text | `never` \| `semester_end` \| `until` \| `count` (`never` disallowed in UI for weekly; kept for imports) |
| until_date | date null | required for `until`; `≥ start_date` |
| count | int null | required for `count`; 1–500 |
| version, created_at, updated_at | | |

Validation (FR-013, FR-015, FR-017, edge cases): `semester_end` requires the semester to have an
`end_date` (else 422 `semester_end_missing`); start date after resolved end → 422
`series_ends_before_start`; weekly with empty `by_weekday` → 422.

## class_links

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| series_id | text FK→class_series ON DELETE CASCADE | copied to the new segment on split |
| label | text null | ≤ 60 chars |
| url | text | absolute `http(s)://` URL, ≤ 2048 chars |
| position | int | display order |

## session_exceptions

Single-session changes (scope "This session", FR-018a).

| Column | Type | Rules |
|---|---|---|
| id | text PK | |
| user_id | text FK | |
| lineage_id | text | with `original_date` = the session key; survives splits |
| original_date | date | date the rule generated; UNIQUE (lineage_id, original_date) |
| kind | text | `cancelled` \| `modified` |
| start_time, end_time | time null | overrides for `modified` (same date; `end > start`) |
| location | text null | override for `modified` |
| version, created_at, updated_at | | |

## Session (computed, not stored)

Produced by expanding `class_series` for a date range, then applying `session_exceptions`.

| Field | Source |
|---|---|
| key | `"{lineage_id}:{original_date}"` — stable identifier used by 002–004 |
| seriesId, lineageId, courseId | from series |
| date | `original_date` (single-session changes keep the date in v1) |
| start, end | ISO 8601 with offset: date + (override or series) time in `users.timezone` |
| title, location, color, links | series values, location overridden by exception |
| isException | true if a `modified` exception applies |
| status | `upcoming` if `now < start`, else `past` (002 uses this; styling only — recording is always allowed) |

Cancelled exceptions remove the session from results. Sessions that lost their series but have
attached content are surfaced by 002 ("No longer scheduled") using its own content index.

### Expansion algorithm

1. Resolve the end: `until_date`, `count`, or semester `end_date` (read at query time, so moving the
   semester end moves the sessions).
2. `rrule(WEEKLY, interval, byweekday, dtstart=start_date, until|count)` clipped to the requested
   range; `freq=none` yields only `start_date`.
3. Drop dates with a `cancelled` exception; apply `modified` overrides.
4. Combine wall-clock times with the user's zone (`zoneinfo`) → aware datetimes (correct across DST).

## Edit scopes (state transitions, FR-018a)

| Scope | Effect |
|---|---|
| This session | upsert `session_exceptions(lineage_id, original_date)`: `cancelled` for delete, `modified` with overrides for edit |
| This and following | if date = series `start_date`: behaves like "All sessions" for this segment and later segments. Otherwise: set old segment `end_kind=until`, `until_date = date − 1 day`; insert new segment (same `lineage_id`, `split_from_id` = old, `start_date = date`, new values, original end rule; links copied). For **delete**, only the truncation happens. Later segments of the same lineage are updated/deleted the same way. Exceptions on or after the date stay (keyed by lineage) unless the new rule no longer generates that date, in which case they are deleted (they no longer refer to a session). |
| All sessions | update every segment of the lineage; `modified` exceptions keep their individual overrides (spec: user is told how many). Delete removes all segments, links and exceptions of the lineage. |

All scope operations run in one transaction and bump `version` on touched rows.

## Folder naming (contract with 002/003)

`year.folder_name / semester.folder_name / course.folder_name` are created when the row is created
(FR-025) under `data/files/<username>/`. Dated session folders are **not** created in 001. 002 will add
a `session_folders(lineage_id, original_date, course_id, folder_name)` table, assigning
`YYYY-MM-DD` or `YYYY-MM-DD HHmm` at first content creation (full rules in
[contracts/storage-layout.md](./contracts/storage-layout.md)).

## Reserved for later features (not created in 001)

| Feature | Tables |
|---|---|
| 002 | `session_folders`, `notes` (index of `.md` files: session key, name, file name, version, hash), `workspace_state` |
| 003 | `recordings`, `recording_chunks` (progressive upload bookkeeping) |
| 004 | `transcription_jobs` |
| 005 | `user_settings`, `provider_configs` (secrets encrypted at rest), `themes` |
