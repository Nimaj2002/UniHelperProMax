---

description: "Task list for feature 001 — Class Schedule Calendar"
---

# Tasks: Class Schedule Calendar

**Input**: Design documents from `/specs/001-class-schedule-calendar/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (openapi.yaml,
storage-layout.md, ui-shell.md), quickstart.md

**Tests**: INCLUDED. Constitution Principle VI requires tests for every API endpoint and an
integration test for recurring class creation; spec FR-027/SC-006 require keyboard and contrast
verification. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested
independently. Story phases follow priority, with P1 stories ordered by dependency: US1 → US2 →
US5 → US3 → US4.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story from spec.md (US1–US5)

## Path Conventions

- Backend package: `backend/src/unihelper/`; backend tests: `backend/tests/`
- Frontend: `frontend/src/`; frontend tests: `frontend/tests/`
- API base path `/api/v1`; JSON camelCase; errors RFC 9457 (see contracts/openapi.yaml)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create both projects with their toolchains (research R1, R2, R8, R13, R14)

- [ ] T001 Create repository layout `backend/`, `frontend/`, root `.gitignore` (ignore `data/`, `data-*/`, `.venv/`, `node_modules/`, `dist/`, `frontend/openapi.json`, `.pytest_cache/`, `playwright-report/`) and root `README.md` linking to `specs/001-class-schedule-calendar/quickstart.md`
- [ ] T002 Initialise the backend with uv in `backend/pyproject.toml`: package `unihelper` under `src/` layout, Python `>=3.12`; runtime deps `fastapi`, `pydantic>=2`, `uvicorn[standard]`, `sqlalchemy>=2.0`, `alembic`, `python-dateutil`, `argon2-cffi`, `uuid-utils`; dev deps `pytest`, `httpx`, `ruff`, `mypy`, `types-python-dateutil`, `pyyaml`, `jsonschema`; configure `[tool.ruff]` (line length 100, rules E,F,I,B,UP), `[tool.mypy]` (strict for `src`), `[tool.pytest.ini_options]` (testpaths `tests`, markers `unit`, `contract`, `integration`); create empty packages `backend/src/unihelper/{api/v1,db,models,schemas,domain,services,storage}/__init__.py` and `backend/tests/{unit,contract,integration}/__init__.py`
- [ ] T003 [P] Scaffold the frontend in `frontend/` with pnpm + Vite React TypeScript template; add Tailwind CSS v4 via `@tailwindcss/vite`; set path alias `@` → `src` in `frontend/vite.config.ts` and `frontend/tsconfig.json`; configure the Vite dev server proxy `/api` → `http://localhost:8000` in `frontend/vite.config.ts`
- [ ] T004 Install frontend dependencies in `frontend/package.json`: `react-router`, `@tanstack/react-query`, `date-fns@4`, `@date-fns/tz`, `@phosphor-icons/react`, `motion`; dev: `openapi-typescript`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `vitest-axe`, `@playwright/test`, `@axe-core/playwright`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`; add scripts `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test` (vitest run), `e2e` (playwright test), `gen:api` (`openapi-typescript ./openapi.json -o src/lib/api/schema.d.ts`)
- [ ] T005 Initialise shadcn/ui in `frontend/components.json` with `iconLibrary: "phosphor"` (taste-skill §3.C, one icon family) and CSS variables enabled; add primitives into `frontend/src/components/ui/`: button, input, label, textarea, dialog, alert-dialog, popover, sheet, toggle-group, scroll-area, tooltip, dropdown-menu, select, checkbox, command, calendar, separator, badge, sonner; replace any lucide imports in generated files with `@phosphor-icons/react` equivalents
- [ ] T006 [P] Configure frontend tooling: `frontend/eslint.config.js` (typescript-eslint, react-hooks, jsx-a11y recommended), `frontend/vitest.config.ts` (jsdom, setup file `frontend/tests/setup.ts` registering `vitest-axe` matchers), `frontend/playwright.config.ts` (projects `chromium-light` and `chromium-dark` via `colorScheme`, `webServer` starting backend + `pnpm dev`, baseURL `http://localhost:5173`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config, database, error model, auth sessions (owner setup + sign-in), storage
service, naming, theme tokens, API client, and app shell. Every story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Backend foundation

