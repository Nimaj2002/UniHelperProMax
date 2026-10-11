---

description: "Task list for feature 009 — Calendar Events and Quick Create"
---

# Tasks: Calendar Events and Quick Create

**Input**: `/specs/009-calendar-events-quick-create/` (plan, spec, research R1–R15, data-model,
contracts `openapi.yaml` · `ui-calendar.md`, quickstart)

**Tests**: INCLUDED — Constitution VI requires tests for every endpoint and keeps the critical flows
green; Principle I/II guarantees (nothing deleted before Trash "Yes", files under `_Events`, exact
restore) get integration tests. Tests first in each story.

**Order**: Setup → Foundational → US1 (create + display events, MVP) → US2 (event workspace +
Events page) → US3 (edit + delete events, delete → Trash) → US4 (Trash page, restore, permanent
delete, hierarchy delete) → US5 (press and drag drafts) → US6 (quick form + Undo) → US7 (keyboard
and touch) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: user story from spec.md (US1–US7)

---

## Phase 1: Setup

- [X] T001 Create module skeletons: `backend/src/unihelper/api/v1/events.py`, `backend/src/unihelper/api/v1/trash.py` (empty `APIRouter`s registered in `backend/src/unihelper/api/v1/__init__.py` / `main.py` like the other routers), `frontend/src/features/events/{api.ts,routes.tsx}` imported from `frontend/src/app/features.ts`, `frontend/src/features/settings/trash/{api.ts,TrashPage.tsx}` (placeholder)
- [X] T002 [P] Add tokens to `frontend/src/styles/tokens.css` for light, dark and every preset: `--draft-bg`, `--draft-border`, `--draft-fg`, `--event-marker` (custom themes derive them in `frontend/src/app/theme.tsx`); add `--draft-fg` on `--draft-bg` and `--event-marker` on `--surface` to `frontend/tests/unit/tokens.contrast.test.ts` (AA ≥ 4.5:1 text, ≥ 3:1 marker)
- [X] T003 [P] Test helpers: `backend/tests/contract/event_helpers.py` with `new_event_body(**overrides)` (title "AI Seminar", inline semester `{name:"Fall 2026", year:{name:"2026"}}`, date, 14:00–15:30) and `make_event(client, **kw)`; `content_for(client, session_key)` creating one note, one imported audio and one PDF (reuse `tests/pdf_fixtures.py` and the 006 audio fixture)

---

## Phase 2: Foundational (blocks all stories)

