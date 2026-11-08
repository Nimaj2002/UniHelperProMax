# Feature Specification: Yuii Guided Tour

**Feature Branch**: `023-yuii-guided-tour`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "I want to have a tutor which would show the product when the user opens the app for the first time. Also they would be able to replay the tutor. but The thing I want to do is something different than normal apps. I want out mascot Yuii to show the product for the users. use the images inside the yuii folder. there are images of yuii pointing in a different positions. most of them are pointing to left you can mirror the image so they would show right as well. if you mirrored you are free to save it in yuii folder. So the tutor should sit on top of everything and Yuii have different expressions. show the app it self, help user to create a year, semester, a course, help them write their first note, upload new pdf, record, show the AI tutor. show different part of the setting and do all these with cute comments."

**Related**: Feature 001 (calendar: years, semesters, courses, sessions), Feature 002 (session
notes), Feature 003 (audio recording), Feature 005 (settings, providers, themes), Feature 006/007
(document import and PDF reader), Feature 008 (floating card layout: right panel, rail, tabs),
Feature 014 (session AI chat), Feature 022 (AI teacher).

## Overview

Instead of a plain row of tooltips, new users are welcomed by Yuii, the app's mascot: a
pink-haired student character who appears on top of the app, points at the part of the screen
being explained, changes expression to match the moment (greeting, explaining, excited, thinking,
shy, dizzy), and talks in short, cute speech bubbles. The tour is hands-on: Yuii walks the user
through creating their real first year, semester and course, writing their first note, adding a
PDF, making a recording, meeting the AI features, and a quick visit to Settings. The tour starts
automatically the first time, can be skipped at any moment, and can be replayed later.

## Clarifications

### Session 2026-11-07

- Q: Should the tour have users create real items or use temporary demo data? → A: Real items
  through the normal forms; everything created stays; replays offer to reuse existing items.
- Q: How big is Yuii and where does she stand? → A: Large (about one third of the window
  height), standing right beside the highlighted target with her speech bubble attached; she
  shrinks, or only the bubble is shown, when there is not enough room.
- Q: Should users who already have data when the feature ships get the tour automatically? →
  A: Yes; everyone who has not seen it gets it once and can skip it.
- Q: Where can users start the tour again? → A: In Settings, plus a small Yuii help button in
  the navigation rail that opens the tour and its chapter list.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Yuii welcomes a new user and shows the app (Priority: P1)

A user opens the app for the very first time. Before they do anything, Yuii appears on top of
the app, waves hello, introduces herself and the app in a speech bubble, and offers two choices:
start the tour or skip it. If the user starts, Yuii moves around the screen, points at each main
area of the app (navigation, home, calendar, task board, right panel), highlights it while the
rest of the app is dimmed, and explains it in one or two cute sentences. The user advances with
a "Next" button (or the keyboard), can go "Back", and can close the tour at any time.

**Why this priority**: This is the core of the feature: the mascot overlay, pointing,
expressions, speech bubbles, step navigation, and first-run triggering. Every other story is a
set of extra steps on top of this.

**Independent Test**: Start the app with a brand-new account, confirm Yuii appears
automatically, step through the app-overview steps forward and back, then skip; reload and
confirm the tour does not start again.

**Acceptance Scenarios**:

1. **Given** a user who has never seen the tour, **When** they open the app after signing in,
   **Then** Yuii appears on top of the app with a greeting expression and a welcome speech
   bubble offering "Start the tour" and "Maybe later".
2. **Given** the tour is on an overview step, **When** the step is shown, **Then** the target
   area is highlighted, the rest of the app is dimmed, and Yuii stands beside the target with a
   pointing pose aimed at it (facing left or right depending on which side of the target she
   stands).
3. **Given** the tour is running, **When** the user presses "Next", "Back", or "Skip tour", or
   uses the equivalent keys, **Then** the tour moves to the next step, the previous step, or
   closes, respectively.
4. **Given** the user skipped or finished the tour, **When** they reload the app or sign in
   again later (on any device), **Then** the tour does not start automatically.
