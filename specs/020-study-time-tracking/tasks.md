---

description: "Task list for Study Time Tracking (Time mode)"
---

# Tasks: Study Time Tracking (Time mode)

**Input**: Design documents from `/specs/020-study-time-tracking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/time-api.md, contracts/ui.md, quickstart.md

**Tests**: Included. Constitution Principle VI requires automated tests for every endpoint
(success + primary errors); pure logic (clock, state machine, reports) gets unit tests.

**Organization**: One phase per user story, in priority order. Paths are relative to the repo root.
Backend: `backend/src/unihelper/`, `backend/tests/`. Frontend: `frontend/src/`, `frontend/tests/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US12 from spec.md

---

## Phase 1: Setup

- [X] T001 Create the feature folder `frontend/src/features/time/` with an empty `index.ts`, and the backend module stubs `backend/src/unihelper/models/time_tracking.py`, `backend/src/unihelper/schemas/time_tracking.py`, `backend/src/unihelper/services/time_service.py`, `backend/src/unihelper/api/v1/time.py` (router `APIRouter(prefix="/time", tags=["time"])`)
- [X] T002 Register the `time` router in `build_api_router()` in `backend/src/unihelper/main.py` (add `time` to the module tuple next to `backup`, with comment `# 020`)

---

## Phase 2: Foundational (blocks every story)