- [X] T004 Migration `backend/src/unihelper/db/migrations/versions/0010_events_trash.py` (revision "0010", down "0009", docstring with the reasons from research R2–R6): create `event_series` (columns per data-model.md: `title` CHECK `length(title) BETWEEN 1 AND 120`; `location` ≤ 200 nullable; `color` CHECK in the 12 `COLOR_KEYS`, default `'blue'`; `semester_id` FK semesters CASCADE; `lineage_id`; `split_from_id` FK SET NULL; rule columns and CHECKs copied from `class_series`; `count` 1–500; index (user_id, semester_id), (lineage_id)), `event_links` (FK CASCADE; ≤ 10 per series enforced in service), `trash_entries` (columns per data-model.md; `kind` CHECK in (`class`,`event`); `reason` CHECK in (`delete`,`hierarchy_delete`); counts ≥ 0; `occurrence_count` ≥ 1); `batch_alter_table` rebuild of `session_folders` (`course_id` nullable FK SET NULL; + `semester_id` FK SET NULL, `kind` NOT NULL default `'class'` CHECK in (`class`,`event`), `trash_entry_id` FK trash_entries SET NULL, `origin_path` Text null; CHECK `trash_entry_id IS NOT NULL OR (kind='class' AND course_id IS NOT NULL) OR (kind='event' AND semester_id IS NOT NULL)`; UNIQUE (course_id, folder_key), (semester_id, folder_key), (lineage_id, original_date)); `ADD COLUMN` on `session_exceptions`: `title`, `color`, `links_json`, `moved_date`, `detached` Boolean default 0
- [X] T005 [P] Models: `backend/src/unihelper/models/event_series.py` (`EventSeries`, `EventLink` with delete-orphan), `backend/src/unihelper/models/trash_entry.py` (`TrashEntry`), update `models/session_folder.py` and `models/session_exception.py` per T004; export all from `models/__init__.py`
- [X] T006 [P] Integration test `backend/tests/integration/test_migration_0010.py`: a populated 0009 DB (class with two session folders holding notes, a recording with a transcription job, a document with annotation ops, workspace states, exceptions) upgrades with every row and FK intact, `kind='class'`, new columns NULL, `PRAGMA foreign_key_check` empty; a course whose folder is `_Events` survives untouched
- [X] T007 [P] `backend/src/unihelper/domain/naming.py`: `EVENTS_DIR = "_Events"`, `is_reserved_course_folder(name) -> bool` (`safe_name(name).casefold() == "_events"`), `event_folder_name(date, title)` (`safe_name(f"{date:%Y-%m-%d} {title}")`); unit tests `backend/tests/unit/test_event_naming.py` (`"_events"`, `" _Events. "`, `"_EVENTS"` reserved; `"Events"`, `"_Events 2"` not; title with `/:*?` sanitized; 80-char truncation)
- [X] T008 Segment protocol: make `backend/src/unihelper/domain/scopes.py` and `domain/recurrence.py` operate on a `SegmentLike` protocol (fields used today on `ClassSeries`) and let exceptions carry `moved_date` / `detached` (expansion places a moved occurrence on `moved_date`, key keeps `original_date`; a `detached` modified exception is emitted even when the rule no longer generates the date); existing `backend/tests/unit/test_scopes.py` and `test_recurrence.py` stay green, add cases for moved and detached exceptions
- [X] T009 Extract `backend/src/unihelper/services/series_apply.py` `apply_changeset(db, changeset, repo)` from `class_service._apply` with a `SeriesRepo` for `ClassSeries` (`class_service` now calls it); `backend/tests/integration/test_edit_scopes_flow.py` still green
- [X] T010 `backend/src/unihelper/services/session_folder_service.py`: `resolve(key)` looks up class lineages then event lineages; `ResolvedSession` gains `kind`, `semester`, nullable `course`, `title`; `folder_parts` → `semester_parts + [EVENTS_DIR, folder_name]` for events; `get_or_create_folder` for events uses `event_folder_name` made unique among the semester's event folders **and** directories on disk (new `StorageService.exists(parts)` in `backend/src/unihelper/storage/storage_service.py`); 409 `events_folder_conflict` when a course in that semester has folder key `_events`; folders with `trash_entry_id` are never resolved (404)
- [X] T011 Reserved course name: in `backend/src/unihelper/services/hierarchy_service.py` `_clean`/`get_or_create_course`/`update_course` raise `validation_error("/name", "reserved_name", "“_Events” is reserved for events.")` when `is_reserved_course_folder(name)`; `_folder_for` for courses never returns `_Events`; course tree (`GET /course-tree`, `schemas/hierarchy.py`) gains `reservedNameConflict` per course and `eventCount` per semester; contract tests in `backend/tests/contract/test_hierarchy.py` (create, rename, inline create via `POST /classes` → 422 `reserved_name`)
- [X] T012 Preferences: add `lastSemesterId: str | None = None` and `quickCreateType: Literal["class","event"] = "class"` to `DEFAULT_PREFERENCES` in `backend/src/unihelper/services/workspace_service.py` and `Preferences` in `backend/src/unihelper/schemas/notes.py`; contract test in `backend/tests/contract/test_workspace.py`
- [X] T013 Regenerate API types: `uv run python -m unihelper.export_openapi ../frontend/openapi.json` and `pnpm gen:api` (`frontend/src/lib/api/schema.d.ts`); repeat after each story that changes schemas

**Checkpoint**: migration, naming, resolver and preferences ready; all existing suites green (contract coverage waits for the new routes).

---

## Phase 3: User Story 1 — Create an event and see it on the calendar (P1) 🎯 MVP

**Goal**: "New event" creates one-off or repeating events in a semester; they show in day, week and month views with an Event marker, overlapping entries side by side; never on course timelines or counts.

**Independent Test**: create a one-off and a weekly event via "New event"; both appear in all three views with marker, title and time; absent from course timelines and session counts.