5. **Given** the tour is showing, **When** a step is displayed, **Then** a progress indicator
   shows where the user is (e.g., "Step 4 of 18").

---

### User Story 2 - Yuii helps the user build their first year, semester and course (Priority: P1)

After the overview, Yuii guides the user through creating their own first year, semester and
course. For each one she points at the exact control to use, explains what it is in a cute
sentence, waits while the user fills in the real form, and cheers (excited expression) when the
item is created. If the user already has a year/semester/course, Yuii lets them pick an existing
one instead of creating a new one.

**Why this priority**: An empty app is the biggest barrier for a new student; nothing else (notes,
PDFs, recordings) can happen without a course and session. The tour turns this setup into a
guided first success.

**Independent Test**: With an empty account, run the tour through the setup steps, create a
year, semester and course through the real forms, and confirm all three exist afterwards and
appear in the calendar/navigation exactly as if created without the tour.

**Acceptance Scenarios**:

1. **Given** the tour reaches the "create a year" step, **When** the step is shown, **Then** Yuii
   points at the control that creates a year and the user can open and fill the real year form
   while the tour waits.
2. **Given** the user is filling a form during the tour, **When** they submit it successfully,
   **Then** the tour detects the new item and advances automatically, with Yuii in the excited
   expression and a congratulatory comment.
3. **Given** the user submits a form with an error (e.g., a reserved or duplicate name), **When**
   the error appears, **Then** the normal form error is shown, Yuii switches to the dizzy or
   thinking expression with a gentle hint, and the tour stays on that step.
4. **Given** the user already has at least one year, semester or course, **When** the tour reaches
   that creation step, **Then** Yuii offers to use an existing one ("Use my existing ...") as well
   as creating a new one.
5. **Given** the tour waits for a creation, **When** the user chooses "Skip this step", **Then**
   the tour moves on without creating anything; later steps that need a course explain that they
   need one and offer to skip.

---

### User Story 3 - Yuii helps the user write their first note (Priority: P2)

With a course (and its class session) in place, Yuii guides the user to open a session and its
note, points at the editor, and invites them to type their first line. She explains that notes
save by themselves and points at the save status when it shows "saved".

**Why this priority**: Notes are the core daily activity; seeing autosave in action builds trust
that work is never lost.

**Independent Test**: With an existing course and session, run the note steps, type text into
the real note, and confirm the note is saved as a normal note file and the tour advances once
the save status shows saved.

**Acceptance Scenarios**:

1. **Given** the tour reaches the note step and a session exists, **When** the step is shown,
   **Then** Yuii points at how to open the session's note and the tour waits until it is open.
2. **Given** the note editor is open during the tour, **When** the user types and the note
   autosaves, **Then** Yuii points at the save status and comments that the note saved itself.
3. **Given** the user leaves the note empty, **When** they press "Next", **Then** the tour
   continues without creating note content on their behalf.

---

### User Story 4 - Yuii shows PDF upload and recording (Priority: P2)

Yuii shows the user how to add a PDF to the session and how to record a lecture. For the PDF she
points at the upload control and, if the user picks a file, celebrates when it opens in the
reader. For recording she points at the record control, explains that audio is saved in pieces
so nothing is lost, and lets the user try a short recording or skip it. Each of these steps can
be skipped, because the user may not have a PDF at hand or may not want to grant microphone
access.

**Why this priority**: PDFs and recordings are key features, but they depend on outside things
(a file, a microphone), so they must be optional within the tour.

**Independent Test**: Run these steps, upload a real PDF and confirm it opens in the reader; start
and stop a short recording and confirm it is saved to the session; then rerun and skip both and
confirm the tour continues.

**Acceptance Scenarios**:

1. **Given** the tour reaches the PDF step, **When** the user uploads a PDF, **Then** it is stored
   like any other upload and the tour advances once it is shown.
2. **Given** the tour reaches the recording step, **When** the user starts and stops a recording,
   **Then** the recording is stored like any other recording and the tour advances.
