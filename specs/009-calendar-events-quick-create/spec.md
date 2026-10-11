# Feature Specification: Calendar Events and Quick Create

**Feature Branch**: `events`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Add events to the calendar, and let users create classes and events directly on the calendar by pressing on a time slot and dragging, like Google Calendar." (Full description covers: Priority 1 events — create, display, workspace, edit and delete; Priority 2 create by pressing and dragging — press and drag, click without dragging, the quick form, becoming final, same result as other ways to create; without a mouse; everywhere; out of scope.)

**Related**: Feature 001 (calendar, classes, repetition, edit/delete scopes, years/semesters/
courses, left panel), 002 (course timeline, session workspace, notes, past/upcoming), 003 (audio
recording), 004 (transcription), 006/007 (session documents and PDF reader), 008 (floating card
layout, "Sessions and notes" section), 005 (Settings — gains a Trash page). This feature
changes how classes are deleted: deleted classes, like deleted events, now go to the Trash. Constitution 1.2.0 Principle II (events stored at the
semester level in a reserved folder that no course name can take) applies directly; Principle I
(no lost work, confirmed destructive operations) and Principle V (themes, keyboard, contrast)
constrain the whole feature. Moving and resizing existing entries by dragging belongs to the
drag and drop feature; importing and exporting events belongs to the import and export feature.

## Clarifications

### Session 2026-10-10

- Q: When an event that has notes, recordings or documents is deleted, what should happen to that content? → A: The delete confirmation asks the user: delete the content with the event, or keep it. Kept content stays in its folder and remains reachable from the semester's Events page, with the event marked "removed". (Replaced by the next answer.)
- Q: Once an event has been removed with its content kept, what can the user do with it later? → A: Replace the keep/delete choice with a Trash in Settings: every deleted class or event goes to the Trash with its files kept on disk; Settings → Trash lists deleted classes and deleted events separately; each entry has a Restore icon (puts it back on the calendar with its data) and a Delete icon (asks "Are you sure?" Yes/No, then removes it and all its files from disk).
- Q: When a whole semester (or a course or year) is deleted, should its classes and events go to the Trash too? → A: Yes; each of its classes and events goes to the Trash as its own entry, and restoring one recreates its missing year, semester or course with the same name.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an event and see it on the calendar (Priority: P1)

The student has a seminar on Thursday from 14:00 to 15:30 that is not part of any course. In the
calendar's controls, next to the way classes are created, they choose "New event", type the
title "AI Seminar", keep the semester preselected from the course they had open ("Fall 2026",
2026), set the date and times, add the room and a link, keep the default blue and save. The
seminar appears on Thursday in the day, week and month views with an Event marker, its title,
time and room. It does not appear on any course's timeline.

**Why this priority**: Events are the new kind of calendar entry everything else in this feature
builds on; without them the calendar cannot hold presentations, exams or office hours.

**Independent Test**: Create a one-off event and a weekly event through "New event"; confirm
they appear in all three calendar views with the Event marker, title and time, and do not appear
on any course timeline or in any session count.

**Acceptance Scenarios**:

1. **Given** a course of "Fall 2026" is open, **When** the user opens "New event", **Then** the
   form shows title, year and semester (preselected to 2026 / Fall 2026), date, start and end
   time, location, links, color (blue by default) and repeat.
2. **Given** no course is open, **When** the user opens "New event", **Then** the year and
   semester used last for an event or class are preselected; with no history, the user must
   choose or create one.
3. **Given** the form, **When** the title is empty, no semester is chosen, or the end time is
   not after the start time, **Then** saving is not possible and the problem is shown next to
   the field.
4. **Given** the user creates a new year and semester inline in the event form, **When** the
   event is saved, **Then** the year and semester exist exactly as if created from the class
   form.
5. **Given** an event repeating weekly on Thursday until the semester ends, **When** saved,
   **Then** it appears every Thursday through the semester end, as a class would.