- [X] T014 [P] [US1] Contract tests `backend/tests/contract/test_events.py`: `POST /events` 201 (`EventCreated`, spec "009"; `created.semesterId`/`yearId` set when created inline, null when referenced), 422 for empty title, title > 120, end ≤ start, `semester_end` without end date (`semester_end_missing`), `count` > 500; 404 foreign semester; `GET /events/{lineageId}` (`EventDetail`, `semesterLocked` false)
- [X] T015 [P] [US1] Contract tests `backend/tests/contract/test_sessions_events.py`: `GET /sessions?from&to` returns classes and events sorted by start with `kind`, `title`, `semesterId`, null `courseId`/`courseName`/`seriesId` for events; `?courseId=` excludes events; course timeline and `deletion-impact` counts unchanged by events (FR-009)
- [X] T016 [US1] `backend/src/unihelper/schemas/events.py` (`EventCreate`: `title` 1–120 trimmed, `semester` RefOrNew, `location` ≤ 200, `links` ≤ 10, `color` default `blue`, `recurrence` as 001; `EventCreated`, `EventSegment`, `EventDetail`) and `Session` additions in `backend/src/unihelper/schemas/classes.py` (`kind`, `title`, `semesterId`; nullable `courseId`, `courseName`, `seriesId`)
- [X] T017 [US1] `backend/src/unihelper/services/event_service.py`: `create_event` (inline year/semester via `hierarchy_service.get_or_create_*`, `validate_rule`, lineage = uuid7, returns `created` refs) and `get_event`; `SeriesRepo` for `EventSeries`
- [X] T018 [US1] `backend/src/unihelper/services/session_query.py`: `list_sessions` expands event series (join Semester) alongside classes, applies exceptions (title/color/links/moved/detached), skips occurrences whose folder is trashed; `?courseId` keeps classes only; `find_session` handles event keys
- [X] T019 [US1] Routes in `backend/src/unihelper/api/v1/events.py`: `POST /events`, `GET /events/{lineage_id}`; `POST /classes` 201 body gains `created` (`backend/src/unihelper/services/class_service.py`, `schemas/classes.py`)
- [X] T020 [P] [US1] Vitest `frontend/tests/unit/overlap-layout.test.ts`: classes and events mixed, 4 overlapping → 4 columns, touching entries share a column; `frontend/tests/unit/calendar-views.test.tsx`: event block shows icon, title, time, location (≥ 40 px) and name "Event: AI Seminar, …"
- [X] T021 [US1] `frontend/src/features/calendar/EventBlock.tsx`: `kind` prop; events show the Phosphor `CalendarStar` icon, `--event-marker` dashed left border, accessible name prefix "Event:"; full title in a `Tooltip` on hover and focus for classes and events (FR-008); `TimeGrid.tsx` and `MonthView.tsx` pass `kind`; "+N more" lists events
- [X] T022 [US1] `frontend/src/features/events/EventForm.tsx` + `NewEventDialog.tsx` (route `/events/new` in `frontend/src/features/events/routes.tsx`, overlay in `CalendarLayout`): fields Title*, Year/Semester* (`HierarchyPicker` with a `levels="semester"` option), Date, Start, End, Location, `LinksEditor`, `ColorPicker` default Blue, `RecurrenceFields`; validation like `validateClassForm`; server errors mapped by JSON pointer; accepts prefill from router state; on success `toast.success("Event created")`, PATCH `/preferences` `lastSemesterId`, navigate to the start date's week
- [X] T023 [US1] Semester preselection hook `frontend/src/features/events/usePreselectedSemester.ts`: open course's semester (from route `courses/:courseId`) → `lastSemesterId` if it still exists in the course tree → none; also used by the class form for its year/semester
- [X] T024 [US1] "New event" button next to "New class" in `frontend/src/features/calendar/CalendarToolbar.tsx`; shortcut `e` in `frontend/src/features/calendar/useCalendarKeyboard.ts` + `CALENDAR_SHORTCUTS`; `frontend/src/features/classes/api.ts` `useSessions` types updated for `kind`; class form writes `lastSemesterId` on success too
- [X] T025 [P] [US1] Playwright `frontend/tests/e2e/events.spec.ts` (create part): New event with course open → semester preselected; weekly event every Thursday; overlap of class + two events all visible and clickable; tooltip on focus; not on the course page

**Checkpoint**: MVP — events can be created and seen on the calendar.

---

## Phase 4: User Story 2 — Work inside an event and browse a semester's events (P1)

**Goal**: event workspace identical to sessions; files under `<year>/<semester>/_Events/<date title>/`; "Events" entry per semester; Events page; side card shows event notes + semester events timeline; reserved course name refused.

**Independent Test**: open a past event, add a note, record, upload a PDF; files sit under `_Events`; Events page and side card list the event.

