---

description: "Task list for feature 010 — Calendar Import and Export (.ics)"
---

# Tasks: Calendar Import and Export (.ics)

**Input**: `/specs/010-calendar-ics-import-export/` (plan, spec, research R1–R16, data-model,
contracts `openapi.yaml` · `ui-import-export.md`, quickstart)

**Tests**: INCLUDED. Constitution VI requires tests for every endpoint and keeps the critical
flows green. The Principle I guarantees get integration tests: imports never delete, never move
content, apply all-or-nothing, and undo removes only content-free items. Write tests first in
each story.

**Order**: Setup → Foundational (migration, models, parser, rule/zone mapping, grouping) → US1
(import from Google: upload, preview, destination, apply, result; MVP) → US2 (export) → US3
(re-import, restore app exports, undo) → US4 (unsupported rules, DST splits, edge entries) → US5
(large files, keyboard, screen reader) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: user story from spec.md (US1–US5)

## Conventions used below

- Backend root `backend/src/unihelper/`, tests `backend/tests/`, frontend `frontend/src/`.
- Run backend tools with `uv run …` from `backend/`; frontend with `pnpm …` from `frontend/`.
- API errors are `ApiError(status, code, title, …)` from `api/errors.py`. Field errors use
  `validation_error(pointer, code, message)`, as in `hierarchy_service.py`.
- Contract tests validate bodies with `tests/contract/openapi_check.check(body, "<Schema>", spec="010")`.
- "Regenerate API types" means `uv run python -m unihelper.export_openapi ../frontend/openapi.json`
  then `pnpm gen:api` (updates `frontend/src/lib/api/schema.d.ts`).

---

## Phase 1: Setup

- [X] T001 Add `icalendar>=6.1,<8` to `[project].dependencies` in `backend/pyproject.toml`, run `uv lock && uv sync` (updates `backend/uv.lock`), and add `"icalendar.*"` to the mypy `ignore_missing_imports` override if its stubs are incomplete. Justification is already in plan.md's Complexity Tracking.
- [X] T002 Create module skeletons:
  - `backend/src/unihelper/api/v1/calendar_io.py`: empty `router = APIRouter(tags=["calendar-io"])`, added to the module tuple in `build_api_router()` in `backend/src/unihelper/main.py` after `trash`.
  - Empty modules `domain/ical_read.py`, `domain/ical_rules.py`, `domain/ical_write.py`, `domain/import_plan.py`, `services/calendar_import_service.py`, `services/calendar_import_undo.py`, `services/calendar_export_service.py`, `schemas/calendar_io.py`, each with a docstring citing the research items it implements.
- [X] T003 [P] Create `backend/tests/fixtures/ics/` with hand-written, real-shaped files plus a `README.md` saying what each one covers. Use CRLF line endings and fold some lines at 75 octets. Do not paste real personal data.
  - `google-fall.ics`: `X-WR-TIMEZONE:Europe/Istanbul`; `VTIMEZONE`. "Linear Algebra": weekly MO,WE 10:00–11:30, `UNTIL`, location "FENS G032", one `EXDATE`, one same-date override 10:30–12:00, and a description with the Google `-::~:~::~` join block and Meet link `X-GOOGLE-CONFERENCE`. "Physics II": weekly TU 13:40–15:30, no end. "Dentist": one-time. "Holiday": all-day `VALUE=DATE`. "Old Lab": master `STATUS:CANCELLED`.
  - `google-fall-v2.ics`: same `UID`s, Linear Algebra moved to 10:40–12:10, plus a new one-time "Midterm".
  - `apple-floating.ics`: custom `VTIMEZONE` with a non-IANA `TZID`, plus floating times.
  - `outlook-windows-tz.ics`: `TZID=Turkey Standard Time` and `W. Europe Standard Time`.
  - `unsupported.ics`: DAILY, MONTHLY `BYDAY=2TU`, YEARLY, and WEEKLY with `BYSETPOS`.
  - `edge.ics`: multi-day event, an event crossing midnight, a title with `<script>` and `<b>`, `URL:javascript:alert(1)`, `ATTACH;FILENAME=Slides.pdf:https://drive.google.com/…`, an empty `SUMMARY`, `DURATION` instead of `DTEND`, an `RDATE`, a `RECURRENCE-ID` the rule doesn't generate, and a course title `_Events`.
  - `newyork-weekly.ics`: `America/New_York` weekly series spanning the US DST change.
  - `utc-weekly.ics`: `DTSTART` in `…Z` with `RRULE` and `X-WR-TIMEZONE:Europe/Berlin`.
  - `empty.ics` (0 bytes) and `not-ical.ics` (PNG bytes).
  - Generate the large files from `backend/tests/fixtures/ics/make_large.py` at test time, not committed: `large-4000.ics` (4,000 one-time events), `too-many.ics` (5,001), `too-big.ics` (5 MB + 1 byte, using a long `DESCRIPTION`).
- [X] T004 [P] Test helpers in `backend/tests/contract/calendar_io_helpers.py`:
  - `upload_ics(client, name) -> Response`: POST raw fixture bytes to `/api/v1/calendar-imports?fileName=<name>` with `Content-Type: text/calendar` and the CSRF header.
  - `default_plan(preview, destination, **overrides) -> dict`: builds an `ImportPlan` from the preview defaults.
  - `apply(client, upload_id, plan)`.
  - `seed_semester(client, year="2026", semester="Fall 2026", courses=("Linear Algebra",)) -> ids`, reusing `tests/contract/event_helpers.py` patterns.

---

## Phase 2: Foundational (blocks all stories)

