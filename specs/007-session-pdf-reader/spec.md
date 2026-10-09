# Feature Specification: Session Documents & PDF Reader

**Feature Branch**: `007-session-pdf-reader`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "Users can attach PDF files (lecture slides, handouts, papers) to a class session and read them inside the app. Upload: a \"Documents\" section in the session lets users upload one or more PDFs (button or drag and drop), see them in a list with name, size and upload date, and rename or delete them. Non-PDF files and oversized files are rejected with a clear message. Reader: clicking a PDF opens it in a built-in reader inside the session workspace, as a tab alongside the note tabs, so the user can read the slides and type notes side by side. The reader supports page navigation (previous, next, jump to page), zoom, scrolling through pages, a page indicator, and text search within the document. The reader remembers the last page the user was on for each PDF. The reader works in light, dark and custom themes without making the page unreadable. Out of scope for now: highlighting, annotations, and editing PDFs. Additional requirement: the reader appears as one tab in the session workspace's own tab bar; the reader must not show a second tab bar of its own."

**Update (2026-10-08)**: Added Priority 2 "Annotate" (User Story 6, FR-025–FR-036): highlight,
freehand, text boxes and comments with colour, move, delete, undo/redo; autosave with visible save
state; annotations kept outside the never-modified original PDF; existing annotations displayed.

**Depends on**: Feature 002 (session workspace, side panel, tab bar, workspace state), Feature 005
(themes), Feature 006 (upload patterns: pre-checks, progress, cancel, never overwrite).
Constitution (v1.1.0) Principles I (work never lost), II (open formats, readable folder hierarchy,
`documents/` folder, originals never modified) and V (themes, keyboard, AA).

## Clarifications

### Session 2026-10-08

- Q: How are a PDF and a note shown at the same time when both are tabs of the single workspace tab bar? → A: A split view of the main area that the user toggles on and off: two side-by-side panes with a resizable divider, each showing one tab from the single tab bar; the tab bar marks which pane each tab is in.
- Q: In dark and custom themes, should PDF pages keep their original colours or can the user switch pages to a dark look? → A: Original colours by default; an optional "dark pages" toggle in the reader shows pages with inverted lightness (images kept un-inverted where possible), remembered per user, off by default.
- Q: Can users change annotations that were already inside the PDF when it was uploaded, or are they display-only? → A: Display only: they are shown as they are in the file and can't be selected, edited, moved or deleted; users add their own annotations on top.
- Q: If the same PDF is annotated in two windows, what happens when the second window saves? → A: Both windows' changes are saved into the document's one annotation file, merged; nothing is lost and no second file is created. If both changed the same annotation, both versions are kept in that file and the user is told.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach the lecture slides to a session (Priority: P1)

Before Monday's CS 201 lecture a student downloads the slides PDF. They open the session, and in
its "Documents" section choose "Upload PDF" (or drop the file there). The PDF appears in the list
with its name, size and the date it was uploaded.

**Why this priority**: Without documents in the session there is nothing to read; attaching them
also gives students one place per class for slides, handouts and papers.

**Independent Test**: Upload one PDF to a session and confirm it is listed with name, size and
upload date, and that the file sits in the session's folder outside the app.

**Acceptance Scenarios**:

1. **Given** an open session workspace, **When** the user chooses "Upload PDF" and picks one or
   more PDF files, **Then** each upload shows its progress and, when finished, appears in the
   session's Documents list with its name, size and upload date.
2. **Given** the Documents section, **When** the user drags one or more PDF files onto it,
   **Then** they are uploaded as if picked with "Upload PDF", and a visible drop target is shown
   while the files are dragged over it.
3. **Given** an upload in progress, **When** the user cancels it, **Then** nothing from that file
   appears in the list or in the session's folder, and other uploads continue.
4. **Given** a completed upload, **When** the user browses year → semester → course → session
   date → `documents/` outside the app, **Then** the PDF is there under its readable name,
   unchanged, and opens in any PDF viewer.

---

### User Story 2 - Refuse files that aren't usable PDFs (Priority: P1)

The student accidentally picks a PowerPoint file and a 900 MB scanned book together with the
slides. The first two are refused at once with a message saying why; the slides upload.

**Why this priority**: Clear, early refusals avoid long uploads that fail and unreadable items in
the list.