- [X] T003 Create models `TimeTag`, `TimeEntry`, `TimeTimer` in `backend/src/unihelper/models/time_tracking.py` per data-model.md: `time_tags` (`name` str(30) required trimmed 1–30 chars, `name_key` = casefold(name) with `UNIQUE(user_id, name_key)`, `color` one of `tag-1`…`tag-12`, IdMixin/TimestampMixin/VersionMixin); `time_entries` (`started_at` required, `ended_at` required `> started_at`, `paused_seconds` int default 0, `description` str(500) optional, `tag_id` FK time_tags `ON DELETE SET NULL`, `source` enum `track · pomodoro · focus · manual`, `course_id` FK courses SET NULL, `task_id` FK tasks SET NULL, `session_key` str nullable, `link_title` str(200) nullable, `deleted_at` nullable; indexes `(user_id, started_at)`, `(user_id, ended_at)`, `(user_id, session_key)`); `time_timers` (`user_id` primary key, `style` enum `track · pomodoro · focus`, `state` enum `running · paused · waiting`, `started_at`, `paused_at?`, `paused_ms` int, `planned_end_at?`, `finished_at?`, description/tag_id/course_id/task_id/session_key/link_title as on entries, `phase` enum `work · short_break · long_break` nullable, `period` int nullable, `focus_minutes` int nullable 1–480, `goal` str(200) nullable, `hide_panels` bool, `reminder_ack` int default 0, VersionMixin); export them from `backend/src/unihelper/models/__init__.py`
- [X] T004 Write migration `backend/src/unihelper/db/migrations/versions/0017_time_tracking.py` creating the three tables and indexes (down-revision `0016_general_notes`)
- [X] T005 [P] Add `time_tags`, `time_timers`, `time_entries` to `_INCLUDED` in `backend/src/unihelper/backup/tables.py`, ordered after `tasks` with `time_tags` before the other two (research R9)
- [X] T006 [P] Add the `time` preferences object to `Preferences` in `backend/src/unihelper/schemas/notes.py` and its defaults to `DEFAULT_PREFERENCES` in `backend/src/unihelper/services/workspace_service.py`: `pomodoro_work_min` 25 (1–120), `pomodoro_short_min` 5 (1–60), `pomodoro_long_min` 15 (1–120), `pomodoro_periods` 4 (2–8), `pomodoro_auto_start` false, `focus_hide_panels` false, `long_running_hours` 3 (1–12 or null = off), `sound` true, `system_notifications` false, `indicator_combo` `combined` (`combined · stacked · recording_first`), `daily_goal_min` null (1–1440 or null); out-of-range → 422
- [X] T007 [P] Write pydantic schemas in `backend/src/unihelper/schemas/time_tracking.py`: `Timer`, `TimerResponse {timer, server_now, settled, undo, saved}`, `Undo`, `Settled`, `Entry` (with computed `duration_seconds = span − paused_seconds`), `EntryWrite`, `EntryWithOverlaps`, `Tag`, `TagWrite`, request bodies per contracts/time-api.md
- [X] T008 [P] Integration test for the migration in `backend/tests/integration/test_migration_0017.py` (upgrade from 0016 keeps existing data, creates the tables; downgrade drops them), following `test_migration_0016.py`
- [X] T009 [P] Write `frontend/src/features/time/clock.ts` (pure): `serverOffset(serverNow, receivedAt)`, `elapsedMs(timer, now, offset)` = `(now+offset) − started_at − paused_ms` (frozen at `paused_at` while paused), `remainingMs(timer, now, offset)` = `planned_end_at − (now+offset)`, `formatClock(ms)` showing hours beyond 24 (e.g. `26:14:03`); unit tests in `frontend/tests/unit/time-clock.test.ts` including a paused timer and a DST-crossing span (research R2) — tests live in `frontend/tests/unit/time-logic.test.ts`
- [X] T010 Write `frontend/src/features/time/api.ts`: TanStack Query hooks `useTimer()` (query key `["time","timer"]`, stores offset from `server_now`), `useEntries(from,to,sessionKey?)`, `useTags()`, and mutations for every endpoint in contracts/time-api.md; regenerate `frontend/src/lib/api/schema.d.ts` and `frontend/openapi.json` with the project's existing openapi script
- [X] T011 Write the outbox in `frontend/src/features/time/api.ts` (research R5): timer start/stop/pause and entry writes are stored in localStorage key `uh.time.outbox` with `client_at` (offset-corrected) and expected `version`, removed on success, retried after 2 s, 5 s, 15 s then every 30 s and on `online`/`focus`; expose `usePendingWrites()`; unit test in `frontend/tests/unit/time-outbox.test.ts` (no double save on retry, stale version dropped with a message) — covered by `frontend/tests/unit/time-timer-card.test.tsx`
- [X] T012 [P] Write `frontend/src/features/time/sync.ts` (research R12): `BroadcastChannel("uh-time")` post on every timer/entry/tag mutation success and invalidate on receive; refetch the timer on `focus`/`visibilitychange` and every 30 s while visible — implemented in `features/time/api.ts` (`startSync`)
- [X] T013 Add the `time` section to the home column: extend `ColumnSection` to `"tasks" | "notes" | "time"` and `SECTION_SWITCH_ID.time = "home-switch-time"` in `frontend/src/features/home/tasksColumn.ts` (stored value `time` accepted when reading `uh.home.tasksSection`); in `frontend/src/features/home/TasksPanel.tsx` add a third `ToggleGroupItem` (icon `Timer`, aria-label "Time"), change the switch aria-label to "Tasks, general notes or time" and the Card `label` to "Tasks and time", render `<TimePanel leading={start} trailing={trailing} />` when `section === "time"`; add a Time item to the rail items in `frontend/src/features/home/PanelRail.tsx`; update `frontend/tests/e2e/home-panels.spec.ts` and `frontend/tests/e2e/general-notes.spec.ts` selectors for the renamed labels (FR-001–FR-004, FR-063)
- [X] T014 Create the Time mode shell `frontend/src/features/time/TimePanel.tsx`: header card (leading/trailing from the panel), `TimerCard` slot, ToggleGroup Today / Reports, then the view; no other fixed bar; no horizontal scroll at 320 px (FR-005)

**Checkpoint**: tables, preferences, client plumbing and the empty Time mode exist.

---

## Phase 3: User Story 1 - Track time with a start/stop timer (P1) 🎯 MVP

**Goal**: Start, stop, survive restarts, replace with Undo, discard short runs, never lose time.

**Independent test**: quickstart scenarios 1–4.

### Tests for US1

- [X] T015 [P] [US1] Contract tests in `backend/tests/contract/test_time_timer.py`: `GET /time/timer` (null and running), `POST /time/timer/start` (201; replaces running with `undo`; 404 unknown tag; `at` clamped to `[server_now − 24 h, server_now]`), `POST /time/timer/stop` (saves entry; < 5 s discards and returns `undo`; `at` clamped to `[started_at, now]`; 409 stale version), `POST /time/timer/set-end` (422 before start / in future), `PATCH /time/timer`, `POST /time/timer/undo` (restores; 409 `undo_unavailable` when the timer or auto-saved entry changed); other users' timers are invisible
- [X] T016 [P] [US1] Unit tests for the Track part of the state machine in `backend/tests/unit/test_time_state_machine.py`
- [X] T017 [P] [US1] Integration test `backend/tests/integration/test_time_survives_restart.py`: start, recreate the app/engine on the same DB, `GET /time/timer` returns the same `started_at`; two concurrent starts leave exactly one timer

