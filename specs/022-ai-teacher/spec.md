# Feature Specification: AI Teacher

**Feature Branch**: `022-ai-teacher`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "take a look at https://github.com/amosblomqvist/learnharness.git I want to have a feature like it in my app. AI teacher. What it should do is follow the skills/learnharness. which contains several features like generating questions, mermaid graphs and stuff like that. so on the right panel there should be a button as ai teacher, in the right panel when opened list of previous chats (include new chat button). when new chat is clicked new tab in the main section is opened. the tab should contain three columns. left column should contain list of questions inside that chat. the main is the teacher section and the right section is where UI is gonna show new questions from AI. as input it should follow the ai chat bot we already have."

**Related**: Feature 008 (floating card layout: right panel, rail, tab row), Feature 012 (home
page panels and rails), Feature 013 (Mermaid diagrams and math in Markdown), Feature 014 (AI chat: endpoints, models, message box, streaming,
Stop, attachments, per-session history, Expand/Dock, secrets at rest), Feature 021 (provider proxy).

**Reference behaviour**: LearnHarness ("an agent harness for learning"). Its teaching method —
probe the learner's current understanding, make the goal concrete, plan the smallest dependency
path to the goal, then teach one reasoning step at a time with a graded check after every step,
repairing a gap before building on it — is the behaviour this feature reproduces. The
repository's `skills/learnharness` folder is a read-only reader for LearnHarness's own data files
and is not itself the teacher; this feature takes the method, not that reader.

## Clarifications

### Session 2026-11-05

- Q: Where do teacher chats belong? → A: Per session, like AI chats: each session's AI Teacher
  section lists only that session's lesson and practice chats, saved in that session's folder.
- Q: Which LearnHarness capabilities are in scope beyond probe → teach → check? → A: Both
  Practice sessions and a persistent knowledge graph carried across chats; the knowledge graph is
  shown in the right panel of the home (main) page.
- Q: Where in the home page's right panel does the Knowledge graph appear? → A: As another switch
  beside the existing Tasks/timer switches; the full graph is drawn inside the panel only (no
  expand-to-tab).
- Q: When are taught ideas added to the knowledge graph? → A: When the lesson goes idle (no new
  message for 5 minutes) or its tab is closed, plus an "Update graph" action on demand; only the
  part of the lesson not yet processed is sent.
- Q: How does AI Teacher fit into the session panel? → A: As a third stacked section below
  Recordings and Chat, collapsible and resizable like the others. (Implementation note,
  2026-11-06: the panel had since become a one-section-at-a-time switch; AI Teacher is the third
  section of that switch, which keeps the same intent — see FR-001.)
- Q: What can the student do if they think an answer was graded wrongly? → A: Use "Dispute grade"
  on the graded question; the teacher re-grades it and the status updates, with both grades kept.
- Q: Which knowledge-graph ideas does a new lesson give the teacher? → A: By default, ideas from
  the same course as the session (up to 30), and the student can also choose which ideas to
  include (add from any course, or remove).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the AI Teacher and start a lesson (Priority: P1)

In a session or event workspace, the student opens the right panel's **AI Teacher** section. It
lists their previous teacher chats and has a **New chat** button. Pressing New chat opens a new
tab in the main area laid out in three columns: **Questions** (left), **Teacher** (centre) and
**Current question** (right). The student types what they want to understand in the message box
at the bottom of the Teacher column — the same message box as the existing AI chat — and the
teacher begins.

**Why this priority**: Without the entry point and the three-column tab there is no feature.

**Independent Test**: With one AI endpoint configured, open a session, open AI Teacher, press New
chat, send "I want to understand eigenvalues" and see the teacher's first reply stream into the
centre column of a new tab.

**Acceptance Scenarios**:

1. **Given** a session workspace, **When** the student switches the panel to its third section,
   AI Teacher (or uses the rail's AI Teacher button), **Then** it shows the list of that
   session's teacher chats (newest first) and a New chat button.
2. **Given** the AI Teacher section, **When** the student presses New chat, **Then** a new tab
   opens in the main area with the three columns and an empty message box focused.
3. **Given** a new teacher tab, **When** the student sends their first message, **Then** the
   teacher's reply streams into the Teacher column and the chat appears in the panel's list.
4. **Given** no AI endpoint is configured, **When** the student opens AI Teacher, **Then** the
   section explains how to add one in Settings, as the AI chat does.
5. **Given** a previous teacher chat in the list, **When** the student activates it, **Then** its
   tab opens (or is focused if already open) with its full history, questions and answers.

---

### User Story 2 - The teacher asks questions and the student answers them (Priority: P1)

The teacher works like LearnHarness: it first asks probing questions to find what the student
already holds and what exactly they want to reach, then teaches one reasoning step at a time and
ends every step with a check question. Each question the teacher asks appears as an interactive
card in the **Current question** column. The student answers there (pick an option or write an
answer), sets how confident they are, and may "think out loud" in a free-text field. Submitting
sends the answer to the teacher, which grades it, explains, and either repairs the gap or moves on.

**Why this priority**: Questions and graded answers are the core difference from the plain AI chat.

**Independent Test**: Start a lesson, receive a multiple-choice check, answer it wrongly with low
confidence and a note on the reasoning; see the teacher's response address that specific
reasoning, and see the question marked incorrect in the Questions column.

**Acceptance Scenarios**:

1. **Given** the teacher asks a question, **When** it arrives, **Then** it appears as a card in the
   Current question column and as a new entry in the Questions column marked "Unanswered".
2. **Given** a multiple-choice question, **When** the student picks an option, sets confidence and
   submits, **Then** the answer, confidence and thinking are recorded and sent to the teacher.
3. **Given** a free-text question, **When** the student writes and submits an answer, **Then** it is
   recorded and sent the same way.
4. **Given** a submitted answer, **When** the teacher grades it, **Then** the question's status in
   the Questions column changes to Correct, Partly correct or Incorrect, and the teacher's
   explanation streams into the Teacher column.
5. **Given** the teacher asks several questions at once, **When** they arrive, **Then** the Current
   question column shows them in order and the student can answer them one by one before sending.
6. **Given** an unanswered question, **When** the student instead types a normal message in the
   message box, **Then** the message is sent and the question stays unanswered and answerable.
7. **Given** the teacher's reply contains a Mermaid diagram or math, **When** it renders, **Then**
   it is shown as a diagram/typeset math as in notes (feature 013); a diagram that fails to render
   shows its source and an error instead of breaking the reply.
8. **Given** a question graded Incorrect, **When** the student chooses Dispute grade with a reason,
   **Then** the teacher re-grades it with an explanation, the status shows the new grade and the
   record lists both grades.

---

### User Story 3 - Review the questions of a lesson (Priority: P1)

The **Questions** column lists every question asked in the chat, in order, each with a short
title and its status. Selecting one shows it in the Current question column read-only, with the
student's answer, confidence, thinking, the correct answer and the teacher's feedback, and
scrolls the Teacher column to where it was asked.

**Why this priority**: The question list is the lesson's map and the main way to review it.

**Independent Test**: In a chat with five answered questions, select the second one and see its
full answer record and the Teacher column scrolled to it.

**Acceptance Scenarios**:

1. **Given** a chat with questions, **When** the student selects one in the Questions column,
   **Then** the Current question column shows it with its answer record and the Teacher column
   scrolls to and highlights the turn where it was asked.
2. **Given** a question not yet answered, **When** it is shown, **Then** the correct answer is not
   revealed.
3. **Given** the Questions column, **When** the student filters by status (All, Unanswered,
   Incorrect), **Then** only matching questions are listed.

---

### User Story 4 - See the lesson plan (Priority: P2)

After probing, the teacher shows a plan: a small diagram of the ideas the lesson will move
through from what the student holds to the goal. The plan stays reachable from the tab header,
and the teacher may revise it when answers show the student's understanding differs.

**Why this priority**: Valuable for orientation, but lessons work without it.

**Independent Test**: Start a lesson, complete probing, open "Plan" from the tab header and see a
rendered diagram; after the teacher revises the plan, see the updated version.

**Acceptance Scenarios**:

1. **Given** the teacher has produced a plan, **When** the student opens Plan, **Then** it renders
   as a diagram and the current step is marked.
2. **Given** a revised plan, **When** it arrives, **Then** the Plan view shows the latest version.

---

### User Story 5 - Manage teacher chats (Priority: P2)

Teacher chats can be renamed and deleted from the panel list. A chat open in a tab can be
closed and reopened without losing anything, and the student can attach the session's notes and
documents as context, as in the AI chat.

**Why this priority**: Needed for everyday use but not for a first lesson.

**Acceptance Scenarios**:

1. **Given** a teacher chat, **When** the student chooses Delete and confirms, **Then** the chat,
   its questions and answers are removed and its tab closes; nothing is deleted without confirmation.
2. **Given** a teacher tab, **When** the student closes it during a reply, **Then** the reply
   finishes and is saved, and the list shows an unseen-reply indicator.
3. **Given** the message box, **When** the student attaches a session note or PDF, **Then** the
   teacher uses it as lesson material, with the same attachment rules as the AI chat.

---

### User Story 6 - Knowledge graph on the home page (Priority: P2)

As the student learns, the ideas taught are collected into a personal **knowledge graph**:
ideas (short statements) as nodes, and reasoning links ("these ideas together lead to that one")
as edges, each linked back to the chat and message it came from. The graph is shown in the right
panel of the home page. The student can search it, select an idea to read it and see where it
came from, and jump from there to the source lesson. New lessons use the graph so the teacher
does not start from scratch on topics already covered.

**Why this priority**: It makes learning carry forward across sessions, but each lesson works
without it.

**Independent Test**: Finish a short lesson in one session; open the home page, open the
Knowledge graph in its right panel, find an idea from that lesson, select it and follow its
source link back to the lesson tab.

**Acceptance Scenarios**:

1. **Given** a lesson in which the teacher has taught ideas, **When** the lesson has had no new
   message for 5 minutes, its tab is closed, or the student chooses "Update graph", **Then** the
   ideas and their reasoning links are added to the graph in the background without slowing or
   blocking the lesson.
2. **Given** an idea already in the graph, **When** a later lesson teaches the same idea, **Then**
   the existing node gains another source instead of a duplicate node being created.
3. **Given** the home page, **When** the student chooses the Knowledge graph switch beside the
   Tasks/timer switches in the right panel, **Then** the full graph is drawn inside the panel and
   can be panned, zoomed and searched by name or statement.
4. **Given** a selected idea, **When** the student views it, **Then** its statement, its
   reasoning links (what it follows from and what it leads to) and its sources are listed, and
   activating a source opens that teacher chat at the message it came from.
5. **Given** a new lesson in a session of a course whose earlier lessons added ideas to the graph,
   **When** the teacher probes, **Then** it uses those ideas as starting points to check rather
   than teaching them from zero.
6. **Given** an idea, **When** the student deletes it and confirms, **Then** it and its links are
   removed from the graph; the source chats are unchanged.
7. **Given** an empty graph, **When** it is opened, **Then** it explains that ideas appear here as
   lessons are taught.
8. **Given** a new lesson, **When** the student opens its graph-ideas list before sending, **Then**
   it shows the same-course ideas chosen by default, and the student can remove some and add ideas
   from other courses by search; the teacher receives the edited set.

---

### User Story 7 - Practice sessions (Priority: P3)

From the AI Teacher section the student can start a **Practice** chat instead of a lesson. In
practice the teacher poses varied problems that require the right ideas to come to mind without
naming them first, adapts problems and hints to the student's reasoning, and grades the
attempts. Practice uses the same three-column tab, and can draw its material from the knowledge
graph or from a topic the student names.

**Why this priority**: Practice makes understanding usable, but it builds on lessons and the graph.

**Independent Test**: Choose New chat → Practice, name a topic covered by the graph, receive a
problem in the Current question column, ask for a hint, submit an attempt and see it graded.

**Acceptance Scenarios**:

1. **Given** the AI Teacher section, **When** the student chooses New chat, **Then** they can pick
   Lesson or Practice; the list marks each chat's kind.
2. **Given** a practice chat, **When** the teacher poses a problem, **Then** it appears in the
   Current question column with a Hint action and an answer area, and in the Questions column.
3. **Given** a problem, **When** the student asks for a hint, **Then** the teacher gives one hint
   adapted to the student's attempt and thinking so far, and the hint is recorded on the question.
4. **Given** a graded attempt, **When** the student views the question, **Then** the model solution
   is shown only after the attempt was submitted or the student chose to reveal it.
5. **Given** a non-empty graph, **When** the student starts practice without naming a topic,
   **Then** the teacher draws problems from ideas in the graph.

---

### Edge Cases

- The teacher produces a question the app cannot read (malformed or missing options): the text
  is shown in the Teacher column with a "This question could not be displayed" notice and a Retry
  action; the lesson is not blocked.
- A multiple-choice question with one or zero options, or duplicate options: treated as malformed.
- The student submits an answer while a reply is still streaming: Submit is disabled until the
  reply ends or is stopped.
- The student presses Stop mid-reply: the partial reply is kept and marked "Stopped"; any question
  fully received before the stop remains answerable.
- The app closes mid-reply: the partial reply is saved marked "Interrupted"; drafts of unsent
  answers are kept.
- The endpoint used by a chat is disabled or deleted: the chat stays readable and asks for another
  model before the next message, as in the AI chat.
- A chat with 200 questions: the Questions column stays responsive and scrollable.
- The window is too narrow for three columns (below about 1100 px): the Questions column collapses
  to a toggle and, below about 800 px, the Current question column moves below the Teacher column.
- The session folder is renamed or moved while a teacher chat is open: the chat follows.
- A teacher chat is opened in a tab and in the panel at once: it is shown in only one place, as
  with AI chat tabs.
- Saving fails (disk full, folder locked): the failure is shown, the save is retried and the
  student's answer is kept until saved.
- Adding ideas to the graph fails (model error, malformed result, endpoint offline): the lesson is
  unaffected; the chat is marked "graph not updated" and is retried later or on demand.
- A teacher chat that contributed ideas is deleted: the ideas stay in the graph while they have
  another source; ideas whose only source was that chat are removed with it (the confirmation says
  how many).
- The session containing source chats is deleted: same rule as deleting the chat.
- A graph of 2,000 ideas: opening, panning, zooming and searching stay smooth.
- The graph and a lesson update the same idea at once: no update is lost.
- An idea in a chat's idea set is deleted from the graph: it is dropped from the set from the next
  message; earlier messages are unchanged.
- The student tries to add a 31st idea to a chat's set: the app says the limit is 30 and adds nothing.

## Requirements *(mandatory)*

### Functional Requirements — Part A: Entry Point and Chat List

- **FR-001**: The right panel of session and event workspaces MUST have a third section,
  **AI Teacher**, beside Recordings and Chat in the panel's section switch (the panel shows one
  section at a time; the others stay mounted so nothing in progress is lost). The chosen
  section MUST be remembered with the panel's layout. The closed panel's rail MUST include an
  AI Teacher button that opens the panel on this section.