6. **Given** a saved event, **When** the user views day, week and month views, **Then** the
   event shows its title, time and, when space allows, location, with an Event marker that does
   not rely on color alone.
7. **Given** an event and a class (or two events) overlapping in time, **When** shown in day or
   week view, **Then** both are visible side by side or offset, each clickable, each with a
   readable title, and the full title shows on hover and keyboard focus.
8. **Given** a course with 12 sessions and a semester with 3 events, **When** a session count is
   shown anywhere, **Then** it still says 12.

---

### User Story 2 - Work inside an event and browse a semester's events (Priority: P1)

The student opens the seminar from the calendar. The same workspace as a session opens: they take
notes, record the talk and open the slides PDF. In the left card, under "Fall 2026", an "Events"
entry opens a page listing that semester's events in date order, past ones normal and upcoming
ones muted. While the seminar is open, "Sessions and notes" shows the seminar's notes and the
timeline of Fall 2026's events.

**Why this priority**: An event is only useful if the student can capture what happened in it,
with the same guarantees as a lecture.

**Independent Test**: Open a past event, add a note, record audio and upload a PDF; confirm the
files sit under the semester's reserved events folder in readable sub-folders, and that the
"Events" page and the side card list the event correctly.

**Acceptance Scenarios**:

1. **Given** a past event, **When** opened, **Then** the workspace offers notes, recording,
   transcription and (where available) documents with the same rules as a session.
2. **Given** an upcoming event, **When** opened, **Then** it behaves as an upcoming session does:
   notes can be written and, as Feature 002 now allows for every session, recording is offered too.
3. **Given** an event with a note, a recording and a PDF, **When** the user browses their storage
   outside the app, **Then** they find them under
   `<year>/<semester>/<reserved events folder>/<date and title>/` in `notes/`, `audios/` and
   `documents/`, separate from all course folders.
4. **Given** the left card lists a semester, **When** the user looks at it, **Then** it shows an
   "Events" entry for that semester (also when the semester has no events yet); opening it shows
   a timeline of that semester's events in date order with past/upcoming styling, and each item
   opens the event.
5. **Given** an event is open, **When** the user looks at "Sessions and notes", **Then** it shows
   that event's notes and the timeline of its semester's events instead of a course's sessions.
6. **Given** a user tries to create or rename a course to the reserved events folder name,
   **When** they save, **Then** the name is refused with an explanation.
7. **Given** existing sessions with notes, recordings and documents, **When** this feature ships,
   **Then** they open, behave and are stored exactly as before.

---

### User Story 3 - Edit and delete events (Priority: P1)

The seminar moved to Friday and the room changed. The student edits it; for the weekly office
hour they choose "This and following events". Later they delete a cancelled exam that already has
notes and are told exactly what will be removed.

**Why this priority**: Events change often; without editing and deleting, users would recreate
them and lose their notes.

**Independent Test**: Edit one occurrence and the whole series of a repeating event, try to change
the semester of an event with notes, delete an event with content, and rename/delete a semester
that has events; confirm each outcome and message.

**Acceptance Scenarios**:

1. **Given** any event, **When** edited, **Then** every field (title, semester, date, times,
   location, links, color, repeat) can be changed.
2. **Given** an occurrence of a repeating event, **When** the user edits or deletes it, **Then**
   they choose "This event", "This and following events" or "All events", with the same meaning
   as for classes.
3. **Given** a series-wide edit (following or all) on a series where some occurrences have notes,
   recordings or documents or were edited individually, **When** saved, **Then** those
   occurrences keep their values and the dialog says how many were left unchanged.
4. **Given** an event with no notes, recordings or documents, **When** the user changes its
   semester, **Then** the change is saved; for a repeating event the change applies to the whole
   series, since all occurrences share one semester.
5. **Given** an event (or any occurrence of its series) with notes, recordings or documents,
   **When** the edit form opens, **Then** the semester field is locked and the form explains why.