**Independent Test**: Pick a PDF, a non-PDF and an oversized file together; the two bad files are
refused before anything is sent, each with a specific message, and the PDF uploads.

**Acceptance Scenarios**:

1. **Given** a file that is not a PDF, **When** the user picks or drops it, **Then** it is not
   uploaded and the user sees the file name and "Only PDF files can be added here".
2. **Given** a file larger than the size limit, **When** the user picks or drops it, **Then** it
   is not uploaded and the user sees the file name, its size and the limit.
3. **Given** a file named `.pdf` whose content is not a readable PDF, **When** the upload
   finishes, **Then** it is refused with "This file couldn't be read as a PDF" and nothing is kept.

---

### User Story 3 - Read the slides while taking notes (Priority: P1)

During the lecture the student opens the slides from the Documents list. The PDF opens as a tab in
the workspace's tab bar, next to their "Lecture notes" tab. They show the slides and the note side
by side, page through the slides with the keyboard, zoom in on a diagram, and keep typing notes.

**Why this priority**: Reading slides next to one's own notes is the purpose of the feature.

**Independent Test**: Open a PDF from the list, confirm it appears as one tab in the workspace tab
bar (and the reader has no tab bar of its own), navigate pages, zoom, and type in a note shown
next to it without losing the reader's page.

**Acceptance Scenarios**:

1. **Given** a session with a PDF, **When** the user selects it in the Documents list, **Then** it
   opens as a tab in the workspace's tab bar, alongside note tabs, and becomes the active tab;
   selecting an already open PDF focuses its tab.
2. **Given** an open reader, **Then** the reader shows the document's pages with a page indicator
   ("Page 3 of 42") and controls for previous page, next page, jump to page, zoom in, zoom out and
   fit to width, and the user can scroll continuously through the pages.
3. **Given** an open reader, **Then** it has no tab bar, tab strip or document switcher of its own;
   switching between documents and notes happens only through the workspace's tab bar.
4. **Given** a PDF tab and a note tab, **When** the user turns split view on (button or keyboard
   shortcut), **Then** the main area shows two side-by-side panes, each showing one tab from the
   single workspace tab bar (e.g., the PDF on the left, the note on the right), and the user can
   type in the note while the reader keeps its page, zoom and scroll position.
5. **Given** split view is on, **When** the user turns it off, **Then** the main area shows only
   the active tab again, all tabs stay open, and each keeps its position; turning it on again
   restores the previous pairing.
6. **Given** a jump-to-page entry, **When** the user enters a page number outside the document,
   **Then** the reader goes to the nearest valid page and says so.

---

### User Story 4 - Pick up where I left off (Priority: P2)

A week later the student opens the same slides to revise. The reader opens at page 27, where they
stopped last time, also on their laptop at home.

**Why this priority**: Long papers and slide decks are read over several sittings; returning to
page 1 every time is frustrating.

**Independent Test**: Read to page 27, close the tab, reload, open the PDF again (also from another
browser signed in as the same user): it opens at page 27.

**Acceptance Scenarios**:

1. **Given** a PDF last read at page 27, **When** the user opens it again (same or another device),
   **Then** the reader opens at page 27.
2. **Given** a PDF never opened before, **When** the user opens it, **Then** it starts at page 1.
3. **Given** a remembered page beyond the document's page count (e.g., the file was replaced
   outside the app), **When** the PDF opens, **Then** it opens at the last page.

---

### User Story 5 - Find a term in the document (Priority: P2)

Before the exam the student searches the lecture PDF for "red–black tree" and steps through every
match.

**Why this priority**: Searching is the fastest way to find a topic in long slides or papers.

**Independent Test**: Search a multi-page PDF for a word that appears on several pages; the reader
reports the number of matches, highlights the current one and moves between them.

**Acceptance Scenarios**:

1. **Given** an open reader, **When** the user searches for text, **Then** the reader shows how many
   matches were found, scrolls to the first one and highlights it.
2. **Given** search results, **When** the user goes to the next or previous match, **Then** the
   reader moves to it, changing page when needed, and shows which match is current ("3 of 11").
3. **Given** a document with no text (e.g., scanned images), **When** the user searches, **Then**
   the reader says the document has no searchable text instead of reporting zero matches silently.

---

### User Story 6 - Annotate a document (Priority: P2)

