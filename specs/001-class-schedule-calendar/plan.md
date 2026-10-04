# Implementation Plan: Class Schedule Calendar

**Branch**: `001-class-schedule-calendar` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-class-schedule-calendar/spec.md`

## Summary

Deliver accounts (owner-first), the year → semester → course hierarchy, recurring classes with
Google-style edit scopes, and a calendar (day/week/month) inside an app shell with a searchable
course panel on the left. A Python/FastAPI backend exposes `/api/v1` over SQLite metadata and owns
the human-readable storage folders; a React + shadcn/ui SPA consumes it. This plan also fixes the
project-wide architecture (API conventions, auth, storage layout and naming, session identity,
theme tokens, shell extension points, test strategy) that features 002–005 build on, without
building notes, audio, transcription, or themes.

Key design choices (details in [research.md](./research.md)):
- Classes are stored as **series** with a weekly rule; sessions are **expanded on read**;
  single-session changes are **exceptions**; "this and following" **splits** the series under a
  shared **lineage id**. Session key `{lineageId}:{date}` stays stable for attaching notes and
  recordings later.
- Year/semester/course rows store a sanitised **`folder_name`**; dated session folders are named
  and recorded on first content save (002/003).
- Light/dark via **CSS-variable semantic tokens** so 005 can add user themes without refactoring.

## Glossary

- **Course** = **syllabus**: the same entity. The constitution and folder hierarchy say
  "syllabus"; the UI, API (`/courses`), and code say "course".
- **Class**: a scheduled entry for a course, stored as one or more series segments sharing a
  `lineageId`. **Session**: one dated occurrence of a class, identified by `{lineageId}:{date}`.

## Technical Context

**Language/Version**: Python 3.12+ (backend; dev machine has 3.14), TypeScript 5.x on Node 22 LTS
(frontend build only)

**Primary Dependencies**: Backend — FastAPI, Pydantic v2, Uvicorn, SQLAlchemy 2.0, Alembic,
python-dateutil (rrule), argon2-cffi, uuid-utils (UUIDv7). Frontend — React 19, Vite, Tailwind CSS
v4, shadcn/ui (Radix primitives), React Router v7, TanStack Query, date-fns v4 + @date-fns/tz,
@phosphor-icons/react, motion, openapi-typescript.

**Storage**: SQLite (WAL) for metadata at `data/unihelper.sqlite3`; file system at
`data/files/<username>/<Year>/<Semester>/<Course>/<class_date>/{notes,audios}` (001 creates down to
`<Course>`).

**Testing**: pytest + FastAPI TestClient (unit, contract, integration); Vitest + Testing Library +
vitest-axe; Playwright + @axe-core/playwright (keyboard-only E2E, light and dark); Ruff, mypy,
ESLint, `tsc --noEmit`.

**Target Platform**: Self-hosted single process on Linux/WSL/macOS/Windows; modern evergreen
desktop browsers (Chrome, Edge, Firefox, Safari — last 2 versions); narrow screens supported with
drawer layout.

**Project Type**: Web application (Python API backend + React SPA frontend, served together in
production).

**Performance Goals**: View switch / period navigation renders in < 1 s with a full semester
(SC-003; sessions endpoint < 150 ms for a 6-week range at 6 courses × 3 sessions/week); course
search filters in < 0.5 s at 200 courses (SC-005, done client-side on the cached course tree).

**Constraints**: SQLite only, no extra infrastructure (Constitution VII); frontend reaches data only
via `/api/v1` (III); WCAG AA, keyboard operable, light + dark (V); no partial saves (FR-026);
deletes never remove files (FR-019); wall-clock times correct across DST.

**Scale/Scope**: 1–10 accounts per installation; per user ≤ 20 years, ≤ 200 courses, ≤ 500
class series; ~12 screens/dialogs in 001 (setup, login, change password, calendar ×3 views, class
form, session details, scope chooser, course panel, course placeholder, admin accounts).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 001 | Status (pre) | Status (post-design) |
|---|---|---|---|
| I. User work never lost | Atomic creates/edits (single transaction incl. inline hierarchy); form keeps input on failure (FR-026); destructive actions confirmed with impact preview; deleting classes/courses/semesters/years/accounts never deletes files; optimistic concurrency prevents silent overwrites | PASS | PASS — `POST /classes` atomic, `deletion-impact` endpoints, `If-Match`/`version` on all mutations, StorageService never deletes |
| II. Data ownership & open formats | Human-readable hierarchy created on disk; names readable; DB not sole store of content | PASS | PASS — `storage-layout.md`; per-user top folder added above `<Year>` to separate accounts (still browsable, see note) |
| III. Strict separation | Frontend uses only versioned REST JSON; no DB/FS access from UI | PASS | PASS — all access via `/api/v1` (openapi.yaml); generated TS types; only backend `StorageService` touches disk |
| IV. Pluggable transcription & secrets | Not in scope; must not block it | N/A | N/A — R15 reserves in-process job worker; 005 tables reserved; no secrets in 001 |
| V. UI quality & accessibility | shadcn/ui primitives; taste-skill decisions; light/dark (+ user themes later) via tokens; keyboard; AA | PASS | PASS — R9–R11, `ui-shell.md` keyboard/a11y contract, token-based theming, preset colours verified for AA |
| VI. Testing | Tests for every endpoint; integration test for recurring class creation | PASS | PASS — contract tests per path in openapi.yaml; `test_recurring_class_creation.py` (quickstart) |
| VII. Simplicity & spec discipline | SQLite only; nothing outside spec 001 | PASS | PASS — no queue/cache/server besides one Uvicorn process; notes/audio/themes not built. Extra: profile time-zone endpoint and account disable — both needed by spec (DST edge case; owner manages accounts) |

**Note on Principle II**: the constitution's hierarchy starts at `<year>`. With the owner-first
multi-account model, each account's tree lives under `files/<username>/`, so the hierarchy below it
is exactly year → semester → syllabus → class date. This is an additive prefix, not a deviation;
no Complexity Tracking entry needed.

**Result**: All gates pass; no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-class-schedule-calendar/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R15
├── data-model.md        # Phase 1: schema, recurrence, edit scopes
├── quickstart.md        # Phase 1: run + validation scenarios
├── contracts/
│   ├── openapi.yaml     # /api/v1 contract for 001
│   ├── storage-layout.md# on-disk layout & naming (shared with 002/003)
│   └── ui-shell.md      # shell, routes, extension points, keyboard/a11y
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml                     # uv-managed; ruff, mypy, pytest config
├── alembic.ini
├── src/unihelper/
│   ├── main.py                        # app factory: routers, middleware, static SPA serving
│   ├── config.py                      # env settings (data dir, cookies, static dir)
│   ├── db/
│   │   ├── engine.py                  # SQLite engine (WAL, FK, busy_timeout), session scope
│   │   └── migrations/                # Alembic versions (001: users…session_exceptions)
│   ├── models/                        # SQLAlchemy models: user, auth_session, year, semester,
│   │                                  #   course, class_series, class_link, session_exception
│   ├── schemas/                       # Pydantic request/response models (camelCase aliases)
│   ├── domain/
│   │   ├── recurrence.py              # rule validation + expansion (rrule, zoneinfo, exceptions)
│   │   ├── scopes.py                  # this / following / all edit & delete logic
│   │   └── naming.py                  # safe_name, collision suffixes, class_date naming rule
│   ├── services/
│   │   ├── auth_service.py            # setup, login, sessions, throttling, password changes
│   │   ├── account_service.py         # owner-only account management
│   │   ├── hierarchy_service.py       # years/semesters/courses + deletion impact
│   │   ├── class_service.py           # create (inline hierarchy), read, scopes
│   │   └── session_query.py           # range expansion for calendar / course timeline
│   ├── storage/
│   │   └── storage_service.py         # ONLY module touching the file system (mkdir, rename, paths)
│   └── api/
│       ├── deps.py                    # current user, owner guard, CSRF check, If-Match parsing
│       ├── errors.py                  # RFC 9457 problem responses
│       └── v1/                        # routers: setup, auth, admin, hierarchy, classes, sessions, health
└── tests/
    ├── unit/                          # recurrence (DST, interval, count, semester end), scopes, naming
    ├── contract/                      # one module per router; schema checks vs OpenAPI
    └── integration/                   # recurring class creation flow; atomicity; folders

frontend/
├── package.json · vite.config.ts · components.json (shadcn, iconLibrary: phosphor)
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── router.tsx                 # composes feature route modules under AppShell + guards
│   │   ├── providers.tsx              # QueryClient, ThemeProvider, Tooltip/Toast providers
│   │   └── shell/                     # AppShell, TopBar, CoursePanel slot, ActivityBar slot
│   ├── components/ui/                 # shadcn/ui primitives (owned, themed via tokens)
│   ├── features/
│   │   ├── auth/                      # setup, login, change password, guards
│   │   ├── admin/                     # owner account management
│   │   ├── courses/                   # CoursePanel (tree + search), course placeholder page
│   │   ├── calendar/                  # Day/Week/Month views, grid, overlap layout, keyboard nav
│   │   └── classes/                   # class form (inline hierarchy, recurrence), details, scope dialog
│   ├── lib/
│   │   ├── api/                       # generated types (openapi-typescript), apiFetch, ApiError
│   │   ├── dates.ts                   # date-fns helpers, user time zone
│   │   └── palette.ts                 # 12 colour presets (light/dark pairs)
│   └── styles/
│       ├── fonts.css                  # self-hosted @font-face
│       └── tokens.css                 # semantic CSS variables for light/dark
└── tests/
    ├── unit/                          # Vitest component tests + axe
    └── e2e/                           # Playwright keyboard-only flows, light/dark, axe AA
```

