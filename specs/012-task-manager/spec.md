# Feature Specification: Task Manager and Home Page Panels

**Feature Branch**: `012-task-manager`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Add a task manager: students keep their assignments, readings and exam preparation as tasks, see them on a board and in a list, take quick notes on them, and optionally see their due dates on the calendar. Events can be added to the board. A task never needs a due date, a course or a place on the calendar; tasks stand on their own." (Full description covers: Priority 1 — tasks, where, board and columns, list, details, quick notes, filters; Priority 2 — add to kanban, linked tasks, open note, calendar, course page, export; everywhere; out of scope.)

**Scope**: This feature merges the former Feature 011 (home page panels) with the task manager so
both are planned and implemented together. Part A (Stories 1–7, FR-001 to FR-058, SC-001 to
SC-009) is the task manager; Part B (Stories 8–13, FR-059 to FR-098, SC-010 to SC-018) is the
home page layout of the left card, the Calendar panel and the Tasks panel that holds it.

**Home page panels input**: "Redesign the home page ("/", the page shown after login) as three panels side by side: the left card (the existing side card), a Calendar panel and a Tasks panel. The Calendar panel and the Tasks panel can each be closed, and each leaves a narrow bar (a rail) when closed, exactly like the left card does. This is a layout feature: it does not change what the calendar or the task manager do. It uses the same card look, gaps, rounded corners, themes and accessibility rules as the three-card layout."

**Related**: Feature 008 (three-card layout: card look, left card and its rail, the 1100 px rule,
focus mode, landmarks, animation and shortcut rules — reused by Part B), Feature 009 (events, repeating occurrences, the event workspace, the
Trash), Feature 001 (calendar views, courses and course colors), Feature 002 (course pages, the
"Sessions and notes" section), Feature 005 (settings, themes). Constitution Principle I (no silent data loss, visible save state), Principle V (theme
tokens, keyboard accessibility, contrast) and Principle VII (spec discipline) apply directly.

**Reference**: `design/reference/astryx-kanban-board.tsx` (MIT, © Meta Platforms, Inc.) is a
visual and interaction reference for the board only; where it and this spec disagree, the spec
wins.

## Clarifications

### Session 2026-10-15

- Q: How should the home-page panels spec (011) and the task manager spec (012) be combined so one `/speckit-implement` run builds both? → A: Merge 011 into 012 as Part B (Stories 8–13, FR-059 to FR-098, SC-010 to SC-018); the 011 folder is removed.
- Q: When an event that had a linked task is restored from Settings → Trash, what happens to that task? → A: A task deleted with the event goes into the same Trash entry and comes back linked when the event is restored; a kept task stays unlinked.
- Q: When a student opens one of a course's tasks from that course's page or the side card, where do its details open? → A: The app goes to the home page and opens the task's details in the Tasks panel (reopening it if closed); Back returns to the course page.
- Q: How does the Tasks panel's 40 px header row fit all its controls at 320 px? → A: Title, Board/List, a search button that expands into a field over the row, a "Filter" button (pop-up with course, event-linked, show/hide Done; shows the active-filter count), New task and close.
- Q: Which keyboard shortcuts open and close the Calendar and Tasks panels? → A: Shift+C (Calendar) and Shift+T (Tasks), ignored while typing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture and track tasks on a board (Priority: P1)

The student adds "Read chapter 4" and "Problem set 3 (due Friday 23:59, Linear Algebra)" to the
board, drags the problem set to In progress when they start, and to Done when they submit it.

**Why this priority**: The board is the heart of the feature; with only this story the student
already has a working task manager.

**Independent Test**: On a fresh account, create tasks with only a title and with all fields,
move them between and within columns by pointer and by keyboard, reload, and confirm everything
is where it was left.

**Acceptance Scenarios**:

1. **Given** a new account, **When** the student opens the Tasks panel, **Then** the board shows
   three columns, To do, In progress and Done, with Done counting as done.
2. **Given** the board, **When** the student activates "New task" and types only a title,
   **Then** the task is created in the first column; due date, course, description and checklist
   can be added later.
3. **Given** a task, **When** it is shown on the board, **Then** its card shows the title, the
   course color and name (if any), the due date (marked "Today" when due today and "Overdue" when
   late, not by color alone), the checklist progress (for example "2/5"), the number of quick
   notes and, for an event-linked task, an Event marker.
4. **Given** a card, **When** the student drags it into another column or to another position in
   the same column, **Then** it lands there and the order is kept after a reload.
5. **Given** a focused card, **When** the student presses Enter or Space, moves it with the arrow
   keys and presses Enter, **Then** it lands at the new position; pressing Escape instead returns
   it to where it was. Each step is announced to assistive technology.
6. **Given** a task moved into a column that counts as done, **When** the student opens its
   details, **Then** it shows when it was completed; moving it out clears that date.
7. **Given** a column, **When** the student types a title in its "add task" field at the bottom
   and presses Enter, **Then** a task is created at the end of that column and the field stays
   ready for the next one.

---

### User Story 2 - Shape the board's columns (Priority: P1)

The student adds a "Waiting for feedback" column, renames "In progress" to "Doing", moves the new
column before Done, and later deletes it, moving its tasks to Done.

**Why this priority**: Custom columns are part of the board model; tasks depend on them.

**Independent Test**: Add, rename, reorder (pointer and keyboard), mark as done and delete
columns up to the limits, and confirm validation messages and that no task is ever lost.

**Acceptance Scenarios**:

1. **Given** the board, **When** the student adds a column with a name, **Then** it appears at the
   end; names are required, at most 40 characters and unique ignoring case, with a clear message
   otherwise.
2. **Given** 12 columns, **When** the student tries to add another, **Then** it is refused with a
   message saying the board holds at most 12 columns.
3. **Given** a column, **When** the student reorders it by dragging its header or with a keyboard
   alternative, **Then** the new order is kept after a reload.
