# Contract: Documents section, PDF reader, split view, annotations

Extends 002 `ui-workspace.md` and 006 `ui-import.md`. Tokens only (Constitution V), shadcn
primitives, keyboard operable, AA in light, dark, presets and user themes; state never by colour
alone.

## Documents section (side panel, below the note list) — FR-001–FR-010

```text
Documents                         [⇪ Upload PDF]
┌ Uploading slides.pdf ━━━━━━━━── 64 %  [✕] ┐   (006 upload rows)
Lecture 5 — Trees      4.2 MB · 6 Oct      ⋯
Handout week 3         0.8 MB · 30 Sep     ⋯   (⋯ = Rename… · Delete…)
```

- Drop zone = the section; non-PDF / > 200 MB refused instantly ("Only PDF files can be added
  here", "<name> is 240 MB. PDFs can be at most 200 MB.").
- Item activation opens/focuses the document tab. Badges (text): "File missing", "Protected".
- Delete dialog: "Delete “Lecture 5 — Trees”? The PDF is removed from this session's documents
  folder. Its 12 annotations are deleted too. This can't be undone."

## Workspace tab bar and split view — FR-011–FR-014a

```text
[Lecture notes ×] [Lecture 5 — Trees ·L ×] [Questions ·R ×]          [⧉ Split]
┌───────────── left pane ─────────────┬─┬──────────── right pane ────────────┐
│  PDF reader (Lecture 5 — Trees)     │║│  Note editor (Questions)            │
└─────────────────────────────────────┴─┴────────────────────────────────────┘
```

- One tab bar only. Document tabs show a document icon + name; the reader never renders tabs.
- Split toggle: button (`aria-pressed`) at the end of the tab bar and `Alt+\`. With split on, each
  tab visible in a pane shows "· L" / "· R" (screen-reader text "shown in left pane"); selecting a
  tab shows it in the focused pane; tab menu: "Show in other pane". Divider: `PanelResizeHandle`
  (arrows, Home/End, Enter resets). Hidden below 1100 px main-area width.

## Reader toolbar (inside the document tab) — FR-015–FR-024

```text
[◀][▶]  Page [ 12 ] of 42   [−] 125 % [+] [Fit width]   [🔍 Search]   [◐ Dark pages]
[Select][Highlight][Draw][Text][Comment]  Colour ● Yellow ▾  [↶][↷]   Saved ✓
```

- Page field: Enter jumps; out-of-range → nearest page + polite message "There are 42 pages —
  showing page 42." Page indicator in a polite live region.
- Zoom 50–400 % (steps 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400), Fit width.
- Continuous zoom over the pages, within 50–400 % and anchored where the gesture happens:
  `Ctrl/Cmd` + scroll wheel (wheel up zooms in), trackpad pinch, and two-finger pinch on touch
  screens. The browser's own page zoom never triggers over the pages; one-finger scrolling stays.
- Search: `Ctrl/Cmd+F` while the reader has focus opens an inline search box: "3 of 11", ↑/↓
  buttons, Enter/Shift+Enter; "No matches"; scanned: "This document has no searchable text."
- Dark pages: toggle button (`aria-pressed`), remembered per user.
- Protected PDF: the page area shows "This PDF is password-protected and can't be opened in the
  app. You can open it outside the app from the session's documents folder."
- Keys while focus is inside the reader: PageUp/PageDown, Home/End (first/last page),
  `Ctrl/Cmd +/-/0`, `Ctrl/Cmd+F`, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`/`Ctrl+Y`, `Delete`, `Escape`
  (leave tool → Select; from Select, moves focus to the tab bar so keyboard users can leave).

## Annotations — FR-025–FR-036

- Tools as a `ToggleGroup`. Highlight acts on the current text selection (button enabled only with a
  selection; disabled with tooltip/explanation on pages or documents without text).
- Colour menu: six named colours (Yellow, Green, Blue, Pink, Orange, Purple), each with its name.
- Each annotation is focusable in page order with an accessible name; selected → outline in the
  focus-ring token + handles; arrows move (Shift ×10), `Enter` edits text, `C` colour menu,
  `Delete` removes.
- Comment marker: button with a speech-bubble icon; opens a popover with a textarea (Esc closes and
  saves). Text box: text drawn on the page in the annotation colour's dark variant (AA on white).
- Save state (polite live region): "Saving…", "Saved", "Not saved — retrying" (warning icon + text).
- Conflict notice (toast): "This comment was changed in another window. Both versions are kept."
- Leaving with pending annotation changes: browser `beforeunload`; closing the document tab: dialog
  "Annotations are still being saved. Close anyway? They'll be saved when you're back online."
  (they stay queued on the device).
