# Feature Specification: Study Time Tracking (Time mode)

**Feature Branch**: `020-study-time-tracking`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "Add a Time mode for tracking study time, like Toggl: a timer in three styles (Track, Pomodoro and Focus session), tags, time entries that appear in the calendar, and reports as a table and a pie chart. Time mode lives in the right panel of the home page, the panel that holds the task manager, as a second mode of that panel, not on a page of its own. A running timer shows a floating indicator everywhere in the app." (Full description covers: where it lives, rules for all timers, Track, Pomodoro, Focus session, floating indicator, alerts, tags, calendar, Priority 2 reports and links, Priority 3 extras, everywhere rules, out of scope. Every rule in it is carried into this spec.)

**Related**: Feature 012 (home page panels and the Tasks panel: rail, resizing, remembered state,
320 px minimum width), feature 008 (floating cards, focus mode that hides the side cards),
feature 003 (recording and its floating recording indicator), feature 001 / 009 (calendar day,
week and month views, events), feature 005 (Settings, themes), feature 019 (editable shortcuts).

## Context

Students want to know how much they actually study and to study in structured blocks. Today the
app plans study (calendar, tasks) but does not measure it. This feature adds a timer and a log of
time entries in the home page's right panel, shows those entries on the calendar, and summarises
them in reports. It does not add a new page and does not change how the task manager, calendar
items or recording behave.

## Clarifications

### Session 2026-11-02 (found during planning)

- The right panel already switches between Tasks and General notes (feature 018). Time is added
  as a third item of that switch; General notes is kept, not replaced.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Track time with a start/stop timer (Priority: P1)

On the home page the student switches the right panel from Tasks to Time, types "Linear algebra
problem set", picks the tag "Homework" and presses Start. The time counts up. Later they press
Stop and the entry appears in Today with its duration, and the day's total grows.

**Why this priority**: Measuring time is the core of the feature; every other story builds on
saved entries.

**Independent Test**: Start a Track timer, close the app, reopen it after two minutes, see the
timer still running with the right elapsed time, stop it and see one entry in Today.

**Acceptance Scenarios**:

1. **Given** the right panel in Tasks mode, **When** the user chooses Time in the panel header,
   **Then** Time mode shows the timer card (with Track, Pomodoro and Focus), then the Today /
   Reports switch, then Today's entries with the day's total; the mode is remembered after a reload.
2. **Given** Time mode with no timer running, **When** the user enters an optional description and
   tag and presses Start, **Then** the time counts up from 0:00:00.
3. **Given** a running Track timer, **When** the user presses Stop, **Then** an entry is saved with
   the description, tag, start and end, and it appears in Today in time order with its duration.
4. **Given** a timer has run for less than 5 seconds, **When** the user stops it, **Then** no entry
   is saved, a message says so and offers Undo, and Undo restores the running timer as it was.
5. **Given** a running timer, **When** the window is closed, the app restarts, the computer sleeps
   or a second window is opened, **Then** on return every window shows the same elapsed time,
   computed from the stored start.
6. **Given** a running timer found when the app opens, **When** the user chooses "Stop and set end
   time", **Then** they can choose an end time between the start and now and the entry is saved
   with that end.
7. **Given** a timer runs, **When** the user starts another timer (from any window or mode),
   **Then** the first is stopped and saved, the new one starts, and a message with Undo appears;
   Undo removes the new timer and resumes the first as if it had not stopped.
8. **Given** starting, stopping or saving fails (for example the connection to the server drops),
   **When** the failure happens, **Then** the user is told, the action is retried, and the
   timer's start and end times are kept until they are saved.

---

### User Story 2 - Manage entries: add, edit, delete, start again (Priority: P1)

The student forgot to start the timer this morning, so they use "Add time" to log 9:00 to 10:30.
They fix a typo in another entry's description, delete a mistaken one, and use "Start again" on
yesterday's "Reading" entry.

**Why this priority**: Without correcting and adding entries, the log is not trustworthy.

**Independent Test**: Add a manual entry, edit its start, delete it, undo the delete, and use
Start again; check Today and the day's total after each step.

**Acceptance Scenarios**:

1. **Given** Time mode, **When** the user chooses "Add time" and enters a start and either an end
   or a duration, an optional description and tag, **Then** the entry is saved and listed.
2. **Given** the new or edited entry overlaps another entry, **When** the form shows, **Then** it
   says that it overlaps (naming the other entry) and still lets the user save.
3. **Given** an entry, **When** the user edits its description, tag, start or end, **Then** the
   change is saved and shown everywhere the entry appears (Today, calendar, reports).
4. **Given** an entry, **When** the user deletes it, **Then** it disappears and a message with Undo
   stays for at least 10 seconds; Undo restores it unchanged.
5. **Given** an entry in Today, **When** the user chooses "Start again", **Then** a Track timer
   starts with that entry's description, tag and link.
6. **Given** the end is before the start, or the duration is zero or negative, **When** the user
   saves, **Then** the form refuses and says why.

---

### User Story 3 - Floating indicator everywhere (Priority: P1)

The student starts a timer on the home page and opens a session's notes. A small floating
indicator, like the recording indicator, shows the timer's time and description with Pause and
Stop. Clicking its label brings them back to Time mode on the home page.

**Why this priority**: A timer the user cannot see is a timer they forget to stop.

**Independent Test**: Start a timer, visit every page, enter focus mode and close the right panel;
confirm the indicator is present except while the timer card itself is visible.

**Acceptance Scenarios**:

1. **Given** a running timer, **When** the user is on any page where the timer card is not
   visible, **Then** the floating indicator shows in the recording indicator's place and style,
   with the timer style's icon, the time (elapsed for Track, remaining for Pomodoro and Focus),
   the description or else the tag name, and Pause and Stop buttons.
2. **Given** the indicator, **When** the user activates its label, **Then** the app goes to the home
   page if needed, opens the right panel if it is closed, switches it to Time mode, and moves
   focus to the timer card.
3. **Given** the timer card is visible on screen, **When** the timer runs, **Then** the indicator is
   hidden; when the card scrolls out of view or the panel closes, the indicator appears.
4. **Given** a running timer, **When** focus mode is on or the right panel is a rail, **Then** the
   indicator stays visible.
5. **Given** a screen reader, **When** the timer runs, **Then** it is not told each second; it is
   told when a phase changes and when the timer ends or stops.
6. **Given** the right panel is closed to its rail, **When** a timer runs, **Then** the rail's Time
   icon shows the running time or a running mark that does not rely on color alone.
7. **Given** a timer has run longer than the long-running threshold (3 hours by default),
   **When** the threshold passes, **Then** the indicator (or the timer card when it is visible)
   asks "Still working?" with Keep running and Stop; Keep running dismisses it until the next
   multiple of the threshold.

---

### User Story 4 - Pomodoro (Priority: P1)

The student chooses Pomodoro and presses Start. The card shows "Work 1 of 4" and 25:00 counting
down. When it ends, a sound plays and a message says the break can start; they start the 5-minute
break. After the fourth work period they get a 15-minute long break.

**Why this priority**: Pomodoro is the most requested structured study method.

**Independent Test**: With work set to 1 minute and breaks to 1 minute, run a full cycle and
check alerts, the phase labels, and that only work periods appear as entries.

**Acceptance Scenarios**:

1. **Given** default settings, **When** the user starts Pomodoro, **Then** a 25-minute work period
   counts down and the card shows "Work 1 of 4".
2. **Given** a work period ends, **When** automatic start is off, **Then** the app alerts the user,
   saves the work period as an entry with the timer's description and tag, and waits for the user
   to start the break; with automatic start on, the break starts by itself.
3. **Given** the fourth work period ends, **When** the next phase begins, **Then** it is the long
   break (15 minutes by default), after which the cycle starts again at "Work 1 of 4".
4. **Given** a running phase, **When** the user pauses, resumes, skips the phase or resets the
   cycle, **Then** the timer does so; a work period that is skipped or reset after it started is
   saved for the time worked; breaks are never saved.
5. **Given** a phase ends while the app is closed or the computer sleeps, **When** the app returns,
   **Then** the work entry ends at the planned end (not at the moment of return) and a message says
   when the phase finished.