- **FR-002**: The AI Teacher section MUST list the teacher chats of the current session or event
  only, newest first, each with its title, kind (Lesson or Practice), last-activity time and a
  count of unanswered questions.
- **FR-003**: The section MUST have a **New chat** button offering Lesson or Practice; choosing one
  MUST open a new teacher tab in the main area. An empty chat MUST NOT be saved or listed until its
  first message is sent.
- **FR-004**: Activating a listed chat MUST open its tab, or focus it if already open.
- **FR-005**: Each listed chat MUST have a keyboard-accessible menu with Rename and Delete; Delete
  MUST ask for confirmation.
- **FR-006**: A chat's default title MUST be the first 60 characters of its first message; the
  student MAY rename it.
- **FR-007**: Without a configured AI endpoint and model, the section MUST explain how to add one
  in Settings and MUST NOT offer New chat as usable.

### Functional Requirements — Part B: The Teacher Tab Layout

- **FR-008**: A teacher tab MUST show three columns: **Questions** (left), **Teacher** (centre),
  **Current question** (right). Column widths MUST be adjustable by pointer and keyboard and
  remembered.
- **FR-009**: The Teacher column MUST show the conversation and, at its bottom, the same message
  box as the AI chat: multi-line input, Enter to send, Shift+Enter for a new line, attachment
  chips, model picker, Send turning into Stop while a reply streams, and a per-chat persisted draft.
