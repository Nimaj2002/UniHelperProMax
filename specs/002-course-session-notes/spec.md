# Feature Specification: Course Timeline & Session Notes Workspace

**Feature Branch**: `002-course-session-notes`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "The course page shows a timeline of all sessions of that course: past sessions in normal styling, upcoming sessions in grey. Both are clickable. Opening a session shows a three-panel workspace. Left panel: a vertical timeline of this course's sessions for quick switching, plus a \"new note\" action and a list of all notes for this session. Main panel: notes open as tabs, one note per tab, written in Markdown with a live/preview experience. Each session can have multiple notes with user-chosen names. Right panel: the session's audio (Feature 3). Upcoming sessions allow notes but not recording."

**Depends on**: Feature 001 (Class Schedule Calendar) for courses, classes, and sessions.

## Clarifications

### Session 2026-10-04

- Q: How should the Markdown note editor show formatting while the student types? → A: Live in place by default (formatting renders as you type; raw Markdown shows only on the line being edited), plus a switch to plain raw Markdown editing.
- Q: At what moment does a session stop counting as "upcoming", and when is recording allowed? → A: A session stops being "upcoming" at its scheduled start time; recording is always allowed for every session, upcoming or past (this supersedes the original "upcoming sessions allow notes but not recording").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write notes for a session (Priority: P1)

During or after a lecture, a student opens today's CS 201 session, creates a note named
"Lecture notes", and types Markdown. The note saves itself as they type. They create a second
note, "Homework 3 questions", which opens in a new tab beside the first.

**Why this priority**: Taking per-session notes is the core value of the app; everything else
in this feature helps users reach and organise those notes.

**Independent Test**: Open a session workspace, create two named notes, type in both, reload
the page, and confirm both notes and their content are still there and exist as Markdown files
in the session's `notes/` folder.

**Acceptance Scenarios**:

1. **Given** an open session workspace, **When** the user chooses "New note" and enters a name,
   **Then** an empty note with that name is created, added to the session's note list, and
   opened in a new tab with the cursor in the editor.
2. **Given** an open note, **When** the user types, **Then** changes are saved automatically
   without any save action, and the tab shows the save state (saving / saved / failed).
3. **Given** a saved note, **When** the user reloads the page or reopens the session, **Then**
   the note content is exactly as last typed.
4. **Given** a session with notes, **When** the user browses the storage folders outside the
   app, **Then** each note exists as a readable Markdown file named after the note in that
   session's `notes/` folder.
5. **Given** two notes open in tabs, **When** the user switches tabs, **Then** each tab keeps
   its own content, cursor position, and scroll position.
6. **Given** the user tries to create a note with a name already used in the same session,
   **When** they confirm, **Then** creation is refused with a message asking for another name.

---

### User Story 2 - Course timeline page (Priority: P1)

From the course panel (Feature 001), the student opens "CS 201" and sees every session of the
course in order on a timeline. Past sessions look normal; upcoming ones are greyed out. They
click any session — past or upcoming — to open its workspace.

**Why this priority**: The timeline is the entry point to every session's notes and audio.

**Independent Test**: For a course with sessions before and after today, open the course page
and confirm all sessions are listed in date order with past/upcoming styling, and that clicking
each opens the correct session workspace.

**Acceptance Scenarios**:

1. **Given** a course with recurring classes, **When** its page opens, **Then** every session
   of every class in that course is shown in chronological order with its date, weekday, time,
   class name, and location.
2. **Given** the timeline, **When** it opens, **Then** it scrolls to the session nearest to now
   (the current or next session).
3. **Given** sessions before and after the current moment, **When** displayed, **Then** past
   sessions use normal styling and upcoming sessions use muted (grey) styling plus a
   non-colour "Upcoming" indicator.
4. **Given** any session in the timeline, **When** the user clicks it or activates it with the
   keyboard, **Then** that session's workspace opens.
5. **Given** a session that has notes (or audio, once Feature 3 exists), **When** displayed in
   the timeline, **Then** it shows how many notes it has and whether audio exists.

---

### User Story 3 - Switch between sessions in the workspace (Priority: P2)