6. **Given** any event, **When** the user deletes it and confirms, **Then** it leaves the
   calendar and goes to the Trash with all its notes, recordings and documents kept; the
   confirmation names what it contains (counts of notes, recordings, documents) and says it can be
   restored from Settings → Trash.
7. **Given** a semester with events, **When** the user renames or deletes it wherever the app
   allows, **Then** the confirmation names its events alongside its courses and classes; a rename
   applies to the events too (folders stay readable), and a deletion moves each of its classes and
   events to the Trash as its own entry.

---

### User Story 4 - Restore or permanently delete from the Trash (Priority: P1)

The student deleted a class and an exam event by mistake. In Settings → Trash they see two lists,
deleted classes and deleted events. They press Restore on the exam: it is back on the calendar
with its notes and recording. They press Delete on an old test class, answer "Yes" to "Are you
sure?", and it is gone from the app and from disk.

**Why this priority**: Deleting an entry that holds lecture notes or recordings must never lose
work by accident (Constitution Principle I); the Trash is what makes deletion safe.

**Independent Test**: Delete a class with notes and an event with a recording; confirm both
appear in the right Trash list with their files still on disk; restore one and confirm it returns
with its data; permanently delete the other and confirm its files are gone after "Yes" and
untouched after "No".

**Acceptance Scenarios**:

1. **Given** a class or event (one occurrence, part of a series, or a whole series) is deleted,
   **When** the deletion is confirmed, **Then** it leaves the calendar, timelines and lists, and
   one entry appears in Settings → Trash; its stored files stay where they are.
2. **Given** Settings → Trash, **When** opened, **Then** it shows a list of deleted classes and a
   list of deleted events, each entry showing its name (course name or event title), semester,
   date and time (or the dates it covered), when it was deleted, and how many notes, recordings
   and documents it holds.
3. **Given** a Trash entry, **When** the user activates its Restore icon, **Then** the class or
   event returns to the calendar exactly as it was (dates, times, location, links, color,
   repetition, notes, recordings, documents) and leaves the Trash.
4. **Given** a Trash entry, **When** the user activates its Delete icon, **Then** a dialog asks
   "Are you sure?" with Yes and No; **When** they choose No, **Then** nothing changes; **When** they
   choose Yes, **Then** the entry and all its notes, recordings and documents are removed from the
   app and from disk.
5. **Given** a deleted semester whose classes and events are in the Trash, **When** the user
   restores one of them, **Then** its year, semester (and course, for a class) are recreated with
   the same names and it returns to the calendar with its data.
6. **Given** an empty Trash list, **When** shown, **Then** it says there is nothing in the Trash.
7. **Given** the Trash page, **When** used with keyboard only, **Then** every Restore and Delete
   icon is reachable, has an accessible name (e.g., "Restore AI Seminar"), and the dialog takes and
   returns focus.

---

### User Story 5 - Create a class or event by pressing and dragging on the calendar (Priority: P2)

In week view the student presses on Tuesday at 13:00 and drags down to 14:45. A highlighted draft
follows the pointer, labelled "13:00 – 14:45". On release, a small form opens beside the draft;
they switch to Event, type "Study group", keep the semester, and save. The draft becomes the
event in place and a message offers Undo.

**Why this priority**: It makes creating entries much faster and matches how students already use
calendar apps, but events and classes can already be created through the forms.

**Independent Test**: Create a class and an event by dragging and by single click in day and week
view, and an entry by clicking a day in month view; confirm the drafts, the quick form, Undo, and
that results equal entries created through the full forms.

**Acceptance Scenarios**:

1. **Given** day or week view, **When** the user presses on an empty part of a day column and
   moves the pointer, **Then** a highlighted draft spans from the pressed time to the pointer's
   time, snapped to 15 minutes, with a live start–end label.
2. **Given** a drag in progress, **When** the pointer moves above the pressed time, **Then** the
   draft starts at the pointer and ends at the pressed time; the draft is never shorter than 15
   minutes.
3. **Given** a drag in progress, **When** the pointer moves into another day's column, **Then**
   the draft stays in the day where it started, following only the vertical position.
