# Feature Specification: Class Schedule Calendar

**Feature Branch**: `001-class-schedule-calendar`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "Users log in and see a calendar occupying the right side of the screen with proportions similar to Google Calendar (day, week, month views). Users add classes as calendar entries with: course, start time, end time, location, optional links, color, and repetition rules (e.g. every Monday and Wednesday until the semester ends). When creating a class, the user chooses or creates a year, a semester (free-form name like \"Fall 2026\" or \"Term 2\") and a syllabus/course (free-form name). A left panel lists all courses with a search box. Selecting a course opens that course's timeline page (Feature 2)."

## Clarifications

### Session 2026-10-04

- Q: Who should be able to create accounts? → A: Owner first — the first launch creates the owner account; the owner can create additional accounts; each account's data is private; there is no public sign-up.
- Q: When a student changes or deletes one lecture of a recurring class, which scopes are offered? → A: Google-style — "This session", "This and following sessions", or "All sessions".
- Q: In what order are years listed in the course panel? → A: In a user-defined order; new years are added at the top, and the user can reorder years (drag-and-drop or keyboard "Move up/Move down"). Semesters within a year stay most recent first.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a recurring class and see it on the calendar (Priority: P1)

A student signs in and lands on the main screen: a course list on the left and a large calendar
on the right. They create a class "CS 201 Lecture" for the course "CS 201" in "Fall 2026" of
year "2026", from 10:00 to 11:30 in room "FENS G032", repeating every Monday and Wednesday until
the end of the semester, with a blue color and a link to the course website. Every Monday and
Wednesday through the semester end now shows the class on the calendar.

**Why this priority**: Getting a class schedule into the app is the foundation of every other
feature (notes, recordings, and transcripts all attach to class sessions).

**Independent Test**: Sign in, create one recurring class (creating its year, semester, and
course inline), and confirm the correct sessions appear in week view on the correct days and
times, and stop after the semester end date.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no data, **When** they create a class and create a new year,
   semester, and course inline in the same form, **Then** the class is saved, the new course
   appears in the left panel, and the class appears on the calendar.
2. **Given** a class repeating every Monday and Wednesday until the semester ends, **When** the
   user views any week inside the semester, **Then** the class appears exactly on Monday and
   Wednesday at the chosen times, with the chosen color, course name, and location.
3. **Given** the same class, **When** the user views a week after the semester end date,
   **Then** no sessions of that class appear.
4. **Given** a non-repeating class, **When** it is saved, **Then** exactly one session appears
   on the chosen date.
5. **Given** the class form, **When** the user enters an end time earlier than or equal to the
   start time, **Then** the form refuses to save and explains why.
6. **Given** an existing year, semester, and course, **When** the user creates another class,
   **Then** they can pick those existing values instead of creating new ones.

---

### User Story 2 - Navigate the calendar in day, week, and month views (Priority: P1)

The student switches between day, week, and month views, moves forward and backward in time,
and jumps back to today, to see what classes they have.

**Why this priority**: The calendar is the primary screen; without navigation the schedule is
not usable.

**Independent Test**: With several classes present, switch between all three views, step
forward/back, and use "Today"; confirm sessions are displayed in the correct time slots.

**Acceptance Scenarios**:

1. **Given** the main screen, **When** it first loads, **Then** the calendar shows the week
   view containing today, with the current time indicated.
2. **Given** any view, **When** the user selects day, week, or month, **Then** the calendar
   switches to that view around the currently focused date.
3. **Given** any view, **When** the user presses next/previous, **Then** the calendar moves by
   one day, week, or month respectively; **When** they press "Today", **Then** it returns to the
   period containing today.
4. **Given** two classes that overlap in time, **When** shown in day or week view, **Then** both
   are visible side by side and neither hides the other.
5. **Given** a day with more classes than fit in a month-view cell, **When** shown in month
   view, **Then** the cell shows as many as fit plus a "+N more" indicator that reveals the rest.
6. **Given** a class session on the calendar, **When** the user selects it, **Then** they see
   its details (course, time, location, links, repetition) and can open its links.

---

### User Story 3 - Browse and search courses in the left panel (Priority: P2)

The left panel lists every course the student has created, grouped by year and semester. The
student types into a search box to filter the list and selects a course to open that course's
timeline page.

**Why this priority**: Fast access to a course is the entry point to notes and recordings
(Feature 2), but the calendar is usable without it.

**Independent Test**: Create courses across two semesters, search by partial name, and confirm
filtering and that selecting a course navigates to that course's page.

