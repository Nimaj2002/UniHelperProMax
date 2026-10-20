# Contract: UI (session panel, rail, chat, tabs, settings)

These are the names, roles, shortcuts and behaviours the tests rely on. Visual detail follows
the reference image `design/reference/vscode-chat-sessions.png`, which must be added to the repo
before UI work starts. All colours come from theme tokens.

## Session panel

- **Container**: `<aside aria-label="Session panel" id="workspace-session-panel">`. The id
  `RIGHT_CARD_ID` changes, and the e2e helper `audioCard` becomes `sessionPanel`.
- **Recordings section header**:
  - Contains `button "Collapse Recordings"` / `"Expand Recordings"` (`aria-expanded`), the
    existing recording header actions, and `button "Close session panel"` with
    `aria-keyshortcuts="Alt+BracketRight"`.
- **Chat section header**, in the History view:
  - The title "Chat".
  - `button "Search chats"`, which toggles a `searchbox "Search chats"`.
  - `button "New chat"` with `aria-keyshortcuts="Alt+Shift+KeyK"`.
  - `button "Expand chat into a tab"`.
  - `button "Collapse Chat"` / `"Expand Chat"`.
- **Boundary between the sections**:
  - `separator "Resize Recordings and Chat"` (`aria-orientation="horizontal"`, `aria-valuenow`
    = the Recordings share as a percentage).
  - Keys: ↑/↓ step 5%, Home/End, and Enter resets to 50/50.
  - Each section's minimum height is its header plus 120 px.
- **Panel width**:
  - The existing `PanelResizeHandle` on the left edge of the panel.
  - Range: `[300, min(640, innerWidth/2)]`, while the main card keeps at least 480 px.
  - Default 360 px; Enter or a double-click restores it.

## Rail

- **Container**: `<nav aria-label="Session panel rail">`, 44 px wide, on the right edge.
- **Buttons**, top to bottom:
  - `button "Show session panel"` (`aria-keyshortcuts="Alt+BracketRight"`).
  - `button "Recordings"`, with the suffix ", recording in progress" or ", transcription
    running" in its name.
  - `button "Chat"`, with the suffix ", answer being generated" or ", new answer".
- **Indicators**: each indicator is an icon badge **and** a shape: a pulsing dot for recording,
  a spinner for running, a filled dot for unseen.
  - Under reduced motion they don't animate, but they stay visible.
- **Hidden**: the rail is hidden in focus mode. The activity pills in the main card then carry
  the recording, transcription and "Answering…" indicators (FR-011).
- **Focus**: after the panel closes, focus moves to "Show session panel". After it opens, focus
  goes to the section header that was activated.

## Chat views

- **History view**:
  - `list "Chats"` with `listitem`s. Each item has:
    - a `button` named by the full title, with a visible title of at most 1 line and an ellipsis
    - `time` showing a relative age, with `title` = the full date
    - an optional "Generating" badge or "Open in tab" badge
    - `button "Chat actions"`, a menu with Rename and Delete
  - Five chats are shown, then `button "More (N)"`.
  - Delete shows a toast "Chat deleted" with an Undo action for 10 s.
- **Conversation view**:
  - Header: `button "Back to history"`, then the title as a heading (level 3), then "New chat"
    and "Expand chat into a tab".
  - The message list is `log "Conversation"` with `aria-live="off"`.
  - A separate visually hidden `status` region announces only "Answer started", "Answer
    complete", "Answer stopped" and "Answer failed: <category>" (FR-070).
- **Messages**:
  - Each user message is `article "You"`, showing plain text with whitespace kept. For the last
    message there is an "Edit and resend" button, and `‹ n/m ›` controls once it has versions.
  - Each answer is `article "Assistant"` and contains:
    - a footer with "<Endpoint> · <Model>" and a Local/Remote badge
    - its status label when not completed ("Stopped", "Interrupted", "Failed — <message>" with
      Retry)
    - Copy, Regenerate, "Add to note", and `‹ n/m ›` when it has versions
    - a usage line when known
  - In code blocks the language label sits at the top and `button "Copy code"` at the right.
