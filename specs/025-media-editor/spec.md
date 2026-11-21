# Feature Specification: Media Editor (Audio Trim)

**Feature Branch**: `025-media-editor`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "An audio editor page, opened from a button in the right panel and from an Edit option on recorded audio in a session. The user can trim audio and save, choosing to overwrite the source audio or save as a new name. The page has three panels like the main page (left unchanged, main holds the editor, right holds only the editor icon, settings in a top bar). Built so more editing features can be added later; named a general 'Media Editor'."

## Clarifications

### Session 2026-11-16

- Q: When the user overwrites the original, what happens to the old audio? → A: It is moved to the app's Trash (Settings → Trash) as a recording entry and the trimmed audio takes its place in the session. Restoring the entry puts the old audio back in its session as a separate recording (never over the trimmed one); deleting the entry permanently removes it.
- Q: Where does the Recordings browser live, and how is it drawn? → A: In the page's right panel, as a file tree (class → session → audio). Closed, the panel leaves only the Media Editor icon on the edge, which reopens it.
- Q: Can the user keep more than one part of the audio? → A: Yes. An "Add window" button adds another keep-window at the playhead: it is refused while the playhead is inside a window, otherwise the new window starts at the playhead (left or right of existing windows) and extends right as far as the next window or the end of the audio allows. Windows never overlap. With two or more windows, saving asks whether to merge them into one recording or save each window as its own recording; overwriting the original is only offered for a merged result.
- Q: How does the user move between recordings without going back to the Sessions page? → A: The Media Editor main area includes a Recordings browser section listing recorded audios grouped by class, then by session; selecting one loads it for editing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trim a session recording and save it (Priority: P1)

A student opens a recording from a class session, chooses Edit, and lands in the Media Editor with that audio loaded. They see the waveform, play it, select the portion to keep (for example cutting off dead air before the lecturer starts and after it ends), preview the result, and save. On saving they are asked whether to overwrite the original audio or save the trimmed audio under a new name.

**Why this priority**: This is the whole point of the feature: a recording can be cleaned up without leaving the app.

**Independent Test**: In a session with a recording, choose Edit on it, set a start and end point, save as a new name, and confirm a new, shorter audio appears in the session while the original is untouched.

**Acceptance Scenarios**:

1. **Given** a session with a recorded audio, **When** the user chooses Edit on it, **Then** the Media Editor opens with that audio loaded and its session shown as context.
2. **Given** a loaded audio, **When** the user moves the start and end handles, **Then** the kept range is visibly marked and playing previews only that range.
3. **Given** a trimmed selection, **When** the user saves and chooses "Save as new", enters a name, and confirms, **Then** a new audio with only the selected range is added to the same session and the original is unchanged.
4. **Given** a trimmed selection, **When** the user saves and chooses "Overwrite original" and confirms the warning, **Then** the original audio is replaced by the trimmed version.
5. **Given** the save dialog is open, **When** the user cancels, **Then** nothing is changed and the editor keeps the current selection.

---

### User Story 2 - Open the Media Editor from the right panel and browse recordings (Priority: P2)

From any main-app page the user clicks the new Media Editor icon in the right panel and the Media Editor page opens. The page has a Recordings section that lists the user's recorded audios grouped by class and, within each class, by session. The user picks any audio from this list to edit, and can switch to another recording from the same list at any time, without returning to the Sessions page.

**Why this priority**: Gives a general entry point and establishes the page as a home for future tools, but the session shortcut (Story 1) already delivers the core value.

**Independent Test**: Click the right-panel button from the home page and confirm the Media Editor opens empty with a way to choose an audio.

**Acceptance Scenarios**:

1. **Given** any page with the right panel, **When** the user clicks the Media Editor button, **Then** the Media Editor page opens.
2. **Given** the editor is open with no audio, **When** the user expands a class and session in the Recordings section and selects an audio, **Then** it loads for editing.
4. **Given** an audio is being edited, **When** the user selects a different audio in the Recordings section, **Then** the new audio loads (after the unsaved-changes warning, if any) and the list highlights the one currently open.
5. **Given** the user arrived via a session's Edit action, **When** the editor opens, **Then** the Recordings section shows that audio's class and session expanded with the audio highlighted.
6. **Given** the user saves a trimmed copy as new, **When** the save completes, **Then** the new audio appears in the Recordings section under the same session without a page reload.
3. **Given** the editor is open, **When** the user looks at the layout, **Then** it has a left panel identical to the main page's, a main area with the editor and a top bar for settings, and a right panel holding the Recordings file tree (closing to just the Media Editor icon).

