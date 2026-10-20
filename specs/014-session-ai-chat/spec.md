# Feature Specification: AI Chat in Session and Event Workspaces

**Feature Branch**: `014-session-ai-chat`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Add an AI chat to the session and event workspaces, like the chat in VS Code: students ask questions in a streaming conversation, attach their notes, PDFs, pictures and audio as context, choose the model, and keep a separate chat history for each session. The chat lives in the right panel of the workspace, below the recordings, and can be expanded into a tab. The AI comes from endpoints the student configures in Settings: cloud providers or local servers, in three request styles (OpenAI-compatible, Anthropic, Google Gemini). The app ships with no AI service, no key and no default endpoint. Use design/reference/vscode-chat-sessions.png as the visual reference for the history list and the message box." (Full description covers: the right session panel with Recordings and Chat sections and its rail; Priority 1 — endpoints in Settings, the Chat section, History and Conversation views, the message box, streaming, Stop, model choice, errors, privacy, Expand and Dock, notes as attachments, per-session history; Priority 2 — pictures, PDFs, audio, limits and the context list; Priority 3 — add to note, edit and resend, custom instructions, usage, search in chat text; secrets at rest; cross-cutting accessibility, performance and offline requirements; out of scope.)

**Related**: Feature 002 (notes and autosave), Feature 003 (session audio recording), Feature 004
(transcription, append-only writes, provider hints), Feature 005 (Settings, transcription
providers and their keys, themes), Feature 006 (session file import), Feature 007 (session PDF
reader), Feature 008 (floating card layout: left card rail, audio card, tab row, focus mode,
narrow windows), Feature 009 (events and their workspaces), Feature 012 (panel rails on the
home page).

## Clarifications

### Session 2026-10-19

- Q: When the computer has no operating-system key store, what should the app do with API keys? → A: Keep the encryption key in a file readable only by the user, in the app's per-user config folder outside the data folder; Settings warns that anyone with access to the user account can read it.
- Q: When a note stays attached across several messages, which version is sent? → A: Every message takes a fresh snapshot of each attached note at send time; the history records which snapshot each message used.
- Q: When the student presses Regenerate, what happens to the previous answer? → A: Both are kept as versions of the same answer with "‹ 1/2 ›" controls; the version shown is the one used as context for later messages.
- Q: In what format should each chat be saved in the session folder? → A: A JSON file per chat as the app's source of truth, plus a matching Markdown transcript the app regenerates for reading outside the app.
- Q: When the student edits and resends their last message, what happens to the original message and its answer? → A: They are kept as version 1; the edited message and its new answer become version 2, switchable with "‹ n/m ›" on the user message.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure an AI endpoint (Priority: P1)

The app ships with no AI service. A student opens Settings → AI and adds an endpoint: a name,
a request style (OpenAI-compatible, Anthropic or Google Gemini), a base URL as the provider
documents it, and optionally an API key. They test the connection, refresh the model list (or
type a model identifier by hand for a local server), adjust each model's display name and
capabilities (Images, PDF documents, Audio), and save. The endpoint is labeled Local or Remote
from its address.

**Why this priority**: Nothing else in the feature works without at least one endpoint and model.

**Independent Test**: With no endpoints configured, add a local OpenAI-compatible server
(`http://localhost:11434/v1`, no key), test it, refresh models, save; add a remote Anthropic
endpoint with a key, test it, save; confirm the keys show masked, the labels read Local and
Remote, and nothing was saved by the tests themselves.

**Acceptance Scenarios**:

1. **Given** a fresh installation, **When** the student opens Settings → AI, **Then** the list
   of endpoints is empty and there is no preconfigured service, key or address.
2. **Given** the add form, **When** the student enters `http://localhost:11434/v1/`, **Then** the
   trailing slash is ignored and the endpoint is labeled Local.
3. **Given** the add form with the OpenAI-compatible style, **When** the student pastes
   `https://api.openai.com/v1/chat/completions`, **Then** the app keeps
   `https://api.openai.com/v1` as the base URL and tells the student it removed the path.
4. **Given** a Remote address with plain `http`, **When** the student tries to save, **Then** the
   app refuses and explains that remote endpoints must use https; no key is ever sent over that
   address.
5. **Given** an endpoint with a wrong key, **When** the student presses Test connection,
   **Then** the result says "key rejected", distinct from "address unreachable", "model not
   found" and "does not look like this style", and saved data is unchanged.
6. **Given** a local server that is not running, **When** the student tests it, **Then** the
   result says the address is unreachable with a hint on starting a local server (the same kind
   of hint used for transcription).
7. **Given** an endpoint without a model list, **When** the student types a model identifier and
   tests, **Then** the app sends a minimal request to that model and reports the result.
8. **Given** a refreshed model list, **When** the student views a model, **Then** its capability
   switches start from the style's defaults (OpenAI-compatible: Images; Anthropic: Images and
   PDFs; Google Gemini: Images, PDFs and Audio) and can be changed; a model can be hidden or
   removed.
9. **Given** a saved endpoint with a key, **When** the student views it, **Then** the key is
   masked (at most the last 4 characters; none for keys shorter than 8), can be replaced or
   removed, and the change can be undone until Save.
10. **Given** an endpoint used by existing chats, **When** the student deletes it and confirms,
    **Then** those chats keep their history and show the model name as text.

---

### User Story 2 - The session panel: Recordings and Chat with a rail (Priority: P1)

