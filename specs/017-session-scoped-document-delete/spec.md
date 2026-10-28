# Feature Specification: Session-Scoped Document Deletion

**Feature Branch**: `017-session-scoped-document-delete`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "I want a fix; imagine of one session 5 and i have added a file on sesssion 1 , then if i delete that file in session 5 it will delete the file in session 1 as well. i dont want this. i want the main file to be deletede only on the sessions that is added."

**Depends on**: Feature 007 (session documents: upload, list, rename, delete, reader, annotations,
and the later change that lists every PDF of the course in each of its sessions, marked
"from <date>" when uploaded to another session), Feature 014 (chat attachments that reference
session PDFs), Feature 016 (backup and restore). Constitution Principles I (user work is never
lost; destructive operations need confirmation) and II (files stay in the session folder they
were uploaded to).

## Background *(the problem being fixed)*

Each session's Documents section lists the PDFs of every session of the course. A PDF uploaded
to another session shows "from <date>". Today the Delete action is the same for every row: when
the student is in session 5 and deletes a PDF that was uploaded to session 1, the one original
file is deleted, so it disappears from session 1 and from every other session of the course.
The student expects deleting in session 5 to affect session 5 only.

## Clarifications

### Session 2026-10-29

- Q: When the student deletes, in session 5, a PDF uploaded to session 1, what should happen? → A: Hide it in session 5 only; the PDF stays in session 1 and all other sessions, and can be shown in session 5 again later.
- Q: Should removing a PDF in session 5 also remove it from later sessions (6, 7, …)? → A: Yes. It is hidden in session 5 and every later session of the course; earlier sessions and the session it was uploaded to keep it. "Show again" lists it again from where it was removed on.
- Q: If the student renames a PDF while in a session it wasn't uploaded to, should that rename the original file? → A: No; Rename is offered only in the owning session. Other sessions' menus have no Rename.
- Q: After a PDF is hidden in session 5, should session 5's AI chat still offer it as an attachment? → A: No; it is left out of session 5's chat attach menu too. Earlier chat messages that referenced it still open it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Removing a PDF from another session's list keeps the original (Priority: P1)

A student uploaded "Week 1 slides.pdf" to session 1 of CS 201. In session 5 they no longer want
it cluttering the Documents list, so they choose to remove it there. It disappears from session
5's list only; session 1 still has the PDF, its file, its annotations and its last read page, and
every other session of the course still lists it.

**Why this priority**: This is the reported bug. A student can lose a lecture PDF (and its
annotations) by tidying up an unrelated session, which breaks the core promise that user work is
never lost.

**Independent Test**: Upload a PDF to session 1, open session 5, remove that PDF from session 5's
Documents list, then open session 1 and confirm the PDF, its file in session 1's `documents/`
folder and its annotations are all unchanged.

**Acceptance Scenarios**:

1. **Given** session 5 lists a PDF uploaded to session 1, **When** the student opens that PDF's
   actions menu in session 5, **Then** the menu offers "Remove from this and later sessions" and offers
   neither Rename nor an action that deletes the PDF.
2. **Given** the student chooses "Remove from this and later sessions" in session 5, **When** the action
   completes, **Then** the PDF no longer appears in session 5's Documents list, and a short
   message confirms it with an Undo action.
3. **Given** the PDF was removed from session 5, **When** the student opens session 1, **Then**
   the PDF is listed, opens in the reader at its last read page, and keeps all its annotations.
4. **Given** the PDF was removed from session 5, **When** the student opens an earlier session of
   the course (e.g. session 3), **Then** the PDF is still listed there; **When** they open a later
   session (e.g. session 6 or 7), **Then** it is not listed there either.
5. **Given** the PDF was removed from session 5, **When** the student browses the course's
   folders outside the app, **Then** the PDF file is still in session 1's `documents/` folder.
6. **Given** the PDF was open as a tab in session 5, **When** it is removed from session 5,
   **Then** that tab closes in session 5 only.

---

### User Story 2 - Deleting the PDF in the session it was uploaded to (Priority: P1)

In session 1, where the PDF was uploaded, the student can still delete it for good. Because it
also appears in the course's other sessions, the confirmation says so before anything is deleted.