- **FR-010**: Teacher replies MUST stream as received and render as sanitized Markdown with code,
  math and Mermaid diagrams, as notes do (feature 013).
- **FR-011**: The tab header MUST show the chat title and a **Plan** button once a plan exists (P2).
- **FR-012**: On narrow windows the layout MUST adapt as described in Edge Cases, with every column
  still reachable by keyboard.

### Functional Requirements — Part C: Teaching Behaviour

- **FR-013**: The teacher MUST follow the LearnHarness method: (1) probe the student's current
  understanding and make the goal concrete with questions before teaching; (2) plan the shortest
  path of ideas from what is held to the goal; (3) teach one reasoning step at a time; (4) end every
  reasoning step with a graded check question; (5) repair a wrong or low-confidence answer before
  building on it; (6) skip what the student already holds and anything off the path to the goal.
- **FR-014**: The teacher's instructions MUST be visible to the student in Settings, so its
  behaviour is inspectable. Editing them is out of scope for this feature.
- **FR-015**: The teacher MUST be able to include Mermaid diagrams in its explanations to show
  structure (dependencies, processes, relations).
- **FR-016**: The teacher MUST have no tools that change notes, files, tasks or settings; it only
  produces replies, questions, grades and plans.
- **FR-017**: A new teacher chat MUST give the teacher a set of knowledge-graph ideas (with the
  reasoning links among them) as starting points. By default the set is the ideas whose sources
  include a chat in the same course as the session, most recently taught first, up to 30; in an
  event workspace (no course) the default set is empty. Before sending the first message, and at
  any later point in the chat, the student MUST be able to see the set and change it: remove
  ideas, and add ideas from any course by searching the graph (still up to 30). Changes apply from
  the next message. The graph records what was taught, not what the student mastered, so the
  teacher MUST still check rather than assume.