3. **Given** the browser/OS denies microphone access, **When** the user tries to record during the
   tour, **Then** the normal permission error is shown, Yuii shows the shy or dizzy expression
   with a friendly explanation, and the user can skip the step.
4. **Given** either step, **When** the user chooses "Skip this step", **Then** nothing is uploaded
   or recorded and the tour continues.

---

### User Story 5 - Yuii introduces the AI chat and AI teacher (Priority: P2)

Yuii points at the AI chat and the AI teacher in the right panel and explains, with a thinking
expression, what each is for (asking questions about the session's material; being quizzed and
taught by the AI teacher). If no AI provider is set up yet, she says so and points out that it can
be set up in Settings, which the Settings part of the tour will show.

**Why this priority**: The AI features are a key differentiator, but they need a provider key,
so the tour explains rather than forces a conversation.

**Independent Test**: Run the AI steps with and without a configured AI provider and confirm Yuii
points at the right controls and gives the matching explanation in each case.

**Acceptance Scenarios**:

1. **Given** the tour reaches the AI step, **When** it is shown, **Then** Yuii points at the AI
   chat and AI teacher entry points, one per step, and explains each.
2. **Given** no AI provider is configured, **When** the AI step is shown, **Then** Yuii explains
   that a provider needs to be set up first and that Settings is where to do it.
3. **Given** an AI provider is configured, **When** the AI step is shown, **Then** the user may
   send a first message to try it, or press "Next" to continue without sending anything.

---

### User Story 6 - Yuii tours the Settings (Priority: P3)

Yuii opens Settings and points at its main sections with a short comment each: AI providers,
transcription, themes, keyboard shortcuts, calendar import/export, backup, account, and version.
She then says goodbye (greeting expression) and points at the Yuii help button in the
navigation rail, telling the user they can replay the tour from there or from Settings.

**Why this priority**: Useful for discovery but not needed to get started.

**Independent Test**: Run the Settings steps and confirm each listed section is shown and
highlighted, and that the final step tells the user where to replay the tour.

**Acceptance Scenarios**:

1. **Given** the tour reaches the Settings part, **When** it starts, **Then** the app navigates to
   Settings and Yuii points at each listed section in turn.
2. **Given** the final step, **When** the user presses "Finish", **Then** the tour closes, is
   marked as completed, and the user is left where they were in Settings.

---

### User Story 7 - Replay the tour (Priority: P2)

A user who skipped or finished the tour can start it again from Settings or from the small Yuii
help button in the navigation rail. The replay starts from the beginning, and the user
can jump to a chapter (Overview, Your first course, Notes, PDFs & recording, AI, Settings).

**Why this priority**: Users who skipped on first launch, or forgot a feature, need a way back.

**Independent Test**: After finishing the tour, start it from Settings, confirm it starts from
the welcome step, jump to the "AI" chapter, then close it and confirm no data was changed by the
replay itself.

**Acceptance Scenarios**:

1. **Given** the tour was completed or skipped, **When** the user picks "Replay tour with Yuii"
   in Settings, **Then** the tour starts from the welcome step.
2. **Given** the tour is replaying, **When** the user opens the chapter list, **Then** they can
   jump directly to any chapter.
3. **Given** a replay, **When** the user reaches a creation step and already has data, **Then**
   Yuii offers to use existing items so replays do not force duplicate years, semesters or
   courses.

---

### Edge Cases

- **Target not on screen**: If the element Yuii needs to point at is not visible (collapsed panel,
  small window, scrolled away), the tour first brings it into view (opens the panel, scrolls); if
  it still cannot be shown, Yuii stands in the center with the instructional pose and explains
  the step without pointing.
- **Small windows**: When there is no room beside the target, Yuii is shown smaller or only the
  speech bubble is shown near the target, so neither covers the highlighted control.
- **User clicks outside the highlight**: During "show" steps, clicks outside the highlight do not
  act on the app; during "do it yourself" steps, the user can interact with the highlighted
  control and the form/dialog it opens.