4. **Given** a column that holds tasks, **When** the student deletes it, **Then** they are asked
   which column receives its tasks, and nothing is deleted until they confirm.
5. **Given** only one column, **When** the student tries to delete it, **Then** the action is
   disabled and says why.
6. **Given** a column, **When** the student marks it as counting as done, **Then** its tasks become
   Done (with a completion date) and leave the open-task count; unmarking clears their completion
   dates.

---

### User Story 3 - Task details, quick notes and safe deletion (Priority: P1)

The student opens a task to add a checklist and a description, jots two quick notes from the
card while reading, and deletes an old task, then undoes it.

**Why this priority**: Details and quick notes are where the work happens; Undo and visible save
state are required by the constitution.

**Independent Test**: Open details and the quick-note pop-up by pointer and by keyboard, edit
every field, watch the save state, delete a task, a checklist item and a quick note and undo
each, and simulate a failed save.

**Acceptance Scenarios**:

1. **Given** a card, **When** the student opens it, **Then** a details sheet covers the Tasks
   panel with a back button, all fields, the checklist, the quick notes and Delete; Escape or back
   closes it and returns focus to the card.
2. **Given** the details sheet, **When** the student changes any field, **Then** it saves
   automatically and a visible save state shows saving, saved or failed (with retry).
3. **Given** a save that fails, **When** the student closes the sheet, **Then** they are warned and
   their unsaved change is kept, not discarded silently.
4. **Given** a task, **When** the student deletes it, **Then** it disappears and an Undo is offered
   for at least 10 seconds; Undo restores it with its column position, checklist and quick notes.
5. **Given** a card, **When** the student activates its quick-note button, **Then** a pop-up opens
   inside the Tasks panel listing the task's quick notes with "New quick note"; each note has a
   title and a text, edits in place and saves automatically with a visible save state.
6. **Given** a quick note, **When** the student deletes it, **Then** Undo is offered; **When** the
   pop-up is closed by Escape or the close button, **Then** focus returns to the card.

---

### User Story 4 - The list view and filters (Priority: P1)

Before a busy week the student switches to List to see what is overdue, due today and due this
week, filters to one course, and searches for "lab".

**Why this priority**: The list answers "what is due next", which the board does not.

**Independent Test**: With tasks across all date groups, switch views, apply each filter and the
search, reload, and confirm grouping, sorting, actions and remembered choices.

**Acceptance Scenarios**:

1. **Given** tasks with and without due dates, **When** the student switches to List, **Then**
   tasks are grouped as Overdue, Today, This week, Later, No date and Done (collapsed by default),
   sorted by due date within each group, each showing its column name.
2. **Given** the list, **When** the student uses a task, **Then** the same actions as on the board
   are available (open, quick notes, change column, delete, Open note for linked tasks).
3. **Given** the filters, **When** the student filters by a course, by personal tasks, by
   event-linked tasks, types in the search box, or hides Done tasks, **Then** both views show only
   matching tasks and say how many are hidden.
4. **Given** a chosen view and filters, **When** the student reloads, **Then** the same view and
   filters are applied.

---

### User Story 5 - Add events to the board and open their notes (Priority: P2)

When creating "Group presentation" as an event, the student switches on "Add to kanban"; a task
appears on the board with the event's title and date. From its card, "Open note" takes them to
the event's notes; Back returns them to the home page as they left it.

**Why this priority**: Connects tasks to the existing calendar; valuable but the task manager
stands on its own without it.

**Independent Test**: Create events with and without "Add to kanban" (full form, quick form,
repeating), add one from an existing event's details, edit and delete events, and confirm the
linked tasks follow the rules.

**Acceptance Scenarios**:

1. **Given** the full or quick event form, **When** the student switches on "Add to kanban"
   (off by default), picks a column (first by default) and saves, **Then** a task linked to the
   event is created in that column.
2. **Given** a repeating event in the creation form, **When** "Add to kanban" is on, **Then** the
   form says only the first occurrence gets a task, and only that occurrence is linked.
3. **Given** an existing event occurrence with no task, **When** the student chooses "Add to
   kanban" in its details, **Then** a linked task is created; an occurrence with a task does not
   offer it again.
4. **Given** a linked task, **When** its event's title, date or time is changed, **Then** the
   task's title and due date and time follow; in the task details they are read-only with an
   "Edit event" link.
5. **Given** a linked task, **When** it is moved to a done column or deleted, **Then** the event is
   unchanged.
6. **Given** an event with a linked task, **When** the event (or a semester containing it) is
   deleted, **Then** the student is asked whether to delete the linked task too; by default it is
   kept as a normal, unlinked task with its last title and date.
7. **Given** a linked task's card, **When** the student activates "Open note", **Then** the event's
   workspace opens (creating a first note if there is none, as today), and the app's back
   navigation returns to the home page as it was left.

---

### User Story 6 - Tasks on the calendar (Priority: P2)

The student switches on "Show tasks" in the calendar header and sees small checkbox markers for
timed tasks and a compact strip of due items under each day header; ticking one completes the
task.

**Why this priority**: Useful for planning but optional; the switch is off by default.

**Independent Test**: With tasks with time, date only, done and overdue, toggle "Show tasks" in
day, week and month views, tick and untick markers, open tasks from the calendar with the Tasks
panel open and closed, and confirm classes and events are never hidden.

**Acceptance Scenarios**:

1. **Given** "Show tasks" off (the default), **When** the student views the calendar, **Then** no
   task markers or strips appear.
2. **Given** "Show tasks" on, **When** a task has a due time, **Then** it appears at that time as a
   small checkbox marker (never a block in the timeline); a task with only a date appears in a
   compact strip of due items under that day's header.
3. **Given** a task marker, **When** the student ticks it, **Then** the task moves to the first
   column that counts as done; done tasks are dimmed, overdue ones are marked (not by color alone).
