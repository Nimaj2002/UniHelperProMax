# UniHelperProMax

Class schedules, per-class Markdown notes, lecture recordings, and transcription for university
students. Released: 001 accounts, calendar and courses; 002 course timelines and the session
notes workspace; 003 session audio recording and playback; 004 transcription into notes; 005
settings (transcription providers, light/dark/custom themes). Specs and plans are in `specs/`.

- Python/FastAPI backend with a versioned JSON API (`/api/v1`) over SQLite
- React + shadcn/ui frontend, light, dark and your own themes, fully keyboard operable
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

**Run the backend as one process.** Note saves and transcript appends are serialized by a lock
inside the server process, so a second process could overwrite a transcript. Don't pass
`--workers` (or pass `--workers 1`), and don't start two servers on the same `UNIHELPER_DATA_DIR`:
the server holds `<data>/server.lock`, and a second process refuses to start ("Another UniHelper
server process is already using …").

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

A transcript is only ever **added at the end** of the note you choose, under a heading such as
`## Transcript — Recording 10:02 · 2026-10-05 10:02 · 1h 24m`; nothing already in the note is
changed. If the note is open, the text appears there without reloading and your typing is kept.

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

## Transcription

Each finished recording has a **Transcribe** button: choose a note of the session (or name a new
one) and the spoken language. The job runs on the server, so you can keep working, change pages
or close the browser; one transcription runs at a time per user, with progress, Cancel and Retry.
Long WebM recordings are split automatically for providers with a file-size limit.

Providers speak the OpenAI audio transcription API (`POST <address>/v1/audio/transcriptions`).
Choose one in **Settings → Transcription** (gear icon in the top bar, or the account menu):
**Voice Studio** needs only its server address; **OpenAI-compatible** needs an address, an API
key and a model. Use **Test connection** to check them. The key stays on the server: after
saving you only ever see its last 4 characters. An API key is only sent over plain `http://` to
this computer or your local network; public addresses need `https://`.

For trying transcription without a real provider, run the predictable fake transcriber
(`cd backend && uv run uvicorn tests.fake_transcriber:app --port 8020`) and use
`http://localhost:8020` as the Voice Studio address.

## Themes

**Settings → Appearance** offers Light, Dark, Match system and your own themes. A new theme
starts from Light, Dark or another theme of yours; set 4 key colours (background, surface, text,
accent) and the rest is worked out, or switch on **Advanced** to set every colour. The editor
shows a live preview and flags colour pairs that don't meet WCAG AA (you can still save; the theme
is then marked "Low contrast"). Themes can be exported to a `.uhtheme.json` file and imported
again, e.g. to share them. Your choice is saved to your account and used on every device.

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
# dev servers already on 8000/5173/8020? E2E_BACKEND_PORT=8010 E2E_FRONTEND_PORT=5183 E2E_TRANSCRIBER_PORT=8021 corepack pnpm e2e
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
- Known issues (not yet fixed): [specs/KNOWN-ISSUES.md](specs/KNOWN-ISSUES.md)
- Feature 001: [spec](specs/001-class-schedule-calendar/spec.md) ·
  [plan](specs/001-class-schedule-calendar/plan.md) ·
  [quickstart & validation](specs/001-class-schedule-calendar/quickstart.md)
