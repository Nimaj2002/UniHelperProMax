# Quickstart & Validation: Class Schedule Calendar (001)

How to run the app and prove feature 001 works end-to-end. API details:
[contracts/openapi.yaml](./contracts/openapi.yaml); data rules: [data-model.md](./data-model.md);
folders: [contracts/storage-layout.md](./contracts/storage-layout.md).

## Prerequisites

- Python 3.12+ and [`uv`](https://docs.astral.sh/uv/)
- Node.js 22 LTS and `pnpm` (frontend build/dev only; not needed at runtime)
- A Chromium-based browser (Playwright installs its own for tests)

## Setup

```bash
# backend
cd backend
uv sync                       # creates .venv with app + dev dependencies
uv run alembic upgrade head   # creates data/unihelper.sqlite3

# frontend
cd ../frontend
pnpm install
pnpm gen:api                  # regenerate TS types from the backend OpenAPI
```

## Run (development)

```bash
# terminal 1
cd backend && UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --reload --port 8000
# terminal 2
cd frontend && pnpm dev       # http://localhost:5173, proxies /api → :8000
```

## Run (single process, production-like)

```bash
cd frontend && pnpm build                 # outputs frontend/dist
cd ../backend && UNIHELPER_STATIC_DIR=../frontend/dist uv run uvicorn unihelper.main:app --port 8000
# open http://localhost:8000
```

## Automated checks

```bash
cd backend
uv run ruff check . && uv run mypy src
uv run pytest tests/unit               # recurrence, DST, safe names
uv run pytest tests/contract           # every /api/v1 endpoint (Constitution VI)
uv run pytest tests/integration        # real SQLite + temp storage root

cd ../frontend
pnpm lint && pnpm typecheck
pnpm test                              # Vitest + Testing Library + axe
pnpm e2e                               # Playwright keyboard-only flows, light + dark, axe AA
```

All must pass before merge (constitution quality gates).

## Manual validation scenarios

Use a fresh data dir (`UNIHELPER_DATA_DIR=./data-demo`).

| # | Scenario (spec ref) | Steps | Expected |
|---|---|---|---|
| 1 | Owner setup (US5, FR-003a) | Open the app | Only the "Create owner account" screen is reachable; after creating `student`, the calendar shows week view of today |
| 2 | No public sign-up (US5 #7) | Sign out; look for registration | None exists; `POST /api/v1/setup/owner` now returns 409 |
| 3 | Member account (US5 #6, FR-003c) | As owner: Admin → create `ali`; sign in as `ali` | Forced password change; `ali` sees an empty calendar; owner's admin screen shows no content of `ali` |
| 4 | Recurring class with inline hierarchy (US1 #1–3, FR-014, FR-025) | New class → create year "2026", semester "Fall 2026" (end 2027-01-10), course "CS 201"; Mon+Wed 10:00–11:30, "FENS G032", blue, link; ends at semester end | Sessions on every Mon/Wed through 2027-01-10 and none after; `data-demo/files/student/2026/Fall 2026/CS 201/` exists; course listed in panel |
| 5 | Semester end moves (edge case) | Change semester end to 2026-12-20 | Sessions after 2026-12-20 disappear without editing the class |
| 6 | Validation (US1 #5, edge cases) | End time ≤ start; "until semester ends" on a semester without end date; invalid URL | Save refused with inline messages; entered values kept |
| 7 | Views & navigation (US2, FR-006–010) | Switch D/W/M, ‹ ›, Today; add overlapping class | Correct ranges; overlaps side by side; month shows "+N more" when crowded |
| 8 | Edit scopes (US4, FR-018a) | On one Wednesday: "This session" → room change; next week "This and following" → time 11:00; then "All sessions" → colour green | Only that Wednesday's room differs; earlier weeks keep 10:00, later 11:00; all green; the single-session room change is kept and the UI reports "1 individually changed session kept" |
| 9 | Cancel one session | Delete a Monday with "This session" | Only that Monday disappears |
| 10 | Course search (US3, FR-023) | Type "cs" then "zzz" | Filters live; "zzz" shows empty state + clear |
| 11 | Delete keeps files (FR-019, US4 #7) | Delete course "CS 201" | Confirmation shows impact and kept folder; folder still on disk |
| 12 | Keyboard only (FR-027, SC-006) | Repeat 4, 7, 10 without a mouse | All possible; focus always visible; `?` lists shortcuts |
| 13 | Light/dark (Constitution V) | Toggle OS theme | App follows; text and class colours remain readable (AA) |
| 14 | DST (SC-004) | Set user time zone to `Europe/Berlin`; weekly class across 2026-10-25 | Session stays at 10:00 local on both sides of the change |

## Integration test coverage (Constitution VI critical flow: recurring class creation)

`backend/tests/integration/test_recurring_class_creation.py` must assert, against a temp SQLite file
and temp storage root: inline creation is atomic (a forced failure after the year insert leaves no
rows and no partial state), the expected session dates for weekly/interval/count/until/semester-end
rules, DST-correct `start`/`end`, folders created with safe names, and scope edits preserving
session keys.