**Why this priority**: The student must keep a way to really delete a PDF, and must know that
doing so removes it from every session that lists it.

**Independent Test**: Upload a PDF to session 1, delete it from session 1 with confirmation, and
confirm it is gone from session 1, from session 5 and from session 1's `documents/` folder.

**Acceptance Scenarios**:

1. **Given** session 1 lists a PDF uploaded to session 1, **When** the student opens its actions
   menu, **Then** the menu offers "Rename…" and "Delete…".
2. **Given** the student chooses "Delete…" in session 1, **When** the confirmation appears,
   **Then** it names the PDF, says that it is also listed in the course's other sessions and will
   disappear from all of them, says how many annotations are deleted with it, and that this can't
   be undone.
3. **Given** the confirmation, **When** the student confirms, **Then** the PDF, its file and its
   annotations are deleted and it no longer appears in any session of the course; **When** the
   student cancels, **Then** nothing changes.

---

### User Story 3 - Bringing a removed PDF back to a session (Priority: P2)

Weeks later, in session 5, the student wants "Week 1 slides.pdf" back in the list. They can see
which course PDFs were removed from this session and restore any of them.

**Why this priority**: Removing from a session is meant to be safe and reversible; without a
way back, the student would have to go to session 1 to reach the PDF.

**Independent Test**: Remove a PDF from session 5, close the Undo message, then restore it from
session 5's Documents section and confirm it is listed and opens as before.

**Acceptance Scenarios**:

1. **Given** at least one course PDF was removed from session 5, **When** the student looks at
   session 5's Documents section, **Then** a "Removed from this session (N)" control is shown;
   when none were removed, it is not shown.
2. **Given** the student opens that control, **When** they choose "Show again" on a PDF,
   **Then** the PDF is listed again in session 5 in its usual place, with its name, size, upload
   date and "from <date>" marker.

---

### Edge Cases

- **PDF in its own session**: A PDF is only "removed from a session" in sessions it was not
  uploaded to. In the session it was uploaded to, the only removal action is "Delete…" (User
  Story 2).
- **Original deleted after being removed elsewhere**: If the PDF is deleted in its own session,
  it disappears from every session, including any "Removed from this session" list.
- **Renamed after being removed**: Renaming the PDF in its owning session does not bring it back to a
  session where it was removed; it shows under its new name in the removed list.
- **Same PDF removed from several sessions**: Each removal reaches its session and the later ones.
  "Show again" in a session drops every removal that reaches it, so the PDF is listed again from
  the earliest of those sessions on; a removal made in a later session stays.
- **New sessions**: A session added later in the course doesn't list a PDF removed in an earlier
  session; one added before that session lists it.
- **PDF uploaded to a later session**: A PDF uploaded to session 8 and removed in session 5 is
  hidden in sessions 5–7 and 9 on, but session 8 always lists it.
- **Moved sessions**: Sessions are ordered by their original date, so a session moved in the
  calendar keeps its place for this rule.
- **Uploading in session 5 a PDF with the same name as one removed from session 5**: Name checks
  and conflict handling are as today (Feature 007), counting the removed PDF as an existing name
  only where today's rules already would.
- **Chat attachments**: Session 5's chat attach menu no longer offers a PDF removed from session
  5, but earlier messages in session 5's chats that referenced it still open it, because the PDF
  still exists. A chat whose referenced PDF was deleted in its own
  session shows "no longer available" as today (Feature 014).
- **Two windows**: If session 5 is open in two windows and the PDF is removed in one, the other
  stops listing it the next time its list refreshes, and opening the stale row does not delete
  anything.
- **Missing file**: A PDF marked "File missing" can still be removed from another session and
  restored there; deleting it in its own session behaves as today.
- **Events**: The same rules apply to an event series, whose occurrences list each other's PDFs
  like a course's sessions.
- **Session or course deletion**: Deleting a session deletes only the PDFs uploaded to it (as
  today) and its own removal choices; it never deletes PDFs uploaded to other sessions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each PDF MUST have one owning session: the session (or event occurrence) it was
  uploaded to. The PDF's file MUST stay in that session's `documents/` folder.
