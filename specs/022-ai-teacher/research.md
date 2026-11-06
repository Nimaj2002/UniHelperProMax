# Research: AI Teacher (022)

Each decision lists what was chosen, why, and what else was considered. The code read for this
research: `backend/src/unihelper/ai/base.py` (provider interface), `chat/runs.py` (RunRegistry),
`chat/files.py`, `services/chat_service.py`, `chat/sweep.py`, `models/chat.py`, `main.py`
(lifespan tasks), `frontend/src/features/chat/*`, `features/sessions/SessionPanel.tsx`,
`workspace-panels.ts`, `features/home/TasksPanel.tsx`, `sandbox/diagramRenderer.ts`, and the
LearnHarness repository (README, `docs/teaching-methodology.md`, `skills/learnharness/`).

## R1. Teacher chats are chats with a `kind`

- **Decision**: Teacher chats are rows of the existing `chats` table with a new `kind` column
  (`chat` | `lesson` | `practice`, default `chat`). They are stored in the same
  `<session folder>/chats/` folder as `uh-chat/1` JSON files plus a regenerated `.md`
  transcript, with one added top-level `teacher` object (see `contracts/teacher-chat-file.md`).
  They reuse the existing RunRegistry, run events, Stop, drafts, uploads, attachments, note
  snapshots, model picker, privacy notice, soft delete with Undo, sweep and trash counting.
- **Rationale**: Principle II already allows chats in `chats/` and requires JSON + Markdown;
  014 built durability (checkpointing every 2 s, Interrupted on shutdown, atomic writes, chat
  lock). Reusing it satisfies FR-043–FR-047 with almost no new storage code. The existing AI
  chat endpoints that list chats filter `kind = 'chat'`, so teacher chats never appear in the
  Chat section and vice versa.
- **Alternatives**: a separate `teacher_chats` table and `teacher/` folder — duplicates runs,
  drafts, uploads and sweep, and needs a constitution amendment for the new folder. Rejected.

## R2. Questions, grades, plans and hints travel as fenced JSON blocks in the reply text

