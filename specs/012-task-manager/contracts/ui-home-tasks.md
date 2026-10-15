# UI Contract: Home Page Panels and Task Manager

Stable names, roles and keys that tests (Vitest, Playwright) and other features rely on. Paths are
under `frontend/src/`. All colors come from theme tokens (`tokens.css` / `index.css`); no new
theme color is added.

## Routes

| Path | Element | Notes |
|---|---|---|
| `/` (index) | `HomeLayout` | Calendar shows the last view/date (`calendar/state.ts`) |
| `/calendar/:view?/:date?` | `HomeLayout` | Same page; keeps existing deep links (R10) |
| `/` children kept: `classes/new`, `events/new`, `sessions/:sessionKey`, `…/edit`, `…/delete` | overlays as today | |
| `/?task=<id>` | `HomeLayout` | Opens Tasks panel + details of `<id>`, then drops the param (FR-052) |

## Landmarks and ids

| Element | Role / name | id / data attribute |
|---|---|---|
| Calendar panel | `<section aria-label="Calendar">` card | `id="calendar-panel"`, `data-panel="calendar"` |
| Tasks panel | `<section aria-label="Tasks">` card | `id="tasks-panel"`, `data-panel="tasks"` |
| Calendar rail button | button "Show calendar" `aria-keyshortcuts="Shift+C"` | `id="show-calendar"` |
| Tasks rail button | button "Show tasks, 7 open, 2 overdue" `aria-keyshortcuts="Shift+T"` | `id="show-tasks"` |
| Close buttons | "Close calendar" / "Close tasks"; disabled with `aria-describedby` → "At least one panel stays open" | `id="close-calendar"`, `id="close-tasks"` |
| Divider | `PanelResizeHandle` `role="separator"` "Resize tasks panel", `aria-controls="tasks-panel"` | `data-testid="tasks-divider"` |
| Announcer | `role="status" aria-live="polite"` (sr-only) | `data-testid="home-announcer"` |

Rails: 44 px (`RAIL_W`), same `Card` styling as `app/shell/Rail.tsx`; vertical label via
`writing-mode: vertical-rl`; Tasks rail shows the count as text and the overdue indicator as a
"!" glyph with sr text "N overdue" (never color alone).

## Panel headers (one row, `h-10` ≈ 40 px)

- **Calendar** (`features/home/CalendarPanel.tsx`, reuses `CalendarToolbar` in a `compact` mode):
  left-card reopen button (narrow mode only), Today, prev/next, range title, D/W/M switch,
  "Show tasks" switch, a "More" menu holding New class / New event when the row is narrower than
  their full buttons, Focus mode button, close.
- **Tasks** (`features/tasks/TasksHeader.tsx`): title "Tasks", Board/List `ToggleGroup`
  (`aria-label="Task view"`), search button "Search tasks" (expands an input over the row;
  Escape or clear collapses), "Filter" button (Popover: course select incl. "Personal",
  "Event-linked only" switch, "Show done" switch; badge "N" = active filters incl. search,
  `aria-label="Filter, 2 active"`), "New task" button, close.

## Keyboard

| Keys | Where | Action |
|---|---|---|
| Shift+C / Shift+T | home page, not typing | toggle Calendar / Tasks panel (announces "at least one" when blocked) |
| `[` `/` `\` | unchanged (008) | left card, course search, focus mode |
| calendar `t d w m j k n e ?` arrows | only when focus is not inside `[data-panel="tasks"]` and the Calendar panel is open | unchanged |
| Enter / Space | focused card | pick up (`aria-pressed="true"`, announce) |
| ↑ ↓ / ← → | picked-up card | move within column / to neighbouring column |
| Enter / Escape | picked-up card | drop (one move request) / cancel |
| same pattern | focused column header handle | reorder columns |
| Enter | focused card (not picked up) via its title button | open details |
| Escape | details sheet / quick-note pop-up / search field | close, focus returns to opener |

## Board

- Columns ≈ 280 px fixed (`w-70`), board scrolls horizontally (`overflow-x-auto`); each column
  scrolls vertically; header: name, count, done marker ("✓ Done column" text badge when
  `countsAsDone`), column menu (Rename, Counts as done, Move left/right, Delete).
- Card (`features/tasks/board/TaskCard.tsx`, `data-task-id`): title button, course chip (color dot +
  name), due chip with text "Today" / "Overdue" + glyph, checklist "2/5", quick-note button
  "Quick notes (3)", Event marker (calendar glyph + sr "Event"), "Open note" in the card menu for
  linked tasks, card menu (Open, Move to…, Delete).
- Drag: ghost placeholder of the dragged height (`bg-muted`, dashed `border-draft-border`);
  floating clone `shadow-lg`, `pointer-events-none`; cursor grab/grabbing; reduced motion → no
  lift animation.
- Column footer: "Add task" input; Enter creates, stays focused.
- Empty column: short text "No tasks" + the add field.
- Limit messages: "A board holds at most 12 columns", "A column with this name already exists",
  "Names can be at most 40 characters".

## List

Groups in order Overdue, Today, This week, Later, No date, Done (collapsed by default), each a
disclosure button with count; rows show title, column name, course, due, checklist, quick-note
button, menu with the same actions as cards.

## Details sheet

`features/tasks/TaskDetails.tsx`: covers the Tasks panel only (absolute inset within the panel,
`role="dialog" aria-modal="false" aria-labelledby`), back button "Back to tasks", fields Title
(read-only + "Edit event" link when linked), Description, Column select, Due date + time (read-only
when linked), Course select (incl. none), Checklist editor, Quick notes list, Delete. Save state
text in the header: "Saving…", "Saved", "Couldn't save — Retry" (`aria-live="polite"`,
`data-testid="task-save-state"`).

## Quick-note pop-up

`features/tasks/QuickNotesPopover.tsx`: Popover portalled **inside** the Tasks panel container;
"New quick note", each note with title input + textarea, per-note save state, Delete (toast with
Undo); Escape / close returns focus to the card's quick-note button.

## Toasts (Sonner)

Undo toasts (10 s): task deleted, quick note deleted, checklist item deleted, empty column
deleted. Notices: "Tasks closed to make room for the calendar" (and vice versa), move failed with
Retry.

## Calendar additions

- "Show tasks" switch (`id="show-tasks-on-calendar"`), off by default.
- Timed marker: `button role="checkbox" aria-checked` + title button, positioned at the time,
  outside overlap layout; date-only strip row under day headers (`data-testid="due-strip"`),
  "+N more" popover; month cell lists the same chips.
- Event "on board" indicator: small clipboard glyph inside `EventBlock` with sr text "On board",
  opens the task.

## Events and other pages

- Event form and quick form: "Add to kanban" `Switch` + column `Select` after Repeat; helper text
  for repeating events "Only the first occurrence is added to the board".
- Session details action (registered): "Add to kanban" (hidden when `session.taskId`).
- Delete dialogs (session, semester, year, course): when `linkedTaskCount > 0`, a radio group
  "Linked tasks: Keep as tasks (default) / Delete with the event"; course dialog adds
  "N tasks will become personal tasks".
- Course page and course-session side card: section "Tasks" with open tasks + quick add.
- Settings → Import & export: "Export tasks" card (download CSV).