In a session or event workspace, the right card becomes the session panel with two sections
stacked vertically: Recordings on top (everything the audio card does today) and Chat below.
Each section can collapse to its header; the boundary between them can be dragged or moved by
keyboard. The panel can be closed to a narrow rail on the right edge that reopens it, with an
icon per section and activity indicators.

**Why this priority**: The chat needs a home in the workspace, and this replaces the audio card's
current close behavior.

**Independent Test**: Open a session workspace, collapse and expand each section, drag and
keyboard-move the boundary, resize the panel, close it to the rail, start a recording and close
the panel, check the rail indicator, reopen through the Chat icon, reload and confirm the layout
is remembered.

**Acceptance Scenarios**:

1. **Given** a session workspace, **When** it opens, **Then** the right panel shows Recordings
   above Chat, each with its own header, and the panel's close button sits in the Recordings
   header.
2. **Given** both sections expanded, **When** the student collapses Chat, **Then** Chat shrinks to
   its header and Recordings fills the rest of the panel, and vice versa.
3. **Given** the boundary between the sections has keyboard focus, **When** the student presses
   the arrow keys, **Then** the boundary moves; dragging it with the pointer does the same.
4. **Given** the panel is open, **When** the student closes it by button or keyboard shortcut,
   **Then** it becomes a rail of about 44 px on the right edge, styled like the left card's rail,
   with a reopen button, a Recordings icon and a Chat icon.
5. **Given** the rail, **When** the student activates the Chat icon, **Then** the panel reopens
   with Chat expanded; the Recordings icon reopens it with Recordings expanded.
6. **Given** a recording or transcription in progress, **When** the panel is closed, **Then** the
   recording or transcription continues and the rail's Recordings icon shows an indicator that
   does not rely on color alone.
7. **Given** an answer is being generated or a finished answer has not been seen, **When** the
   panel is closed, **Then** the rail's Chat icon shows an indicator (shape or text, not color
   alone).
8. **Given** the panel, **When** the student resizes it by pointer or keyboard, **Then** its width
   stays between 300 px and 640 px, never more than half the window, and the main card never
   becomes narrower than 480 px.
9. **Given** the student changed open/closed state, width, section heights and collapsed
   sections, **When** they reload the app in the same browser, **Then** the panel returns as they
   left it.
10. **Given** a window narrower than 1100 px, **When** a workspace opens, **Then** the panel starts
    closed.
11. **Given** focus mode with a recording, transcription or answer in progress, **When** the panel
    and rail are hidden, **Then** the in-progress indicators remain visible.

---

### User Story 3 - Ask a question and get a streaming answer (Priority: P1)

A student types a question in the Chat section's message box and presses Enter. The answer
streams in as Markdown, showing which endpoint and model produced it. The student can stop it,
copy it, regenerate it, and switch models. Errors are shown in plain language and nothing typed
is lost.

**Why this priority**: This is the core value of the feature.

**Independent Test**: With one local and one remote endpoint configured, ask a question in a
session, watch it stream, stop a second answer mid-way, regenerate it, switch model mid-chat,
and trigger a rejected-key error; confirm the message can be retried and no text is lost.

**Acceptance Scenarios**:

1. **Given** no endpoint or model is configured, **When** the student opens the Chat section,
   **Then** it explains how to set one up with a button that opens Settings → AI, and the message
   box is disabled.
2. **Given** a configured model, **When** the student types and presses Enter, **Then** the
   message is sent; Shift+Enter inserts a new line; Enter during text composition (e.g. Chinese
   or Japanese input) does not send; an empty message cannot be sent.
3. **Given** a message was sent, **When** the answer has not started, **Then** a progress
   indicator is shown; **When** text arrives, **Then** it appears progressively for all three
   styles.
4. **Given** an answer is streaming and the student scrolls up, **When** more text arrives,
   **Then** the view stays where the student is and a "Jump to latest" control appears.
5. **Given** an answer is streaming, **When** the student presses Stop (which replaced Send in the
   same place) or Escape in the message box, **Then** the request is interrupted at once and
   cancelled at the provider, no further text arrives, the partial answer is kept and marked
   "Stopped", and focus returns to the message box.
6. **Given** an answer is streaming, **When** the student types in the message box, **Then** the
   draft is kept but cannot be sent until the answer ends.
7. **Given** the app is closed during an answer, **When** it is reopened, **Then** the partial
   answer is present and marked "Interrupted".
8. **Given** an answer, **When** it is complete, **Then** it is rendered as sanitized Markdown
   (headings, lists, tables, code blocks with language and a Copy button), links open in the
   default browser, remote images are not loaded automatically, and the answer can be copied and
   regenerated; regenerating keeps the earlier answer as version 1/2, switchable with "‹ ›"
   controls, and the version shown is used as context for later messages.
9. **Given** the model button, **When** the student opens it, **Then** models are grouped by
   endpoint with capability icons and a Local/Remote marker, with a search box when the list is
   long; the choice is remembered per chat and new chats start with the last model used.
10. **Given** a chat in progress, **When** the student switches to a model of another style,
    **Then** the next message sends the conversation to the new model in its own style; if
    attachments in context are not accepted by the new model, the student is told which and can
    remove them.
