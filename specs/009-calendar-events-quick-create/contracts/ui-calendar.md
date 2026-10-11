# UI Contract: Events, Quick Create and Trash (009)

Applies on top of 001 `ui-shell.md` and 008 `ui-layout.md`. All colours are theme tokens
(`src/styles/tokens.css`); new tokens: `--draft-bg`, `--draft-border`, `--draft-fg`,
`--event-marker`. Every rule holds in light, dark, preset and custom themes and with keyboard only.
Animations are skipped under reduced motion.

## Routes

| Route | Content |
|---|---|
| `/events/new` | Full event form (dialog over the calendar, like `/classes/new`); accepts router state with prefilled values |
| `/classes/new` | Unchanged; also accepts router state from the quick form ("More options", "Custom" repeat) |
| `/semesters/:semesterId/events` | Events page: timeline of the semester's events |
| `/semesters/:semesterId/events/:sessionKey` | Event workspace (same `WorkspacePage` as sessions) |
| `/sessions/:sessionKey/edit` · `/delete` | Unchanged entry points; the flow branches on `kind` |
| `/settings/trash` | Trash page; "Trash" added to the Settings navigation |

## Calendar entries

- `EventBlock` shows for events: Event icon (calendar-star), title, time, location when height ≥
  40 px; accessible name starts with "Event:". Classes unchanged.
- Overlaps: classes, events and the draft share the column layout (`layoutOverlaps`). Each block
  is a focusable button; the full title shows in a tooltip on hover **and** on keyboard focus.
- Month chips: same marker; the "+N more" list includes events.
- Events never appear on course timelines or in session counts.

## "New event"

- Button "New event" next to "New class" in the calendar toolbar (and in the `n` shortcut menu:
  `n` = New class stays; `e` = New event, listed in the shortcuts dialog).
- Form fields in order: Title*, Year/Semester* (`HierarchyPicker` without the course level),
  Date, Start, End, Location, Links, Color (default Blue), Repeat (`RecurrenceFields`).
- Semester preselection: open course's semester → `lastSemesterId` → empty.
- Edit form: same fields; Semester disabled with the text "The semester can't be changed because
  this event has notes, recordings or documents." when `semesterLocked`.

## Press and drag (day and week views)

| Input | Result |
|---|---|
| Pointer down on empty column space | Draft starts at the pressed time (snapped to 15 min) |
| Pointer move (button held) | Draft spans pressed time ↔ pointer time, min 15 min; label "13:00 – 14:45"; stays in the start day |
| Pointer within 32 px of grid top/bottom | Grid auto-scrolls |
| Escape while dragging | Draft removed, nothing else changes |
| Release, moved ≥ 4 px | Quick form opens beside the draft |
| Release, moved < 4 px | 1-hour draft at the pressed time, quick form opens |
| Pointer down on an entry | No draft (entry selection / future drag and drop) |
| Touch tap | 1-hour draft; no touch dragging |

Draft block: `--draft-bg` fill, dashed `--draft-border`, `aria-hidden`; a polite live region
announces "New entry, from 13:00 to 14:45" on creation and changes.

## Month view

Clicking empty space in a day cell (not the date number, a chip or "+N more") creates a 09:00–10:00
draft for that date, shown as a draft chip, and opens the quick form anchored to the cell.

## Keyboard on the time grid

↑/↓ move the highlighted slot 15 min · ←/→ one day (week view) · Shift+↑/↓ shorten/extend the
range (min 15 min) · Enter/Space open the quick form for the range · Escape clear. Focus returns to
the slot of the draft's start (or the new entry) when the form closes.

## Quick form

```text
┌ New entry ─────────────────────────────┐
│ ( Class | Event )                      │  type switch, last used (first time: Class)
│ Course* [combobox: existing or new]    │  Class; new name → Year*/Semester* rows appear
│ Title*  [________]  Semester* [▾]      │  Event
│ Date [__] Start [__] End [__]          │  edits move/resize the draft live
│ Location [________]                    │
│ Links [+ Add link]                     │
│ Repeat [Does not repeat ▾]             │  Does not repeat · Weekly on <Weekday> · Custom…
│ More options              Cancel  Save │
└────────────────────────────────────────┘
```

- Popover anchored to the draft (desktop), bottom sheet below desktop width; takes focus on open.
- Save disabled until required fields are valid; inline field errors; end ≤ start → "End must be
  after start".
- Escape/Cancel → discard. Click outside → discard only if nothing was entered (`dirty=false`),
  otherwise ignored. Route change → discard. Pressing another empty slot → same rule, then replace.
- Save → draft becomes the entry; toast "Class created" / "Event created" with **Undo** (≥ 10 s).
  Failure → form stays with values and a `role="alert"` error; Save retries.
- "More options" / "Custom…" → full form with all values entered so far.

## Left card

- Each semester row's list ends with an "Events" link (calendar-star icon, `eventCount` badge when
  > 0) → `/semesters/:id/events`. Shown whenever the semester is shown (search keeps it with its
  semester).
- Course rows with `reservedNameConflict` show a warning icon and "Rename this course: `_Events` is
  reserved for events."
- Event workspace: the Notes section lists the event's notes; the timeline section is titled
  "Events · <Semester>" and lists the semester's events (`SessionTimeline` variant with event
  entries, same past/upcoming styling).

## Delete and series edits

- Delete dialog (classes and events) uses `GET /sessions/{key}/deletion-impact`: "This will move
  1 event with 2 notes, 1 recording and 1 document to the Trash. You can restore it from Settings →
  Trash." Buttons: Cancel · Move to Trash.
- Series edit result for events: "Saved. 3 events with notes, recordings or documents, or edited
  individually, were left unchanged."
- Semester rename/delete dialogs list events with classes and courses; deletion says everything goes
  to the Trash.

## Settings → Trash

- Two sections: "Deleted classes" and "Deleted events", newest first. Empty: "Nothing in the Trash."
- Entry card: label, "Year · Semester[ · Course]", dates (single date + time, or "12 occurrences,
  2 Oct – 18 Dec"), "Deleted <relative time>", counts (notes, recordings, documents), purge error
  if any.
- Icon buttons with accessible names: "Restore <label>" (arrow-counter-clockwise) and "Delete
  <label> permanently" (trash).
- Delete → AlertDialog "Are you sure?" with **No** (default focus) and **Yes**; Yes removes the
  entry and its files; focus returns to the next entry or the section heading.
- Restore → toast "Restored <label>" with "Show in calendar"; recreated year/semester/course are
  named in the toast.