---

### User Story 3 - Leave safely and extend later (Priority: P3)

If the user has an unsaved selection and tries to leave, they are warned. The page is organised so that new editing tools (beyond trim) can be added later as additional tools without redoing the page layout.

**Why this priority**: Protects user work and satisfies the extensibility goal, but only matters once Story 1 exists.

**Independent Test**: Make a trim change, try to navigate away, and confirm a warning appears; separately, confirm the editor's tool area is a distinct, named "Trim" tool among a list of tools.

**Acceptance Scenarios**:

1. **Given** unsaved trim changes, **When** the user navigates away or closes the page, **Then** they are asked to confirm discarding them.
2. **Given** the editor, **When** a future tool is registered, **Then** it appears in the tool list/top bar without changes to the page layout.

---

### Edge Cases

- The audio file is missing, unreadable or in an unsupported format: the editor shows a clear error and offers to go back; nothing is modified.
- The selection covers the whole audio (nothing trimmed): Save is disabled or explains that there is nothing to save.
- The selected range is extremely short or start equals end: Save is blocked with an explanation.
- New name collides with an existing audio in the session: the user is asked to choose a different name (never silently overwritten).
- The new name is empty or contains characters not allowed in file names: validation message, no save.
- Saving fails partway (storage error, app closed): the original audio is never left damaged or lost.
- The audio is currently being transcribed or is being recorded: editing is blocked or warned until it finishes.
- The recording has an existing transcript: trimming changes the timeline, so the user is told before an overwrite that the transcript timestamps will no longer match the audio.
- A class or session has no recordings: it is shown as empty or hidden, and the Recordings section shows a clear empty state when the user has no recordings at all.
- The user has many classes and sessions: the Recordings section stays navigable (collapsible groups and a search/filter by name).
- Selecting another audio while another is mid-save: selection waits until the save finishes.
- Very long recordings (multi-hour lectures): the editor remains usable and responsive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a Media Editor page reachable from a dedicated button in the right panel on every page that shows the right panel.
- **FR-002**: Each recorded audio in a session MUST offer an Edit action that opens the Media Editor with that audio loaded.
- **FR-003**: The Media Editor page MUST use a three-panel layout: a left panel identical to the main page's left panel, a main area hosting the editor with a top bar for editor settings, and a right panel holding the Recordings file tree (closing to just the Media Editor icon).
- **FR-004**: Users MUST be able to open the Media Editor without a preselected audio and choose any of their session audios to edit.
- **FR-004a**: The Media Editor MUST include a Recordings section in its main area listing all recorded audios grouped by class and then by session, with collapsible groups, showing each audio's name and duration.
- **FR-004b**: Selecting an audio in the Recordings section MUST load it into the editor, highlight it as current, and apply the unsaved-changes warning (FR-011) first if needed.
- **FR-004c**: The Recordings section MUST let users filter by name and MUST expand to and highlight the current audio when the editor is opened from a session's Edit action.
- **FR-004d**: The Recordings section MUST reflect changes made by saving (a new audio appears; an overwritten audio shows its updated duration) without a page reload.
- **FR-005**: The editor MUST show a visual representation of the audio and let the user play, pause and seek it.
- **FR-006**: Users MUST be able to define the part to keep by setting a start and an end point, both by dragging on the visual representation and by entering exact times, and to preview exactly that range.
- **FR-007**: Saving MUST ask the user to choose between overwriting the original audio and saving as a new audio with a name of their choice.
- **FR-008**: Overwriting MUST require an explicit confirmation that states the original will be replaced.
- **FR-008a**: Overwriting MUST first move the original audio to the Trash as a recording entry, so the overwrite can be undone; the trimmed audio then replaces it in the session. If anything fails, the original stays in place and no Trash entry is left behind.
- **FR-008b**: A Trash recording entry MUST show the recording's name, class, session date and when it was replaced; restoring it MUST add it back to its session as a new recording (a numbered name if the name is taken) and MUST fail with a clear message while its session is itself in the Trash; permanent deletion MUST ask for confirmation like other Trash entries.
- **FR-006a**: Users MUST be able to add more keep-windows with an "Add window" button that places the new window at the playhead: no new window when the playhead is inside an existing window; otherwise the window starts at the playhead and extends right up to a default length, clipped by the next window or the end of the audio (when too little room remains to the right, it ends at the playhead and extends left, clipped by the previous window). The button MUST explain why when it is unavailable.
- **FR-006b**: Windows MUST never overlap or touch beyond their edges: dragging, moving or typing a time that would make windows collide MUST be stopped at the neighbour (or refused with a message). Each window MUST be removable, and at least one window always remains.
- **FR-006c**: With two or more windows, saving MUST ask the user to choose between one merged recording (the windows joined in order) and one new recording per window (named from the chosen name plus the window number); overwriting the original MUST be available only for the merged result.
- **FR-009**: Saving as new MUST place the new audio in the same session as the source, suggest a default name derived from the original, reject empty, invalid or already-used names, and leave the original untouched.
- **FR-010**: A failed or interrupted save MUST NOT corrupt, truncate or lose the original audio.
- **FR-011**: The editor MUST warn before discarding unsaved changes when the user navigates away.
- **FR-012**: Saved audio MUST appear in the session's recordings and be playable like any other recording, in a format the rest of the app already supports.
- **FR-013**: The user MUST be warned before an overwrite when the audio has a transcript, since its timestamps will no longer align with the trimmed audio.
- **FR-014**: The editor MUST show clear progress while saving and a clear success or error result.
- **FR-015**: Editing tools MUST be organised as individually named tools within the page (Trim being the first) so new tools can be added later without changing the page layout, entry points or save flow.
- **FR-016**: The page MUST be fully keyboard operable (play/pause, moving the start/end points, saving), work in light, dark and custom themes, and meet WCAG AA.
- **FR-017**: Editing MUST be non-destructive until the user confirms a save; the original is only changed on an explicit confirmed overwrite.

