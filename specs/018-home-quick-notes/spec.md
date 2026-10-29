# Feature Specification: Home General Notes

**Feature Branch**: `018-home-general-notes`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "add a notes section in the main page as a general notes section so that it would be used for quick notes. the editing should be the editor poping up as a box so that the user would understand that this is not the main notes. do it in a way that the user would realize that this is not the section where you have to put your main notes in. in order to save it create a folder under users folder called general notes and put all of the notes there"

**Depends on**: Feature 012 (Task Manager — home page with Calendar and Tasks panels), Feature 002 (Course Session Notes — the Markdown note editor and autosave behaviour).

## Clarifications

### Session 2026-10-29

- Q: Where on the home page should the General notes section go? → A: A compact, collapsible section stacked under the Tasks panel, sharing its column (not a third full panel).
- Q: Should the general-note pop-up support the full rich editor that session notes have, or only basic Markdown? → A: The same editor as session notes (formatted-as-you-type, raw toggle, diagrams, math), shown in the compact pop-up.
- Q: What exact name should the folder in the user's storage folder have? → A: `General Notes` (title case, with a space).
- Change (user request after first implementation): the Tasks column works like the session panel — Tasks and General notes are two collapsible sections with a resizable boundary, and the closed panel's rail shows an icon per section (Tasks with its counts, General notes) that reopens the panel on that section. The first version squeezed Tasks and gave no hint of the notes when the panel was closed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jot a general note from the home page (Priority: P1)

Between classes, a student opens the app and lands on the home page. Under the Tasks panel, in
the same column, there is a small "General notes" section, visibly lighter than a session workspace
and captioned as a scratchpad for things that don't belong to a class. They click "New general
note"; a pop-up box opens over the home page with a title field and a compact editor. They type
"Ask advisor about summer internship credits", close the box, and the note appears in the General
notes list with its first line and when it was last changed.

**Why this priority**: Capturing a thought in seconds, without picking a course or session, is
the whole point of the feature. Without it nothing else here has value.

**Independent Test**: From the home page, create a general note, type text, close the pop-up,
reload the app, and confirm the note is listed and its content is unchanged; then confirm a
Markdown file for it exists in the user's `General Notes` folder.

**Acceptance Scenarios**:

1. **Given** the home page, **When** the user activates "New general note", **Then** a pop-up box
   opens over the page with an empty note, the cursor in the editor, and the home page still
   visible (dimmed) behind it.
2. **Given** an open general-note pop-up, **When** the user types, **Then** the content saves
   automatically with no save action, and the pop-up shows the save state (saving / saved /
   not saved).
3. **Given** a general note with unsaved changes still being written, **When** the user closes
   the pop-up (close button, Escape, or clicking outside), **Then** pending changes are saved
   before the pop-up disappears, and nothing typed is lost.
4. **Given** a saved general note, **When** the user reloads the app, **Then** the note is listed
   in the General notes section with exactly the last-typed content.
5. **Given** general notes exist, **When** the user browses their storage folder outside the
   app, **Then** each general note is a readable Markdown file inside a `General Notes` folder
   directly under their user folder.

---

### User Story 2 - Clearly tell general notes apart from main notes (Priority: P1)

A student who has never used the feature sees the General notes section for the first time. The
section's caption, its compact look, and the pop-up editor (rather than a full workspace with
tabs and side panels) make it obvious this is a scratchpad. A short hint tells them that
lecture and course notes belong in a class session.

**Why this priority**: The user explicitly asked that people must not mistake this for the
place to keep their real notes. If students start keeping lecture notes here, they lose the
session/course organisation the app is built around.

**Independent Test**: Show the home page and an open general-note pop-up to a user unfamiliar
with the feature and ask where they would put their lecture notes; they should answer "in the
class session", not "in general notes".

**Acceptance Scenarios**:

1. **Given** the home page, **When** the General notes section is shown, **Then** it carries a
   title ("General notes") and a one-line description identifying it as a scratchpad for
   general, non-class notes, with a pointer that course notes belong in a class session.