### Implementation for US1

- [X] T018 [US1] Implement in `backend/src/unihelper/services/time_service.py`: `get_timer`, `start` (one transaction: save old as entry if ≥ 5 s, replace row, build `undo`), `stop` (save entry or discard < 5 s with `undo`), `set_end`, `patch_timer`, `undo` (research R1, R6); entries created with `source` = timer style
- [X] T019 [US1] Implement the timer endpoints in `backend/src/unihelper/api/v1/time.py` returning `TimerResponse` with `server_now` on every response (contracts/time-api.md)
- [X] T020 [P] [US1] Build `frontend/src/features/time/TimerCard.tsx` Track view: ToggleGroup Track / Pomodoro / Focus (other styles labelled "Running: Track" while one runs), description input, tag picker slot, Start/Stop, live elapsed via `clock.ts` (1 s re-render, nothing accumulated), "Not saved yet — retrying" + "Retry now" from `usePendingWrites()`
- [X] T021 [US1] On app open with a running timer, show in `TimerCard.tsx` how long it has run and a "Stop and set end time" action opening a time picker limited to `[started_at, now]` (FR-008)
- [X] T022 [US1] Toasts with Undo (sonner) for replace and for a < 5 s stop, calling `POST /time/timer/undo`; "Can no longer undo" on 409, in `frontend/src/features/time/TimerCard.tsx` (FR-010, FR-011)
- [X] T023 [US1] Today list `frontend/src/features/time/TodayList.tsx`: today's entries (local day via `@date-fns/tz`, clipped to the day) in time order with durations and the day total; the running timer counted live
- [X] T024 [US1] Unit test `frontend/tests/unit/time-timer-card.test.tsx`: start/stop, replace toast, short-run toast, retrying state

**Checkpoint**: MVP — Track timer usable from the home panel.

---

## Phase 4: User Story 2 - Manage entries (P1)

**Goal**: Add time, edit, delete with Undo, Start again.

**Independent test**: add a manual entry, edit its start, delete, undo, Start again; check totals.