- [X] T026 [P] [US2] Integration test `backend/tests/integration/test_events_storage_flow.py`: event note/recording/PDF created through the real API land in `<user>/2026/Fall 2026/_Events/2026-10-15 AI Seminar/{notes,audios,documents}`; second event with same date+title → `… (2)`; a pre-existing directory with that name on disk is skipped, never reused; transcription appends into the event note; semester rename moves `_Events` with it; course `_Events` conflict → 409 `events_folder_conflict`
- [X] T027 [P] [US2] Contract tests `backend/tests/contract/test_events.py`: `GET /semesters/{id}/events/timeline` (`EventTimelineEntry`: date order, `status` past/upcoming, note/audio/document counts, detached occurrences included); notes/recordings/documents/workspace endpoints accept event keys (200/201)
- [X] T028 [US2] `backend/src/unihelper/services/document_service.py`: scope = course for classes, event lineage for events (`course_folder_ids` → `scope_folder_ids(resolved)`); `workspace_service.py` document tabs use the same scope; `transcription_service.py` job view `course_id` nullable
- [X] T029 [US2] `backend/src/unihelper/services/timeline_service.py` `semester_events_timeline(semester_id)` + route `GET /semesters/{semester_id}/events/timeline` in `backend/src/unihelper/api/v1/events.py`; course timeline excludes trashed folders and event folders
- [X] T030 [US2] Frontend routes `frontend/src/features/events/routes.tsx`: `/semesters/:semesterId/events` → `EventsPage.tsx` (timeline via `SessionTimeline` with an `entries` prop and event variant, same past/upcoming styling, empty state "No events in this semester yet."), `/semesters/:semesterId/events/:sessionKey` → `WorkspacePage`
- [X] T031 [US2] `frontend/src/features/sessions/WorkspacePage.tsx` + `SessionTimeline.tsx`: read either `{courseId}` or `{semesterId}` from params; for events the timeline section is titled "Events · <Semester>" and lists the semester's events; `workspacePath()` builds the event path for event keys; header chip shows the Event marker
- [X] T032 [US2] `frontend/src/features/courses/CoursePanel.tsx`: "Events" link (CalendarStar icon, `eventCount` badge when > 0) at the end of each semester's list, kept with its semester by search filtering (`filterTree`); course rows with `reservedNameConflict` show a warning icon with "Rename this course: “_Events” is reserved for events."; `frontend/tests/unit/course-panel.test.tsx` covers both
- [X] T033 [US2] Course create/rename UIs (`frontend/src/features/courses/HierarchyMenu.tsx`, `HierarchyPicker.tsx`) show the `reserved_name` server message on the name field
- [X] T034 [P] [US2] Playwright `frontend/tests/e2e/events.spec.ts` (workspace part): open event, note autosaves, record 3 s, upload PDF, Events page lists it with past styling, side card shows "Events · Fall 2026"; course name `_Events` refused

**Checkpoint**: events are full workspaces with readable storage.

---

## Phase 5: User Story 3 — Edit and delete events (P1)

**Goal**: edit every field with this/following/all scopes; series edits leave occurrences with content or individual edits unchanged and report the count; semester lock; deletes (classes and events) move to the Trash with content counts in the confirmation; semester rename/delete dialogs name events.

**Independent Test**: edit one occurrence and the whole series; try to change the semester of an event with notes; delete an event with content and see it leave the calendar with files still on disk.

