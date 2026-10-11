# Research: Calendar Import and Export (.ics)

Decisions for feature 010. Each entry: **Decision**, **Rationale**, **Alternatives considered**.
Codebase facts this builds on: classes and events are rule *segments* (`class_series` /
`event_series`) sharing a `lineage_id`; occurrences are expanded on read by the pure
`domain/recurrence.py` (weekly only: `freq ∈ {none, weekly}`, `interval_weeks` 1–8, weekday set,
end `never | semester_end | until | count ≤ 500`); single-occurrence changes are
`session_exceptions` keyed by `(lineage_id, original_date)`; times are stored as **wall-clock
times in `users.timezone`**; session folders are created on first content (009), so imported
entries get folders exactly as hand-made ones do.

## R1 — iCalendar parsing and writing library

**Decision**: Add the Python package `icalendar` (≥ 6.1, < 8) to the backend. Use it to parse
(line unfolding, escaping, parameters, `VTIMEZONE`, `TZID` resolution including Windows zone
names written by Outlook) and to write (folding, escaping, `VTIMEZONE` built from the IANA zone).
Recurrence expansion stays on `python-dateutil` (already a dependency) via `rrulestr`, so the
app's own `recurrence.py` remains the single source of occurrence truth.

**Rationale**: RFC 5545 has many details that real exports from Google, Apple and Outlook all
use (folded lines, `TZID` with custom `VTIMEZONE`, Windows names like "Turkey Standard Time",
escaped commas, `VALUE=DATE`). A small hand-written parser would have to re-implement and test
all of them, and SC-002/SC-003 depend on getting them right. `icalendar` is pure Python,
BSD-licensed, maintained, and uses `zoneinfo` (no `pytz`). Justified in plan Complexity
Tracking (Principle VII).

**Alternatives considered**: hand-written parser/writer (≈ 400 lines + tests; most risk in time
zones and folding); `ics` package (less complete `VTIMEZONE`/`RECURRENCE-ID` support);
`recurring-ical-events` (expansion we do not need: we map rules, we don't flatten them).

## R2 — Upload flow: stage, preview, apply

**Decision**: Two steps against a staged file.
1. `POST /calendar-imports` streams the raw `.ics` body (≤ 5 MB, existing `api/uploads.py`
   `receive_upload`) to `files/.uploads/<token>.part`, records a `calendar_import_uploads` row
   (token, user, file name, size, sha256, expiry 1 h), parses it, and returns the **preview**.
2. `POST /calendar-imports/{uploadId}/apply` takes the user's **plan** (per group: selected,
   type, course mapping/rename, end date, "not supported" choice; destination semester) and
   re-parses the staged file deterministically to apply it in one transaction.
3. `DELETE /calendar-imports/{uploadId}` discards the staged file (Cancel). Expired uploads
   are removed at startup and before each new upload. The file is deleted after a successful
   apply ("the file itself is not kept").

**Rationale**: The preview needs server-side parsing (Principle III: frontend never interprets
storage-bound data on its own) and the apply must see exactly the same file; re-uploading 5 MB
would double the wait. Group ids are deterministic (R6), so the plan refers to preview groups
without storing the preview. Progress and cancel come from the existing XHR uploader
(`frontend/src/lib/api/upload.ts`); server parsing of 5 MB / 5,000 events is well under the
10 s of SC-008.

**Alternatives considered**: stateless apply with re-upload (double transfer); parse in the
browser (duplicates the parser in TS and breaks Principle III); storing the parsed preview as
JSON in the DB (more state, same result).

## R3 — File checks (FR-013)

**Decision**: Rejected before the preview, each with its own problem code and nothing changed:
`file_empty` (0 bytes or only whitespace), `file_too_large` (413, > 5 MB — checked from
`Content-Length` and while streaming), `not_icalendar` (no `BEGIN:VCALENDAR` … `END:VCALENDAR`,
or the parser fails), `too_many_events` (> 5,000 `VEVENT` components, overrides included),
`no_events` is **not** an error: the preview opens and says the file has no events (spec edge
case). Decoding: UTF-8 (with or without BOM); invalid bytes → `not_icalendar`.

**Rationale**: Mirrors FR-013 and the spec's edge cases with stable codes the UI maps to messages.

**Alternatives considered**: lenient partial parsing of broken files (would import a guessed
subset — against FR-031).

## R4 — Mapping recurrence rules (FR-019, FR-030)