6. **Given** Settings, **When** the user changes work (1–120 min), short break (1–60), long break
   (1–120), periods before the long break (2–8) or automatic start, **Then** values outside the
   range are refused and the new values apply from the next phase.

---

### User Story 5 - Focus session (Priority: P2)

Before an exam the student picks a 90-minute Focus session, writes the goal "Finish chapter 6
summary" and turns on "Hide panels while focusing". The side cards hide. At the end a sound plays,
the entry is saved and the layout returns to how it was.

**Why this priority**: Valuable, but Track and Pomodoro cover most needs.

**Independent Test**: Start a 1-minute Focus session with "Hide panels while focusing", extend it
by 5 minutes, finish early, and confirm the saved time and the restored layout.

**Acceptance Scenarios**:

1. **Given** Focus, **When** the user picks 25, 45, 60 or 90 minutes or a custom value of 1–480
   minutes and an optional goal, and starts, **Then** the time counts down and the goal is shown.
2. **Given** a running Focus session, **When** the user pauses, extends by 5 minutes or finishes
   early, **Then** the timer does so; finishing early saves the time so far.
3. **Given** "Hide panels while focusing" is on, **When** the session starts, **Then** the app's
   focus mode turns on, and when the session ends or is finished early the layout returns to what
   it was before (if focus mode was already on, it stays on).
4. **Given** the session ends, **When** time is up, **Then** the app alerts the user and saves the
   entry, with the goal as its description when no description was given.

---

### User Story 6 - Tags (Priority: P1)

The student creates tags "Homework", "Reading" and "Exam prep", each with a color, and picks them
when starting timers. Later they rename "Reading" to "Readings" and every entry shows the new name.

**Why this priority**: Tags are how time is grouped in the calendar and reports.

**Independent Test**: Create, rename, recolor and delete a tag that is used by entries, and check
the entries in Today and the calendar after each step.

**Acceptance Scenarios**:

1. **Given** the tag picker, **When** the user types, **Then** the list filters, and "Create tag"
   creates a tag with the typed name and lets them pick a color.
2. **Given** an existing tag "Homework", **When** the user creates "homework", **Then** it is refused
   as a duplicate; names are required and at most 30 characters.
3. **Given** a tag used by entries, **When** it is renamed or recolored, **Then** the change shows
   everywhere it is used.
4. **Given** a tag used by 12 entries, **When** the user deletes it, **Then** the app asks first and
   says "12 entries use this tag"; after confirming, the entries stay and become untagged.
5. **Given** any place a tag is shown, **When** it is displayed, **Then** its name is shown with its
   color, so tags are never told apart by color alone.

---

### User Story 7 - Time entries on the calendar (Priority: P2)

In the week view the student sees thin colored blocks at the right edge of each day showing when
they studied, beside their classes, without covering them. In the month view each day shows its
total.

**Why this priority**: Seeing planned versus actual time is a strong motivator, but depends on P1.

**Independent Test**: Create overlapping entries, an entry across midnight and a running timer;
check the day, week and month views with "Show time" on and off.

**Acceptance Scenarios**:

1. **Given** day or week view with "Show time" on, **When** entries exist, **Then** each appears as a
   thin block in a narrow lane at the right edge of its day column, colored by its tag (neutral
   when untagged), never covering classes, events or tasks; overlapping entries sit side by side in
   the lane.
2. **Given** a running timer, **When** the user looks at today, **Then** its block grows as time
   passes.
3. **Given** month view, **When** "Show time" is on, **Then** each day shows its total tracked time.
4. **Given** an entry block, **When** it is hovered or focused by keyboard, **Then** its description,
   tag and times are shown; activating it opens the entry in the Time panel, reopening the panel
   if closed.
5. **Given** an entry from 23:00 to 01:00, **When** shown, **Then** each day shows and counts only its
   own part (one hour each).
6. **Given** the lane, **When** the user presses or drags in it, **Then** no class or event creation
   starts.
7. **Given** the "Show time" switch in the calendar header (on by default), **When** turned off,
   **Then** time entries disappear from the calendar and nothing else changes; the choice is
   remembered per browser.

---

### User Story 8 - Alerts (Priority: P1)

