# Feature Specification: Floating Card Layout

**Feature Branch**: `008-floating-card-layout`

**Created**: 2026-10-09

**Status**: Implemented

**Input**: User description: "Redesign the application layout as three floating cards on a background, in light, dark and custom themes. This is a layout and appearance change only: no change to data, the API, storage, or any existing behavior." (Full description covers: cards, left card, left card closed, main card, right card, activity and status, focus mode, window size, keyboard and accessibility, themes, out of scope. Follow the mockups in `design/layout-mockups/` for proportions and structure; where the mockup and the spec disagree, the spec wins.)

**Related**: Feature 001 (calendar), 002 (courses, sessions, notes, side panel), 003 (audio
recording), 004 (transcription), 005 (settings and themes), 006/007 (session files and PDF
reader — the PDF reader's own toolbar stays governed by 007). Constitution Principle V (theme
tokens, light/dark/user themes, keyboard accessibility, contrast warnings) applies directly;
Principle I (visible save state, recordings never lost) constrains the save indicator and the
audio card behavior.

**Reference mockups**: `design/layout-mockups/1 · Panels open@1x.png` (all three cards open,
session workspace, 1366 × 768) and `design/layout-mockups/2 · Panels closed@1x.png` (left card
closed to a rail, audio card closed, reopen button in the tab row).

## Clarifications

### Session 2026-10-09

- Q: How should the window background, card surface and card border colors be stored for saved custom themes? → A: No new theme colors. The layout uses existing ones: window background = existing "Background" color, card surface = existing "Surface / card" color, card border = existing "Border" color (not Accent). Theme data, editor color list, exports and the API stay unchanged.
- Q: Where should the recording and transcription status bars go once full-width bars are removed? → A: A compact floating pill at the bottom center of the main card on every page (same contents: elapsed time, label, Stop/Cancel, "Go to session"); pills stack when both are active; shown even in the session workspace with the audio card open.
- Q: Below 1100 px window width, what should the closed left card look like? → A: Hidden completely (no rail); a reopen button sits at the left of the main card's top bar, and Account/Settings are reached by opening the card.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Work in a session inside three floating cards (Priority: P1)

A student opens a session. The window shows a background with three rounded cards separated by
small gaps: the side panel on the left, the session workspace in the middle and the session's
audio on the right. The app name, course search, course list, "Sessions and notes" and
Account/Settings are all in the left card; there is no bar spanning the window. The workspace
has a single slim tab row with the note tabs, a compact date/time chip and the split-view
action; the note is centered at a comfortable reading width; the save state is a small chip
floating in a corner. Everything the student could do before (switch courses, create notes,
record, transcribe, edit) still works the same way.

**Why this priority**: This is the core of the redesign — the layout in which students spend
most of their time. Without it nothing else in the feature has a place to live.

**Independent Test**: Open any session at 1366 × 768 in light and dark themes and confirm the
three-card structure, the contents of each card, the single tab row, the floating save state
and that every action reachable before the change is still reachable.

**Acceptance Scenarios**:

1. **Given** a session is open with both side cards open, **When** the window is shown, **Then**
   it shows a background with a left card, a main card and a right card, each with rounded
   corners, a thin border and an equal gap to each other and to the window edges, and no
   full-width bar above, below or between them.
2. **Given** the left card is open, **When** the user looks at it from top to bottom, **Then** it
   shows the app name with a close button, the course search, the course list with a "New
   class" button beside its heading, the "Sessions and notes" section ("New note", note list,
   session timeline) and, pinned at the bottom, Account and Settings.
3. **Given** a session workspace, **When** the main card is shown, **Then** its only fixed bar is
   the tab row containing the tabs, the session info chip and the split-view action; there is
   no separate session header.
4. **Given** the session info chip, **When** the user activates it, **Then** a details view
   opens showing the course, location, links and status of the session.
5. **Given** an upcoming session, **When** its workspace is shown, **Then** the chip shows the
   date and time with an "Upcoming" marker.
6. **Given** a note is being edited, **When** its save state changes (saved, saving, retrying,
   failed, conflict), **Then** a small indicator floating over a corner of the main card shows
   the current state, and the note content does not move when the indicator changes.