4. **Given** a task marker, **When** the student activates its title, **Then** the task's details
   open in the Tasks panel, reopening the panel if it is closed.
5. **Given** an event with a linked task, **When** the calendar is shown (switch on or off),
   **Then** the event shows a small "on board" indicator that opens the task, and the task has no
   separate marker.
6. **Given** many tasks on one day, **When** the calendar is shown, **Then** every class and event
   stays fully visible; the due-items strip collapses into "+N more".

---

### User Story 7 - Course tasks and export (Priority: P2)

On a course's page the student sees that course's open tasks and adds one with the course
preselected; at the end of the term they export all tasks to a CSV file.

**Why this priority**: Convenience and data freedom; builds on Stories 1–4.

**Independent Test**: Open a course page and the side card's "Sessions and notes" section, add a
task from each, delete a course with tasks, and export tasks and open the file in a spreadsheet.

**Acceptance Scenarios**:

1. **Given** a course's page, **When** it is shown, **Then** it lists that course's open tasks
   with a quick add that preselects the course; the same appears in the side card's "Sessions and
   notes" section for that course. Activating one of these tasks goes to the home page with its
   details open in the Tasks panel, and Back returns to the course page.
2. **Given** a course with tasks, **When** the student deletes the course, **Then** the
   confirmation says how many tasks it has and that they will become personal tasks; after
   confirming, those tasks remain, without a course.
3. **Given** Settings, **When** the student chooses "Export tasks", **Then** a CSV file is saved
   containing every task with its title, description, column, due date and time, course, linked
   event, checklist, quick notes and completion date.

---


### User Story 8 - See the calendar and tasks side by side (Priority: P1)

After logging in, the student lands on the home page and sees their calendar and their tasks next
to each other, each in its own card, with the left card at the side as today. They can plan the
week while looking at what still needs doing, without switching pages.

**Why this priority**: This is the reason for the feature; every other story refines it.

**Independent Test**: Log in with a window of 1366 × 768 on first use and confirm the home page
shows the left card, the Calendar panel and the Tasks panel as three bordered, rounded cards
with gaps, each with a single header row, and that the calendar and the task manager work exactly
as they do on their own.

**Acceptance Scenarios**:

1. **Given** a first-time user with a window at least 1100 px wide, **When** they open the home
   page, **Then** the left card, the Calendar panel and the Tasks panel (about 420 px wide) are
   shown left to right, each as a card with rounded corners, a thin border and a small gap.
2. **Given** the home page, **When** the user looks for a full-width bar above, below or between
   the panels, **Then** there is none; each panel has exactly one header row of about 40 px.
3. **Given** the Calendar panel, **When** the user changes view, moves dates, goes to Today,
   creates a class or an event, or uses any calendar control or shortcut available today,
   **Then** the result is the same as on the calendar page before this feature.
4. **Given** the Tasks panel, **When** the user switches between Board and List, creates a task
   or uses the filters, **Then** the task manager behaves exactly as specified in Part A.

---

### User Story 9 - Close and reopen a panel to a rail (Priority: P1)

The student closes the Tasks panel to give the calendar more room; it shrinks to a narrow rail
showing "Tasks", the number of open tasks and an overdue marker. Later they reopen it and find
it exactly as they left it. The same works for the Calendar panel.

**Why this priority**: Closing to a rail is the core interaction of the layout and must work
from the start; without it the page cannot adapt to the user's focus.

**Independent Test**: Close and reopen each panel by its close button, by its rail button and by
its shortcut, and confirm the rail contents, the animation, the focus movement, the
announcement, and that the panel's state is unchanged after reopening.

**Acceptance Scenarios**:

1. **Given** both panels open, **When** the user activates the Tasks panel's close button,
   **Then** it closes with a short animation to a rail about 44 px wide with a reopen button, an
   icon, the vertical label "Tasks", the open-task count and, if any task is overdue, an overdue
   indicator that is not color alone; the Calendar panel takes the freed width.
2. **Given** a panel closed to its rail, **When** the user activates the rail's reopen button
   (pointer or keyboard) or the panel's shortcut, **Then** the panel reopens with the same view,
   date, filters, scroll position and width it had when closed.
3. **Given** keyboard focus inside a panel, **When** the user closes it, **Then** focus moves to
   that panel's rail button and assistive technology announces that the panel was closed.
4. **Given** a closed panel, **When** the user reopens it, **Then** focus moves to the first
   control in the panel's header and the opening is announced.
5. **Given** the Calendar panel closed, **When** the user looks at the page, **Then** the Calendar
   rail sits between the left card (or its rail) and the Tasks panel, and the Tasks panel fills
   the remaining width.

---

### User Story 10 - At least one panel stays open (Priority: P1)

The student cannot end up with an empty home page: once only one of the two panels is open, its
close button and shortcut are disabled and say why.

**Why this priority**: Without this rule the page could show only rails, which is a broken
state; it is cheap to build alongside Story 9.

**Independent Test**: Close one panel, then try to close the other by button and by shortcut, and
confirm nothing closes and the reason "At least one panel stays open" is shown and announced.

**Acceptance Scenarios**:

1. **Given** only the Calendar panel is open, **When** the user hovers or focuses its close
   button, **Then** the button is disabled and shows "At least one panel stays open".
2. **Given** only one panel is open, **When** the user presses that panel's close shortcut,
   **Then** the panel stays open and "At least one panel stays open" is announced.

---

### User Story 11 - Resize the Tasks panel (Priority: P2)

The student drags the divider between the Calendar and Tasks panels, or focuses it and uses the
arrow keys, to make the task list wider or narrower. The width is remembered.

**Why this priority**: Valuable for comfort but the page is fully usable at the default width.

**Independent Test**: Resize by pointer and by keyboard up to and beyond the limits, reload the
page, and confirm the limits hold and the width is restored.