- [X] T005 Migration `backend/src/unihelper/db/migrations/versions/0011_calendar_import.py` (revision "0011", down "0010"; docstring cites research R2, R11, R13). Columns exactly as in data-model.md:
  - `calendar_import_uploads`: `id` PK; `user_id` FK users CASCADE, indexed; `file_name` String(255) NOT NULL; `size` Integer CHECK `size BETWEEN 1 AND 5242880`; `sha256` String(64); `staged_name` String NOT NULL; `event_count` Integer CHECK `event_count BETWEEN 0 AND 5000`; `created_at`, `expires_at` String NOT NULL.
  - `calendar_import_runs`: `id` PK; `user_id` FK users CASCADE, indexed; `file_name` String(255); `file_sha256` String(64); `destination_semester_id` FK semesters SET NULL, nullable; `created_json`, `updated_json`, `summary_json` Text NOT NULL; `created_at` String; `undone_at` String nullable.
  - `calendar_import_sources`: `id` PK; `user_id` FK users CASCADE; `source_uid` String(1024) NOT NULL; `recurrence_key` String NOT NULL default `''`; `kind` String(8) CHECK `kind IN ('class', 'event')`; `lineage_id` String NOT NULL (no FK); `first_run_id`, `last_run_id` FK calendar_import_runs SET NULL; UNIQUE `(user_id, source_uid, recurrence_key)` named `uq_calendar_import_sources_key`; index `(user_id, lineage_id)`.
- [X] T006 [P] Models in `backend/src/unihelper/models/calendar_import.py`: `CalendarImportUpload`, `CalendarImportRun`, `CalendarImportSource` (IdMixin + Base, columns and constraints mirroring T005), exported from `backend/src/unihelper/models/__init__.py`.
- [X] T007 [P] Integration test `backend/tests/integration/test_migration_0011.py`: a populated 0010 DB (classes, events, exceptions, trash entry, folders with notes) upgrades with all rows intact, the three new tables are empty, `PRAGMA foreign_key_check` is empty, and the downgrade drops exactly the three tables. Follow `test_migration_0010.py`.
- [X] T008 [P] Unit tests `backend/tests/unit/test_ical_read.py` for T009:
  - Checks: `empty.ics` → `file_empty`; `not-ical.ics` → `not_icalendar`; a generated 5,001-`VEVENT` text → `too_many_events`; a BOM-prefixed UTF-8 file parses.
  - Folded lines and escaped `\,` `\;` `\n` decode.
  - Text: titles and locations are trimmed; `<script>` and `<b>` stay literal plain text.
  - Links: http(s) only (`javascript:`, `mailto:`, `file:` dropped); `URL`, Meet (`X-GOOGLE-CONFERENCE` labelled "Google Meet", RFC 7986 `CONFERENCE` labelled "Meeting"), `ATTACH` with `FILENAME` label, then description URLs in that order, deduplicated; the Google join block removed before scanning; HTML `<a href>` hrefs extracted; more than 10 links → first 10 kept plus a note.
  - Labels: ≤ 60 chars.
  - Truncation notes: title > 120, location > 200, and class location > 120 (stored at use).
  - Ignored: `VALARM`, `ATTENDEE`, `TRANSP`.
- [X] T009 Implement `backend/src/unihelper/domain/ical_read.py` (pure, no DB):
  - `read_calendar(data: bytes) -> ParsedCalendar` raising `IcsError(code)`. Codes: `file_empty`, `not_icalendar`, `too_many_events` (> 5,000 `VEVENT`s including overrides). Decode UTF-8 (BOM allowed); invalid bytes → `not_icalendar`.
  - Uses `icalendar.Calendar.from_ical`.
  - Returns `calendar_tz` (`X-WR-TIMEZONE`), `prodid`, and `raw_events: list[RawEvent]`. Each `RawEvent` has: `uid` (synthesise `sha1` of the component text when missing), `summary`, `location`, `links`, `dtstart`/`dtend`/`duration` as given (date, naive, aware, or UTC), `rrules` (list), `rdates`, `exdates`, `recurrence_id`, `status`, `x_props` (all `X-UNIHELPER-*`), and `notes`.
  - `clean_text(s) -> str` and `extract_links(component) -> tuple[list[(label | None, url)], list[note]]` per research R8.
  - Reuse the existing manual-link URL validator in `schemas/classes.py` (or move it to `domain/addresses.py` if that is where it lives) so the rules match manual links: http/https, a host, ≤ 2048 chars.
- [X] T010 [P] Unit tests `backend/tests/unit/test_ical_rules.py` for T011:
  - Support matrix: WEEKLY with `BYDAY` → supported. WEEKLY without `BYDAY` → `DTSTART` weekday. `INTERVAL=2` → supported; `INTERVAL=9` → unsupported. `COUNT=12` → `end_kind="count"`; `COUNT=600` → unsupported. `UNTIL` (UTC) → `until` with the local date. No end → open-ended. Unsupported: `BYDAY=2TU`, `BYSETPOS`, `BYMONTH`, DAILY, MONTHLY, YEARLY, two `RRULE`s, `EXRULE`. `WKST=SU` with `INTERVAL=2;BYDAY=SU,MO` → unsupported if dates differ, supported if they match.
  - Zone conversion: `TZID=Europe/Istanbul` for an Istanbul user → same wall-clock time. `America/New_York` 10:00 → 17:00 Istanbul. Windows `TZID` "Turkey Standard Time" resolves. A custom `VTIMEZONE` resolves. Floating → user zone.
  - All-day (`VALUE=DATE`) → `skip=all_day`. Local end on a later day → `skip=all_day`. End ≤ start → `skip=invalid_times`. `DURATION` → end.