The student is reading a PDF in another app when a Pomodoro work period ends. A sound plays and a
system notification tells them it is break time.

**Why this priority**: A countdown without an alert does not work for Pomodoro or Focus.

**Independent Test**: With the window hidden or in the background, let a 1-minute phase end and
confirm sound and notification arrive within 2 seconds of the planned end.

**Acceptance Scenarios**:

1. **Given** a Pomodoro phase or Focus session ends, **When** the app is in the foreground, **Then**
   it plays a sound (if sound is on) and shows a message in the app.
2. **Given** the app is in the background or hidden and system notifications are allowed and on,
   **When** a phase ends, **Then** a system notification also appears, on time.
3. **Given** Settings, **When** the user turns system notifications on, **Then** the app explains why
   it asks for permission before asking; if permission is refused, it says so and in-app alerts
   still work.

---

### User Story 9 - Recording and a timer together (Priority: P2)

The student records a lecture and starts a Track timer. By default one combined indicator shows
the recording (red dot and recording time) and the timer side by side, each with its own controls.

**Why this priority**: Recording during class is common; the two indicators must not fight.

**Independent Test**: With a recording running, start and stop a timer under each of the three
settings; confirm the recording is never hidden, paused or stopped by the timer, and vice versa.

**Acceptance Scenarios**:

1. **Given** "One combined indicator" (default), **When** both run, **Then** one indicator shows the
   recording and the timer side by side, each with its own controls.
2. **Given** "Two indicators, stacked", **When** both run, **Then** the recording indicator is shown
   above the timer indicator.
3. **Given** "Recording first", **When** both run, **Then** only the recording indicator shows, with
   a small badge showing the timer's time; when the recording ends the timer's indicator returns.
4. **Given** any option, **When** the user starts, pauses or stops either one, **Then** the other is
   unaffected and the recording is never hidden.
5. **Given** the setting, **When** changed, **Then** it is remembered for the user on every device.

---

### User Story 10 - Reports (Priority: P2)

At the end of the week the student opens Reports, chooses "This week" grouped by tag, and sees the
total, a table and a donut chart. Choosing "Exam prep" lists its entries.

**Why this priority**: Reports turn entries into insight; depends on P1 data.

**Independent Test**: With known entries, check totals, percentages and entry counts for each
period and grouping, and switch between table and chart at 320 px.

**Acceptance Scenarios**:

1. **Given** Reports, **When** the user chooses today, this week, this month or a custom range, and
   previous or next, **Then** the total tracked time for that period is shown.
2. **Given** a grouping by tag, by course or by day, **When** shown as a table, **Then** each row has
   name, time, share in percent and number of entries; untagged time is "No tag", entries without a
   course are "No course".
3. **Given** the chart view, **When** shown, **Then** the donut has labeled slices, a legend with
   times, a text alternative, and slices told apart without color; slices below 3% are merged into
   "Other" in the chart but stay separate in the table.
4. **Given** a row or slice, **When** chosen, **Then** its entries are listed.
5. **Given** a 320 px panel, **When** Reports is open, **Then** the table comes first and nothing
   scrolls sideways.

---

### User Story 11 - Link timers to tasks, sessions, events and courses (Priority: P2)

The student presses "Start timer" on a task card; the timer shows the task's name and the entry is
linked to it. A session's page shows "Time tracked: 1 h 20 min".

**Why this priority**: Links give context and make course reports possible.

**Independent Test**: Start timers from a task, a session and an event; link an entry to a course;
check the session page's total and the by-course report.

**Acceptance Scenarios**:

1. **Given** a task card, a session or an event, **When** the user starts a timer from it, **Then**
   the timer is linked to it and shows its name, and the saved entry keeps the link.
2. **Given** an entry, **When** the user links it to a course, **Then** it counts under that course
   in reports; an entry linked to a session or event counts under that session's course.
3. **Given** a session's page, **When** opened, **Then** it shows the total time tracked for it.
4. **Given** a task with a running timer, **When** the task is completed, **Then** the timer keeps
   running.
5. **Given** a linked task, session, event or course is deleted, **When** its entries are shown,
   **Then** they stay, without the link.

---

