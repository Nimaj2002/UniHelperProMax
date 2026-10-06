# Feature Specification: Transcribe Recordings into Notes

**Feature Branch**: `004-recording-transcription`

**Created**: 2026-10-04

**Status**: Implemented

**Input**: User description: "Each recording has a \"Transcribe\" button. Clicking it opens a dialog asking which note of this session the result should go into; if the session has no notes, the user names a new note which is created. The transcript is appended after the last character of the chosen note, separated clearly (e.g. a heading with the recording name and time), so multiple transcripts can accumulate in one note. While a transcription is running, all Transcribe buttons are disabled and show progress; on failure the user sees a clear error and can retry. Transcription uses a provider configured in Settings."

**Depends on**: Feature 002 (session notes, autosave), Feature 003 (recordings), Feature 005
(provider settings).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Transcribe a recording into an existing note (Priority: P1)

After a lecture, the student presses "Transcribe" on "Recording 10:02". A dialog asks which
note to put the result in; they choose "Lecture notes". A few minutes later the transcript
appears at the end of that note under a heading naming the recording, and everything they had
already written is untouched.

**Why this priority**: Turning recordings into searchable, editable text is the feature's core
value.

**Independent Test**: With a configured provider, transcribe a 2-minute recording into a note
that already has content; confirm the original content is byte-for-byte unchanged and the
transcript follows it under a heading with the recording's name and time.

**Acceptance Scenarios**:

1. **Given** a finished recording in a session with notes, **When** the user presses
   "Transcribe", **Then** a dialog lists the session's notes and asks which one receives the
   transcript.
2. **Given** the user chooses a note and confirms, **When** transcription completes, **Then**
   the transcript is appended after the last character of that note, preceded by a separator
   heading containing the recording name, its recording date and start time, and its duration.
3. **Given** a note with existing content, **When** a transcript is appended, **Then** all
   existing content remains exactly as before; nothing is removed, reordered, or reformatted.
4. **Given** a note that already contains a transcript, **When** another recording is
   transcribed into it, **Then** the new transcript is appended after the previous one with its
   own heading, so transcripts accumulate in order of completion.
5. **Given** the chosen note is open in the editor with edits not yet saved, **When** the
   transcript arrives, **Then** the user's latest edits are kept and the transcript appears
   after them; no typed content is lost.
6. **Given** the chosen note is open, **When** the transcript is appended, **Then** it appears
   in the editor without reloading, and the user is notified that transcription finished.

---

### User Story 2 - Transcribe when the session has no notes (Priority: P1)

The student recorded a lecture but never created a note. Pressing "Transcribe" asks them to
name a new note; the note is created and receives the transcript.

**Why this priority**: Many sessions will only have audio; transcription must work for them.

**Independent Test**: In a session with a recording and no notes, transcribe, enter a name, and
confirm a note with that name is created containing only the heading and transcript.

**Acceptance Scenarios**:

1. **Given** a session with no notes, **When** the user presses "Transcribe", **Then** the
   dialog asks for a new note name, pre-filled with a suggestion (e.g., "Transcript").
2. **Given** a valid name, **When** the user confirms, **Then** the note is created immediately
   (visible in the note list) and receives the transcript when it completes.
3. **Given** a session that has notes, **When** the dialog opens, **Then** the user may also
   choose "New note…" instead of an existing note.
4. **Given** a name already used in the session or an empty name, **When** the user confirms,
   **Then** it is refused with an explanation (same rules as Feature 002).

---

### User Story 3 - Progress, failure, and retry (Priority: P1)

While a transcription runs, every "Transcribe" button is disabled and the running one shows
progress. If the provider fails (e.g., invalid key, network problem), the student sees a clear
message and can retry without choosing the note again.

**Why this priority**: Transcription takes minutes and can fail; without clear state users
start duplicate jobs or think results were lost.

**Independent Test**: Start a transcription and confirm all Transcribe buttons are disabled with
progress shown; simulate a provider failure and confirm an understandable error, an unchanged
note, and a working retry.

**Acceptance Scenarios**:

1. **Given** a transcription running, **When** the user views any recording in any session,
   **Then** all "Transcribe" buttons are disabled with a tooltip/label explaining a
   transcription is in progress.
2. **Given** a transcription running, **When** the user views its recording, **Then** it shows
   progress (stage such as "Uploading", "Transcribing", "Adding to note", and a percentage when
   known) and a "Cancel" action.
3. **Given** a transcription running, **When** the user navigates elsewhere in the app, closes
   the tab, or signs out, **Then** the transcription continues, and the result is appended to the
   chosen note when it completes.
4. **Given** a transcription fails, **When** the user views the recording, **Then** they see a
   plain-language error stating the cause category (no provider configured, invalid
   credentials, provider unavailable, file too large/unsupported, quota exceeded, unknown) and
   a "Retry" action; the target note is unchanged.