- [X] T011 Implement `backend/src/unihelper/domain/ical_rules.py` (pure):
  - `to_local(dt, user_tz, vtimezones) -> datetime`.
  - `map_rule(raw, user_tz) -> WeeklyRule | Unsupported(reason_text) | None`. `WeeklyRule` has `interval_weeks` 1–8, weekdays, `end_kind` (`count` | `until` | `open`), `until_date`, `count` ≤ 500.
  - `normalize(raw, user_tz) -> SourceEntry`, the data-model.md "Parsed source entry": start/end in the user zone, rule, rdates, exdates and overrides converted, `skip_reason`.
  - Weekday sets are expanded with `dateutil.rrule.rrulestr`. The app-rule comparison uses `domain/recurrence.occurrence_dates` so both sides agree.
  - DST splitting and UTC/floating anchoring are left as `TODO(US4)`. For now, take the first occurrence's local time.
- [X] T012 [P] Unit tests `backend/tests/unit/test_import_plan.py` for T013:
  - Grouping is by case-folded, trimmed title (`"linear algebra "` and `"Linear Algebra"` → one group). An empty title → "(No title)" with `titleMissing`.
  - Ids are deterministic: same bytes → same `groupId`s.
  - `occurrenceCount` honours `EXDATE` and the end. `patterns` are distinct weekday/time combinations. `location` is the most common one.
  - Defaults: repeating → selected and `class`; one-time → not selected and `event`.
  - `suggested_end_date` = first occurrence + 16 weeks.
  - Colour assignment: walk `COLOR_KEYS` order, skip colours used by the semester's courses and by courses created earlier in the run, then cycle.
  - Course mapping by `name_key`.
  - `reserved_name` issue for `_Events`.
- [X] T013 Implement `backend/src/unihelper/domain/import_plan.py` (pure):
  - `group_entries(entries) -> list[PreviewGroup]` with `groupId = sha1(title_key)[:12]` and `entryId = sha1(uid + recurrence)`.
  - `assign_colors(existing: set[str], n) -> list[str]`.
  - `default_course(title, courses_by_key)`.
  - `validate_plan(plan, groups) -> list[FieldError]`, using pointers `/groups/<groupId>/<field>` and codes `nothing_selected`, `choice_required`, `invalid_end_date` (end before the first occurrence, or > 500 occurrences), `title_required`, `reserved_name`.
  - Reuse `domain/naming.name_key` and `is_reserved_course_folder`.
- [X] T014 Schemas in `backend/src/unihelper/schemas/calendar_io.py`: Pydantic models for `ImportPreview`, `ImportGroup`, `Pattern`, `SkippedItem`, `SkipReason`, `SavedTarget`, `ImportPlan`, `GroupPlan`, `ImportResult`, `Counts`, `UndoResult`, exactly as in `contracts/openapi.yaml` (camelCase aliases as in `schemas/events.py`). `ImportPlan.destination` reuses the `RefId | RefNewSemester` types from `schemas/classes.py`.
- [X] T015 Staging support in `backend/src/unihelper/services/calendar_import_service.py`:
  - `stage(db, storage, user, request, file_name) -> CalendarImportUpload`. Uses `api/uploads.declared_length` and `receive_upload` with max 5,242,880 bytes and what="A calendar file". Records the row with `expires_at = now + 1 h`. Discards the user's previous upload first.
  - `get_upload(db, user, upload_id)`: 409 `upload_expired` if missing or expired.
  - `discard(db, storage, user, upload_id)`: idempotent.
  - `sweep_expired(db, storage)`.
  - Call `sweep_expired` at startup in `backend/src/unihelper/main.py` (after migrations) and at the start of `stage`.
  - Staged files are only touched through `StorageService.open_upload` and `discard_upload`.

**Checkpoint**: migration, models, parser, rule and zone mapping, grouping, schemas and staging are ready; unit suites green.

---

## Phase 3: User Story 1: Import a semester's timetable from Google Calendar (P1) 🎯 MVP

**Goal**: Settings → Import and export lets the user upload a `.ics` file, see grouped preview defaults, pick a destination semester and course mapping, apply it in one transaction, and see the result counts with skip reasons. Imported entries behave like hand-made ones.

**Independent Test**: import `google-fall.ics` into a semester that already has "Linear Algebra". The preview defaults and mapping are correct. Sessions appear on the calendar and timelines. All-day and cancelled entries are reported as skipped. A note on an imported session creates the usual folder.

### Tests for User Story 1

- [X] T016 [P] [US1] Contract tests in `backend/tests/contract/test_calendar_imports.py`:
  - `POST /calendar-imports`: 201 `ImportPreview` for `google-fall.ics`. Groups "Linear Algebra" (repeating, selected, class), "Physics II" (open-ended with `suggestedEndDate`), "Dentist" (not selected, event). `skipped` has "Holiday" with reason `all_day` and message "all-day events are not supported yet", and "Old Lab" with `cancelled`.
  - Rejections: 422 `file_empty`, `not_icalendar`, `too_many_events`; 413 `file_too_large` (both from `Content-Length` and from a stream longer than declared); 411 without length.
  - `DELETE /calendar-imports/{id}`: 204, twice.
  - `POST …/apply`: 200 `ImportResult`. 409 `upload_expired` after `DELETE`. 422 `nothing_selected`, `destination_required` (new semester with empty name), `reserved_name`. 404 for a foreign semester or course id.
  - Another user's upload id → 409 `upload_expired` (never visible).
- [X] T017 [P] [US1] Integration test in `backend/tests/integration/test_calendar_import_flow.py::test_google_import`, real SQLite and temp storage:
  - Import into "Fall 2026" containing course "linear algebra ".
  - Mapping: Linear Algebra maps to the existing course (no new course). Physics II becomes a new course with the first free palette colour, ending 16 weeks after its first entry.
  - `GET /sessions` shows Linear Algebra Mon/Wed 10:00–11:30 except the `EXDATE`, and the override day at 10:30–12:00.
  - Links include the Meet link and not the join-block text.
  - Course timelines list the sessions.
  - Writing a note on one session creates `<user>/2026/Fall 2026/Physics II/<date>/notes/`.
  - A `calendar_import_runs` row and `calendar_import_sources` rows exist.
  - The upload row and staged file are gone.