**Acceptance Scenarios**:

1. **Given** both panels open, **When** the user drags the divider, **Then** the Tasks panel
   width changes, never below 320 px, never above 60% of the window, and never so wide that the
   Calendar panel drops below 480 px.
2. **Given** the divider has keyboard focus, **When** the user presses the arrow keys (and Home or
   End), **Then** the width changes in steps within the same limits, and the divider reports its
   current value to assistive technology.
3. **Given** a resized Tasks panel, **When** the user reloads the page in the same browser,
   **Then** the width is restored (clamped to the limits of the current window).

---

### User Story 12 - Smaller windows and width conflicts (Priority: P2)

On a window where both panels cannot fit at their minimum widths, or below 1100 px, only one of
the two panels is open at a time; opening the other closes the first to its rail and tells the
student why.

**Why this priority**: Required for laptops and split screens, but it builds on Stories 8–10.

**Independent Test**: At window widths between 800 px and 1366 px, with the left card open and
closed, open each panel and resize the window; confirm the minimum widths always hold and every
automatic close is announced.

**Acceptance Scenarios**:

1. **Given** a window below 1100 px, **When** the home page loads, **Then** the left card starts
   closed as in the three-card layout and only one of the two panels is open.
2. **Given** only the Calendar panel is open and both cannot fit, **When** the user opens the
   Tasks panel, **Then** the Calendar panel closes to its rail and a message says it was closed
   to make room (shown on screen and announced).
3. **Given** both panels open, **When** the window is made narrower so both no longer fit,
   **Then** the Tasks panel closes to its rail and the user is told.
4. **Given** a first-time user with a window below 1100 px, **When** they open the home page,
   **Then** the Calendar panel is open and the Tasks panel is a rail.

---

### User Story 13 - Focus mode and coming back to the page (Priority: P3)

The student enters focus mode to see only the open panels; leaving it restores everything. They
open an event's notes from the calendar, then come back, and find both panels as they were.

**Why this priority**: Comfort features that reuse existing behavior.

**Independent Test**: Enter and leave focus mode in each open/closed combination; navigate away
from the home page and back; confirm the exact prior state is restored.

**Acceptance Scenarios**:

1. **Given** the home page in any panel combination, **When** the user enters focus mode,
   **Then** the left card, its rail and both panel rails are hidden and only the open panels
   remain.
2. **Given** focus mode is on, **When** the user leaves it, **Then** every card, rail and width
   returns to the state it had before.
3. **Given** the user opens an event's notes from the Calendar panel, **When** they return to the
   home page, **Then** the open/closed state, sizes and scroll positions of both panels are as
   they left them.
4. **Given** the user goes to a course page or a session workspace, **When** that page opens,
   **Then** its layout is exactly as before this feature.

---

---

### Edge Cases

- A column is deleted while a filter hides some of its tasks: the move question counts all its
  tasks, including hidden ones.
- No column counts as done: the calendar marker cannot be ticked and says "No column counts as
  done"; the Done list group is empty, and every task counts as open.
- A done task's calendar marker is unticked: the task returns to the column it was in before it
  was completed if that column still exists and does not count as done, otherwise to the first
  column that does not count as done.
- A task is dragged and the pointer leaves the window, the drag is interrupted (for example by a
  system gesture) or the window loses focus: the drag is cancelled and the card returns to its
  place.
- A long column or a wide board: dragging near the board's left/right edges scrolls the board
  horizontally, and near a column's top/bottom scrolls the column.
- A press on a card that moves less than a few pixels is a click and opens the task; it never
  starts a drag. Pressing a control on the card (quick notes, menu) never starts a drag.
- A save of a move fails: the card returns to its previous place and an error offers retry; no
  other task's order changes.
- Undo of a task deletion after the column it was in has been deleted: the task returns to the
  first column.
- Two quick edits in a row (title then due date) in quick succession: both are saved, in order,
  and the save state shows the latest.
- A linked event occurrence is changed with "this and following" or "all": each linked task
  follows its own occurrence.
- A repeating event occurrence whose task exists is deleted alone: the question about the linked
  task applies to that occurrence only.
- A due date with no time: the task is due at the end of that day for "overdue" purposes.
- A task's course color is shown in a theme where it is close to the card surface: the course name
  is always shown, so meaning does not depend on color.
- Search with no matches: the board and list say "No tasks match" with a way to clear filters.
- Quick-note pop-up open while the Tasks panel is closed (by shortcut): the pop-up closes, its
  unsaved text is saved first; reopening the panel does not reopen the pop-up.
- An empty new quick note (no title and no text) is discarded when the pop-up closes.
- Export with no tasks: the file contains only the header row.

**Home page panels**


- Remembered state says both panels are open but the current window cannot fit both: on load,
  the Calendar panel stays open and the Tasks panel shows as a rail, without a message.
- Remembered Tasks width is larger than 60% of the current window or would push the Calendar
  panel below 480 px: it is shown clamped, and the remembered value is only replaced when the
  user resizes.
- The Calendar panel is closed and the Tasks panel fills the width; the Calendar panel is then
  reopened: the Tasks panel returns to its remembered width.
- The user closes a panel while in focus mode: it closes, its rail stays hidden until focus mode
  ends, focus moves to the first control of the other panel, and the panel can still be
  reopened by its shortcut.
- The left card is opened at a width where the two panels no longer fit: the Tasks panel closes
  to its rail and the user is told (the left card keeps its current behavior).
- Below 1100 px the left card opens over the panels, as in the three-card layout; it does not
  change which panel is open.
- A calendar single-key shortcut (for example `n` or `t`) is pressed while focus is in the Tasks
  panel: it does not trigger the calendar action, so the task manager's own keys and typing work.