- **User navigates away mid-tour** (e.g., via a keyboard shortcut or browser back): the tour
  pauses and offers "Continue tour" or "End tour".
- **App closed mid-tour**: On next open the tour does not force itself again from the start;
  Yuii offers to continue from the chapter where the user left off, or to end the tour.
- **Theme**: The overlay, highlight, and speech bubble stay readable in light, dark and custom
  themes.
- **Reduced motion**: When the user's system asks for reduced motion, Yuii's movement between
  positions and bubble animations are replaced by simple fades or instant changes.
- **Desktop app**: The tour behaves the same in the desktop app; first run is per user account,
  not per installation.
- **Existing users after upgrade**: Users who already have data when this feature ships get the
  tour auto-started once, like new users; creation steps offer to use their existing items, and
  they can skip the whole tour from the welcome step.
- **Multiple accounts**: Each account has its own "tour seen" state.

## Requirements *(mandatory)*

### Functional Requirements

**Mascot and overlay**

- **FR-001**: The tour MUST appear above all other app content, including panels, dialogs it does
  not own, and floating cards, while letting through interaction with the highlighted target on
  "do it yourself" steps.
- **FR-002**: The tour MUST show Yuii using the provided artwork, with at least these expressions:
  greeting, instructional/pointing, excited, thinking, shy, dizzy, and holding a tablet; each step
  MUST specify which expression is shown.
- **FR-003**: Pointing poses MUST be available facing both left and right (mirrored where the
  original artwork only faces one way), and Yuii MUST be placed beside the target with the
  pointing pose aimed at it.
- **FR-004**: Each step MUST show a speech bubble from Yuii with a short, friendly, playful
  comment (cute tone, 1–3 sentences) explaining the highlighted area or task.
- **FR-005**: Each step that targets a UI element MUST highlight that element and dim the rest of
  the screen.

**Navigation and control**

- **FR-006**: The tour MUST provide "Next", "Back", "Skip this step" (on optional steps) and
  "End tour" controls, all operable by keyboard (including Escape to end, with confirmation if
  the user is mid-way), and focus MUST move into the speech bubble when a step appears.
- **FR-007**: The tour MUST show progress (current step and total, and the current chapter).
- **FR-008**: The tour MUST be organized into chapters: Welcome & overview; Your first year,
  semester and course; First note; PDFs & recording; AI chat & AI teacher; Settings; Goodbye.
  Users MUST be able to jump to any chapter during the tour.
- **FR-009**: The tour MUST navigate the app to the screen each step needs (e.g., calendar,
  session, settings) and bring the target into view before showing the step.
- **FR-010**: Speech bubble content MUST be exposed to assistive technologies (announced when a
  step changes), and Yuii's images MUST have a text alternative describing the expression.

**Hands-on steps**

- **FR-011**: The setup steps MUST let the user create a real year, semester and course through
  the app's normal forms; anything created MUST be identical to items created without the tour.
- **FR-012**: The tour MUST detect when the awaited action completes (item created, note saved,
  PDF opened, recording saved) and advance automatically with a celebratory comment.
- **FR-013**: The tour MUST NOT create, change or delete any user data by itself; it only guides
  the user through actions they perform. Skipping a step MUST leave data unchanged.
- **FR-014**: When the user already has years, semesters, courses or sessions, creation steps MUST
  offer to use an existing item instead of creating a new one.
- **FR-015**: Steps that depend on a missing prerequisite (e.g., no course for the note step)
  MUST explain the prerequisite and offer to skip or go back to the step that creates it.
- **FR-016**: The PDF, recording and AI steps MUST be optional and skippable; the AI steps MUST
  adapt their explanation to whether an AI provider is configured.
- **FR-017**: On errors from the underlying action (validation error, denied microphone, failed
  upload), the app's normal error MUST be shown, Yuii MUST switch to a fitting expression with a
  helpful hint, and the tour MUST remain on that step.

**First run, replay and state**

