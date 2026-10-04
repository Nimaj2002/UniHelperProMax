# Phase 0 Research: Class Schedule Calendar (001)

All Technical Context unknowns are resolved below. Each entry: **Decision / Rationale /
Alternatives considered**. Decisions marked *(project-wide)* set the architecture that
features 002–005 build on.

## R1. Backend framework *(project-wide)*

- **Decision**: Python 3.12+ with FastAPI, Pydantic v2, served by Uvicorn (single process).
- **Rationale**: User mandated Python + versioned REST JSON. FastAPI gives typed request/response
  models, automatic OpenAPI (used to generate frontend types and to check contracts), async
  streaming responses (needed later for audio playback/upload in 003), and background tasks.
- **Alternatives**: Django + DRF (heavier, ORM/admin not needed); Flask (no native typing/OpenAPI);
  Litestar (smaller ecosystem).

## R2. Persistence & migrations *(project-wide)*

- **Decision**: SQLite (WAL mode, `foreign_keys=ON`, `busy_timeout=5000`) via SQLAlchemy 2.0
  (sync engine, used from FastAPI's threadpool) with Alembic migrations. One database file
  `data/unihelper.sqlite3`.
- **Rationale**: Constitution VII mandates SQLite only. WAL allows concurrent reads during writes
  (calendar reads while saving). Alembic keeps schema evolution safe as 002–005 add tables
  (notes index, recordings, transcription jobs, themes, settings).
- **Alternatives**: raw `sqlite3` (no migrations, more boilerplate); SQLModel (thin layer, less
  mature migrations story); async SQLAlchemy + aiosqlite (no real benefit for single-user SQLite).

## R3. Authentication & sessions *(project-wide)*

- **Decision**: Username + password; Argon2id hashing (`argon2-cffi`); server-side session table
  with an opaque random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when served over
  HTTPS); CSRF protection by double-submit token (`X-CSRF-Token` header must match a readable
  `csrf_token` cookie) on all state-changing requests; login throttling in-process (exponential
  backoff per username + client IP). Roles: `owner` (exactly one) and `member`.
- **Rationale**: Owner-first account model (spec clarification). Server-side sessions can be revoked
  (sign-out, account disable) without extra infrastructure; no tokens readable by JS. In-process
  throttling avoids Redis (Constitution VII).
- **Alternatives**: JWT in localStorage (XSS-exposed, hard to revoke); OAuth/SSO (rejected in spec);
  bcrypt (fine, Argon2id is the current OWASP recommendation).

## R4. Recurrence model & session identity *(project-wide)*

- **Decision**: Store each class as a **series** (`class_series`) with an RFC 5545-compatible subset:
  `WEEKLY`, `INTERVAL`, `BYDAY`, end by `UNTIL` / `COUNT` / *semester end* (resolved dynamically
  from the semester's current `end_date`) or none. Sessions are **not stored**; they are expanded
  on read with `python-dateutil`'s `rrule` for the requested range. Single-session changes are
  stored as **exceptions** keyed by the session's *original date*. "This and following" **splits**
  the series: the old series gets `UNTIL = date − 1 day`, a new series starts at `date`, and both
  share a `lineage_id`.
  - **Session key** = `{lineage_id}:{original_date}` (e.g. `c9f2…:2026-10-05`). Stable across
    edits, splits, and time changes — later features attach notes/recordings to this key.
- **Rationale**: Expanding on read means editing a semester end date or a rule instantly updates
  all sessions (spec edge case) without rewriting rows. Exceptions + split lineage implement the
  Google-style scopes (FR-018a) without breaking the series, and the lineage-based key keeps
  attached content attached (FR-018b).
- **Alternatives**: Materialise every session row (simple reads, but every rule edit must
  diff/rewrite rows and re-key attached content); store a raw RRULE string (harder to validate and
  to edit via form fields); key sessions by series id (breaks on split).

## R5. Time zones & DST

- **Decision**: Store class times as **local wall-clock** (`start_time`, `end_time`) plus the
  user's IANA time zone (`users.timezone`, detected from the browser at account creation, editable
  later). Expansion produces timezone-aware datetimes via `zoneinfo`; the API returns ISO 8601
  with offset. Sessions crossing midnight are rejected (spec).
- **Rationale**: Spec edge case: a session on a DST change keeps its wall-clock time. Storing UTC
  instants would shift lectures by an hour after DST.