### User Story 12 - Extras (Priority: P3)

The student sets a daily goal of 4 hours and sees progress, exports entries to CSV, looks at a
weekly totals view, sees "3 Pomodoros today" and uses a shortcut to start and stop.

**Why this priority**: Nice to have once the core works.

**Independent Test**: Set a goal, track time, export a range to CSV and open it in a spreadsheet,
and use the shortcut from any page.

**Acceptance Scenarios**:

1. **Given** a daily goal, **When** time is tracked, **Then** Today shows progress toward it.
2. **Given** a chosen range, **When** the user exports CSV, **Then** a file with one row per entry
   (date, start, end, duration, description, tag, link) is saved, times in the user's time zone.
3. **Given** the weekly totals view, **When** opened, **Then** it shows each day's total for the week.
4. **Given** Pomodoro use today, **When** Time mode is shown, **Then** it shows the number of work
   periods completed today.
5. **Given** the start/stop shortcut, **When** pressed with no timer, **Then** a Track timer starts;
   when pressed with a timer running, **Then** it stops; the shortcut is editable like other
   shortcuts.

---

### Edge Cases

- Two windows press Start at the same moment: the server keeps one running timer; the other window
  shows the replacement message with Undo, and both windows agree within a few seconds.
- A timer is stopped in one window while another window is offline: the offline window shows the
  stop when it reconnects and never re-saves the entry twice.
- The device clock is wrong: elapsed and remaining time are computed from the stored server times,
  corrected for the difference between the device and server clocks.
- A daylight-saving change during a running timer: the duration is real elapsed time (for example
  a 1:00–3:00 run across the spring-forward change shows 1 hour), and the shown clock times are
  local.
- An entry spans several days: it appears and is counted on each day for its own part.
- A Pomodoro or Focus timer is paused when the app closes: it stays paused, and remaining time is
  unchanged on return.
- A Pomodoro phase ends while the app is closed and automatic start is on: no further phases run
  while closed; on return the app says when the phase finished and waits for the user.
- "Stop and set end time" is given an end before the start or in the future: refused, with a reason.
- A running timer longer than 24 hours: still runs; the indicator shows hours beyond 24 (e.g.
  "26:14:03") and the long-running reminder has asked at each threshold.
- The tag of a running timer is deleted: the timer continues untagged.
- Undo after the replaced timer was already edited elsewhere: Undo reports that it can no longer
  undo instead of overwriting.
- Focus session with "Hide panels while focusing" while the user manually leaves focus mode
  mid-session: the session continues; at the end the layout is not changed again.
- The calendar day column is very narrow: the lane stays at least wide enough for one block and a
  keyboard focus ring, and blocks too short to see are drawn at a minimum height.
- Reports for a period with no entries: total 0 and a message, no empty chart.
- The panel is below 1100 px or both home panels cannot fit: the existing one-panel-open rule from
  feature 012 applies unchanged.

## Requirements *(mandatory)*

### Functional Requirements

**Panel and Time mode**

- **FR-001**: The home page's right panel MUST have a mode switch in its header with the modes
  Tasks and Time. The panel's existing General notes section (feature 018) stays as a third item
  of the same switch (Tasks, General notes, Time). Tasks and General notes MUST behave exactly as
  before.
- **FR-002**: The panel MUST keep its existing behaviors (closing to a rail, resizing, remembered
  open/closed state and width, 320 px minimum width) in both modes.
- **FR-003**: The rail MUST show one icon per mode (Tasks, General notes, Time); each reopens the panel in that mode. While a
  timer runs, the Time icon MUST show the running time or a running mark that does not rely on
  color alone.
- **FR-004**: The chosen mode MUST be remembered per browser. The panel's accessible name MUST be
  "Tasks and time".