**Acceptance Scenarios**:

1. **Given** courses in several semesters, **When** the main screen loads, **Then** the left
   panel lists all courses grouped by year and semester, with years in the user's chosen order
   and semesters within a year most recent first.
2. **Given** the course list, **When** the user types part of a course name (case-insensitive),
   **Then** only matching courses are shown, updating as they type.
3. **Given** a search with no matches, **When** results are shown, **Then** the panel shows an
   empty-state message and a way to clear the search.
4. **Given** the course list, **When** the user selects a course, **Then** the app navigates to
   that course's timeline page (delivered by Feature 2; until then, a page identifying the
   course).
5. **Given** several years in the panel, **When** the user moves a year up or down (by dragging or
   with the keyboard "Move up" / "Move down" actions), **Then** the panel shows the new order
   immediately, and the same order is shown after reloading or signing in on another device.
6. **Given** a newly created year, **When** it appears in the panel, **Then** it is placed at the
   top of the year list.

---

### User Story 4 - Edit and delete classes (Priority: P2)

The student corrects a class (e.g., the room changed) or removes a class they dropped.

**Why this priority**: Schedules change during a semester; without editing, users must delete
and recreate classes.

**Independent Test**: Edit the location of a recurring class and confirm the change is shown;
delete a class and confirm its sessions disappear after confirmation.

**Acceptance Scenarios**:

1. **Given** an existing class, **When** the user edits any of its fields and saves, **Then**
   the calendar reflects the change immediately.
2. **Given** a session of a recurring class, **When** the user edits or deletes it, **Then**
   they choose the scope: "This session", "This and following sessions", or "All sessions".
3. **Given** the scope "This session", **When** the user changes its date, time or location or
   deletes (cancels) it, **Then** only that date changes; all other sessions are unchanged.
4. **Given** the scope "This and following sessions", **When** the user saves a change,
   **Then** sessions before the chosen date keep the old details and sessions from that date on
   use the new details; the user sees one continuous schedule.
5. **Given** the scope "All sessions", **When** the user saves a change, **Then** every session
   changes, except single sessions previously changed individually, which keep their
   individual changes (the user is told how many).
6. **Given** a delete request, **When** the user has not yet confirmed, **Then** nothing is
   deleted; **When** they confirm, **Then** the sessions are removed from the calendar.
7. **Given** a class whose sessions already have notes or recordings (Feature 2+), **When** the
   user deletes the class, **Then** the confirmation states that this content exists, and the
   notes and audio files are not deleted from the user's storage folders.

---

### User Story 5 - Sign in (Priority: P1)

A student signs in to reach their own calendar and courses; their data is not visible to anyone
else using the app.

**Why this priority**: The description requires login, and each user's schedule must be private.

**Independent Test**: Create an account, sign out, sign back in, and confirm only that user's
classes are shown; a second user sees none of them.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they open the app, **Then** they are shown the
   sign-in screen and cannot see any calendar data.
2. **Given** valid credentials, **When** the user signs in, **Then** they land on the main
   calendar screen.
3. **Given** invalid credentials, **When** the user tries to sign in, **Then** they see a
   generic error that does not reveal whether the account exists.
4. **Given** a signed-in user, **When** they sign out, **Then** returning to the app requires
   signing in again.

5. **Given** a fresh installation with no accounts, **When** anyone opens the app, **Then** they
   are asked to create the owner account (username and password) and no other screen is
   reachable until it exists.
6. **Given** the owner is signed in, **When** they create another account (username and an
   initial password), **Then** that person can sign in and sees only their own data.
7. **Given** a signed-out visitor on an installation that already has an owner, **When** they
   look for a way to register, **Then** none exists; accounts can only be created by the owner.
8. **Given** a user forgot their password, **When** the owner resets it, **Then** the user can
   sign in with the new password and must change it at first sign-in.

---

### Edge Cases

- Repetition "until semester ends" chosen for a semester with no end date: the form requires
  either adding an end date to the semester or choosing another end condition.
- Class start date after the repetition end date: save is refused with an explanation.
- Semester end date later moved earlier or later: sessions of classes repeating "until semester
  ends" follow the new end date.
- Duplicate names: creating a year, semester, or course whose name already exists in the same
  parent (case-insensitive, trimmed) selects the existing one instead of creating a duplicate.
- Same course name in two different semesters (e.g., "Calculus" in Fall 2026 and Fall 2027) is
  allowed; they are separate courses.
- Names containing characters that are not valid in folder names (e.g., `/`, `:`) are accepted
  for display; the stored folder name uses a safe readable equivalent.
