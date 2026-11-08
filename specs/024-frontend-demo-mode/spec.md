# Feature Specification: Frontend-Only Demo Mode

**Feature Branch**: `024-frontend-demo-mode`

**Created**: 2026-11-08

**Status**: Draft (updated 2026-11-09: PC-only on phones, demo embedded in the website, Yuii theme by default)

**Input**: User description: "Frontend-only demo mode: a build of the React frontend that runs entirely in the browser with no backend, deployable as a static site (e.g. Vercel at demo.unihelperpromax.tech) and linked from the marketing website. All /api/v1 calls are served by an in-browser mock layer seeded with realistic sample data (a student with courses, a semester calendar, class sessions with Markdown notes, a PDF, a recorded lecture with transcript, AI chat history, a task board). Visitors can click through and edit; changes live only in the browser session and reset on reload (or via a "Reset demo" control). AI chat returns canned streamed replies; recording/transcription and other features that need real hardware or providers are simulated or clearly marked as unavailable in the demo. A persistent banner says it's a demo with a link to download the real app. No API keys, no real network calls, no changes to the production build's behavior, and the demo build must not ship in the desktop app."

**Related**: Feature 001 (calendar), 002 (session notes), 003 (recording), 004 (transcription),
005 (settings, themes), 007 (PDF reader), 012 (task manager), 014 (session AI chat),
022 (AI teacher), 023 (Yuii guided tour). The marketing website (`website/`) links to the demo.

## Overview

People who find UniHelperProMax on the website today can only read about it or download it.
This feature gives them a "try it in your browser" demo: a separate copy of the real app's
interface, hosted as a plain web page, that opens straight into a filled-in student workspace.
Visitors can browse the calendar, open a class session, edit its notes, read the PDF, play a
recorded lecture with its transcript, chat with the AI, and move tasks around, with no sign-up
and no server. Everything they change stays in their browser tab and is thrown away when they
reload or press "Reset demo". A banner on every screen makes clear it is a demo and points to
the download.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor opens a ready-made workspace and explores it (Priority: P1)

A visitor clicks "Try the demo" on the website. The demo opens directly in the app's home
screen, already signed in as a sample student, with no login or setup screen. A banner says this
is a demo, that changes are not saved, and links to the download. The visitor opens the
calendar, sees a semester full of classes, opens a class session, and sees its notes, PDF,
recording and chat in the usual places.

**Why this priority**: Seeing the real interface with realistic data is the whole point; every
other story builds on this read-only tour.

**Independent Test**: Open the demo in a fresh browser with the network to everything except
the demo's own static files blocked; confirm it reaches the home screen with sample data, the
banner shows, and the calendar, a session, the task board and settings all open without errors.

**Acceptance Scenarios**:

1. **Given** a visitor who has never opened the demo, **When** they open the demo address,
   **Then** they land on the home screen as the sample student within a few seconds, without
   seeing a login, setup or "server unreachable" screen.
2. **Given** the demo is open, **When** the visitor goes to any screen, **Then** the demo banner
   is visible and offers a link to the download page.
3. **Given** the demo is open, **When** the visitor opens the calendar, **Then** they see a
   current semester with several courses and class sessions placed around today's date.
4. **Given** a sample class session, **When** the visitor opens it, **Then** they see Markdown
   notes (including a diagram and math), an attached PDF that opens in the reader, a playable
   lecture recording with its transcript, and a previous AI chat.

---

### User Story 2 - Visitor edits things and sees the app react (Priority: P1)

The visitor types in a note, creates a task and drags it across the board, adds a calendar
event, and changes the theme. Everything behaves as in the real app (the note shows "saved",
the task moves, the event appears) for as long as the tab stays open.

**Why this priority**: A demo that cannot be touched feels like a screenshot; editing is what
convinces people.

**Independent Test**: Edit a note, create and move a task, add an event, switch to dark theme;
confirm each change shows everywhere it should, then reload and confirm all of it is back to the
sample data.

**Acceptance Scenarios**:

1. **Given** a sample note, **When** the visitor types in it, **Then** the save indicator shows
   it saved and the text is still there after moving to another screen and back.
2. **Given** the task board, **When** the visitor creates a task and moves it to another column,
   **Then** it stays there while the tab is open.
3. **Given** any changes, **When** the visitor reloads the page or presses "Reset demo" and
   confirms, **Then** the workspace returns to the original sample data.
4. **Given** any changes, **When** the visitor opens the demo in a second tab, **Then** that tab
   starts from the original sample data (tabs do not share changes).

---

### User Story 3 - Visitor tries the AI and lecture features (Priority: P2)

The visitor asks the AI chat a question about the session and watches an answer stream in. They
press "Transcribe" on the sample recording and see a transcript appended to the note. When they
press "Record", they get a short message that live recording is available in the downloadable
app, instead of a microphone prompt.