- **FR-005**: Time mode MUST show, top to bottom: the timer card with a Track / Pomodoro / Focus
  switch; a Today / Reports switch; then either Today (the day's entries in time order with
  durations and the day's total) or Reports. It MUST add no other fixed bar and MUST work at 320 px.

**All timers**

- **FR-006**: At most one timer MUST run per user at any time, across all windows and devices.
- **FR-007**: The running timer's start time (and, for paused timers, accumulated state) MUST be
  stored on the server; elapsed and remaining time MUST always be computed from stored times,
  never by counting ticks.
- **FR-008**: A running timer MUST survive closing the window, restarting the app, a crash, sleep,
  and a second window; on open the app MUST show how long it has run and offer "Stop and set end
  time".
- **FR-009**: A timer MUST have an optional description, an optional tag, and (Priority 2) an
  optional link to a course, a session or event, or a task.
- **FR-010**: Starting a timer while another runs MUST stop and save the first, start the new one,
  and show a message with Undo.
- **FR-011**: Stopping MUST save an entry; a run shorter than 5 seconds MUST NOT be saved, and the
  user MUST be told, with Undo.
- **FR-012**: If starting, stopping or saving fails, the user MUST be told, the action MUST be
  retried, and no start or end time may be lost silently.
- **FR-013**: When a timer has run longer than the long-running threshold (default 3 hours,
  adjustable 1–12 hours or off in Settings), it MUST ask "Still working?" with Keep running and
  Stop, once per multiple of the threshold.
- **FR-014**: Pausing a timer MUST end the current running stretch; for Track, Pause saves the
  entry and Resume starts a new entry with the same description, tag and link; for Pomodoro and
  Focus, paused time MUST NOT count toward the saved entry.

**Track**

- **FR-015**: Track MUST count up from Start and save an entry on Stop.
- **FR-016**: "Add time" MUST create a manual entry from a start plus an end or a duration, with
  optional description and tag; it MUST refuse an end not after the start.
- **FR-017**: Entries MAY overlap; the add and edit forms MUST say when an entry overlaps another.
- **FR-018**: Users MUST be able to edit an entry's description, tag, start and end (and link, in
  Priority 2), and delete it with Undo available for at least 10 seconds.
- **FR-019**: Each entry in Today MUST offer "Start again", which starts a Track timer with its
  description, tag and link.

**Pomodoro**

- **FR-020**: Pomodoro MUST default to 25-minute work periods, 5-minute short breaks, a 15-minute
  long break after 4 work periods, and automatic start off; Settings MUST allow work 1–120 minutes,
  short break 1–60, long break 1–120, periods before long break 2–8, and automatic start on/off.
- **FR-021**: The Pomodoro timer MUST count down and show the phase and the period ("Work 2 of 4").
- **FR-022**: Each finished or stopped work period MUST be saved as an entry with the timer's
  description, tag and link; breaks MUST NOT be saved.
- **FR-023**: At a phase end the app MUST alert the user and wait for the user to start the next
  phase, unless automatic start is on.
- **FR-024**: The user MUST be able to pause, resume, skip a phase and reset the cycle.
- **FR-025**: If a phase ends while the app is closed or the computer sleeps, the work entry MUST
  end at the planned end, and on return the app MUST say when the phase finished; no further phase
  starts automatically while the app was not running.

**Focus session**

- **FR-026**: Focus MUST offer lengths of 25, 45, 60 and 90 minutes and a custom value of 1–480
  minutes, and an optional goal.
- **FR-027**: A Focus session MUST count down and can be paused, extended by 5 minutes (any number
  of times, up to a total of 480 minutes) and finished early, saving the time so far.
- **FR-028**: With "Hide panels while focusing" on, starting the session MUST turn on the app's
  focus mode and its end MUST restore the layout that was in place before; if the user changes the
  layout during the session, the end MUST NOT change it again.
- **FR-029**: At the end the app MUST alert the user and save the entry; a Focus session is
  distinct from layout focus mode and the app MUST NOT attempt to block other apps or websites.

**Floating indicator**

- **FR-030**: While a timer runs, a floating indicator MUST show on every page, in the same style
  and place as the recording indicator, with the timer style's icon, its time (elapsed for Track,
  remaining for Pomodoro and Focus), its description or else its tag, and Pause and Stop buttons.
- **FR-031**: Activating the indicator's label MUST open Time mode in the home page's right panel,
  going to the home page and reopening the panel as needed.
- **FR-032**: The indicator MUST be hidden while the running timer's card is visible on screen,
  and MUST stay visible in focus mode and when the panel is closed.