### Functional Requirements — Part D: Questions and Answers

- **FR-018**: The teacher MUST be able to ask **multiple-choice** (single answer) and **free-text**
  questions. Each question has a prompt, its kind, options (for multiple choice), and a stored
  correct answer or model solution that MUST NOT be shown before the student answers.
- **FR-019**: Every question the teacher asks MUST appear as an interactive card in the Current
  question column and as an entry in the Questions column, in the order asked.
- **FR-020**: An answer card MUST collect the answer — or the fixed answer "I don't know", offered
  on every question and graded Incorrect by the app — a confidence on a slider with the fixed
  steps 0, 25, 50, 75 and 100 % (may be left unset, which is not the same as 0 %) and an optional
  "your thinking" text, and MUST be fully operable by keyboard.
- **FR-021**: Submitting an answer MUST send it, the confidence and the thinking to the teacher as
  the student's next turn. When several questions are open they share one Submit button at the
  bottom, enabled only once every open question has an answer, and are submitted together.
- **FR-022**: After grading, each question MUST carry a status: Unanswered, Correct, Partly correct
  or Incorrect, shown in the Questions column with text and icon, not colour alone.
- **FR-023**: Selecting a question in the Questions column MUST show its full record (prompt,
  student answer, confidence, thinking, correct answer, feedback) read-only in the Current
  question column and scroll the Teacher column to the turn where it was asked.