- [ ] T007 Implement settings in `backend/src/unihelper/config.py`: env vars `UNIHELPER_DATA_DIR` (default `./data`), `UNIHELPER_STATIC_DIR` (optional, built SPA), `UNIHELPER_SECURE_COOKIES` (bool, default false), `UNIHELPER_HOST`/`UNIHELPER_PORT`; derived paths `db_path = <data>/unihelper.sqlite3` and `files_root = <data>/files`; a `get_settings()` dependency overridable in tests
- [ ] T008 Implement the database layer in `backend/src/unihelper/db/engine.py`: SQLAlchemy 2.0 sync engine for SQLite with a connect listener setting `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`; `SessionLocal` factory; `get_db()` FastAPI dependency (commit on success, rollback on exception)
- [ ] T009 [P] Create the declarative base and mixins in `backend/src/unihelper/models/base.py`: `id` text PK defaulting to UUIDv7 string (`uuid_utils.uuid7`), `created_at`/`updated_at` UTC ISO 8601 text, `VersionMixin` with integer `version` starting at 1 and incremented on every update; helper `name_key(name) = casefold(nfc(trim(name)))`
- [ ] T010 [P] Create the `User` model in `backend/src/unihelper/models/user.py` per data-model.md: `username` "3–32 chars `[a-z0-9._-]`, stored lowercase, UNIQUE"; `password_hash` (Argon2id); `role` "`owner` \| `member`; partial UNIQUE index ensures exactly one `owner`"; `must_change_password` bool; `timezone` IANA text; `disabled_at` nullable; timestamps
- [ ] T011 [P] Create the `AuthSession` model in `backend/src/unihelper/models/auth_session.py`: `id` = "SHA-256 of the cookie token (raw token never stored)", `user_id` FK→users ON DELETE CASCADE, `csrf_token`, `created_at`, `last_seen_at`, `expires_at` ("sliding expiry 30 days, absolute max 90 days")
- [ ] T012 Initialise Alembic in `backend/alembic.ini` and `backend/src/unihelper/db/migrations/` (env.py reads `config.db_path`, `render_as_batch=True` for SQLite) and add revision `0001_users_auth_sessions` creating `users` (incl. partial unique index `WHERE role='owner'`) and `auth_sessions`
- [ ] T013 [P] Implement RFC 9457 errors in `backend/src/unihelper/api/errors.py`: `ApiError(status, code, title, detail=None, errors=None)` rendered as `application/problem+json` with fields `type`, `title`, `status`, `code`, `detail`, `errors[{field (JSON pointer), code, message}]`; exception handlers mapping `RequestValidationError` → 422 `validation_failed` with camelCase JSON-pointer fields, `NoResultFound` → 404 `not_found`, and unexpected errors → 500 without leaking internals
- [ ] T014 [P] Implement `safe_name` and collision helpers in `backend/src/unihelper/domain/naming.py` exactly per contracts/storage-layout.md: NFC; collapse whitespace; replace `/ \ : * ? " < > |` and control characters (U+0000–U+001F, U+007F) with `-`; trim leading/trailing spaces and dots; append `_` to Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, case-insensitive, ignoring extension); truncate to 80 characters and re-trim; empty → `Untitled`; `unique_sibling(name, existing)` appends ` (2)`, ` (3)`… case-insensitively before any extension; also `class_date_folder_name(date, start_time, existing)` returning `YYYY-MM-DD`, else `YYYY-MM-DD HHmm`, else suffixed (used by 002)
- [ ] T015 [P] Unit tests for naming in `backend/tests/unit/test_naming.py`: the three examples from storage-layout.md (`"CS 201: Intro"` → `CS 201- Intro`, `"Fall/Spring"` → `Fall-Spring`, `"con"` → `con_`), trailing dots/spaces, control chars, 80-char truncation, empty → `Untitled`, case-insensitive collision suffixes, class_date naming fallbacks
- [ ] T016 Implement `StorageService` in `backend/src/unihelper/storage/storage_service.py` (the ONLY module that touches the file system): `user_root(username)` = `files_root/<username>`; `ensure_dir(rel_parts)` (`mkdir(parents=True, exist_ok=True)`); `rename_dir(old_rel, new_rel)` using `os.replace` returning an undo callable; `relative_path(...)` for API responses; path traversal guard (resolved path must stay under `files_root`); no delete methods
- [ ] T017 [P] Unit tests for StorageService in `backend/tests/unit/test_storage_service.py`: creates nested dirs idempotently, rename + undo restores, traversal attempts (`..`, absolute paths) rejected, no method deletes anything
- [ ] T018 Implement core auth in `backend/src/unihelper/services/auth_service.py`: `needs_owner()`; `create_owner(username, password, timezone)` only when no users exist (else `ApiError 409 owner_exists`); password validation "password ≥ 10 characters, not equal to username" (422 `weak_password`); Argon2id hashing via `argon2-cffi`; `login(username, password)` returning a new session token + CSRF token, generic 401 `invalid_credentials` for unknown, wrong-password, and disabled users; `logout(token)`; `resolve_session(token)` with sliding 30-day / absolute 90-day expiry; create the user's storage root via StorageService on account creation
- [ ] T019 Implement request dependencies in `backend/src/unihelper/api/deps.py`: `current_user` (reads `uh_session` cookie → `resolve_session`, 401 `unauthorized` if missing/expired), `require_owner` (403 `forbidden`), `csrf_protect` for POST/PATCH/PUT/DELETE comparing header `X-CSRF-Token` with cookie `uh_csrf` (403 `csrf_failed`; exempt `/setup/owner` and `/auth/login`), `if_match_version` parsing `If-Match: "<n>"` (428 `if_match_required` when missing); cookie helpers setting `uh_session` (HttpOnly, SameSite=Lax, Secure when `UNIHELPER_SECURE_COOKIES`) and `uh_csrf` (readable, SameSite=Lax)
- [ ] T020 [P] Create auth/setup schemas in `backend/src/unihelper/schemas/auth.py` with camelCase aliases: `NewAccount` (`username` pattern `^[a-z0-9._-]{3,32}$`, `password` minLength 10, optional `timezone`), `LoginRequest`, `Me` (`id`, `username`, `role`, `mustChangePassword`, `timezone`), `SetupStatus` (`needsOwner`)
- [ ] T021 Implement routers `backend/src/unihelper/api/v1/health.py` (`GET /health` → `{"status":"ok"}`), `backend/src/unihelper/api/v1/setup.py` (`GET /setup/status`, `POST /setup/owner` → 201 `Me` + sets cookies), and `backend/src/unihelper/api/v1/auth.py` (`POST /auth/login` → 200 `Me` + cookies, `POST /auth/logout` → 204 clears cookies, `GET /auth/me`) per contracts/openapi.yaml
- [ ] T022 Implement the app factory in `backend/src/unihelper/main.py`: create FastAPI app with OpenAPI at `/api/v1/openapi.json`, mount all `api/v1` routers under `/api/v1`, register error handlers, run Alembic `upgrade head` on startup if the DB is missing, and when `UNIHELPER_STATIC_DIR` is set serve the SPA with fallback to `index.html` for non-`/api` paths; add `backend/src/unihelper/export_openapi.py` that writes the OpenAPI JSON to a given path (used by `frontend` `gen:api`)
- [ ] T023 Create test fixtures in `backend/tests/conftest.py`: `tmp_data_dir` (temp dir as `UNIHELPER_DATA_DIR`), `app` and `client` (FastAPI `TestClient` with migrated temp SQLite), `owner_client` (owner created + signed in, CSRF header auto-attached), `make_member(username)` helper (inserts a `users` row directly through the models with an Argon2id hash and signs it in — it MUST NOT depend on `account_service`, which is built later in US5), and `assert_problem(response, status, code)`; plus `backend/tests/contract/openapi_check.py` validating JSON responses against schemas in `specs/001-class-schedule-calendar/contracts/openapi.yaml` using `jsonschema`
- [ ] T024 [P] Contract tests in `backend/tests/contract/test_health_setup_auth.py`: `GET /health` 200; `GET /setup/status` true then false; `POST /setup/owner` 201 then 409 `owner_exists`, 422 for short password or invalid username; `POST /auth/login` 200 sets `uh_session` (HttpOnly) and `uh_csrf`, 401 `invalid_credentials` with identical body for unknown user vs wrong password; `GET /auth/me` 200 / 401; `POST /auth/logout` 204 then `/auth/me` 401; mutating request without `X-CSRF-Token` → 403 `csrf_failed`

### Frontend foundation