11. **Given** a provider error (network failure, rejected key, rate limit, model not found,
    request too large, or the provider's own message), **When** it occurs, **Then** a plain-
    language explanation appears next to the message (with a link to Settings for a rejected key
    and the wait time for a rate limit when given), and the message with its attachments can be
    retried.
12. **Given** a Remote endpoint used for the first time, **When** the student sends a message,
    **Then** a notice says messages and attachments go to that provider's address, which the
    student chose; it is acknowledged once per endpoint.

---

### User Story 4 - Chat history per session (Priority: P1)

Each session and event keeps its own chats. The Chat section has a History view (the session's
chats, newest first) and a Conversation view (one chat's messages). The student can start new
chats, return to old ones, rename and delete them, and search titles.

**Why this priority**: Students return to sessions to review; their conversations must stay with
the session they belong to.

**Independent Test**: In session A, create three chats; in session B, one chat. Rename, delete
and undo, search titles, run two answers in parallel in different chats, reopen the app and
check that each session shows only its own chats with their drafts.

**Acceptance Scenarios**:

1. **Given** a session with no chats, **When** the Chat section opens, **Then** it shows the
   History view with an empty list and the message box at the bottom; sending a message there
   starts a new chat and switches to the Conversation view.
2. **Given** a session with more than five chats, **When** the History view shows, **Then** the
   five newest appear, each with its shortened title (full title on hover and keyboard focus) and
   its age ("2 days ago", exact date on hover), and a "More" row with the count of older chats
   expands the rest.
3. **Given** a chat generating an answer, **When** it appears in the list, **Then** it shows a
   generating marker; a chat open in a tab shows "Open in tab".
4. **Given** the History view, **When** the student types in its search box, **Then** the list is
   filtered by title.
5. **Given** a chat's menu, **When** the student renames or deletes the chat (by keyboard or
   pointer), **Then** the change applies; deletion offers Undo for at least 10 seconds.
6. **Given** a Conversation view with an answer in progress, **When** the student presses Back to
   history or "+", **Then** the History view shows, the answer continues and is saved, and the
   next message sent from History starts a new chat.
7. **Given** two chats in one session, **When** the student sends messages in both, **Then** both
   may generate at the same time.
8. **Given** a new chat, **When** its first message is sent, **Then** its title is the first 60
   characters of that message, with no extra AI request; an empty chat is never saved.
9. **Given** a draft in a chat and one in the new-chat box, **When** the student switches views,
   tabs, sessions or restarts the app, **Then** both drafts are still there.
10. **Given** a session with chats, **When** the student deletes the session (or its course or
    semester), **Then** the confirmation names its chats; **When** the session is moved in the
    calendar, **Then** its chats move with it.
11. **Given** chats in a session, **When** the student browses the session's folder outside the
    app, **Then** each chat is a JSON file plus a readable Markdown transcript holding the
    conversation text, attachment references, model names and times, and no key.

---

### User Story 5 - Expand a chat into a tab and dock it back (Priority: P1)

The student wants more room: "Expand" moves the current chat into a tab in the workspace's tab
row (which can be split beside a note or PDF) and closes the panel to its rail. "Dock" in the tab
moves it back into the panel.

**Why this priority**: Long answers and side-by-side reading with notes are a main use; it is
the VS Code behavior the student asked for.

**Independent Test**: Start an answer, Expand mid-stream, split the tab beside a note, Dock it
back mid-stream; confirm the answer, draft, scroll position and attachments survive each move
and focus lands in the message box.

**Acceptance Scenarios**:

1. **Given** a chat in the panel, **When** the student presses Expand, **Then** the panel closes
   to its rail, the same chat opens in a tab with a comfortable reading width, and focus moves to
   its message box.
2. **Given** a new empty chat in the panel, **When** the student presses Expand, **Then** an empty
   chat opens in a tab.
3. **Given** a chat in a tab, **When** the student looks at the panel's History view, **Then** the
   chat shows "Open in tab" and choosing it switches to that tab; the panel never shows it at the
   same time.
4. **Given** a chat tab, **When** the student presses Dock, **Then** the tab closes and the chat
   shows in the panel, reopening the panel if needed, with focus in its message box.
5. **Given** an answer in progress, **When** the chat is expanded, docked, or its tab is closed,
   **Then** the answer continues uninterrupted and is saved; the draft, scroll position and
   attachments are kept; a closed tab's chat returns to the history list.
6. **Given** a chat tab, **When** the student splits it beside a note or PDF, **Then** it behaves
   like any other tab.

---

### User Story 6 - Attach notes as context (Priority: P1)

The student attaches the open note, another note of this session, or a note from another session
or course. Attached notes are sent as text with their titles and appear as removable chips.

**Why this priority**: Asking about one's own lecture notes is the main reason to have a chat in
the session.

**Independent Test**: Attach the open note via the quick action and a note from another course
via the browser, ask a question, then edit the note and confirm the sent message used the
snapshot taken at send time.

**Acceptance Scenarios**:

1. **Given** the attach menu, **When** the student chooses Notes, **Then** a picker shows this
   session's notes, a quick "attach the open note" action, and a way to browse other sessions
   and courses.
2. **Given** attached notes, **When** they appear above the text area, **Then** each is a chip
   with its title that can be removed by keyboard or pointer.
3. **Given** a note attached to a sent message, **When** the note is later edited, **Then** the
   sent message still reflects the note as it was at send time.
4. **Given** a note still in context after it was edited, **When** the student sends the next
   message, **Then** that message carries a fresh snapshot with the edits, and each message in
   history shows the snapshot it used.

---

### User Story 7 - Keys are protected at rest (Priority: P1)

All endpoint keys and the existing transcription provider keys live in one shared secret store,
encrypted with authenticated, quantum-resistant encryption whose key is held by the operating
system's key store. Existing transcription keys move into it automatically.

**Why this priority**: The feature introduces several new cloud keys; their leak would be
costly to students.

**Independent Test**: Save an endpoint key and a transcription key, copy the database and data
folder to another location, and confirm no key can be read from the copy; upgrade an existing
installation with a saved transcription key and confirm transcription still works.

**Acceptance Scenarios**:

1. **Given** an existing installation with saved transcription keys, **When** the app updates,
   **Then** the keys are migrated into the shared store without loss and transcription keeps
   working; if migration fails, nothing is changed and the app says so.
2. **Given** a copy of the database or a backup alone, **When** someone inspects it, **Then** no
   key can be recovered from it.
3. **Given** a machine without an operating-system key store, **When** the student saves a key,
   **Then** it still works, its encryption key is kept in a user-only file outside the data
   folder, and Settings says so and warns that anyone with access to the user account can read
   the keys.
4. **Given** the key store was lost or the data was restored on another machine, **When** the app
   cannot decrypt a key, **Then** it says so and asks for the key again; no other data is
   affected.

---

### User Story 8 - Attach pictures, PDFs and audio (Priority: P2)

The attach menu gains Pictures (from the device, paste or drop), PDFs (a session document or an
upload) and Audio (a session recording or an upload), each sent only to models that accept it.

**Why this priority**: Valuable for slides, scans and lecture audio, but chat with notes already
delivers the core value.

**Independent Test**: Paste a screenshot, attach a session PDF to an Anthropic model, attach the
same PDF to a model without PDF support and accept the text fallback, attach a recording to a
Gemini model, and try audio on a model without audio support.

**Acceptance Scenarios**:

1. **Given** the message box, **When** the student pastes or drops a PNG, JPEG, WebP or GIF, or
   picks one from the device, **Then** it appears as a chip with a thumbnail.
2. **Given** a PDF and a model that accepts PDFs, **When** the message is sent, **Then** the PDF is
   sent as a document; **Given** a model that does not, **Then** the app offers to send its
   extracted text instead, and says clearly when the PDF has no text (e.g. a scan).
3. **Given** a model not marked as accepting audio, **When** the student opens the attach menu,
   **Then** Audio is disabled with the reason and a pointer to Transcribe.
4. **Given** audio or a file beyond the model's or provider's limits, **When** the student attaches
   it, **Then** it is refused with a clear message (for audio, a suggestion to transcribe first);
   nothing is truncated or dropped silently.
5. **Given** an eleventh attachment for one message, **When** the student adds it, **Then** it is
   refused because at most 10 are allowed.
6. **Given** a chat in history with attachments, **When** a referenced note, session PDF or
   recording has since been deleted, **Then** its chip says it is no longer available; uploaded
   pictures, audio and PDFs remain available from the session's chat folder.

---

### User Story 9 - See and manage what is in context (Priority: P2)

A context list shows everything included in the chat's context with a size estimate against the
model's limit when known, and lets the student remove items.

**Why this priority**: Prevents surprises with large attachments and limits, after the basics
work.

**Independent Test**: Attach two notes and a PDF, open the context list, check the estimate,
remove one item, then keep adding until the limit warning appears and choose "start a new chat".

**Acceptance Scenarios**:

1. **Given** attachments in a chat, **When** later messages are sent, **Then** the items stay in
   context until removed.
2. **Given** the context list, **When** the student opens it, **Then** each item shows with a
   remove button and the total size estimate compared with the model's limit when known.
3. **Given** a conversation that would exceed the model's limit, **When** the student sends,
   **Then** they are told and offered to remove items or start a new chat.
4. **Given** the chosen style, **When** the student is about to send, **Then** the per-file and
   per-message limits of that style are visible.

---

### User Story 10 - Extras (Priority: P3)

The student appends an answer to a note, edits and resends the last message, sets custom
instructions, sees token usage, and searches chat text in a session.

**Why this priority**: Conveniences on top of a complete chat.

**Independent Test**: Add an answer to an existing note and to a new note, edit and resend the
last message, set custom instructions and observe their effect, check usage on a provider that
reports it, and search for a word that appears only inside a message.

**Acceptance Scenarios**:

1. **Given** an answer, **When** the student chooses Add to note and picks a note (or a new one),
   **Then** the answer is appended after the note's last character under a heading naming the
   chat and date, never overwriting.
2. **Given** the last user message, **When** the student edits and resends it, **Then** a new
   answer is produced for the edited message, and the original message with its answer stays
   available as version 1 through "‹ n/m ›" controls.
3. **Given** custom instructions in Settings → AI, **When** any chat sends a message, **Then** the
   instructions are sent as the system instruction.
4. **Given** a provider that reports token usage, **When** an answer completes, **Then** its usage
   is shown.
5. **Given** a session's chats, **When** the student searches for text, **Then** chats whose
   messages contain it are found, not only by title.

---

### Edge Cases

- Chat is opened in an upcoming session: chat is allowed.
- The endpoint used by a chat is disabled or deleted: the chat stays readable, shows the model
  name as text, and asks for another model before the next message.
- A model is hidden or removed while a chat uses it: same as above.
- Two answers stream in different chats while the student records audio: none slows or
  interrupts the others or the recording.
- The panel is closed, or the chat tab closed, during an answer: the answer finishes and is
  saved; the rail shows the unseen-answer indicator.
- The app closes during an answer: the partial answer is saved marked "Interrupted".
- Saving a message fails (disk full, folder locked): the failure is shown, the save is retried,
  and the message is kept until saved.
- The session folder is renamed or moved by the calendar while a chat is open: the chat follows.
- A note attached by reference is deleted or renamed after sending: the history chip says it is
  no longer available (or shows the new title); the snapshot already sent is unchanged.
- A PDF has no text layer and the model does not accept PDFs: the app says so and does not send
  an empty document.
- A pasted URL contains the style's path and a query string: the path is removed and the student
  is told; a URL that cannot be understood is rejected with a message.
- An address like `http://192.168.1.10:8080/v1` is Local; `http://example.com/v1` is Remote and
  refused over http with a key.
- A provider responds in another style's format: Test connection reports "does not look like
  this style".
- The provider returns a rate limit without a wait time: the message says so without a time.
- The provider's stream ends without a completion signal: the answer is kept and marked as
  incomplete with the option to regenerate.
- The student goes offline: local endpoints keep working; remote ones show a network error.
- A very long first message: the title takes the first 60 characters; the full title is still
  available on hover and focus.
- A chat of 1,000 messages: scrolling and typing remain smooth.
- The key store is unavailable at start-up: keys that cannot be decrypted are reported, chats and
  other data remain usable with local endpoints that need no key.
- Window resized so the panel would exceed half the window or squeeze the main card under 480 px:
  the panel narrows; if it cannot fit at 300 px it closes to its rail.

## Requirements *(mandatory)*

### Functional Requirements — Part A: The Session Panel

- **FR-001**: In session and event workspaces, the right card MUST be a session panel with two
  vertically stacked sections: Recordings (all current audio card behavior, unchanged) on top and
  Chat below, each with its own header row.
- **FR-002**: Each section MUST collapse to its header and expand again; when one is collapsed the
  other MUST fill the panel.
- **FR-003**: The boundary between the sections MUST be movable by pointer drag and by keyboard
  (focusable, arrow keys), with an accessible name and value.
- **FR-004**: The panel's close button MUST be in the Recordings header; the panel MUST also close
  and reopen by a keyboard shortcut.
- **FR-005**: A closed panel MUST leave a rail about 44 px wide on the right edge, styled like the
  left card's rail, with a reopen button, a Recordings icon and a Chat icon; each icon MUST reopen
  the panel with that section expanded. This replaces the former reopen button in the tab row.
- **FR-006**: The Recordings icon MUST show an indicator while a recording or transcription is in
  progress; the Chat icon MUST show one while an answer is generated and when a finished answer
  has not been seen. Indicators MUST NOT rely on color alone and MUST be exposed to assistive
  technology.
- **FR-007**: Closing the panel MUST NOT interrupt a recording, transcription or answer in
  progress.
- **FR-008**: The panel MUST default to about 360 px wide and be resizable by pointer and keyboard
  between 300 px and 640 px, never more than half the window, keeping the main card at least
  480 px wide.
- **FR-009**: Open/closed state, width, section heights and collapsed sections MUST be remembered
  per browser.
- **FR-010**: Below 1100 px window width the panel MUST start closed, as the side cards do.
- **FR-011**: Focus mode MUST keep the recording, transcription and answer-in-progress indicators
  visible while the panel and rail are hidden.

### Functional Requirements — Part B: Endpoints in Settings

- **FR-012**: The app MUST ship with no AI endpoint, no key and no default address.
- **FR-013**: Settings MUST have an "AI" section listing endpoints, with add, edit, enable,
  disable and delete.
- **FR-014**: An endpoint MUST have a name (required), a style (OpenAI-compatible, Anthropic or
  Google Gemini), a base URL (required), an optional API key, and its models.
- **FR-015**: The base URL MUST be entered as the provider documents it; the app MUST add each
  style's path, ignore a trailing slash, and remove a pasted path that already contains the
  style's request path, telling the student it did so.
- **FR-016**: Addresses on this computer or the private network MUST be labeled "Local" and MAY
  use plain http; any other address MUST be labeled "Remote" and MUST use https. A key MUST never
  be sent over plain http to a Remote address.
- **FR-017**: Test connection MUST list the models, or, without a model list, send a minimal
  request to a typed model; it MUST distinguish working, key rejected, model not found, address
  unreachable (with a local-server hint as used for transcription) and "does not look like this
  style", and MUST NOT change saved data.
- **FR-018**: Models MUST be fetched with a Refresh action or added by typing the exact
  identifier; each MUST have a display name and Images, PDF documents and Audio switches with the
  style's defaults (OpenAI-compatible: Images; Anthropic: Images and PDFs; Google Gemini: Images,
  PDFs and Audio), editable by the student; a model MUST be hideable and removable.