- **FR-024**: The Questions column MUST offer filters All, Unanswered and Incorrect.
- **FR-024a**: A graded question MUST offer **Dispute grade**, which takes an optional reason and
  sends it to the teacher as the student's next turn; the teacher MUST re-grade with an
  explanation, the question's status MUST show the new grade, and the record MUST keep every
  grade in order. Dispute is unavailable while a reply is streaming.
- **FR-025**: A question the app cannot read MUST be handled as in Edge Cases, never blocking the chat.

### Functional Requirements — Part E: Plan (Priority 2)

- **FR-026**: After probing, the teacher MUST produce a plan of the lesson as a diagram of ideas
  and their dependencies, viewable from the tab's Plan button with the current step marked.
- **FR-027**: The teacher MAY revise the plan; the Plan view MUST show the latest version.

### Functional Requirements — Part F: Knowledge Graph (Priority 2)

- **FR-028**: The app MUST keep one knowledge graph per user, across all sessions and courses.
- **FR-029**: Ideas taught in lesson chats MUST be added to the graph in the background when the
  lesson has had no new message for 5 minutes, when its tab is closed, or when the student chooses
  "Update graph" in the lesson tab; each update MUST process only the part of the lesson not yet
  processed, and MUST NOT start while a reply is streaming. Ideas are added as ideas (a short name and a one-sentence statement) and reasoning
  links (one or more ideas that together lead to another idea).
- **FR-030**: Every idea and link MUST record its sources: the teacher chat and, where available,
  the message it came from.
- **FR-031**: An idea already in the graph MUST be merged with a newly taught equivalent (same
  meaning), gaining a source rather than duplicating.
- **FR-032**: The home page's right panel MUST offer a **Knowledge graph** switch beside its
  existing Tasks/timer switches; the full graph MUST be drawn inside the panel (no separate tab),
  with pan, zoom, fit-to-panel and search by name or statement, and MUST stay usable at the
  panel's narrowest width. The chosen switch MUST be remembered like the existing ones.
- **FR-033**: Selecting an idea MUST show its statement, what it follows from, what it leads to
  and its sources; activating a source MUST open that teacher chat at the source message.
- **FR-034**: The student MUST be able to delete an idea, with confirmation; deleting MUST NOT
  change any chat.
- **FR-035**: Deleting a teacher chat or its session MUST remove the sources it contributed;
  ideas left with no source MUST be removed, and the confirmation MUST say how many.
- **FR-036**: Failing to update the graph MUST NOT affect the lesson; the chat MUST show that the
  graph was not updated and offer to retry.
- **FR-037**: The graph view MUST be fully keyboard operable, including a list alternative to the
  visual graph for screen-reader users.

### Functional Requirements — Part G: Practice (Priority 3)

- **FR-038**: A Practice chat MUST use the same three-column tab, message box and question
  handling as a lesson.
- **FR-039**: In practice the teacher MUST pose problems that require the right ideas without
  naming them, vary the problems, and adapt problems and hints to the student's answers and
  thinking.
- **FR-040**: Practice problems MUST offer a Hint action; each hint MUST be recorded on its problem.
- **FR-041**: The model solution MUST be shown only after an attempt was submitted or the student
  chose to reveal it.
- **FR-042**: Practice MUST draw material from a topic the student names or, if none, from the
  chat's set of graph ideas chosen as in FR-017. Practice chats MUST NOT add ideas to the graph.

### Functional Requirements — Part H: Storage and Reliability

- **FR-043**: Each teacher chat MUST be saved as plain files in the student's file tree: a source
  file holding messages, questions, answers, grades and plans, plus a regenerated readable
  Markdown transcript, as AI chats are.
- **FR-044**: Every submitted answer and every sent message MUST be saved before or as it is sent;
  a partial reply MUST be saved and marked Stopped or Interrupted.
