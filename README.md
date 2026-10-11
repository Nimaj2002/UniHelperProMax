# UniHelperProMax

Class schedules, per-class Markdown notes, lecture recordings, and transcription for university
students. Released: 001 accounts, calendar and courses; 002 course timelines and the session
notes workspace; 003 session audio recording and playback; 004 transcription into notes; 005
settings (transcription providers, light/dark/custom themes); 006 imports; 007 documents and the
PDF reader; 008 floating card layout; 009 events, press-and-drag creation and the Trash. Specs
and plans are in `specs/`.

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
└── files/<username>/<Year>/<Semester>/
    ├── <Course>/<YYYY-MM-DD>/{notes,audios,documents}/
    └── _Events/<YYYY-MM-DD Title>/{notes,audios,documents}/
```

Events (seminars, exams, office hours…) belong to a semester, not a course, so their folders live
in the semester's `_Events` folder. No course can be named `_Events`; a course that already has
that folder is flagged in the course list until you rename it.

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
you rename things in the app. Deleting a class or an event — or a year, semester or course, which
deletes the classes and events inside it — moves each of them to **Settings → Trash** and leaves
every file where it is. From the Trash you can **Restore** an entry (it comes back with its notes,
recordings and documents; a deleted year, semester or course is recreated with the same name) or
**Delete** it for good after "Are you sure?", which removes its session or event folder from disk.
Apart from that, the only files the app removes are a note's `.md`, a recording's (or imported
audio's) file, or a document's PDF and its annotations file, when you delete that item and
confirm — and its own upload staging files in `files/.uploads/`. Deleting an account never
deletes files. Full rules: [storage layout contract](specs/001-class-schedule-calendar/contracts/storage-layout.md).

Back up by copying the whole data folder while the app is stopped.

## Events and creating entries on the calendar

- **New event** (calendar toolbar, or `e`): title, year and semester (the open course's, otherwise
  the last one you used), date and times, location, links, colour (blue by default) and repeat.
  Events show on the calendar with a calendar-star marker and "Event:" in their name, never on a
  course timeline. Each semester in the left card has an **Events** page; an event opens the same
  workspace as a class session (notes, recordings, transcription, documents).
- **Press and drag** on an empty part of a day in day or week view to draw a new entry (15-minute
  steps); a click makes a one-hour entry, and a click on an empty day in month view makes 09:00–
  10:00. A small form opens next to it: choose **Class** or **Event**, fill in the required
  fields and Save — or **More options** for the full form. Nothing is stored before Save, and
  **Undo** in the message removes what was just created. Escape cancels; once you've typed
  something, clicks elsewhere keep the form open.
- **Keyboard**: Tab into the time grid, move with the arrow keys, extend with Shift+↑/↓, press
  Enter for the form and Escape to cancel.

## Importing audio and notes

- **Upload audio** (next to Record, or drop files on the audio panel): MP3, M4A, AAC, WAV, OGG,
  Opus, WebM or FLAC, up to 1 GB each. Other types and bigger files are refused before anything is
  sent. The file is stored **unchanged** in the session's `audios/` folder, named after the file
  (`Lecture.mp3`, or `Lecture (2).mp3` if that name is taken — existing items are never renamed or
  replaced). It is listed with an "Imported" label and plays, renames, deletes and transcribes like
  a recording. While uploading, a file is kept in `data/files/.uploads/` (outside your folders) and
  only moved into the session once it has fully arrived and been checked, so a cancelled or failed
  upload leaves nothing behind; leftovers from a server restart are removed on the next start.
- **Import note** (`Alt+Shift+N`): `.md` or `.txt` files up to 5 MB, in UTF-8. Each becomes a new
  note named after the file, with exactly the file's text. If a note with that name exists you
  choose **Rename**, **Replace** (asked to confirm again; refused while that note has unsaved
  changes or a transcript is being added to it) or **Skip**. Imported text is never merged into an
  existing note.

## Documents and the PDF reader

- **Upload PDF** (in the session's "Documents" section, or drop files on it): PDF files up to
  200 MB each. The PDF is stored **unchanged** in the session's `documents/` folder, named after the
  file (`Lecture 5.pdf`, or `Lecture 5 (2).pdf` when the name is taken). Password-protected PDFs
  are kept and listed as "Protected", but can't be opened in the app.
- A document opens as a tab of the workspace's tab bar, next to your notes; the reader has no tabs
  of its own. It remembers your page per document, across devices. Links inside the PDF work;
  web links open in a new browser tab. **Dark pages** shows pages light-on-dark (remembered).
- **Split view** (`Alt+\` or the Split button at the end of the tab bar): two tabs side by side —
  e.g. the slides on the left, your note on the right. Choosing a tab shows it in the focused pane;
  "Show in other pane" is in the tab's menu (right-click or `Shift+F10`). Offered when the main area
  is at least 1100 px wide; nothing is closed when you turn it off.
- **Annotations**: Highlight (select text first), Draw, Text box and Comment, in six named colours;
  move, recolour, delete, undo and redo. They are saved within two seconds and kept on the device
  while you are offline. They live in a plain JSON file next to the PDF —
  `<Name>.annotations.json` ([format](specs/007-session-pdf-reader/contracts/annotation-file.md)) —
  so the PDF itself is never modified. If two windows change the same annotation, both versions are
  kept. Annotations already inside a PDF are shown but can't be edited.

```text
<YYYY-MM-DD>/documents/
├── Lecture 5 — Trees.pdf                 exactly as uploaded
└── Lecture 5 — Trees.annotations.json    your annotations (once there are some)
```

### Reader shortcuts

With focus in the reader:

| Keys | Action |
|---|---|
| `PageDown` / `PageUp` · `Home` / `End` | Next / previous page · first / last page |
| `Ctrl/Cmd +` / `Ctrl/Cmd -` / `Ctrl/Cmd 0` | Zoom in / out / 100 % |
| `Ctrl/Cmd+F` | Search in the document (`Enter` / `Shift+Enter` next / previous, `Esc` closes) |
| `Enter` on the pages (Text or Comment tool) | Add a text box or comment in the middle of the visible page |
| On a selected annotation: arrows (`Shift` ×10) · `Enter` · `C` · `Delete` | Move · edit text · colour · delete |
| `Ctrl/Cmd+Z` · `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` | Undo · redo (annotations) |
| `Esc` | Leave the tool (back to Select); from Select, back to the tab bar |

## Notes workspace shortcuts

| Keys | Action |
|---|---|
| `Alt+N` | New note |
| `Alt+Shift+N` | Import note (`.md` / `.txt`) |
| `Alt+W` / `Delete` on a tab | Close tab |
| `Alt+PageDown` / `Alt+PageUp` | Next / previous tab |
| `Alt+\` | Split view on / off |
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

**Settings → Appearance** offers Light, Dark, Match system, 18 built-in themes based on popular
editor palettes (9 light: GitHub Light, Catppuccin Latte, One Light, Solarized Light, Rosé Pine
Dawn, Nord Light, Gruvbox Light, Tokyo Night Light, Linear; 9 dark: Dracula, Tokyo Night,
Catppuccin Mocha, Nord, Gruvbox Dark, One Dark Pro, Rosé Pine, Night Owl, Midnight Blue) and your
own themes. Built-in themes all meet WCAG AA, so a few palettes use a slightly deeper text or
accent shade than the original. A new theme starts from Light, Dark, a built-in theme or another
theme of yours; set 4 key colours (background, surface, text,
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