- **FR-019**: Keys MUST be shown masked (at most the last 4 characters; none for keys shorter
  than 8), never returned in full, and never written to logs, error messages, chat files or
  exports; a key MUST be replaceable and removable with Undo until Save.
- **FR-020**: Deleting an endpoint MUST ask for confirmation; chats that used it MUST keep their
  history and show the model name as text.
- **FR-021**: Requests to each style MUST follow that style's conventions as listed in "Provider
  request styles" below; these MUST be confirmed against each provider's current documentation
  during planning, and where the documentation differs it wins while the behavior in this spec
  stays the same.

### Functional Requirements — Part C: The Chat Section

- **FR-022**: Without a configured endpoint and model, the Chat section MUST explain how to set
  one up, offer a button opening Settings → AI, and disable the message box.
- **FR-023**: Chat MUST be available in past, current and upcoming sessions and in events.
- **FR-024**: The Chat section header MUST show the title "Chat", a search icon, a "+" (new chat)
  button and an "Expand" button, following the visual reference.
- **FR-025**: The History view MUST list the session's chats newest first with shortened title
  (full title on hover and keyboard focus), relative age (exact date on hover), a generating
  marker and an "Open in tab" marker; it MUST show the five newest and a "More" row with the
  count of older chats; a search box MUST filter by title.