**Why this priority**: AI chat and lecture transcription are the headline features, but they
depend on providers and hardware the demo does not have, so they are simulated.

**Independent Test**: Send any chat message and confirm a streamed reply appears; run
transcription on the sample recording and confirm text is appended without removing existing
note content; press Record and confirm the "available in the app" message appears and no
microphone permission is requested.

**Acceptance Scenarios**:

1. **Given** the session chat, **When** the visitor sends any message, **Then** a pre-written
   reply streams in word by word, and the reply makes clear it is a demo answer.
2. **Given** the sample recording, **When** the visitor starts transcription, **Then** progress
   is shown and a pre-written transcript is appended to the end of the note; earlier note text is
   unchanged.
3. **Given** any screen, **When** the visitor presses a control that needs a microphone, a real
   provider, files on disk, or an account action (record, upload a new PDF, add an API key,
   backup/restore, password change, account management, desktop-only settings), **Then** a
   message explains it is available in the downloadable app, and nothing else happens.

---

### User Story 4 - Website visitors can find the demo (Priority: P2)

The marketing website shows a "Try the demo" link next to the download buttons; it opens the
demo in a new tab.

**Why this priority**: Without a link nobody finds the demo; it is small but required for the
feature to deliver value.

**Independent Test**: Open the website, find the link in the hero and download sections, click
it, and confirm the demo opens.

**Acceptance Scenarios**:

1. **Given** the website, **When** the visitor clicks "Try the demo", **Then** the demo opens.

---

### User Story 5 - The real app is unaffected (Priority: P1)

The maintainer builds the normal web app and the desktop app exactly as before. Neither contains
the demo data, the demo banner, or the simulated behaviour, and both still talk only to their
real server.

**Why this priority**: The demo must never weaken the real product (for example, a real user
seeing fake data, or notes "saved" only in memory).

**Independent Test**: Build the normal web app and the desktop app; confirm their output
contains no demo data or demo banner text, and that the existing test suites pass unchanged.

**Acceptance Scenarios**:

1. **Given** the normal and desktop builds, **When** they are inspected, **Then** they contain
   none of the demo's sample data, banner, or simulated responses.
2. **Given** the existing automated tests, **When** they run after this feature, **Then** they
   pass without changes to their expectations.

---

### Edge Cases

- A screen asks for data the sample set does not have (e.g., a session in a year with no data):
  it shows the same empty state the real app shows, not an error.
- A visitor triggers an action the demo does not simulate and is not on the "available in the
  app" list: it shows a friendly "not available in the demo" message, never a crash or a
  "server unreachable" screen.
- The visitor's browser blocks storage (private mode): the demo still works, because it keeps
  changes in memory only. Exception: a browser window that cannot run the demo at all (e.g. a
  private window that disables background page scripts) shows a clear "open the demo in a normal
  window" message with the download link instead of a broken app.
- The demo is opened weeks after it was built: sample sessions, events and tasks are placed
  relative to the visitor's current date, so the calendar never looks empty or outdated.
- The visitor tries to export a note, the calendar or a chat: the download works from the in-tab
  data, or it shows the "available in the app" message; it never sends anything anywhere.
- The Yuii guided tour (Feature 023) runs in the demo the first time a visitor opens it and can be
  skipped; tour steps that require creating real items work against the in-tab data.
- A visitor on a phone: the demo does not load; a page says
  "UniHelperProMax is for PC only for now", with links back to the website and to the download
  (FR-016).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The demo MUST run entirely in the visitor's browser from static files, with no
  server of its own and no requests to any server other than the one hosting those files.
- **FR-002**: The demo MUST open directly into the home screen as a signed-in sample student;
  login, first-run setup, and account screens MUST NOT block entry.
- **FR-003**: The demo MUST answer every request the app makes to its API with responses that
  match the real API's documented shapes, so the app's screens behave as they do with a real
  server.
- **FR-004**: The demo MUST start with sample data covering: one year and current semester with
  at least 3 courses and their recurring class sessions; at least one event; notes on several
  sessions (including headings, lists, a diagram and math); at least one PDF with a few
  annotations; at least one lecture recording with a transcript; at least one AI chat; a task
  board with tasks in several columns; and a general note on home.
- **FR-005**: Sample dates MUST be placed relative to the date the visitor opens the demo.
- **FR-006**: Visitors MUST be able to create, edit, move and delete notes, tasks, events,
  courses and sessions, and change themes and other in-app preferences; these changes MUST be
  reflected across all screens while the tab stays open.
- **FR-007**: Changes MUST be kept only in the open tab. Reloading the page MUST restore the
  original sample data. A "Reset demo" control MUST do the same after the visitor confirms.