- [X] T025 [P] [US2] Contract tests `backend/tests/contract/test_time_entries.py`: `GET /time/entries` (overlap with `[from,to)`, `from`/`to` required and ≤ 400 days apart, excludes deleted), `POST` (end or duration; 422 `end_not_after_start`; `overlaps` listed), `PATCH` (409 stale version; `paused_seconds` reset to 0 when ≥ span), `DELETE` (soft), `POST /{id}/restore` (404 after purge), purge of rows deleted > 24 h ago on list
- [X] T026 [US2] Implement entry CRUD, overlap detection, soft delete, restore and purge in `backend/src/unihelper/services/time_service.py` and endpoints in `backend/src/unihelper/api/v1/time.py`
- [X] T027 [P] [US2] Build `frontend/src/features/time/EntryForm.tsx` (Dialog): start + end or duration, description, tag; shows "Overlaps with …" from the response; refuses end ≤ start with a reason (FR-016, FR-017)
- [X] T028 [US2] In `frontend/src/features/time/TodayList.tsx` add per-entry Edit, Delete (toast with Undo for at least 10 s, `duration: 10000`) and "Start again" (Track with the entry's description, tag and link); add the "Add time" button to `TimerCard.tsx` (FR-018, FR-019)

---

## Phase 5: User Story 3 - Floating indicator everywhere (P1)

**Goal**: Timer pill on every page, hidden only while the timer card is visible.

**Independent test**: start a timer, visit every page, focus mode, close the panel.

- [X] T029 [P] [US3] Build `frontend/src/features/time/TimerPill.tsx` with the `PILL` look of `frontend/src/features/recordings/RecordingBar.tsx`: style icon (Track `Timer`, Pomodoro `Hourglass`, Focus `Target`), time (elapsed Track, remaining others, digits `aria-hidden`), description or tag, Pause, Stop; label button navigates to `/`, opens the right panel in `time` (reuse the panel opening used by `frontend/src/features/home/openTask.ts`) and focuses the timer card; `motion-reduce` disables animation (FR-030, FR-031, FR-033)
- [X] T030 [US3] Visibility rule: `TimerCard.tsx` publishes "card ≥ 50 % visible" through an IntersectionObserver into a tiny store in `frontend/src/features/time/cardVisible.ts`; `TimerPill` hides while true; stays visible in focus mode and with the panel closed (FR-032)
- [X] T031 [US3] Polite live region in `TimerPill.tsx` announcing only phase changes, end, stop and "Still working?" (FR-033) — the live region is in `features/time/TimeHost.tsx`
- [X] T032 [US3] Long-running reminder: when elapsed passes `long_running_hours × (reminder_ack + 1)` show "Still working?" with Keep running (PATCH `reminder_ack + 1`) and Stop in the pill, or in `TimerCard.tsx` when the card is visible; off when the setting is null (FR-013)
- [X] T033 [US3] Rail Time icon in `frontend/src/features/home/PanelRail.tsx` shows the running time (minutes, `1h` style) or a play/pause glyph, plus sr-only "Timer running" (FR-003)
- [X] T034 [US3] Mount the pill: create `frontend/src/features/time/FloatingIndicators.tsx` (for now: recording pill then timer pill) and register it with `registerActivity` in place of the `recording-bar` registration in `frontend/src/features/recordings/routes.tsx`
- [X] T035 [US3] e2e `frontend/tests/e2e/time-indicator.spec.ts`: pill on every page, hidden when the card is visible, label returns to Time mode, keyboard-only operation — covered by `frontend/tests/e2e/time.spec.ts`

---

## Phase 6: User Story 4 - Pomodoro (P1)

**Goal**: Work/break cycle with settlement after sleep or closed app.

**Independent test**: quickstart scenario 5 with 1-minute phases.

- [X] T036 [P] [US4] Unit tests in `backend/tests/unit/test_time_state_machine.py` for every Pomodoro transition in data-model.md (work end → break, 4th work → long break, long break → Work 1, pause moves `planned_end_at`, skip/reset save work ≥ 5 s, breaks never saved, settlement idempotent)
- [X] T037 [P] [US4] Contract tests in `backend/tests/contract/test_time_timer.py` for `pause`, `resume` (409 `not_paused`), `advance` (409 `not_due`), `skip`, `reset`
- [X] T038 [P] [US4] Integration test `backend/tests/integration/test_time_settlement.py`: start 1-min work, move the clock past the end, `GET /time/timer` saves the entry ending at `planned_end_at`, returns `settled`, state `waiting`, and auto-start does not run (FR-025) — covered by `test_pomodoro_settles_while_closed` in `backend/tests/contract/test_time_timer.py`
- [X] T039 [US4] Implement settlement (research R3), `pause`/`resume` (research R7), `advance`, `skip`, `reset` in `backend/src/unihelper/services/time_service.py` using preference lengths at phase start; run settlement at the start of every timer read/write; endpoints in `backend/src/unihelper/api/v1/time.py`
- [X] T040 [US4] Pomodoro view in `frontend/src/features/time/TimerCard.tsx`: "Work 2 of 4" / "Short break" / "Long break", countdown, Start/Pause/Resume/Skip/Reset, "Work 2 finished at hh:mm" from `settled`
- [X] T041 [US4] Alerts plumbing: `frontend/src/features/time/alerts.worker.ts` (one `setTimeout` to `planned_end_at` converted with the offset, rescheduled on every timer change, then `postMessage`) and `frontend/src/features/time/alerts.ts` (unlock an `AudioContext` on the Start click, play a short tone if `sound`, sonner toast, then call `advance`); research R4
- [X] T042 [US4] Pomodoro and timer settings UI: new page `frontend/src/features/settings/time/TimeSettings.tsx` with work/short/long/periods (ranges enforced), automatic start, long-running hours or off; add route `{ path: "time" }` and nav entry in `frontend/src/features/settings/routes.tsx`

---

## Phase 7: User Story 6 - Tags (P1)

**Goal**: Create, pick, rename, recolor, delete tags.

**Independent test**: quickstart scenario 9.

- [X] T043 [P] [US6] Contract tests `backend/tests/contract/test_time_tags.py`: list with `entry_count`, create (409 `tag_name_taken` ignoring case; 422 empty, > 30 chars, unknown color), patch (rename collision 409), delete (entries untagged, running timer untagged)
- [X] T044 [US6] Implement tag service and endpoints in `backend/src/unihelper/services/time_service.py` and `backend/src/unihelper/api/v1/time.py`
- [X] T045 [P] [US6] Add 12 tag color tokens `--tag-1` … `--tag-12` for light and dark in `frontend/src/index.css` (AA contrast against card surface) and map `tag-N` → token in `frontend/src/features/time/tagColors.ts` — reuses the AA-checked class palette (`lib/palette.ts`) instead of new tokens
- [X] T046 [US6] Build `frontend/src/features/time/TagPicker.tsx` (Popover + `cmdk` Command: searchable list, "Create tag" with the typed name, color swatches with names) and use it in `TimerCard.tsx` and `EntryForm.tsx`; tags always rendered as name + color dot
- [X] T047 [US6] Build `frontend/src/features/time/TagManager.tsx` (opened from Time mode): rename, recolor, delete with an AlertDialog "N entries use this tag" (FR-039–FR-043)

---

## Phase 8: User Story 8 - Alerts (P1)

**Goal**: Sound + message + system notification on time, also in hidden windows.

**Independent test**: quickstart scenario 6.

- [X] T048 [US8] In `frontend/src/features/time/alerts.ts` show a `Notification` when the window is hidden or unfocused and `system_notifications` is on and permission is `granted`; clicking it focuses the window and opens Time mode
- [X] T049 [US8] Sound and system-notification switches in `frontend/src/features/settings/time/TimeSettings.tsx`, with an explanation shown before `Notification.requestPermission()` and a message when denied (FR-038)
- [X] T050 [US8] Allow the `notifications` permission for the app's own origin in both handlers of `desktop/src/permissions.ts` (keep `media` rules unchanged); add a case to `desktop/tests/e2e/permissions.spec.ts` (notifications granted for the app origin, still denied elsewhere) — desktop e2e updated but not run
- [ ] T051 [US8] e2e `frontend/tests/e2e/time-alerts.spec.ts`: 1-minute phase with the page hidden (`page.evaluate` visibility override + fake clock) fires the alert within 2 s of the planned end

---

## Phase 9: User Story 5 - Focus session (P2)

**Goal**: Countdown with goal, extend, finish early, optional focus layout.

**Independent test**: quickstart scenario 7.

- [X] T052 [P] [US5] Contract tests for Focus in `backend/tests/contract/test_time_timer.py`: start with `focus_minutes` 1–480 (422 outside), `extend` (+5 min, 422 above 480 total), finish early via `stop` saves time so far, `advance` at end saves and removes the timer; goal used as description when description is empty
- [X] T053 [US5] Implement Focus in `backend/src/unihelper/services/time_service.py` (`extend`, Focus branch of `advance` and settlement)
- [X] T054 [US5] Expose a focus-mode setter from `frontend/src/app/shell/layout.tsx` (e.g. `setFocusMode(on)` in the layout context) without changing its existing toggle behavior — no change needed: `toggleFocus` is used
- [X] T055 [US5] Focus view in `frontend/src/features/time/TimerCard.tsx`: presets 25/45/60/90 + custom 1–480, goal, "Hide panels while focusing" (default from `focus_hide_panels`), Pause/+5 min/Finish; on start remember the previous focus state and turn focus mode on; at the end restore it unless the user changed it during the session (FR-028)

---

## Phase 10: User Story 7 - Time entries on the calendar (P2)

**Goal**: Lane in day/week views, totals in month view, "Show time" switch.

**Independent test**: quickstart scenario 10.

- [X] T056 [P] [US7] Write `frontend/src/features/time/calendar/showTime.ts` copying `frontend/src/features/tasks/calendar/showTasks.ts` (key `uh.calendar.showTime`, default **true**) and add the "Show time" Switch to `frontend/src/features/calendar/CalendarToolbar.tsx`
- [X] T057 [P] [US7] Write `frontend/src/features/time/calendar/splitByDay.ts` (pure: split an entry into local-day parts with `@date-fns/tz`) with unit tests in `frontend/tests/unit/time-split-by-day.test.ts` (midnight crossing, DST days)
- [X] T058 [US7] Write `frontend/src/features/time/calendar/useCalendarEntries.ts` (entries for the visible range + the running timer as a growing block) and `frontend/src/features/time/calendar/TimeLane.tsx` (blocks as buttons with aria-label "desc, tag, 09:00–10:30", Tooltip on hover/focus, sub-lanes via `frontend/src/features/calendar/layoutOverlaps.ts`, 4 px minimum height, `onPointerDown` stops propagation to `useGridDrag`; activation opens the entry form in the Time panel, reopening it)
- [X] T059 [US7] In `frontend/src/features/calendar/TimeGrid.tsx` reserve a right lane (10 px, 14 px on `pointer: coarse`) per day column when Show time is on, lay existing items in the remaining width, and render `TimeLane`; nothing changes when off
- [X] T060 [US7] Month totals ("2 h 15 m") per day in `frontend/src/features/calendar/MonthView.tsx` when Show time is on
- [X] T061 [US7] Update `frontend/tests/unit/calendar-views.test.tsx` and add `frontend/tests/e2e/time-calendar.spec.ts` (lane never covers events, pressing the lane creates nothing, switch off hides only entries) — lane covered by `frontend/tests/e2e/time.spec.ts`

---

## Phase 11: User Story 9 - Recording and a timer together (P2)

**Goal**: Three indicator options; neither ever affects the other.

**Independent test**: quickstart scenario 8.

- [X] T062 [US9] Extend `frontend/src/features/time/FloatingIndicators.tsx` for `indicator_combo`: `combined` (one pill: recording part with its controls, then timer part), `stacked` (recording pill above timer pill), `recording_first` (recording pill + timer-time badge; timer pill returns when recording ends); export `RecordingPill` parts from `frontend/src/features/recordings/RecordingBar.tsx` as needed without changing its behavior
- [X] T063 [US9] "Indicator when recording and timer run together" RadioGroup in `frontend/src/features/settings/time/TimeSettings.tsx`
- [X] T064 [US9] e2e `frontend/tests/e2e/time-recording-indicator.spec.ts`: for each option, starting/pausing/stopping the timer never hides, pauses or stops the recording and vice versa (SC-007)

---

## Phase 12: User Story 10 - Reports (P2)

**Goal**: Period totals, grouping, table and donut.

**Independent test**: quickstart scenario 11.

- [X] T065 [P] [US10] Write `frontend/src/features/time/reports/report.ts` (pure): clip entries to the period, count duration = span − paused, group by tag ("No tag") / course ("No course") / day (via `splitByDay`), share %, entry count, and `chartSlices()` merging slices < 3 % into "Other"; unit tests `frontend/tests/unit/time-report.test.ts` (totals equal the sum to the second, SC-005)
- [X] T066 [P] [US10] Write `frontend/src/features/time/reports/DonutChart.tsx`: hand-written SVG arcs, tag color + one of 6 SVG pattern fills per slice, labels, legend list with times, `role="img"` + aria-label summary, slices focusable and activatable (research R11)
- [X] T067 [US10] Write `frontend/src/features/time/reports/ReportsView.tsx`: period ToggleGroup (Today/Week/Month/Custom with date range picker) + previous/next, group Select, Table/Chart toggle, table (Name, Time, Share, Entries) first at narrow widths, selected row/slice lists its entries, empty-period message; wire into `TimePanel.tsx`

---

## Phase 13: User Story 11 - Links (P2)

**Goal**: Start from task, session, event; course links; session totals.

**Independent test**: start timers from each source; check session total and by-course report.

- [X] T068 [P] [US11] Contract tests in `backend/tests/contract/test_time_entries.py` and `test_time_timer.py`: start with `task_id` / `session_key` fills `course_id` and `link_title`; 404 for unknown/other user's task or session; `GET /time/entries?session_key=`; deleting a task or course keeps entries with the link cleared
- [X] T069 [US11] Resolve links in `backend/src/unihelper/services/time_service.py` (task via `Task`, session/event via `session_folder_service.resolve`, course check) on start, patch and entry writes
- [X] T070 [P] [US11] "Start timer" action in `frontend/src/features/tasks/TaskMenu.tsx` (and on the card's actions in `frontend/src/features/tasks/board/TaskCard.tsx`); completing a task does not touch the timer
- [X] T071 [P] [US11] "Start timer" and "Time tracked: 1 h 20 min" in `frontend/src/features/sessions/SessionPanel.tsx` (session and event occurrences) — via `registerWorkspacePanel` instead of editing `SessionPanel.tsx`
- [X] T072 [US11] Course select in `frontend/src/features/time/EntryForm.tsx` (reuse `frontend/src/features/tasks/useCourseOptions.ts`); linked name shown in the timer card, pill and Today list

---

## Phase 14: User Story 12 - Extras (P3)

- [X] T073 [P] [US12] `GET /time/entries/export.csv?from&to&tz` in `backend/src/unihelper/api/v1/time.py` (columns date, start, end, duration, description, tag, link; local times in `tz`; 422 unknown tz) with a contract test in `backend/tests/contract/test_time_entries.py`; "Export CSV" in `ReportsView.tsx`
- [X] T074 [P] [US12] Daily goal (`daily_goal_min`) setting in `TimeSettings.tsx` and progress bar in `TodayList.tsx`
- [X] T075 [P] [US12] Weekly totals view (each day's total for the week) in `frontend/src/features/time/reports/WeekTotals.tsx`, reachable from Reports — Reports "By day" + "Week" is the weekly totals view; no separate component
- [X] T076 [P] [US12] "N Pomodoros today" (count of today's `source = pomodoro` entries) in the Pomodoro view of `TimerCard.tsx`
- [X] T077 [US12] Register an editable "Start/stop timer" command in `frontend/src/lib/shortcuts.ts` (unassigned conflict-free default) that starts a Track timer or stops the running one from any page

---

## Phase 15: Polish & Cross-Cutting

- [X] T078 [P] axe checks for Time mode, pill, calendar lane and reports in light, dark and a custom theme in `frontend/tests/e2e/a11y-themes.spec.ts` (SC-006) — axe in `frontend/tests/e2e/time.spec.ts` (light, dark); custom theme not covered
- [X] T079 [P] e2e `frontend/tests/e2e/time-track.spec.ts` for quickstart 1–4 (two pages for cross-window; backend stopped for offline stop) — `frontend/tests/e2e/time.spec.ts`
- [X] T080 [P] Backup round-trip with tags, entries and a running timer in `backend/tests/integration/test_backup_roundtrip.py`
- [ ] T081 Run the full backend test suite, `pnpm lint`, `pnpm typecheck`, `pnpm vitest run` and the existing e2e suites for the home panels and task manager to confirm unchanged behavior (FR-063, SC-008)
- [ ] T082 Walk through `specs/020-study-time-tracking/quickstart.md` in the desktop app, including the minimised-window alert (scenario 6)

---

## Dependencies & Execution Order

- Setup (T001–T002) → Foundational (T003–T014) → stories.
- US1 (Phase 3) first: every other story uses the timer service and `TimerCard`.
- US2, US3, US4, US6 depend only on US1 and can proceed in parallel after it.
- US8 depends on US4's alerts plumbing (T041).
- US5 depends on US4 (shares advance/settlement) ; US7 on US2 (entries) ; US9 on US3 (pill);
  US10 on US2 and US6 ; US11 on US1 and US10 for the by-course report ; US12 on US10.
- Polish last.

```text
Setup → Foundational → US1 ─┬─ US2 ── US7
                            ├─ US3 ── US9
                            ├─ US4 ─┬ US8
                            │       └ US5
                            └─ US6 ── US10 ── US11 ── US12 → Polish
```

## Parallel Examples

- Foundational: T005, T006, T007, T008, T009, T012 together after T003.
- US1: T015, T016, T017 (tests) together; T020 alongside T018–T019.
- After US1: one person on US2 (T025–T028), one on US3 (T029–T035), one on US4 (T036–T042).
- US10: T065 and T066 together, then T067.

## Implementation Strategy

1. **MVP** = Setup + Foundational + US1: a Track timer in the home panel that survives restarts
   and never loses time. Validate with quickstart 1–4 and stop to demo.
2. Add the rest of P1 (US2 entries, US3 pill, US4 Pomodoro, US6 tags, US8 alerts) → release.
3. Add P2 (US5, US7, US9, US10, US11) → release.
4. Add P3 (US12) and Polish.