**Decision**: A `VEVENT` with `RRULE` is **supported** when, after normalisation, it is
`FREQ=WEEKLY`, `INTERVAL` 1–8, `BYDAY` plain weekdays (no ordinals; missing → the weekday of
`DTSTART`), optional `UNTIL` or `COUNT` (≤ 500), and no other `BY*` parts. `WKST` other than
`MO` is accepted only when the expanded dates equal those of the app rule with `WKST=MO`
(checked by expanding both over the series; only matters for `INTERVAL > 1` with several days).
Mapping: `COUNT` → `end_kind=count`; `UNTIL` → `end_kind=until` with the local date of `UNTIL`;
neither → `end_kind=until` with the preview's end date (default `first occurrence + 16 weeks`,
FR-020). Multiple `RRULE`s, `EXRULE`, `FREQ` other than weekly, `BYSETPOS`/`BYMONTH`/
`BYMONTHDAY`/`BYHOUR`… → **not supported**, with choices "Import first occurrence only" or
"Skip" (no default; the plan must state one per group). `RDATE` values become additional one-time
entries of the same group, reported in the preview.

**Rationale**: Exactly the app's rule space (Feature 001 FR-015); anything else would be a
silent approximation.

**Alternatives considered**: converting `FREQ=DAILY` to "weekly on all 7 days" (exact, but the
spec lists daily as not supported — keep the spec's rule; easy to add later); flattening
unsupported rules into many one-time entries (the spec offers first-occurrence-only or skip).

## R5 — Time zones and daylight saving

**Decision**: All imported times end up as wall-clock times in `users.timezone`.
- `DTSTART;TZID=…` (IANA, Windows name, or a custom `VTIMEZONE` from the file): converted per
  occurrence into the user's zone.
- `…Z` (UTC): converted per occurrence. For a **repeating** event with a UTC or floating
  `DTSTART`, the rule is anchored in the calendar's zone (`X-WR-TIMEZONE` when present, otherwise
  the user's zone) so its local time stays the same across DST (spec FR-030).
- Floating (no zone): the user's zone.
- If a repeating series' converted local start/end changes inside the series (source zone and
  user zone have different DST rules), the series is **split into segments of one lineage** at
  each change, each segment a weekly rule with its own times (lineage segments already exist for
  "this and following" edits). The preview shows "Times change on <date> (daylight saving in
  <source zone>)" for that group.
- All-day (`VALUE=DATE`) events and events whose local end is on a later day than their local
  start are skipped with "all-day events are not supported yet" (FR-029). `DURATION` is turned
  into an end time.

Export writes `DTSTART;TZID=<user zone>` / `DTEND;TZID=…` with one `VTIMEZONE` for the user's
zone (generated by `icalendar` from `zoneinfo`, covering the exported date range), `X-WR-TIMEZONE`
set to the same zone, and `UNTIL` in UTC as RFC 5545 requires when `DTSTART` has a `TZID`. Because
times are stored as wall-clock values, every occurrence keeps its wall-clock time across DST
(FR-008). `EXDATE` and `RECURRENCE-ID` carry the same `TZID` and the series' original start time.

**Rationale**: Matches how the app stores times and how Google/Apple/Outlook interpret
`TZID` + `VTIMEZONE`; splitting is the only exact representation when zones disagree.

**Alternatives considered**: storing UTC instants (would change the whole app's model, out of
scope); ignoring source-zone DST (silently shifts some weeks by an hour).

## R6 — Grouping and deterministic ids

**Decision**: A **source entry** is one master `VEVENT` (by `UID`, with its overrides) or a
standalone `VEVENT` without `RRULE`. Groups are keyed by the case-folded, space-trimmed title
(`""` → "(No title)"). `groupId = sha1(title_key)[:12]`; `entryId = sha1(UID + RECURRENCE-ID?)`.
Group summary: number of occurrences it would create (after EXDATEs, within the end), weekday/time
combinations, most common location, `repeating` (any entry has a supported or unsupported
`RRULE`), and per-entry issues. Defaults: repeating → selected, Class; one-time → not selected,
Event (FR-016); app-exported entries → their saved type/semester/course/color (FR-017).

**Rationale**: Ids derived from the file let the apply step refer to preview rows with no
stored preview (R2) and stay stable if the user re-uploads the same file.

## R7 — Overrides (RECURRENCE-ID) and cancellations

**Decision**:
- `RECURRENCE-ID` with `STATUS:CANCELLED`, and `EXDATE` → `session_exceptions` `kind=cancelled`.
- Override on the **same local date** changing time/location → `kind=modified` with times and
  location (allowed for classes and events).
- **Events** only: override changing date, title or links → `modified` with `moved_date`,
  `title`, `links_json` (009 supports these on event occurrences).
