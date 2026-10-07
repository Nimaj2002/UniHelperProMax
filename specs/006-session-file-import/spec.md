# Feature Specification: Import Audio and Notes into a Session

**Feature Branch**: `006-session-file-import`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Users can import existing files into a class session instead of creating them in the app. Audio import: in the session's audio panel, next to \"new recording\", an \"Upload audio\" action lets users pick one or more audio files from their device (or drag and drop them). Imported audio appears in the same list as recorded audio, with the same player (play, pause/stop, seek timeline, back 5s, forward 5s, volume), the same rename and delete, and the same Transcribe button. The user can tell which items were recorded and which were imported. Unsupported or oversized files are rejected with a clear message before upload, and upload shows progress and can be cancelled. Notes import: in the notes area, an \"Import note\" action lets users pick one or more Markdown (.md) or plain text (.txt) files. Each file becomes a new note in the session, named after the file. If the name already exists, the user chooses to rename, replace, or skip. Imported content is never merged into an existing note silently. Importing must never overwrite or damage existing notes or recordings."

**Depends on**: Feature 002 (session workspace, notes), Feature 003 (audio panel, recording
list, player, rename/delete), Feature 004 (Transcribe). Constitution Principles I (user work is
never lost) and II (open formats, readable folder hierarchy).

**Supersedes**: Feature 003's assumption "Uploading existing audio files from the user's device
is out of scope."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload a lecture recording made elsewhere (Priority: P1)

A student recorded Monday's CS 201 lecture on their phone. They open that session, choose
"Upload audio" next to "New recording", and pick the MP3. A progress bar shows the upload; when it
finishes, the file appears in the session's audio list marked "Imported", and they play it with
the same player as their in-app recordings.

**Why this priority**: Students often record lectures with other devices or receive recordings
from classmates; getting that audio into the right session is the main gap this feature fills.

**Independent Test**: Upload one supported audio file to a session, confirm it appears in the
list marked as imported, plays with every player control, and exists as a playable file in the
session's `audios/` folder.

**Acceptance Scenarios**:

1. **Given** an open session workspace, **When** the user chooses "Upload audio" and picks a
   supported file, **Then** the upload starts and shows its progress, and on completion the item
   appears in the session's audio list with its name, date, duration and an "Imported" marker.
2. **Given** an imported item, **When** the user uses play, pause, stop, the seek timeline, back
   5 seconds, forward 5 seconds and volume, **Then** each behaves exactly as for a recorded item.
3. **Given** the audio panel, **When** the user drags one or more audio files onto it, **Then**
   they are uploaded as if picked with "Upload audio", and the panel shows a visible drop target
   while files are dragged over it.
4. **Given** the user picks several files at once, **When** the upload runs, **Then** each file
   has its own progress and result, and one file failing does not stop the others.
5. **Given** an upload in progress, **When** the user cancels it, **Then** it stops, nothing from
   that file appears in the list or the session's folder, and other uploads continue.
6. **Given** a completed import, **When** the user browses year → semester → course → session
   date → `audios/` outside the app, **Then** the file is there under its readable name and plays
   in a standard media player.

---

### User Story 2 - Clear rejection of unusable audio files (Priority: P1)

The student accidentally picks a PDF and a 3 GB video export along with their lecture MP3. The
PDF and the oversized file are rejected immediately with messages saying why; the MP3 uploads.

**Why this priority**: Without up-front checks, users wait through long uploads only to fail, or
end up with unplayable items in their sessions.

**Independent Test**: Pick a mix of a supported file, an unsupported file type and a file over
the size limit; confirm the two bad files are rejected before any upload starts, each with a
specific message, and the good file uploads normally.

**Acceptance Scenarios**:

1. **Given** a file whose type is not a supported audio format, **When** the user picks or drops
   it, **Then** it is not uploaded and the user sees the file name and "This file type isn't
   supported", with the list of supported formats.
2. **Given** a file larger than the size limit, **When** the user picks or drops it, **Then** it
   is not uploaded and the user sees the file name, its size and the limit.
3. **Given** a file that passed the checks but turns out to be damaged or not really audio,
   **When** the upload finishes, **Then** it is rejected with "This file couldn't be read as
   audio", and nothing is added to the list or kept in the session's folder.

---

### User Story 3 - Manage and transcribe imported audio (Priority: P2)

The student renames the imported "VID_20261005_0932" to "Week 3 — Graphs", transcribes it into
their lecture note, and later deletes a duplicate import.

**Why this priority**: Imported audio is only as useful as recorded audio if users can organise
and transcribe it the same way; this reuses existing behaviour.

