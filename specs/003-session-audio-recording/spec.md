# Feature Specification: Session Audio Recording & Playback

**Feature Branch**: `003-session-audio-recording`

**Created**: 2026-10-04

**Status**: Implemented

**Input**: User description: "In the right panel of a class session, users can start a new recording and stop it; a session can have many recordings, each shown as an item with name, date and duration, renamable and deletable. Each recording has a player with play, pause/stop, a seekable timeline, back 5 seconds, forward 5 seconds, and volume. Recording must keep working if the user switches tabs inside the app, and a partial recording must survive an unexpected page close."

**Depends on**: Feature 001 (sessions), Feature 002 (session workspace right panel; recording
is allowed for every session, upcoming or past).

## Clarifications

### Session 2026-10-04

- Q: While a recording is running, what happens if the student navigates to another page of the app (another session, the course page, the calendar)? → A: Recording continues everywhere in the app, stays attached to the session where it started, and a recording bar (timer, Stop, "Go to session") is shown on every screen.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a lecture (Priority: P1)

A student opens today's CS 201 session and presses "Record" in the right panel. A timer and
level meter show the lecture is being captured. At the end of class they press "Stop", and the
recording appears in the session's recording list with its name, date, and duration.

**Why this priority**: Capturing the lecture is the core purpose of this feature; playback and
management are useless without it.

**Independent Test**: In any session, record 1 minute, stop, and confirm a recording
of about 1 minute is listed and exists as a standard audio file in that session's `audios/`
folder.

**Acceptance Scenarios**:

1. **Given** any session (upcoming or past) and microphone access, **When** the user presses "Record",
   **Then** recording starts within 1 second and the panel shows a running timer, an input
   level indicator, and a "Stop" control.
2. **Given** a recording in progress, **When** the user presses "Stop", **Then** recording ends
   and a new item appears in the list with a default name, the recording's start date and time,
   and its duration.
3. **Given** a finished recording, **When** the user browses the storage folders outside the
   app, **Then** it exists as a standard, playable audio file in that session's `audios/`
   folder.
4. **Given** a session that already has recordings, **When** the user records again, **Then** a
   new, separate recording is added; existing recordings are unchanged.
5. **Given** the user has not granted microphone access, **When** they press "Record", **Then**
   they are asked for permission, and if it is denied they see how to enable it; nothing is
   recorded.
6. **Given** an upcoming session (as defined in Feature 002), **When** the right panel is shown,
   **Then** "Record" is available exactly as for past sessions.

---

### User Story 2 - A recording survives crashes and closed pages (Priority: P1)

Halfway through a 90-minute lecture the student's laptop browser crashes. When they reopen the
app, the first 45 minutes are available as a recording in that session, marked as recovered.

**Why this priority**: A lost lecture cannot be re-recorded; the constitution makes this
non-negotiable (Principle I).

**Independent Test**: Start recording, wait 2 minutes, force-close the browser tab, reopen the
session, and confirm a recording of about 2 minutes is listed and plays.

**Acceptance Scenarios**:

1. **Given** a recording in progress, **When** the page is closed, reloaded, or crashes,
   **Then** all audio captured up to at most the last 10 seconds before the interruption is kept
   as a recording in that session.
2. **Given** an interrupted recording, **When** the user next opens the app, **Then** the
   recording appears in its session's list marked "Recovered (interrupted)", with its actual
   duration, and is playable.
3. **Given** a recording in progress, **When** the network connection drops, **Then** recording
   continues, captured audio is held on the device, and it is delivered to storage automatically
   once the connection returns; the panel shows that upload is pending.
4. **Given** captured audio still held on the device after a crash during a network outage,
   **When** the user reopens the app online, **Then** that audio is delivered and added to the
   recovered recording.
5. **Given** a recording in progress, **When** the user tries to close or leave the page,
   **Then** they are warned that a recording is in progress.

---

### User Story 3 - Keep recording while working in the app (Priority: P1)

While recording, the student switches between note tabs, creates a new note, and writes in it.
Recording continues uninterrupted throughout.

**Why this priority**: Students take notes during the lecture they are recording; recording
that stops when they type is unusable.

**Independent Test**: Start recording, switch note tabs, create a note, and navigate as allowed;
stop after 3 minutes and confirm the recording is continuous and about 3 minutes long.

**Acceptance Scenarios**:

1. **Given** a recording in progress, **When** the user switches, opens, creates, or closes note
   tabs, **Then** recording continues without gaps.
2. **Given** a recording in progress, **When** the user collapses the right panel, **Then**
   recording continues and a visible recording indicator (with timer and stop control) remains
   on screen.
3. **Given** a recording in progress, **When** the user switches to another browser tab or
   window, **Then** recording continues.
4. **Given** a recording in progress, **When** the user navigates to another session, the
   course page, the calendar, or Settings, **Then** recording continues without gaps and stays
   attached to the session where it started.
5. **Given** a recording in progress and the user is on any other screen, **When** they look at
   the screen, **Then** a recording bar shows the elapsed time, the session it belongs to, a
   "Stop" control, and "Go to session", which opens that session's workspace.