- The open-task count is zero: the rail shows 0 (or no count) and no overdue indicator.
- Tasks fail to load: the Tasks rail shows no count rather than a wrong one, and the Tasks panel
  shows the task manager's own error state.
- A task becomes overdue (its due time passes) while the Tasks panel is closed: the rail's
  overdue indicator appears without a reload.
- A form or dialog is half-filled inside a panel when the panel is closed: its content is still
  there when the panel is reopened.

## Requirements *(mandatory)*

### Functional Requirements — Part A: Task Manager

**Tasks**

- **FR-001**: A task MUST have a title (required, at most 200 characters), and MAY have a
  description (plain text), a due date with an optional time, a course, a checklist of items that
  can be ticked, and quick notes. Every task is in exactly one column.
- **FR-002**: A task with a course MUST show the course's color and name; a task without a course
  is a personal task.
- **FR-003**: A task in a column that counts as done is Done. Moving a task into such a column
  MUST record the completion date and time; moving it out MUST clear it.
- **FR-004**: Creating a task MUST ask only for a title first; every other field MUST be optional
  and editable later.
- **FR-005**: Tasks, columns, order and quick notes MUST be stored per user and survive restarts.

**Where**

- **FR-006**: The task manager MUST live in the Tasks panel of the home page (Part B); there is
  no separate tasks page. The panel header is defined by FR-066.
- **FR-007**: A new task MUST also be creatable from a course's page, with that course preselected.

**Board and columns**

- **FR-008**: A new board MUST start with three columns, To do, In progress and Done; only Done
  counts as done.
- **FR-009**: Students MUST be able to add, rename, reorder (by dragging and by keyboard), mark or
  unmark as counting as done, and delete columns.
- **FR-010**: Column names MUST be required, at most 40 characters and unique ignoring case; a board
  MUST have at most 12 columns; the last remaining column MUST NOT be deletable.
- **FR-011**: Deleting a column that holds tasks MUST ask which remaining column receives them and
  MUST change nothing until confirmed; deleting an empty column MUST offer Undo.
- **FR-012**: Columns MUST have a fixed width of about 280 px, and the board MUST scroll
  horizontally, including in a narrow Tasks panel.
- **FR-013**: Cards MUST show the title, the course (color and name), the due date (marked Today or
  Overdue in text or symbol, not color alone), the checklist progress, the number of quick notes
  and an Event marker for event-linked tasks.
- **FR-014**: Cards MUST be draggable between columns and within a column; the order MUST be
  remembered. During a drag, the landing place MUST be shown.
- **FR-015**: Each column MUST have a quick "add task" field at its bottom.
- **FR-016**: Every move MUST have a keyboard alternative: Enter or Space picks up a focused card,
  arrow keys move it between positions and columns, Enter drops it, Escape cancels and returns it.
  Pick-up, each position and the drop or cancel MUST be announced. A task's column MUST also be
  changeable from its details and from a card menu.
- **FR-017**: A drag MUST be cancelled, with the card returned, when Escape is pressed or the
  pointer interaction is interrupted.
- **FR-018**: Dragging near the board's edges MUST scroll it horizontally; dragging near a column's
  top or bottom MUST scroll that column.
- **FR-019**: A press that moves less than a few pixels MUST count as a click (opening the task),
  not a drag; presses on a card's own controls MUST never start a drag.
- **FR-020**: If saving a move fails, the card MUST return to its previous place and the student
  MUST be told, with a way to retry.

**List**

- **FR-021**: The List view MUST group tasks as Overdue, Today, This week, Later, No date and Done
  (Done collapsed by default), sorted by due date (then time) within each group; each task MUST
  show its column name.
- **FR-022**: The List view MUST offer the same task actions as the board.

**Details**

- **FR-023**: Opening a task MUST show its details in a sheet covering the Tasks panel, with a back
  button; Escape or back MUST close it and return focus to where it was opened from.
- **FR-024**: The details MUST show all fields, the checklist (add, edit, tick, reorder, delete
  items), the quick notes and Delete.
- **FR-025**: Changes MUST save automatically with a visible save state (saving, saved, failed with
  retry).
- **FR-026**: Deleting a task MUST offer Undo for at least 10 seconds; Undo MUST restore the task
  with its position, checklist, quick notes and event link.
- **FR-027**: Nothing MUST ever be deleted without Undo or confirmation, and unsaved changes MUST
  never be silently lost (closing with a failed save warns and keeps the change).

**Quick notes**

- **FR-028**: Each card MUST have a quick-note button that opens a pop-up inside the Tasks panel,
  without leaving the page, listing the task's quick notes with "New quick note".
- **FR-029**: A quick note MUST have only a title and a plain text; a task MAY have any number of
  quick notes.
- **FR-030**: Quick notes MUST be editable in place, save automatically with a visible save state,
  and be deletable with Undo.
- **FR-031**: The pop-up MUST close with Escape or a close button and return keyboard focus to the
  card.
- **FR-032**: Quick notes belong to their task: deleting the task deletes its quick notes, with the
  same Undo.

**Filters**

- **FR-033**: Filters MUST include: course (one course, or personal tasks), event-linked tasks, a
  search on titles, and a show/hide Done switch; they MUST apply to both views.
- **FR-034**: The chosen view and filters MUST be remembered per browser.

**Add to kanban (Priority 2)**

- **FR-035**: The full event form and the calendar's quick form MUST offer an "Add to kanban"
  switch, off by default; when on, a column MUST be choosable (first column by default) and
  saving MUST create a task linked to the event.
- **FR-036**: The details of an existing event occurrence that has no linked task MUST offer "Add
  to kanban".
- **FR-037**: For a repeating event, the creation form MUST add a task for the first occurrence
  only and MUST say so; other occurrences MAY be added one by one from their details.
- **FR-038**: An event occurrence MUST have at most one linked task.

**Linked tasks (Priority 2)**