While revising, a student highlights a definition on slide 12, draws an arrow next to a diagram,
adds a text box saying "exam!", and leaves a comment on page 14 asking "why O(log n)?". They change
a highlight's colour, move the text box, delete the arrow, then undo the delete. Every change saves
itself. The next day they open the same PDF on their laptop and every annotation is there.

**Why this priority**: Marking up slides is the natural next step after reading them, and students
otherwise do it in another app, away from their notes.

**Independent Test**: Add one of each annotation type, reload, then open the PDF in a second
browser: all annotations are there, and the PDF file on disk is byte-identical to the upload.

**Acceptance Scenarios**:

1. **Given** text selected in the reader, **When** the user chooses Highlight, **Then** that text is
   highlighted in the current colour and saved.
2. **Given** the draw tool, **When** the user drags on a page, **Then** a freehand stroke is drawn in
   the current colour and width and saved.
3. **Given** the text-box tool, **When** the user clicks a page and types, **Then** a text box with
   that text appears there and is saved.
4. **Given** the comment tool, **When** the user clicks a page, **Then** a comment marker is placed
   there; activating it shows and edits the comment text.
5. **Given** an annotation, **When** the user selects it, **Then** they can change its colour, move it
   (text boxes, comments, drawings) or delete it.
6. **Given** annotation changes, **When** the user chooses undo, **Then** the last change is
   reverted; redo re-applies it; both are saved like any change.
7. **Given** any annotation change, **Then** the reader's save state shows "Saving…" and then
   "Saved" within 2 seconds, without the user pressing save.
8. **Given** a document with saved annotations, **When** it is reopened in the same or another
   browser, **Then** all annotations appear where they were.
9. **Given** a PDF without selectable text (e.g., scanned), **When** the user wants to highlight,
   **Then** Highlight is unavailable with the explanation "This document has no selectable text, so
   text can't be highlighted", while freehand, text boxes and comments still work.
10. **Given** a PDF that already contains annotations, **When** it is opened, **Then** they are
    displayed as they appear in the file and can't be selected, edited, moved or deleted.

---

### User Story 7 - Manage documents (Priority: P2)

The student renames "CS201_L05_final_v2.pdf" to "Lecture 5 — Trees" and deletes a handout added to
the wrong session.

**Why this priority**: File names from course sites are often cryptic; mistakes need cleaning up.

**Independent Test**: Rename a document and confirm the list, an open tab and the file name update;
delete one after confirmation and confirm its file and tab are gone.

**Acceptance Scenarios**:

1. **Given** a document, **When** the user renames it to a non-empty name unused in the session,
   **Then** the list, any open tab title and the file name change; the content is unchanged.
2. **Given** a duplicate or empty name, **When** the user confirms, **Then** the rename is refused
   with a message.
3. **Given** a delete request, **When** the user has not confirmed, **Then** nothing is deleted;
   **When** they confirm, **Then** the document is removed from the list, its tab closes and its
   file is removed from the session's folder. If it has annotations, the confirmation says they
   will be deleted too (with their count), and they are removed with it.
4. **Given** an annotated document, **When** the user renames it, **Then** its annotations stay.

---

### Edge Cases

- Uploading a PDF whose name matches an existing document in the session: it is added under the
  next free name ("Name (2)"); existing documents are never renamed or replaced.
- Password-protected (encrypted) PDF: it can be uploaded and listed, but the reader explains that
  protected PDFs can't be opened in the app; the file can still be opened outside the app.
- Damaged PDF that passed the upload check but fails to render a page: the reader shows an error for
  that page and keeps the other pages readable.
- Very large documents (e.g., 1,000 pages or 100 MB): the reader opens quickly and stays responsive
  by rendering only pages near the visible area.
- PDFs with links: links to other pages of the same document navigate within the reader; links to
  web addresses open in a new browser tab; scripts, forms and embedded files in the PDF are never
  run or opened.
- Dark and custom themes: the reader's surroundings, controls and page indicator follow the theme;
  pages keep their original colours unless the user turns on "dark pages" (never automatically).
- "Dark pages" on a slide full of photos or coloured diagrams: images stay un-inverted where the
  document marks them as images; if a page still reads poorly, turning the toggle off restores the
  original colours at once without losing the page or zoom.
- Narrow screens: the reader uses the full width; split view is only offered when there is room for
  both panes, and a split remembered from a wide window shows as a single tab on a narrow one.
