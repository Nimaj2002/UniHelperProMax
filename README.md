# UniHelperProMax

Class schedules, per-class Markdown notes, lecture recordings, and transcription for university
students. Feature 001 (this release) covers accounts, the calendar, and courses; notes,
recordings, transcription, and themes follow in features 002–005 (see `specs/`).

- Python/FastAPI backend with a versioned JSON API (`/api/v1`) over SQLite
- React + shadcn/ui frontend, light and dark themes, fully keyboard operable
- Your files stay yours: a plain, human-readable folder tree on disk

## Requirements

- Python 3.12+ and [`uv`](https://docs.astral.sh/uv/)
- Node.js 22 LTS with `pnpm` (`corepack pnpm …` works without a global install) — only needed to
  build the frontend, not at runtime

## Setup

```bash
cd backend && uv sync
cd ../frontend && corepack pnpm install
```

> **WSL tip:** on `/mnt/c` drives, reading `node_modules` is slow. A local, git-ignored
> `frontend/pnpm-workspace.yaml` with `virtualStoreDir: /home/<you>/.cache/unihelper/pnpm-virtual-store`
> keeps the package store on the Linux filesystem and makes tests and type-checks ~50× faster.

## Run

Development (two terminals):

```bash
cd backend && UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --reload --port 8000
cd frontend && corepack pnpm dev        # http://localhost:5173 (proxies /api to :8000)
```

Production-like, one process:

```bash
cd frontend && corepack pnpm build
cd ../backend && UNIHELPER_DATA_DIR=./data UNIHELPER_STATIC_DIR=../frontend/dist \
  uv run uvicorn unihelper.main:app --port 8000      # http://localhost:8000
```

The first visit asks you to create the **owner** account. The owner can add accounts for other
people (Account menu → Manage accounts); there is no public sign-up.

| Variable | Default | Meaning |
|---|---|---|
| `UNIHELPER_DATA_DIR` | `./data` | SQLite database and the `files/` folder tree |
| `UNIHELPER_STATIC_DIR` | — | Built frontend to serve (production) |
| `UNIHELPER_SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |

The database schema is migrated automatically on startup.

## Your data

```text
data/
├── unihelper.sqlite3            metadata only
└── files/<username>/<Year>/<Semester>/<Course>/<YYYY-MM-DD>/{notes,audios}/
```

Folder names follow the names you type (made safe for Windows/macOS/Linux) and are renamed when
you rename things in the app. Deleting a year, semester, course, class, or account **never**
deletes files. Full rules: [storage layout contract](specs/001-class-schedule-calendar/contracts/storage-layout.md).

Back up by copying the whole data folder while the app is stopped.

## Tests and checks

```bash
cd backend
uv run ruff check . && uv run mypy
uv run pytest                 # unit + contract (every endpoint) + integration
cd ../frontend
corepack pnpm lint && corepack pnpm typecheck
corepack pnpm test            # Vitest + Testing Library + axe
corepack pnpm exec playwright install chromium   # once
corepack pnpm e2e             # keyboard-only flows in light and dark, axe WCAG AA
```

A full backend run also fails if any operation in the API contract is never exercised
successfully by a test.

## Operator tasks

Forgotten owner password (run on the server, never exposed over the API):

```bash
cd backend && UNIHELPER_DATA_DIR=./data uv run unihelper reset-owner-password
```

The owner must choose a new password at the next sign-in.

## Project docs

- Constitution: [.specify/memory/constitution.md](.specify/memory/constitution.md)
- Feature 001: [spec](specs/001-class-schedule-calendar/spec.md) ·
  [plan](specs/001-class-schedule-calendar/plan.md) ·
  [quickstart & validation](specs/001-class-schedule-calendar/quickstart.md)