- **Classes**: an override moving to another date → the original date is cancelled and a one-time
  class of the same course is created (own lineage, source key `UID + RECURRENCE-ID`), reported
  in the result as "moved occurrence imported as a single class". A title change on a class
  occurrence is not kept (a class's title is its course) and is listed in the result.
- A `RECURRENCE-ID` the rule does not generate → one-time entry of the same group (spec edge case).
- Master `STATUS:CANCELLED` → skipped (FR-028). `EXDATE` with no matching occurrence → ignored.

**Rationale**: Reuses the 001/009 exception model unchanged; everything else is reported, never
dropped silently (FR-031).

## R8 — Reading text and links (FR-025–FR-027)

**Decision**: Title (`SUMMARY`) and location trimmed and stored as plain text (no markup is ever
rendered: the UI already renders these as text nodes); over-length values are cut to the column
limits (class location 120, event title/location 120/200, course name 120) with a preview note.
Links, deduplicated, in order: `URL`; Google Meet (`X-GOOGLE-CONFERENCE`, or RFC 7986
`CONFERENCE` with an http(s) URI) labelled "Google Meet"/"Meeting"; `ATTACH` URIs (label from
`FILENAME`/`X-FILENAME` parameter); then http(s) URLs found in `DESCRIPTION`. `DESCRIPTION` is
read as text: HTML anchors' `href`s are extracted and tags ignored; Google's join block (the text
between the `-::~:~::~:~…` delimiter lines, plus "Join with Google Meet"/"Join by phone" lines)
is removed before scanning. Only `http`/`https` with a host survive (same validator as manual
links); ≤ 10 links per entry, extras reported. Everything else (`VALARM`, `ATTENDEE`,
`ORGANIZER`, `TRANSP`, `STATUS` other than cancelled, `CLASS`, `PRIORITY`, `CATEGORIES`) is
ignored.

## R9 — Application-specific fields (FR-007, FR-017)

**Decision**: Exported `VEVENT`s carry
`X-UNIHELPER-KIND` (`class`|`event`), `X-UNIHELPER-YEAR`, `X-UNIHELPER-SEMESTER`,
`X-UNIHELPER-COURSE` (classes), `X-UNIHELPER-COLOR` (one of `COLOR_KEYS`),
`X-UNIHELPER-LINEAGE` (lineage id), and `X-UNIHELPER-SEMESTER-START`/`-END` (optional dates, so a
recreated semester gets its dates back). `UID` = `<segment id>@unihelperpromax`; `PRODID` =
`-//UniHelperProMax//Calendar Export 1.0//EN`. On import, a value is honoured only if valid
(unknown kind/colour → ignored with a preview note). `X-` properties are ignored by Google, Apple
and Outlook per RFC 5545 §3.8.8.2.

**Rationale**: Restores type, semester, course and colour on round trip (SC-004) while staying
standard.

## R10 — Lineages with several segments on export

**Decision**: A lineage split by "this and following" edits has several segments with different
rules; each segment is written as its own repeating `VEVENT` (own `UID`, same
`X-UNIHELPER-LINEAGE`). Exceptions are attached to the segment that generates their original
date. Detached (frozen, 009) occurrences no segment generates are written as standalone
`VEVENT`s with `X-UNIHELPER-LINEAGE` and `X-UNIHELPER-ORIGINAL-DATE`. On import, `VEVENT`s
sharing an `X-UNIHELPER-LINEAGE` are rebuilt as one lineage.

**Rationale**: One `RRULE` cannot express two different rules; this is also how Google exports a
series after "this and following" edits. Spec FR-005 ("one repeating event, not many separate
events") holds per rule segment.

## R11 — Matching on repeated imports (FR-038)

**Decision**: New table `calendar_import_sources` maps `(user, source_uid, recurrence_key)` →
`(kind, lineage_id)`. Lookup order for each source entry:
1. `X-UNIHELPER-LINEAGE` naming a lineage of this user (an app export re-imported into the same
   account) → that lineage;
2. a `calendar_import_sources` row for its `UID` → that lineage;
3. otherwise new.
If the mapped lineage no longer exists: in a Trash entry → skipped ("in the Trash"); permanently
deleted → treated as new. A matched lineage whose kind differs from the group's "Import as"
(e.g. it was a class, now Event) → skipped ("already imported as a class") rather than converted.

**Update rule** (FR-037): the lineage's segments and exceptions are rebuilt from the file inside
the transaction; before that, every occurrence that holds a note, recording or document and whose
date, time or location would change (or disappear) is **frozen** as a `detached` modified
exception with its current values (009 R4 mechanism, generic in `domain/scopes.py`) and reported
as skipped ("has notes, recordings or documents"). Occurrences with content that would not change
are not reported. Entries missing from the new file are untouched (FR-038). An unchanged entry is
counted neither as updated nor skipped ("unchanged" is shown separately in the result details).

**Rationale**: Deterministic, no duplicates, and content-bearing occurrences never move.

**Alternatives considered**: matching by title+time (fragile, produces duplicates on edits);
updating through the scope planners one change at a time (many code paths, same outcome).

## R12 — Destination, courses and colours (FR-021–FR-024)

**Decision**: Destination is `RefId | RefNewSemester` (same schema as `POST /events`; new year
and semester inline). App-exported entries default to their saved year/semester (resolved by name
with `get_or_create_*`, recreated with saved dates if missing); a per-group override sets them to
the destination. Course mapping per Class group: `existing:<courseId>` (must be in the group's
target semester) or `new:<name>`; default = case/space-insensitive name match via `name_key`,
else `new:<title>`. Reserved name `_Events` → preview issue `reserved_name`, apply refused until
renamed. Two groups mapped to the same new name share one course. New course colours walk
`COLOR_KEYS` from a fixed start, skipping colours used by the semester's courses (and by courses
created earlier in the same import) while any remain, then cycling. Events use `blue`. A colour
from `X-UNIHELPER-COLOR` wins.

## R13 — Atomic apply and undo (FR-032, FR-034)

**Decision**: Apply runs in the request's single SQLAlchemy transaction. Directories created for
new years/semesters/courses via `StorageService.ensure_dir` are recorded and removed by an
`on_rollback` compensation if the transaction fails (only if still empty). No session folders are
created (they appear on first content). A `calendar_import_runs` row stores counts, the skipped
list, the created ids (lineages, courses, semester, year) and the updated lineage ids. Undo
(`POST /calendar-imports/runs/{runId}/undo`, once): deletes created lineages with no content and
no Trash involvement (with their exceptions and empty folder rows), then created courses with no
remaining classes or folders, then a created semester/year if empty — same checks and
after-commit empty-directory removal as `creation_undo.py`. Kept items are returned with reasons.
Undo never reverts updates and never creates Trash entries.

## R14 — Export scope and file name

**Decision**: `GET /calendar-export?semesterId=` (optional; absent = everything) returns
`text/calendar; charset=utf-8` with `Content-Disposition: attachment;
filename="UniHelperProMax-calendar-YYYY-MM-DD.ics"` (date in the user's zone; with a semester:
`UniHelperProMax-<year>-<semester>-YYYY-MM-DD.ics`, sanitised). Trash entries are excluded; a
semester's `semester_end` rules are written with the resolved `UNTIL`; `never` series (possible
for legacy rows) get `UNTIL` = semester end if known, else no end. Empty scope → 409
`nothing_to_export`, no file. The frontend downloads via `fetch` → Blob → object URL, as the
theme export does.

