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
- On open, scrolls the current/next session into view (keyboard focus is not moved: moving it
  on page load is disorienting).
- Empty course: "No sessions yet" + link to New class.

## Workspace layout (desktop ≥ 1024 px)

Updated 2026-10-06 to the layout that shipped: the session timeline and note list live in a
section of the app's side panel (under the courses), not in a workspace column.

```text
┌ Top bar ───────────────────────────────────────────────────────────────────────────────┐
├ Side panel ───────┬ Workspace header: ← CS 201 · Mon 5 Oct 2026 · 10:00–11:30   [⇤] [⇥] ┤
│ Courses           │ [Lecture notes ●][Homework 3 ✓][+]   Live|Raw   │ Audio            │
│  Year › Sem › …   │ ┌───────────────────────────────────────────┐   │  [Record]        │
│ ═══ (drag) ═══    │ │ # Trees                                    │   │  Recording 10:02 │
│ ▾ Sessions and    │ │ A **binary tree** has …                    │   │  [Transcribe]    │
│   notes           │ └───────────────────────────────────────────┘   │  ▶ ─────●─── 🔊  │
│  [New note]       │ Saved · 10:42                                    │                  │
│  Notes …          │                                                  │                  │
│  Sessions (Sep …) │                                                  │                  │
└───────────────────┴──────────────────────────────────────────────────┴──────────────────┘
```

- **Side panel** (001 shell): resizable 240–480 px (default 280) by dragging its edge or with
  ←/→ on the focused edge (Home/End = min/max, Enter or double-click = reset); hidden and shown
  with `[` or the top-bar button. Width and hidden state are remembered per browser.
- **"Sessions and notes" section** (in the side panel, under the courses): "New note", the
  note list, then the session timeline (compact: date, time, title, upcoming/unscheduled
  badges; note/audio counts are shown on the course page only). Starts at half of the panel's
  height; its top edge is draggable (↑/↓, 15–85 %, Enter resets to 50 %), height remembered per
  browser. Clicking its header, `Alt+[`, or the workspace header's left button collapses or
  expands it; this collapsed state is remembered per user (`/preferences`
  `workspaceLeftCollapsed`). If the side panel is hidden, the workspace button shows it again.
- **Audio panel** (right): resizable 260–640 px from its left edge (same keys), never narrower
  than leaving 360 px for the editor; width remembered per browser; collapsed with `Alt+]` or
  the header's right button, remembered per user (`workspaceRightCollapsed`).
- Two levels of "more room for the editor": `Alt+[` collapses the section; `[` hides the whole
  side panel for full width.
- Below 1024 px the side panel and the audio panel become `Sheet` drawers; the notes and
  sessions open in their own drawer from the workspace header, and the editor is full width.
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
| `Alt+[` / `Alt+]` | Collapse/expand “Sessions and notes” / the audio panel (`[` hides the whole side panel) |
| `Mod+E` | Toggle live / raw |
| `Esc` (in editor) | Move focus to the tab |