- **Alternatives**: UTC storage (wrong across DST); floating time without zone (ambiguous for "now"
  comparisons used by 002's upcoming/past status).

## R6. Human-readable storage layout & naming *(project-wide)*

- **Decision**: Content root `data/files/<username>/<Year>/<Semester>/<Course>/<class_date>/{notes,audios}/`.
  Each year/semester/course row stores its **`folder_name`**, computed once from its display name by
  a safe-name function and kept in sync on rename. `class_date` folders are created **lazily by
  later features** when the first note/recording is saved; their name is `YYYY-MM-DD`, or
  `YYYY-MM-DD HHmm` (session start time) if another session of the same course already owns
  `YYYY-MM-DD`, and is then **recorded in the database** so it never changes. Full rules in
  [contracts/storage-layout.md](./contracts/storage-layout.md).
- **Safe-name function**: Unicode NFC; replace `/ \ : * ? " < > |` and control chars with `-`;
  collapse whitespace; trim leading/trailing spaces and dots; suffix `_` to Windows reserved names
  (`CON`, `NUL`, `COM1`…); cap at 80 characters; resolve case-insensitive sibling collisions with
  ` (2)`, ` (3)`…
- **Rationale**: Constitution II (browsable hierarchy). Per-user top folder isolates accounts under
  the owner-first model. Recording folder names in the DB prevents renames when a second session
  appears on the same date. Rules are safe on Windows (user is on Windows/WSL), macOS, and Linux.
- **Alternatives**: Deriving paths from names on every access (renames break history); IDs as folder
  names (violates Principle II); creating every dated folder upfront (hundreds of empty folders).

## R7. Filesystem consistency on create/rename

- **Decision**: A `StorageService` owns all filesystem access. Create: DB insert in a transaction →
  `mkdir(parents=True, exist_ok=True)` before commit → commit (on mkdir failure, roll back). Rename:
  `os.replace` old→new folder, then commit; if commit fails, rename back. Deletes of
  year/semester/course/class **never delete folders** (FR-019). Writes of file content (002+) will use
  write-to-temp + `fsync` + atomic rename.
- **Rationale**: Keeps DB and folders in sync (FR-025) and never loses user files (Principle I).
- **Alternatives**: Background reconciliation job (more moving parts); deleting folders on delete
  (violates FR-019).

## R8. Frontend stack *(project-wide)*

- **Decision**: React 19 + TypeScript + Vite; Tailwind CSS v4 (Vite plugin); shadcn/ui components
  (owned in `src/components/ui`); React Router v7 (data/library mode); TanStack Query for server
  state; `date-fns` v4 + `@date-fns/tz` for date math; `@phosphor-icons/react` icons (configured as
  shadcn's icon library, one family per project per taste-skill §3.C); Motion (`motion/react`) for
  restrained transitions, honoring `prefers-reduced-motion`; self-hosted fonts via `@font-face`.
  API types generated from the backend OpenAPI with `openapi-typescript`; a thin `fetch` wrapper adds
  the CSRF header and maps RFC 9457 problem responses to typed errors.
- **Rationale**: User mandated React + shadcn/ui and taste-skill. SPA served by the backend keeps a
  single process (no Node server in production — Constitution VII). Generated types keep the
  frontend honest to the versioned API (Principle III).
- **Alternatives**: Next.js (taste-skill default, but RSC/server runtime adds a second server and
  blurs the strict API boundary); Redux (unneeded); lucide icons (discouraged by taste-skill).

## R9. Calendar component

- **Decision**: Build day/week/month views in-house from shadcn primitives (Button, ToggleGroup,
  Popover, Dialog, ScrollArea, Tooltip) on a CSS Grid time grid, using `date-fns`. Overlap layout
  uses the standard column-packing algorithm (cluster overlapping events, assign columns, width =
  1/columns). Keyboard model: roving tabindex across days/slots; arrow keys move; Enter opens slot
  (create) or event (details); `t` today, `d`/`w`/`m` switch view, `j`/`k` or `←`/`→` previous/next.
- **Rationale**: Full control over theme tokens (light/dark now, user themes in 005), WCAG AA, and
  keyboard operability (FR-027); avoids fighting a third-party stylesheet ("never ship default
  state"). Scope is bounded: three views, no drag-to-resize in 001.
- **Alternatives**: FullCalendar (heavy CSS, theming and a11y gaps, premium plugins for some views);
  react-big-calendar (dated styling, limited keyboard support); Schedule-X (younger, own design
  language).

## R10. Design direction (taste-skill)

- **Decision**: Design read: *focused study tool, calm productivity app, long daily sessions*. Dials:
  `DESIGN_VARIANCE 4 / MOTION_INTENSITY 3 / VISUAL_DENSITY 6` (app UI, not a landing page; density
  appropriate for a calendar). Foundation: shadcn/ui with **CSS-variable semantic tokens**
  (`--surface`, `--surface-elevated`, `--text-primary`, `--text-muted`, `--border`, `--accent`,
  `--accent-foreground`, `--focus-ring`, `--grid-line`, `--event-*`) swapped by
  `[data-theme="dark"]` and `prefers-color-scheme` (taste-skill §8.A). No pure `#000`/`#fff`;
  off-black/off-white. Class colour palette: 12 presets, each defined as a light/dark pair with
  verified AA text contrast (FR-021).
- **Rationale**: Taste-skill §1.A maps "minimalist / calm" and "accessibility-critical" to low
  variance/motion; token strategy is the one 005 will extend with user-created themes without
  refactoring components.
- **Alternatives**: Tailwind `dark:` pairs per utility (cannot support user-created themes later).

## R11. App shell & extension points *(project-wide)*

- **Decision**: One authenticated `AppShell` layout: top bar (app name, global actions, account
  menu), collapsible left **CoursePanel** (default 280 px, min 240, collapsible to 0 / drawer below
  `lg`), main **Outlet** (calendar at `/calendar`, course pages at `/courses/:courseId…` in 002,
  settings at `/settings/*` in 005), and a reserved **global activity bar slot** (used by 003's
  recording bar). Routes are registered per feature module (`features/*/routes.tsx`). Details in
  [contracts/ui-shell.md](./contracts/ui-shell.md).
- **Rationale**: Calendar takes the remaining width (~75–80 % on desktop, matching Google Calendar
  proportions, FR-004); later features plug in without touching the shell.
- **Alternatives**: Per-page layouts (duplicated panels, harder to keep recording bar global).

## R12. API conventions *(project-wide)*

- **Decision**: Base path `/api/v1`; JSON with camelCase fields; RFC 9457 `application/problem+json`
  errors with a stable `code`; optimistic concurrency via integer `version` on mutable resources
  (`If-Match: "<version>"` on PATCH/DELETE → `412` on mismatch); ISO 8601 dates/times; ids are
  UUIDv7 strings; list endpoints unpaginated where data is per-user and small (course tree,
  sessions by date range). Destructive endpoints offer a `GET …/deletion-impact` preview so the UI
  can state consequences before confirmation (FR-020, User Story 4). Atomic inline creation: `POST
  /classes` may create year/semester/course in the same transaction (FR-014, FR-026).
- **Rationale**: Principle III; consistent errors simplify "keep form input and retry" (FR-026);
  `version`/`If-Match` is reused by 002 for note conflict detection.
- **Alternatives**: GraphQL (not REST, constitution says REST); offset pagination everywhere
  (unneeded at this scale).

## R13. Testing strategy *(project-wide)*

- **Decision**: Backend: `pytest` + FastAPI `TestClient` (`httpx`). **Contract tests** per endpoint
  (status codes, schemas validated against the generated OpenAPI, auth/ownership enforcement);
  **unit tests** for recurrence expansion (incl. DST, interval, count, semester-end changes,
  exceptions, splits) and safe-name rules; **integration tests** against a real temp SQLite file +
  temp storage root (recurring class creation → sessions + folders; Constitution VI). Frontend:
  Vitest + Testing Library (+ `vitest-axe`) for components; Playwright + `@axe-core/playwright` for
  keyboard-only E2E flows and AA checks in light and dark. Lint/type: Ruff + mypy (backend),
  ESLint + `tsc --noEmit` (frontend).
- **Rationale**: Constitution VI requires endpoint tests and integration tests for recurring class
  creation; FR-027/SC-006 require keyboard and contrast verification.
- **Alternatives**: Cypress (Playwright has better multi-browser + axe integration).

## R14. Packaging & runtime *(project-wide)*

- **Decision**: `uv` for Python env/deps; `pnpm` + Node 22 LTS for the frontend build only. In
  development, Vite dev server proxies `/api` to Uvicorn. In production, `vite build` output is
  served by FastAPI as static files (SPA fallback), so the app runs as one process with one SQLite
  file and one data folder. Config via environment variables (`UNIHELPER_DATA_DIR`,
  `UNIHELPER_SECURE_COOKIES`, `UNIHELPER_HOST/PORT`).
- **Rationale**: No extra infrastructure (Constitution VII); data folder is easy to back up.
- **Alternatives**: Docker-only deployment (optional later, not required); separate static server.

## R15. Background work (forward-looking, not built in 001)

- **Decision**: Long-running jobs in later features (transcription in 004) will use an in-process
  worker thread polling a `jobs` table in SQLite, with idempotent completion markers.
- **Rationale**: Survives restarts via DB state, no Celery/Redis (Constitution VII).
- **Alternatives**: Celery/RQ (extra broker infrastructure).