- **FR-039**: A linked task MUST take its title and its due date and time from its event (the
  start date and time), show them read-only with an "Edit event" link, and follow every change
  to the event's title, date or time.
- **FR-040**: A linked task's column, description, checklist and quick notes MUST belong to the
  task.
- **FR-041**: Moving a linked task to a done column MUST NOT change the event; deleting the task
  MUST NOT delete the event.
- **FR-042**: Deleting an event occurrence, a series, or a year, semester or course containing
  linked events MUST ask whether to delete the linked tasks too; the default MUST keep them as
  normal, unlinked tasks with their last title and date.
- **FR-043**: A linked task deleted together with its event MUST go into that event's Trash entry
  (with its column position, checklist and quick notes), and the confirmation and the Trash entry
  MUST say so. Restoring the event MUST restore the task, linked again; if its column no longer
  exists it returns to the first column. Permanently deleting the Trash entry MUST delete the task
  too. A task kept as unlinked MUST stay unlinked when the event is restored.

**Open note (Priority 2)**

- **FR-044**: A card of an event-linked task MUST offer "Open note", which opens that event's
  workspace with the existing event behavior, including creating a first note when there is none.
  Tasks not linked to an event MUST NOT offer it.
- **FR-045**: Returning with the app's normal back navigation MUST bring back the home page as it
  was left (per FR-089).

**Calendar (Priority 2)**

- **FR-046**: The calendar header MUST have a "Show tasks" switch, off by default and remembered
  per browser; when off, no task appears on the calendar. *(Amended 2026-11-05)*: on the home
  calendar this and 020 FR-044's "Show time" switch are one three-way switch — Tasks only / Both /
  Time only — defaulting to Both (tasks on), remembered per browser.
- **FR-047**: When on, tasks with a due date MUST appear in the day, week and month views, clearly
  different from classes and events (a checkbox marker, never a block in the timeline): a timed
  task as a small marker at its time, a date-only task in a compact strip of due items under the
  day headers (in month view, inside the day cell).
- **FR-048**: Ticking a marker MUST move the task to the first column that counts as done;
  unticking MUST move it back (see Edge Cases). Activating a marker's title MUST open the task's
  details in the Tasks panel, reopening the panel if it is closed.
- **FR-049**: Done tasks MUST be dimmed and overdue tasks marked, not by color alone.
- **FR-050**: Event-linked tasks MUST NOT have a separate marker; their event MUST show a small "on
  board" indicator, whether or not "Show tasks" is on, that opens the task.
- **FR-051**: Task markers and strips MUST never hide or shrink classes or events; a crowded strip
  MUST collapse into "+N more".

**Course page (Priority 2)**

- **FR-052**: A course's page and the side card's "Sessions and notes" section for that course MUST
  show the course's open tasks with a quick add that preselects the course. Activating a task there
  MUST go to the home page and open the task's details in the Tasks panel (reopening the panel if
  it is closed, within the width rules of FR-078 to FR-081); the app's back navigation MUST return
  to the course page.

**Export (Priority 2)**

- **FR-053**: Settings MUST offer "Export tasks", which saves a CSV file with one row per task:
  title, description, column, due date, due time, course, linked event (title and date), checklist
  (items and their ticked state), quick notes (titles and texts) and completion date, readable by
  common spreadsheet programs including non-ASCII text.

**Everywhere**

- **FR-054**: Everything MUST work with keyboard and pointer in light, dark and custom themes; all
  colors MUST come from theme tokens.
- **FR-055**: Columns, Done and overdue MUST never be shown by color alone.
- **FR-056**: Animations MUST be skipped when the user prefers reduced motion.
- **FR-057**: Adding, moving and editing tasks, columns and quick notes MUST NOT affect classes,
  events (beyond FR-035 to FR-050), notes, recordings or documents.
- **FR-058**: Deleting a course MUST NOT delete its tasks: they become personal tasks, after a
  confirmation that says how many; restoring the course's classes from the Trash does not
  reassign them.

### Functional Requirements — Part B: Home Page Panels


**Panels**

- **FR-059**: The home page ("/") MUST show, from left to right: the left card (or its rail), the
  Calendar panel (or its rail) and the Tasks panel (or its rail).
- **FR-060**: Each panel MUST use the card look of the three-card layout (Feature 008): rounded
  corners, thin border, the same gap to its neighbors, and its own independent scrolling.
- **FR-061**: There MUST be no full-width bar above, below or between the panels, and no separate
  page for tasks.
- **FR-062**: The left card MUST keep all of its current behavior, including its width, rail,
  resize, shortcuts and narrow-window behavior.

**Calendar panel**

- **FR-063**: The Calendar panel MUST hold the calendar with all of its views and controls inside
  the card and MUST have exactly one header row of about 40 px containing the date navigation,
  the view switcher, Today, the Tasks / Both / Time switch (FR-046) and a close button; it MUST NOT add
  any other fixed bar.