- **FR-018**: The tour MUST start automatically the first time a user opens the app after
  signing in, for every user who has not seen it yet, whether or not they already have data.
- **FR-019**: The user's tour state (not seen / in progress at chapter X / skipped / completed)
  MUST be stored per user account so it follows them across devices and app restarts.
- **FR-020**: Users MUST be able to replay the tour at any time from Settings and from a small
  Yuii help button in the navigation rail (keyboard reachable, with an accessible name); the
  button MUST offer "Start from the beginning" and the chapter list. Replay from Settings MUST
  start from the welcome step; both entry points allow jumping to chapters.
- **FR-021**: If the tour was interrupted (app closed, user navigated away), the next start MUST
  offer to continue from the interrupted chapter or end the tour.
- **FR-022**: Existing users (who already have data when the feature is released) MUST get the
  tour auto-started once, the same as new users; on that run every creation step MUST offer
  their existing items first (see FR-014).

**Look and feel**

- **FR-023**: The overlay, highlight and speech bubble MUST follow the app's theme (light, dark,
  custom) and meet WCAG AA contrast for text.
- **FR-024**: Yuii's movement and expression changes MUST be animated smoothly, and MUST respect
  the system's reduced-motion setting.
- **FR-025**: Yuii MUST be shown large (about one third of the window height) beside the
  highlighted target, with her speech bubble attached to her. Yuii and her bubble MUST never
  cover the highlighted target; when there is not enough room the tour MUST shrink Yuii, and if
  still too tight, show only the bubble next to the target.

### Key Entities

- **Tour step**: One moment of the tour: chapter, target area (or none), Yuii's expression and
  facing direction, speech text, kind ("show" or "do it yourself"), the completion it waits for
  (if any), and whether it can be skipped.
- **Tour chapter**: A named group of steps (Welcome, First course, First note, PDFs & recording,
  AI, Settings, Goodbye) that users can jump to.
- **User tour state**: Per account: status (not seen, in progress, skipped, completed), last
  chapter reached.
- **Yuii artwork set**: The mascot images by expression, each with left- and right-facing
  variants where pointing direction matters.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user who follows the tour ends it with at least one year, semester, course,
  and a saved note, in under 10 minutes.
- **SC-002**: 100% of tour steps that target a control show Yuii pointing toward that control
  (correct facing direction) without covering it, at window widths from 1024 px up.
- **SC-003**: Every step can be completed or skipped using only the keyboard.
- **SC-004**: A user who skipped or finished the tour never sees it start automatically again, on
  any device, unless they start a replay.
- **SC-005**: Replaying the tour twice in a row with existing data creates zero duplicate items
  unless the user explicitly chooses to create new ones.
- **SC-006**: The speech bubble text meets WCAG AA contrast in every built-in theme.
- **SC-007**: In usability testing, at least 80% of first-time users can find where to replay the
  tour after finishing it.

## Assumptions

- "AI tutor" in the request covers both the AI chat (Feature 014) and the AI teacher
  (Feature 022); the tour introduces both.
- The tour is hands-on (confirmed in Clarifications): Yuii guides the user to create their own
  real items; no demo/sandbox data is used. Nothing is created without a user action.
- Creating a course leads naturally to a class session (per the calendar feature); the note,
  PDF and recording steps use a session of the course created or picked in the setup chapter.
- Yuii's artwork comes from the `Yuii/` folder (transparent versions). Mirrored right-facing
  copies of the pointing poses may be saved alongside the originals in that folder. Exact
  mapping of images to steps is decided during planning.
- Speech text is in English for this version (the app has no localization yet), written in a
  playful, friendly "cute mascot" voice; Yuii is referred to with she/her as the mascot character.
- The tour state is stored with the user's existing per-account preferences; no new
  infrastructure is needed.
- The Settings chapter covers the sections that exist at release time (AI providers,
  transcription, proxy, themes, shortcuts, time tracking, calendar import/export, backup, trash,
  account, version); sections the user cannot access are skipped.
- Desktop and web versions share the same tour.
