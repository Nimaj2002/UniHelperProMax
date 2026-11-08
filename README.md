<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="icons/svg/lockup-dark.svg">
  <img src="icons/svg/lockup.svg" alt="UniHelperProMax" width="440">
</picture>

### Your whole semester in one calm place.

**Record the lecture, get the transcript in your notes, then learn it with an AI tutor that
makes you think.** Plus your timetable, notes, slides, AI chat and tasks, organised by class and
stored as plain files you own.

🌐 **[unihelperpromax.tech](https://unihelperpromax.tech)**

[![Latest release](https://img.shields.io/github/v/release/Nimaj2002/UniHelperProMax?color=7A3DB8&label=download)](https://github.com/Nimaj2002/UniHelperProMax/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-7A3DB8)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Nimaj2002/UniHelperProMax?style=flat&logo=github&color=C49BFF)](https://github.com/Nimaj2002/UniHelperProMax/stargazers)
![Desktop app](https://img.shields.io/badge/desktop-Windows_·_macOS_·_Linux-C49BFF)
![Self-hosted](https://img.shields.io/badge/self--hosted-your_data_stays_yours-7A3DB8)
![AI](https://img.shields.io/badge/AI-bring_your_own_model-C49BFF)
![Accessible](https://img.shields.io/badge/WCAG-AA-2E7D32)
<br>
![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

**[Features](#why-youll-love-it)** ·
**[Transcription](#transcription)** ·
**[AI Teacher](#ai-teacher)** ·
**[Tour](#a-quick-tour)** ·
**[Download](#desktop-app)** ·
**[Self-host](#self-host-it)** ·
**[AI chat](#ai-chat)** ·
**[Your data](#your-data)** ·
**[License](#license)**

<img src="docs/screenshots/workspace-split.png" alt="Lecture notes next to the lecture slides in split view, with the recording and an AI chat in the side panel" width="100%">

<sub>Lecture 9: notes on the left, the professor's slides in the middle, the recording and an AI chat on the side.</sub>

</div>

---

## Contents

<table>
<tr>
<td valign="top" width="33%">

**Start here**
- [Why you'll love it](#why-youll-love-it)
- [A quick tour](#a-quick-tour)
- [Get started in 3 minutes](#get-started-in-3-minutes)
- [Desktop app](#desktop-app)
- [Self-host it](#self-host-it)
- [Development mode](#development-mode)
- [Configuration](#configuration)

</td>
<td valign="top" width="33%">

**Using the app**
- [Transcription](#transcription)
- [AI Teacher](#ai-teacher)
- [Events and the calendar](#events-and-creating-entries-on-the-calendar)
- [Tasks and the home page](#tasks-and-the-home-page)
- [Calendar import and export](#importing-and-exporting-the-calendar-ics)
- [Importing audio and notes](#importing-audio-and-notes)
- [Documents and the PDF reader](#documents-and-the-pdf-reader)
- [AI chat](#ai-chat)
- [Themes](#themes)

</td>
<td valign="top" width="33%">

**Reference**
- [Your data](#your-data)
- [Key protection](#key-protection)
- [Backup and restore](#backing-up-and-restoring-your-data)
- [Keyboard shortcuts](#notes-workspace-shortcuts)
- [Tests and checks](#tests-and-checks)
- [Operator tasks](#operator-tasks)
- [Project docs](#project-docs)
- [Website](#website)
- [Topics](#topics)
- [License](#license)

</td>
</tr>
</table>

## Why you'll love it

Most students keep their schedule in one app, notes in another, slides in a downloads folder and
recordings on their phone. When the exam comes, nothing is where you need it.

UniHelperProMax gives every class session its own space. Open Monday's Data Structures lecture and
its notes, slides, recording and transcript are already there. Two clicks from the calendar. And
every assignment, reading and exam you have to prepare for sits on a task board right next to it.

Two things it does best:

- 🎙️ **Never miss what the professor said.** Record the lecture (it keeps going if the tab closes or the Wi-Fi drops), then transcribe it straight into your note. The transcript is added to the end and nothing you wrote changes.
- 🎓 **An AI tutor that makes you think.** The AI Teacher checks what you already know, then teaches one step at a time with a graded question after each step, so you understand it instead of copying an answer.

And everything around them:

- 🗓️ **A calendar built for university.** Weekly classes, exams, office hours and seminars, with years and semesters.
- 📝 **Notes that belong to a class.** A Markdown editor with tables, code blocks, checklists, Mermaid diagrams and LaTeX math.
- 📑 **Slides next to your notes.** A built-in PDF reader with highlights, drawings and comments, in split view.
- 🤖 **Ask AI about the lecture.** Chat with OpenAI, Anthropic, Gemini or a local model (Ollama, LM Studio) and attach your notes, slides, pictures and recordings.
- 🕸️ **See how ideas connect.** Everything the tutor teaches grows into a knowledge graph on your home page.
- ✅ **A task board next to your calendar.** Assignments, readings and exam prep on a board or a list, with checklists, quick notes and due dates you can show on the calendar.
- 🎨 **Make it yours.** 18 built-in themes (Catppuccin, Dracula, Tokyo Night, Nord…) or design your own.
- 🔒 **Your files stay yours.** Everything is a normal folder of `.md`, `.pdf` and audio files on your own disk.
- 💾 **Your whole semester in one zip.** Back up everything in one click and restore it on any computer.
- 💻 **A real desktop app.** Installers for Windows, macOS and Linux: no Python, no Node, no login, and it works offline. Or self-host it for a group.
- 🆓 **Free and open source.** Self-host it for yourself or your friends. No account with us, no tracking.

## A quick tour

### 🎙️ Record now, read later

Hit **Record** during the lecture or upload an audio file you already have. The recording is saved
in small pieces as it goes, so it survives a closed tab or a dropped Wi-Fi.
Afterwards click **Transcribe**, choose a note (or name a new one) and the spoken language, and
the transcript is added to the end of that note. Nothing you wrote ever changes.

- **Keep working while it runs.** Transcription happens on the server with progress, Cancel and
  Retry, so you can switch pages or close the laptop and come back later.
- **Long lectures just work.** Recordings are split automatically for providers with a file-size
  limit.
- **Your choice of speech engine.** Any OpenAI-compatible speech API, including one you host
  yourself (Voice Studio needs only its address). ([More](#transcription))

<img src="docs/screenshots/transcribe.png" alt="Transcribe dialog: choose the note and the spoken language" width="100%">

### 🎓 An AI tutor that makes you think

Ask "why is searching a BST O(h) and not O(log n)?" and the **AI Teacher** doesn't just hand you
the answer. It first asks what you already know, plans the shortest path to the goal, then
teaches one reasoning step at a time and checks each step with a question. You answer, say how
sure you are, and it fixes a gap before building on it. Switch to **Practice** for fresh problems
with hints. ([More](#ai-teacher))

The teaching method is inspired by [LearnHarness](https://github.com/amosblomqvist/learnharness).

<img src="docs/screenshots/teacher.png" alt="AI Teacher lesson in three columns: your questions, the teacher's explanation, and the current question with an answer box and a How sure are you slider" width="100%">

### 🕸️ See how your ideas connect

Every idea the tutor teaches you lands in one **knowledge graph**, shown beside your calendar on
the home page. Search it, see what each idea follows from and leads to, and jump back to the
lesson where you learned it. New lessons in the same course start from what you've already
covered.

<img src="docs/screenshots/knowledge-graph.png" alt="Week calendar with the knowledge graph of taught ideas open in the right panel" width="100%">

### 🗓️ See your whole week at a glance

Every course gets its own colour, a red line marks the current time, and exams or events stand out
with their own marker. Switch between day, week and month, or import your existing timetable from
Google Calendar, Apple Calendar or Outlook (`.ics`).

<img src="docs/screenshots/calendar-week.png" alt="Week view with colour-coded classes and events next to the task board" width="100%">

### ⚡ Draw a study session straight onto the calendar

Press and drag on an empty slot. A small form opens with the semester already filled in. Pick
**Class** or **Event**, give it a name and save. Made a mistake? Click **Undo**.

<img src="docs/screenshots/quick-create.png" alt="Dragging on the calendar opens a quick New entry form" width="100%">

### ✅ Every deadline on one board

The home page shows your calendar and your tasks side by side. Add "Problem set 3, due Friday
23:59, Linear Algebra" and drag it from **To do** to **In progress** to **Done**, or switch to a
list grouped into Overdue, Today, This week and Later. Each task can have a checklist, a
description and quick notes. Turn an exam or a seminar into a task with **Add to kanban**, and
switch on **Show tasks** to see due dates on the calendar. A task never needs a date, a course or
a place on the calendar.

<img src="docs/screenshots/kanban.png" alt="Task board with To do, In progress and Done columns, course labels, due dates and checklist progress" width="100%">

### 📝 Notes that look as good as they read

A live Markdown editor with headings, tables, syntax-highlighted code, to-do lists, LaTeX math and
Mermaid diagrams. Each note is
a plain `.md` file in that class's folder, so you can also open it in VS Code, Obsidian or any
other editor.

<img src="docs/screenshots/notes.png" alt="Markdown note with LaTeX math, a Mermaid diagram, a table and a code block" width="100%">

### 🤖 Ask the AI, with the lecture in hand

Every class session has its own chat. Attach today's notes, the slides, a photo of the whiteboard
or the recording, and ask "explain slide 14 again" or "make me 10 exam questions from this". Use
your own key for OpenAI, Anthropic or Gemini, or run a model on your own computer with Ollama or
LM Studio. Each chat is saved next to your notes as a readable `.md` file.

<img src="docs/screenshots/ai-chat.png" alt="AI chat opened as a tab beside the lecture slides, with the note and PDF attached and a formatted answer with code" width="100%">

### 🎨 Light, dark, or something with more personality

Pick from 18 built-in themes, or make your own from four colours. The editor flags any colour pair
that's hard to read. Your theme follows you to every device.

<img src="docs/screenshots/themes.png" alt="The app in Catppuccin Mocha, Rosé Pine Dawn and Tokyo Night" width="100%">

<details>
<summary>See all built-in themes</summary>
<br>
<img src="docs/screenshots/appearance.png" alt="Appearance settings with all built-in themes" width="100%">
</details>

### ⌨️ And a lot of small things

- **Works with only a keyboard**: every screen, including the calendar, PDF reader and audio player ([shortcuts](#notes-workspace-shortcuts)).
- **Split view**: slides on one side, notes on the other (`Alt+\`).
- **Close what you don't need**: hide the calendar or the task panel (`Shift+C` / `Shift+T`) and the other one gets the room.
- **Trash with restore**: deleted classes come back with all their notes, recordings and documents.
- **Multiple accounts** on one install for you and your friends, with no public sign-up.
- **Backup and restore** of everything in one zip, with a safety backup made before every restore ([details](#backing-up-and-restoring-your-data)).
- **Calendar export** to `.ics`, which also works as a portable backup of your schedule.
- **Task export** to `.csv`, with checklists and quick notes, ready for any spreadsheet.

---

## Get started in 3 minutes

Two ways to run it:

- **[Desktop app](#desktop-app)**: download an installer, open it, done. One person, one computer, works offline.
- **[Self-host it](#self-host-it)**: run it on your computer or a server with one script or Docker, and open it in a browser. Accounts for you and your friends.

### Desktop app

**[⬇ Download the latest release](https://github.com/Nimaj2002/UniHelperProMax/releases/latest)** and pick the file for your system:

| System | File |
|---|---|
| Windows 10 or newer (x64) | `UniHelperProMax-Setup-<version>-x64.exe` |
| macOS 13 or newer (Apple Silicon) | `UniHelperProMax-<version>-arm64.dmg` |
| Linux x64, any distribution | `UniHelperProMax-<version>-x86_64.AppImage` (needs `libfuse2`; `libfuse2t64` on Ubuntu 24.04) |
| Debian / Ubuntu x64 | `unihelperpromax_<version>_amd64.deb` |

Nothing else to install: the app brings its own server. On first start it asks where to keep your
notes (it suggests `Documents/UniHelperProMax`) and then opens straight into the app, with no login.
Everything except the transcription and AI providers you set up works offline.

**Opening it the first time.** This release isn't code-signed, so your system warns you once:

- **Windows** shows "Windows protected your PC" (SmartScreen). Click **More info** → **Run anyway**.
  It means Windows doesn't know the publisher, not that something is wrong with the file. If
  **Smart App Control** is on, Windows may block unsigned programs entirely with no "Run anyway";
  use the [self-hosted](#self-host-it) version instead.
- **macOS**: open the `.dmg`, drag UniHelperProMax to Applications, then open it. If macOS says it
  can't verify the app, open **System Settings → Privacy & Security**, scroll down, click
  **Open Anyway** and confirm. (Or in Terminal:
  `xattr -dr com.apple.quarantine /Applications/UniHelperProMax.app`.)
- **Linux**: for the AppImage, `chmod +x UniHelperProMax-*.AppImage` and run it. For the `.deb`,
  `sudo apt install ./unihelperpromax_*_amd64.deb`, then start it from your app menu.

**Updating.** Download the new version and install it over the old one. Your data and settings
stay, and the database is backed up before an upgrade changes it (the three newest backups are
kept). The app doesn't update itself.

**Settings → Desktop** shows the version, the data folder (open it, move it, or point the app at
another one), the port, and the log folder.

**Port.** The app's server listens on `127.0.0.1:47813`, reachable only from your own computer. If
that port is taken, it tries 47814, 47815, … until it finds a free one, and keeps that one. Change it in Settings → Desktop → Port; the app restarts.
Unfinished recordings and unsaved drafts kept under the old port aren't recovered, so the change
is blocked while there are any.

**Where things are kept:**

| | Windows | macOS | Linux |
|---|---|---|---|
| Your data folder: notes, recordings, documents, chats (default) | `Documents\UniHelperProMax` | `~/Documents/UniHelperProMax` | `~/Documents/UniHelperProMax` |
| Database, upgrade backups and restore safety backup (`backups/`) | `%LOCALAPPDATA%\UniHelperProMax\backend` | `~/Library/Application Support/UniHelperProMax/backend` | `~/.local/share/UniHelperProMax/backend` |
| Window and port settings (`desktop.json`) | `%APPDATA%\UniHelperProMax` | `~/Library/Application Support/UniHelperProMax` | `~/.config/UniHelperProMax` |
| Logs | `%APPDATA%\UniHelperProMax\logs` | `~/Library/Logs/UniHelperProMax` | `~/.config/UniHelperProMax/logs` |

API keys are protected by the system's key store where there is one, otherwise by a key file in a
`keys` folder next to `backend` ([key protection](#key-protection)).

**Uninstalling never deletes your data.** On Windows use Settings → Apps; the uninstaller tells you
where your data stays. On macOS delete the app from Applications; on Linux delete the AppImage or
run `sudo apt remove unihelperpromax`. Installing again picks up the same data. To remove
everything, also delete the folders in the table above.

**Coming from a self-hosted install?** The desktop app starts with its own empty database. Make a
backup in the web version (**Settings → Backup & restore**) and restore it in the desktop app; it
works the other way around too.

### Self-host it

One script installs everything and builds the app; you then open it in your browser.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.sh | bash
cd UniHelperProMax && ./start.sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.ps1 | iex
cd UniHelperProMax; .\start.ps1
```

The installer clones the repo (or uses the checkout it runs from), checks for **Node.js 22 LTS**,
offers to install [`uv`](https://docs.astral.sh/uv/) if it's missing (uv fetches Python 3.12 when
needed), installs the dependencies and builds the app. Run it again any time to update. Options:
`--docker`, `--dir <path>`, `--start`, `--yes` (Windows: `-Docker`, `-Dir`, `-Start`, `-Yes`).

**Docker** (nothing else to install; the image is ~25 MB to download)

```bash
git clone https://github.com/Nimaj2002/UniHelperProMax.git && cd UniHelperProMax
mkdir -p backend/data keys && docker compose up -d --build
```

Your files stay in `backend/data` on your own disk, the same folder `./start.sh` uses. On Linux, put
`UNIHELPER_UID=$(id -u)` and `UNIHELPER_GID=$(id -g)` in a `.env` file if your user id isn't 1000
(`./install.sh --docker` does this for you). The app listens on `127.0.0.1:8000`; see the comments
in [`docker-compose.yml`](docker-compose.yml) to change the port or open it to your network.

**Manual install.** You need **Python 3.12+** with [`uv`](https://docs.astral.sh/uv/) and
**Node.js 22 LTS** (only to build the frontend once).

```bash
# 1. Get the code
git clone https://github.com/Nimaj2002/UniHelperProMax.git
cd UniHelperProMax

# 2. Install dependencies
cd backend && uv sync
cd ../frontend && corepack pnpm install

# 3. Build the app and start it
corepack pnpm build
cd ../backend && UNIHELPER_DATA_DIR=./data UNIHELPER_STATIC_DIR=../frontend/dist \
  uv run uvicorn unihelper.main:app --port 8000
```

Open **http://localhost:8000**, create your account, and add your first class. 🎉

The first visit asks you to create the **owner** account. The owner can add accounts for other
people (Account menu → Manage accounts).

> **WSL tip:** on `/mnt/c` drives, reading `node_modules` is slow. A local, git-ignored
> `frontend/pnpm-workspace.yaml` with `virtualStoreDir: /home/<you>/.cache/unihelper/pnpm-virtual-store`
> keeps the package store on the Linux filesystem and makes tests and type-checks ~50× faster.

### Development mode

Two terminals, with hot reload:

```bash
cd backend && UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --reload --port 8000
cd frontend && corepack pnpm dev        # http://localhost:5173 (proxies /api to :8000)
```

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `UNIHELPER_DATA_DIR` | `./data` | SQLite database and the `files/` folder tree |
| `UNIHELPER_STATIC_DIR` | — | Built frontend to serve (production) |
| `UNIHELPER_SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |
| `UNIHELPER_KEY_STORE` | `auto` | Where the key that encrypts saved API keys lives: `auto` (the OS key store when one works, else a file), `keyring` or `file` |
| `UNIHELPER_KEY_FILE` | per-user config folder | The key file when there is no OS key store; must be outside `UNIHELPER_DATA_DIR` |

The database schema is migrated automatically on startup.

**Run the backend as one process.** Note saves and transcript appends are serialized by a lock
inside the server process, so a second process could overwrite a transcript. Don't pass
`--workers` (or pass `--workers 1`), and don't start two servers on the same `UNIHELPER_DATA_DIR`:
the server holds `<data>/server.lock`, and a second process refuses to start ("Another UniHelper
server process is already using …").

### Under the hood

- Python/FastAPI backend with a versioned JSON API (`/api/v1`) over SQLite
- React + shadcn/ui frontend, fully keyboard operable, tested against WCAG AA in light and dark
- Built spec-first: every feature has a spec, plan and task list in [`specs/`](specs/)

---

## Your data

```text
data/
├── unihelper.sqlite3            metadata only
└── files/<username>/<Year>/<Semester>/
    ├── <Course>/<YYYY-MM-DD>/{notes,audios,documents,chats}/
    └── _Events/<YYYY-MM-DD Title>/{notes,audios,documents,chats}/
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

Tasks, board columns, checklists and quick notes are kept in the database, not as files; use
**Settings → Import and export → Export tasks** for a `.csv` copy.

To back up, use **Settings → Backup & restore** (below), or copy the whole data folder while the
app is stopped.

### Key protection

API keys (for transcription and AI chat) are never stored in plain text: they are encrypted
(AES-256-GCM) with a key that is **not** in the data folder, so a copy of the data folder or a
backup alone reveals no key. That encryption key is kept in your operating system's key store
(Windows Credential Manager, macOS Keychain, or the Secret Service/KWallet on Linux; macOS may ask
once to allow access). Where there is none — WSL, a headless Linux server, Docker — it is a file
only your user can read, in your user config folder (Docker: `./keys`); **Settings** then says so,
because anyone who can sign in as you can read that file.

If the key store is lost or you restore the data folder on another computer, saved keys can't be
read: Settings says so, and **Start a new key store** lets you enter them again. Nothing else is
affected. To move keys along, back up the key file (or `./keys` with Docker) separately.

## Backing up and restoring your data

**Settings → Backup & restore** puts everything you have in the app into one zip file, and puts it
back from one.

- **Create backup** downloads `UniHelperProMax-backup-<date>-<time>.zip` (the desktop app asks
  where to save it). It holds your classes, events, tasks, settings, themes and every file in your
  folder — notes, recordings, documents, annotations, chats and their attachments, and files you
  added there yourself — in the usual folder layout under `files/`, so you can open it with any
  archive tool. The rest is in `data/` (one JSON object per line) and `manifest.json` (versions,
  counts and a checksum of every file). You can keep working while it's made; a recording in
  progress isn't included. **API keys are never in a backup**: enter them again after a restore.
- **Restore from backup**: choose a backup and the app checks it first (not damaged or changed,
  safe file names, not from a newer version) and shows what it holds next to what you have now.
  Restoring **replaces all your data** — files you have now that aren't in the backup are
  removed. Before anything changes, a **safety backup** of your current data is made (only the
  newest one is kept: its path in the desktop app, a download link on the web); restore it to undo.
  A restore can't start while you're recording, audio is still uploading, notes are unsaved, or a
  transcription or AI answer is running. It is all or nothing: if it fails or the app stops
  midway, your data is exactly as before (or, if it had finished, as in the backup). Other open
  tabs and windows reload by themselves.
- Backups from older versions are upgraded when restored; a backup from a newer version asks you
  to update the app first. On a shared web server a backup covers only your own account, and
  restoring never touches anyone else's data.
- **Self-hosting behind a proxy?** A backup can be large (recordings): allow uploads of up to
  20 GB on the restore endpoint, e.g. nginx `client_max_body_size 20g;`.

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

## Tasks and the home page

The home page holds three cards side by side: the left card, the **Calendar** panel and the
**Tasks** panel (about 420 px wide; drag the divider or use the arrow keys on it, between 320 px
and 60 % of the window). Close either panel with its close button or `Shift+C` / `Shift+T`; it
leaves a narrow rail, and the Tasks rail shows how many tasks are open and how many are overdue.
One of the two always stays open. On a narrow window opening one panel closes the other.

- **Board**: a new board starts with **To do**, **In progress** and **Done**. Add, rename, reorder
  and delete columns (at most 12, names up to 40 characters and unique); mark any column as
  **Counts as done**. Deleting a column with tasks asks where they go. Drag cards between and
  within columns, or use the keyboard: focus a card, `Enter`/`Space` to pick it up, arrow keys to
  move, `Enter` to drop and `Escape` to cancel.
- **List**: the same tasks grouped as Overdue, Today, This week, Later, No date and Done
  (collapsed). Search and filter by course (or "Personal"), event-linked only and show/hide Done;
  the view and filters are remembered in this browser.
- **Details**: click a card (or `Enter` on its title) to edit title, description, column, due date
  and time, course and a checklist. Changes save on their own, with "Saving…", "Saved" or
  "Couldn't save — Retry" in the header. Deleting a task, a checklist item, a quick note or an empty
  column can be undone for 10 seconds.
- **Quick notes**: the note button on a card opens small title-and-text notes for that task,
  without leaving the board.
- **Events on the board**: the event form and the calendar's quick form have an **Add to kanban**
  switch (for a repeating event, only the first occurrence is added; add others from their
  details). A linked task takes its title and due time from the event and follows it when the event
  moves; **Open note** on the card opens the event's workspace. Deleting the event asks whether to
  keep the task or delete it with the event; a task deleted with its event comes back when you
  restore the event from the Trash.
- **On the calendar**: the **Show tasks** switch in the calendar header puts tasks with a due date
  on the day, week and month views. Tick one there to move it to Done, untick to put it back. Tasks
  never cover or shrink your classes and events.
- **Courses**: a course page lists its open tasks with a quick add. Deleting a course keeps its
  tasks as personal tasks.
- **Export**: **Settings → Import and export → Export tasks** saves a `.csv` with every task, its
  column, dates, course, linked event, checklist and quick notes.

## Importing and exporting the calendar (.ics)

**Settings → Import and export** works with iCalendar files, so a timetable can come from (or go
to) Google Calendar, Apple Calendar or Outlook. Only the schedule moves: notes, recordings,
documents and annotations are never imported or exported.

- **Import calendar (.ics)**: choose or drop a file (up to 5 MB and 5,000 events). Nothing changes
  until you confirm. The preview groups entries by title; repeating groups are selected and set
  to **Class**, one-time groups are not selected and set to **Event** — change either per group.
  Classes go to a course of the destination semester with the same name (case and spaces ignored)
  or to a new course with its own palette colour. Repeating entries without an end get one you
  can change (16 weeks after the first by default). Times are converted to your time zone and keep
  their local time across daylight saving; if the file's zone changes at other dates than yours,
  the series is split where its local time changes, and the preview says so.
- **Not imported, always with a reason**: all-day and multi-day events ("all-day events are not
  supported yet"), events cancelled in the file, and — after you choose "first occurrence only"
  or "Skip" — repetitions the app can't represent (daily, monthly, yearly, numbered weekdays).
  Reminders, attendees and descriptions are ignored; web links in the description, the event's
  URL, the Google Meet link and attachment links are kept. Only `http(s)` links are stored.
- **Importing again** (the same file or a newer export of the same calendar) updates what an
  earlier import made instead of duplicating it. A session that already has notes, recordings or
  documents is never moved: it stays as it is and is listed as skipped. Entries missing from the
  newer file are left alone; one that is in the Trash is not recreated.
- **Undo import** on the result screen removes the classes, events and courses that import created
  and nobody has added notes, recordings or documents to since. Updates are not reverted.
- **Export calendar (.ics)**: everything or one semester as `UniHelperProMax-…-<date>.ics`. Weekly
  classes are one repeating event, single changes are changed occurrences and cancelled sessions
  are excluded dates. Extra `X-UNIHELPER-*` fields (ignored by other apps) let a file exported here
  restore type, year, semester, course and colour when imported here — a portable backup.

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

These are the default keys. You can change any shortcut listed in **Settings → Keyboard shortcuts**
(a main and an alternate key per command, reset one or all, or remove one); your keys follow your
account to every device and are part of your backups.

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

## AI chat

Every class session and event has an AI chat in the right panel, below the recordings: ask about
the lecture, attach notes (of this session or any other), PDFs, pictures and audio, choose the
model, and keep a separate history of chats per session. **Expand** moves a chat into a tab (it
can sit beside a note or PDF); **Dock** brings it back. Answers stream in and keep going when you
close the panel, switch tabs or reload; **Stop** (or Escape) ends one at once.
Shortcuts: **Alt+K** focuses the message box (opening the panel, or the chat's tab), **Alt+Shift+K**
starts a new chat, and **Alt+]** shows or hides the session panel.

No AI service, key or address ships with the app. Add your own in **Settings → AI**, in one of
three request styles — enter the base URL as the provider documents it, the app adds the path:

| Style | Example base URL |
|---|---|
| OpenAI-compatible (OpenAI, Ollama, LM Studio, llama.cpp, vLLM…) | `https://api.openai.com/v1`, `http://localhost:11434/v1` |
| Anthropic | `https://api.anthropic.com` |
| Google Gemini | `https://generativelanguage.googleapis.com` |

Addresses on this computer or your local network are **Local** and may use plain `http://`;
everything else is **Remote**, must use `https://`, and asks once before messages and
attachments are sent there. **Test connection** and **Refresh** (the model list) never change
what is saved; local servers without a model list take the model ID you type. Keys are kept
encrypted (see [Key protection](#key-protection)) and only their last 4 characters are shown.
The assistant has no tools: it never changes your notes, files, tasks or settings.

Each chat is a readable pair of files in the session's `chats/` folder: `<date time title>.json`
(what the app reads) and `<date time title>.md` (a transcript for reading anywhere), with sent
pictures, PDFs and audio and note snapshots in `<date time title>.files/`. Deleting a chat can be
undone for a while; deleting a session or event (or its course or semester) names its chats in
the confirmation and moves them to the Trash with it.

For trying chat without a provider, run the scripted fake
(`cd backend && uv run uvicorn tests.fake_llm:app --port 8021`) and add
`http://localhost:8021/v1` with the model `echo` (or `slow`).

## AI Teacher

Every class session and event has an **AI Teacher** section in the right panel, next to
Recordings and Chat. **New chat** opens a lesson tab with three columns: **Questions** (every
question asked so far, with filters All, Unanswered and Incorrect), **Teacher** (the conversation
and the message box) and **Current question** (the answer card). The teacher uses the same AI
endpoints and models as [AI chat](#ai-chat); set one up in **Settings → AI** first.

How a lesson goes:

1. **Probe.** Tell it what you want to understand. It asks a few questions to find what you
   already know and to make the goal concrete.
2. **Plan.** It draws the shortest path of ideas to the goal. Open it any time with **Plan**;
   the current step is marked.
3. **Teach and check.** One reasoning step at a time, often with a Mermaid diagram, each ending
   in a multiple-choice or free-text question.
4. **Answer.** Give your answer (or tick **I don't know**), set **How sure are you?** (0–100 %)
   and optionally write your thinking. A wrong or unsure answer gets repaired before the lesson
   moves on.

A graded question shows Correct, Partly correct or Incorrect. If you think a grade is wrong, use
**Dispute grade**: the teacher re-grades it and both grades are kept. A **Practice** chat poses
varied problems without naming the ideas they need, with a **Hint** button, and shows the model
solution only after you try.

**Knowledge graph.** Ideas taught in a lesson are added to your knowledge graph when the lesson
has been quiet for 5 minutes, when you close its tab, or when you press **Update graph**. Ideas
that mean the same thing are merged. Open it from the home page's right panel (the **Knowledge
graph** switch next to Tasks and the timer). Pan, zoom, search, or use the list view, and click a
source to open the lesson at that message. A new lesson starts from up to 30 ideas you've already
covered in the same course; change that set any time from the lesson tab. The graph records what
was taught, not what you mastered, so the teacher still checks.

The teacher's instructions are visible, read-only, in **Settings → AI**. Like the AI chat, it has
no tools: it never changes your notes, files, tasks or settings. Each teacher chat is saved in
the session's `chats/` folder as a source file and a readable `.md` transcript, alongside AI
chats; deleting a chat removes the ideas that came only from it (the confirmation says how
many).

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

<details>
<summary>Run the linters, type checks, unit, contract and end-to-end tests</summary>
<br>

```bash
cd backend
uv run ruff check . && uv run mypy
uv run pytest                 # unit + contract (every endpoint) + integration
UNIHELPER_SLOW_TESTS=1 uv run pytest tests/integration/test_backup_performance.py  # 1 GB backup + restore
cd ../frontend
corepack pnpm lint && corepack pnpm typecheck
corepack pnpm test            # Vitest + Testing Library + axe
corepack pnpm exec playwright install chromium   # once
corepack pnpm e2e             # keyboard-only flows in light and dark, axe WCAG AA
# dev servers already on 8000/5173/8020? E2E_BACKEND_PORT=8010 E2E_FRONTEND_PORT=5183 E2E_TRANSCRIBER_PORT=8021 corepack pnpm e2e
```

A full backend run also fails if any operation in the API contract is never exercised
successfully by a test.

</details>

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
- Task manager (Feature 012): [spec](specs/012-task-manager/spec.md) ·
  [plan](specs/012-task-manager/plan.md) ·
  [quickstart & validation](specs/012-task-manager/quickstart.md)
- Desktop app (Feature 015): [spec](specs/015-desktop-app-packaging/spec.md) ·
  [plan](specs/015-desktop-app-packaging/plan.md) ·
  [quickstart & validation](specs/015-desktop-app-packaging/quickstart.md) ·
  building and releasing: [desktop/README.md](desktop/README.md)
- Backup and restore (Feature 016): [spec](specs/016-data-backup-restore/spec.md) ·
  [plan](specs/016-data-backup-restore/plan.md)
- AI Teacher (Feature 022): [spec](specs/022-ai-teacher/spec.md) ·
  [plan](specs/022-ai-teacher/plan.md) ·
  [quickstart & validation](specs/022-ai-teacher/quickstart.md)

## Website

Live at **[unihelperpromax.tech](https://unihelperpromax.tech)**. The project website in [`website/`](website/) tells the story of **Yuii**, our mascot: a
student whose semester was a mess until she found UniHelperProMax. It's a static page built with
[Vite](https://vite.dev), [`amber-scroll`](https://www.npmjs.com/package/amber-scroll) (smooth
scrolling, one chapter per mouse-wheel spin) and
[`amber-motion`](https://www.npmjs.com/package/amber-motion) (animations). Its look follows
[`website/design/DESIGN.md`](website/design/DESIGN.md), in Yuii's pink.

```bash
cd website
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in website/dist/, deploy that folder
```

Yuii's original artwork is in [`Yuii/`](Yuii/); the site uses trimmed WebP copies in
`website/assets/yuii/`.

## Contributing

Bug reports, ideas and pull requests are welcome. Check the
[known issues](specs/KNOWN-ISSUES.md) first, and open an issue before starting on a big change so
we can agree on the approach. New features follow the spec-first workflow in [`specs/`](specs/).

## Star history

<a href="https://star-history.com/#Nimaj2002/UniHelperProMax&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Nimaj2002/UniHelperProMax&type=Date&theme=dark">
    <img alt="Star history chart" src="https://api.star-history.com/svg?repos=Nimaj2002/UniHelperProMax&type=Date" width="600">
  </picture>
</a>

## Topics

`student` · `university` · `study-tool` · `note-taking` · `markdown` · `calendar` · `timetable` ·
`kanban` · `task-manager` · `pdf-reader` · `pdf-annotation` · `audio-recording` ·
`transcription` · `speech-to-text` · `ai-chat` · `llm` · `openai` · `anthropic` · `gemini` ·
`ollama` · `self-hosted` · `local-first` · `privacy` · `fastapi` · `python` · `react` ·
`typescript` · `tailwindcss` · `sqlite` · `docker` · `accessibility` · `open-source`

## License

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-7A3DB8)](LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial_license-available-C49BFF)](COMMERCIAL-LICENSE.md)

UniHelperProMax is dual-licensed:

- **[AGPL-3.0](LICENSE)**: free to use, modify, and share. If you distribute a
  modified version or run it as a service, you must publish your full source
  code under the AGPL and keep the original copyright notices.
- **[Commercial license](COMMERCIAL-LICENSE.md)**: for selling or hosting a
  modified version without releasing its source, or using the code in a
  closed-source product. Open a "Commercial license inquiry" issue to get one.

Contributors must sign the [Contributor License Agreement](CLA.md). A bot
asks for it automatically on your first pull request.

---

<div align="center">

Made with ❤️ by [Nima](https://github.com/Nimaj2002) for every student who has lost a lecture note the night before an exam.

If UniHelperProMax makes your semester easier, a ⭐ on the repo helps other students find it.

</div>