- **FR-026**: Each chat MUST have a keyboard-accessible menu with Rename and Delete; deletion MUST
  offer Undo for at least 10 seconds.
- **FR-027**: The Conversation view MUST show the chat's messages scrolling above the message box,
  with a header holding Back to history, the chat title, "+" and "Expand".
- **FR-028**: A new chat MUST start empty in the History view and MUST NOT be saved while empty;
  sending its first message MUST switch to the Conversation view; Back to history and "+" MUST
  return to History without stopping an answer; the next message from History MUST start a new
  chat. Several chats MAY generate at the same time.
- **FR-029**: A chat's title MUST be the first 60 characters of its first message, without an AI
  request, and MUST be renameable.
- **FR-030**: The message box MUST show attachment chips on top, a multi-line text area
  (placeholder "Ask about this session…") growing to about eight lines then scrolling, and a
  toolbar with an attach button ("+"), the model button and, on the right, Send.
- **FR-031**: Enter MUST send, Shift+Enter MUST insert a new line, Enter during text composition
  MUST NOT send, and an empty message MUST NOT be sendable.
- **FR-032**: The draft of each chat and of the new-chat box MUST persist across views, tabs,
  sessions and restarts.
- **FR-033**: User messages MUST display as plain text; answers MUST render as sanitized Markdown
  (headings, lists, tables, code blocks with language label and Copy), links MUST open in the
  default browser, and remote images in answers MUST NOT load automatically.