4. **Given** a drag in progress, **When** the pointer nears the top or bottom edge of the visible
   time range, **Then** the time range scrolls in that direction.
5. **Given** a drag in progress, **When** the user presses Escape, **Then** the drag is cancelled
   and nothing is left behind.
6. **Given** a press on an existing entry, **When** the pointer moves, **Then** no draft is
   created.
7. **Given** a press on empty space that overlaps an existing entry's time, **When** the user
   drags, **Then** the draft is created and both it and the existing entry stay visible.
8. **Given** a press and release moving less than about 4 pixels, **When** released, **Then** a
   1-hour draft starts at the clicked time, snapped to 15 minutes, and the quick form opens.
9. **Given** month view, **When** the user clicks an empty part of a day, **Then** a draft for
   that date from 09:00 to 10:00 is created and the quick form opens.
10. **Given** a time in the past, **When** the user drags or clicks there, **Then** a draft is
    created as usual.

---

### User Story 6 - Finish a draft with the quick form (Priority: P2)

On release, the quick form opens next to the draft. The student picks Class or Event, fills in the
few required fields, optionally opens "More options" for the full form, and saves; or cancels and
the draft disappears.

**Why this priority**: The quick form is what turns the gesture into a saved entry; without it
the drag does nothing.

**Independent Test**: For each path — save a class, save a class with a new course, save an event,
change times in the form, "More options", Cancel, Escape, click outside empty and filled, failed
save and retry, Undo — confirm the result.

**Acceptance Scenarios**:

1. **Given** the first quick form ever, **When** it opens, **Then** the type is Class; on later
   opens it is the type used last.
2. **Given** type Class, **When** the user picks an existing course, **Then** Save is enabled and
   the class takes the course name as its title; **When** the user types a new course name,
   **Then** year and semester are asked as well and Save is enabled only when they are chosen.
3. **Given** type Event, **When** title and year/semester are filled, **Then** Save is enabled;
   year/semester are preselected as in "New event".
4. **Given** the quick form is open, **When** the user changes date, start or end time, **Then**
   the draft on the timeline moves or resizes live; an end not after start disables Save and
   shows the problem.
5. **Given** the repeat choice, **When** the user picks "Weekly on <draft weekday>", **Then** the
   saved entry repeats weekly on that weekday with the default end condition used by the full
   form; **When** they pick "Custom", **Then** the full form opens with everything entered so
   far.
6. **Given** anything entered, **When** the user chooses "More options", **Then** the full class
   or event form opens with every value entered so far, and saving there produces the same entry.
7. **Given** valid fields, **When** the user saves, **Then** the entry is stored, the draft turns
   into the final entry in the same place, and a message offers Undo for at least 10 seconds;
   Undo removes only what this creation made (the entry or series, and a course, semester or year
   created inline for it if nothing else uses them).
8. **Given** saving fails, **When** the error returns, **Then** the form stays open with all data,
   shows a clear error, and Save can be retried.
9. **Given** the quick form, **When** the user presses Escape or Cancel, **Then** the draft and
   form are discarded.
10. **Given** nothing has been entered in the form, **When** the user clicks outside it, **Then**
    the draft is discarded; **Given** something has been entered, **Then** the form stays open.
11. **Given** a draft with its form open, **When** the user presses on another empty slot,
    **Then** the same discard rule applies first; if discarded, a new draft replaces it, otherwise
    the existing form stays open.
12. **Given** an unsaved draft, **When** the user navigates to another page or reloads, **Then**
    the draft is discarded and nothing is stored.
13. **Given** an entry created through the quick form, **When** compared with the same entry made
    through "New class"/"New event" or the full form, **Then** it is identical in data, storage,
    workspace, editing and deleting.

---

### User Story 7 - Create entries without a mouse (Priority: P2)

A keyboard user tabs to the time grid, moves a highlighted slot with the arrow keys, extends it
with Shift and arrows, presses Enter to open the quick form, and hears the draft announced.