- **FR-064**: Every calendar control and shortcut available today (including New class, New event
  and the calendar's own keyboard shortcuts) MUST stay reachable from the Calendar panel; controls
  that do not fit in the header row MAY move to a menu in that row.
- **FR-065**: The Calendar panel MUST take all the width the other panels leave free and MUST
  never be narrower than 480 px while open.

**Tasks panel**

- **FR-066**: The Tasks panel MUST have exactly one header row of about 40 px containing the
  the title, the Board/List switch, a search button, a "Filter" button, the New task button and a
  close button, all fitting at the panel's 320 px minimum; it MUST NOT add any other fixed bar. The
  search button MUST expand into a search field over the row (Escape or clearing collapses it).
  The "Filter" button MUST open a pop-up with the course, event-linked and show/hide Done filters
  and MUST show how many filters are active (search included).
- **FR-067**: The Tasks panel's default width MUST be about 420 px.
- **FR-068**: A divider between the Calendar and Tasks panels MUST let the user resize the Tasks
  panel by pointer and by keyboard; the Tasks panel MUST never be narrower than 320 px or wider
  than 60% of the window, and the Calendar panel's 480 px minimum always holds.
- **FR-069**: When the Calendar panel is closed, the Tasks panel MUST fill the available width
  (and the divider has no effect); when the Calendar panel reopens, the Tasks panel MUST return to
  its remembered width, clamped to the limits.

**Closing and the rail**

- **FR-070**: Each panel MUST have a close button in its header and a keyboard shortcut that
  toggles it: Shift+C for the Calendar panel and Shift+T for the Tasks panel, ignored while the
  user is typing text and shown in the buttons' tooltips and the shortcuts help.
- **FR-071**: Closing MUST use a short animation and leave a rail about 44 px wide in the same
  style as the left card's rail, in the panel's position.
- **FR-072**: A rail MUST hold a button that reopens the panel, an icon and a vertical label
  ("Calendar" or "Tasks"), and MUST be fully operable by keyboard.
- **FR-073**: The Tasks rail MUST show the number of open tasks (tasks not in a column that counts
  as done) and, when at least one open task is overdue, an overdue indicator that does not rely on
  color alone (for example a symbol plus an accessible label such as "2 overdue").
- **FR-074**: The rail's count and overdue indicator MUST stay current while the panel is closed
  (tasks changed elsewhere, or a due time passing).
- **FR-075**: Closing a panel MUST NOT lose its state: when reopened, the Calendar panel shows the
  same view and date, and the Tasks panel keeps its view, filters, scroll position and width;
  any unfinished input inside a panel is kept.

**At least one open**

- **FR-076**: At least one of the Calendar and Tasks panels MUST always be open.
- **FR-077**: When only one is open, its close button MUST be disabled and say "At least one panel
  stays open" (visible on hover and focus, and available to assistive technology), and its close
  shortcut MUST do nothing except announce the same message.

**Width rules**

- **FR-078**: When both panels are open, the Calendar panel MUST be at least 480 px and the Tasks
  panel at least 320 px wide.
- **FR-079**: If the window, with the left card open or closed as it currently is, cannot fit both
  panels at those widths, opening one panel MUST close the other to its rail, and the user MUST be
  told with a short message that is shown on screen and announced.
- **FR-080**: If both panels are open and the window or the left card changes so both no longer
  fit, the Tasks panel MUST close to its rail and the user MUST be told in the same way.
- **FR-081**: Below 1100 px window width, the left card MUST start closed as in the three-card
  layout, and at most one of the two panels MUST be open at a time, with the behavior of FR-079.
- **FR-082**: Window widths below 800 px are out of scope; no requirement applies to them.

**State**

- **FR-083**: Which panels are open and the Tasks panel's width MUST be remembered per browser.
- **FR-084**: On first use, in a window of 1100 px or wider both panels MUST be open; in a narrower
  window the Calendar panel MUST be open and the Tasks panel a rail.
- **FR-085**: Remembered state MUST be applied within the width rules on load (FR-078 to FR-081),
  without a message.

**Focus mode**

- **FR-086**: On the home page, focus mode MUST hide the left card (and its rail) and both panel
  rails, leaving the open panels; using focus mode again MUST restore everything as it was.
- **FR-087**: The focus mode button MUST stay reachable on the home page while focus mode is on.

**Other pages**

- **FR-088**: Course pages, the session and event workspaces and every other page MUST keep their
  current layout.
- **FR-089**: Leaving the home page and returning to it MUST restore the open/closed state, sizes
  and scroll positions of both panels.

**Keyboard and accessibility**

- **FR-090**: Each panel MUST be a landmark with an accessible name ("Calendar", "Tasks").
- **FR-091**: Every icon-only button, including rail buttons, close buttons and the divider, MUST
  have an accessible name.
- **FR-092**: Opening and closing a panel MUST be announced to assistive technology.
- **FR-093**: After closing a panel, keyboard focus MUST move to that panel's rail button (or, in
  focus mode, to the first control of the other panel); after reopening, focus MUST move to the
  first control of the panel.
- **FR-094**: The new panel shortcuts MUST NOT conflict with browser shortcuts, the note editor,
  the PDF reader, the audio player, the calendar's shortcuts, the task manager's shortcuts or any
  existing app shortcut (including the left card toggle, course search and focus mode), and MUST
  NOT trigger while the user is typing text.
- **FR-095**: The calendar's single-key shortcuts MUST act only when keyboard focus is not inside
  the Tasks panel and the Calendar panel is open.
- **FR-096**: Animations MUST take about 200 ms or less and MUST be skipped when the user prefers
  reduced motion.
- **FR-097**: Everything MUST work by keyboard and pointer in light, dark and custom themes, and
  panels and rails MUST use the existing card, background and border colors; no new theme color
  is introduced.

**Boundaries**

- **FR-098**: The home page layout (Part B) MUST NOT change what the calendar or the task manager
  do; the only calendar changes are those of Part A (FR-035 to FR-051). Nothing in this feature
  changes the audio card.

### Key Entities

- **Task**: Title, description, column, position within the column, due date, due time, course
  (optional), checklist items, quick notes, completion date and time, linked event occurrence
  (optional), and the column it was in before completion. Belongs to one user.
- **Column**: Name (unique per board ignoring case, ≤ 40 characters), position, whether it counts
  as done. A user has one board of 1–12 columns.
- **Checklist item**: Text, ticked or not, position. Belongs to one task.
- **Quick note**: Title, plain text, creation and update times. Belongs to one task.
- **Event link**: Connects a task to one event occurrence; an occurrence has at most one task.
- **Task view preferences** (per browser): Board or List, filters, search text, show Done,
  "Show tasks" on the calendar.
- **Panel**: The Calendar panel or the Tasks panel. Attributes: open or closed (rail), width (Tasks
  panel only), whether it was closed automatically by a width rule.
