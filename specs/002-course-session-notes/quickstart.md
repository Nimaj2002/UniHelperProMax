# Quickstart & Validation: Course Timeline & Session Notes (002)

Setup, run and checks are the same as feature 001 (see `README.md`); this adds scenarios.
Contracts: [openapi.yaml](./contracts/openapi.yaml) · [ui-workspace.md](./contracts/ui-workspace.md) ·
[storage-notes.md](./contracts/storage-notes.md) · data: [data-model.md](./data-model.md)

## Automated checks

```bash
cd backend && uv run ruff check . && uv run mypy && uv run pytest
cd ../frontend && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e
```

## Validation scenarios

| # | Scenario (spec ref) | Steps | Expected |
|---|---|---|---|
| 1 | Course timeline (US2) | Course with Mon/Wed class spanning today → open from course panel | All sessions by month; past normal, upcoming muted + "Upcoming"; scrolled to current/next |
| 2 | Open workspace | Click/Enter a session | Three panels; header shows course, date, time, location; URL is shareable |
| 3 | Notes + autosave (US1) | New note "Lecture notes" (`Alt+N`), type; new note "Homework 3 questions" | Tabs; "Saved" within 2 s; files `…/<date>/notes/Lecture notes.md` and `Homework 3 questions.md` on disk |
| 4 | Reload safety (SC-002) | Type, reload within 1 s | Text restored (server or local draft) and saved |
| 5 | Offline | Stop backend, type, start backend | "Not saved — retrying", then "Saved"; nothing lost |
| 6 | External edit (FR-020) | Edit the `.md` in a text editor while open, then type in the app | Conflict dialog; "Keep both" creates "Lecture notes (my version)"; both files exist |
| 7 | Session switching (US3) | Open 2 tabs, switch session via left timeline, come back | Tabs and active tab restored; < 1 s |
| 8 | Rename / delete (US4) | Rename note; delete another with confirmation | File renamed; deleted file gone from `notes/`; no other files touched |
| 9 | Live/raw (US5) | Type heading, list, task, table, link; `Mod+E` | Formatting in place, raw on cursor line; raw mode shows plain text; mode remembered after reload |
| 10 | Duplicate & invalid names | Create "lecture NOTES" again; name "a/b:c" | Duplicate refused; file `a-b-c.md` |
| 11 | Two sessions same day | Lecture and lab on the same date, note in each | Folders `YYYY-MM-DD` and `YYYY-MM-DD HHmm` |
| 12 | No longer scheduled (FR-006) | Write a note, then delete that session (scope "this") | Timeline still lists it with "No longer scheduled"; note opens |
| 13 | Upcoming → past (FR-027) | Keep a session open across its start time | Styling switches without reload |
| 14 | Keyboard + themes | All of the above keyboard-only, light and dark | Works; axe AA clean |