While reviewing for an exam, the student moves from week 3's lecture to week 4's using the
vertical session timeline in the workspace's left panel, without going back to the course page.

**Why this priority**: Fast switching makes reviewing a course practical, but the workspace is
usable with the course page alone.

**Independent Test**: Open a session, select another session from the left-panel timeline, and
confirm the note list, tabs, and right panel all change to the selected session.

**Acceptance Scenarios**:

1. **Given** an open session workspace, **When** it loads, **Then** the left panel shows a
   vertical timeline of this course's sessions with the current session highlighted and
   visible, plus the "New note" action and the list of this session's notes.
2. **Given** the left-panel timeline, **When** the user selects another session, **Then** the
   workspace switches to it: its note list, its tabs, and its audio panel are shown.
3. **Given** the user switches away from a session with open tabs, **When** they later return
   to it, **Then** the same tabs are reopened with the previously active tab selected.
4. **Given** a note with unsaved changes still being saved, **When** the user switches session,
   **Then** the save completes (or the failure is reported) and no typed content is lost.
5. **Given** the workspace, **When** the user uses browser back/forward, **Then** they move
   between previously viewed sessions and the course page.

---

### User Story 4 - Manage notes (rename, close, delete) (Priority: P2)

The student renames "Untitled" to "Midterm review", closes tabs they no longer need, and
deletes a note created by mistake.

**Why this priority**: Users accumulate notes; basic management keeps sessions organised.

**Independent Test**: Rename a note and confirm the list, tab, and file name update; close a tab
and confirm the note stays in the list; delete a note after confirmation and confirm it is gone.

**Acceptance Scenarios**:

1. **Given** a note in the list, **When** the user selects it, **Then** it opens in a tab (or
   focuses its existing tab — a note is never open in two tabs).
2. **Given** a note, **When** the user renames it to a valid unused name, **Then** the note
   list, the tab title, and the file name all change, and the content is unchanged.
3. **Given** an open tab, **When** the user closes it, **Then** the note remains in the session's
   note list and its content is kept.
4. **Given** a delete request, **When** the user has not confirmed, **Then** nothing is
   deleted; **When** they confirm, **Then** the note is removed from the list, its tab closes,
   and its file is removed from the `notes/` folder.

---

### User Story 5 - Markdown live preview (Priority: P2)

The student writes headings, lists, code blocks, tables, and links in Markdown and sees them
formatted while they write.

**Why this priority**: Readable formatting makes notes useful for review; plain text editing
alone still delivers the core value.

**Independent Test**: Type common Markdown constructs into a note and confirm they display
formatted per the chosen editing mode, while the saved file contains the plain Markdown text.

**Acceptance Scenarios**:

1. **Given** a note in the default live mode, **When** the user types Markdown, **Then**
   formatting (headings, emphasis, lists, code, tables, links) renders in place, and the raw
   Markdown syntax is shown only on the line or block containing the cursor.
2. **Given** a note, **When** the user switches to raw mode (button or keyboard shortcut),
   **Then** the full plain Markdown text is shown and editable without any rendering; switching
   back restores live mode at the same position.
3. **Given** the user chose raw or live mode, **When** they open other notes later, **Then** the
   last chosen mode is used (remembered per user).
4. **Given** formatted content, **When** the file is opened outside the app, **Then** it
   contains standard Markdown text with no app-specific markup.
5. **Given** a link in a note, **When** the user activates it in the formatted view, **Then**
   it opens in a new browser tab.

---

### User Story 6 - Upcoming sessions: styling and full access (Priority: P3)

Before a lecture, the student opens next Monday's session to jot down questions to ask. The
session is shown as upcoming (grey), but they can create notes and record audio exactly as in a
past session. At the scheduled start time the session switches to normal styling.

**Why this priority**: Pre-class notes are useful, and students often start recording early or
for a session whose time was misscheduled; blocking them would risk losing a lecture.

**Independent Test**: Open an upcoming session, create a note and confirm the recording
controls are available; keep the workspace open across the scheduled start time and confirm the
styling switches without reload.

**Acceptance Scenarios**:

1. **Given** an upcoming session, **When** the workspace opens, **Then** creating and editing
   notes works exactly as for past sessions.
2. **Given** an upcoming session, **When** the right panel is shown, **Then** the recording
   controls are available exactly as for past sessions.
3. **Given** a session whose scheduled start time is reached while the workspace or course page
   is open, **When** that moment passes, **Then** the session switches from upcoming (grey)
   styling to normal styling without reloading.

---

### Edge Cases

- Two sessions of the same course on the same date (e.g., lecture and lab): each has its own
  workspace and its own `notes/` and `audios/` folders; the date folder names stay readable and
  distinguish them (e.g., by start time).
- A session is removed from the schedule (class edited or deleted in Feature 001) after notes
  were written: the notes are not deleted; the session still appears in the course timeline
  marked "No longer scheduled" so its notes remain reachable.
- A note's file is edited or deleted outside the app while open: the app detects the change
  before saving, never silently overwrites the external version, and lets the user keep either
  or both (saving theirs as a copy).
- Saving fails (server unreachable): typed content stays in the editor and is kept locally until
  the save succeeds; the tab shows "Not saved" and retries automatically; closing the tab or
  leaving the page warns the user.
- Note names containing characters invalid in file names (`/`, `:`, `?`, etc.): the note keeps
  the display name; the file name uses a safe readable equivalent.
- Empty note name or a name of only spaces: refused.
- A course with no sessions: the course page shows an empty state with a link to add a class.
- A very long timeline (hundreds of sessions across several semesters): the timeline stays
  responsive and groups sessions by month.
- Many open tabs: tabs scroll horizontally and remain reachable by keyboard; a long note title
  is truncated with the full name shown on hover/focus.
- Very large notes (e.g., 50,000 words): editing remains usable and autosave still works.
- The same note open in two browser windows: the later save does not silently discard the
  earlier window's changes (same conflict handling as external edits).

## Requirements *(mandatory)*

### Functional Requirements

**Course timeline page**

- **FR-001**: The course page MUST list every session of every class in the course in
  chronological order, grouped by month, showing date, weekday, time, class name, and location.
- **FR-002**: Sessions whose scheduled start time has passed MUST use normal styling; upcoming sessions MUST
  use muted (grey) styling and a non-colour "Upcoming" indicator. Muted text MUST still meet
  WCAG AA contrast in every theme.
- **FR-003**: Every session (past or upcoming) MUST be selectable by pointer and keyboard and
  open that session's workspace.
- **FR-004**: The timeline MUST initially scroll to the current or next session.
- **FR-005**: Each session entry MUST indicate its note count and whether it has audio.
- **FR-006**: Sessions removed from the schedule that still have notes or audio MUST remain
  listed, marked "No longer scheduled".

**Session workspace layout**

