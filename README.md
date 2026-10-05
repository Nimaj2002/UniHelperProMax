# UniHelperProMax

Class schedules, per-class Markdown notes, lecture recordings, and transcription for university
students. Released: 001 accounts, calendar and courses; 002 course timelines and the session
notes workspace; 003 session audio recording and playback. Transcription and themes follow in
features 004–005 (see `specs/`).

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

Each note is a plain Markdown file (`<Note name>.md`) in its session's `notes/` folder; you can
open and edit it in any editor — the app picks up the change and never overwrites it silently.
Session folders are created when a session gets its first note or recording.

Each recording is an audio file (`<Recording name>.webm`, or `.m4a` on Safari) in the session's
`audios/` folder. Audio is saved every few seconds while you record (on the device first, then on
the server), so closing the page or losing the network keeps everything recorded so far; such a
recording is listed as "Recovered (interrupted)".

Folder names follow the names you type (made safe for Windows/macOS/Linux) and are renamed when
you rename things in the app. Deleting a year, semester, course, class, or account **never**
deletes files; the only files the app ever removes are a note's `.md` or a recording's audio
file, when you delete that note or recording and confirm. Full rules: [storage layout contract](specs/001-class-schedule-calendar/contracts/storage-layout.md).

Back up by copying the whole data folder while the app is stopped.

## Notes workspace shortcuts

| Keys | Action |
|---|---|
| `Alt+N` | New note |
| `Alt+W` / `Delete` on a tab | Close tab |
| `Alt+PageDown` / `Alt+PageUp` | Next / previous tab |
| `Alt+[` / `Alt+]` | Collapse/expand the sessions and notes section (under the courses) / show or hide the audio panel |
| `Ctrl/Cmd+E` | Live ↔ raw Markdown |
| `Ctrl/Cmd+Enter` | Open the link under the cursor |
| Arrow keys on a panel edge | Resize the side panel, the sessions and notes section, or the audio panel (`Home`/`End` min/max, `Enter` or double-click resets; you can also drag the edge) |

## Audio player shortcuts

With focus anywhere in the player:

| Keys | Action |
|---|---|
| `Space` / `K` | Play / pause |
| `J` / `←` · `L` / `→` | Back / forward 5 seconds |
| `↑` / `↓` | Volume up / down |
| `M` | Mute / unmute |
| `PageUp` / `PageDown` on the seek bar | Forward / back 60 seconds |

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
# dev servers already on 8000/5173? E2E_BACKEND_PORT=8010 E2E_FRONTEND_PORT=5183 corepack pnpm e2e
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