**Why this priority**: The constitution requires every screen to be fully keyboard operable; the
new gesture must not be pointer-only.

**Independent Test**: With keyboard only, create a class and an event in day and week view, cancel
one with Escape, and confirm screen reader announcements and focus movement.

**Acceptance Scenarios**:

1. **Given** the time grid has focus, **When** the user presses Up/Down, **Then** the highlighted
   slot moves by 15 minutes; Left/Right moves it by one day (week view).
2. **Given** a highlighted slot, **When** the user presses Shift+Down/Shift+Up, **Then** the slot
   is extended or shortened by 15 minutes, never below 15 minutes.
3. **Given** a highlighted slot, **When** the user presses Enter, **Then** the quick form opens for
   that slot and takes focus; when the form closes, focus returns to the calendar.
4. **Given** a draft exists, **When** it is created or changed, **Then** assistive technology
   announces it as "New entry, from <start> to <end>".
5. **Given** a highlighted slot or open draft, **When** the user presses Escape, **Then** it is
   cancelled.
6. **Given** a touch screen, **When** the user taps an empty slot, **Then** a 1-hour draft is
   created and the quick form opens.

### Edge Cases

- A course named exactly like the reserved events folder already exists from before this feature:
  it keeps working and is reported to the user with a prompt to rename it; the events folder is
  not created in a way that merges with it.
- Two events with the same date and title in one semester: each keeps its own readable folder
  (the name is made unique in a readable way, as for sessions).
- An event's title or date changes after content exists: its stored files stay reachable and the
  folder stays readable, following the same rule as sessions when their date changes.
- Repeating event "until semester ends" in a semester without an end date: the form requires an
  end date or another end condition, as for classes.
- A drag that ends exactly where it began after moving more than 4 pixels: treated as a drag with
  the minimum 15-minute length.
- A drag continuing past midnight or before the first hour of the visible day: the draft is
  clamped to the start and end of that day.
- Restoring a class or event whose time now overlaps other entries: it is restored anyway and
  shown side by side with them.
- Restoring a class or event whose folder name is now taken by a newer entry: it is restored and
  its folder stays readable and distinct (made unique as for sessions); no file is overwritten.
- A file of a Trash entry was removed or changed outside the app: Restore and Delete still work;
  missing files are reported, never recreated empty.
- Permanent delete partly fails (e.g., a file is locked): the entry stays in the Trash, the user is
  told which files could not be removed, and can retry.
- Deleting one occurrence of a series and later restoring it: it rejoins its series in its
  original slot.
- Undo after the user already added a note to the new entry: Undo is no longer offered for an
  entry that has content; the message disappears or explains it cannot be undone.
- Undo fails (e.g., server unavailable): the entry stays and the user is told Undo did not happen.
- Window resize or view change while a draft is open: the draft is discarded under the discard
  rule, or kept if the form has content and the view still shows that day.
- Many overlapping entries in a narrow column: every entry stays at least partly visible and
  focusable, with the full title on hover/focus.
- Changing a semester of a repeating event where only one occurrence has content: the semester is
  locked for the whole series.

## Requirements *(mandatory)*

### Functional Requirements

**Events — data and creation**

- **FR-001**: The system MUST support events: calendar entries that belong to exactly one semester
  (a year and a semester) and to no course.
- **FR-002**: The calendar's controls MUST offer "New event" next to the way classes are created,
  opening an event form.
- **FR-003**: The event form MUST contain: title (required), year and semester (required), date,
  start time, end time (after start), location, links, color, and repeat.
- **FR-004**: Year and semester MUST be preselected from the course that is open; otherwise from
  the year and semester used last; the user MUST be able to pick an existing one or create a new
  one inline, as in the class form.
- **FR-005**: Repeat MUST offer the same repetition options as classes (FR-015/FR-017 of
  Feature 001), generating one occurrence per repetition.
- **FR-006**: The default event color MUST be blue, independent of any course color, and
  changeable using the same palette and contrast rules as classes.

**Events — display**