6. **Given** a recording in progress and the user is viewing a different session, **When** that
   session's right panel is shown, **Then** it indicates that a recording is running for
   another session and does not offer a second "Record".

---

### User Story 4 - Play back a recording (Priority: P2)

Reviewing for an exam, the student plays a lecture recording, jumps to the middle with the
timeline, skips back 5 seconds to hear a definition again, and lowers the volume.

**Why this priority**: Playback makes recordings useful for review; recording alone already
protects the content.

**Independent Test**: Select a recording and use every player control, confirming position and
volume change as expected.

**Acceptance Scenarios**:

1. **Given** a recording in the list, **When** the user selects it, **Then** a player shows its
   name, total duration, current position, and controls: play, pause, stop, seekable timeline,
   back 5 seconds, forward 5 seconds, and volume.
2. **Given** a playing recording, **When** the user presses pause, **Then** playback pauses at
   the current position; play resumes from there.
3. **Given** a playing or paused recording, **When** the user presses stop, **Then** playback
   stops and the position returns to the start.
4. **Given** the player, **When** the user drags or clicks the timeline, **Then** playback jumps
   to that position, for any position in recordings of at least 4 hours.
5. **Given** the player, **When** the user presses back 5 s or forward 5 s, **Then** the position
   moves by 5 seconds, clamped to the start and end.
6. **Given** the player, **When** the user changes the volume (including mute), **Then**
   playback volume changes; the volume setting is remembered for later playback.
7. **Given** a recording playing, **When** the user selects a different recording, **Then** the
   first one stops and only one recording plays at a time.
8. **Given** a recording in progress, **When** the user plays an older recording, **Then**
   playback works and the ongoing recording is not affected.

---

### User Story 5 - Rename and delete recordings (Priority: P2)

The student renames "Recording 2" to "Guest lecture — Prof. Kaya" and deletes an accidental
5-second recording.

**Why this priority**: Organising recordings matters once a session has several, but is not
needed to capture or play them.

**Independent Test**: Rename a recording and confirm list and file name update; delete one after
confirmation and confirm it is gone from the list and the `audios/` folder.

**Acceptance Scenarios**:

1. **Given** a recording, **When** the user renames it to a non-empty name unique within the
   session, **Then** the list shows the new name and the audio file is renamed to match; the
   audio is unchanged.
2. **Given** a duplicate or empty name, **When** the user confirms, **Then** the rename is
   refused with an explanation.
3. **Given** a delete request, **When** the user has not confirmed, **Then** nothing is deleted;
   **When** they confirm, **Then** the recording is removed from the list and its audio file is
   removed from the `audios/` folder.
4. **Given** the recording currently in progress, **When** shown in the list, **Then** it cannot
   be deleted or renamed until it is stopped.

---

### Edge Cases

- Microphone unplugged or switched during recording: recording stops safely, everything captured
  so far is kept as a recording, and the user is told what happened.
- Microphone in use by another application or unavailable: a message saying the microphone is
  busy or unavailable (not a connection problem); no empty recording is created.
- Laptop goes to sleep during recording: audio up to sleep is kept; on wake the user sees that
  recording was interrupted and can start a new recording.
- Recording started in a second browser window while one is already in progress: only one
  recording may be in progress per user at a time; the second window shows the active
  recording and does not start another.
- Very long recordings (up to at least 4 hours) record, save, and play back completely.
- Device storage too low to hold pending audio during an outage: the user is warned when less
  than 50 MB of browser storage remains (about 2 hours of audio at the recording bitrate).
- Recording stopped within 1 second of starting: kept (not silently discarded); the user may
  delete it.
- Recording that spans past the session's scheduled end time: allowed; it stays attached to the
  session where it started.
- Sign-out requested while recording: the user is warned and must stop the recording first.
- Recording names containing characters invalid in file names: display name kept; file name uses
  a safe readable equivalent.
- The audio file is deleted or moved outside the app: the list marks the recording as "File
  missing" instead of failing; the user can remove the entry.

## Requirements *(mandatory)*

### Functional Requirements

**Recording**

- **FR-001**: Users MUST be able to start and stop a recording from the right panel of any
  session, whether upcoming or past (Feature 002 Clarifications).
- **FR-002**: While recording, the panel MUST show elapsed time, an input level indicator, and a
  stop control.
- **FR-003**: Only one recording per user may be in progress at a time.
- **FR-004**: A session MUST support any number of recordings; each new recording is separate.
- **FR-005**: Recording MUST continue uninterrupted while the user switches, opens, creates, or
  closes note tabs, collapses panels, or switches to another browser tab or window.
- **FR-006**: Recording MUST continue when the user navigates anywhere within the app (other
  sessions, course pages, calendar, Settings) and MUST remain attached to the session where it
  started. While recording, a recording bar showing elapsed time, the owning session, "Stop",
  and "Go to session" MUST be visible on every screen.
- **FR-007**: Recorded audio MUST be persisted progressively during recording, so that an
  unexpected close, reload, or crash loses at most the last 10 seconds of audio.