- **FR-034**: Each answer MUST show its endpoint and model, and MUST offer Copy and Regenerate.
  Regenerate MUST keep earlier answers as versions of the same answer, switchable with
  "‹ n/m ›" controls (keyboard accessible); the version shown MUST be the one used as context
  for later messages, and all versions MUST be saved in the chat's history.
- **FR-035**: Answers MUST stream as received for all three styles, with a progress indicator
  before the first text; the view MUST follow new text unless the student scrolled up, in which
  case a "Jump to latest" control MUST appear.
- **FR-036**: While an answer is generated, Send MUST become Stop (a square) in the same place;
  Stop or Escape in the message box MUST interrupt the request immediately and cancel it at the
  provider so no more text arrives; the partial answer MUST be kept and marked "Stopped" and the
  box made ready again. The draft MUST be editable but not sendable during generation.
- **FR-037**: If the app closes during an answer, the partial answer MUST be saved and marked
  "Interrupted".
- **FR-038**: The model button MUST show the current model and a Local/Remote marker and open a
  list grouped by endpoint with capability icons and, when long, a search box. The choice MUST be
  remembered per chat; new chats MUST start with the last model used. Changing the model
  mid-chat MUST send the conversation to the new model in its own style and MUST tell the student
  which attachments in context the new model does not accept, letting them remove them.
- **FR-039**: Network failure, rejected key (with a link to Settings), rate limit (with wait time
  when given), model not found, request too large and the provider's own message MUST be shown in
  plain language next to the message; the message and its attachments MUST remain retryable and
  nothing MUST be lost silently.
- **FR-040**: The first use of a Remote endpoint in a chat MUST show a notice that messages and
  attachments are sent to that provider's address chosen by the student, acknowledged once per
  endpoint; the Local/Remote marker MUST always be visible.
- **FR-041**: The assistant MUST have no tools: it MUST NOT change notes, files, tasks or settings
  by itself.

### Functional Requirements — Part D: Expand and Dock

- **FR-042**: "Expand" MUST close the panel to its rail and open the current chat (or a new empty
  chat) in a tab of the workspace's tab row, which MUST be splittable like any tab.
- **FR-043**: A chat tab MUST offer the same History and Conversation views at a comfortable
  reading width, and a "Dock" button that closes the tab and shows the chat in the panel,
  reopening the panel if closed.
- **FR-044**: A chat MUST be shown in only one place at a time; while in a tab, its history entry
  in the panel MUST say "Open in tab" and choosing it MUST switch to the tab; a panel chat MUST
  only move to a tab via Expand.
- **FR-045**: Moving a chat between panel and tab, or closing its tab, MUST NOT interrupt an answer
  in progress and MUST keep its draft, scroll position and attachments; a closed tab's chat MUST
  return to the history list and its answer MUST finish and be saved.

### Functional Requirements — Part E: Notes as Attachments and History Storage

- **FR-046**: The attach menu MUST offer Notes: a picker of the session's notes, browsing of other
  sessions' and courses' notes, and a quick "attach the open note".