- [X] T018 [P] [US1] Integration test `test_apply_is_atomic` in the same file. Monkeypatch the event insert to raise after the classes are created. Expect a 500 `import_failed` response, no new series, courses or semester rows, no new directories on disk (a new semester's folder is removed), and the upload kept so the user can retry.

### Implementation for User Story 1

- [X] T019 [US1] `preview(db, user, upload) -> ImportPreview` in `services/calendar_import_service.py`. Re-read the staged bytes and run `read_calendar` → `normalize` with `user.timezone` → `group_entries`. Collect skipped-before-grouping items (all-day, cancelled, invalid times) with user-facing messages. Set `timezone` and `expiresAt`.
- [X] T020 [US1] `apply(db, storage, user, upload, plan) -> ImportResult` in `services/calendar_import_service.py`: re-parse, then `validate_plan` (422 with `errors[]`), then resolve the destination via `class_service.resolve_semester` (track created ids). For each selected group:
  - **Event**: create `event_series` rows through `event_service.create_event`'s insert path, with colour `blue` and links capped at 10.
  - **Class**: resolve the course per mapping via `hierarchy_service.get_or_create_course` with the assigned colour, then insert `class_series` with `title=None`, so the class shows its course name.
  - **Rules**: map to `freq/interval_weeks/by_weekday/end_kind/until_date/count`. Open-ended → `until` with the plan's `endDate` or the suggestion. Validate with `recurrence.validate_rule`.
  - **Overrides** (research R7): `EXDATE` and cancelled overrides → `session_exceptions kind='cancelled'`. Same-date time/location override → `kind='modified'`. Events may also get `moved_date`/`title`/`links_json`. A class override on another date → cancel the original date plus a one-time class in the same course, with source key `uid + recurrence`. A class title change is noted, not kept.
  - **Sources**: insert a `calendar_import_sources` row per created lineage (`first_run_id = last_run_id = run.id`).
  - **Run row**: write `calendar_import_runs` with `created_json`, `updated_json` and `summary_json`.
  - **Counts**: count occurrences as created per kind.
  - **Folders**: register `db.on_rollback` compensations removing any year, semester or course directory created by this apply when it is still empty. Check whether `ensure_dir` already registers one; if not, add the compensation in the service, or `StorageService.remove_dir_if_empty(parts)` in `backend/src/unihelper/storage/storage_service.py`.
  - **Failures**: any unexpected exception → rollback and `ApiError(500, "import_failed", "The import failed and nothing was changed.")`.
  - **On success**: delete the upload row and its staged file via `db.on_commit`.
  - **Preference**: set `last_semester_id` to the destination.
- [X] T021 [US1] Routes in `backend/src/unihelper/api/v1/calendar_io.py`:
  - `POST /calendar-imports` (query `fileName`, raw body; returns 201 `ImportPreview`).
  - `DELETE /calendar-imports/{uploadId}` (204).
  - `POST /calendar-imports/{uploadId}/apply` (200 `ImportResult`).
  - Map `IcsError` codes to 422 problems with the messages from `contracts/ui-import-export.md`.
  - Then regenerate API types.
- [X] T022 [P] [US1] Frontend API in `frontend/src/features/settings/calendar-io/api.ts`:
  - `uploadIcs(file, onProgress, signal)` using `frontend/src/lib/api/upload.ts` (XHR with progress and abort) against `/calendar-imports?fileName=`.
  - `discardUpload(id)`, `applyImport(id, plan)`.
  - Types from `schema.d.ts`.
  - Problem code → message map exactly as in `contracts/ui-import-export.md` § Error message map.
- [X] T023 [P] [US1] Wizard state in `frontend/src/features/settings/calendar-io/wizardReducer.ts`:
  - Steps `choose | reading | preview | importing | result`.
  - Plan state initialised from preview defaults; actions: toggle and select all/clear, set type, set course (existing or new name), set end date, set unsupported choice, set title, set destination (existing or new year/semester names).
  - `defaultCourseFor(title, courses)` using trim + case-fold.
  - `validate(state) -> {ok, firstError: {groupId, field, message}}`, mirroring the server codes.
  - `toPlan(state) -> ImportPlan`.
  - Unit tests in `frontend/tests/unit/calendar-io/wizardReducer.test.ts`: defaults, destination change remaps courses, a new semester without a name blocks, nothing selected blocks.
- [X] T024 [US1] Settings section and page:
  - In `frontend/src/features/settings/SettingsLayout.tsx`, add `{ to: "/settings/import-export", label: "Import and export" }` after Appearance.
  - In `frontend/src/features/settings/routes.tsx`, add the lazy route `import-export` → `ImportExportPage`.
  - `frontend/src/features/settings/calendar-io/ImportExportPage.tsx` renders two Cards: Export (placeholder until US2) and Import, with the explanation text from the UI contract.
- [X] T025 [US1] `frontend/src/features/settings/calendar-io/ImportWizard.tsx`:
  - Drop area with `role="button"`, `tabIndex=0`, Enter/Space opens a hidden `<input type="file" accept=".ics,text/calendar">`, and drag-and-drop of one file. Wrong extension, or more than one file → inline error, no upload.
  - Reading step: file name, `Progress` showing upload percent then "Checking…", and Cancel (abort plus `discardUpload` if an id was returned).
  - Error codes show `role="alert"` messages and return to Choose.
  - Importing step: no cancel.
  - Leaving the page during preview calls `discardUpload`.
- [X] T026 [P] [US1] `frontend/src/features/settings/calendar-io/DestinationPicker.tsx`:
  - RadioGroup: existing semester (Select "<year> · <semester>" from `GET /course-tree`, preselected from the `lastSemesterId` preference, else the latest) or new semester (pick a year or name a new one, plus a required semester name, 1–80 chars).
  - Uses the hierarchy query hooks from `frontend/src/features/courses`.
- [X] T027 [US1] Group table:
  - `frontend/src/features/settings/calendar-io/GroupTable.tsx`: Select all / Clear, plus the skipped-before-grouping disclosure.
  - `GroupRow.tsx`: checkbox "Import <title>"; badges Repeating/One time; summary "<n> entries · Mon, Wed 10:00–11:30 · <location>"; Import as RadioGroup; course combobox; "Repeats until" date for open-ended groups; match badges and notes disclosure.
  - `CourseMappingCombobox.tsx`: Popover + Command listing the target semester's courses and "New course: <name>" (editable), with a colour swatch and colour name text. The reserved-name error reads "This name is reserved for events."
  - Footer: "Import <n> entries", disabled until valid, with the first problem named next to it.
- [X] T028 [US1] `frontend/src/features/settings/calendar-io/ImportResult.tsx`:
  - Heading takes focus.
  - Counts table: classes and events × created/updated/skipped, plus unchanged.
  - Lists of created courses, skipped items (title, date/time, message) and notes.
  - "Done" returns to Choose and invalidates the `sessions`, `course-tree` and timeline queries so the calendar shows the new entries.
- [X] T029 [US1] E2E test `frontend/tests/e2e/calendar-import-export.spec.ts` "imports Google calendar": seed a semester with course "Linear Algebra", upload `backend/tests/fixtures/ics/google-fall.ics`, check the preview defaults, confirm, check the result counts, and see the sessions in week view.

**Checkpoint**: US1 is fully usable; the MVP can ship.

---

## Phase 4: User Story 2: Export the calendar to other calendar apps (P1)

**Goal**: one standards-conformant `.ics` file (all entries or one semester) with weekly series as `RRULE`, overrides, `EXDATE`, the user's `VTIMEZONE`, and `X-UNIHELPER-*` fields.

**Independent Test**: export a semester with a weekly class (one moved and one cancelled session), a one-time event and a repeating event. The structure checks pass, the expansion matches app occurrences, and the file imports into Google Calendar, Apple Calendar and Outlook (manual).

### Tests for User Story 2

- [X] T030 [P] [US2] Unit tests `backend/tests/unit/test_ical_write.py` for T032:
  - Structure: one `VCALENDAR` with `VERSION:2.0` and `PRODID:-//UniHelperProMax//Calendar Export 1.0//EN`; every `VEVENT` has `UID` (`<segment id>@unihelperpromax`), `DTSTAMP`, `DTSTART;TZID=<user tz>` and `DTEND`; one `VTIMEZONE` per used `TZID`; lines ≤ 75 octets.
  - Recurrence: `RRULE:FREQ=WEEKLY;INTERVAL=n;BYDAY=…;UNTIL=<UTC>` (`UNTIL` ends in `Z`); `count` series → `COUNT`; `semester_end` → resolved `UNTIL`.
  - Exceptions: cancelled → `EXDATE;TZID=…` at the series start time; modified → a `VEVENT` with the same `UID`, `RECURRENCE-ID;TZID=…` at the original start, and the new times and location.
  - App fields: `X-UNIHELPER-KIND/YEAR/SEMESTER/COURSE/COLOR/LINEAGE` present, plus `-SEMESTER-START/-END` when set.
  - Links: first link in `URL`, all links listed in `DESCRIPTION` as `Label: url` lines.
  - Two-segment lineage → two `VEVENT`s with the same `X-UNIHELPER-LINEAGE`. Detached occurrence → standalone `VEVENT` with `X-UNIHELPER-ORIGINAL-DATE`.
  - Round trip: parse the output with `icalendar`, expand with `dateutil.rrule.rrulestr` in the zone, and compare to the app's occurrences for a range spanning a DST change in `Europe/Berlin` (same wall-clock times).
- [X] T031 [P] [US2] Contract tests `backend/tests/contract/test_calendar_export.py`:
  - `GET /calendar-export` 200: `text/calendar; charset=utf-8`; `Content-Disposition: attachment; filename="UniHelperProMax-calendar-<YYYY-MM-DD>.ics"` (date in the user's zone); `?semesterId=` filename `UniHelperProMax-2026-Fall-2026-<date>.ics`; `X-Export-Counts: classes=<n>; events=<m>` and `Access-Control-Expose-Headers` includes it if CORS is configured.
  - 404 for a foreign semester. 409 `nothing_to_export` for an empty account and for an empty semester.
  - Trash entries are not exported.
  - No note, recording or document content appears in the body (seed a note with a unique marker string and assert it is absent).

### Implementation for User Story 2

- [X] T032 [US2] Implement `backend/src/unihelper/domain/ical_write.py` (pure): `write_calendar(lineages: Sequence[ExportLineage], user_tz: str, now: datetime) -> bytes`. `ExportLineage` holds kind, year/semester names and dates, course name, colour, segments with rules, links, exceptions and detached occurrences. Rules per research R5, R9 and R10:
  - `VTIMEZONE` from `icalendar` for `user_tz`, covering the exported range.
  - `X-WR-TIMEZONE`, and `X-WR-CALNAME:UniHelperProMax`.
  - Title: event title, or the class's course name.
  - CRLF output.
- [X] T033 [US2] Implement `backend/src/unihelper/services/calendar_export_service.py`:
  - `export(db, user, semester_id | None) -> (bytes, filename, counts)`.
  - Load class lineages (via course → semester → year) and event lineages (via semester → year) for the user, optionally filtered by semester. Use `services/lineage.load` for segments and exceptions. Exclude anything in the Trash (lineages there no longer have rows; folders with `trash_entry_id` are ignored).
  - Resolve `semester_end` rules to `UNTIL`. `never` series get `UNTIL` = semester end if known, else no end.
  - Counts are lineages per kind. Zero → `ApiError(409, "nothing_to_export", "There is nothing to export.")`.
  - Filename built with `domain/naming.safe_name` for year and semester parts.
- [X] T034 [US2] Route `GET /calendar-export` in `backend/src/unihelper/api/v1/calendar_io.py` returning `Response(media_type="text/calendar; charset=utf-8")` with the `Content-Disposition` and `X-Export-Counts` headers. Add the header note to the response description in `specs/010-calendar-ics-import-export/contracts/openapi.yaml`. Regenerate API types.
- [X] T035 [P] [US2] `frontend/src/features/settings/calendar-io/ExportCard.tsx`:
  - Scope Select: "All years and semesters", then each "<year> · <semester>".
  - Button "Export calendar (.ics)" fetches the blob (`exportCalendar(semesterId?)` in `api.ts`), reads the filename from `Content-Disposition`, and downloads through an object URL (pattern from `themes/AppearanceSettings.tsx` `download`).
  - Toast "Exported <n> classes and <m> events".
  - On 409, the inline message "There is nothing to export in <scope>." and no download.
  - Replace the placeholder in `ImportExportPage.tsx`.
- [X] T036 [US2] E2E test "exports a semester" in `frontend/tests/e2e/calendar-import-export.spec.ts`: download event filename matches `UniHelperProMax-…-<date>.ics`; file contains `RRULE`, `EXDATE`, `RECURRENCE-ID` and `X-UNIHELPER-KIND`; empty semester shows the message and no download.
- [ ] T037 [US2] Manual interop check per quickstart scenario 6. Import an exported fixture account into Google Calendar, Apple Calendar and Outlook and record the results (dates, times after DST, moved and cancelled sessions, links) in `specs/010-calendar-ics-import-export/checklists/interop.md`.

**Checkpoint**: US1 and US2 work independently.

---

## Phase 5: User Story 3: Re-import safely, restore an app export, and undo (P2)

**Goal**: re-import updates matched entries without duplicates and freezes occurrences with content. App exports restore type, semester, course and colour. "Undo import" removes only content-free items it created.

**Independent Test**: import, add a note, re-import `google-fall-v2.ics` → updates, the noted session is skipped and unmoved, no duplicates. Export → import into a fresh user → identical. Undo → only content-free created items removed.

### Tests for User Story 3

- [X] T038 [P] [US3] Integration tests in `backend/tests/integration/test_calendar_import_flow.py`:
  - `test_reimport_updates_without_duplicates`: import `google-fall.ics` twice → the second time 0 created, `unchanged` > 0, and the same number of sessions.
  - `test_reimport_v2_freezes_content`: note on one Linear Algebra session; import v2 → `classes.updated` ≥ 1; that session is still at 10:00 with `detached` set, listed in `skipped` with `has_content`; the other sessions are at 10:40; "Midterm" is created only if selected.
  - `test_missing_entries_untouched`: v2 lacks a v1 entry → it remains.
  - `test_trashed_match_skipped`: delete an imported class to the Trash, re-import → skipped with `in_trash`, nothing recreated.
  - `test_kind_mismatch`: re-import with the type switched to Event → skipped with `kind_mismatch`.
- [X] T039 [P] [US3] Integration test `backend/tests/integration/test_calendar_roundtrip.py`: user A with classes and events in two semesters (colours, a moved session, a cancelled one, a two-segment lineage, semester dates) exports. User B imports with `semester: saved` defaults. B's years, semesters (with dates), courses, kinds, colours, occurrences, times, locations and links equal A's (compare `GET /sessions` over the semesters normalised without ids). Re-importing A's file into A → 0 created, everything unchanged.
- [X] T040 [P] [US3] Contract tests for undo in `backend/tests/contract/test_calendar_imports.py`:
  - `POST /calendar-imports/runs/{runId}/undo` 200 `UndoResult` (removed counts).
  - A second call → 409 `undo_unavailable`. A foreign run → 404.
  - An imported session with a note → that class is kept with "has notes, recordings or documents".
  - A created course still holding a kept class → kept.
  - A created semester → removed only if empty.
  - An updated lineage is never reverted.

### Implementation for User Story 3

- [X] T041 [US3] Matching in `services/calendar_import_service.py` (research R11). `match(db, user, entry) -> Match(kind, lineage_id) | None`:
  1. `X-UNIHELPER-LINEAGE` naming a lineage of this user;
  2. a `calendar_import_sources` row on `(user_id, uid, recurrence_key)`.

  If the lineage has no rows: check the Trash (add `lineage_in_trash(db, user, lineage_id) -> bool` to `backend/src/unihelper/services/trash_service.py` by scanning live `trash_entries` payload lineage ids) → `in_trash`; otherwise treat as new. Fill `ImportGroup.matches` in `preview` (create/update/unchanged/skip per group for its default type).
- [X] T042 [US3] Update path in `apply`:
  - For a matched lineage of the same kind, compute the new segments and exceptions. If they equal the current ones (rule columns, times, location, links, colour where carried), count it as `unchanged`.
  - Otherwise, for every occurrence whose folder holds content (reuse the `event_service.has_content` query per occurrence, or `trash_service.content_counts` by folder) and whose date, time or location would change or disappear, write a `detached` modified `session_exceptions` row with its current values (the freeze mechanism in `domain/scopes.py`) and add a `SkippedItem` with `has_content`. Then replace the lineage's segments, links and non-frozen exceptions inside the transaction.
  - Set the source row's `last_run_id`, and record the lineage in `updated_json`.
  - Never delete a lineage, course or folder.
- [X] T043 [US3] App-export restore:
  - In `normalize`/`group_entries`, read `X-UNIHELPER-*` into `SavedTarget`. Ignore invalid kinds or colours (not in `COLOR_KEYS`) and add a note. Set `fromThisApp` when `PRODID` matches.
  - Group defaults: saved kind, selected = true, saved colour.
  - In `apply`, for `semester: "saved"`, resolve year and semester by name with `get_or_create_year`/`get_or_create_semester`, passing the saved start/end dates when created, and record created ids. Saved course: matched by name in that semester, or created with the saved colour.
  - `VEVENT`s sharing `X-UNIHELPER-LINEAGE` are rebuilt as one lineage with several segments (`split_from_id` chained by start date). `X-UNIHELPER-ORIGINAL-DATE` standalone entries become detached exceptions of that lineage.
- [X] T044 [US3] Implement `backend/src/unihelper/services/calendar_import_undo.py` `undo_run(db, storage, user, run_id) -> UndoResult`:
  - 404 for a foreign or unknown run; 409 `undo_unavailable` if `undone_at` is set.
  - For each created lineage: remove it only if no occurrence has content and no Trash entry involves it. Delete its segments, exceptions, empty `session_folders` rows and `calendar_import_sources` rows, following the checks in `services/creation_undo.py` (factor the shared helpers out rather than copying).
  - Then created courses with no remaining classes or folder rows, then the created semester and year if empty.
  - Remove empty directories after commit via `db.on_commit`, only if empty (Principle I).
  - Set `undone_at`. Return the removed counts and the kept list with messages.
  - Route `POST /calendar-imports/runs/{runId}/undo` in `api/v1/calendar_io.py`. Regenerate API types.
- [X] T045 [US3] Purge hook: in `trash_service.purge`, also delete the `calendar_import_sources` rows whose `lineage_id` is the purged lineage, in `backend/src/unihelper/services/trash_service.py`. Add a case to `backend/tests/integration/test_trash_flow.py`.
- [X] T046 [US3] Frontend:
  - `GroupRow.tsx` shows the "From this app" badge, a "Put in destination" toggle for groups with saved targets (sets `semester: "destination"`), and match badges "<n> will update" / "<n> skipped" with reasons.
  - `DestinationPicker.tsx` shows the `fromThisApp` notice.
  - `ImportResult.tsx` gets "Undo import": an AlertDialog with the text from the UI contract, calling `undoImport(runId)` (added to `api.ts`). On success, a toast with the removed and kept counts, the kept list replaces the skipped list, the button is removed, and queries are invalidated. On error, a message with retry available.
- [X] T047 [US3] E2E tests in `frontend/tests/e2e/calendar-import-export.spec.ts`:
  - "re-import does not duplicate": import twice, week view has the same entry count.
  - "undo import": import, undo, entries gone.

**Checkpoint**: US1–US3 work independently.

---

## Phase 6: User Story 4: Decide what to do with entries the app cannot represent (P2)

**Goal**: unsupported rules require an explicit choice. All-day, multi-day and cancelled entries are reported. Time zones and DST convert exactly (series split where needed). Floating and UTC series are anchored. `RDATE`s and orphan overrides become one-time entries.

**Independent Test**: import `unsupported.ics`, `edge.ics`, `newyork-weekly.ics` and `utc-weekly.ics`; every entry is accounted for with the documented choice or reason, and local times match.

### Tests for User Story 4

- [X] T048 [P] [US4] Unit tests in `backend/tests/unit/test_ical_rules.py`:
  - DST split: `newyork-weekly.ics` for an `Europe/Istanbul` user → two segments with times differing by 1 h, split on the first occurrence after the US change, with note "Times change on <date> (daylight saving in America/New_York)". An Istanbul-zoned file for an Istanbul user → one segment.
  - `utc-weekly.ics` with `X-WR-TIMEZONE:Europe/Berlin` for a Berlin user → one segment at constant local time. Without `X-WR-TIMEZONE` → anchored in the user's zone.
  - `RDATE` → extra one-time entries. A `RECURRENCE-ID` not generated → one-time entry plus a note. An `EXDATE` that matches nothing → ignored.
- [X] T049 [P] [US4] Contract/integration tests in `backend/tests/contract/test_calendar_imports.py`:
  - `unsupported.ics` preview: each group has `unsupported` reason text and `defaults.selected` true for repeating groups.
  - Apply without a choice → 422 `choice_required` with pointer `/groups/<id>/unsupported`.
  - `first_only` → exactly one occurrence created. `skip` → listed as skipped with `unsupported_skipped`.
  - `edge.ics`: multi-day and past-midnight → `all_day` message. `<script>` title stored literally. `javascript:` link absent. Attachment link labelled "Slides.pdf". Empty title → `titleMissing`, and apply without `title` → 422 `title_required`. `_Events` course → `reserved_name` issue and 422 until renamed. `DURATION` → correct end.

### Implementation for User Story 4

- [X] T050 [US4] Finish the `TODO(US4)` items in `backend/src/unihelper/domain/ical_rules.py`:
  - Expand each supported series in its source zone, convert each occurrence to the user zone, and split into consecutive `WeeklyRule` segments wherever the local (start, end) changes. The last segment keeps the end condition; earlier ones get `until`; `count` is distributed across segments.
  - Anchor UTC and floating repeating events in `calendar_tz` or the user zone.
  - Turn `RDATE`s and orphan overrides into one-time entries.
  - Every case adds a note to the group.
- [X] T051 [US4] Apply support in `services/calendar_import_service.py`:
  - Multi-segment entries create one lineage with chained segments (`lineage_id` of the first; `split_from_id` of the previous).
  - The unsupported choice: `first_only` → `freq='none'` at the first occurrence; `skip` → a `SkippedItem` with `unsupported_skipped`.
  - Groups with `titleMissing` use the plan's `title` (Event) or course name (Class).
  - Truncation notes are passed through to `ImportResult.notes`.
- [X] T052 [US4] Frontend in `GroupRow.tsx`:
  - "Not supported" badge with reason (Tooltip plus visually hidden text).
  - RadioGroup "Import first occurrence only" / "Skip" with no default, and the row error "Choose what to do with this repetition" when confirming.
  - Title Input for `titleMissing` groups.
  - Notes disclosure showing DST and truncation notes.
  - The `wizardReducer` validation covers these; extend `frontend/tests/unit/calendar-io/wizardReducer.test.ts`.

**Checkpoint**: all entries in any supported file are accounted for (FR-031).

---

## Phase 7: User Story 5: Import a large file with keyboard and screen reader (P3)

**Goal**: large files show progress and can be cancelled before confirming; every step is keyboard- and screen-reader-operable in all themes.

**Independent Test**: keyboard only, with a screen reader: upload `large-4000.ics`, cancel during reading, restart, change one group, confirm, hear the result, undo.

- [X] T053 [P] [US5] Performance test `backend/tests/integration/test_calendar_import_flow.py::test_large_file_preview_time`: `large-4000.ics` preview in < 3 s server time and apply of 10 weekly groups in < 2 s (SC-008, plan Performance Goals), marked like the existing `test_sessions_performance.py`.
- [X] T054 [US5] Live announcements in `ImportWizard.tsx` and `ImportResult.tsx`:
  - A polite `aria-live` region announces "Reading file, <n>%" at most every 10 points, then "Checking file", then "Preview ready: <n> groups".
  - Errors use `role="alert"`.
  - The result announces "Import finished: <n> classes created, <n> updated, <n> skipped."
  - Focus moves to the preview heading and the result heading.
  - Confirm moves focus to the first invalid control when blocked.
- [X] T055 [US5] Keyboard and theming pass over `frontend/src/features/settings/calendar-io/*`:
  - All controls are reachable in reading order; visible focus rings come from tokens.
  - The AlertDialog returns focus.
  - No colour-only state: badges have text, swatches have names.
  - Reduced motion disables step transitions.
  - No hard-coded colours (`frontend/tests/unit/no-hardcoded-colors.test.ts` passes).
- [X] T056 [US5] E2E tests in `frontend/tests/e2e/calendar-import-export.spec.ts`:
  - "keyboard-only import with cancel": Tab to the drop area, Enter, choose the file, Escape/Cancel during reading → back to Choose with the upload discarded (`DELETE` observed), restart, change one group's type with arrow keys, confirm, result heading focused.
  - axe AA checks on Choose, Preview and Result in light, dark and a custom theme, added to `frontend/tests/e2e/a11y-themes.spec.ts`.

**Checkpoint**: all stories complete.

---

## Phase 8: Polish & Cross-Cutting

- [X] T057 [P] Update `README.md` with a Settings → Import and export section: supported `.ics` sources, what is and isn't imported, re-import behaviour, and undo. Add anything deferred, such as daily rules or all-day events, to `specs/KNOWN-ISSUES.md`.
- [X] T058 Run the critical flows (`test_record_save_flow`, `test_recording_recovery`, `test_transcribe_append_flow`, `test_recurring_class_creation`), the full backend suite including the contract coverage guard (`tests/contract/test_coverage.py` must list the five 010 operations), `uv run ruff check . && uv run mypy`, and `pnpm typecheck && pnpm lint && pnpm test`. Fix regressions.
- [X] T059 Security review of the import path. Confirm that:
  - staged files never leave `files/.uploads/` (`_check_staged`);
  - `fileName` is display-only and never used as a path;
  - imported text is rendered as text nodes only (no `dangerouslySetInnerHTML` in `calendar-io/`);
  - only http/https links are stored;
  - another user's upload, run or semester ids are refused.

  Add any missing test to `backend/tests/contract/test_security.py`.
- [ ] T060 Run every scenario in `specs/010-calendar-ics-import-export/quickstart.md` and record the results in `specs/010-calendar-ics-import-export/checklists/interop.md` (together with T037).

---

## Dependencies & Execution Order

- **Setup (T001–T004)** → **Foundational (T005–T015)** → stories.
- **US1** needs Foundational.
- **US2** needs only Foundational T001–T002 and the existing lineage services. It can run in parallel with US1; its round-trip test lives in US3.
- **US3** needs US1 (apply, sources, runs) and US2 (export, for the round trip).
- **US4** needs US1 (apply path). It is independent of US2 and US3.
- **US5** needs US1's UI. T056's undo step needs US3.
- Within each story: tests → domain → services → routes → regenerate types → frontend → e2e.

```text
Setup → Foundational ─┬─ US1 ─┬─ US3 ─┐
                      │       ├─ US4  ├─ US5 ─ Polish
                      └─ US2 ─┘       │
```

## Parallel Execution Examples

- **Foundational**: once T005 is done, T006, T007, T008, T010 and T012 run in parallel. T009, T011 and T013 follow their tests; T014 and T015 run in parallel with T011 and T013.
- **US1**: T016, T017 and T018 (tests) in parallel. After T021, T022, T023 and T026 in parallel; then T024 → T025 → T027 → T028 → T029.
- **US2**: T030 and T031 in parallel, then T032 → T033 → T034. T035 in parallel with T033 once the API types exist.
- **US3**: T038, T039 and T040 in parallel. T041 → T042 → T043; T044 and T045 in parallel with T043; then T046 → T047.
- **US4**: T048 and T049 in parallel, then T050 → T051; T052 in parallel with T051.
- **Across stories**: one developer on US1 while another builds US2 (export) end to end.

## Implementation Strategy

1. **MVP = Setup + Foundational + US1**: students can bring in a Google timetable. Validate with quickstart scenario 1, then ship.
2. **+ US2**: export to phone and Outlook, plus the manual interop check (T037).
3. **+ US3**: safe re-imports, full backups via round trip, and undo.
4. **+ US4**: exact handling of every unusual entry and time-zone case.
5. **+ US5, then Polish**: accessibility completion, performance check, docs, and full validation.