### Key Entities

- **Recordings Browser**: the grouped list (class → session → audio) used to pick what to edit; read-only navigation, it never changes audio by itself.
- **Edit Source**: the existing recorded audio being edited, with its session, name, duration and whether it has a transcript.
- **Trim Selection**: the start and end times, within the source's duration, that define the part to keep.
- **Save Choice**: overwrite original, or save as new with a validated name; the outcome is either a replaced audio or a new audio in the same session.
- **Editing Tool**: a named capability within the Media Editor (Trim now; others later) that appears in the tool list/top bar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from a session's recording to a saved trimmed copy in under 1 minute for a typical lecture recording.
- **SC-002**: 100% of saves leave either the intact original or a complete result; no failed save damages the original in testing.
- **SC-003**: The saved audio's length equals the selected range to within 0.1 second.
- **SC-004**: 95% of first-time users choose correctly between overwrite and save-as-new without help (the dialog states the consequence of each).
- **SC-005**: The editor remains responsive (play, seek, handle dragging feel instant) with a 3-hour recording.
- **SC-007**: A user can switch from editing one recording to another in a different class in at most 3 interactions and without leaving the Media Editor.
- **SC-006**: Adding a second editing tool later requires no change to the page layout, right-panel entry or save dialog.

## Assumptions

- "Right panel" refers to the existing right-hand icon rail of the app; the Media Editor button is added there and the editor page's own right panel shows only the Media Editor icon (highlighted as current).
- The Recordings file tree is the right panel's content (the left panel stays identical to the main page's); closing the panel gives the editor more room and leaves only the Media Editor icon.
- The Recordings section lists audios for the signed-in user across all classes and semesters, grouped by class then session, using the existing course/session organisation.
- Only audio recorded or imported into a session is editable; audio outside sessions is out of scope for v1.
- Trim is the only editing operation in v1 (no fades, splitting, merging, volume or effects); these are future tools.
- Saved audio uses the same format family the app already records/plays; converting to other formats is out of scope.
- The new audio is stored in the same session as the original, so the existing file organisation and backup rules apply.
- Overwrite keeps the original's name and position in the session; the old audio goes to the Trash (FR-008a). Transcript text is kept, only warned about (not deleted or re-timed), consistent with "never lose user work".
- The old audio is kept as a plain file in a `.trash` folder inside the session's `audios` folder until the Trash entry is restored or deleted, so it stays within the session's own files and in backups.
- If a session is permanently deleted, any Trash recording entries of that session can no longer be restored (their file went with the session) and can only be deleted.
- Single user at a time; no concurrent editing of the same audio is considered.
- The page name "Media Editor" is used in the interface and navigation; it is intentionally broader than audio.
