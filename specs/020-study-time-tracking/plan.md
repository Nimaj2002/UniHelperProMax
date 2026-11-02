# Implementation Plan: Study Time Tracking (Time mode)

**Branch**: `020-study-time-tracking` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-study-time-tracking/spec.md`

## Summary

Add a Time mode to the home page's right panel (a third item of the existing Tasks / General
notes switch), a single server-held running timer per user (Track, Pomodoro, Focus), time
entries and tags stored in SQLite, a floating timer pill beside the recording pill, a thin time
lane in the calendar's day and week views, and client-side reports (table + hand-drawn SVG
donut). The server is the only source of truth for the timer: it stores start, pause and planned
end, settles Pomodoro and Focus phases that ended while no window was open (on the next
read), and every window computes time from those stored values plus a server clock offset. A
Web Worker schedules end-of-phase alerts so they fire on time in hidden windows. No new
dependencies.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5 / React 19 (frontend), Electron (desktop)

**Primary Dependencies**: FastAPI, SQLAlchemy 2, Alembic, Pydantic v2; React Router 8, TanStack
Query 5, shadcn/ui on Radix, date-fns 4 + @date-fns/tz, sonner (toasts), Phosphor icons. All
already installed; nothing is added.

**Storage**: SQLite. New tables `time_tags`, `time_entries`, `time_timers` (one row per user).
Time settings go into the existing per-user `ui_preferences` JSON under a `time` key.
Per-browser choices (panel section, calendar "Show time") use `lib/storage` (localStorage).

**Testing**: pytest (contract tests under `backend/tests/contract`, integration under
`backend/tests/integration`, unit under `backend/tests/unit`); Vitest + Testing Library for
frontend units; Playwright (+ axe) for e2e.

**Target Platform**: Desktop app (Electron, local server) and browser (same SPA, local or
docker server).

**Project Type**: Web application (backend + frontend) packaged as a desktop app.

**Performance Goals**: Indicator repaints once per second; timer reads ≤ 1 request per window
per 30 s while visible plus on focus; calendar week view with 200 entries renders without visible
delay; report for a month of entries (≈ 500) computed client-side in < 50 ms.

**Constraints**: Elapsed time error ≤ 1 s after sleep, restart or second window (SC-002); alerts
within 2 s of planned end in hidden windows (SC-004); works at 320 px; no background server jobs
(Principle VII); no time lost on failed requests (Principle I spirit, FR-012/FR-062).

**Scale/Scope**: One user per account, a few windows; ~10 entries a day, ~4 000 a year.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. User Work Is Never Lost | ✅ | Server holds the timer; the client keeps an outbox of failed start/stop/save calls (with the times the user acted) and retries (R5). Entry delete is soft with Undo; tag delete asks first. Pomodoro/Focus phases that end while closed are saved at the planned end (R3). |
| II. Data Ownership & Open Formats | ✅ | Time entries are metadata, not notes/audio/documents/annotations/chats, so the DB may hold them. CSV export (P3) gives an open copy; tables are added to backups (R9). |
| III. Frontend/Backend Separation | ✅ | New endpoints under `/api/v1/time/...`, documented in [contracts/time-api.md](./contracts/time-api.md). |
| IV. Providers & Secrets | n/a | No provider or secret involved. |
| V. UI Quality & Accessibility | ✅ | shadcn primitives (ToggleGroup, Popover, Command, Dialog, Table); tag palette from theme tokens; patterns + labels on donut slices; keyboard and reduced motion covered in contracts/ui.md. |
| VI. Test Coverage | ✅ | Contract tests for every endpoint; integration tests for timer survives restart, phase settlement, replace + undo, backup round-trip with time tables. |
| VII. Simplicity & Spec Discipline | ✅ | No new dependency (SVG donut by hand, Web Worker and Notification are platform features); no background job (lazy settlement); spec amended for the General notes conflict before planning. |
| VIII. Desktop Data Safety | ✅ | Migration `0017_time_tracking` runs after the existing pre-migration DB backup. Desktop permission handler allows `notifications` only for the app's own origin. |

Post-design re-check (after Phase 1): unchanged, all ✅. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/020-study-time-tracking/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: tables, fields, rules, timer state machine
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── time-api.md      # REST endpoints
│   └── ui.md            # UI contract: panel, indicator, calendar lane, reports
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/src/unihelper/
├── models/time_tracking.py          # TimeTag, TimeEntry, TimeTimer
├── schemas/time_tracking.py         # request/response models
├── services/time_service.py         # timer state machine, settlement, entries, tags
├── api/v1/time.py                   # /time/timer, /time/entries, /time/tags
├── schemas/notes.py                 # Preferences gains `time` settings (existing file)
├── services/workspace_service.py    # DEFAULT_PREFERENCES["time"] (existing file)
├── backup/tables.py                 # add the three tables to INCLUDED (existing file)
└── db/migrations/versions/0017_time_tracking.py

backend/tests/
├── contract/test_time_timer.py, test_time_entries.py, test_time_tags.py
├── integration/test_time_survives_restart.py, test_time_settlement.py, test_migration_0017.py
└── unit/test_time_state_machine.py

frontend/src/features/time/
├── api.ts                 # queries, mutations, outbox retry, server clock offset
├── clock.ts               # elapsed/remaining from stored times (pure)
├── alerts.worker.ts       # one-shot timeout at planned end → postMessage
├── alerts.ts              # sound, toast, system notification
├── sync.ts                # BroadcastChannel + focus/visibility refetch
├── TimePanel.tsx          # Time mode body (timer card, Today/Reports switch)
├── TimerCard.tsx          # Track / Pomodoro / Focus
├── TodayList.tsx, EntryForm.tsx, TagPicker.tsx, TagManager.tsx
├── reports/report.ts      # grouping, day splitting, "Other" merge (pure)
├── reports/ReportsView.tsx, DonutChart.tsx
├── TimerPill.tsx          # floating indicator
├── FloatingIndicators.tsx # recording + timer combination (3 options)
└── calendar/TimeLane.tsx, showTime.ts, useCalendarEntries.ts

frontend/src/ (existing files touched)
├── features/home/tasksColumn.ts, TasksPanel.tsx, PanelRail.tsx  # third section "time"
├── features/recordings/routes.tsx (RecordingBar mount → FloatingIndicators)
├── features/calendar/TimeGrid.tsx, MonthView.tsx, CalendarToolbar.tsx
├── features/settings/…              # Time settings section
├── features/tasks/…, features/sessions/…  # "Start timer" (P2), session total (P2)
├── app/shell/layout.tsx             # expose focus-mode setter for "Hide panels while focusing"
└── lib/shortcuts.ts                 # start/stop command (P3)

desktop/src/permissions.ts           # allow `notifications` for the app origin
```

**Structure Decision**: Existing web-application layout (`backend/` + `frontend/` + `desktop/`).
A new `features/time` folder mirrors `features/tasks`; existing files change only where the
spec reaches them.

## Complexity Tracking

None.