- **FR-047**: Attached notes MUST be sent as text with their titles and shown as removable chips.
  Every message sent while a note is in context MUST take a fresh snapshot of that note at send
  time, and the chat history MUST record the snapshot each message used.
- **FR-048**: Each session and event MUST have its own chats, never shared or mixed with another's.
- **FR-049**: Chats MUST be stored as readable files in the session's (or event's) own folder,
  alongside notes, recordings and documents, holding conversation text, attachment references,
  model names and times, and never keys. Each chat MUST be a JSON file (the app's source of
  truth, including answer versions, statuses and note snapshots) plus a matching Markdown
  transcript the app regenerates after each change for reading outside the app. If the
  transcript is edited or deleted outside the app, the app MUST rebuild it from the JSON file
  without loss.
- **FR-050**: Messages MUST be saved as they complete; a failed save MUST be shown and retried and
  no message MUST be lost.
- **FR-051**: Deleting a session or event, or a course or semester containing it, MUST name its
  chats in the confirmation; moving a session or event in the calendar MUST move its chats.

### Functional Requirements — Part F: Pictures, PDFs, Audio and Context (Priority 2)

- **FR-052**: The attach menu MUST offer Pictures (device, clipboard paste, drop on the message
  box; PNG, JPEG, WebP, GIF; thumbnails on chips), PDFs (a session document or a device upload)
  and Audio (a session recording or a device upload).
- **FR-053**: PDFs MUST be sent as documents to models that accept them; otherwise the app MUST
  offer to send the extracted text and MUST say clearly when a PDF has no text.
- **FR-054**: Audio MUST be available only for models marked as accepting it; otherwise the option
  MUST be disabled with the reason and a pointer to Transcribe. Audio beyond the model's or
  provider's limits MUST be refused with a suggestion to transcribe it first.
- **FR-055**: The app MUST show the chosen style's per-file and per-message limits before sending,
  allow at most 10 attachments per message, refuse oversized content with a clear message, and
  never truncate or drop content silently.
- **FR-056**: A context list MUST show every item in the chat's context with a remove button and a
  size estimate compared with the model's limit when known; items MUST stay in context until
  removed; when the conversation would exceed the limit the student MUST be told and offered to
  remove items or start a new chat.
- **FR-057**: In history, attachments MUST show as chips; notes, session PDFs and recordings MUST
  be stored as references; device uploads MUST be stored in the session's chat folder; a chip for
  a deleted referenced item MUST say it is no longer available.

### Functional Requirements — Part G: Extras (Priority 3)

- **FR-058**: An answer MUST be appendable to a chosen note or a new one, after the note's last
  character, under a heading naming the chat and date, never overwriting.
- **FR-059**: The last user message MUST be editable and resendable. The original message and
  its answer MUST be kept as version 1, and the edited message with its new answer becomes the
  next version, switchable with "‹ n/m ›" controls on the user message; the version shown MUST
  be the one used as context for later messages.
- **FR-060**: Settings → AI MUST accept custom instructions sent as the system instruction.
- **FR-061**: Token usage MUST be shown when the provider reports it.
- **FR-062**: The student MUST be able to search the text of a session's chats.

### Functional Requirements — Part H: Secrets at Rest

- **FR-063**: All endpoint keys and existing transcription provider keys MUST be kept in one
  shared secret store.
- **FR-064**: Keys MUST be encrypted before reaching the database with authenticated encryption of
  256-bit symmetric strength; any public-key step MUST use a post-quantum scheme. A copy of the
  database or a backup alone MUST reveal no key.
- **FR-065**: The encryption key MUST NOT be stored in the database or the data folder; it MUST be
  held by the operating system's key store when available. When none is available, the
  encryption key MUST be kept in a file readable only by the current user, in the app's per-user
  config folder outside the data folder (so a copy of the data folder or a backup still reveals
  no key), and Settings MUST say so and state in plain words that anyone with access to the user
  account can read the keys.
- **FR-066**: Keys MUST be decrypted only in the backend at the moment of use, never sent to the
  frontend, and never logged.
- **FR-067**: Saved transcription keys MUST migrate automatically without loss; a failed migration
  MUST change nothing and be reported.
- **FR-068**: If keys cannot be decrypted (key store lost, data restored elsewhere), the app MUST
  say so and ask for them again, without affecting any other data.

### Functional Requirements — Part I: Everywhere

- **FR-069**: Everything MUST work by keyboard and pointer in light, dark and custom themes.
- **FR-070**: Screen readers MUST be told when an answer starts and when it completes, not for
  each piece of text.
- **FR-071**: Stop, Expand, Dock, "+", the attach and model buttons and every icon button MUST
  have accessible names; focus MUST return to the message box after Stop, Expand and Dock.
- **FR-072**: New shortcuts (toggle the panel, focus the message box, new chat) MUST NOT conflict
  with browser, editor or existing app shortcuts.
- **FR-073**: Animations MUST be skipped when the user prefers reduced motion.
- **FR-074**: Chat MUST work with Local endpoints without an internet connection.
- **FR-075**: Existing features — recordings, transcription with its own providers, and workspace
  tabs — MUST behave as before.

### Provider Request Styles

These are the external conventions the student's endpoints follow; they are interface
requirements given by the user, to be confirmed against current provider documentation during
planning (FR-021).