**Independent Test**: Rename, transcribe and delete an imported item; confirm each behaves as for
a recorded item (file renamed, transcript appended to the chosen note, file removed after
confirmation).

**Acceptance Scenarios**:

1. **Given** an imported item, **When** the user renames it to a valid unused name, **Then** the
   list and the audio file name update, as for recordings.
2. **Given** an imported item, **When** the user deletes it and confirms, **Then** it and its
   file are removed; without confirmation, nothing is deleted.
3. **Given** an imported item, **When** the user chooses "Transcribe", **Then** the same
   transcription dialog and behaviour as for recordings apply, including appending only to the
   target note.

---

### User Story 4 - Import existing notes (Priority: P2)

The student has notes from last week written in another editor: "Lecture 3.md" and
"questions.txt". In the session's notes area they choose "Import note" and pick both. Two new
notes, "Lecture 3" and "questions", appear in the note list with the files' content.

**Why this priority**: Lets students consolidate existing notes in the app; valuable but less
time-critical than getting lecture audio in.

**Independent Test**: Import one `.md` and one `.txt` file into a session with no notes of those
names; confirm two new notes appear, named after the files, with content identical to the files.

**Acceptance Scenarios**:

1. **Given** an open session workspace, **When** the user chooses "Import note" and picks one or
   more `.md` or `.txt` files, **Then** each becomes a new note in the session named after the
   file without its extension, and appears in the note list.
2. **Given** an imported note, **When** the user opens it, **Then** its content matches the
   imported file's text exactly, and it autosaves, renames and deletes like any other note.
3. **Given** a file that is not `.md` or `.txt`, is over the size limit, or is not readable text,
   **When** the user picks it, **Then** it is rejected with a message naming the file and the
   reason, and the other picked files are still imported.
4. **Given** an import completes, **When** the user looks at the session's `notes/` folder outside
   the app, **Then** each imported note is a Markdown file named after the note.

---

### User Story 5 - Resolve note name conflicts (Priority: P2)

The student imports "Lecture 3.md" into a session that already has a "Lecture 3" note. The app
asks what to do: rename the import, replace the existing note, or skip the file.

**Why this priority**: This is where imports could destroy existing work; the user must stay in
control of every case.

**Independent Test**: Import a file whose name matches an existing note and exercise rename,
replace (with and without confirming) and skip; confirm the existing note is changed only after
a confirmed replace.

**Acceptance Scenarios**:

1. **Given** an imported file whose name matches an existing note (ignoring case), **When** the
   import reaches it, **Then** the user is asked to choose Rename, Replace or Skip, and nothing
   changes in that note until they choose.
2. **Given** the conflict prompt, **When** the user chooses Rename, **Then** they enter a new name
   (pre-filled with a free suggestion such as "Lecture 3 (2)"), which must be non-empty and
   unused, and a new note is created with that name; the existing note is unchanged.
3. **Given** the conflict prompt, **When** the user chooses Replace, **Then** they must confirm a
   second, explicit warning that the existing note's content will be replaced; only after
   confirming is the existing note's content replaced by the file's content. Cancelling the
   confirmation returns to the conflict prompt.
4. **Given** the conflict prompt, **When** the user chooses Skip, **Then** that file is not
   imported and the existing note is unchanged.
5. **Given** several conflicting files, **When** the prompt appears, **Then** the user can apply
   their choice to all remaining conflicts in this import (Replace still requires one explicit
   confirmation listing every note that will be replaced).
6. **Given** the user closes the conflict prompt without choosing, **Then** the conflicting file
   is skipped and the existing note is unchanged.

---

### Edge Cases

- Two picked note files map to the same note name (e.g., `Lecture 3.md` and `lecture 3.txt`): the
  second is treated as a name conflict with the first and gets the same Rename/Replace/Skip prompt.
- Imported audio's name matches an existing recording's name: the import gets the next free name
  ("Lecture (2)"); existing recordings are never renamed or replaced.
- Replace is chosen for a note that is open with unsaved edits, or that a running transcription
  is about to append to: the replace is refused with a message explaining why, and the note is
  unchanged; the user can retry once the note is saved or the transcription has finished.
- A replaced note open in a tab: the tab shows the replaced content.
- File names with characters invalid in file names, or that are empty after removing the
  extension: the display name keeps the readable text; the stored file name uses a safe readable
  equivalent (as for notes and recordings today); an empty name falls back to "Imported note" /
  "Imported audio" plus " (2)", " (3)" … when that name is taken (no prompt, since the user didn't
  choose the name).
- File names longer than 120 characters (after removing the extension): the note or audio name is
  shortened to the first 120 characters; the conflict rules then apply to the shortened name.