- Closing the tab shown in one pane of a split: the other pane takes the full area (split turns
  off) until the user splits again.
- The PDF file is deleted or moved outside the app: the list marks it "File missing" and the reader
  says so instead of failing silently.
- Deleting a document that is open in a tab: the tab closes after the delete is confirmed.
- Upcoming sessions: documents can be added to them (lecturers often share slides in advance).
- Uploading while recording or while another upload runs: allowed; nothing is interrupted.
- Leaving or reloading the page while uploads are running warns the user; unfinished uploads are
  discarded.
- The same PDF annotated in two windows: both windows' changes are merged into the one annotation
  file; if both changed the same annotation, both versions are kept and the user is told (FR-036).
- The annotation file is deleted or edited outside the app: the document opens with whatever the
  file now contains (or no annotations); the app never overwrites an annotation file that changed
  since it was loaded without keeping both versions.
- Saving fails (server unreachable): changes stay on the device, the save state shows "Not saved",
  saving is retried automatically, and leaving the page warns the user.
- Annotations made at one zoom level stay in the right place at every other zoom level, in split
  view, and with "dark pages" on.
- Annotations near a page edge and very long comments stay readable and reachable at every zoom.

## Requirements *(mandatory)*

### Functional Requirements

**Documents list and upload**

- **FR-001**: Each session MUST have a "Documents" section, in the session's "Sessions and notes"
  side panel section below the note list, listing the session's PDFs with name, size and upload
  date, ordered by upload date (newest first), available for upcoming and past sessions.
- **FR-002**: Users MUST be able to add one or more PDFs with an "Upload PDF" action or by dragging
  and dropping files onto the Documents section; the button MUST be keyboard operable, so drag and
  drop is never the only way.
- **FR-003**: Only PDF files MUST be accepted; other files MUST be refused before upload with a
  message naming the file.
- **FR-004**: Each PDF MUST be at most 200 MB; larger files MUST be refused before upload with a
  message naming the file, its size and the limit.
- **FR-005**: Each upload MUST show its progress and MUST be cancellable; a cancelled or failed
  upload MUST leave nothing in the list or the session's folder. Files in a multi-file upload are
  handled independently.
- **FR-006**: After upload, the app MUST check that the file is a readable PDF and refuse it with a
  clear message otherwise, keeping nothing.
- **FR-007**: Each document MUST be stored unchanged as its own `.pdf` file in the session's folder
  (year → semester → course → session date → `documents/`), under a readable name that follows the
  document's name.
- **FR-008**: A new document MUST be named after its file (without extension); if that name is
  already used in the session (ignoring case), the next free name ("Name (2)") is used. An upload
  MUST NOT overwrite, rename or modify any existing document or file.
- **FR-009**: Users MUST be able to rename documents (non-empty, unique in the session, at most 120
  characters; the file is renamed to match, and its annotations stay with it) and delete them after
  explicit confirmation (the file is removed). When the document has annotations, the confirmation
  MUST say they will be deleted too (with their count), and they are removed with the document.
- **FR-010**: Leaving or reloading the page while uploads are running MUST warn the user; uploads
  MUST continue while the user moves around within the app.

**Reader in the workspace tab bar**

- **FR-011**: Selecting a document MUST open it in a built-in reader as a tab in the session
  workspace's existing tab bar, alongside note tabs, one document per tab; selecting an already
  open document focuses its tab. The tab shows the document name and can be closed like a note tab.
- **FR-012**: The reader MUST NOT show a tab bar, tab strip or document switcher of its own; the
  workspace's tab bar is the only place to switch between open documents and notes.
- **FR-013**: Open document tabs MUST be remembered with the session's other open tabs and active
  tab (002 FR-013) and restored when the user returns to the session.
- **FR-014**: The workspace MUST offer a split view that the user toggles on and off (a button in
  the tab bar area and a keyboard shortcut). When on, the main area shows two side-by-side panes
  with a divider resizable by pointer and keyboard; each pane shows one tab from the single tab
  bar, and the tab bar marks which pane each tab is shown in. Selecting a tab shows it in the
  focused pane; a tab can be moved to the other pane. The user can type in a note in one pane while
  the reader in the other keeps its page, zoom and scroll position. When off, the main area shows
  only the active tab, and no tab is closed.
