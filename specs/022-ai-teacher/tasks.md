---
description: "Task list for 022 AI Teacher"
---

# Tasks: AI Teacher

**Input**: Design documents from `/specs/022-ai-teacher/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (openapi.yaml,
teacher-blocks.md, teacher-stream.md, teacher-chat-file.md, ui-contract.md), quickstart.md

**Tests**: Included. The constitution (Principle VI) requires success + main-error tests for
every endpoint, and the full `pytest` run fails if any operation in
`specs/022-ai-teacher/contracts/openapi.yaml` is never exercised (`tests/conftest.py`).

**Organization**: By user story (spec.md US1–US7). Backend paths are relative to
`backend/src/unihelper/` unless they start with `backend/`; frontend paths relative to
`frontend/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US7 from spec.md

---

## Phase 1: Setup

- [X] T001 Add `d3-force@3.0.0` (dependency) and `@types/d3-force@3.0.10` (devDependency), exact versions, with `corepack pnpm add` in `frontend/package.json` (plan Complexity Tracking).
- [X] T002 [P] Create empty packages/folders: `backend/src/unihelper/teacher/__init__.py`, `frontend/src/features/teacher/`, `frontend/src/features/graph/`, `frontend/tests/unit/teacher/`.
- [X] T003 [P] Extend `backend/tests/fake_llm.py`: add `STATE["script"]` (a list of reply strings, reset in `reset()`); when the requested model is `"teacher"`, pop the next script entry and stream it in ~20-char tokens for all three styles (`_tokens`); keep current behaviour for other models.
- [X] T004 [P] Add teacher test helpers in `backend/tests/contract/teacher_helpers.py`: create session + endpoint + model `teacher` (reuse `chat_helpers.py`), `start_lesson(client, session_key, text, kind="lesson", idea_ids=None)`, `wait_run(client, run_id)` collecting SSE events (reuse the chat helpers' event reader), and constants with scripted replies containing `uh-question` (choice + text), `uh-grade`, `uh-plan`, `uh-hint`, malformed blocks, and an extraction JSON reply.

---

## Phase 2: Foundational (blocks all stories)

- [X] T005 Alembic migration `db/migrations/versions/0019_ai_teacher.py`: on `chats` add `kind String(10) NOT NULL DEFAULT 'chat'`, `unanswered_count Integer NOT NULL DEFAULT 0`, `kg_processed_turns Integer NOT NULL DEFAULT 0`, `kg_status String(10) NULL`, `kg_error String(30) NULL`, `kg_attempted_at String NULL`, index `ix_chats_kind_kg (user_id, kind, kg_status, updated_at)`; create `kg_ideas`, `kg_links`, `kg_link_premises`, `kg_sources` exactly as in data-model.md (FKs and cascades: sources `chat_id` ON DELETE CASCADE, `course_id` SET NULL; `kg_links.signature` unique per user; unique `(idea_id, chat_id, message_id)` and `(link_id, chat_id, message_id)`; indexes `(user_id, norm_name)`, `(user_id, updated_at)`). Downgrade drops them.
- [X] T006 [P] Update `models/chat.py`: add the six `chats` columns from T005 with `CHAT_KINDS = ("chat", "lesson", "practice")` and `TEACHER_KINDS = ("lesson", "practice")`.
- [X] T007 [P] Create `models/knowledge_graph.py` with `KgIdea`, `KgLink`, `KgLinkPremise`, `KgSource` matching T005 (name `String(120)`, statement `Text` "1–600 chars", `message_id String(64) NULL`); export from `models/__init__.py`.
- [X] T008 Filter AI chat endpoints to `Chat.kind == "chat"` in `services/chat_service.py` (`get_chat`, `list_chats`, and every path reached from `/chats/{id}/messages`, regenerate, edit, selection, append-to-note), so a teacher chat id answers 404 there; extend `backend/tests/contract/test_chats_history.py` with one case proving a lesson is not listed and `GET /chats/{lessonId}` is 404.
- [X] T009 [P] Write the pure streaming splitter in `domain/teacher_blocks.py` per `contracts/teacher-blocks.md`: class `BlockSplitter` with `feed(text) -> list[Piece]` and `close(reason) -> list[Piece]`, where `Piece` is `Prose(text)` | `Block(type, payload)` | `Malformed(id, reason, raw)`; fence = line exactly ```` ```uh-(question|grade|plan|hint) ```` … line exactly ```` ``` ````; hold at most the current line; limits "20,000 characters per block, 20 question blocks per reply"; validation of `uh-question` ("`options` 2–8 distinct strings (trimmed, case-insensitive)", `answer` in range, `prompt` "1–4000 chars", `title` "≤ 80 chars" defaulting to the first 80 chars of the prompt as plain text), `uh-grade` (`grade` in `correct|partly|incorrect`), `uh-plan` (`mermaid` "≤ 20,000 chars", `current` str|null), `uh-hint`; plus `segments_of(raw_text) -> list[Piece]` for reads.
- [X] T010 [P] Unit tests `backend/tests/unit/test_teacher_blocks.py` for every "Self-check case" in `contracts/teacher-blocks.md` plus: fence split across 3 deltas, ```` ```mermaid ```` untouched, unterminated block at `close("stopped")` → `Malformed(reason="unterminated")`, 21st question → `too_many`, duplicate/1 option/out-of-range answer → malformed, `segments_of` equals concatenated `feed` output.
- [X] T011 Add an optional per-run splitter hook to `chat/runs.py`: `RunState` gains `splitter: BlockSplitter | None` and `on_piece: Callable | None`; in `_run`, when `splitter` is set, pass each `Delta` through it, queue only `Prose` text as `delta`, and call `on_piece` (in a thread, under the chat lock) for `Block`/`Malformed` pieces, emitting the event it returns (`question`, `malformed`, `grade`, `plan`, `hint` per `contracts/teacher-stream.md`) after the file write; on stop/failure/interrupt call `splitter.close(status)` before `_finish`; for teacher runs the `snapshot` event carries `{segments, status}`. AI chat runs (no splitter) must behave byte-for-byte as before (existing tests stay green).
- [X] T012 [P] Write `teacher/prompts.py`: `LESSON`, `PRACTICE`, `EXTRACTION` instruction texts written for this app (do not copy LearnHarness text, AGPL), expressing FR-013 steps (1)–(6), FR-015 (Mermaid for structure), FR-016 (no tools), the block protocol of `contracts/teacher-blocks.md` with one example per block, "one check question per reasoning step", "repair a wrong or low-confidence answer before building on it", and for practice FR-039 (problems that need the idea without naming it, varied, hints adapted); plus `system_prompt(kind, topic, ideas, links, custom_instructions) -> str`.
- [X] T013 Create `schemas/teacher.py` and `schemas/knowledge_graph.py` with Pydantic models mirroring every schema in `contracts/openapi.yaml` (camelCase aliases as in `schemas/chat.py`): `StartTeacherChat`, `SubmitAnswers`, `AnswerSubmission` (`text` "maxLength 8000", `thinking` "maxLength 8000", `confidence` low|medium|high|null), `Dispute` (`reason` "maxLength 4000"), `TeacherSendResult`, `TeacherChatSummary`, `TeacherChatOut`, `TeacherTurn`, `Segment`, `Question`, `Plan`, `GraphStatus`, `IdeaSummary`, `Link`, `Graph`, `Source`, `IdeaDetail`.
- [X] T014 Add `"teacher"` to `TabRef.kind` in `schemas/notes.py` and to the allowed tab sets in `services/workspace_service.py` (ids: teacher chat ids, plus `new-teacher-<suffix>` ids for unsent chats like 014's `NEW_CHAT_ID`); add a case to the existing workspace contract test.

**Checkpoint**: migration applies, AI chat tests pass unchanged, splitter tests pass.

---

## Phase 3: User Story 1 — Open the AI Teacher and start a lesson (P1) 🎯 MVP

**Goal**: Third panel section lists lessons; New chat → Lesson opens a three-column tab; the first message streams a reply.

**Independent test**: With one endpoint, open a session → AI Teacher → New chat → Lesson → send "I want to understand eigenvalues" → reply streams into the centre column of a new tab; the chat appears in the list.

### Tests (US1)

- [X] T015 [P] [US1] Contract tests in `backend/tests/contract/test_teacher.py`: `GET/POST /sessions/{sessionKey}/teacher-chats` (201 with `TeacherSendResult`; 422 `empty_message`; 409 `privacy_ack_required`; 404 unknown session; list returns only lessons/practice, newest first, with `unansweredCount`), `GET /teacher-chats/{chatId}` (200 segments; 404 for an AI chat id), `POST /teacher-chats/{chatId}/messages` (202; 409 `run_active`), `GET /teacher/instructions` (200, three non-empty strings).
- [X] T016 [P] [US1] Integration test `backend/tests/integration/test_teacher_flow.py::test_start_lesson_files`: start a lesson on real SQLite + tmp data dir, run completes; the chat JSON in `<session>/chats/` has `"format": "uh-chat/1"` and `teacher.kind == "lesson"`, the `.md` transcript header says "Lesson", and no test key appears in either file.

### Implementation (US1)

- [X] T017 [US1] Implement `services/teacher_service.py` `start(deps, session_key, body)` and `send(deps, chat_id, body)` reusing `chat_service` helpers (`_check_message`, `_model`, `_privacy`, `_context_parts`, stem/title logic, `_delete_draft` with draft key `teacher:<kind>`): create the `Chat` with `kind`, write the `teacher` object (`kind`, `topic`, `ideaSet` = given ids or `[]` for now, `questions: []`, `plans: []`, `graph: {processedTurns: 0, status: null}`), build the request with `system=prompts.system_prompt(...)`, and launch with a `BlockSplitter` + `on_piece` handler (T018). One version and one answer per turn (no regenerate/edit).
- [X] T018 [US1] Implement `teacher/view.py`: `on_piece(chat, answer_id, piece)` storing questions (`id` `q<n>` sequential per chat, `answerId`, `index`, `practice = kind == "practice"`, `revealed: false`, `hints: []`, `grades: []`, `submission: null`) and malformed segments into the chat file and returning the stream event; `view(chat, doc)` building `TeacherChatOut` with `segments` from `segments_of(raw)` and questions with `key`/`explanation` removed while `status == "unanswered"` and not `revealed`; keep `chats.unanswered_count` in step.
- [X] T019 [US1] Router `api/v1/teacher.py` for `GET/POST /sessions/{sessionKey}/teacher-chats`, `GET /teacher-chats/{chatId}`, `POST /teacher-chats/{chatId}/messages`, `GET /teacher/instructions`; register it in `api/v1/__init__.py`; problems use `api/errors.py` codes listed in `contracts/openapi.yaml`.
- [X] T020 [US1] Transcript rendering for teacher chats in `chat/files.py` per `contracts/teacher-chat-file.md` ("Lesson"/"Practice" header, "Teacher — <endpoint> · <model>" headings, prose from segments, questions as quoted blocks with status, key only when answered/revealed, action turns in plain words).
- [X] T021 [US1] Export OpenAPI and regenerate types: `uv run python -m unihelper.export_openapi ../frontend/openapi.json` and `corepack pnpm gen:api` (`frontend/src/lib/api/schema.d.ts`).
- [X] T022 [P] [US1] Frontend API hooks in `frontend/src/features/teacher/api.ts` (TanStack Query: list, get, start, send, instructions; keys `["teacher", sessionKey]`, `["teacher-chat", id]`) using `lib/api/client.ts`.
- [X] T023 [P] [US1] Add `registerTeacherSection`/`useTeacherSection` to `frontend/src/features/sessions/workspace-panels.ts`, mirroring `registerChatSection`.
- [X] T024 [US1] Render the third stacked section and the rail's AI Teacher button (`GraduationCap`, unseen-reply indicator, opens the panel with the section expanded) in `frontend/src/features/sessions/SessionPanel.tsx`; collapse, drag/keyboard boundary and remembered heights work for three sections (FR-001).
- [X] T025 [US1] `frontend/src/features/teacher/TeacherSection.tsx`: list per ui-contract (title, Lesson/Practice badge, relative time, "n open", unseen dot), New chat menu (Lesson / Practice), no-endpoint message with New chat disabled (FR-007); register in `frontend/src/features/teacher/routes.tsx` and load that module where `features/chat/routes.tsx` is loaded.
- [X] T026 [US1] Tab kind `teacher` in `frontend/src/features/sessions/WorkspacePage.tsx` (open/focus a chat's tab, `new-teacher-*` tabs for unsent chats, label + `GraduationCap` icon; closing a tab never stops the run — FR-045).
- [X] T027 [US1] `frontend/src/features/teacher/TeacherTab.tsx`: three regions (Questions / Teacher / Current question) with `PanelResizeHandle` between them, defaults 240 / flex / 360 px, widths remembered in UI preferences, F6 cycling, narrow rules (< 1100 px Questions becomes a header toggle; < 800 px Current question stacks below Teacher).
- [X] T028 [US1] `frontend/src/features/teacher/TeacherConversation.tsx`: turns rendered with 014 `AnswerMarkdown`, 014 `MessageBox` (draft key = chat id or `teacher:<kind>`), streaming via the 014 `runStore`; the first send calls start and swaps the `new-teacher-*` tab to the chat id.
- [X] T029 [P] [US1] Vitest `frontend/tests/unit/teacher/TeacherSection.test.tsx` (list rendering, New chat menu, disabled state with reason, axe) and `TeacherTab.test.tsx` (three labelled regions, keyboard resize, axe).

**Checkpoint**: US1 independently demoable.

---

## Phase 4: User Story 2 — The teacher asks questions and the student answers them (P1)

**Goal**: Questions appear as cards; answers with confidence and thinking are submitted; choice graded at once, free text by the teacher; disputes re-grade; Mermaid/math render.

**Independent test**: Receive a choice check, answer it wrongly with Low confidence and thinking → it shows Incorrect in Questions; the next reply addresses the reasoning; Dispute grade adds a second grade.

### Tests (US2)

- [X] T030 [P] [US2] Unit tests `backend/tests/unit/test_teacher_grading.py`: choice grading, `submitted` state for text, answer-turn text (confidence `null` → "not given", never "low" — FR-020), grade application order, re-grade appends.
- [X] T031 [P] [US2] Contract tests in `backend/tests/contract/test_teacher.py`: `POST /teacher-chats/{chatId}/answers` (202 with `graded`; 409 `already_answered`, `run_active`; 422 `wrong_answer_kind`, `option_out_of_range`; 404 unknown question), `POST .../questions/{questionId}/dispute` (202; 409 `not_answered`), `POST .../malformed/{segmentId}/retry` (202; 404); SSE: a `question` event carries no `key`, `GET /teacher-chats/{id}` hides `key` until answered then shows it.
- [X] T032 [P] [US2] Integration `test_teacher_flow.py::test_answer_grade_dispute_stop`: choice server-graded; free text graded by a scripted `uh-grade`; dispute appends a teacher grade; Stop during an open `uh-question` yields `malformed: unterminated` and earlier questions stay answerable; restart (RunRegistry `recover`) mid-reply marks Interrupted and keeps questions.

### Implementation (US2)

- [X] T033 [US2] `teacher/turns.py`: `grade_choice(question, choice)`, `answers_text(questions, submissions)` (R5 wording), `dispute_text(question, reason)`, `retry_text(segment)`; and `apply_grade(doc, block)` for `uh-grade` (only for questions with a submission; for choice only when answering a dispute; invalid → dropped with a content-free warning log).
- [X] T034 [US2] In `services/teacher_service.py` add `submit_answers` (validate per data-model "Validation summary"; write `submissions` into a new user turn with `action: "answers"` and into each question's `submission`; server grades choice; save file **before** launching the run; return `graded`), `dispute` (`action: "dispute"`, `target`), `retry_malformed` (`action: "retry"`); all refuse with 409 `run_active` while the chat has an active run.
- [X] T035 [US2] Routes in `api/v1/teacher.py`: `POST /teacher-chats/{chatId}/answers`, `/questions/{questionId}/dispute`, `/malformed/{segmentId}/retry`; regenerate types (`export_openapi` + `corepack pnpm gen:api`).
- [X] T036 [P] [US2] Extend `frontend/src/features/chat/AnswerMarkdown.tsx` with a `mermaid` code-block renderer using the 013 sandbox (`src/sandbox/diagramRenderer.ts`, as `features/sessions/editor/diagram-math/nodes/DiagramNode.tsx` does) and KaTeX math; on render error show the source and the message (US2 scenario 7). AI chat answers gain the same rendering.
- [X] T037 [US2] `frontend/src/features/teacher/teacherRunEvents.ts`: subscribe to `question`, `malformed`, `grade`, `plan`, `hint` on the 014 run stream and update the `["teacher-chat", id]` query cache (append segments in event order; on `snapshot` refetch); live-region messages "Question n asked", "Answer graded: <grade>".
- [X] T038 [P] [US2] `frontend/src/features/teacher/cardDrafts.ts`: per chat+question draft (choice, text, confidence, thinking) in localStorage wrapped in try/catch, cleared on successful submit.
- [X] T039 [US2] `frontend/src/features/teacher/QuestionCard.tsx`: prompt (Markdown), RadioGroup (choice) or Textarea (text), Confidence ToggleGroup Low/Medium/High clearable ("Not set"), "Your thinking (optional)", Submit disabled with reason while streaming; graded view with answer, confidence, thinking, key, explanation, all grades in order, **Dispute grade** (optional reason) and "Ask to grade" for an ungraded free-text answer.
- [X] T040 [US2] `frontend/src/features/teacher/CurrentQuestion.tsx`: all unanswered cards in order with one **Submit answers** for filled cards and per-card submit (FR-021); shows the selected question read-only otherwise.
- [X] T041 [US2] In `TeacherConversation.tsx` render `question` segments as chips that select the question, `malformed` segments as an inline alert "This question could not be displayed" with Retry, and action turns compactly ("Answered Q1, Q2", "Disputed Q3").
- [X] T042 [P] [US2] Vitest `frontend/tests/unit/teacher/QuestionCard.test.tsx` (keyboard-only answer + submit, confidence unset vs Low, disabled while streaming, dispute flow, key not rendered before answer, axe).

---

## Phase 5: User Story 3 — Review the questions of a lesson (P1)

**Goal**: Questions column lists every question with status and filters; selecting shows the record and scrolls the Teacher column.

**Independent test**: In a chat with five answered questions, select the second → full record shown, Teacher column scrolled and highlighted.

- [X] T043 [US3] `frontend/src/features/teacher/QuestionsColumn.tsx`: listbox of `qN · title · status icon + text label` (Unanswered, Waiting for grade, Correct, Partly correct, Incorrect — FR-022), filter ToggleGroup All / Unanswered / Incorrect (FR-024), virtualised or windowed for 200 items (SC-006).
- [X] T044 [US3] Selection wiring in `TeacherTab.tsx`: selecting a question shows it read-only in `CurrentQuestion` (key hidden if unanswered — US3 scenario 2) and scrolls the Teacher column to its chip with a brief highlight (none under reduced motion).
- [X] T045 [P] [US3] Vitest `frontend/tests/unit/teacher/QuestionsColumn.test.tsx`: filters, status text, selection scroll call, 200 items render, axe.

---

## Phase 6: User Story 4 — See the lesson plan (P2)

**Goal**: Plan button opens the latest plan diagram with the current step marked.

**Independent test**: After probing, open Plan → diagram rendered; after a revised plan block, the new version shows.

- [X] T046 [US4] Backend: in `teacher/view.py` `on_piece` store `uh-plan` blocks as plan versions (`version` 1,2,…, `answerId`, `mermaid`, `current`, `createdAt`) and emit `plan`; leave a "Plan updated" markdown segment; add a contract assertion in `backend/tests/contract/test_teacher.py` that `GET /teacher-chats/{id}` returns `plans` with increasing versions.
- [X] T047 [US4] `frontend/src/features/teacher/PlanDialog.tsx` + header **Plan** button in `TeacherTab.tsx` (shown once a plan exists — FR-011): render latest plan through the Mermaid renderer with `class <current> current` and a `classDef current` built from theme variables; "(current)" in the node's accessible description; side sheet on narrow windows.

---

## Phase 7: User Story 5 — Manage teacher chats (P2)

**Goal**: Rename, delete (with graph impact), close/reopen without loss, attachments as context.

**Independent test**: Rename a lesson; delete it → confirmation shows idea count; closing the tab mid-reply finishes and shows the unseen indicator; attach a note → teacher uses it.

- [X] T048 [P] [US5] Contract tests: `PATCH /chats/{chatId}` rename and `DELETE /chats/{chatId}` + restore work on a lesson; `GET /teacher-chats/{chatId}/graph-impact` (200 count; 404).
- [X] T049 [US5] Implement `GET /teacher-chats/{chatId}/graph-impact` in `services/knowledge_graph_service.py` (`impact_of_chat`: ideas whose only visible sources belong to this chat) and `api/v1/teacher.py`; extend `services/trash_service.py` session deletion-impact with `teacherChats` and `graphIdeas` (contracts/openapi.yaml amended operations) and update the owning test.
- [X] T050 [US5] Row menu Rename/Delete in `TeacherSection.tsx` (Delete confirmation text includes "n ideas will be removed from your knowledge graph" when n > 0; 014 Undo toast kept); deleting closes the tab.
- [X] T051 [US5] Attachments in the teacher message box use 014's `AttachMenu`, upload and privacy-notice paths unchanged (FR-046); verify in `frontend/tests/unit/teacher/TeacherTab.test.tsx` that attaching a note sends `attachments`.

---

## Phase 8: User Story 6 — Knowledge graph on the home page (P2)

**Goal**: Lessons feed a per-user graph (idle 5 min / tab close / Update graph); the home right panel shows it; lessons start from a course's ideas, editable.

**Independent test**: Finish a short lesson, close its tab; on Home → Knowledge graph, find an idea by name, select it, follow its source to the lesson.

### Tests (US6)

- [X] T052 [P] [US6] Unit tests `backend/tests/unit/test_knowledge_graph_merge.py`: `domain/kg_names.normalize` (casefold, punctuation stripped, spaces collapsed), merge by `existingId`, merge by normalized name, link signature dedupe, premise ≠ conclusion, prune of sourceless ideas/links.
- [X] T053 [P] [US6] Contract tests `backend/tests/contract/test_knowledge_graph.py`: `GET /knowledge-graph`, `GET /knowledge-graph/ideas` (q search; `courseId` + `sort=recent` + `limit=30`), `GET /knowledge-graph/ideas/{ideaId}` (followsFrom, leadsTo, sources; 404), `DELETE /knowledge-graph/ideas/{ideaId}` (204 removes links; chat file unchanged; 404); and in `test_teacher.py`: `POST /teacher-chats/{chatId}/graph-update` (202; 409 `not_lesson` for practice), `PUT /teacher-chats/{chatId}/idea-set` (200; 422 `too_many_ideas` for 31, `unknown_idea`).
- [X] T054 [P] [US6] Integration `test_teacher_flow.py::test_graph_extraction_lifecycle`: fake clock → lesson idle 5 min → worker extracts (scripted JSON) → ideas + links + sources with `course_id` and `message_id`; second lesson teaching the same idea merges (no duplicate, SC-008); extraction failure → `kg_status failed`, lesson unaffected, retry works; soft-deleted chat hides its sources; after sweep hard delete, orphan ideas pruned.

### Implementation (US6)

- [X] T055 [P] [US6] `domain/kg_names.py`: `normalize(name) -> str` (pure).
- [X] T056 [US6] `services/knowledge_graph_service.py`: `graph(user)` (visible sources only; `version` = hash of max updated/ids), `search(user, q, course_id, sort, limit)`, `detail(user, idea_id)` (with `Source.sessionKey`, `sessionLabel`, `available`), `delete_idea` (+ links, prune), `prune(db)`, `default_set(user, course_id)` ("most recently taught first, up to 30"; empty for events), `merge(db, user, chat, extraction)` per R9 (one transaction; never rewrite an existing statement).
- [X] T057 [US6] Router `api/v1/knowledge_graph.py` for the four `/knowledge-graph*` operations; register in `api/v1/__init__.py`.
- [X] T058 [US6] `teacher/graph_worker.py`: lifespan loop every 60 s — select lesson chats with `deleted_at IS NULL`, `generating = false`, `updated_at` ≥ 5 min ago and `kg_processed_turns` < turn count (or `kg_status = 'pending'` from a trigger), plus `failed` ones attempted ≥ 1 h ago; one job at a time; build the extraction request (`prompts.EXTRACTION`, unprocessed turns, ≤ 200 same-course ideas with ids), collect streamed text through the adapter with `proxy_service.client`, parse `{ideas, links}`, call `merge`, set `kg_processed_turns`, `kg_status ok`; on any error set `failed` + `kg_error` category; mirror into the chat file's `teacher.graph`. A trigger queue (`asyncio.Queue`) puts chats from `graph-update` first. Start/stop it in `main.py` lifespan beside `_sweep_chats`.
- [X] T059 [US6] `POST /teacher-chats/{chatId}/graph-update` and `PUT /teacher-chats/{chatId}/idea-set` in `services/teacher_service.py` + `api/v1/teacher.py`; `start` uses `ideaIds` or `default_set` when null; `system_prompt` receives the idea set's names, statements and the links among them, skipping deleted ideas (FR-017).
- [X] T060 [US6] Call `knowledge_graph_service.prune` after hard deletes in `chat/sweep.py::purge_deleted` (and after trash purge of session folders, where chats cascade, in `services/trash_service.py`).
- [X] T061 [US6] Regenerate `frontend/openapi.json` and `schema.d.ts`; add `frontend/src/features/graph/api.ts` (graph, search, detail, delete) and idea-set/graph-update hooks to `features/teacher/api.ts`.
- [X] T062 [P] [US6] `frontend/src/features/graph/layout.ts`: `layout(graph, previous?) -> Map<id,{x,y}>` with `d3-force` (link + many-body + center, 300 ticks, warm start from previous positions, deterministic seed) — plus a Vitest that 2,000 nodes finish under 1.5 s in jsdom.
- [X] T063 [US6] `frontend/src/features/graph/GraphCanvas.tsx`: canvas drawing with colours read from CSS variables (`--primary`, `--muted-foreground`, `--border`, `--ring`, `--foreground`, `--background`) and redraw on theme change; pan (drag), zoom (wheel/pinch, +/−), Fit and `0`; labels above a zoom threshold or for selected node + neighbours; keyboard: focusable canvas, arrows to nearest neighbour in that direction, Enter select, Esc clear.
- [X] T064 [US6] `frontend/src/features/graph/IdeaList.tsx`, `IdeaDetail.tsx`, `GraphSection.tsx`: search field, Graph | List toggle, detail pane (statement, Follows from, Leads to, Sources linking to the session workspace with the teacher tab focused at the message — FR-033, Delete idea with confirmation — FR-034), empty state "Ideas appear here as lessons are taught."
- [X] T065 [US6] Add the `graph` switch (Graph icon, "Knowledge graph") to the section ToggleGroup in `frontend/src/features/home/TasksPanel.tsx`, remembered like tasks/notes/time, rendering `GraphSection`.
- [X] T066 [US6] `frontend/src/features/teacher/IdeaSetPopover.tsx`: header "Ideas (n)" and the new-chat variant above the message box pre-filled from `GET /knowledge-graph/ideas?courseId=…&sort=recent&limit=30` (none for events); Remove buttons, search-to-add from any course, refuses a 31st with "Up to 30 ideas"; sends `ideaIds` on start or `PUT idea-set` later.
- [X] T067 [US6] Lesson tab graph status line + **Update graph** button in `TeacherTab.tsx` ("Graph update pending", "Updating graph…", "Graph not updated — Retry"); closing a lesson tab calls `graph-update` (`WorkspacePage.tsx` close handler).
- [X] T068 [P] [US6] Vitest `frontend/tests/unit/teacher/GraphSection.test.tsx` and `IdeaSetPopover.test.tsx`: list view keyboard/screen-reader path, detail pane, delete confirm, 30-idea limit, axe.

---

## Phase 9: User Story 7 — Practice sessions (P3)

**Goal**: Practice chats pose problems with Hint and Reveal, from a topic or the idea set, and never feed the graph.

**Independent test**: New chat → Practice, name a topic → problem card → Hint → submit attempt → graded; Reveal on another problem shows the solution.

- [X] T069 [P] [US7] Contract tests in `test_teacher.py`: `POST .../questions/{questionId}/hint` (202; 409 `not_practice` on a lesson, `already_answered`), `POST .../questions/{questionId}/reveal` (200 with `key`; 409 `not_practice`); practice start with `topic`; practice chats never get `kg_status` and the worker skips them.
- [X] T070 [US7] Backend: `hint` (user turn `action: "hint"`, `target`, optional attempt text) and `reveal` (sets `revealed`, returns the question with key) in `services/teacher_service.py` + routes; `on_piece` records `uh-hint` on the question and emits `hint`; `prompts.PRACTICE` used for `kind = practice` with `topic` or the idea set (FR-042).
- [X] T071 [US7] Frontend: Practice in the New chat menu with an optional "Topic" field; practice cards in `QuestionCard.tsx` add **Hint** (hints listed in order) and **Reveal solution** (confirm first); no graph status line or Update graph for practice tabs.

---

## Phase 10: Polish & cross-cutting

- [X] T072 [P] Teacher instructions read-only view in Settings → AI (`frontend/src/features/settings/`), three collapsible sections from `GET /teacher/instructions` (FR-014).
- [X] T073 [P] Playwright `frontend/tests/e2e/teacher.spec.ts` with the fake LLM model `teacher` (seed via `backend/tests/e2e_seed.py`): start lesson, answer, dispute, plan, close tab, graph on Home, follow source; keyboard only; light and dark themes.
- [X] T074 [P] Slow test `backend/tests/integration/test_knowledge_graph_scale.py` (`UNIHELPER_SLOW_TESTS=1`): 2,000 ideas / 3,000 links → `GET /knowledge-graph` < 300 ms, search < 100 ms.
- [X] T075 Run the full suites and fix: `uv run ruff check . && uv run mypy && uv run pytest` (full run: every 022 operation exercised, no key leak in teacher files), `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`.
- [X] T076 Walk through `specs/022-ai-teacher/quickstart.md` manual scenario with a real model (SC-001, SC-003, SC-004, SC-007, SC-010) and record any issues in `specs/KNOWN-ISSUES.md`.

---

## Dependencies & execution order

- **Setup (T001–T004)** → **Foundational (T005–T014)** → stories.
- T005 → T006, T007. T009 → T010, T011. T011 + T012 + T013 → T017.
- **US1 (T015–T029)** first (MVP). **US2** needs US1's service/view/tab. **US3** needs US2's
  cards. **US4** needs US1 (plan blocks) and the Mermaid renderer from T036. **US5** needs US1;
  its graph-impact count is meaningful after US6 but works (returns 0) before. **US6** needs US1
  (lessons exist); T056 → T057/T058/T059/T060; T062 → T063 → T064 → T065. **US7** needs US2.
- **Polish** last.

```text
Setup → Foundational → US1 → US2 → US3
                         ├──→ US4 (after T036)
                         ├──→ US5
                         └──→ US6 ──→ (US5 graph-impact text)
                               US2 ──→ US7
```

## Parallel examples

- Foundational: T006, T007, T009, T012 together; then T010 with T011.
- US1: T015, T016, T022, T023 together; after T017–T019, T024–T028 on the frontend while T020
  runs on the backend.
- US2: T030, T031, T032, T036, T038 together.
- US6: T052, T053, T054, T055, T062 together; frontend T063–T066 after T061 while T058 is built.

## Implementation strategy

1. **MVP = Setup + Foundational + US1 + US2 + US3** (all P1): a working teacher with
   questions, grading and review. Demo and validate against quickstart steps 1–4.
2. Add **US4** (plan) and **US5** (manage) — small.
3. Add **US6** (knowledge graph) — the largest increment; ship backend + worker before the
   home view so the graph fills while the UI is built.
4. Add **US7** (practice).
5. Polish, full test runs, manual quickstart.
