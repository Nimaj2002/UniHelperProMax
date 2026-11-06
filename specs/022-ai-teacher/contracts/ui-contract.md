# Contract: AI Teacher UI

shadcn/ui primitives, theme tokens only, light/dark/custom themes, full keyboard operation,
WCAG AA (Principle V; SC-010). Icons from `@phosphor-icons/react` as elsewhere.

## Session panel — third section "AI Teacher" (FR-001–FR-007)

- Stacked below Recordings and Chat in `SessionPanel`, registered through
  `registerTeacherSection` in `features/sessions/workspace-panels.ts`. Same header, collapse,
  drag/keyboard boundary and remembered heights as the other two sections.
- Header: title "AI Teacher", New chat (`Plus`) as a split/menu button with **Lesson** and
  **Practice**.
- Body: list of this session's teacher chats, newest first. Row: title (truncated, full on
  hover/focus), kind badge (Lesson / Practice, text not colour), relative last-activity time,
  "n open" count when `unansweredCount > 0`, unseen-reply dot (with a text alternative), and a
  `⋯` menu with Rename and Delete. Delete opens a confirmation that states how many graph ideas
  will go (`graph-impact`).
- No endpoint configured: the 014 "set up AI in Settings" message; New chat disabled with the
  reason as its accessible description.
- Rail (panel closed): an AI Teacher button (`GraduationCap`) that opens the panel with this
  section expanded; shows the unseen-reply indicator.

## Teacher tab (FR-008–FR-012)

Tab label: chat title (or "New lesson" / "New practice"), icon `GraduationCap`.

```text
┌ header: title · Plan (once a plan exists) · Ideas (n) · Update graph · status line ┐
├──────────────┬────────────────────────────────┬───────────────────────────┤
│ Questions    │ Teacher                        │ Current question          │
│ [All|Open|✗] │  turns (Markdown, Mermaid,     │  pending cards in order,  │
│ q1 ✓ Title   │  math); question chips where   │  or the selected question │
│ q2 ✗ Title   │  blocks were; malformed notice │  read-only                │
│ q3 ○ Title   │  ─────────────────────────────  │                           │
│              │  014 message box (shared)      │                           │
└──────────────┴────────────────────────────────┴───────────────────────────┘
```

- Columns separated by `PanelResizeHandle` (pointer + keyboard; double-click or Enter restores
  the default). Defaults 240 / flexible / 360 px; a side column can grow only while the Teacher
  column keeps at least 320 px. Widths are not remembered: closing a side column and opening it
  again restores its default width. The header's **Your questions** and **Answers** toggle buttons
  (`aria-pressed`) open and close the side columns; Your questions starts closed below 1100 px. The
  side columns never overlap the Teacher column (it shrinks and clips its content). Below
  800 px Current question stacks below Teacher.
- Landmarks: each column is a labelled region; `F6` cycles between them, as in 008.
- **Your questions column** (left): the student's own messages to the teacher (not answer
  submissions or other actions), in order, each shown as its first 8 words (full text in the
  tooltip). Choosing one scrolls the Teacher column to that message.
- **Questions menu** (right edge, a 56 px vertical menu like the home page's side rails): a
  listbox of the teacher's questions, `Q1`, `Q2`… with a status icon; the name and tooltip give
  the title and the status in words. Selecting one shows it in Current question (opening that
  column if closed) and scrolls the Teacher column to where it was asked, with a brief highlight.
  Hidden below 800 px, where the question chips in the conversation do the same.
- **Teacher column**: 014's conversation rendering with `AnswerMarkdown` + Mermaid (013
  sandbox) + KaTeX. A question chip ("Question 3 · Zero determinant") is a button that selects
  it. Malformed segment: an inline alert "This question could not be displayed" with Retry.
  Action turns (answers, dispute, hint) are shown as compact student turns ("Answered Q1, Q2").
  The message box is 014's `MessageBox` unchanged (attachments, model picker, Send/Stop, Enter
  / Shift+Enter, draft key = chat id or `teacher:<kind>` for a new chat).
- **Current question column**: when nothing is selected it shows all unanswered cards in order.
  A single open card has its own **Submit answer**; several open cards have none and share one
  **Submit answers** button at the bottom, enabled only when every card has an answer (a hint
  says how many must be answered). Card: prompt (Markdown), then either a radio group (choice,
  with a last "I don't know" option) or a textarea plus an "I don't know" checkbox (text), then
  "How sure are you?" as a slider with fixed steps 0/25/50/75/100 % ("Not set" until moved),
  then "Your thinking (optional)" textarea. Submit is disabled with a reason while a reply is streaming.
  After submit: the server grade (choice) appears at once; free text shows "Waiting for the
  teacher's grade". Graded cards show the student's answer, confidence, thinking, the key,
  explanation, every grade in order, and **Dispute grade** (opens an optional reason field;
  also offered as "Ask to grade" for a free-text answer left without a grade). Practice cards
  add **Hint** (shows hints received, in order) and **Reveal solution** (confirm first).
- Card drafts (choice, text, I don't know, confidence, thinking) persist per chat and question in local
  storage until submitted, so closing the tab or app does not lose them (edge case).
- **Plan**: a dialog (or side sheet on narrow windows) rendering the latest plan with the
  current step marked by a token-coloured outline and the text "(current)" in the node's
  accessible description.
- **Ideas (n)**: a popover listing the chat's idea set with Remove buttons and a search box to
  add ideas from any course; refuses a 31st with a message (edge case). For a new chat it is
  shown above the message box, pre-filled with the default set.
- **Graph status line** (lessons): nothing when `ok`; "Graph update pending" / "Updating
  graph…"; on `failed`: "Graph not updated — Retry" (FR-036). **Update graph** in the header
  calls `graph-update`. Closing a lesson tab calls it too.
- Screen readers: "Question n asked", "Answer graded: incorrect", "Answer started/complete"
  (014) via the existing polite live region.

## Home page — Knowledge graph (FR-032–FR-037)

- `TasksPanel`'s section toggle (Tasks / General notes / Time) gains **Knowledge graph**
  (`Graph` icon), remembered like the others.
- Layout inside the panel: search field on top; below it a toggle **Graph | List**; the graph
  canvas fills the rest; selecting an idea opens a detail pane over the lower part of the panel
  (statement, "Follows from", "Leads to", Sources with links, Delete idea).
- Canvas: pan by drag, zoom by wheel/pinch and +/−, **Fit** button and `0`; nodes drawn in
  `--primary`/`--muted-foreground`, edges in `--border`, selection in `--ring`, labels in
  `--foreground` on `--background` (values read from CSS variables, redraw on theme change).
  Labels shown only above a zoom threshold or for the selected node and its neighbours.
- Keyboard: the canvas is one focusable element; arrows move to the nearest neighbour in that
  direction, Enter opens the detail pane, Esc closes it. The **List** view (a listbox of
  search results, or all ideas A–Z) is the screen-reader path and is announced as such.
- Source link: opens the session workspace with that teacher chat's tab focused and scrolled
  to the message (FR-033).
- Empty graph: "Ideas appear here as lessons are taught."
- Delete idea: confirmation dialog; after delete the detail pane closes and the graph redraws.