- **Following new text**: the view follows new text while the user is within 48 px of the
  bottom. Otherwise `button "Jump to latest"` appears.

## Message box

- The box is always at the bottom of the Chat section or the chat tab.
- **Order**:
  1. `list "Attachments"` of chips. Each chip is `button "Remove <title>"`. Images show a
     thumbnail. A missing item says "No longer available".
  2. `textbox "Message"`, multi-line, with the placeholder "Ask about this session…". It grows
     to 8 lines and then scrolls.
  3. A toolbar: `button "Attach"` (a menu with Notes, Pictures, PDFs, Audio), then `button
     "Model: <name>, Local|Remote"`, then `button "Send"` or `button "Stop"` in the same place.
- **Keys**:
  - Enter sends unless `isComposing` or `keyCode === 229`. Shift+Enter inserts a new line.
  - Escape while generating stops.
  - Alt+K, anywhere in the workspace, focuses this box: it opens the panel, expands Chat, or
    focuses the chat tab.
- **Disabled states**:
  - Send is `aria-disabled` while the text is empty with no attachments, or while an answer is
    generating (typing is still allowed).
  - Audio in the Attach menu is `aria-disabled` with the reason "This model doesn't accept audio
    — use Transcribe on the recording".
  - With no model configured, the box is disabled and the empty state shows `button "Open AI
    settings"`.
- **Focus** returns to the textbox after Stop, Expand, Dock, sending, and closing the model or
  attach menus.

## Model picker

- A `Popover` with a `listbox "Models"`, grouped by endpoint (`group` named by the endpoint
  name, with a Local/Remote badge).
- Each option shows the display name and icons for Images, PDF and Audio (each with its own
  accessible name).
- A `searchbox "Search models"` appears when there are more than 8 models.
- If any context items aren't accepted by the selected model, a dialog lists them with Remove
  buttons.

## Context list

- `button "Context (N items, ~X tokens of Y)"` opens a popover listing each context item with
  `button "Remove <title>"`.
- When the context is over the limit, an `alert` reads "This conversation is larger than the
  model can take" with "Remove items" and "Start a new chat".

## Remote privacy notice

- An `AlertDialog`: "Messages and attachments will be sent to <host>, the address you set up for
  <endpoint>." with the buttons "Send" and "Cancel". It is shown once per endpoint.

## Chat tab

- **Tab**: `tab "<chat title or New chat>"` with a chat icon. It can be split like a note tab.
- **Content**: the same views as the panel, centred, max-width 72ch, plus `button "Dock chat to
  the panel"`.

## Settings → AI

- **Placement**: a nav entry "AI" after "Transcription".
- **Endpoint list**: one row per endpoint, with its name, style, Local/Remote, an enabled switch
  and the actions Edit and Delete. Delete opens a confirmation that names the endpoint and says
  "Chats that used it keep their history."
- **Form fields**:
  - Name.
  - Style, a radio group with the three styles.
  - Base URL, with an inline note when a path was removed and an error when https is required.
  - API key, shown masked with Replace and Remove, and "Undo" until Save.
  - Test connection, with a `status` result showing one of six outcomes and the hint.
  - Models, with Refresh, "Add model ID", and per model: display name, the switches Images, PDF
    documents and Audio (Audio disabled for Anthropic), Hide, and Remove.
  - Optional context limit.
- **Other fields**: custom instructions (a textarea limited to 8,000 characters), and a
  key-protection notice from `/secrets/status` that shows the weaker-protection sentence or the
  "keys can't be read" banner with "Start a new key store".
- **Transcription settings**: show the same key-protection notice.

## Shortcuts added

| Keys | Action | Checked against |
|---|---|---|
| Alt+] (existing) | Toggle the session panel | — |
| Alt+K | Focus the chat message box (opens the panel and Chat) | Chrome, Edge and Firefox (menu accelerators F/E/V/S/B/T/H); MDXEditor/Lexical; app Alt+N/W/[/]/\/PgUp/PgDn, Alt+Shift+N |
| Alt+Shift+K | New chat | as above |
| Escape (inside the message box) | Stop generating | Only while generating; otherwise the existing Escape behaviour |