- [X] T035 [P] [US3] Unit tests `backend/tests/unit/test_event_scopes.py`: "this" edit of title/color/links/date writes a modified exception with `moved_date`; "all" title change with one occurrence holding content → that occurrence frozen (`detached` when its date drops out), `unchanged_count` = frozen + already modified
- [X] T036 [P] [US3] Contract tests `backend/tests/contract/test_events.py`: `PATCH /sessions/{key}` with `EventEdit` for each scope (`ScopeResult.unchangedCount`), `semesterId` change 200 without content (empty folders moved) and 409 `semester_locked` with content; `GET /events/{id}` `semesterLocked` true after a note; `GET /sessions/{key}/deletion-impact?scope=` (`DeletionImpact` counts) for a class and an event
- [X] T037 [P] [US3] Integration test `backend/tests/integration/test_trash_flow.py::test_delete_moves_to_trash`: deleting an event (scope all) and a class session (scope this) with content → occurrences gone from `GET /sessions` and timelines, one `trash_entries` row each with correct counts and `origin_path`, every file byte-identical on disk; `test_edit_scopes_flow.py` updated: deleted sessions with content are no longer listed as unscheduled
- [X] T038 [US3] `backend/src/unihelper/services/event_service.py` `apply_scope_edit`: field rules per research R3 (this-scope may change every field except semester), freeze rule R4 before "following"/"all", `unchanged_count`; `change_semester` (whole lineage; 409 `semester_locked` if any non-trashed folder has content; empty folder directories moved with `storage.rename_dir` + rollback hook)
- [X] T039 [US3] `backend/src/unihelper/domain/trash_payload.py`: `TrashPayloadV1` (before-images of segments + links, removed/changed exceptions, ids of cancel exceptions created) with `build(changeset, before)` and `to_json`/`from_json`; unit tests `backend/tests/unit/test_trash_payload.py` (round-trip for this/following/all on classes and events)
- [X] T040 [US3] `backend/src/unihelper/services/trash_service.py` `move_to_trash(resolved, scope)`: run the scope delete planner, capture payload, apply via `series_apply`, set `trash_entry_id` + `origin_path` on folders of removed occurrences, create the `TrashEntry` (label, year/semester/course names, first/last date, counts, `reason='delete'`); never touches files
- [X] T041 [US3] `backend/src/unihelper/api/v1/sessions.py`: `PATCH /sessions/{key}` branches on kind (`EventEdit` vs `SessionEdit`); `DELETE /sessions/{key}` calls `trash_service.move_to_trash` for classes and events and returns `trashEntryId`; new `GET /sessions/{key}/deletion-impact`
- [X] T042 [US3] `backend/src/unihelper/services/hierarchy_service.py` `deletion_impact` adds `events`, `notes`, `recordings`, `documents` (`schemas/hierarchy.py`); rename of a semester/year carries `_Events` along (folder recomputation; covered in T026)
- [X] T043 [US3] `frontend/src/features/events/EditEventFlow.tsx` (wired from `frontend/src/features/classes/EditSessionFlow.tsx` when `kind==="event"`): scope dialog labels "This event / This and following events / All events" (`ScopeDialog` gets a `noun` prop), `EventForm` edit mode with Semester disabled + reason when `semesterLocked`; success toast "Saved. N events with notes, recordings or documents, or edited individually, were left unchanged." when `unchangedCount > 0`
- [X] T044 [US3] `frontend/src/features/classes/DeleteSessionFlow.tsx`: after scope choice fetch `deletion-impact`; dialog text "This will move … with N notes, N recordings and N documents to the Trash. You can restore it from Settings → Trash." (counts omitted when 0); buttons Cancel · Move to Trash; event nouns for events; invalidate trash queries
- [X] T045 [US3] `frontend/src/features/courses/HierarchyMenu.tsx` `impactSentence`: names events and content counts and says classes and events go to the Trash
- [X] T046 [P] [US3] Playwright `frontend/tests/e2e/events.spec.ts` (edit/delete part): this/all edits with unchanged count message, locked semester text, delete dialog counts, event disappears

**Checkpoint**: events are editable; every class/event deletion is recoverable data.

---

## Phase 6: User Story 4 — Restore or permanently delete from the Trash (P1)

**Goal**: Settings → Trash lists deleted classes and events; Restore puts them back exactly (recreating missing year/semester/course by name); Delete asks "Are you sure?" and removes files; hierarchy deletes create one entry per lineage.

**Independent Test**: delete a class with notes and an event with a recording; both listed; restore one with its data; permanently delete the other (No → unchanged, Yes → files gone).