- A class spanning midnight is not allowed in this feature (end must be after start on the same
  day).
- Invalid link (not a well-formed web address) is rejected with an inline message.
- Very long course names or locations are truncated with an ellipsis in calendar blocks and
  shown in full in the details view.
- A session that falls on a daylight-saving change keeps its local wall-clock start and end
  times.
- Network/server error while saving a class: the form keeps all entered values and shows a
  retry option; nothing is partially saved.

## Requirements *(mandatory)*

### Functional Requirements

**Access**

- **FR-001**: The system MUST require users to sign in before any schedule data is shown.
- **FR-002**: Each user's years, semesters, courses, and classes MUST be visible only to that
  user.
- **FR-003**: Users MUST be able to sign out.
- **FR-003a**: On first launch with no accounts, the app MUST require creating the owner
  account before anything else; there MUST be exactly one owner.
- **FR-003b**: Only the owner MUST be able to create, disable, and delete other accounts and
  reset their passwords; there MUST be no public self-registration.
- **FR-003c**: The owner MUST NOT be able to view another user's schedule, notes, recordings, or
  settings; owner privileges cover account management only.
- **FR-003d**: Users MUST be able to change their own password; passwords set by the owner MUST
  be changed at the user's next sign-in.

**Layout**

- **FR-004**: After sign-in, the main screen MUST show a course panel on the left and a calendar
  occupying the remaining area on the right, with the calendar taking the majority of the width
  (comparable to Google Calendar's proportions) on desktop-size screens.
- **FR-005**: The left panel MUST be collapsible so the calendar can use the full width.

**Calendar**

- **FR-006**: The calendar MUST offer day, week, and month views and default to week view of
  the current week.
- **FR-007**: The calendar MUST provide previous, next, and "Today" navigation, and display the
  currently shown date range.
- **FR-008**: Day and week views MUST position each session by its start and end time on a
  time grid and indicate the current time.
- **FR-009**: Each session block MUST show at least the course name, time, and location (space
  permitting), in the class's color.
- **FR-010**: Overlapping sessions MUST all remain visible and selectable.
- **FR-011**: Selecting a session MUST show its details (course, year, semester, date, time,
  location, links, repetition) with actions to edit or delete it and to open the course page.
- **FR-012**: Users MUST be able to start creating a class from a "New class" action and by
  selecting an empty time slot in day/week view (which pre-fills date and times).

**Classes**

- **FR-013**: Users MUST be able to create a class with: course (required), start date
  (required), start time (required), end time (required, after start time), location
  (optional), zero or more links each with an optional label, color (required, with a default),
  and a repetition rule.
- **FR-014**: When creating a class, users MUST be able to pick an existing year, semester, and
  course, or create any of them inline without leaving the form. Years, semesters, and courses
  have free-form names; a semester belongs to a year, and a course belongs to a semester.
- **FR-015**: Repetition rules MUST support: no repetition; weekly on one or more chosen
  weekdays, optionally every N weeks; ending at the semester end, on a chosen date, or after a
  chosen number of occurrences.
- **FR-016**: The system MUST generate all sessions implied by a repetition rule and show them
  on the calendar.
- **FR-017**: Semesters MUST support optional start and end dates; the "until semester ends"
  ending option MUST use the semester's current end date.
- **FR-018**: Users MUST be able to edit and delete classes; deletion MUST require explicit
  confirmation.
- **FR-018a**: Editing or deleting a session of a recurring class MUST offer three scopes: "This
  session", "This and following sessions", and "All sessions". "This session" changes or
  cancels only that date; "This and following" applies from that date onward and leaves earlier
  sessions unchanged; "All sessions" applies to every session except individually changed
  ones. Cancelled single sessions MUST disappear from the calendar.
- **FR-018b**: Notes and recordings attached to a session MUST stay attached when that session
  is moved to another time or (via "This session") to another date, and MUST NOT be deleted
  when a session is cancelled (see Feature 002 "No longer scheduled").
- **FR-018c**: With the scope "This session" the user MUST be able to move the session to
  another date (e.g. the lecturer postpones Monday's class to Friday). The moved session keeps
  its identity, notes, recordings and folder; only the date it is shown on changes.
- **FR-019**: Deleting a class, course, semester, or year MUST NOT delete note or audio files
  already stored for it; the user is told the files remain in their storage folders.
- **FR-020**: Users MUST be able to rename and delete years, semesters, and courses. Every
  deletion MUST require explicit confirmation; when the item still contains semesters, courses,
  or classes, the confirmation MUST state what will be removed, and in all cases it MUST state
  that stored note and audio files are kept (FR-019).
- **FR-021**: The color picker MUST offer a preset palette whose colors keep session text
  readable (WCAG AA contrast) in light and dark themes; a course's first class color becomes
  the default for later classes of that course.

**Course panel**

- **FR-022**: The left panel MUST list all of the user's courses grouped by year and semester,
  each with its color. Years appear in the user's chosen order (new years are added at the top);
  semesters within a year appear most recent first.
- **FR-022a**: Users MUST be able to reorder years in the panel by drag-and-drop and by keyboard
  ("Move up" / "Move down"); the order MUST be saved on the server and apply on every device.
- **FR-023**: The panel MUST provide a search box that filters courses by case-insensitive
  partial name match as the user types, with an empty state and a clear action.
- **FR-024**: Selecting a course MUST navigate to that course's timeline page (Feature 2).

**Storage & quality**

- **FR-025**: Creating a year, semester, or course MUST create the matching human-readable
  folder (year → semester → course) in the user's storage area, ready to receive dated
  `notes/` and `audios/` folders in later features; renaming MUST keep folders in sync.
- **FR-026**: Changes MUST be saved by the server before the UI reports success; a failed save
  MUST keep the user's form input and offer a retry.
- **FR-027**: All screens in this feature MUST be fully operable by keyboard (including creating
  a class, navigating views, and searching courses) and MUST render correctly in the built-in
  light and dark themes. Every colour, including class colours, MUST come from theme colour
  tokens with no hard-coded colours, so that user-created themes (Feature 005) apply to these
  screens without changes.

### Key Entities

- **User**: A person who signs in; owns all of the data below. Role is "owner" (exactly one,
  created at first launch, manages accounts) or "member" (created by the owner).
- **Year**: Free-form label (e.g., "2026", "2026–2027"); contains semesters.
- **Semester**: Free-form name (e.g., "Fall 2026", "Term 2") within a year; optional start and
  end dates; contains courses.
- **Course (Syllabus)**: Free-form name (e.g., "CS 201") within a semester; has a default color;
  has classes; has a timeline page (Feature 2).
- **Class**: A scheduled entry for a course: start date, start/end time, location, links,
  color, repetition rule. A course may have several classes (e.g., lecture and lab).
- **Repetition Rule**: Weekdays, interval in weeks, and an end condition (semester end, date,
  or occurrence count).
- **Session Exception**: A change to a single session of a recurring class: the original date,
  and either "cancelled" or overridden time/location.
- **Session (Occurrence)**: One dated instance of a class on the calendar; later features attach
  notes and recordings to a session's date.
- **Link**: URL with an optional label attached to a class.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can sign in and add a recurring class, including creating its
  year, semester, and course, in under 2 minutes.
- **SC-002**: A full semester schedule of 6 courses with 2–3 weekly sessions each can be entered
  in under 10 minutes.
- **SC-003**: Switching between day, week, and month views, or moving to the next/previous
  period, shows the new view in under 1 second for a user with a full semester schedule.
- **SC-004**: 100% of generated sessions fall on the correct weekdays and times and none fall
  after the repetition end, verified across a full semester including a daylight-saving change.
- **SC-005**: Course search shows filtered results within 0.5 seconds of typing for up to 200
  courses.
- **SC-006**: Every flow in this feature can be completed using only the keyboard, and all text
  meets WCAG AA contrast in light and dark themes.
- **SC-007**: After creating a course, its folder can be found by browsing the user's storage
  area by year and semester name without using the app.

## Assumptions

- Desktop and laptop browsers are the primary target; on narrow screens the left panel becomes
  an overlay drawer and the calendar defaults to day view.
- All times are in the user's local time zone; multi-time-zone support is out of scope.
- The week starts on Monday by default (configurable week start is out of scope).
- Repetition is weekly-based only; daily and monthly patterns are out of scope. Single-session
  changes and cancellations are supported via the scopes in FR-018a.
- Non-class events (exams, personal events), importing/exporting calendars (e.g., ICS), sharing,
  and notifications/reminders are out of scope for this feature.
- The course timeline page content is defined in Feature 2; this feature only provides
  navigation to it.
- Notes, recordings, and transcription are defined in later features; this feature only creates
  the year/semester/course folders they will use.
- Self-service password reset by email is out of scope; the owner resets forgotten passwords.
  If the owner forgets their password, recovery is an operator task outside the app.