- **FR-007**: Events MUST appear in day, week and month views with the same visual language as
  classes, showing title, time and, when space allows, location, plus an Event marker that does
  not depend on color.
- **FR-008**: Overlapping entries (classes and events in any combination) MUST all be visible,
  placed side by side or offset, never fully hidden, each clickable and focusable, each with a
  readable title and the full title on hover and keyboard focus.
- **FR-009**: Events MUST NOT appear on any course timeline and MUST NOT be counted as class
  sessions anywhere session counts are shown.
- **FR-010**: The left card's course list MUST show an "Events" entry for each semester it lists;
  it MUST open a page with a timeline of that semester's events in date order with the same
  past/upcoming styling as course timelines.
- **FR-011**: While an event is open, the "Sessions and notes" section MUST show that event's
  notes and the timeline of its semester's events instead of a course's sessions.
- **FR-011a**: The course search box MUST continue to filter courses; "Events" entries stay with
  their semester whenever that semester is shown.

**Events — workspace and storage**

- **FR-012**: Opening an event MUST open the same workspace as a session — notes, recordings,
  transcription and, where available, documents — with the same rules as sessions, including the
  past/upcoming rules (Feature 002 Clarifications: recording is allowed for upcoming and past
  sessions alike).
- **FR-013**: Content stored for an event MUST be kept at the semester level as
  `<year>/<semester>/<reserved events folder>/<date and title>/` with `notes/`, `audios/` and
  `documents/` inside, in readable names, separate from course folders (Constitution
  Principle II).
- **FR-014**: The system MUST refuse to create or rename a course to the reserved events folder
  name, with an explanation; the comparison MUST treat names that would map to the same folder as
  equal.
- **FR-015**: Existing session features (workspace, storage, timelines, counts) MUST keep working
  unchanged, except that deleting a class now moves it to the Trash (FR-021 to FR-021d).

**Events — edit and delete**

- **FR-016**: Users MUST be able to edit every field of an event.
- **FR-017**: All occurrences of a repeating event MUST share the same semester; a semester change
  applies to the whole series.
- **FR-018**: An event's semester MUST be changeable only while no occurrence of its series has
  notes, recordings or documents; otherwise the field MUST be locked with an explanation.
- **FR-019**: Editing or deleting an occurrence of a repeating event MUST offer "This event",
  "This and following events" and "All events", with the same meaning as the class scopes.
- **FR-020**: Series-wide edits MUST NOT change occurrences that have notes, recordings or
  documents or that were edited individually; the dialog MUST say how many were left unchanged.
- **FR-021**: Deleting a class or an event (any scope: this one, this and following, all) MUST
  require confirmation; the confirmation MUST name the content involved (counts of notes,
  recordings, documents) and say it can be restored from Settings → Trash.
- **FR-021a**: A confirmed deletion MUST NOT remove any stored file. It MUST remove the deleted
  occurrences from the calendar, course timelines, the Events page and session counts, and create
  one Trash entry holding exactly what that deletion removed.
- **FR-021b**: Settings MUST include a Trash page with two lists — deleted classes and deleted
  events — each entry showing its name, semester, date and time (or covered dates), deletion time
  and content counts, plus a Restore icon and a Delete icon with accessible names.
- **FR-021c**: Restore MUST put the entry back on the calendar with all its data (fields,
  repetition, notes, recordings, documents) as it was before deletion, and remove it from the
  Trash.
- **FR-021d**: The Delete icon MUST ask "Are you sure?" with Yes and No. Only Yes MUST permanently
  remove the entry and all its notes, recordings and documents from the app and from disk; No MUST
  change nothing. This is the only way this feature removes event or class files from disk.
- **FR-022**: Wherever the app lets users rename or delete a semester (or its year), the
  confirmation MUST name the semester's events alongside its courses and classes. A rename MUST
  apply to the events and their stored folder consistently with the semester's classes.
- **FR-022a**: Deleting a year, semester or course MUST move each of its classes and events to the
  Trash as its own entry (no file removed), and the confirmation MUST say so.