- **FR-033**: The indicator MUST update every second visually, but announce to assistive
  technology only phase changes, the end and stops. It MUST be fully keyboard operable and MUST
  NOT animate when the user prefers reduced motion.
- **FR-034**: Settings MUST offer "Indicator when recording and timer run together" with "One
  combined indicator" (default), "Two indicators, stacked" (recording above), and "Recording first"
  (recording indicator only, with a badge showing the timer's time; the timer indicator returns
  when the recording ends), remembered per user.
- **FR-035**: Under every option, a recording MUST never be hidden or interrupted by a timer, and
  starting, pausing or stopping either MUST NOT change the other.

**Alerts**

- **FR-036**: At the end of a Pomodoro phase or Focus session the app MUST play a sound (if on)
  and show an in-app message, and, when the app is not in the foreground and permission is given
  and the setting is on, show a system notification.
- **FR-037**: Alerts MUST arrive within 2 seconds of the planned end even when the window is in
  the background or hidden.
- **FR-038**: Settings MUST offer sound on/off and system notifications on/off, and MUST explain
  the permission before asking for it; a refused permission MUST be reported and in-app alerts
  MUST keep working.

**Tags**

- **FR-039**: Tags MUST be creatable and manageable in Time mode and from the tag picker.
- **FR-040**: A tag MUST have a required name, unique ignoring case, of at most 30 characters, and
  a color from a fixed palette; tags MUST always be shown with their name (never by color alone).
- **FR-041**: An entry MUST have at most one tag. Rename and recolor MUST apply everywhere.
- **FR-042**: Deleting a tag MUST ask for confirmation, stating how many entries use it; the
  entries MUST remain, untagged.
- **FR-043**: The tag picker MUST be a searchable list with "Create tag".

**Calendar**

- **FR-044**: The calendar header MUST have a "Show time" switch, on by default, remembered per
  browser; turning it off MUST hide time entries from the calendar and change nothing else. *(Amended
  2026-11-05)*: on the home calendar it is merged with 012's "Show tasks" into one Tasks only /
  Both / Time only switch (default Both); "Tasks only" is the off state.
- **FR-045**: In day and week views, entries MUST appear as thin blocks in a narrow lane at the
  right edge of each day column, colored by tag (neutral when untagged), never covering classes,
  events or tasks; overlapping entries MUST sit side by side in the lane; a running timer's block
  MUST grow live.
- **FR-046**: In month view each day MUST show its total tracked time.
- **FR-047**: Hover and keyboard focus on a block MUST show description, tag and times; activating
  it MUST open the entry in the Time panel, reopening the panel if closed.
- **FR-048**: An entry crossing midnight MUST be shown and counted on each day for its part.
- **FR-049**: Pressing or dragging in the lane MUST NOT start creating a class or event.

**Reports (Priority 2)**

- **FR-050**: Reports MUST show, for today, this week, this month or a custom range (with previous
  and next), the total tracked time and a breakdown grouped by tag, by course or by day.
- **FR-051**: The breakdown MUST be available as a table (name, time, share in percent, number of
  entries) and as a donut chart, with a switch between them; the table MUST always be available.
- **FR-052**: The chart MUST have labeled slices, a legend with times, a text alternative, and
  slices distinguishable without color; slices under 3% of the total MUST be merged into "Other"
  in the chart but stay separate in the table.
- **FR-053**: Untagged time MUST be grouped as "No tag"; entries without a course as "No course".
  An entry linked to a session, event or task with a course MUST count under that course.
- **FR-054**: Choosing a row or slice MUST list its entries.
- **FR-055**: Reports MUST work at 320 px with the table first. Time that falls outside the period
  (an entry partly inside it) MUST count only the part inside.

**Links (Priority 2)**

- **FR-056**: A timer MUST be startable from a task card, a session and an event, linked to it and
  showing its name; an entry MUST be linkable to a course.
- **FR-057**: A session's page MUST show the total time tracked for that session.
- **FR-058**: Completing a task MUST NOT stop its timer. Deleting a linked item MUST keep its
  entries, without the link.

**Extras (Priority 3)**