- [ ] T025 [P] Define semantic theme tokens in `frontend/src/styles/tokens.css` (research R10): `--surface`, `--surface-elevated`, `--surface-sunken`, `--text-primary`, `--text-muted`, `--border`, `--grid-line`, `--accent`, `--accent-foreground`, `--focus-ring`, `--danger`, `--success`, `--warning`, `--now-line`, and class-colour tokens `--event-<key>-bg`, `--event-<key>-fg`, `--event-<key>-border` for each of the 12 keys `slate, red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink` for `[data-theme="light"]` and `[data-theme="dark"]`, no pure `#000`/`#fff`; map shadcn variables (`--background`, `--foreground`, `--primary`, …) to these tokens; self-hosted fonts in `frontend/src/styles/fonts.css` with `@font-face` + `font-display: swap`; import both in `frontend/src/index.css`
- [ ] T026 [P] Token contrast unit test in `frontend/tests/unit/tokens.contrast.test.ts`: parse `tokens.css` and assert WCAG AA (≥ 4.5:1 text, ≥ 3:1 for `--focus-ring`/`--border` against `--surface`) for every text/background pair in both themes, including every `--event-<key>-fg` on `--event-<key>-bg` (FR-021)
- [ ] T027 [P] Enforce token-only colours (Constitution V) with `frontend/tests/unit/no-hardcoded-colors.test.ts`: scan every `.ts`, `.tsx` and `.css` file under `frontend/src/` except `frontend/src/styles/tokens.css` and fail on hex colours (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb(`/`rgba(`/`hsl(`/`hsla(`/`oklch(` literals, named CSS colours used as values, and Tailwind palette colour utilities (e.g. `bg-blue-500`, `text-zinc-900`); allow `var(--…)`, `transparent`, `currentColor`, and `inherit`; generated shadcn files must be converted to token classes to pass
- [ ] T028 [P] Implement `ThemeProvider` in `frontend/src/app/theme.tsx`: sets `document.documentElement.dataset.theme` to `light`/`dark` from `prefers-color-scheme` and updates on change (005 will add user themes through the same attribute/token values)
- [ ] T029 Implement the API client in `frontend/src/lib/api/client.ts`: `apiFetch<T>(path, init)` prefixing `/api/v1`, `credentials: "same-origin"`, adding `X-CSRF-Token` from the `uh_csrf` cookie on mutating methods, adding `If-Match` when a `version` option is given, parsing `application/problem+json` into `ApiError { status, code, title, detail, errors }`; export typed helpers using generated types from `frontend/src/lib/api/schema.d.ts` (generate via `uv run python -m unihelper.export_openapi ../frontend/openapi.json` then `pnpm gen:api`)
- [ ] T030 Implement providers and router in `frontend/src/app/providers.tsx` (QueryClient with `retry: false` for 4xx, ThemeProvider, TooltipProvider, Sonner `Toaster`) and `frontend/src/app/router.tsx` composing feature route modules (`frontend/src/features/*/routes.tsx`) under `AppShell`, with guards: `GET /setup/status` true → `/setup`; no session → `/login`; per contracts/ui-shell.md
- [ ] T031 Build the app shell in `frontend/src/app/shell/AppShell.tsx`, `TopBar.tsx`, `CoursePanelSlot.tsx`, `ActivityBar.tsx` per contracts/ui-shell.md: CSS grid layout using `min-h-[100dvh]` (never `h-screen`); left panel default 280 px, resizable 240–360 px, collapsible via button and `[` (state in `localStorage`), becoming a shadcn `Sheet` drawer below 1024 px; main outlet fills remaining width; `ActivityBar` renders components registered with `registerActivity({ id, component, priority })` from `frontend/src/app/shell/activity-registry.ts` (empty in 001); TopBar has app name, panel toggle, an area for page toolbar content, and account menu (sign out)
- [ ] T032 Implement auth screens in `frontend/src/features/auth/`: `SetupPage.tsx` (owner username, password, confirm; timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`), `LoginPage.tsx` (generic error message), `useMe.ts` (query key `['me']`), `routes.tsx`; inline field errors from `ApiError.errors`; labels associated, focus moved to first error on submit
- [ ] T033 [P] Component tests in `frontend/tests/unit/auth.test.tsx`: setup and login forms render accessible labels, submit calls the API, show generic error on 401, and have no axe violations

**Checkpoint**: Owner can be created, sign in/out works, the empty shell renders in light and dark. User stories can start.

---

## Phase 3: User Story 1 - Add a recurring class and see it on the calendar (Priority: P1) 🎯 MVP

**Goal**: Create a class (with inline year/semester/course creation) and see its weekly sessions in the week view; hierarchy folders created on disk.

**Independent Test**: Sign in, create "CS 201 Lecture" Mon+Wed 10:00–11:30 until semester end while creating 2026 / Fall 2026 / CS 201 inline; sessions appear on the right days in week view and stop after the semester end; `data/files/<username>/2026/Fall 2026/CS 201/` exists.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [ ] T034 [P] [US1] Unit tests for recurrence in `backend/tests/unit/test_recurrence.py`: `freq=none` → single date; weekly `MO,WE` interval 1; `interval_weeks=2`; `count=5`; `until` inclusive; `semester_end` resolved from the semester's current `end_date` (changing it changes results); range clipping; DST: `Europe/Berlin` weekly 10:00 across 2026-10-25 keeps 10:00 local with offsets +02:00 → +01:00; `status` `upcoming` vs `past` relative to an injected `now`; session key format `"{lineage_id}:{YYYY-MM-DD}"`
- [ ] T035 [P] [US1] Unit tests for class validation in `backend/tests/unit/test_class_validation.py`: `end_time > start_time` else 422 `invalid_time_range`; weekly with empty `by_weekday` → 422; `semester_end` with semester lacking `end_date` → 422 `semester_end_missing`; resolved end before `start_date` → 422 `series_ends_before_start`; `count` outside 1–500 → 422; link URL must be "absolute `http(s)://` URL, ≤ 2048 chars"; `title` ≤ 60, `location` ≤ 120 chars; max 10 links
- [ ] T036 [P] [US1] Contract tests in `backend/tests/contract/test_hierarchy_create.py`: `GET/POST /years` (201 created, 200 returns existing on same name case-insensitively, 422 empty/over 80 chars), `GET /semesters?yearId=` and `POST /semesters` (201/200/404 foreign yearId/422 `endDate` before `startDate`), `GET /courses` and `POST /courses` (201/200/404; same name allowed in another semester), `GET /courses/{id}` (200 with year+semester, 404 for another user's course), `GET /course-tree` shape; all responses validated with `openapi_check`
- [ ] T037 [P] [US1] Contract tests in `backend/tests/contract/test_classes_sessions_read.py`: `POST /classes` with ids and with nested `new` year/semester/course → 201 `ClassSeries`; 404 for another user's course id; 422 cases from T035 surfaced with JSON-pointer `errors[].field` (e.g. `/recurrence/end/untilDate`); `GET /classes/{lineageId}` 200/404; `GET /sessions?from&to` sorted by `start`, `courseId` filter, 422 when range > 400 days; `GET /sessions/{sessionKey}` 200 and 404 for malformed or foreign key
- [ ] T038 [P] [US1] Integration test (Constitution VI critical flow) in `backend/tests/integration/test_recurring_class_creation.py` against a real temp SQLite file and temp storage root: inline creation of year/semester/course + weekly class creates folders `files/<username>/2026/Fall 2026/CS 201`; generated session dates match the rule through semester end; DST-correct `start`/`end`; atomicity — monkeypatch class insert to fail after year/semester inserts and assert no rows and HTTP error with body intact; a member's request cannot see the owner's sessions (empty list / 404)

### Implementation for User Story 1

- [ ] T039 [P] [US1] Create `Year` model in `backend/src/unihelper/models/year.py`: `user_id` FK→users ON DELETE CASCADE; `name` "1–80 chars free-form"; `name_key` with "UNIQUE (user_id, name_key)"; `folder_name` with "UNIQUE (user_id, casefold(folder_name))"; `position` int "user-defined display order (FR-022a); 0 = top; UNIQUE (user_id, position)"; VersionMixin
- [ ] T040 [P] [US1] Create `Semester` model in `backend/src/unihelper/models/semester.py`: `year_id` FK→years ON DELETE CASCADE; `name`/`name_key` "1–80 chars; UNIQUE (year_id, name_key)"; `folder_name` "UNIQUE (year_id, casefold(folder_name))"; `start_date`/`end_date` nullable with CHECK "if both set, `end_date ≥ start_date`"; VersionMixin
- [ ] T041 [P] [US1] Create `Course` model in `backend/src/unihelper/models/course.py`: `semester_id` FK→semesters ON DELETE CASCADE; `name`/`name_key` "1–120 chars; UNIQUE (semester_id, name_key)"; `folder_name` "UNIQUE (semester_id, casefold(folder_name))"; `default_color` palette key; VersionMixin
- [ ] T042 [P] [US1] Create `ClassSeries` and `ClassLink` models in `backend/src/unihelper/models/class_series.py`: series columns `course_id` FK ON DELETE CASCADE, `lineage_id` ("= id of the first series of this class"), `split_from_id` nullable FK, `title` "≤ 60 chars", `location` "≤ 120 chars", `color` (one of `slate, red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink`), `start_date`, `start_time`/`end_time` (CHECK `end_time > start_time`), `freq` `none`\|`weekly`, `interval_weeks` "≥ 1", `by_weekday` "comma list of `MO,TU,WE,TH,FR,SA,SU`", `end_kind` `never`\|`semester_end`\|`until`\|`count`, `until_date`, `count` "1–500", VersionMixin; links `series_id` FK ON DELETE CASCADE, `label` "≤ 60 chars", `url` "absolute `http(s)://` URL, ≤ 2048 chars", `position`; index on `(user_id, course_id)` and `lineage_id`
- [ ] T043 [US1] Add Alembic revision `0002_hierarchy_classes` in `backend/src/unihelper/db/migrations/versions/` creating `years` (incl. `position` with UNIQUE (user_id, position)), `semesters`, `courses`, `class_series`, `class_links` with all constraints and indexes from T039–T042
- [ ] T044 [US1] Implement recurrence in `backend/src/unihelper/domain/recurrence.py` (pure functions, no DB): `validate_rule(series, semester)` raising typed errors used by T035; `resolve_end(series, semester)`; `expand(series, semester, range_from, range_to, tz, exceptions=(), now)` using `dateutil.rrule` (`WEEKLY`, `interval`, `byweekday`, `dtstart`, `until`/`count`) clipped to range, `freq=none` yields only `start_date`, combining wall-clock times with `zoneinfo.ZoneInfo(tz)`; returns `SessionView` objects with `key`, `date`, `start`, `end`, `status`, and a human `recurrence_summary` (e.g. "Weekly on Mon, Wed until semester end"); exceptions parameter is accepted but empty until US4
- [ ] T045 [US1] Implement hierarchy create/read in `backend/src/unihelper/services/hierarchy_service.py`: `get_or_create_year/semester/course(user, name, parent)` (returns `(entity, created)`; same `name_key` returns existing), computing `folder_name` with `safe_name` + `unique_sibling` and calling `StorageService.ensure_dir` before commit; new years get `position` 0 and existing years of the user shift down by 1 in the same transaction; `course_tree(user)` ordered years by `position` ascending, semesters by `start_date` desc (nulls last) then `created_at` desc, courses by name; `get_course_detail(user, id)`; all queries filtered by `user_id` (404 otherwise)
- [ ] T046 [US1] Implement class creation in `backend/src/unihelper/services/class_service.py`: `create_class(user, payload)` resolving `course` RefOrNew (nested `new` semester/year) via hierarchy_service inside ONE transaction, validating with `recurrence.validate_rule`, inserting series with `lineage_id = id` and links, setting `course.default_color` from the first class colour (FR-021); `get_lineage(user, lineage_id)` returning segments, course detail and `exceptionCount` (0 until US4)
- [ ] T047 [US1] Implement session queries in `backend/src/unihelper/services/session_query.py`: `list_sessions(user, from, to, course_id=None)` loading the user's series + semesters, expanding via `recurrence.expand` with `users.timezone`, joining course names, sorted by `start`; reject ranges > 400 days (422 `range_too_large`); `get_session(user, key)` parsing and validating the key format
- [ ] T048 [P] [US1] Create schemas in `backend/src/unihelper/schemas/hierarchy.py` (`Year`, `YearInput`, `Semester`, `SemesterCreate`, `Course`, `CourseCreate`, `CourseDetail`, `YearNode`) and `backend/src/unihelper/schemas/classes.py` (`ColorKey` enum, `Link`, `Recurrence`, `RefOrNew`, `ClassFields`, `ClassCreate`, `ClassSeries`, `ClassDetail`, `Session`) matching contracts/openapi.yaml with camelCase aliases
- [ ] T049 [US1] Implement routers `backend/src/unihelper/api/v1/hierarchy.py` (`GET/POST /years`, `GET/POST /semesters`, `GET/POST /courses`, `GET /courses/{courseId}`, `GET /course-tree` with optional `q`), `backend/src/unihelper/api/v1/classes.py` (`POST /classes`, `GET /classes/{lineageId}`), and `backend/src/unihelper/api/v1/sessions.py` (`GET /sessions`, `GET /sessions/{sessionKey}`); register them in `main.py`; POST returns 201 for created and 200 for existing
- [ ] T050 [P] [US1] Define the class colour palette in `frontend/src/lib/palette.ts` as **keys and CSS variable references only** (no colour values, Constitution V): export the 12 keys `slate, red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink` with accessible labels and a helper `eventStyle(key)` returning `{ backgroundColor: 'var(--event-<key>-bg)', color: 'var(--event-<key>-fg)', borderColor: 'var(--event-<key>-border)' }`; the colour values live only in `frontend/src/styles/tokens.css` (T025) and their AA contrast is verified by T026 (FR-021)
- [ ] T051 [P] [US1] Implement date helpers in `frontend/src/lib/dates.ts`: user-timezone aware formatting with `@date-fns/tz`, week starting Monday, `weekRange(date)`, `toISODate`, `parseTimeHHmm`
- [ ] T052 [US1] Implement data hooks in `frontend/src/features/classes/api.ts` and `frontend/src/features/courses/api.ts`: `useCourseTree()` (`['course-tree']`), `useYears`, `useSemesters(yearId)`, `useCourses(semesterId)`, `useCreateClass()` invalidating `['sessions']` and `['course-tree']` on success, `useSessions(from, to, courseId?)` (`['sessions', from, to, courseId]`)
- [ ] T053 [US1] Build `HierarchyPicker` in `frontend/src/features/classes/HierarchyPicker.tsx`: three linked shadcn `Command` comboboxes (year → semester → course) each offering existing items plus "Create “<typed name>”"; creating a semester shows optional start/end date pickers; produces the nested `RefOrNew` payload (no API calls until submit, so creation is atomic)
- [ ] T054 [US1] Build `RecurrenceFields` in `frontend/src/features/classes/RecurrenceFields.tsx`: repeat toggle (none / weekly), weekday toggle-group (Mon-first, accessible names), "every N weeks" (1–8), end choice radio (semester end / on date / after N occurrences, 1–500); semester-end option disabled with explanation when the chosen semester has no end date
- [ ] T055 [US1] Build `ClassForm` dialog in `frontend/src/features/classes/ClassForm.tsx` and route `/classes/new` in `frontend/src/features/classes/routes.tsx`: fields course (HierarchyPicker), optional title, start date, start/end time, location, links list (label + URL, add/remove, max 10), colour swatch radio-group from palette (defaults to course `defaultColor`), RecurrenceFields; client validation mirroring T035; on `ApiError` keep all input, map `errors[].field` to fields, show retry; on success close, toast, and navigate to the week containing the start date
- [ ] T056 [US1] Build the initial week view in `frontend/src/features/calendar/WeekView.tsx` and `EventBlock.tsx`: 7 Monday-first day columns on a CSS grid with hour rows (00–24, initial scroll to 07:00), sessions positioned by start/end minutes, block shows course name, title, time, location (truncated with ellipsis) in palette colours; `CalendarPage.tsx` at route `/calendar` (default) wired via `frontend/src/features/calendar/routes.tsx`; "New class" button in TopBar opens `/classes/new`
- [ ] T057 [US1] Build a basic `CoursePanel` in `frontend/src/features/courses/CoursePanel.tsx` rendering `useCourseTree()` as year → semester → course list with colour dots, mounted into `CoursePanelSlot`; register via `frontend/src/features/courses/routes.tsx`
- [ ] T058 [P] [US1] Component tests in `frontend/tests/unit/class-form.test.tsx`: inline-create payload shape, end ≤ start blocked, semester-end option disabled without end date, server 422 maps to field errors and keeps input, axe clean

**Checkpoint**: MVP — a signed-in owner can add recurring classes and see them in the week view; folders exist on disk.

---

## Phase 4: User Story 2 - Navigate the calendar in day, week, and month views (Priority: P1)

**Goal**: Day/week/month views, prev/next/Today, URL state, current-time line, overlaps side by side, month "+N more", session details, slot-click creation, full keyboard model.

**Independent Test**: With several (incl. overlapping) classes, switch views, step periods, press Today, open details, create from an empty slot — all by keyboard; sessions render in correct slots.

### Tests for User Story 2 ⚠️

- [ ] T059 [P] [US2] Unit tests in `frontend/tests/unit/overlap-layout.test.ts` for the overlap algorithm: non-overlapping → full width; 2 and 3 mutually overlapping → 1/2 and 1/3 widths; chained overlaps share a cluster; touching end/start is not an overlap
- [ ] T060 [P] [US2] Unit tests in `frontend/tests/unit/calendar-views.test.tsx`: range label per view, prev/next moves 1 day / 1 week / 1 month, Today returns, month cell shows "+N more" button revealing hidden sessions, event accessible name "CS 201 Lecture, Monday 5 October, 10:00 to 11:30, FENS G032"
- [ ] T061 [P] [US2] Playwright E2E in `frontend/tests/e2e/calendar-navigation.spec.ts` (keyboard only, both colour-scheme projects): `w`/`d`/`m` switch views, `←`/`→` move, `t` today, arrow keys move slot focus, `Enter` on empty slot opens pre-filled class form, `Enter` on event opens details, `Esc` returns focus, `?` opens shortcut help; run axe on each view

- [ ] T062 [P] [US2] Playwright performance check in `frontend/tests/e2e/calendar-performance.spec.ts` (SC-003): seed through the API a full semester of 6 courses × 3 weekly sessions; measure from the key press (`d`/`w`/`m`, `←`/`→`) to the new view's sessions being visible (`performance.now()` around a `waitFor` on the expected event count) and assert < 1000 ms for every view switch and period step, with a warm cache and with a cold `['sessions']` cache

### Implementation for User Story 2

- [ ] T063 [P] [US2] Implement overlap layout in `frontend/src/features/calendar/layoutOverlaps.ts` (pure function: cluster by overlap, greedy column assignment, returns `{ column, columns }` per session)
- [ ] T064 [US2] Add view routing in `frontend/src/features/calendar/routes.tsx` and `CalendarPage.tsx`: `/calendar/:view?/:date?` with `view` ∈ `day|week|month`, `date` = `YYYY-MM-DD`; defaults week/today; below 1024 px default view is day; compute fetch range per view and call `useSessions`
- [ ] T065 [US2] Build `CalendarToolbar` in `frontend/src/features/calendar/CalendarToolbar.tsx` rendered into the TopBar toolbar area: Today button, previous/next icon buttons with accessible labels, current range label, D/W/M `ToggleGroup`
- [ ] T066 [US2] Refactor the time grid into `frontend/src/features/calendar/TimeGrid.tsx` shared by `DayView.tsx` and `WeekView.tsx`: fixed header row, vertical scroll body, overlap layout from T063, current-time line (`--now-line`) updated every minute, initial scroll to 07:00 or first session of the period
- [ ] T067 [US2] Build `MonthView` in `frontend/src/features/calendar/MonthView.tsx`: 6×7 grid Monday-first, out-of-month days muted (still AA), up to N chips per cell based on cell height, "+N more" button opening a Popover listing all sessions of that day
- [ ] T068 [US2] Build session details in `frontend/src/features/classes/SessionDetails.tsx` with route `/sessions/:sessionKey`: popover anchored to the event (dialog on small screens) showing course, year, semester, date, time, location, links (open in new tab with `rel="noopener noreferrer"`), recurrence summary; actions Edit/Delete (wired in US4), "Open course" (→ `/courses/:courseId`), and actions registered via `registerSessionAction` from `frontend/src/features/classes/session-actions.ts`
- [ ] T069 [US2] Implement slot creation (FR-012) in `TimeGrid.tsx`: click or `Enter` on an empty 30-minute slot navigates to `/classes/new?date=&start=&end=` (default 1 h), and `ClassForm` reads these to pre-fill
- [ ] T070 [US2] Implement the keyboard model in `frontend/src/features/calendar/useCalendarKeyboard.ts` and `ShortcutsDialog.tsx`: roving tabindex over days/slots/events; arrows move focus; `t`, `d`, `w`, `m`, `←`/`→`, `n` (new class), `?` (help); ignored while focus is in inputs, textareas, or contenteditable; register shortcut list for the help dialog
- [ ] T071 [US2] Apply motion rules in `frontend/src/features/calendar/`: view/period transitions with `motion/react` opacity/translate ≤ 200 ms, disabled when `prefers-reduced-motion: reduce`

**Checkpoint**: US1 + US2 work together; calendar fully navigable by keyboard in light and dark.

---

## Phase 5: User Story 5 - Sign in & accounts (Priority: P1)

**Goal**: Owner-first account management: owner creates/disables/deletes members and resets passwords; forced password change; own password and time zone; login throttling; strict per-user data isolation.

**Independent Test**: Owner creates member `ali`; `ali` must change password at first sign-in and sees an empty calendar; owner sees only account fields; no public sign-up; wrong passwords get throttled.

### Tests for User Story 5 ⚠️

- [ ] T072 [P] [US5] Contract tests in `backend/tests/contract/test_admin_accounts.py`: `GET/POST /admin/users` (owner 200/201; member 403 `forbidden`; 409 `name_taken`; 422 invalid username/short password), `PATCH /admin/users/{id}` disable/enable (owner disabling self → 422), `DELETE /admin/users/{id}` returns `keptFolder` and folder still exists, `POST /admin/users/{id}/password-reset` 204 and target's sessions revoked; responses never include schedule data
- [ ] T073 [P] [US5] Contract tests in `backend/tests/contract/test_auth_account.py`: `POST /auth/password` (204, 401 wrong current, 422 weak/equal to username, other sessions revoked), `PATCH /auth/profile` timezone (200, 422 unknown IANA zone), user with `mustChangePassword` gets 403 `password_change_required` on every endpoint except `/auth/me`, `/auth/password`, `/auth/logout`; disabled user login → 401 `invalid_credentials`; 6th rapid failed login → 429 with `Retry-After`
- [ ] T074 [P] [US5] Integration test in `backend/tests/integration/test_account_isolation.py`: owner and member each create classes; every read/list/mutation endpoint called with the other user's ids returns 404 (never 403); course-tree and sessions lists contain only own data (FR-002, FR-003c)

### Implementation for User Story 5

- [ ] T075 [US5] Extend `backend/src/unihelper/services/auth_service.py`: `change_password(user, current, new)` revoking other sessions and clearing `must_change_password`; `update_profile(user, timezone)` validating with `zoneinfo.available_timezones()`; in-process login throttling keyed by (username, client IP) with exponential backoff after 5 failures (429 `too_many_attempts`, `Retry-After`)
- [ ] T076 [US5] Implement `backend/src/unihelper/services/account_service.py` (owner only): list accounts (account fields only), create member with `must_change_password = true`, disable/enable (sets `disabled_at`, revokes sessions; owner cannot disable or delete themselves), delete member (DB rows cascade; storage folder kept; returns relative `keptFolder`), reset password (sets `must_change_password`, revokes sessions)
- [ ] T077 [US5] Add `password_change_required` enforcement to `current_user` in `backend/src/unihelper/api/deps.py` (403 except `/auth/me`, `/auth/password`, `/auth/logout`) and add schemas `Account`, password and profile requests in `backend/src/unihelper/schemas/auth.py`
- [ ] T078 [US5] Implement routers: `POST /auth/password` and `PATCH /auth/profile` in `backend/src/unihelper/api/v1/auth.py`; `backend/src/unihelper/api/v1/admin.py` with `GET/POST /admin/users`, `PATCH/DELETE /admin/users/{userId}`, `POST /admin/users/{userId}/password-reset`, all behind `require_owner`
- [ ] T079 [P] [US5] Add operator CLI `backend/src/unihelper/cli.py` with command `reset-owner-password` (local shell only, prompts for new password, sets `must_change_password`), exposed as `[project.scripts] unihelper = "unihelper.cli:main"` in `backend/pyproject.toml`
- [ ] T080 [US5] Build `frontend/src/features/auth/ChangePasswordPage.tsx` at `/account/password` and extend the router guard in `frontend/src/app/router.tsx` to force it when `me.mustChangePassword`; add account menu items in `frontend/src/app/shell/TopBar.tsx`: Change password, Time zone (dialog with searchable IANA list → `PATCH /auth/profile`), Admin (owner only), Sign out
- [ ] T081 [US5] Build `frontend/src/features/admin/AccountsPage.tsx` with route `/admin/accounts` in `frontend/src/features/admin/routes.tsx` (owner guard): table of accounts, create member dialog, disable/enable toggle, reset password dialog, delete with `AlertDialog` explaining the folder is kept and showing `keptFolder`
- [ ] T082 [P] [US5] Playwright E2E in `frontend/tests/e2e/accounts.spec.ts`: fresh install → setup owner → create member → sign in as member → forced password change → empty calendar; no registration link on `/login`; keyboard only

**Checkpoint**: Multi-account, owner-managed installation with isolated data.

---

## Phase 6: User Story 3 - Browse and search courses in the left panel (Priority: P2)

**Goal**: Course panel grouped by year (user-ordered, reorderable — FR-022a) and semester (most recent first) with live search, empty state, keyboard access, navigation to the course page placeholder, and hierarchy rename/delete/date editing (FR-020, FR-017, FR-025).

**Independent Test**: Courses across two semesters; type "cs" filters live; "zzz" shows empty state with clear; select a course → course page identifying it; move a year down with `Alt+↓` → order persists after reload; rename a semester → folder renamed on disk; change semester end → sessions follow.

### Tests for User Story 3 ⚠️

- [ ] T083 [P] [US3] Contract tests in `backend/tests/contract/test_hierarchy_manage.py`: `PATCH /years/{id}`, `/semesters/{id}`, `/courses/{id}` (200 with incremented `version`, 409 `name_taken`, 412 `version_conflict` on stale `If-Match`, 428 without `If-Match`, 404 foreign); `PATCH /semesters/{id}` removing `endDate` while a series uses `semester_end` → 422 `semester_end_in_use`; `DELETE` each (204, folders still on disk); `GET …/deletion-impact` counts and `keptFolder`; `GET /course-tree?q=cs` case-insensitive partial match; `PUT /years/order` (200 returns years with positions 0..n-1 in the given order and `GET /course-tree` follows it; 409 `order_mismatch` when the list omits, duplicates, or adds ids — including another user's year ids, without revealing they exist; 422 missing body); a new year created via `POST /years` appears at position 0; deleting a year closes the position gap
- [ ] T084 [P] [US3] Integration test in `backend/tests/integration/test_hierarchy_rename_and_dates.py`: rename year/semester/course renames folders (incl. `safe_name` + collision suffix); simulated DB failure after rename restores the old folder name; moving semester `end_date` earlier removes later sessions of `semester_end` classes and moving it later adds them
- [ ] T085 [P] [US3] Component tests in `frontend/tests/unit/course-panel.test.tsx`: grouping order (years by `position`, semesters most recent first), year reordering by drag-and-drop, by `Alt+↑`/`Alt+↓`, and by menu "Move up"/"Move down" calling `PUT /years/order` with optimistic update and rollback on error, focus staying on the moved year with a live-region announcement, live filter (case-insensitive), empty state + clear, `/` focuses search, keyboard selection navigates to `/courses/:id`, axe clean

- [ ] T086 [P] [US3] Search performance test in `frontend/tests/unit/course-panel.performance.test.tsx` (SC-005): render `CoursePanel` with a mocked course tree of 200 courses across 10 semesters; type a query with `userEvent` and assert the filtered list is rendered within 500 ms of the last keystroke; also assert filtering is synchronous on the cached tree (no network request per keystroke)

### Implementation for User Story 3

- [ ] T087 [US3] Extend `backend/src/unihelper/services/hierarchy_service.py`: `rename_year/semester/course` (new `safe_name` + `unique_sibling`, `StorageService.rename_dir` before commit with undo on failure, `version` check), `update_semester_dates` (validate `end_date ≥ start_date`; block removing `end_date` used by `semester_end` series), `delete_year/semester/course` (cascade metadata, never delete folders), `deletion_impact(...)` returning counts and `keptFolder`; `reorder_years(user, year_ids)` (must equal exactly the user's current year ids, else 409 `order_mismatch`; rewrite all positions 0..n-1 in one transaction, first offsetting existing positions to avoid unique-constraint clashes); `delete_year` compacts remaining positions; course-tree `q` filter on `name_key LIKE '%' || casefold(q) || '%'`
- [ ] T088 [US3] Implement routers in `backend/src/unihelper/api/v1/hierarchy.py`: `PATCH/DELETE /years/{yearId}`, `GET /years/{yearId}/deletion-impact`, `PATCH/DELETE /semesters/{semesterId}`, `GET /semesters/{semesterId}/deletion-impact`, `PATCH/DELETE /courses/{courseId}`, `GET /courses/{courseId}/deletion-impact`, `PUT /years/order` (declared before `/years/{yearId}` so it is not captured as an id), all PATCH/DELETE requiring `If-Match`; add `SemesterUpdate` and course update schemas in `backend/src/unihelper/schemas/hierarchy.py`
- [ ] T089 [US3] Complete `frontend/src/features/courses/CoursePanel.tsx`: search input (`/` shortcut, clear button, `aria-controls` the list) filtering the cached tree client-side as the user types; collapsible year/semester groups (years in `position` order, semesters most recent first); year reordering (FR-022a) with a drag handle per year row (keyboard-accessible sortable list), `Alt+↑`/`Alt+↓` on a focused year, and "Move up"/"Move down" items in the year menu (T090), all calling `PUT /years/order` with an optimistic update, rollback + toast on error, focus kept on the moved year, and a polite live-region announcement ("2026 moved to position 2 of 3"); reordering is disabled while a search filter is active; empty state with clear action; courses as links to `/courses/:courseId`; per-course badge slot (`registerCourseAdornment`) in `frontend/src/features/courses/adornments.ts` for 002
- [ ] T090 [US3] Add hierarchy management UI in `frontend/src/features/courses/HierarchyMenu.tsx`: dropdown on year/semester/course rows → Rename (inline dialog), Move up / Move down (year rows only; disabled at the ends), Edit dates (semester), Delete (fetch `deletion-impact`, `AlertDialog` stating what will be removed and that files remain in the shown folder); handle 412 by refetching and asking to retry
- [ ] T091 [US3] Build the course page placeholder in `frontend/src/features/courses/CoursePage.tsx` at `/courses/:courseId` (route in `frontend/src/features/courses/routes.tsx`): heading with course name, year and semester, colour, and a note that the session timeline arrives in Feature 002; 404 state for unknown/foreign course

**Checkpoint**: Course panel complete; hierarchy can be managed with folders kept in sync.

---

## Phase 7: User Story 4 - Edit and delete classes (Priority: P2)

**Goal**: Edit/delete with Google-style scopes — This session / This and following / All sessions — using exceptions and lineage splits that keep session keys stable (FR-018, FR-018a, FR-018b).

**Independent Test**: Change one Wednesday's room (this session), change time from next week on (this and following), change colour for all; verify each scope's effect, that the single-session override survives "all", and that cancelling one Monday removes only it.

### Tests for User Story 4 ⚠️

- [ ] T092 [P] [US4] Unit tests in `backend/tests/unit/test_scopes.py` per data-model.md "Edit scopes": `this` edit creates/updates a `modified` exception (same date, `end > start`); `this` delete creates `cancelled`; `following` at a mid-series date truncates old segment to `until_date = date − 1 day` and creates a new segment with same `lineage_id`, `split_from_id`, copied links, original end rule; `following` at the segment's `start_date` behaves like `all` for this and later segments; `following` delete only truncates; `all` updates every segment and keeps `modified` exceptions (returns `preservedOverrides`); exceptions whose dates the new rule no longer generates are deleted (`removedOverrides`); session keys of unchanged dates are identical before and after every operation
- [ ] T093 [P] [US4] Contract tests in `backend/tests/contract/test_session_scopes.py`: `PATCH /sessions/{key}?scope=this|following|all` (200 `ScopeResult`, 422 when `scope=this` includes fields other than `startTime`/`endTime`/`location`, 412 when `If-Match` does not equal the `seriesVersion` of the segment containing the target session — or, for `scope=this` on a session with an existing exception, its `exceptionVersion` — including after another edit split or changed that segment; 428 missing; 422 missing/invalid `scope`), `DELETE /sessions/{key}?scope=…` (200), 404 foreign/malformed key; `GET /sessions` reflects cancellations and overrides (`isException`, `exceptionVersion`); `GET /classes/{lineageId}` shows multiple segments and `exceptionCount`
- [ ] T094 [P] [US4] Integration test in `backend/tests/integration/test_edit_scopes_flow.py`: run quickstart scenario 8–9 end-to-end through the API against real SQLite and verify resulting session lists and stable keys

### Implementation for User Story 4

- [ ] T095 [P] [US4] Create `SessionException` model in `backend/src/unihelper/models/session_exception.py`: `user_id` FK, `lineage_id`, `original_date` with "UNIQUE (lineage_id, original_date)", `kind` `cancelled`\|`modified`, nullable `start_time`/`end_time` ("same date; `end > start`") and `location`, VersionMixin
- [ ] T096 [US4] Add Alembic revision `0003_session_exceptions` in `backend/src/unihelper/db/migrations/versions/` creating `session_exceptions` with its unique constraint and index on `(user_id, lineage_id)`
- [ ] T097 [US4] Apply exceptions in `backend/src/unihelper/domain/recurrence.py` `expand(...)`: drop dates with `cancelled`; apply `modified` time/location overrides and set `is_exception`/`exception_version`; update `session_query.py` to load exceptions per lineage
- [ ] T098 [US4] Implement scope logic in `backend/src/unihelper/domain/scopes.py` as pure planning functions returning a change set (series updates/inserts/deletes, exception upserts/deletes, `preserved_overrides`, `removed_overrides`) for `edit(scope, …)` and `delete(scope, …)` exactly per data-model.md
- [ ] T099 [US4] Implement `apply_scope_edit` / `apply_scope_delete` in `backend/src/unihelper/services/class_service.py`: load lineage + exceptions, verify `If-Match` against the `version` of the segment containing the target session (or the exception's `version` for `scope=this` when an exception already exists for that date) — this single check guards `this`, `following` and `all`; every touched segment and exception gets its `version` bumped, validate new values with `recurrence.validate_rule`, apply the change set from `scopes.py` in one transaction, bump versions, return `ScopeResult`
- [ ] T100 [US4] Implement `PATCH /sessions/{sessionKey}` and `DELETE /sessions/{sessionKey}` with required `scope` query in `backend/src/unihelper/api/v1/sessions.py`; add `SessionEdit` and `ScopeResult` schemas to `backend/src/unihelper/schemas/classes.py`
- [ ] T101 [US4] Build `ScopeDialog` in `frontend/src/features/classes/ScopeDialog.tsx`: radio group "This session" / "This and following sessions" / "All sessions" (only shown for recurring classes), with explanation of each; returns the chosen scope
- [ ] T102 [US4] Wire editing in `frontend/src/features/classes/EditSessionFlow.tsx`: Edit from SessionDetails → ScopeDialog → `ClassForm` in edit mode (for `this`, only time and location editable) → `PATCH` with `If-Match`; on success invalidate `['sessions']`, toast including "N individually changed sessions kept" when `preservedOverrides > 0`; on 412 show "This class changed elsewhere — reload" and refetch
- [ ] T103 [US4] Wire deletion in `frontend/src/features/classes/DeleteSessionFlow.tsx`: Delete → ScopeDialog → `AlertDialog` confirmation stating what will be removed and that note/audio files are never deleted (FR-019; content counts arrive with 002) → `DELETE`; nothing is deleted before confirmation
- [ ] T104 [P] [US4] Playwright E2E in `frontend/tests/e2e/edit-scopes.spec.ts`: keyboard-only run of quickstart scenarios 8 and 9 asserting rendered sessions and the preserved-override toast

**Checkpoint**: All five user stories functional and independently testable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Accessibility, security hardening, performance, production serving, and end-to-end validation across stories

- [ ] T105 [P] Contract coverage guard in `backend/tests/contract/test_coverage.py`: enumerate every path+method in `specs/001-class-schedule-calendar/contracts/openapi.yaml` and in the live app OpenAPI, and fail if any is missing from the contract test suite (via a `@covers("METHOD /path")` marker) or if live and contract paths differ (Constitution VI)
- [ ] T106 [P] Security tests in `backend/tests/contract/test_security.py`: every mutating endpoint rejects missing/mismatched CSRF (403); cookies `HttpOnly` + `SameSite=Lax` (+ `Secure` when enabled); responses include `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, and a CSP (`default-src 'self'`) on the SPA — implement headers in `backend/src/unihelper/main.py` middleware
- [ ] T107 [P] Performance test in `backend/tests/integration/test_sessions_performance.py`: seed 6 courses × 3 weekly sessions over a semester; `GET /sessions` for a 6-week range completes < 150 ms and for 400 days < 500 ms on the test machine (SC-003)
- [ ] T108 [P] Accessibility E2E in `frontend/tests/e2e/a11y-themes.spec.ts`: for setup, login, calendar (D/W/M), class form, session details, course panel, admin — run axe with WCAG 2.1 AA tags in both `chromium-light` and `chromium-dark`; verify visible focus ring on every interactive element via keyboard traversal (FR-027, SC-006)
- [ ] T109 [P] Narrow-screen behaviour in `frontend/src/app/shell/AppShell.tsx` and `frontend/tests/e2e/responsive.spec.ts`: at 390 px width the course panel opens as a drawer, calendar defaults to day view, no horizontal page scroll
- [ ] T110 Production serving check: build `frontend/dist`, start backend with `UNIHELPER_STATIC_DIR`, and add `backend/tests/integration/test_static_spa.py` asserting `/` and `/calendar/week/2026-10-05` return `index.html` while `/api/v1/health` returns JSON
- [ ] T111 [P] Update `README.md` with setup/run/test commands and the data folder layout (link to contracts/storage-layout.md) and document the operator `unihelper reset-owner-password` command
- [ ] T112 Run all checks from quickstart.md (`ruff`, `mypy`, `pytest` unit/contract/integration, `pnpm lint`, `typecheck`, `test`, `e2e`) and walk through the 14 manual validation scenarios in `specs/001-class-schedule-calendar/quickstart.md`; record results in `specs/001-class-schedule-calendar/checklists/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: after Foundational — MVP
- **US2 (Phase 4)**: after US1 (reuses WeekView, sessions hooks, ClassForm)
- **US5 (Phase 5)**: after Foundational; independent of US1/US2 except T074 (needs US1 class endpoints) — can run in parallel with US2
- **US3 (Phase 6)**: after US1 (course tree, hierarchy service)
- **US4 (Phase 7)**: after US1 (class service, recurrence) and US2 (SessionDetails entry point)
- **Polish (Phase 8)**: after all desired stories

### User Story Dependencies

```text
Setup → Foundational ─┬─> US1 (MVP) ─┬─> US2 ──┬─> US4
                      │              ├─> US3   │
                      └─> US5 ───────┘ (T074 needs US1)
                                              └─> Polish (after all)
```

### Within Each User Story

- Tests first (must fail) → models → migration → domain → services → routers → frontend hooks → UI
- Backend endpoints of a story before its frontend wiring
- Commit after each task or logical group

### Parallel Opportunities

- Setup: T003 and T006 in parallel with backend T002
- Foundational: T009–T011, T013–T015, T017, T020, T024 (after T023), T025–T028 (incl. token-only colour guard T027), T033
- US1: tests T034–T038 together; models T039–T042 together; T048, T050, T051 together
- US2: T059–T062 together (incl. performance check T062); T063 alongside T064
- US5: T072–T074 together; T079 independent; whole US5 in parallel with US2/US3 by a second developer
- US3: T083–T086 together (incl. search performance test T086)
- US4: T092–T094 together; T095 alongside T098
- Polish: T105–T109, T111 together

---

## Parallel Example: User Story 1

```bash
# Tests first (all different files):
Task: "Unit tests for recurrence in backend/tests/unit/test_recurrence.py"
Task: "Unit tests for class validation in backend/tests/unit/test_class_validation.py"
Task: "Contract tests in backend/tests/contract/test_hierarchy_create.py"
Task: "Contract tests in backend/tests/contract/test_classes_sessions_read.py"
Task: "Integration test in backend/tests/integration/test_recurring_class_creation.py"

# Then models together:
Task: "Create Year model in backend/src/unihelper/models/year.py"
Task: "Create Semester model in backend/src/unihelper/models/semester.py"
Task: "Create Course model in backend/src/unihelper/models/course.py"
Task: "Create ClassSeries and ClassLink models in backend/src/unihelper/models/class_series.py"

# Frontend helpers alongside backend services:
Task: "Define the class colour palette in frontend/src/lib/palette.ts"
Task: "Implement date helpers in frontend/src/lib/dates.ts"
```

## Parallel Example: User Story 5 (second developer, alongside US2)

```bash
Task: "Contract tests in backend/tests/contract/test_admin_accounts.py"
Task: "Contract tests in backend/tests/contract/test_auth_account.py"
Task: "Add operator CLI backend/src/unihelper/cli.py"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (owner setup + sign-in + shell)
2. Phase 3 US1 → **STOP and VALIDATE** with quickstart scenarios 1, 4, 6 and the integration test
3. Demo: owner adds a recurring class and sees it in week view; folders on disk

### Incremental Delivery

1. US1 → recurring classes visible (MVP)
2. US2 → full calendar navigation, details, keyboard model
3. US5 → member accounts and isolation (can ship earlier if multiple users needed)
4. US3 → searchable course panel and hierarchy management
5. US4 → edit scopes and cancellations
6. Polish → a11y/security/perf sweep, production single-process build

### Notes

- [P] = different files, no dependency on incomplete tasks; [USn] = traceability to spec stories
- Constitution gates before merge: all endpoint contract tests, critical-flow integration test (T038), lint/type checks, light + dark + keyboard verification
- Do not build notes, audio, transcription, or theme editing in this feature (Constitution VII)