- **FR-008**: AI chat (Feature 014) and the AI teacher (Feature 022) MUST reply with pre-written
  answers that stream in like real replies; replies MUST make clear they are demo answers.
- **FR-009**: Transcription MUST be simulated by appending a pre-written transcript to the end
  of the target note with visible progress; it MUST NOT change existing note content.
- **FR-010**: Actions that need a microphone, a real provider, the visitor's files, or account
  administration (recording, uploading new files, setting API keys or proxies, backup/restore,
  password and account management, desktop-only settings) MUST show a message that the feature
  is available in the downloadable app, with a download link, and MUST NOT request device
  permissions.
- **FR-011**: A demo banner MUST be visible on every screen, state that changes are not saved,
  and link to the download page. It MUST be keyboard reachable and meet the app's contrast and
  theming rules in light, dark and custom themes.
- **FR-012**: The demo MUST NOT contain, ask for, or send any API keys or personal data.
- **FR-013**: The normal web build and the desktop app MUST NOT include the demo's sample data,
  banner, or simulated responses, and their behaviour MUST be unchanged.
- **FR-014**: The marketing website MUST link to the demo from its hero and download sections.
- **FR-015**: The demo MUST be deployable to a static host under its own address, separate from
  the marketing website.
- **FR-016**: On phones (screens 480 px wide or less, or touch screens 480 px tall or less, i.e. a
  phone held sideways), the demo MUST show "UniHelperProMax is for PC only for now" instead of the app, and
  MUST NOT start the in-browser API.
- **FR-017**: The marketing website MUST have a "See it live" section, which the "See a demo"
  buttons and the menu link scroll to: on a PC it shows Yuii and a button that opens the demo; on
  phones (same rule as FR-016) it shows the PC-only note instead. The demo MUST NOT be framed by
  other sites.

### Key Entities

- **Sample workspace**: the fixed starting data (student profile, year, semester, courses,
  sessions, events, notes, PDF with annotations, recording with transcript, chats, tasks,
  preferences), defined once and copied fresh for every tab load or reset.
- **Demo session state**: the visitor's changes on top of the sample workspace; exists only in
  the open tab.
- **Canned reply**: a pre-written AI chat, AI teacher or transcript text used in place of a real
  provider.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor reaches the populated home screen within 5 seconds on a
  typical broadband connection, with zero sign-in or setup steps.
- **SC-002**: Every top-level screen of the app (home, calendar, session, task board, settings)
  opens in the demo without an error message or a "server unreachable" screen.
- **SC-003**: While the demo runs, 100% of network requests go to the demo's own host; none go to
  an app server, an AI provider or a transcription provider.
- **SC-004**: After reload or "Reset demo", 100% of visitor changes are gone and the sample data
  is fully restored.
- **SC-005**: The normal web and desktop builds contain no demo-only content, and all existing
  automated tests pass unchanged.
- **SC-006**: A visitor can complete the core tour (open a session, edit its note, read the PDF,
  play the recording, get an AI reply, move a task) in under 3 minutes without help.

## Constitution Notes

- **Principle I (work is never lost)**: The demo deliberately does not keep visitor changes. This
  is allowed because nothing in the demo is the visitor's real work, and the banner states that
  changes are not saved on every screen (FR-007, FR-011). The real app's autosave is unchanged
  (FR-013). Transcription in the demo is still append-only (FR-009).
- **Principle III (frontend talks only to the API)**: The app's screens still go through the same
  API client and contracts; only the demo build answers those calls in the browser (FR-003). The
  real builds keep talking to the real server (FR-013).
- **Principle IV (secrets)**: No keys exist in the demo (FR-012).
- **Principle VII (simplicity)**: Any new dependency or abstraction for the in-browser responder
  must be justified in the plan.

## Assumptions

- The demo is a separate build of the existing frontend, not a new app; it reuses the real
  screens so it stays in step with the product.
- "Reset on reload" was requested; keeping changes across reloads is out of scope.
- Live microphone recording and uploading the visitor's own files are not simulated in this
  version; they show the "available in the app" message (FR-010). A pre-made recording and PDF
  are provided instead.
- The demo uses the same English text as the app; no localization.
- The demo starts in the built-in "Yuii" light theme preset; visitors can change it.
- The sample PDF and recording are small, freely licensable files created for the demo (no
  copyrighted course material), kept small enough for a fast first load.
- Hosting is a static host the maintainer already uses for the website (e.g. Vercel), at a
  separate address such as `demo.unihelperpromax.tech`; setting up that address is a deployment
  step, not app work.
- The demo shows the web (not desktop) variant of the app; desktop-only settings show the
  "available in the app" message.
- Admin/account-management screens are hidden or show the "available in the app" message, since
  the sample student is the only account.