- Empty `.md`/`.txt` file: imported as an empty note.
- Text file in an encoding other than UTF-8 that cannot be read as text: rejected as "not
  readable text"; files with a UTF-8 byte-order mark import without the mark.
- The connection drops during an audio upload: the upload is marked failed with a Retry action;
  nothing partial appears in the list or stays in the session's folder.
- The user navigates to another session or page in the app during an upload: uploads continue
  and remain visible with their progress; leaving or reloading the page while uploads are running
  warns the user, and uploads not finished are discarded.
- The session is an upcoming session: importing audio and notes is allowed, as recording is.
- Importing while a recording is in progress: allowed; the recording is not interrupted.
- Imported audio of 4 hours or more plays completely. Seeking is as fast as for recordings, except
  in WebM files that have no seek index (some non-browser tools write these): those still seek
  correctly but may take longer, because the app stores imported files unchanged.
- Transcribing imported audio longer than a provider allows per file: formats other than WebM
  are sent whole, so with a size-limited provider they fail with the existing clear "too long for
  this provider" error (Feature 004, FR-022).
- Deleting a session's imported item while it is being transcribed: blocked, as for recordings.
- Dropping files onto the panel that include folders: folders are ignored with a message; files
  are checked individually.

## Requirements *(mandatory)*

### Functional Requirements

**Audio import**

- **FR-001**: The session's audio panel MUST offer an "Upload audio" action next to "New
  recording", available for every session (upcoming or past).
- **FR-002**: Users MUST be able to choose one or more audio files from their device with a file
  picker, or by dragging and dropping them onto the audio panel; the picker MUST be reachable and
  operable by keyboard, so drag and drop is never the only way.
- **FR-003**: The app MUST accept these audio formats: MP3, M4A/AAC, WAV, OGG (Vorbis/Opus), WebM
  (Opus) and FLAC. Any other file type MUST be rejected before upload with a message naming the
  file and listing the supported formats.
- **FR-004**: Each audio file MUST be at most 1 GB; larger files MUST be rejected before upload
  with a message naming the file, its size and the limit.
- **FR-005**: Each upload MUST show its progress (percentage) and MUST be cancellable at any
  point before it completes; a cancelled or failed upload MUST leave nothing behind in the list or
  the session's `audios/` folder.
- **FR-006**: Files in a multi-file upload MUST be handled independently: each has its own
  progress, cancel and result, and one failure does not affect the others.
- **FR-007**: After upload, the app MUST check that the file is a recognisable audio file of the
  format its extension claims (valid format header and a readable duration) and determine its
  duration; files that fail this check MUST be rejected with a clear message and not kept. Damage
  inside an otherwise valid file is not detected; such files show the player's existing "can't be
  played" message.
- **FR-008**: An imported audio item MUST be stored, unchanged, as its own file in the session's
  `audios/` folder (year → semester → course → session date → `audios/`), under a readable name
  that follows the item's name, keeping its original format.
- **FR-009**: An imported item MUST get a default name taken from its file name (without
  extension); if that name is already used by a recording or import in the session (ignoring
  case), the next free name MUST be used ("Name (2)", "Name (3)", …). Existing items MUST never
  be renamed, replaced or modified by an import.
- **FR-010**: Imported items MUST appear in the same list as recordings, showing name, date,
  duration and an "Imported" marker (text, not colour alone); recorded items MUST remain
  distinguishable as recorded. The date shown for an imported item is when it was imported, and
  it is ordered in the list by that date.
- **FR-011**: Imported items MUST support exactly the same player controls (play, pause, stop,
  seek timeline, back 5 seconds, forward 5 seconds, volume), rename, delete (with confirmation)
  and "Transcribe" behaviour as recorded items (Feature 003 FR-014 – FR-022, Feature 004).
- **FR-012**: Uploads MUST continue while the user navigates within the app; leaving or
  reloading the page with uploads running MUST warn the user.
- **FR-013**: Imported items MUST count toward the session's audio presence on the course
  timeline (Feature 002 FR-005).

**Notes import**

- **FR-014**: The session's notes area MUST offer an "Import note" action next to "New note",
  available for every session.
- **FR-015**: Users MUST be able to choose one or more `.md` or `.txt` files with a file picker.
- **FR-016**: Each note file MUST be at most 5 MB and readable as text (UTF-8); other files MUST
  be rejected with a message naming the file and the reason, without stopping the other files.
- **FR-017**: Each accepted file MUST become a new note in the session, named after the file
  without its extension, with content identical to the file's text, stored as a Markdown file in
  the session's `notes/` folder (`.txt` content is stored as-is in a `.md` file).