- **FR-045**: Closing a teacher tab or the panel MUST NOT interrupt a reply in progress.
- **FR-046**: Attachments (session notes, PDFs, pictures) MUST follow the AI chat's rules, including
  the remote-endpoint privacy notice on first use.
- **FR-047**: API keys MUST never appear in teacher chat files, transcripts, logs or responses.

### Key Entities

- **Teacher chat**: a lesson or practice conversation belonging to one session or event; kind,
  title, endpoint and model, created/last-activity times, messages, questions, plans.
- **Message**: a student or teacher turn; text, attachments, time, state (complete, streaming,
  Stopped, Interrupted).
- **Question**: asked within a teacher message; kind (multiple choice / free text), prompt,
  options, hidden correct answer or model solution, status, order in the chat.
- **Answer**: the student's response to a question; chosen option or text, confidence (or unset),
  thinking text, time, and its grades in order (first grade, then any re-grades after a dispute,
  each with the teacher's feedback and the dispute reason); the latest grade is the status.
- **Plan**: a versioned diagram of the lesson's ideas and their dependencies, with the current step.
- **Hint**: a practice hint given for a problem; text and time.
- **Idea (graph node)**: one per user graph; short name, statement, sources. Records what was
  taught, not a mastery rating. Its courses are those of its source chats' sessions.
- **Chat idea set**: per teacher chat, the graph ideas given to the teacher (default same-course,
  edited by the student, up to 30).
- **Reasoning link (graph edge)**: one or more premise ideas that jointly lead to a conclusion
  idea; sources.
- **Source**: a reference from an idea or link to a teacher chat and, where available, a message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an open session, a student can start a new lesson and send the first message in
  under 15 seconds and three actions.
- **SC-002**: In a test lesson, 100% of teacher questions that are well-formed appear as answerable
  cards and as entries in the Questions column.
- **SC-003**: In a scripted lesson, the teacher asks probing questions before its first explanation,
  and every explanation step is followed by a check question, in at least 90% of runs.
- **SC-004**: After a wrong answer, the teacher's next reply addresses the gap before introducing a
  new idea in at least 90% of scripted runs.
- **SC-005**: No submitted answer is lost when the app is closed at any point after submission.
- **SC-006**: Selecting any question in a 200-question chat shows its record and scrolls the
  Teacher column in under 1 second.
- **SC-007**: After a lesson has been idle for 5 minutes or its tab closed, at least 90% of the ideas it taught can be found in the
  knowledge graph by searching their name, with a working link back to the lesson.
- **SC-008**: Re-teaching an idea already in the graph creates no duplicate node in at least 90%
  of scripted runs.
- **SC-009**: A graph of 2,000 ideas opens in under 2 seconds and search results appear in under
  1 second.
- **SC-010**: All three columns, the graph view, the answer cards and the chat list are fully keyboard operable and
  meet WCAG AA in light, dark and custom themes.

## Assumptions

- The teacher uses the AI endpoints and models already configured for the AI chat (feature 014);
  no new provider, key or setting is added.
- The message box, attachments, streaming, Stop, model picker, drafts, error messages and
  remote-privacy notice are reused from the AI chat unchanged.
- Questions, grades and plans come from the model as structured parts of its reply; models that
  cannot produce them reliably may produce malformed questions, which are handled per FR-025.
- Mermaid and math rendering reuse feature 013's sandboxed renderer.
- Only the method and behaviour of LearnHarness are reproduced. LearnHarness is licensed AGPL-3.0;
  no LearnHarness code, prompts or assets are copied into this app.
- Adding ideas to the graph uses the same endpoint and model as the lesson, so it sends the
  lesson's content to that provider again; no separate model setting is added.
- The knowledge graph is the app's own data under the user's data folder, included in backups
  (feature 016); it is not LearnHarness's format.
- Importing notes into the graph is out of scope; ideas come only from lesson chats.
- Out of scope: dictation/voice input, web research by the teacher, interactive demonstrations,
  marking up images with arrows, editing the teacher's instructions, importing LearnHarness data,
  and reading LearnHarness's data folder.