- **FR-007**: Opening a session MUST show a three-panel workspace: left (session timeline, "New
  note", note list), main (note tabs and editor), right (session audio).
- **FR-008**: The left and right panels MUST be collapsible so the editor can use the full
  width; collapse state is remembered per user.
- **FR-009**: The workspace MUST show the course name, session date, time, and location, and a
  way back to the course page.
- **FR-010**: Each session workspace MUST have a shareable in-app address so browser
  back/forward and reloading return to the same session.

**Session switching**

- **FR-011**: The left panel MUST show a vertical timeline of the course's sessions, with the
  current session highlighted and scrolled into view, using the same past/upcoming styling as
  the course page.
- **FR-012**: Selecting another session MUST switch the note list, tabs, and right panel to
  that session without a full page reload.
- **FR-013**: Each session MUST remember its open tabs and active tab, restored when the user
  returns to it.

**Notes**

- **FR-014**: Users MUST be able to create any number of notes per session, each with a
  user-chosen name that is unique (case-insensitive) within that session.
- **FR-015**: Each note MUST be stored as a plain Markdown file, named after the note, in the
  session's folder: year → semester → course → session date → `notes/`.
- **FR-016**: The note list MUST show all notes of the session, ordered by creation time, and
  indicate which are open.
- **FR-017**: Notes MUST open as tabs in the main panel, one note per tab; selecting an already
  open note focuses its tab.
- **FR-018**: Notes MUST autosave while the user types (within 2 seconds of the user pausing),
  and each tab MUST show its save state (saving / saved / not saved).
- **FR-019**: Unsaved content MUST never be lost: on save failure it is kept and retried, and
  leaving the page or closing a tab with unsaved content MUST warn the user.
- **FR-020**: The app MUST NOT silently overwrite a note file that changed since it was loaded
  (external edit or another window); the user chooses how to resolve it and both versions are
  preserved until they do.
- **FR-021**: Users MUST be able to rename notes (renaming the file accordingly) and delete
  notes after explicit confirmation.
- **FR-022**: The editor MUST support standard Markdown including headings, emphasis, ordered
  and unordered lists, task lists, links, inline code, code blocks, block quotes, and tables.
  By default it MUST use live mode: formatting renders in place while raw syntax is shown only
  on the line/block containing the cursor. A switch (with keyboard shortcut) MUST toggle a raw
  mode showing plain Markdown with no rendering; the chosen mode is remembered per user and
  switching keeps the cursor position.
- **FR-023**: Saved files MUST contain only standard Markdown text, readable in any text
  editor.
- **FR-024**: Common editing actions MUST have keyboard shortcuts: new note, close tab,
  next/previous tab, toggling the side panels, and toggling live/raw editing mode.

**Audio panel & upcoming sessions**

- **FR-025**: The right panel MUST be reserved for the session's audio, whose behaviour is
  defined in Feature 3; until Feature 3 is delivered it shows an explanatory placeholder.
- **FR-026**: A session is "upcoming" until its scheduled start time and "past/current" from
  that moment on. Upcoming status affects styling only: notes and recording MUST be available
  for every session regardless of status.
- **FR-027**: A session's upcoming/past status MUST update automatically at its scheduled start
  time while the page is open, without reload.

**Quality**

- **FR-028**: All screens in this feature MUST be fully keyboard operable and MUST render
  correctly in light, dark, and user-created themes, including the editor's formatted view.

### Key Entities

- **Session**: (from Feature 001) one dated occurrence of a class; has a status (upcoming or
  past/current), notes, and audio (Feature 3).
- **Note**: A named Markdown document belonging to one session; name unique within the session;
  content stored as a Markdown file in the session's `notes/` folder; has created and modified
  times.
- **Workspace State**: Per user and session, the list of open note tabs and the active tab;
  plus per-user panel collapse preferences and editor mode (live or raw).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the course page, a user can open a session and start typing in a new named
  note in under 10 seconds.
- **SC-002**: In testing that interrupts the app at random moments while typing (reload, closed
  tab, network loss), no more than the last 2 seconds of typing is ever lost, and 0 notes are
  overwritten or emptied.
- **SC-003**: Switching to another session from the left-panel timeline shows its notes in
  under 1 second.
- **SC-004**: 100% of notes created in the app can be found and opened as readable Markdown
  files by browsing year → semester → course → date → `notes/` outside the app.
- **SC-005**: A course timeline with 300 sessions opens and scrolls smoothly, reaching the
  current session immediately.
- **SC-006**: Every flow in this feature can be completed using only the keyboard, and all text,
  including greyed-out upcoming sessions, meets WCAG AA contrast in light and dark themes.

## Assumptions

- Session folders follow the constitution's hierarchy; when a course has more than one session
  on the same date, the date folder name also includes the start time to keep them distinct.
- Notes are text-only Markdown in this feature; embedding or uploading images and attachments
  is out of scope.
- Search across note contents, note templates, exporting to PDF, and sharing notes are out of
  scope.
- Notes cannot be moved between sessions in this feature.
- Opening a course timeline from the course panel is provided by Feature 001.
- Recording, playback, and transcription in the right panel are defined in Features 3 and later;
  this feature only reserves the panel. Recording is allowed for all sessions (see
  Clarifications).
- Deleted notes are removed permanently after confirmation; a trash/undo is out of scope.
- Desktop/laptop screens are the primary target; on narrow screens the side panels become
  drawers and the editor uses the full width.