- [X] T047 [P] [US4] Contract tests `backend/tests/contract/test_trash.py`: `GET /trash` (`TrashEntry`, newest first, `?kind=`), `POST /trash/{id}/restore` 200 (`RestoreResult`) / 412 stale / 404 foreign user, `DELETE /trash/{id}` 204 / 412; purge failure → 500 `PurgeProblem` with `failedPaths` and entry kept with `purgeError`
- [X] T048 [P] [US4] Integration tests `backend/tests/integration/test_trash_flow.py`: restore after delete (same session keys, content reattached, files byte-identical, no directory overwritten); restore after the series was edited again (dates come back as their own segment of the lineage); restore when the folder name is now taken (moved to a unique readable name); permanent delete removes only that folder directory and its DB rows (notes, recordings, documents, annotation ops, transcription jobs, workspace states), other folders untouched; missing files reported, never recreated
- [X] T049 [P] [US4] Integration test `backend/tests/integration/test_hierarchy_delete_trash.py`: deleting a semester with 2 classes and 1 event → 3 entries (`reason='hierarchy_delete'`), files untouched, folders detached; restoring one recreates year/semester/course by name (folders reused on disk); restoring into an existing same-name semester uses it; course/year deletes behave the same
- [X] T050 [US4] `backend/src/unihelper/storage/storage_service.py` `delete_tree(parts)`: only paths at session/event folder depth inside the user root, `resolve(strict=True)` without following symlinks out of the root, returns failed paths; unit tests in `backend/tests/unit/test_storage_service.py`
- [X] T051 [US4] `backend/src/unihelper/services/trash_service.py`: `list_entries(kind)` (recount content, `missingFiles`), `restore(entry_id, version)` per research R6 (get_or_create by names → re-insert payload with same lineage → drop created cancel exceptions → reattach folders, moving directories whose path differs from `origin_path` via `rename_dir` with rollback; 409 `reserved_name` if the course name is now reserved), `purge(entry_id, version)` (delete rows, then `delete_tree` after commit; on failure keep entry with `purge_error`)
- [X] T052 [US4] `backend/src/unihelper/services/hierarchy_service.py` `delete_entity`/`delete_year`: before deleting, `trash_service.move_lineage_to_trash(lineage, reason='hierarchy_delete')` for every class and event lineage inside (incl. unscheduled folders with content), detaching folders (`course_id`/`semester_id` NULL, `origin_path` set); orphan `session_exceptions` captured in payloads
- [X] T053 [US4] Routes in `backend/src/unihelper/api/v1/trash.py`: `GET /trash`, `POST /trash/{entry_id}/restore`, `DELETE /trash/{entry_id}`; schemas `backend/src/unihelper/schemas/trash.py`
- [X] T054 [P] [US4] Vitest `frontend/tests/unit/trash-page.test.tsx`: two lists, empty state, entry text (dates, counts, "Deleted …"), Restore/Delete accessible names, "Are you sure?" No/Yes with No focused by default
- [X] T055 [US4] `frontend/src/features/settings/trash/TrashPage.tsx` + `api.ts` per `contracts/ui-calendar.md` (sections "Deleted classes"/"Deleted events", entry cards, `ArrowCounterClockwise` Restore and `Trash` Delete icon buttons, `AlertDialog` "Are you sure?" No/Yes, focus to next entry or heading, toast "Restored <label>" with "Show in calendar" and recreated names; invalidates schedule, course tree and timelines); add `{ to: "/settings/trash", label: "Trash" }` to `SettingsLayout.tsx` and the `trash` child route in `frontend/src/features/settings/routes.tsx` (lazy)
- [X] T056 [P] [US4] Playwright `frontend/tests/e2e/trash.spec.ts`: delete event → listed → restore → back with note; delete class → Delete → No → still listed → Yes → gone; delete semester → entries → restore recreates semester in the left card

**Checkpoint**: deletion is fully reversible until "Yes".

---

## Phase 7: User Story 5 — Create by pressing and dragging (P2)

**Goal**: day/week press-and-drag and click drafts (15-minute snap, min 15 min, same day, auto-scroll, Escape), month-view click drafts, drafts beside overlapping entries; opens the quick form.

**Independent Test**: drag Tue 13:00→14:45 crossing into Wednesday and near the bottom edge; click at 10:20; click an empty month day; Escape mid-drag.