7. **Given** a long note, **When** the user scrolls it, **Then** only the main card's content
   scrolls; the left and right cards and the tab row stay in place, and content never touches
   or overflows a card's rounded edge.
8. **Given** the audio card is open in a session, **When** the user looks at it, **Then** it
   shows a header with the title, the Record button and a close button, and below it the
   recordings with their players and Transcribe buttons, behaving exactly as before.

---

### User Story 2 - Close and reopen the side cards (Priority: P1)

The student closes the left card to get more room; it shrinks to a narrow rail that still offers
a reopen button, the app mark, and Account and Settings. They close the audio card too; a reopen
button appears at the end of the tab row. If a recording is in progress or a transcription is
running while the audio card is closed, that reopen button clearly shows it.

**Why this priority**: Closing panels is how students make room for writing and reading; a
recording that disappears from view would violate the "work is never lost" promise.

**Independent Test**: Close and reopen each side card by pointer and keyboard, reload the page
to confirm the states are remembered, and start a recording or transcription with the audio card
closed to confirm the indicator.

**Acceptance Scenarios**:

1. **Given** a window at least 1100 px wide and the left card open, **When** the user activates
   its close button (or the existing panel shortcut), **Then** it becomes a rail of about 44 px with a reopen button, the
   app mark and, at the bottom, Account and Settings.
2. **Given** the left card is closed to a rail, **When** the user activates Account or Settings
   in the rail, **Then** they open exactly as they do from the open card.
3. **Given** the audio card is open, **When** the user activates its close button, **Then** the
   card disappears, the main card grows to use the space and a reopen button appears in the tab
   row.
4. **Given** the audio card is closed, **When** a recording is in progress or a transcription is
   running, **Then** the reopen button shows a clear indicator of that activity (distinct for
   recording vs. transcription), and the indicator disappears when the activity ends.
5. **Given** the user has set card widths and open/closed states, **When** they reload the page
   in the same browser (window at least 1100 px wide), **Then** the widths and states are restored.
6. **Given** a side card is opened or closed, **When** the user has not asked for reduced motion,
   **Then** the change animates in about 200 ms or less; **When** the user prefers reduced
   motion, **Then** it changes instantly.

---

### User Story 3 - Calendar and course pages in the main card (Priority: P2)

The student goes to the calendar or a course page. The page, including its own controls such as
the calendar's view switcher, lives inside the main card; the left card stays as before. "New
class" can be reached from the calendar page as well as from the course list heading.

**Why this priority**: These pages are visited often but are simpler to move into the card
than the session workspace.

**Independent Test**: Open the calendar and a course page, confirm their content and controls
sit inside the main card, that no full-width bar remains, and that "New class" is reachable from
the calendar page.

**Acceptance Scenarios**:

1. **Given** the calendar page, **When** it is shown, **Then** the calendar and all its controls
   (including the view switcher and a "New class" action) are inside the main card.
2. **Given** a course page, **When** it is shown, **Then** the page and its controls are inside the
   main card.
3. **Given** the calendar or a course page, **When** it is shown, **Then** no audio card is shown.

---

### User Story 4 - Focus mode (Priority: P2)

While writing, the student presses the focus mode shortcut (or a button); both side cards hide
and only the main card remains. Pressing it again restores exactly the previous arrangement.

**Why this priority**: A quick, reversible way to remove distraction; valuable but not required
for the layout to function.

**Independent Test**: With any combination of side cards open, enter and leave focus mode by
shortcut and by button and confirm the previous combination is restored; start a recording and
confirm the indicator stays visible in focus mode.

**Acceptance Scenarios**:

1. **Given** any combination of open/closed side cards, **When** the user enters focus mode,
   **Then** both side cards (including the left rail) are hidden and only the main card remains.
2. **Given** focus mode is on, **When** the user leaves focus mode (same shortcut or button),
   **Then** each side card returns to the state it had before focus mode was entered.
3. **Given** focus mode is on, **When** a recording is in progress or a transcription is running,
   **Then** an indicator of that activity remains visible.
4. **Given** focus mode is on, **When** the user wants Settings or Account, **Then** they can reach
   them by leaving focus mode with one action (the visible focus mode button or the shortcut).