2. **Given** a general note is being edited, **When** the pop-up is open, **Then** it is visibly
   a bounded box (not a full page or a tab in a session workspace), labelled "General note", and
   it does not show session-only tools (session timeline, recordings, documents, AI chat).
3. **Given** the General notes section has no notes yet, **When** it is shown, **Then** an empty
   state explains what general notes are for and offers "New general note".

---

### User Story 3 - Find, reopen, rename and delete general notes (Priority: P2)

Later that week the student reopens the internship note from the list, adds a line, renames it
"Internship questions", and deletes an old grocery list they no longer need.

**Why this priority**: Notes that can only be created, never managed, quickly clutter the
section; but the feature already delivers value without this.

**Independent Test**: With several general notes present, open one from the list, edit it,
rename it, delete another (confirming the prompt), and verify both the list and the
`General Notes` folder reflect the changes.

**Acceptance Scenarios**:

1. **Given** existing general notes, **When** the General notes section is shown, **Then** notes are
   listed most recently changed first, each with its name and last-changed time.
2. **Given** a listed note, **When** the user clicks it or activates it by keyboard, **Then** it
   opens in the pop-up editor with its saved content.
3. **Given** an open general note, **When** the user changes its name, **Then** the list and the
   file name on disk both reflect the new name.
4. **Given** the user renames a general note to a name already used by another general note,
   **When** they confirm, **Then** the rename is refused with a message asking for another name.
5. **Given** a general note, **When** the user chooses delete, **Then** they are asked to confirm,
   and only after confirming is the note removed from the list and its file removed from the
   `General Notes` folder.

---

### Edge Cases

- A new general note is created and closed without typing anything: it is discarded rather than
  leaving an empty file behind.
- A new general note is given no name: it is named from its first line of text, falling back to
  a date-time based name (e.g. "General note 2026-10-29 14-05") when there is no text.
- A name contains characters not allowed in file names: the stored file name is made safe while
  the displayed name stays as the user typed it as far as possible.
- The user edits a general-note file outside the app (or drops a new `.md` file into
  `General Notes`): the app shows that content and lists that file the next time the section is
  loaded.
- The `General Notes` folder is deleted or missing outside the app: it is recreated on the next
  general-note save, and the section shows an empty state instead of an error.
- Saving fails (disk full, permissions): the pop-up shows "not saved", keeps the typed text in
  the editor, and does not close silently while content is unsaved.
- Many general notes (hundreds): the list remains usable (scrollable, quickly loaded).
- The home page is narrow or the Tasks list is long: the General notes section can be collapsed
  to its header, and the pop-up stays usable at small window sizes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The home page's Tasks panel MUST stack two sections like the session panel: Tasks
  above "General notes" (not a separate full-height panel), the latter listing the user's general
  notes. Each section collapses to its header; while both are expanded the boundary between them
  can be resized.
- **FR-002**: The section MUST show a title and a short description stating it is for quick,
  general notes and that course/lecture notes belong in class sessions; the empty state MUST
  explain the same.
- **FR-003**: Users MUST be able to create a new general note from the section with a single
  action.
- **FR-004**: Creating or opening a general note MUST open it in a pop-up box (modal dialog) over
  the home page, not in a new page, route, or session tab.
- **FR-005**: The pop-up MUST be visibly distinct from the session note workspace: smaller and
  bounded, labelled "General note", and without session-only tools (session timeline, audio,
  documents, AI chat).
- **FR-006**: The pop-up MUST use the same note editor as session notes, with the same
  capabilities (formatted-as-you-type with a raw-Markdown switch, diagrams and math from
  Feature 013), so content copied between a general note and a session note renders identically.
- **FR-007**: General notes MUST autosave while typing, and the pop-up MUST show the save state
  (saving / saved / not saved).
- **FR-008**: Closing the pop-up by any means (close button, Escape, clicking outside) MUST
  first flush pending changes; if saving fails, the pop-up MUST warn the user and keep the
  content rather than closing silently.