| | OpenAI-compatible | Anthropic | Google Gemini |
|---|---|---|---|
| Base URL example | `https://api.openai.com/v1`, `http://localhost:11434/v1` | `https://api.anthropic.com` | `https://generativelanguage.googleapis.com` |
| Chat request | `{base}/chat/completions` | `{base}/v1/messages` | `{base}/v1beta/models/{model}:streamGenerateContent?alt=sse` |
| Model list | `{base}/models` | `{base}/v1/models` | `{base}/v1beta/models` |
| Key | `Authorization: Bearer`, omitted without a key | `x-api-key` plus `anthropic-version` | `x-goog-api-key` |
| Body | model, messages (system/user/assistant), stream: true | model, required max_tokens, top-level system, alternating user/assistant content blocks, stream: true | contents (user/model with parts), system_instruction, generation settings |
| Stream | `data:` JSON lines, first choice text delta, ends with `data: [DONE]` | events message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop, ping, error | `data:` JSON lines, first candidate's content parts text |
| Pictures | image_url parts with base64 data URL | image blocks, base64 source and media type | inline data parts (mime type, base64) |
| PDFs | file parts with file name and base64 data | document blocks, base64 source and media type | inline data parts |
| Audio | input_audio parts with base64 data and format | not accepted | inline data parts |
| Size | per provider | per provider | inline data up to the request size limit; larger files refused with a clear message |

### Key Entities

- **AI Endpoint**: a student-configured service: name, style, base URL, Local/Remote
  classification, enabled flag, reference to its key in the secret store, its models, and whether
  the Remote privacy notice was acknowledged.
- **Model**: belongs to an endpoint: exact identifier, display name, capabilities (Images, PDF
  documents, Audio), hidden flag, and known context limit when available.
- **Secret**: an encrypted key in the shared secret store, owned by an AI endpoint or a
  transcription provider; only a masked form is ever shown.
- **Chat**: belongs to exactly one session or event: title, created and updated times, chosen
  model, context items, draft, and its messages; stored in the session's folder as a JSON file
  (source of truth) with a regenerated Markdown transcript.
- **Message**: a user message or an assistant answer: text, time, attachments, and for answers
  the endpoint and model names, status (complete, stopped, interrupted, failed), and usage when
  reported. An answer MAY have several versions (from Regenerate), and the last user message MAY have
  several versions (from edit and resend), each with its own answers; one version is selected.
- **Attachment / Context Item**: a note snapshot (with reference), a session PDF or recording
  (reference), or an uploaded picture, PDF or audio file (stored in the session's chat folder),
  with availability status.
- **Panel Layout Preference**: per browser: open/closed, width, section heights, collapsed
  sections.
- **AI Settings**: custom instructions and the last model used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student with a running local server can add it, test it and get a first answer
  in under 3 minutes without documentation.
- **SC-002**: The first text of an answer appears within 1 second of the provider sending it, and
  streamed text is visible as it arrives for all three styles.
- **SC-003**: After Stop, no further text appears and the message box is ready within 0.5 seconds.
- **SC-004**: In 100% of tested cases, chats appear only in the session or event they were
  created in, and survive restart, calendar moves and Expand/Dock without loss of messages,
  drafts or attachments.
- **SC-005**: No full key appears in any API response, log, error message, chat file, export,
  database copy or backup in automated checks.
- **SC-006**: Existing transcription keys migrate without loss in 100% of upgrade tests;
  transcription works afterwards without re-entering keys.
- **SC-007**: A chat of 1,000 messages scrolls and accepts typing without visible lag, and two
  simultaneous streams do not delay typing in a note or a running recording.
- **SC-008**: All new controls are reachable and operable by keyboard alone, have accessible
  names, and meet AA contrast in light and dark themes.
- **SC-009**: Every provider error category in FR-039 produces a distinct plain-language message,
  and in 100% of error cases the student's message and attachments remain retryable.
- **SC-010**: Existing recording, transcription and tab tests continue to pass unchanged.
- **SC-011**: With no internet connection, a chat using a Local endpoint works end to end.

## Assumptions

- The visual reference `design/reference/vscode-chat-sessions.png` is not present in the
  repository yet; it must be added before design work in planning. The spec's written
  description of the History list and message box stands on its own.
- Storing chats in the session folder adds a chat folder next to `notes/`, `audios/` and
  `documents/`. Constitution Principle II lists those three folders, so planning should either
  confirm the chat folder fits the principle or amend it via `/speckit-constitution`; the same
  applies to Principle IV, which today speaks of transcription keys only and is extended here to
  all AI keys.
- "Local" means loopback addresses, private network ranges and link-local addresses, and
  `localhost`-style host names; everything else is Remote.
- Below 1100 px the panel starts closed to its rail (the rail replaces the former tab-row
  button); if the window is too narrow for the rail, the workspace follows the left card's
  narrow-window behavior from Feature 008.
- The unseen-answer indicator clears when the student views the chat that finished.
- Drafts and chat files are stored server-side with the session's data; panel layout is stored
  per browser.
- Size limits per style come from current provider documentation confirmed in planning; where a
  model's context limit is unknown, the context list shows the size without a comparison.
- The operating-system key store is used through the backend; the app runs as a single-user
  local application, as today.
- Out of scope: tools or actions by the AI, web search, image generation, voice input or
  conversation, queued follow-up messages during generation, sharing or syncing chats, multiple
  users, chat outside session and event workspaces, cost tracking, automatic model selection, and
  changes to how transcription providers are configured (only how their keys are stored changes).