- **FR-002**: The actions menu of a PDF shown in a session that does not own it MUST NOT offer any
  action that deletes the PDF, its file or its annotations.
- **FR-003**: The actions menu of a PDF shown in a session that does not own it MUST offer
  "Remove from this and later sessions", which hides the PDF from that session's Documents list
  and from the lists of every later session of the course (or event series), except the session
  that owns the PDF.
- **FR-004**: Removing a PDF from a session MUST NOT change the PDF, its file, its name, its
  annotations, its last read page, or how it is listed in earlier sessions or its owning session.
- **FR-005**: Removing a PDF from a session MUST close that PDF's reader tab in that session if
  one is open, and MUST show a confirmation message with an Undo action that lists it again.
  No confirmation dialog is needed, because nothing is deleted.
- **FR-006**: A session from which at least one course PDF was removed MUST show a "Removed from
  this session (N)" control listing those PDFs, each with a "Show again" action that
  lists it again from the session where it was removed on.
- **FR-007**: Removal choices MUST be kept, survive app restarts, and be included in
  backups and restored with them (Feature 016).
- **FR-008**: The actions menu of a PDF in its owning session MUST offer "Delete…", which deletes
  the PDF, its file and its annotations everywhere after explicit confirmation, as today.
- **FR-009**: The delete confirmation MUST state that the PDF is also listed in the course's other
  sessions (or the event's other occurrences) and will disappear from all of them, in addition to
  today's text about annotations and that it can't be undone.
- **FR-010**: The app MUST refuse a delete or rename request for a PDF that is made from a session
  other than its owning session, leaving the PDF unchanged and showing a clear message, so that a
  stale or outdated screen cannot change another session's PDF.
- **FR-011**: Every row in a session's Documents list MUST continue to show "from <date>" for PDFs
  owned by another session, so the student can tell which session owns each PDF.
- **FR-012**: "Rename…" MUST be offered only in the PDF's owning session; renaming there renames
  the one PDF and its file, and every session that lists it shows the new name.
- **FR-013**: A PDF removed from a session MUST NOT be offered in that session's chat attach menu
  (Feature 014) until it is shown in that session again; chat messages that already reference it
  MUST still open it.
- **FR-014**: Open, read position and annotations MUST behave as they do today; this fix changes
  only removal, deletion, where Rename is offered, and which PDFs the chat attach menu offers.

### Key Entities

- **Document (PDF)**: A PDF uploaded to one owning session; it has a name, size, upload date,
  file in the owning session's `documents/` folder, annotations and a last read page. It is
  listed in every session of the same course (or event series) unless removed from that session.
- **Session removal**: A record that a given session does not list a given course PDF. It belongs
  to that session, never to the PDF's owning session, and deleting it (restoring) lists the PDF
  again in that session only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tests, removing a PDF from a session that does not own it leaves the PDF
  listed, openable and fully annotated in its owning session and in every other session.
- **SC-002**: In 100% of tests, no action available in a non-owning session deletes a PDF's file
  from its owning session's folder.
- **SC-003**: A student can remove a PDF from a session, and bring it back, in at most 2 actions
  each from the Documents section.
- **SC-004**: In usability checks, students can tell in under 5 seconds whether an action in a
  PDF's menu affects only the current session or every session, from its label alone.
- **SC-005**: Deleting a PDF from its owning session removes it from every session of the course
  within the time the Documents list takes to refresh today, with no session still showing it.

## Assumptions

- The reported "file" is a session PDF (Feature 007). Notes and recordings are listed only in
  their own session today, so they cannot be deleted from another session and are out of scope.
- "Delete only in the session it was added" is read as: the original can be deleted only from
  its owning session, and "deleting" it in another session means hiding it there (confirmed in
  Clarifications). Rejected alternatives: removing the action in other sessions (the student
  still wants to tidy that session's list) and listing each PDF only in its owning session.
- Course-wide listing of PDFs stays: every session still lists the course's PDFs by default.
- Removal choices are per session, not per course; there is no "remove from all other sessions"
  action.
- Undo is offered only through the short message after removal and through the "Removed from
  this session" control; removal has no time limit.