- **FR-022b**: Restoring a Trash entry whose year, semester or course no longer exists MUST
  recreate the missing ones with the same names (and their readable folders) before restoring it;
  if one with that name exists again, the entry is restored into it.

**Create by pressing and dragging**

- **FR-023**: In day and week views, pressing on an empty part of a day column MUST start a draft
  entry; pressing on an existing entry MUST NOT.
- **FR-024**: While the button is held, the draft MUST show as a highlighted block from the
  pressed time to the pointer's time with a live start–end label; moving above the pressed time
  makes the draft start earlier.
- **FR-025**: Draft times MUST snap to 15 minutes; minimum length 15 minutes; the draft stays in
  the day where it was started and within that day.
- **FR-026**: Dragging near the top or bottom edge of the visible time range MUST scroll it.
- **FR-027**: Escape during a drag MUST cancel it and leave nothing behind.
- **FR-028**: Overlapping existing entries MUST NOT prevent a draft; existing entries stay visible,
  and a draft MUST NOT shift other entries beyond side-by-side placement of overlaps.
- **FR-029**: A release after moving less than about 4 pixels MUST create a 1-hour draft at the
  clicked time, snapped to 15 minutes. In month view, clicking an empty part of a day MUST create
  a draft for that date from 09:00 to 10:00. Past times are allowed.

**Quick form**

- **FR-030**: On release, a quick form MUST open next to the draft, which stays visible behind it.
- **FR-031**: The quick form MUST offer a Class/Event type switch: Class the first time, then the
  type used last.
- **FR-032**: For Class: a required course (existing, or new by typing a name, which then also
  requires a year and semester); the class's title is its course name.
- **FR-033**: For Event: a required title and a required year and semester, preselected as in
  FR-004.
- **FR-034**: Both types MUST offer date, start and end times (editing them updates the draft
  live), location, links, a repeat choice (does not repeat; weekly on the draft's weekday;
  custom, which opens the full form), and "More options", which opens the full form with
  everything entered so far.
- **FR-035**: Save MUST be enabled only when required fields are valid; Cancel MUST always be
  available.

**Becoming final**

- **FR-036**: Nothing MUST be stored until the user saves. On save, the entry is created, the
  draft becomes the final entry in the same place, and a message offers Undo for at least 10
  seconds.
- **FR-037**: Undo MUST remove only what this creation made, including a course, semester or year
  created inline for it when nothing else uses them; Undo MUST NOT be offered once the entry has
  notes, recordings or documents.
- **FR-038**: If saving fails, the form MUST stay open with its data and a clear error, and Save
  MUST be retryable.
- **FR-039**: Escape or Cancel MUST discard the draft. Clicking outside the form MUST discard the
  draft only if nothing has been entered; otherwise the form stays open. Leaving the page MUST
  discard an unsaved draft.
- **FR-040**: Only one draft MUST exist at a time; pressing on an empty slot while a draft is open
  replaces it, after the discard rule in FR-039.
- **FR-041**: Entries created by pressing and dragging MUST be identical to those created through
  "New class", "New event" and the full forms, and behave identically afterwards.

**Keyboard, touch and accessibility**

- **FR-042**: The time grid MUST be focusable by keyboard: arrows move a highlighted slot by 15
  minutes and by day, Shift+arrows extend or shorten it (minimum 15 minutes), Enter opens the
  quick form, Escape cancels.
