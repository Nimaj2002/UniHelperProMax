# Contract: Course Timeline & Session Workspace UI

Extends `specs/001-class-schedule-calendar/contracts/ui-shell.md` (routes compose under the
AppShell; colours only from tokens; taste-skill dials 4/3/6).

## Routes

| Path | Screen |
|---|---|
| `/courses/:courseId` | Course timeline (replaces 001 placeholder) |
| `/courses/:courseId/sessions/:sessionKey` | Session workspace |

Calendar session details gain **Open notes** (via `registerSessionAction`) linking to the
workspace route.

## Course timeline

- Header: course name, year · semester, colour swatch.
- Sessions grouped by month (`<h2>` per month), each a link row: weekday + date, time, class
  title, location, note count, audio indicator. Upcoming rows: muted text tokens (AA) + an
  "Upcoming" badge; "No longer scheduled" rows: a badge with that text.
- On open, scrolls the current/next session to the top third and moves focus to it only if the
  user navigated with the keyboard.
- Empty course: "No sessions yet" + link to New class.

## Workspace layout (desktop ≥ 1024 px)

```text
┌ Workspace header: ← CS 201 · Mon 5 Oct 2026 · 10:00–11:30 · FENS G032          [⇤] [⇥] ┐
├──────────────┬──────────────────────────────────────────────────┬──────────────┤
│ Sessions     │ [Lecture notes ●][Homework 3 ✓][+]   Live|Raw     │ Audio        │
│  Sep         │ ┌──────────────────────────────────────────────┐ │ (feature 003 │
│   28 Mon     │ │ # Trees                                       │ │  placeholder)│
│ ▶  5 Oct     │ │ A **binary tree** has …                       │ │              │
│   …          │ └──────────────────────────────────────────────┘ │              │
│ [New note]   │ Saved · 10:42                                     │              │
│ Notes        │                                                   │              │
│  Lecture …   │                                                   │              │
└──────────────┴──────────────────────────────────────────────────┴──────────────┘
```

- Left (240 px) and right (300 px) panels are collapsible (buttons + `Alt+[` / `Alt+]`); state
  stored in `/preferences`. Below 1024 px both become `Sheet` drawers and the editor is full width.
- Tabs: `role="tablist"` containing only `role="tab"` elements (ARIA allows nothing else inside),
  one per open note, `aria-selected`, roving focus with ←/→/Home/End, horizontal scroll when
  crowded, full name in `title`. Closing: `Delete` on the focused tab or `Alt+W`; a pointer-only
  “×” icon inside the tab (not a separate focusable control).
- Each tab shows its save state as text + icon (never colour alone): "Saving…", "Saved",
  "Not saved — retrying", "Conflict".
- Note list: buttons in creation order; open notes marked "(open)"; each with a menu: Rename…,
  Delete….
- Right panel: `registerWorkspacePanel({ id, component })` slot; default placeholder text:
  "Recordings arrive in the next update."

## Editor

- CodeMirror 6, theme built from tokens (`--surface`, `--text-primary`, `--text-muted`,
  `--accent`, `--focus-ring`, `--divider`); monospace only for code and raw mode.
- Live mode (default): headings sized, marks hidden away from the cursor line, task checkboxes
  clickable, tables rendered, links clickable (new tab). Raw mode: plain Markdown.
- Mode switch: segmented control "Live | Raw" and `Mod+E`; remembered in `/preferences`.

## Dialogs

- New note / Rename: single name field (1–120 chars), inline error for duplicates.
- Delete note: AlertDialog — "Delete “X”? The file X.md is removed from the notes folder."
- Conflict: "This note changed outside the app" / "…in another window" with actions **Keep both**
  (default), **Use mine**, **Use the file's version**, showing a short preview of both texts.
- Leaving with unsaved text: browser `beforeunload` prompt; in-app navigation awaits the flush.

## Keyboard (FR-024)

| Keys | Action |
|---|---|
| `Alt+N` | New note |
| `Alt+W` | Close current tab |
| `Alt+PageDown` / `Alt+PageUp` | Next / previous tab |
| `Alt+[` / `Alt+]` | Toggle left / right panel |
| `Mod+E` | Toggle live / raw |
| `Esc` (in editor) | Move focus to the tab |