- **FR-014a**: Whether split view is on, which tab each pane shows and the divider position MUST be
  remembered per session with the open tabs (FR-013). Split view works with any two tabs (two
  notes, two documents, or one of each) and is only offered when the window is wide enough for
  two readable panes; on narrow windows the main area shows one tab.

**Reading**

- **FR-015**: The reader MUST show pages in a continuous vertically scrolling view, with a page
  indicator showing the current page and the page count.
- **FR-016**: The reader MUST offer previous page, next page and jump to page (out-of-range entries
  go to the nearest valid page with a message).
- **FR-017**: The reader MUST offer zoom in, zoom out, fit to width and a zoom level indicator, from
  50% to 400%; zoom keeps the current page in view.
- **FR-018**: The reader MUST offer text search within the document: number of matches, the current
  match highlighted, next/previous match (changing pages as needed), and a clear message when the
  document has no searchable text.
- **FR-019**: The reader MUST remember the last page per document and per user, across devices, and
  open at that page (or the last page if the document is now shorter); a document never opened
  starts at page 1.
- **FR-020**: Links inside a PDF MUST navigate within the document (internal links) or open in a new
  browser tab (web links); scripts, forms, attachments and other active content in a PDF MUST never
  run or open. Annotations already in the PDF are displayed only (FR-033) and their pop-up text is
  readable.
- **FR-021**: Password-protected PDFs MUST show a clear message that they can't be opened in the app,
  without failing silently.

**Themes, keyboard and accessibility**

- **FR-022**: The reader's toolbar, page indicator, surroundings, focus and search highlights MUST
  follow the active theme (light, dark, built-in presets and user-created themes) and meet WCAG AA;
  so MUST the annotation toolbar and the annotation save state. Page content MUST be shown in its
  original colours by default in every theme (annotation colours: FR-035).
- **FR-022a**: The reader MUST offer a "dark pages" toggle (off by default) that shows pages with
  inverted lightness while keeping images un-inverted where possible; the choice is remembered per
  user (across documents and devices), switching keeps the current page, zoom and scroll position,
  and the stored PDF file is never changed.
- **FR-023**: All reader and Documents controls MUST be keyboard operable with accessible names;
  while the reader has focus, Page Up/Page Down (or arrow keys) change pages, `Ctrl/Cmd+F` opens
  document search, `Ctrl/Cmd++` / `Ctrl/Cmd+-` zoom, `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` (or
  `Ctrl+Y`) undo and redo annotation changes, and `Delete` removes the selected annotation — without
  overriding the workspace shortcuts (002 FR-024) elsewhere; when focus is in a note (e.g., in the
  other split pane), these keys keep acting on the note.
- **FR-024**: The page indicator and search results MUST be announced to assistive technology; each
  page MUST expose its text to screen readers where the PDF contains text.

**Annotations**

- **FR-025**: Users MUST be able to add these annotations to a document: highlight on selected
  text, freehand drawing, free-text box, and comment pinned to a page location.
- **FR-026**: Users MUST be able to select one of their annotations and change its colour, move it
  and delete it; colours come from a fixed palette in which each colour has a name, so colours are
  never told apart by colour alone.
- **FR-027**: Users MUST be able to undo and redo annotation changes (create, edit, move, recolour,
  delete) for the open document; the history lasts while the document's tab is open, and undo and
  redo are saved like any change.
- **FR-028**: Annotation changes MUST be saved automatically within 2 seconds, with no save button,
  and the reader MUST show the save state (Saving / Saved / Not saved).
- **FR-029**: A failed save MUST be shown, kept on the device and retried automatically until it
  succeeds, never silently dropped; leaving or reloading the page, or closing the document's tab,
  with unsaved annotation changes MUST warn the user.
- **FR-030**: Saved annotations MUST be shown whenever the document is opened by the same user, in
  any browser or on any device.
- **FR-031**: The original uploaded PDF MUST never be modified. Annotations MUST be stored outside
  it, as plain files next to it in the session's `documents/` folder that can be read and backed up
  without the app (Constitution Principle II); the plan decides between a sidecar file and an
  annotated copy.
- **FR-032**: On a document without selectable text, text highlighting MUST be unavailable with a
  clear explanation, while freehand drawing, text boxes and comments MUST still work.