---

### User Story 5 - Activity and status inside the cards (Priority: P2)

The recording bar and transcription progress, which used to appear as full-width bars, now appear
as compact pills floating at the bottom center of the main card on every page, with the same
information and the same controls, including Stop, Cancel and "Go to session".

**Why this priority**: Required to remove every full-width bar, and to keep long-running work
visible and cancellable.

**Independent Test**: Start a transcription and trigger each existing status/activity message;
confirm each appears inside or over a card with the same information and controls as before.

**Acceptance Scenarios**:

1. **Given** a transcription is running, **When** the user is on any page, **Then** its progress
   and its Cancel control are shown in a compact pill floating at the bottom center of the main
   card, and Cancel works as before.
2. **Given** a recording is in progress, **When** the user navigates to the calendar or a course
   page, **Then** a recording pill with elapsed time, label, "Go to session" and Stop floats at
   the bottom center of the main card, and both controls work as before.
3. **Given** a recording and a transcription are both active, **When** the pills are shown,
   **Then** they stack vertically without overlapping each other or the save indicator.

---

### User Story 6 - Cards in every theme (Priority: P2)

The student switches between light, dark and their own custom themes. In every theme the window
background, the cards and their borders come from the theme's existing colors — "Background",
"Surface / card" and "Border" — so no new colors appear in the editor. If the student edits a
custom theme so that the cards blend into the background, the editor warns them, like the
existing contrast warnings. Their older custom themes and older exported theme files still load
and show visible card edges.

**Why this priority**: Custom themes are an existing promise (Feature 005); the new layout must
honor them without breaking anyone's saved or exported themes.

**Independent Test**: Apply each built-in theme, an existing custom theme and an older exported
theme file; confirm all render with the window background, card surface and card border taken
from the theme's "Background", "Surface / card" and "Border" colors; edit those colors and confirm
the warning.

**Acceptance Scenarios**:

1. **Given** any theme, **When** the layout is shown, **Then** the window background uses the
   theme's "Background" color, each card's surface uses its "Surface / card" color and each
   card's border uses its "Border" color.
2. **Given** a custom theme whose card boundary (card surface and border against the background)
   is nearly indistinguishable, **When** it is edited, **Then** the editor shows a warning in the
   same way as existing contrast warnings, without blocking saving.
3. **Given** a custom theme saved, or a theme file exported, before this feature, **When** it is
   applied or imported, **Then** it works unchanged, with no migration or new fields.
4. **Given** the theme editor, **When** it is opened, **Then** its list of colors is the same as
   before this feature.
5. **Given** the user switches themes, **When** the switch happens, **Then** the whole layout,
   including background, cards and borders, updates instantly.

---

### User Story 7 - Smaller windows (Priority: P3)

On a window narrower than 1100 px, the side cards start closed; opening one shows it over the
main card instead of squeezing it.

**Why this priority**: Laptops with narrow windows or split screens are common, but the primary
target is a full-width laptop screen.

**Independent Test**: Resize the window between 800 px and 1100 px, open each side card, and
confirm it overlays the main card and that the main card never becomes narrower than 480 px.

**Acceptance Scenarios**:

1. **Given** a window narrower than 1100 px, **When** the app loads, **Then** both side cards
   start closed: the left card is hidden completely with no rail, an open button sits at the
   left end of the main card's top bar, and the audio card is closed.
2. **Given** a window narrower than 1100 px, **When** the user opens a side card, **Then** it
   appears over the main card without changing the main card's width, and can be dismissed
   with Escape or by its close button, returning focus to the control that opened it.
3. **Given** a window narrower than 1100 px, **When** the user wants Settings or Account,
   **Then** they open the left card with the button in the main card's top bar and reach them
   there.
4. **Given** any supported window size (800 px wide and up), **When** side cards are open or
   being resized, **Then** the main card is never narrower than 480 px.

---

### Edge Cases

- A recording is started, then the audio card is closed, then focus mode is entered: the
  recording indicator stays visible throughout, and the recording continues unaffected.
- The user resizes a side card so wide that the main card would drop below 480 px: the resize
  stops at the limit (or, below 1100 px, the card overlays instead).