- **Rail**: The closed form of a panel. Shows a reopen button, icon, vertical label and, for
  Tasks, the open-task count and overdue indicator.
- **Home layout preferences**: Per browser: which panels are open and the Tasks panel width. In
  memory for the browser session: panel scroll positions and the pre-focus-mode snapshot.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can create a task with only a title in under 5 seconds from the home page,
  and a task with a due date and course in under 30 seconds.
- **SC-002**: Every board action (move a card, reorder, add/rename/reorder/delete a column, open
  details, quick notes) can be completed by keyboard alone, and an automated accessibility check
  of the board, list, details and quick-note pop-up reports no violations in light, dark and one
  custom theme.
- **SC-003**: After a reload or restart, 100% of tasks, columns, card order, checklists and quick
  notes are exactly as left.
- **SC-004**: In tests of deletion (task, quick note, checklist item, column, course, event), no
  data is removed without either an Undo of at least 10 seconds or an explicit confirmation.
- **SC-005**: A cancelled or failed move leaves every card in its original place in 100% of tests.
- **SC-006**: With 300 tasks across 12 columns, dragging a card stays smooth and moves, filters and
  view switches respond without a noticeable delay (under 100 ms as perceived).
- **SC-007**: With "Show tasks" off, the calendar looks and behaves exactly as before the feature;
  with it on, no class or event is hidden or shrunk in any view.
- **SC-008**: A linked task's title and due date match its event within one refresh after every
  event change, in 100% of tests.
- **SC-009**: An exported CSV opens in a common spreadsheet program with one row per task and every
  listed field, including non-ASCII characters, intact.


- **SC-010**: At 1366 × 768 on first use, the home page shows the calendar and the task list
  side by side with no page switch, and each panel's fixed header uses at most 40 px of height.
- **SC-011**: In every tested combination of window width (800, 1024, 1099, 1100, 1366, 1920 px)
  and left card open/closed, the Calendar panel is never narrower than 480 px and the Tasks panel
  never narrower than 320 px while open.
- **SC-012**: After closing and reopening either panel, its view, date or filters, scroll position
  and width match the state before closing in 100% of tests.
- **SC-013**: There is no reachable state in which both panels are closed.
- **SC-014**: 100% of calendar actions and shortcuts available before the change are reachable
  from the Calendar panel by both keyboard and pointer, verified against an inventory taken
  before the change.
- **SC-015**: Every automatic close and every open or close is announced; an automated
  accessibility check of the home page finds the two named panel landmarks and no unnamed
  buttons, in light, dark and one custom theme.
- **SC-016**: Open and close transitions complete in 200 ms or less, and with reduced motion
  preferred they complete with no animation.
- **SC-017**: Entering and leaving focus mode, and leaving and returning to the home page, restore
  the exact prior state in 100% of tested panel combinations.
- **SC-018**: The Tasks rail's count and overdue indicator match the task manager's own data in
  100% of tests, including after a due time passes with the panel closed.

## Assumptions

- Part B's Stories 8–10 (panels, rails, at least one open) are prerequisites for Part A's
  stories, since the task manager lives in the Tasks panel; the rail reads "open" and "overdue" as
  defined in Part A.
- A linked task's due date and time are its event occurrence's start date and time.
- Events cannot currently be moved by dragging on the calendar (Feature 009 only drags to create);
  "follows the event when it is moved" means any change to the event's date or time, by whatever
  way the calendar offers.
- "Overdue" means not Done and past due: past the due time, or, for a date-only task, after the end
  of the due day. "Today" and "This week" use the user's time zone and the calendar's week start.
- A due time can be any minute of the day; it is entered the same way as times in the event form.
- Quick-note titles are optional; a note with neither title nor text is discarded.
- The keyboard alternative for reordering columns follows the same pick-up/arrow/drop pattern as
  cards.
- A course page's task list shows open tasks only; Done tasks are reached through the Tasks panel.
- The CSV export puts the checklist and quick notes in one cell each, as readable text; it is a
  one-way export (importing is out of scope).
- The board's appearance follows `design/reference/astryx-kanban-board.tsx`, ported onto the app's
  own components and theme; attribution follows its MIT license.
- Out of scope: repeating tasks, reminders and notifications, priorities, labels, several boards,
  assigning or sharing tasks, turning note checkboxes into tasks, linking tasks to a session or
  note, importing tasks, exporting tasks to calendar files, and rich text or attachments in quick
  notes.

- The home page is "/", which today redirects to the calendar page; existing links to the
  calendar page keep working and lead to the home page with the same view and date.
- The panel shortcuts (Shift+C, Shift+T) sit beside the existing ones (`[` for the left card, `/`
  for course search, `\` for focus mode) and do not clash with the calendar's lowercase keys (`t`,
  `d`, `w`, `m`, `j`, `k`, `n`, `e`, `?`, arrows).
- When a width rule must close a panel because the window or left card changed, the Tasks panel is
  the one closed, so the calendar (the page's original content) stays visible.
- The "user is told" message is a short, non-blocking notice using the app's existing notice style.
- An overdue task is an open task whose due date and time are in the past; tasks without a due date
  are never overdue. Counts above 99 show as "99+".
- Panel scroll positions survive navigation within the app but are not required to survive a
  reload; open/closed state and Tasks width do survive a reload (per browser).
- Focus mode is not remembered across reloads, as in the three-card layout.
- The width rules count the left card at its current width (open) or its rail (closed); below
  1100 px the left card overlays the panels and does not count.
- Below 1100 px, the left card's reopen button sits at the left of the first open panel's header
  row, as it sits in the main card's top bar in the three-card layout.
- Out of scope (home page panels): the Tasks panel on other pages, reordering or swapping panels, detaching panels
  into windows, more panels, changes to the audio card, and phone or tablet layouts.