5. **Given** a failed transcription, **When** the user presses "Retry", **Then** it runs again
   into the same note without re-asking, and the Transcribe buttons are disabled again.
6. **Given** the user cancels a running transcription, **When** cancellation completes, **Then**
   nothing is appended and Transcribe buttons are re-enabled.
7. **Given** the app is reopened after the server restarted during a transcription, **When**
   the user views the recording, **Then** the transcription is either resumed or shown as
   failed with "Retry"; it is never silently lost and never appended twice.

---

### User Story 4 - Use the provider configured in Settings (Priority: P2)

Transcription uses whichever provider the student configured in Settings → Transcription
(Feature 005): "Voice Studio" (preselected in Settings) or "OpenAI-compatible". If nothing is configured,
Transcribe points them there.

**Why this priority**: Transcription cannot work without a provider, but provider setup is a
one-time step defined in Feature 005.

**Independent Test**: With no provider configured, press Transcribe and confirm the dialog links
to Settings; configure Voice Studio (Feature 005) and confirm the next transcription uses it.

**Acceptance Scenarios**:

1. **Given** a provider configured in Settings (Feature 005), **When** a transcription starts,
   **Then** it uses that provider and the default language from Settings unless overridden in
   the dialog.
2. **Given** no provider is configured, **When** the user presses "Transcribe", **Then** the
   dialog explains that a provider must be configured and links to Settings → Transcription.
3. **Given** a provider failure caused by its settings (unreachable address, invalid key,
   unknown model), **When** shown, **Then** the error links to Settings → Transcription.

---

### User Story 5 - See which recordings were transcribed (Priority: P3)

The student sees at a glance that "Recording 10:02" was already transcribed into "Lecture
notes", and can jump to it.

**Why this priority**: Avoids duplicate transcriptions and helps navigation; not essential.

**Independent Test**: After a successful transcription, confirm the recording shows a
"Transcribed → Lecture notes" indicator that opens the note.

**Acceptance Scenarios**:

1. **Given** a transcribed recording, **When** shown in the list, **Then** it indicates the
   target note(s) and date of transcription, linking to the note.
2. **Given** an already transcribed recording, **When** the user presses "Transcribe" again,
   **Then** the dialog warns that it was already transcribed into that note and lets them
   continue or cancel.

---

### Edge Cases

- Target note renamed while transcription runs: the transcript still goes to that note.
- Target note deleted while transcription runs: the transcript is not lost — it is saved as a
  new note named after the recording (e.g., "Transcript – Recording 10:02") and the user is told.
- Target note's file edited outside the app during transcription: the transcript is appended
  after the file's current last character at completion time; external content is never
  overwritten.
- Note does not end with a line break: a blank line is inserted before the heading so the
  heading renders as a heading; the existing last character is not modified.
- Recording is still in progress: its Transcribe button is unavailable until it is stopped.
- Recording file missing (Feature 003 "File missing"): Transcribe is unavailable with an
  explanation.
- Recovered/interrupted recordings can be transcribed like any other.
- Recording deleted while being transcribed: deletion is blocked until the transcription
  finishes or is cancelled.
- Silent or speechless recording: the transcript section is appended with "(No speech detected)"
  so the user knows it ran.
- Very long recordings (up to 4 hours) exceed some providers' per-file limits: WebM recordings
  are split and still transcribed completely, in order; Safari (MP4/M4A) recordings over the
  provider's limit fail with a clear "too long for this provider" error (FR-022).
- Provider removed or key replaced while a job runs: the running job finishes or fails with a
  clear credential error; it does not use a removed key.
- Two browser windows: the "one transcription at a time" rule and disabled buttons apply across
  all of the user's windows.
- Active provider switched (not removed) while a job runs: the running job finishes with the
  provider and address it started with; the next job uses the newly chosen provider.
- Session, course or recording deleted while a job runs: the job is discarded with it and
  nothing is written to any note.

## Requirements *(mandatory)*

### Functional Requirements

**Starting a transcription**

- **FR-001**: Each finished recording MUST have a "Transcribe" action.
- **FR-002**: "Transcribe" MUST open a dialog to choose the target: one of the session's existing
  notes, or "New note…" with a name; if the session has no notes, the dialog MUST ask for a new
  note name (pre-filled suggestion).