- **FR-059**: The app MUST offer a daily goal with progress, CSV export of entries for a chosen
  range, a weekly totals view, the count of Pomodoro work periods completed today, and an editable
  keyboard shortcut to start and stop a timer.

**Everywhere**

- **FR-060**: Everything MUST work with keyboard and pointer in light, dark and custom themes, with
  accessible names on every control, visible focus, and reduced motion respected.
- **FR-061**: Times MUST be stored in UTC and shown in the user's time zone, correct across
  daylight-saving changes; durations MUST be real elapsed time.
- **FR-062**: A failed save MUST be shown and retried; nothing may be lost silently.
- **FR-063**: Existing features, including the task manager and the home page layout, MUST behave
  as before, apart from the panel's mode switch and accessible name.

### Key Entities

- **Time entry**: one saved stretch of tracked time for the user: start, end, description, at most
  one tag, the timer style it came from (Track, Pomodoro, Focus, or manual), and in Priority 2 an
  optional link to a course, a session, an event or a task.
- **Running timer**: the single active timer of a user: style, start, description, tag, link; for
  Pomodoro the phase, period number and planned end; for Focus the length, goal and planned end;
  paused state and accumulated active time; whether the long-running reminder was answered.
- **Tag**: name (unique ignoring case, ≤30 characters) and palette color; used by zero or more
  entries.
- **Time settings** (per user): Pomodoro lengths, periods before long break, automatic start,
  Focus "Hide panels while focusing" default, long-running threshold, sound, system notifications,
  recording-plus-timer indicator option, daily goal (Priority 3).
- **Per-browser preferences**: right panel mode, calendar "Show time" switch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can start a timer from the home page in at most 2 actions after opening
  Time mode, and stop it in 1 action from any page.
- **SC-002**: After closing the app, restarting, sleeping the computer or opening a second window,
  the shown elapsed time differs from real elapsed time by no more than 1 second.
- **SC-003**: In 100% of tested failure cases (server unreachable during start, stop, save, edit),
  no tracked time is lost once the connection returns.
- **SC-004**: Pomodoro and Focus end alerts arrive within 2 seconds of the planned end, including
  with the window hidden or in the background.
- **SC-005**: Report totals equal the sum of the listed entries' time within the period, to the
  second, for every grouping, including entries crossing midnight, period edges and DST changes.
- **SC-006**: All Time mode screens, the indicator, the calendar lane and Reports pass keyboard-only
  operation and WCAG 2.x AA contrast in light, dark and built-in themes, at 320 px panel width.
- **SC-007**: With a recording running, none of the timer actions under any of the three indicator
  options hides, pauses or stops the recording (0 failures across all combinations).
- **SC-008**: Existing task manager and home layout tests continue to pass unchanged, except those
  covering the panel's header and accessible name.

## Assumptions

- The app has one user per account; "across windows" includes every window and device signed in
  as that user, all talking to the same server.
- Pausing (FR-014) is modelled as ending the current stretch: Track pause saves an entry and
  resume starts a new one (like Toggl's "continue"); a paused Pomodoro work period or Focus session
  saves one entry whose duration excludes paused time, with start = when work began and end = the
  moment it ended; its duration is shown and counted as active time only. This is the choice most
  likely to need confirmation in `/speckit-clarify`.
- "Very small slices" means under 3% of the period total.
- The "Hide panels while focusing" option is a checkbox on the Focus card, remembered per user.
- "Recording first" badge and combined indicator controls follow the existing recording indicator's
  look; the recording indicator itself is not otherwise changed.
- The tag palette reuses theme-aware color tokens, so tag colors stay readable in every theme.
- The Pomodoro cycle counter resets after the long break, after Reset, and at the start of a new day
  if no timer is running.
- Deleting a course, session, event or task never deletes time entries (they only lose the link).
- Time entries are app metadata and live in the database; they are not user documents, so the
  plain-file rules for notes, audio and documents do not apply, but CSV export (P3) gives an open
  copy. Backups (feature 016) include them.
- Out of scope: blocking other apps or websites, idle detection, several timers at once, several
  tags per entry, rates, clients and invoices, sharing with other people, importing from Toggl or
  other trackers, automatic tracking of app usage, and changes to existing calendar entries.