- [X] T057 [P] [US5] Vitest `frontend/tests/unit/draft.test.ts` for `frontend/src/features/calendar/draft.ts`: `yToMinutes` with scroll offset and `HOUR_PX`, `snap15`, `draftRange(press, pointer)` (upward drag, min 15, clamp 0–1440), `isClick` (< 4 px), `clickDraft(min)` = 60 min snapped (capped at 24:00), month default 09:00–10:00
- [X] T058 [US5] `frontend/src/features/calendar/draft.ts` (pure helpers above) and `useDraft.ts` (single draft reducer: `start`, `update`, `release`, `discard`, `replace` with the discard rule from FR-039; `dirty` flag set by the form)
- [X] T059 [US5] `frontend/src/features/calendar/useGridDrag.ts`: `pointerdown` on column background only (ignore targets inside `[data-session-key]` and the draft), `setPointerCapture`, vertical tracking in the start column only, rAF auto-scroll within 32 px of the scroller edge (4–16 px/frame), Escape cancels and releases capture, `pointerType==="touch"` → tap creates the 1-hour draft without dragging
- [X] T060 [US5] `frontend/src/features/calendar/TimeGrid.tsx`: `SLOT_MIN = 15` (slot buttons and positioning), render the draft block (`--draft-*` tokens, label "13:00 – 14:45", `aria-hidden`) through `layoutOverlaps` with `kind:"draft"` so overlapping entries stay visible; slot click creates a draft instead of navigating to `/classes/new` (behind a `QUICK_CREATE` flag until T066 lands, so the old slot click keeps working); polite live region in `CalendarPage.tsx` announcing "New entry, from HH:MM to HH:MM" (debounced 300 ms during drag)
- [X] T061 [US5] `frontend/src/features/calendar/MonthView.tsx`: click on empty day-cell space (not date number, chip or "+N more") creates the 09:00–10:00 draft chip for that date; extend `frontend/tests/unit/calendar-views.test.tsx`
- [X] T062 [US5] Reduced motion: no draft transition when `useReducedMotion()`; overlap test in `frontend/tests/unit/overlap-layout.test.ts` with a draft column

**Checkpoint**: drafts can be drawn; the quick form (US6) completes them.

---

## Phase 8: User Story 6 — Finish a draft with the quick form (P2)

**Goal**: quick form beside the draft (Class/Event, required fields, live time edits, repeat choice, More options), Save with Undo ≥ 10 s, failure keeps data, discard rules.

**Independent Test**: save a class, a class with a new course, an event; change times live; More options; Cancel/Escape; dirty and clean click-outside; failed save then retry; Undo.

- [X] T063 [P] [US6] Contract tests `backend/tests/contract/test_creation_undo.py`: `POST /creations/undo` 204 for a fresh event and a fresh class with inline year/semester/course (rows and their empty directories removed), 409 `undo_unavailable` after a note is added or when another class uses the created course, 412 stale version, 404 unknown lineage
- [X] T064 [US6] `backend/src/unihelper/services/creation_undo.py` + route `POST /creations/undo` (in `backend/src/unihelper/api/v1/events.py` or a small `api/v1/creations.py`): delete the series (class or event) and created hierarchy rows when unused; remove created directories only if empty (`StorageService.remove_empty_dir`); no Trash entry
- [X] T065 [P] [US6] Vitest `frontend/tests/unit/quick-create.test.tsx`: type defaults (Class first, then `quickCreateType`), Class requires course (new course requires year+semester), Event requires title+semester, end ≤ start disables Save, editing times updates the draft, "Weekly on <weekday>" payload, "More options" router state contains every value, Escape/Cancel discard, click outside ignored when dirty
- [X] T066 [US6] `frontend/src/features/calendar/QuickCreateForm.tsx`: `Popover` (`modal={false}`, `PopoverAnchor virtualRef` to the draft) on desktop, bottom `Sheet` otherwise; fields per `contracts/ui-calendar.md`; `onInteractOutside` → discard only if not dirty; `onEscapeKeyDown` → discard; focus first empty required field on open, return focus to the draft's slot (or the new entry) on close; route change discards
- [X] T067 [US6] Save flow in `QuickCreateForm.tsx`: `POST /classes` or `POST /events`, PATCH `/preferences` `{quickCreateType, lastSemesterId}`; on success the draft is replaced by the entry (invalidate sessions), Sonner `toast("Event created", { duration: 10000, action: { label: "Undo", onClick: POST /creations/undo } })`; `undo_unavailable` → toast "Can't undo: the entry already has content."; on failure the form stays with values and a `role="alert"` message, Save retries
- [X] T068 [US6] "More options" and Repeat "Custom…" navigate to `/classes/new` or `/events/new` with router state; `frontend/src/features/classes/NewClassDialog.tsx` and `frontend/src/features/events/NewEventDialog.tsx` read it (date, times, course/semester refs, title, location, links, repeat)
- [X] T069 [P] [US6] Playwright `frontend/tests/e2e/quick-create.spec.ts`: drag-create event and class, new course path, live time edit, Escape/Cancel/click-outside rules, backend error then retry (route intercept), Undo within 10 s, entry identical to full-form creation (compare `GET /sessions` rows and folder paths)