- **Decision**: The provider interface (`ai/base.py`) is text-only streaming and has no tool
  calls. The teacher's system prompt asks it to write structured items as fenced blocks with
  the info strings `uh-question`, `uh-grade`, `uh-plan` and `uh-hint`, each holding one JSON
  object (`contracts/teacher-blocks.md`). Diagrams stay ordinary ```` ```mermaid ```` fences.
- **Rationale**: Works with all three request styles and with local models, needs no change to
  the adapters, and degrades visibly: a block that does not parse becomes a "could not be
  displayed" segment with Retry (FR-025) instead of breaking the chat.
- **Alternatives**: provider tool calling — needs a new tool-call path in three adapters,
  differs per style and is unreliable on local models; asking for a whole-reply JSON object —
  breaks streaming prose. Rejected.

## R3. Answer keys never reach the browser before the student answers

- **Decision**: A pure streaming splitter (`domain/teacher_blocks.py`) sits between the
  adapter's `Delta`s and the run's event queue for teacher runs. Prose passes through as
  `delta`; when a `uh-*` fence opens, its text is held until the fence closes, then parsed and
  emitted as a `question` / `grade` / `plan` / `hint` event. Question events never carry
  `answer` or `solution`. The raw text, with the blocks, is still saved to the chat file as the
  source of truth. The read endpoint returns the reply as **segments** (Markdown and question
  references) and leaves keys out of questions until they are answered or revealed.
- **Rationale**: FR-018 and FR-041 say the key MUST NOT be shown before the answer. Holding the
  key on the server is the only way to make that true for the UI and the network panel. The
  files themselves are the student's own archive and may contain keys (as LearnHarness's do).
- **Alternatives**: stream the raw text and hide blocks in the UI — the key is visible in the
  network panel and the run replay buffer. Rejected.

## R4. Multiple-choice answers are graded by the server; free text by the teacher

- **Decision**: On submit, a multiple-choice answer is compared with the stored key and graded
  Correct or Incorrect at once (it is returned in the submit response). Free-text answers get
  status `submitted` until the teacher's next reply contains a `uh-grade` block for them.
  Disputes (FR-024a) always go to the teacher, whose `uh-grade` block adds a re-grade. If the
  teacher's reply ends without a grade for a submitted free-text question, it stays
  `submitted` and the card offers "Ask to grade" (a dispute with an empty reason).
- **Rationale**: Deterministic grading where possible removes a whole class of model errors and
  lets the UI show the result instantly; the teacher still explains in prose.
- **Alternatives**: the model grades everything — slower and occasionally wrong on trivially
  checkable items. Rejected.

## R5. What the student's answer turn looks like to the model

- **Decision**: An answer submission creates an ordinary user turn whose version holds a
  structured `answers` list; the server renders it to text for the model ("Answer to question
  q3 (multiple choice): B — 'The determinant is zero'. Server grade: incorrect. Confidence:
  low. Thinking: …"). Confidence `unset` is written as "not given", never as low (FR-020).
  Dispute, hint request and malformed-question retry are user turns with an `action` field and
  a server-written text. The transcript shows them in plain words.
- **Rationale**: Keeps the chat's turn model and context builder (`chat/context.py`) unchanged;
  only the text of the turn is generated.

## R6. Teacher instructions are the app's own text, built per kind

- **Decision**: `teacher/prompts.py` holds the lesson, practice and extraction instructions as
  constants written for this app from the method described in the spec (FR-013). The system
  prompt sent for a run is: kind instructions + block protocol + the chat's idea set (names,
  statements, links) + the user's custom chat instructions if set (014). `GET
  /teacher/instructions` returns the three texts for Settings (FR-014, read-only).
- **Rationale**: LearnHarness is AGPL-3.0; the spec forbids copying its prompts. Its method is
  described in prose in the spec and re-expressed here.

## R7. Knowledge graph lives in SQLite

- **Decision**: Four tables — `kg_ideas`, `kg_links`, `kg_link_premises`, `kg_sources` — one
  graph per user (FR-028). Search is `LIKE` on name/statement over at most a few thousand rows.
- **Rationale**: The graph is derived data with provenance pointing back at chat files (which
  stay the primary record, Principle II). Principle II forbids the database being the sole
  location of notes, audio, documents, annotations and chat conversations — not of derived
  indexes. SQLite gives transactions (edge case "no update lost"), cheap search, and it is
  already in backups (016). No new folder means no constitution amendment.
- **Alternatives**: a `Knowledge Graph/graph.json` file per user — needs a constitution
  amendment for a new reserved folder, plus its own lock and merge code. Rejected for now; an
  export can be added later if wanted.

## R8. Graph extraction is a background worker, not a run

- **Decision**: `teacher/graph_worker.py` runs as a lifespan task (like `_sweep_chats`). Every
  60 s it finds lesson chats (not deleted, not generating) whose last activity is ≥ 5 minutes
  ago and whose `kg_processed_turns` is behind their turn count, and processes them one at a
  time. `POST /teacher-chats/{id}/graph-update` (tab close and the "Update graph" action) puts a
  chat at the front of the queue. A job sends the unprocessed turns + the existing ideas of the
  same course (≤ 200, names and statements with ids) to the chat's endpoint/model, collects the
  streamed text, parses one JSON object `{ideas, links}`, and merges inside one transaction.
  On failure it records `kg_status = failed` and an error category; the chat shows "Graph not
  updated" with Retry (FR-036); the worker retries a failed chat at most once per hour.
- **Rationale**: FR-029 (idle 5 min / tab close / on demand, only the unprocessed part, never
  while streaming). A single worker means one extra request at a time and no extra
  infrastructure (Principle VII).
- **Alternatives**: extract after every reply — rejected in clarification Q2.

## R9. Merging "same meaning" ideas

- **Decision**: The extraction prompt receives existing same-course ideas with ids and must
  return `"existingId"` for an idea that means the same thing. The server then also merges any
  new idea whose normalized name (casefold, collapsed spaces, stripped punctuation) equals an
  existing idea's. Merging adds a source; it never rewrites the existing statement.
- **Rationale**: SC-008 (≤ 10% duplicates) without embeddings or a vector store (Principle VII).

## R10. Deleting chats and sessions removes their sources

- **Decision**: Sources reference `chat_id` with `ON DELETE CASCADE`. Chats are hard-deleted by
  the existing sweep after the Undo window, and by the cascade when a session folder is purged
  from the trash; the sources go with them. After the sweep, ideas and links with no source are
  deleted (`kg_prune`). While a chat is soft-deleted, its sources are hidden from graph reads.
  `GET /teacher-chats/{id}/graph-impact` and the session-delete summary report how many ideas
  would be left without a source, for the confirmation text (FR-035).
- **Rationale**: Reuses the existing delete paths; nothing new to keep in sync.

## R11. The chat idea set

- **Decision**: Stored in the chat file (`teacher.ideaSet`: idea ids, ≤ 30). For a new chat the
  client asks `GET /knowledge-graph/ideas?courseId=…&sort=recent&limit=30` for the default
  (empty for events, which have no course), lets the student edit it in the new-chat box, and
  sends `ideaIds` with the first message (`null` = server computes the default). `PUT
  /teacher-chats/{id}/idea-set` changes it later; changes apply from the next message. Ideas
  deleted from the graph are skipped when the prompt is built.
- **Rationale**: FR-017 and clarification Q5.

## R12. Graph view: `d3-force` layout drawn on a canvas, plus a list

- **Decision**: Add the `d3-force` package (layout only). The view computes the layout once
  per graph version (300 ticks, warm-started from the last positions kept in memory), draws to
  a `<canvas>` with colours read from theme tokens (CSS variables), and handles pan, zoom,
  fit-to-panel and hit-testing itself with pointer and wheel events. Keyboard: arrow keys move
  between neighbouring ideas, Enter selects, +/−/0 zoom and fit. A list view (search results
  and the selected idea's links) is the screen-reader alternative (FR-037).
- **Rationale**: FR-032 needs pan/zoom/search of up to 2,000 nodes inside a narrow panel
  (SC-009 < 2 s). Writing a force layout by hand is more code than the dependency; Mermaid
  (already present) cannot lay out or interact with 2,000 nodes and runs in a sandboxed
  iframe. `d3-force` is small, has no DOM code and no transitive dependencies beyond
  `d3-dispatch`, `d3-quadtree`, `d3-timer`.
- **Alternatives**: Cytoscape.js or vis-network — large, own styling systems that bypass theme
  tokens. Rejected.

## R13. Diagrams in replies and the plan

- **Decision**: Teacher Markdown is rendered by the chat's `AnswerMarkdown` extended with a
  `mermaid` code-block renderer that uses feature 013's sandboxed iframe renderer
  (`sandbox/diagramRenderer.ts`), and KaTeX for math as notes do. A render error shows the
  source and the message. The plan's current step is marked by appending
  `class <nodeId> current` and a `classDef current` built from theme variables before
  rendering.
- **Rationale**: FR-010, FR-015, FR-026 with the renderer the app already trusts.

## R14. The teacher tab

- **Decision**: A new workspace tab kind `teacher` (backend `WorkspaceTab.kind` gains
  `"teacher"`; ids are chat ids, plus `new-teacher-…` ids for unsent chats like 014's new-chat
  tabs). The tab body is three resizable columns using the existing `PanelResizeHandle`, widths
  remembered per user in `ui_preferences` like other panel widths. Below 1100 px the Questions
  column becomes a toggle; below 800 px the Current question column stacks below the Teacher
  column (edge case).
- **Rationale**: Mirrors 014's chat tabs (FR-042–FR-045) and 008's layout rules.

## R15. The session panel's third section and the home switch

- **Decision**: `workspace-panels.ts` gains a `registerTeacherSection` slot next to
  `registerChatSection`; `SessionPanel.tsx` renders it as a third stacked section with the same
  collapse, drag/keyboard boundary and remembered heights; the rail gets an AI Teacher button
  with the unseen-reply indicator. On the home page, `TasksPanel`'s section switch
  (`tasks | notes | time`) gains `graph`, remembered like the others.
- **Rationale**: Clarifications Q3 and Q4.

## R16. Testing the teacher without a real model

- **Decision**: `tests/fake_llm.py` gains scripted teacher replies that contain `uh-*` blocks
  (valid and malformed) and an extraction reply. Unit tests cover the splitter (blocks split
  across deltas, unclosed fence at Stop, nested backticks), grading, answer-turn rendering,
  normalization/merging and the default idea set. Contract tests validate every operation in
  `contracts/openapi.yaml`. SC-003/SC-004 (teaching behaviour with real models) are checked
  manually with the scripted lesson in `quickstart.md`, since they depend on the chosen model.