- **FR-043**: A draft MUST be announced to assistive technology with its start and end ("New
  entry, from 10:00 to 11:15"); the quick form MUST take focus when it opens and return focus to
  the calendar when it closes.
- **FR-044**: On touch screens, a tap on an empty slot MUST create the 1-hour draft; touch dragging
  is not supported.
- **FR-045**: Everything in this feature MUST work with keyboard and pointer in light, dark and
  custom themes; color MUST never be the only way to tell entries apart (Event marker and title
  always present); animations MUST be skipped when the user prefers reduced motion.

### Key Entities

- **Event**: A calendar entry that belongs to one semester and no course. Attributes: title, date,
  start time, end time, location, links, color (default blue), whether it was edited
  individually, and whether it is in the Trash. Has notes, recordings and documents like a session, stored in its own readable
  folder under the semester's reserved events folder.
- **Event series**: The repetition rule shared by the occurrences of a repeating event (same
  options as class repetition). All occurrences share one semester.
- **Trash entry**: What one confirmed deletion of a class or event removed — kind (class or
  event), the occurrences or series involved, its semester (and course for a class), deletion
  time, and its kept notes, recordings and documents. Can be restored or permanently deleted.
- **Semester** (existing): Now contains courses and events. Renaming it involves both; deleting it
  moves its classes and events to the Trash.
- **Reserved events folder** (storage concept): One folder per semester holding all its events;
  its name can never be taken by a course.
- **Draft** (not stored): A temporary entry on the calendar with date, start, end and the quick
  form values; at most one exists; it disappears unless saved.
- **Last-used choices** (user preference): The last year/semester used for an event or class, and
  the last type chosen in the quick form.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a one-off event through "New event" in under 30 seconds and see it
  in day, week and month views.
- **SC-002**: A user can create a class or event by pressing, dragging and saving the quick form in
  under 15 seconds, without opening the full form.
- **SC-003**: The draft follows the pointer without visible lag: its label and size update within
  one screen refresh of the pointer moving, in weeks with up to 50 entries.
- **SC-004**: 100% of entries in a view with overlapping classes and events (up to 4 overlapping at
  once) are visible, clickable and focusable, with readable titles.
- **SC-005**: 100% of event notes, recordings and documents can be found and opened with ordinary
  OS tools under the semester's events folder, without the app.
- **SC-006**: Entries created by dragging and by the full forms are indistinguishable in all
  comparisons (data, storage location, workspace, editing, deleting).
- **SC-007**: Every creation path in this feature can be completed with keyboard only, and every
  draft is announced with its start and end time.
- **SC-008**: Apart from deleted classes going to the Trash, no existing session, note, recording
  or document behaves differently after the feature ships (all other existing tests still pass).
- **SC-009**: Undo after a quick creation leaves the calendar and storage exactly as before that
  creation in 100% of cases where Undo is offered.
- **SC-010**: 100% of deleted classes and events keep every stored file until the user confirms
  "Yes" in the Trash, and 100% of restored entries match their state before deletion.

## Assumptions

- "The one used last" for year and semester is shared between the class form, the event form and
  the quick form, and is remembered per user across sessions.
- The "Events" entry is shown for every semester the left card lists, including semesters with no
  events yet, so the user can find the page; an empty page explains there are no events.
- "Weekly on the draft's weekday" in the quick form uses the same default end condition as the
  full form's weekly repetition (until semester ends when the semester has an end date; otherwise
  the user is sent to the full form to choose one).
- An event's folder name combines its date and title in readable form, made unique within the
  semester the same way session folders are.
- Event deletion scopes and semester rename/delete reuse the existing session and semester rules
  from Features 001, 002, 006 and 007, extended to events.
- The exact reserved events folder name is decided in the plan (Constitution Principle II);
  existing courses that already use that name are reported and must be renamed by the user.
- "Clicking outside the form" counts selection or focus of anything outside the quick form, the
  draft, and the form's own pop-ups (such as date pickers or course lists).
- The Trash keeps entries until the user deletes them; there is no automatic emptying and no
  "Empty Trash" action in this feature.
- The Trash covers deleted classes and events only; notes, recordings and documents deleted
  individually inside a workspace keep their existing permanent-delete behavior.
- Moving and resizing existing entries by dragging, and import/export of events, are out of scope
  and specified in their own features. Also out of scope: all-day and multi-day events, attendees,
  reminders, notifications, invitations, events belonging to a course, events without a semester,
  moving an event's content between semesters, multi-day or month-view dragging, touch dragging.