**Checkpoint**: Google-Calendar-style creation works end to end.

---

## Phase 9: User Story 7 — Create entries without a mouse (P2)

**Goal**: keyboard slot ranges, Enter opens the quick form, Escape cancels, announcements, focus handling; touch tap.

**Independent Test**: keyboard-only creation of a class and an event in day and week view, with announcements and focus return.

- [X] T070 [P] [US7] Vitest `frontend/tests/unit/keyboard-range.test.ts`: ↑/↓ ±15 min, ←/→ ±1 day in week view, Shift+↑/↓ shrink/extend with min 15, Escape clears, Enter emits the range
- [X] T071 [US7] `frontend/src/features/calendar/TimeGrid.tsx` keyboard handler: highlighted range state rendered as the draft block, Shift+arrows, Enter/Space open the quick form for the range, Escape clears; announcements through the live region; update `CALENDAR_SHORTCUTS` help text
- [X] T072 [P] [US7] Playwright `frontend/tests/e2e/quick-create.spec.ts` (keyboard part): Tab into grid, arrows, Shift+↓ ×3, Enter, form focused, Save, focus back on the grid; live region text "New entry, from 10:00 to 11:00"; touch emulation tap creates a 1-hour draft

**Checkpoint**: every creation path works by keyboard.

---

## Phase 10: Polish & Cross-Cutting

- [X] T073 [P] `frontend/tests/e2e/a11y-themes.spec.ts`: axe AA for calendar with events + draft + quick form open, Events page, Trash page and dialogs in light, dark, a preset and a custom theme; reduced-motion run
- [X] T074 [P] `frontend/tests/unit/no-hardcoded-colors.test.ts` passes (new components use tokens only); `pnpm lint` (jsx-a11y) clean
- [X] T075 Run the critical flows (`test_record_save_flow`, `test_recording_recovery`, `test_transcribe_append_flow`, `test_recurring_class_creation`) and the full backend suite incl. the contract coverage guard; fix regressions
- [X] T076 [P] Performance check (SC-003): Playwright trace of a drag in a week with 50 entries — no long tasks > 16 ms during pointer moves; `GET /sessions` for a week ≤ 300 ms with 50 classes + events
- [X] T077 Update `README.md` (events, `_Events` folder, Trash) and `specs/KNOWN-ISSUES.md` if anything is deferred; run every scenario in `specs/009-calendar-events-quick-create/quickstart.md` and record results

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T013)** → stories.
- **US1** needs Foundational. **US2** needs US1 (events exist). **US3** needs US1 (US2 only for content-based tests T026/T037 fixtures — run after US2). **US4** needs US3 (`trash_service.move_to_trash`, payloads). **US5** needs Foundational only (drafts render without saving). **US6** needs US5 (draft) and US1 (`POST /events`). **US7** needs US5 + US6.
- Within each story: tests → schemas/models → services → routes → frontend → e2e.
- T013 (regenerate types) after each story that changes backend schemas (US1, US2, US3, US4, US6).

```text
Setup → Foundational ─┬─ US1 ─┬─ US2 ─ US3 ─ US4
                      │       └──────────────┐
                      └─ US5 ────────────────┴─ US6 ─ US7 → Polish
```

## Parallel Examples

- **Foundational**: T005, T006, T007 together (models, migration test, naming) after T004.
- **US1**: T014, T015, T020 (tests) together; then T016→T017→T018→T019 backend while T021–T024 frontend proceed against the contract.
- **US2**: T026, T027 together; T030–T033 frontend in parallel with T028–T029.
- **US3**: T035, T036, T037, T039 together; T043–T045 frontend in parallel with T038/T040–T042.
- **US4**: T047, T048, T049, T054 together; T055 in parallel with T050–T053.
- **US5 can start right after Foundational**, in parallel with US1–US4 (frontend-only).

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1 → events on the calendar (demo-able).
2. Add US2 (workspace + storage) — events become useful for capturing content.
3. Add US3 + US4 together before release: US3 switches deletes to the Trash, and US4 is what makes trashed data visible and recoverable; do not ship US3 without US4.
4. Add US5 → US6 → US7 (quick create), keeping the existing slot click working until US6 lands (T060 switches slot clicks to drafts only once the quick form exists).
5. Polish: accessibility, themes, performance, critical flows, quickstart run.