- **FR-018**: When an imported note's name matches an existing note in the session, or another
  file earlier in the same import (ignoring case), the user MUST choose Rename, Replace or Skip
  for it; the app MUST NOT pick for them, and closing the prompt MUST mean Skip.
- **FR-019**: Rename MUST require a non-empty name unused in the session and create a new note;
  Skip MUST import nothing for that file.
- **FR-020**: Replace MUST require a separate explicit confirmation naming every note to be
  replaced, and only then replace that note's whole content with the file's content, keeping its
  name. Replace MUST be refused while the note has unsaved edits or a transcription is about to
  append to it.
- **FR-021**: The conflict prompt MUST offer "apply to all remaining conflicts in this import".
- **FR-022**: Imported content MUST NEVER be merged into, appended to or mixed with an existing
  note; the only way an existing note's content changes is a confirmed Replace.

**Safety and quality**

- **FR-023**: An import MUST NOT overwrite, modify, rename or delete an existing note or audio
  item or its file, except a confirmed note Replace (FR-020).
- **FR-024**: An import that fails part-way MUST leave the session exactly as before for that
  file: no partial note, no partial audio item, no stray file in the session's folders.
- **FR-025**: After an import, the user MUST see a summary of the result per file (imported,
  renamed, replaced, skipped, rejected with reason).
- **FR-026**: All import controls, progress, prompts and messages MUST be keyboard operable,
  have accessible names, announce progress and results to assistive technology, and render
  correctly in light, dark and user-created themes.

### Key Entities

- **Audio item**: An entry in a session's audio list — either a **Recording** (Feature 003) or
  an **Imported audio** item. Both have a name (unique within the session, ignoring case), date,
  duration, status and an audio file in the session's `audios/` folder. Each item records its
  origin (recorded or imported); imported items also keep their original file name.
- **Upload**: A single in-progress transfer of one audio file into a session: file name, size,
  progress, state (uploading, verifying, done, cancelled, failed, rejected) and a reason when it
  fails. Not kept after it completes.
- **Note**: (from Feature 002) unchanged; an imported note is an ordinary note. Its origin need
  not be shown.
- **Name conflict**: An imported note whose name matches an existing note or an earlier file in
  the same import, and the user's resolution (rename with new name, replace, or skip).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open session, a user can start importing an audio file in at most 2
  actions (choose "Upload audio", pick the file), and a note file in at most 2 actions.
- **SC-002**: 100% of unsupported or oversized files are rejected before any data is sent, with
  the message shown within 1 second of picking or dropping them.
- **SC-003**: Upload progress updates at least once per second, and cancelling stops the upload
  within 1 second and leaves no item or file behind.
- **SC-004**: In tests covering every conflict choice, failed upload, cancelled upload and
  rejected file, 0 existing notes or recordings are changed, except notes the user explicitly
  confirmed to Replace.
- **SC-005**: Imported note content is byte-for-byte identical to the source text (excluding a
  UTF-8 byte-order mark) in 100% of imports.
- **SC-006**: 100% of imported audio files can be found and played with a standard media player
  by browsing year → semester → course → date → `audios/` outside the app.
- **SC-007**: In usability checks, users identify which items in a mixed list were recorded and
  which were imported with 100% accuracy.
- **SC-008**: Every flow in this feature can be completed using only the keyboard.

## Assumptions

- Supported audio formats are the common lecture/phone formats (MP3, M4A/AAC, WAV, OGG, WebM,
  FLAC); video files (even with audio tracks) are out of scope and rejected.
- The 1 GB audio limit covers a 4-hour lecture in compressed formats and about 1.5–3 hours of
  WAV; the 5 MB note limit is far above typical lecture notes. Both are product defaults that can
  be revised in clarification.
- Imported audio is stored as uploaded, without converting or re-encoding; trimming, merging or
  converting audio is out of scope.
- An imported item's date is its import time; reading recording dates from file metadata is out
  of scope.
- An interrupted upload is not resumed; the user retries it from the start. Imports are not
  progressively persisted like recordings, because the original file remains on the user's
  device (Principle I's chunked-persistence rule applies to live recordings).
- Replace is permanent once confirmed, like deleting a note; keeping a backup of the replaced
  content or undo is out of scope.
- Drag and drop is offered for audio only, as requested; notes are imported with the picker.
- Importing other note formats (Word, PDF, HTML), whole folders, or zip archives, and exporting
  notes or audio, are out of scope.
- Imports are single-user and go only into the session currently open; moving existing items
  between sessions is out of scope.
- Transcription of imported audio follows Feature 004 unchanged, including per-provider file
  size limits for formats that are not split.