- **FR-003**: A new target note MUST be created when the user confirms, before transcription
  starts, using the note rules of Feature 002 (unique, non-empty name; Markdown file in the
  session's `notes/` folder).
- **FR-004**: The dialog MUST let the user pick the spoken language for this transcription,
  defaulting to the language set in Settings.
- **FR-005**: If no provider is configured, the dialog MUST explain this and link to Settings
  instead of starting.

**Appending the result**

- **FR-006**: The transcript MUST only ever be appended after the last character of the target
  note; existing content MUST remain exactly unchanged (constitution Principle I).
- **FR-007**: Each appended transcript MUST begin with a clear separator: a Markdown heading
  containing the recording name, recording date and start time, and duration (e.g.,
  "## Transcript — Recording 10:02 · 2026-10-05 10:02 · 1h 24m"), preceded by a blank line when
  the note is not empty.
- **FR-008**: Multiple transcripts MUST accumulate in the same note in order of completion, each
  with its own heading.
- **FR-009**: If the target note is open with unsaved edits, the user's edits MUST be preserved
  and the transcript appended after them; the open editor MUST show the appended text without
  reload.
- **FR-010**: The transcript MUST be appended exactly once per successful job, including across
  retries and server restarts.
- **FR-011**: If the target note no longer exists at completion, the transcript MUST be saved
  in a new note in the same session and the user informed.

**Running state, failure, retry**

- **FR-012**: Only one transcription per user may run at a time; while it runs, all Transcribe
  actions in all sessions and windows MUST be disabled with an explanation.
- **FR-013**: The running transcription MUST show its stage and, when known, percentage
  progress, and MUST offer "Cancel".
- **FR-014**: Transcriptions MUST continue when the user navigates away, closes the browser, or
  signs out, and complete into the chosen note.
- **FR-015**: The user MUST be notified in the app when a transcription completes or fails,
  including on their next visit if they were away.
- **FR-016**: On failure, the user MUST see a plain-language error with its cause category and a
  "Retry" action that reuses the same recording, note, and language; the note MUST be unchanged
  by a failed or cancelled job.
- **FR-017**: Errors shown to the user and recorded in logs MUST NOT contain the provider key.

**Settings & providers**

- **FR-018**: Transcription MUST use the active provider and default language configured in
  Settings (Feature 005); the first release offers "Voice Studio" and "OpenAI-compatible".
- **FR-019**: Provider credentials MUST never be shown or returned in full by any transcription
  screen or error (Feature 005, constitution Principle IV).
- **FR-020**: Settings-related failures MUST link the user to Settings → Transcription.
- **FR-021**: Transcription screens MUST work unchanged for any provider the server offers, so
  adding a provider requires no change to them (constitution Principle IV).
- **FR-022**: WebM recordings (Chrome, Edge, Firefox) of up to at least 4 hours MUST be
  transcribable regardless of an individual provider's per-file limits. MP4/M4A recordings
  (Safari) are sent whole; with a provider that limits file size (OpenAI-compatible: 25 MB,
  about 73 minutes), longer ones fail with a clear "too long for this provider" error.

**Tracking & quality**

- **FR-023**: Each recording MUST show its transcription history (target note, date, status)
  and link to the target note; transcribing again MUST warn if already transcribed into the
  same note.
- **FR-024**: The dialog, progress, errors, and settings MUST be keyboard operable, announce
  progress (at stage changes and at most every 10 %, never every second) and completion to
  assistive technology, and render correctly in light, dark, and
  user-created themes with WCAG AA contrast.

### Key Entities

- **Transcription Job**: One request to transcribe a recording into a note: recording, target
  note, language, provider, status (queued, uploading, transcribing, appending, completed,
  failed, cancelled), progress, error category, created/finished times. At most one active per
  user.
- **Transcript Section**: The appended block in a note: heading (recording name, date/time,
  duration) followed by the transcript text.
- **Provider Configuration**: Defined in Feature 005; this feature reads the active provider
  and default language.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting a transcription takes at most 3 user actions from the recording list
  (Transcribe → choose note → confirm).
- **SC-002**: Across all tests (success, failure, cancel, retry, server restart, concurrent
  editing), 0 cases alter or remove existing note content, and 0 cases append a transcript
  twice.
- **SC-003**: A 1-hour recording is transcribed and appended within 15 minutes with OpenAI's
  `whisper-1` over a typical broadband connection (excluding provider outages). (Verification
  method: manual check.)
- **SC-004**: 100% of failures show a cause category and a working Retry; users can recover from
  an invalid-key failure (fix key, retry) in under 1 minute.
- **SC-005**: Progress or stage updates appear at least every 10 seconds while a transcription
  is running.
- **SC-006**: A provider key, once saved, never appears in full anywhere in the UI, in
  responses to the browser, or in logs.
- **SC-007**: Every flow in this feature can be completed using only the keyboard.

## Assumptions

- Transcripts are plain paragraphs of text; speaker labels and per-paragraph timestamps are out
  of scope.
- Transcribing only part of a recording, editing a transcript before it is appended, and
  summarising transcripts are out of scope.
- Live (real-time) transcription during recording is out of scope; only finished recordings are
  transcribed.
- Provider usage costs are the user's responsibility; the app shows no cost estimates.
- Audio is sent to the configured provider only when the user starts a transcription; users
  accept that provider's data handling when they configure it.
- Provider configuration, connection testing, and key storage are specified in Feature 005.
- Feature 003's recordings and Feature 002's notes, autosave, and conflict handling are reused.