- The window is resized from wide to narrow while both side cards are open: the main card stays
  at least 480 px wide; cards that no longer fit switch to overlay behavior without losing the
  user's remembered preferences for wide windows.
- The window is resized from narrow back to wide: the remembered wide-window states and widths
  apply again.
- Focus mode is entered and the page is reloaded: the app restores the pre-focus side card
  states (focus mode itself is not assumed to persist; see Assumptions).
- Focus mode is entered while a side card is overlaid on a narrow window: the overlay closes;
  leaving focus mode returns to the narrow-window default (both closed).
- A session has no location or links: the details view omits those fields rather than showing
  empty labels.
- The save state is "failed" or "conflict": the floating indicator stays visible and actionable
  exactly as the current save state UI is, and does not hide content the user needs to act on
  (the indicator does not cover the text being edited; content can be scrolled out from under it).
- Many tabs are open: the tab row scrolls or overflows within the card without growing taller
  and without pushing the chip, split-view action or audio reopen button out of view.
- The course list or note list is very long: the left card scrolls its own content while the
  header and the pinned Account/Settings stay visible.
- A custom theme with a nearly invisible card border: the layout still renders (no automatic
  override of the user's choice), and the editor warns.
- The "Sessions and notes" section is collapsed: it stays collapsed after the redesign and its
  state is remembered as before.

## Requirements *(mandatory)*

### Functional Requirements

**Cards (general)**

- **FR-001**: The window MUST present a background on which up to three cards are shown: a left
  card (side panel), a main card (workspace) and a right card (session audio).
- **FR-002**: Each card MUST have rounded corners of about 14 px, a thin border, and a gap of
  about 8 px to neighboring cards and to the window edge.
- **FR-003**: Card content MUST be clipped to the card's rounded corners and MUST keep an inner
  margin so it never touches the card's edge.
- **FR-004**: Each card MUST scroll its own content independently of the others and of the
  window; the window itself MUST NOT scroll.
- **FR-005**: There MUST be no full-width bar above, below or between the cards.
- **FR-006**: The layout MUST work in the built-in light and dark themes and in user-created
  themes, with all colors coming from theme tokens.

**Left card**

- **FR-007**: The left card MUST contain, from top to bottom: the app name with a button that
  closes the card; the course search; the course list with a small "New class" button beside
  its heading; the "Sessions and notes" section (shown when a course or session is open)
  containing "New note", the note list and the session timeline; and, pinned to the bottom,
  Account and Settings.
- **FR-008**: The app-wide top bar MUST be removed, and every control it contains today MUST be
  available elsewhere in the new layout (primarily the left card).
- **FR-009**: The left card MUST keep its current behavior: resizable by pointer and keyboard,
  collapsible "Sessions and notes" section, widths and states remembered per browser.
- **FR-010**: The session timeline MUST keep its present styling: past sessions normal, upcoming
  sessions grey, the current session highlighted.
- **FR-011**: At window widths of 1100 px and above, the closed left card MUST become a rail of
  about 44 px containing a button that reopens the card, the app mark, and Account and Settings
  at the bottom. Below 1100 px, the closed left card MUST be hidden completely (no rail) and a
  button that opens it MUST sit at the left end of the main card's top bar (the tab row in the
  session workspace, the page's own control area on the calendar and course pages).
- **FR-012**: Outside focus mode, Settings and Account MUST be reachable directly at 1100 px and
  above (open card or rail), and below 1100 px with at most one extra action (opening the left
  card).

**Main card**

- **FR-013**: On the calendar and course pages, the main card MUST contain the page together with
  its own controls (for example the calendar's view switcher).
- **FR-014**: "New class" MUST be available on the calendar page in addition to the course list.
- **FR-015**: In the session workspace, the main card MUST have exactly one fixed bar: a tab row
  of about 40 px containing the tabs (notes now, PDFs once that feature provides them), a
  compact session info chip, the split-view action and, when the audio card is closed, a button
  that reopens it. There MUST be no separate session header.
- **FR-016**: The session info chip MUST show the session's date and time, MUST show an
  "Upcoming" marker for sessions that have not yet happened, and MUST open a details view with
  the course, location, links and status of the session.
- **FR-017**: The note's save state (saved, saving, retrying, failed, conflict) MUST remain
  visible as a small indicator floating over a corner of the main card's content, using no
  layout space, with the same states and any actions it offers today.
- **FR-018**: Note content MUST be centered with a comfortable reading width and MUST grow with
  the card up to that width.

**Right card (audio)**

- **FR-019**: The audio card MUST appear only in the session workspace.
- **FR-020**: The audio card MUST have a header with the title, the Record button and a button
  that closes the card; below it, the recordings with their players and Transcribe buttons,
  unchanged in behavior.
- **FR-021**: The audio card MUST keep its current behavior: resizable (width remembered per
  browser) and closable (open/closed state remembered where it is remembered today, in the
  user's account preferences). "Collapsing" the audio card means closing it; there is no
  separate collapsed state.
- **FR-022**: When the audio card is closed, the reopen button in the tab row MUST show a clear
  indicator whenever a recording is in progress or a transcription is running; closing the card
  MUST never stop, pause or hide the existence of a recording.

**Activity and status**

- **FR-023**: Every status or activity element that appears today as a full-width bar (the
  recording bar and the transcription progress bar) MUST be shown as a compact pill floating at
  the bottom center of the main card, on every page (calendar, course page, session workspace,
  including with the audio card open and in focus mode), with the same information and controls
  (elapsed time or progress, label, Stop or Cancel, "Go to session"). When both are active, the
  pills stack vertically. The pills use no layout space and MUST NOT cover the floating save
  indicator.

**Focus mode**

- **FR-024**: A focus mode MUST be available by a keyboard shortcut and by a visible button; it
  hides both side cards (including the left rail) so only the main card remains.
- **FR-025**: Using focus mode a second time MUST restore each side card to the state it had
  before focus mode was entered.
- **FR-026**: In focus mode, the recording and transcription pills (FR-023) MUST stay visible.
- **FR-027**: The focus mode shortcut MUST NOT conflict with browser shortcuts, the note editor's
  shortcuts, the PDF reader's shortcuts, the audio player's shortcuts or any other existing app
  shortcut, and MUST NOT trigger while the user is typing text.

**Window size**

- **FR-028**: At a window of 1366 × 768, the fixed bars inside the main card MUST total at most
  10% of the viewport height (in a notes tab, only the tab row is fixed).
- **FR-029**: The main card MUST never be narrower than 480 px.
- **FR-030**: Below 1100 px window width, the side cards MUST start closed (left card hidden with
  no rail, per FR-011) and, when opened, MUST appear over the main card instead of reducing its width; an overlaid card MUST be dismissible
  with Escape and its close button.
- **FR-031**: Window widths below 800 px are out of scope; no requirement applies to them.

**Keyboard and accessibility**

- **FR-032**: Every action reachable today MUST remain reachable by keyboard and by pointer.
- **FR-033**: Every existing keyboard shortcut MUST keep its current meaning (including the
  panel toggle and the course search shortcut).
- **FR-034**: Every icon-only button MUST have an accessible name.
- **FR-035**: The cards MUST be exposed to assistive technology as named landmarks (side panel,
  workspace, audio).
- **FR-036**: Keyboard focus MUST always be visible, including on elements near the rounded card
  edges and inside clipped/scrolling areas.
- **FR-037**: Opening and closing a card MUST use a short animation (about 200 ms or less), which
  MUST be skipped when the user prefers reduced motion.
- **FR-038**: When a card is closed while it contains keyboard focus, focus MUST move to that
  card's reopen control (and never be lost to the page body).

**Themes**

- **FR-039**: The layout MUST take its colors from the theme's existing colors: the window
  background from "Background", each card's surface from "Surface / card" and each card's border
  from "Border". No new theme colors are added.
- **FR-040**: The theme editor's list of colors, saved theme data and theme export/import files
  MUST stay unchanged.
- **FR-041**: The theme editor's contrast check MUST warn when the card boundary (card surface
  and border against the background) is nearly indistinguishable, in the same way as existing
  contrast warnings, without blocking saving.
- **FR-042**: Existing custom themes and older exported theme files MUST keep working without
  migration.
- **FR-043**: Switching themes MUST remain instant, with no reload.
- **FR-044**: Built-in light and dark themes MUST show visible card boundaries and meet the
  contrast rules of the constitution; if a built-in value of "Background", "Surface / card" or
  "Border" must be tuned for that, the tuning stays within the existing colors.

**Unchanged behavior**

- **FR-045**: The feature MUST NOT change any data, API, stored file or existing behavior of the
  calendar, notes, audio, transcription, settings or PDF features beyond moving and restyling
  their controls as described here. No new stored setting is added.

### Key Entities

- **Card**: A rounded, bordered region on the background (left/side panel, main/workspace,
  right/audio). Attributes: open/closed state, width (side cards), overlay vs. docked (depending
  on window width).
- **Layout preferences**: Existing remembered panel widths and open/closed states, kept where they
  are kept today (left card width and state, section collapse and audio card width per browser;
  audio card open/closed in account preferences), plus the pre-focus-mode snapshot used to
  restore side cards (in memory only).
- **Theme**: Existing color set, unchanged; the layout reads its "Background", "Surface / card" and
  "Border" colors.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 1366 × 768 in a notes tab, the fixed bars inside the main card occupy at most
  10% of the viewport height (≤ 77 px), and the note text area receives at least 85% of the
  window height.
- **SC-002**: 100% of actions and keyboard shortcuts available before the redesign are reachable
  afterwards by both keyboard and pointer, verified against an inventory taken before the change.
- **SC-003**: With the audio card closed or in focus mode, an in-progress recording or running
  transcription is indicated on screen 100% of the time.
- **SC-004**: Entering and leaving focus mode restores the exact prior side card states in 100%
  of tested combinations (left open/closed × audio open/closed).
- **SC-005**: Every existing custom theme and every exported theme file from earlier versions
  loads without error, with no migration, and renders the card layout from its existing
  colors; for every built-in theme the card edges are visibly distinct.
- **SC-006**: The main card is never narrower than 480 px at any window width from 800 px up, in
  any combination of open cards and widths.
- **SC-007**: Card open/close transitions complete in 200 ms or less, and with reduced motion
  preferred they complete with no animation.
- **SC-008**: An automated accessibility check of the calendar page, a course page and the
  session workspace reports no missing accessible names on buttons and finds the three card
  landmarks, in light, dark and one custom theme.
- **SC-009**: Theme switches update the whole layout in under 100 ms with no page reload.
- **SC-010**: In a side-by-side review with the mockups at 1366 × 768, card proportions, gaps,
  corner radii and the position of each element match the mockups except where this spec says
  otherwise.

## Assumptions

- The mockups show tabs for notes and PDFs; PDF tabs only appear as provided by Feature 007,
  and the PDF reader's own toolbar is governed by Feature 007, not this feature.
- The existing panel toggle shortcut (`[`) keeps toggling the left card; the course search
  shortcut (`/`) keeps focusing the course search, opening the left card first if it is closed
  (as today when the panel is collapsed).
- The focus mode shortcut is chosen during planning from keys not used by the browser, the
  editor, the PDF reader, the player or the app; a single non-modifier key that is ignored
  while typing (in the same style as `[` and `/`), such as `\`, is the expected choice.
- Focus mode is a temporary view state; it is not required to survive a reload. On reload, the
  remembered (pre-focus) side card states apply.
- The visible focus mode button sits in the main card's top area (the tab row in the session
  workspace, the page's own control area on the calendar and course pages), so it stays
  reachable when both side cards are hidden.
- Layout preferences stay where they are kept today (see Key Entities); no new stored setting is
  introduced. The theme stays per account as defined in Feature 005.
- "Nearly indistinguishable" for the boundary warning uses the same style of contrast threshold
  as the existing warnings; the exact threshold is chosen in planning so that both built-in
  themes pass.
- The current narrow-window drawer behavior for the side panel is replaced by the 1100 px
  overlay rule in this spec.
- Phone and tablet layouts, dragging/floating/rearranging cards, and changes to the calendar,
  notes, audio, transcription or settings features themselves are out of scope.