**Structure Decision**: Web application with `backend/` (FastAPI, owns DB and files) and
`frontend/` (React SPA). In production the backend serves `frontend/dist`, so the app runs as one
process. Later features add modules in the same places: backend `services/`, `api/v1/`,
`storage/`, a `transcription/` provider package (004); frontend `features/<name>/` with route
modules and shell slot registrations.

## Phase 0 — Research

Complete: [research.md](./research.md). No `NEEDS CLARIFICATION` remain. Decisions cover the
backend framework, persistence and migrations, auth, recurrence and session identity, time
zones/DST, storage naming, filesystem consistency, frontend stack, calendar build, design direction,
shell extension points, API conventions, testing, packaging, and the future background-job pattern.

## Phase 1 — Design & Contracts

Complete:
- [data-model.md](./data-model.md): tables, validation, recurrence expansion, edit-scope state
  transitions, reserved tables for 002–005.
- [contracts/openapi.yaml](./contracts/openapi.yaml): 26 paths under `/api/v1`.
- [contracts/storage-layout.md](./contracts/storage-layout.md): folder hierarchy, `safe_name`,
  `class_date` naming, lifecycle rules.
- [contracts/ui-shell.md](./contracts/ui-shell.md): layout, routes, extension points, keyboard and
  accessibility contract.
- [quickstart.md](./quickstart.md): setup, run, automated checks, 14 manual validation scenarios.

Post-design Constitution Check: all gates PASS (table above).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Recurrence edge cases (splits + exceptions + semester-end changes) | Pure `domain/recurrence.py` + `scopes.py` with exhaustive unit tests (incl. property-style tests comparing expansion before/after edits) |
| DB/folder drift on rename failures | StorageService rename-then-commit with compensating rename; integration tests simulate failures |
| Custom calendar a11y/overlap bugs | Overlap layout as a pure tested function; Playwright keyboard flows + axe in both themes |
| Windows path quirks (user on WSL/Windows) | `safe_name` reserved-name and case-insensitive collision rules; tests run against a case-insensitive temp dir where available |
| Owner locked out (forgotten password) | Documented operator CLI `uv run unihelper reset-owner-password` (local shell only, no API) |

## Complexity Tracking

> No Constitution Check violations — nothing to justify.