## R15 — Interoperability verification (FR-011, SC-002, SC-003)

**Decision**: Golden fixtures in `backend/tests/fixtures/ics/`: real-shaped exports from Google
Calendar (with `X-WR-TIMEZONE`, Meet block, overrides, EXDATE), Apple Calendar (custom
`VTIMEZONE`, floating times), Outlook (Windows `TZID`s), plus edge files (all-day, multi-day,
monthly/daily rules, cancelled, markup in titles, `javascript:` links, 5,000 events, 5 MB+1).
Automated: round trip (export → parse with `icalendar` → expand with `dateutil` → compare to app
occurrences), RFC structure checks (every `VEVENT` has `UID`, `DTSTAMP`, `DTSTART`; `VTIMEZONE`
for every `TZID`; lines ≤ 75 octets). Manual (quickstart): import an exported file into Google
Calendar, Apple Calendar and Outlook and compare a checklist of entries; recorded in the PR.

## R16 — Tests (Principle VI)

**Decision**:
- Unit: `test_ical_read.py` (parse, checks, text/link cleaning), `test_ical_rules.py` (rule
  support matrix, WKST, COUNT/UNTIL, DST split), `test_ical_write.py` (structure, folding,
  `UNTIL` in UTC, EXDATE/RECURRENCE-ID), `test_import_plan.py` (grouping, defaults, mapping,
  colours).
- Contract: `test_calendar_imports.py` (upload/preview, all rejections, apply 200/409/422,
  discard, undo 200/409), `test_calendar_export.py` (200 headers, 409 empty, semester filter).
- Integration: `test_calendar_import_flow.py` (Google fixture into a semester → sessions on
  `GET /sessions`, courses, folders on first note; re-import → no duplicates; content occurrence
  frozen and reported; failure injected mid-apply → nothing changed incl. directories; undo),
  `test_calendar_roundtrip.py` (export → import into a fresh user → identical occurrences, kinds,
  colours, semesters), `test_migration_0011.py`. Critical flow 3 (recurring class creation) is
  re-run with imported classes.
- Frontend Vitest: wizard reducer (defaults, overrides, validation), group summary formatting.
  Playwright: import with keyboard only, cancel during upload, undo, export download; axe in
  light/dark/custom.