- **FR-009**: Each general note MUST be stored as a plain Markdown file named after the note in a
  folder called `General Notes` placed directly inside the user's own storage folder (alongside
  their year folders).
- **FR-010**: The `General Notes` folder MUST be created automatically the first time it is
  needed; users MUST NOT have to create it.
- **FR-011**: The `General Notes` folder name MUST NOT be able to collide with any year or other
  app-managed folder in the user's storage folder.
- **FR-012**: General notes MUST be listed most recently changed first, each with name and
  last-changed time.
- **FR-013**: Users MUST be able to rename a general note; names MUST be unique among the user's
  general notes, and the file on disk MUST be renamed to match.
- **FR-014**: Users MUST be able to delete a general note; deletion MUST require explicit
  confirmation and remove the file from `General Notes`.
- **FR-015**: A newly created general note that is closed while still empty MUST NOT leave an
  empty file behind.
- **FR-016**: Markdown files present in `General Notes` (including ones added or edited outside
  the app) MUST be shown as general notes, with their current content.
- **FR-017**: General notes MUST be private to the user who created them; one user MUST never see
  another user's general notes.
- **FR-018**: The General notes section and pop-up MUST be fully keyboard operable (open, create,
  edit, close, rename, delete) with visible focus and focus returned to the triggering element
  when the pop-up closes, and MUST work in light, dark and user-created themes.
- **FR-019**: Both sections' collapsed/expanded state and their split MUST be remembered across
  visits; collapsing one gives the other the whole column. When the Tasks panel is closed, its
  rail MUST show an item per section (Tasks with its open and overdue counts, General notes) and
  activating an item MUST reopen the panel with that section expanded and focused.
- **FR-020**: General notes MUST be included in the user's data backup and restore like their
  other notes.

### Key Entities *(include if feature involves data)*

- **General note**: A general, non-class Markdown note owned by one user. Attributes: name
  (unique per user), Markdown content, last-changed time. Not linked to any course, session,
  semester or event. Stored as one file in the user's `General Notes` folder.
- **General Notes folder**: The single folder inside a user's storage folder that holds all of
  that user's general notes, as plain files browsable without the app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the home page, a user can start typing a new general note within 2 seconds and
  with no more than 1 click or keystroke.
- **SC-002**: 100% of typed general-note content survives closing the pop-up, reloading or
  restarting the app (outside of a reported save failure).
- **SC-003**: In a hallway test, at least 9 of 10 first-time users correctly say that lecture
  notes go in a class session, not in General notes.
- **SC-004**: Every general note can be opened as a readable Markdown file from the user's
  `General Notes` folder using ordinary file tools, without the app running.
- **SC-005**: The General notes list for a user with 500 general notes appears in under 1 second.
- **SC-006**: Every general-note action (create, open, edit, close, rename, delete) can be
  completed using only the keyboard.

## Assumptions

- "Main page" means the home page introduced by Feature 012 (Calendar and Tasks panels); General
  notes is the second section of the Tasks panel, so the home page keeps two columns.
- "Users folder" means the per-user storage folder the app already keeps for each user (the
  folder holding their year/semester tree); `General Notes` sits directly inside it. Year names
  are free text, so a year folder must be kept from taking the name (FR-011).
- The on-screen name is "General notes", not "Quick notes": Feature 012 already uses "quick notes"
  for the short notes attached to a task, and the two must not be confused.
- Storing notes outside the `<year>/<semester>/...` hierarchy is a new layout rule; the plan
  will propose the matching amendment to Constitution Principle II (as was done for events).
- General notes are a flat list: no folders, tags, search, pinning, or links to courses in this
  version. Moving a general note into a class session is out of scope.
- General notes reuse the existing session note editor (including diagrams and math) and its
  autosave behaviour, in a compact pop-up; no recording, transcription, document or AI chat features are available for general
  notes.
- Display name and file name are kept in step; the file name is the note name made safe for the
  file system, as already done for session notes.