- **FR-033**: Annotations already inside an uploaded PDF MUST be displayed in the reader as they
  appear in the file; they are display-only and can't be selected, edited, moved or deleted. Users
  add their own annotations on top.
- **FR-034**: Annotation tools, annotations and comment text MUST be keyboard operable and readable
  by screen readers: selecting text to highlight, creating text boxes and comments, selecting,
  moving (arrow keys), recolouring and deleting MUST work without a pointer; freehand drawing is the
  only pointer-only action.
- **FR-035**: Annotation colours belong to the document and MUST look the same in every theme; with
  "dark pages" on, annotations MUST stay visible and distinguishable from the page and from each
  other.
- **FR-036**: When the same document is annotated in two windows or browsers, both windows' changes
  MUST be saved into the document's one annotation file (merged); no change is lost and no second
  file is created. If both windows changed the same annotation, both versions MUST be kept in that
  file and the user told.

### Key Entities

- **Document**: A PDF belonging to one session: name (unique within the session, ignoring case),
  original file name, size, page count when known, upload date, and its file in the session's
  `documents/` folder. Shown with "File missing" when its file is gone.
- **Reading position**: Per user and document, the last page read; used to reopen the document.
- **Reader preference**: Per user, whether "dark pages" is on.
- **Annotation**: A user's mark on one document: type (highlight, drawing, text box, comment), page,
  position, colour, content (text or stroke), created and updated times. Private to the user who
  made it; stored in the document's annotation file, never in the PDF itself.
- **Annotation save state**: Per open document, Saved / Saving / Not saved, with any changes still
  waiting to be saved on the device.
- **Workspace tab** (from 002, extended): an open item in the session's tab bar — now either a note
  or a document.
- **Upload** (as in 006): one in-progress transfer of a PDF, with progress, state and a reason when
  it fails; not kept after it finishes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open session, a user can attach a PDF in at most 2 actions and open it in the
  reader in 1 action.
- **SC-002**: 100% of non-PDF and oversized files are refused before any data is sent, with the
  message shown within 1 second.
- **SC-003**: A 100-page, 20 MB PDF shows its first (or remembered) page within 2 seconds of opening
  the tab, and moving to another page shows it within 1 second.
- **SC-004**: Search in a 300-page text PDF reports its matches within 3 seconds.
- **SC-005**: In tests, reopening a document lands on the last page read in 100% of cases, on the
  same and on another device.
- **SC-006**: While the reader is shown next to a note, typing in the note for 10 minutes never
  changes the reader's page, zoom or scroll position.
- **SC-007**: 100% of uploaded PDFs can be found and opened with a standard PDF viewer by browsing
  year → semester → course → date → `documents/` outside the app, byte-identical to the upload.
- **SC-008**: Every flow in this feature except freehand drawing can be completed using only the
  keyboard, and reader and annotation controls meet WCAG AA in light, dark and every built-in
  preset theme.
- **SC-009**: In tests, 100% of annotation changes are present after a reload and in a second
  browser, and "Saved" appears within 2 seconds of each change.
- **SC-010**: After any sequence of annotation actions (including undo, redo, rename, and failed and
  retried saves), the stored PDF is byte-identical to the upload.
- **SC-011**: Cutting the network for 15 minutes while annotating loses no annotation change once
  the connection returns, and changes made in two windows at the same time are all kept.

## Assumptions

- Only PDF is supported; other document formats (PowerPoint, Word, images, EPUB) are out of scope.
- The 200 MB limit covers large slide decks and papers; it can be revised in clarification.
- Out of scope: editing PDF content, redaction, form filling, shapes, creating underline or
  strike-out marks, signatures, stamps and images, exporting annotated PDFs for sharing, multi-user
  (shared) annotations, bookmarks, and printing from inside the reader.
- Annotations are private to the user who made them.
- "Dark pages" is a display setting only and is never applied automatically by the theme.
- Reading positions are stored per account (like the theme choice), not per device.
- Password-protected PDFs are not unlocked in the app.
- Documents do not appear in the course timeline's indicators in this feature (002 FR-005 shows
  note count and audio only).
- The session folder gains a `documents/` subfolder next to `notes/` and `audios/`; this extends
  the folder layout described in Constitution Principle II and must be confirmed in the plan's
  Constitution Check.
- Transcription, notes and audio behaviour are unchanged.