- **FR-008**: If the network is unavailable, captured audio MUST be held on the device and
  delivered automatically when the connection returns, including after a crash.
- **FR-009**: Interrupted recordings MUST appear in their session marked "Recovered
  (interrupted)", with their actual duration, and be playable.
- **FR-010**: Closing or reloading the page, leaving the app, or signing out while recording
  MUST warn the user; navigating within the app MUST NOT.
- **FR-011**: Each recording MUST be stored as a standard, widely playable audio file — WebM/Opus
  (`.webm`), or MP4/AAC (`.m4a`) in browsers that can't record WebM (Safari) — in its
  session's `audios/` folder (year → semester → course → session date → `audios/`).

**Recording list**

- **FR-012**: The right panel MUST list the session's recordings, newest first, each showing
  name, recording date and start time, and duration; the in-progress recording is shown at the
  top with a live timer.
- **FR-013**: New recordings MUST get a default name based on their start time (e.g.,
  "Recording 10:02"), unique within the session.
- **FR-014**: Users MUST be able to rename recordings (unique, non-empty names within the
  session); the audio file name follows the recording name.
- **FR-015**: Users MUST be able to delete recordings after explicit confirmation; deleting
  removes the audio file. The in-progress recording cannot be renamed or deleted.
- **FR-016**: The session's recording count/presence MUST be reflected on the course timeline
  (Feature 002, FR-005).

**Player**

- **FR-017**: Each recording MUST be playable with: play, pause, stop (returns to start), a
  seekable timeline showing current position and total duration, back 5 seconds, forward 5
  seconds, and volume with mute.
- **FR-018**: Skipping MUST clamp at the start and end of the recording.
- **FR-019**: Only one recording plays at a time; starting another stops the first.
- **FR-020**: The volume setting MUST be remembered across recordings and visits.
- **FR-021**: Playback MUST work for the full length of recordings of at least 4 hours,
  including seeking to any position, and MUST start without waiting for the whole file to load.
- **FR-022**: Player controls MUST be keyboard operable with shortcuts while the player has
  focus: play/pause, back 5 s, forward 5 s, volume up/down, mute.

**Quality**

- **FR-023**: All controls in this feature MUST be keyboard operable, have accessible names,
  and render correctly in light, dark, and user-created themes with WCAG AA contrast; recording
  state MUST be conveyed by more than colour alone.

### Key Entities

- **Recording**: An audio capture belonging to one session: name (unique within session), start
  date-time, duration, status (recording, complete, or recovered/interrupted), and its audio file
  in the session's `audios/` folder. Shown alongside the status but not part of it: "File
  missing" (the audio file is no longer on disk) and "Upload pending" (audio still on this
  device, known only to the browser that recorded it).
- **Pending Audio**: Captured audio held on the user's device that has not yet reached storage;
  tied to a recording and delivered automatically.
- **Player Preferences**: Per-user volume and mute state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open session, a user can start recording in one action and recording
  begins within 1 second.
- **SC-002**: In repeated crash tests (closed tab, reload, killed browser) during recordings of
  at least 5 minutes, 100% of recordings are recoverable and lose no more than the last 10
  seconds of audio.
- **SC-003**: A recording made while the user continuously switches note tabs and types for 30
  minutes has no gaps and its duration matches wall-clock time within 1 second.
- **SC-004**: Recordings of 4 hours play back fully, and seeking to any point starts playback
  within 2 seconds. (Verification method: manual check.)
- **SC-005**: 100% of recordings can be found and played with a standard media player by
  browsing year → semester → course → date → `audios/` outside the app.
- **SC-006**: A network outage of 15 minutes during recording results in a complete recording
  once the connection returns, with no user action required.
- **SC-007**: Every flow in this feature can be completed using only the keyboard.

## Assumptions

- The device's default microphone is used; choosing an input device, audio quality settings,
  and noise reduction are out of scope.
- Pausing and resuming an in-progress recording is out of scope; users stop and start a new
  recording instead.
- Playback speed control, waveform display, bookmarks, and trimming/editing audio are out of
  scope.
- Uploading existing audio files from the user's device was out of scope for 003; added by 006 (specs/006-session-file-import).
- Transcription of recordings into notes is defined in Feature 4; deleting a recording never
  changes notes created from it.
- Deleted recordings are removed permanently after confirmation; a trash/undo is out of scope.
- Recording requires a browser that supports microphone capture; unsupported browsers see an
  explanatory message.
- Users are responsible for having permission to record their lectures; the app shows no
  consent workflow.
- **Constitution exception (Principle I), justified**: when the browser offers no device storage
  for pending audio (IndexedDB unavailable, e.g. some private-browsing modes), pending audio is
  held in memory only. If the page crashes or is closed while offline, audio not yet uploaded is
  lost; while online, at most the current 5-second chunk is at risk, as usual. The user is
  warned when recording starts. Justification: the app has no storage to fall back on in that
  mode, and refusing to record would lose the whole lecture. Recorded 2026-10-06 (analysis
  finding 003-F7).
