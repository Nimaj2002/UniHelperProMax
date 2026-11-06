# Implementation Plan: AI Teacher

**Branch**: `022-ai-teacher` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-ai-teacher/spec.md` (7 clarifications of
2026-11-05).

## Summary

Session and event workspaces get a third right-panel section, **AI Teacher**. It lists the
session's lesson and practice chats; each opens as a three-column workspace tab (Questions ·
Teacher · Current question). The teacher follows the LearnHarness method: probe, plan, one
reasoning step at a time, check every step, repair before building. Its questions appear as
answerable cards. Lessons feed a per-user **knowledge graph** shown in the home page's right
panel, and later lessons and practice start from it.

Technical approach:

- **Teacher chats are chats** (research R1). Same `chats` table with a new `kind` column, same
  `chats/` files in `uh-chat/1` with an added `teacher` object, same RunRegistry, SSE stream,
  Stop, drafts, uploads, attachments, privacy notice, soft delete and sweep. Durability
  (FR-043–FR-047) comes for free from 014.
- **Structured items are fenced JSON blocks** in the reply (`uh-question`, `uh-grade`,
  `uh-plan`, `uh-hint`; R2). No change to the three provider adapters.
- **A streaming splitter on the server** turns blocks into `question`/`grade`/`plan`/`hint`
  run events and withholds answer keys until the student answers or reveals (R3).
  Multiple-choice answers are graded by the server at once; free text by the teacher (R4).
- **The knowledge graph is SQLite** (ideas, links, premises, sources; R7) fed by a background
  **graph worker** that runs extraction when a lesson is idle 5 min, its tab closes, or on
  demand (R8), merging by model-reported identity plus normalized name (R9). Sources cascade
  with chat deletion; orphans are pruned (R10).
- **Frontend**: `features/teacher/` (section, tab, cards, plan, idea set) reusing 014's
  `MessageBox`, `runStore`, `AnswerMarkdown` (extended with the 013 Mermaid sandbox), and
  `features/graph/` (canvas view with `d3-force` layout + list view) as a new switch in the home
  `TasksPanel`.

## Technical Context

**Language/Version**: Python 3.12+ (FastAPI, SQLAlchemy 2, Alembic); TypeScript with React 19
(Vite, TanStack Query 5, react-router, shadcn/ui on Radix).

**Primary Dependencies**:
- **New frontend**, pinned exactly: `d3-force@3.0.0` (+ `@types/d3-force@3.0.10` dev) — layout
  only (R12, Complexity Tracking).
- **New backend**: none.
- **Reused**: 014 `ai/` adapters, `chat/runs.py` RunRegistry, `chat/files.py`, `chat/context.py`,
  `services/chat_service.py` helpers (`_model`, `_privacy`, `_context_parts`, `_launch` pattern);
  013 `sandbox/diagramRenderer.ts`, KaTeX; 014 `features/chat/{MessageBox, ModelPicker,
  AttachMenu, AnswerMarkdown, runStore, drafts}`; 008 `PanelResizeHandle`, `SideRail`.

**Storage**: Chat files in `<session folder>/chats/` (Principle II, unchanged layout);
SQLite: 5 new columns on `chats`, 4 new tables `kg_*` (migration `0019_ai_teacher.py`).

**Testing**: pytest (unit: splitter, grading, answer-turn text, merge/normalize, default idea
set; contract: every operation of `contracts/openapi.yaml`; integration: full lesson flow on real
SQLite + files with `fake_llm` scripted teacher). Vitest + Testing Library + axe for cards,
question list, idea-set popover, graph list/canvas keyboard. Playwright `teacher.spec.ts`.

**Target Platform**: Browser (dev) and the Electron desktop app; single backend process.

**Project Type**: Web application (backend + frontend) wrapped by desktop.

**Performance Goals**: Question select + scroll < 1 s in a 200-question chat (SC-006); graph of
2,000 ideas opens < 2 s, search < 1 s (SC-009); first teacher token latency = provider latency
(the splitter adds at most one line of buffering).

**Constraints**: Answer keys never in a response or event before answer/reveal (FR-018, FR-041);
keys never in files/logs (FR-047); one extraction job at a time; extraction never during a
streaming reply of that chat; single process (no `--workers`).

**Scale/Scope**: ≤ 200 questions per chat, ≤ 20 per reply; ≤ ~2,000 ideas / ~3,000 links per
user; ≤ 30 ideas per chat idea set; ≤ 200 same-course ideas sent to extraction.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| I. User work never lost | Submitted answers and messages are written to the chat file before the run starts; partial replies checkpointed every 2 s and marked Stopped/Interrupted (014 RunRegistry); card drafts persisted locally until submitted; deleting a chat or idea needs confirmation (chat delete keeps 014 Undo). Transcription untouched. | ✅ |
| II. Data ownership & open formats | Teacher chats are `uh-chat/1` JSON + regenerated Markdown in `chats/` — the location and format Principle II already prescribes; attachments in `.files/`. The graph is a derived index in SQLite with provenance back to chat files; Principle II does not list it among contents that must be files (R7). No new folders. | ✅ |
| III. Frontend/backend separation | All access through `/api/v1`; additive endpoints in `contracts/openapi.yaml`; existing endpoints change only additively (filtering `kind`, new enum value `teacher`, new deletion-impact fields). | ✅ |
| IV. Providers & secrets | Uses 014 endpoints/adapters through the existing interface; no new provider, no key handling; keys never in files, events, responses or logs (the full-run key-leak check covers teacher files). Remote privacy notice reused (FR-046). Extraction sends lesson text to the same endpoint (documented in spec Assumptions). | ✅ |
| V. UI quality & accessibility | shadcn primitives (ToggleGroup, RadioGroup, Textarea, Dialog, Popover, ScrollArea); theme tokens incl. canvas colours read from CSS variables; keyboard paths for every column and the graph (list alternative); status by icon + text. | ✅ |
| VI. Tests | Every new endpoint: success + main errors (contract tests). Integration test of the full lesson flow on real API/SQLite/files. Critical flows 1–3 unaffected. | ✅ |
| VII. Simplicity & spec discipline | SQLite only; worker is an in-process lifespan task like the chat sweep. One new frontend dependency (`d3-force`) — justified below. No scope beyond the spec. | ✅ (justified) |
| VIII. Desktop data safety | Migration 0019 runs through the existing pre-migration DB backup; no data outside the data folder. | ✅ |

Post-design re-check (after data-model and contracts): unchanged — all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/022-ai-teacher/
├── plan.md              # this file
├── research.md          # R1–R16 decisions
├── data-model.md        # chats columns, kg_* tables, teacher object, state machines
├── quickstart.md        # automated + manual validation
├── contracts/
│   ├── openapi.yaml         # new endpoints + amended existing ones
│   ├── teacher-blocks.md    # uh-question / uh-grade / uh-plan / uh-hint
│   ├── teacher-stream.md    # added run events
│   ├── teacher-chat-file.md # additions to uh-chat/1 + transcript
│   └── ui-contract.md       # section, tab, cards, graph view
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
backend/src/unihelper/
├── models/chat.py                 # + kind, unanswered_count, kg_* columns
├── models/knowledge_graph.py      # NEW KgIdea, KgLink, KgLinkPremise, KgSource
├── db/migrations/versions/0019_ai_teacher.py   # NEW
├── domain/teacher_blocks.py       # NEW pure streaming splitter + block validation
├── domain/kg_names.py             # NEW normalize name (pure)
├── teacher/                       # NEW package
│   ├── prompts.py                 #   lesson / practice / extraction instructions (own text)
│   ├── turns.py                   #   server-written action-turn text, grading of choice answers
│   ├── view.py                    #   segments + key redaction for reads
│   └── graph_worker.py            #   idle scan, queue, extraction, merge
├── services/teacher_service.py    # NEW start/send/answers/dispute/hint/reveal/retry/idea-set
├── services/knowledge_graph_service.py  # NEW read, search, detail, delete, prune, impact, default set
├── schemas/teacher.py, schemas/knowledge_graph.py   # NEW
├── api/v1/teacher.py, api/v1/knowledge_graph.py     # NEW routers
├── chat/runs.py                   # + optional per-run splitter hook; structured events; teacher finish
├── chat/files.py                  # transcript rendering for teacher chats
├── chat/sweep.py                  # + kg prune after hard deletes
├── services/chat_service.py       # list/get filter kind='chat'
├── services/workspace_service.py, schemas/notes.py  # TabRef.kind + "teacher"
├── services/trash_service.py      # deletion-impact + teacherChats, graphIdeas
└── main.py                        # start/stop graph worker in lifespan

backend/tests/
├── fake_llm.py                    # + scripted teacher and extraction replies
├── unit/test_teacher_blocks.py, test_teacher_grading.py, test_knowledge_graph_merge.py
├── contract/test_teacher.py, test_knowledge_graph.py
└── integration/test_teacher_flow.py, test_knowledge_graph_scale.py (slow)

frontend/src/
├── features/teacher/              # NEW
│   ├── TeacherSection.tsx         #   panel section + header actions (registerTeacherSection)
│   ├── TeacherTab.tsx             #   three columns, header (Plan, Ideas, Update graph)
│   ├── QuestionsColumn.tsx, CurrentQuestion.tsx, QuestionCard.tsx, TeacherConversation.tsx
│   ├── PlanDialog.tsx, IdeaSetPopover.tsx, cardDrafts.ts
│   ├── teacherRunEvents.ts        #   question/grade/plan/hint handling on 014 runStore
│   └── api.ts, routes.tsx
├── features/graph/                # NEW
│   ├── GraphSection.tsx           #   home TasksPanel switch body
│   ├── GraphCanvas.tsx, layout.ts (d3-force), IdeaDetail.tsx, IdeaList.tsx, api.ts
├── features/chat/AnswerMarkdown.tsx      # + mermaid code renderer via 013 sandbox
├── features/sessions/workspace-panels.ts # + registerTeacherSection
├── features/sessions/SessionPanel.tsx    # third section, rail button
├── features/sessions/WorkspacePage.tsx   # tab kind "teacher"
├── features/home/TasksPanel.tsx          # + "graph" switch
└── lib/api/schema.d.ts                   # regenerated

frontend/tests/unit/teacher/*, frontend/tests/e2e/teacher.spec.ts
```

**Structure Decision**: Existing web-application layout (backend + frontend + desktop wrapper).
The teacher is a new backend package and frontend feature folder that sit on top of 014's chat
modules instead of copying them; the graph is a separate service/feature because it is
user-wide, not session-scoped.

## Phases

- **Phase 0 — Research**: done, `research.md` (no open NEEDS CLARIFICATION).
- **Phase 1 — Design**: done, `data-model.md`, `contracts/*`, `quickstart.md`.
- **Phase 2 — Tasks**: `/speckit-tasks`. Suggested order: P1 (US1–US3: migration, splitter,
  teacher service and routes, section, tab, cards) → P2 (US4 plan, US5 manage, US6 graph) →
  P3 (US7 practice). The splitter and its unit tests come first; everything else depends on it.

## Risks

- **Model compliance with the block format** varies, especially on small local models. Mitigated
  by malformed handling + Retry (FR-025), server-side choice grading, and keeping prose usable on
  its own. SC-003/SC-004 are measured manually with a capable model (quickstart).
- **Duplicate ideas** if the model ignores `existingId` — normalized-name merge is the backstop;
  SC-008 is checked in the scripted integration test and manually.
- **Graph canvas in a narrow panel** (clarification Q3 chose no expand-to-tab) — labels hidden
  below a zoom threshold, Fit, and the List view keep it usable; revisit if users struggle.
- **Extraction cost**: one extra request per idle lesson, bounded to unprocessed turns plus
  ≤ 200 idea summaries.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `d3-force` (frontend dependency) | Force-directed layout of up to 2,000 ideas with links inside the panel (FR-032, SC-009). | Hand-written force simulation is more code to own and tune; Mermaid cannot lay out or interact with graphs this size and runs in a sandboxed iframe; Cytoscape/vis are much larger and bypass theme tokens. |
| Server-side streaming splitter for teacher runs (hook in RunRegistry) | Keep answer keys off the client until answered (FR-018, FR-041) and emit structured events. | Hiding blocks in the UI leaks keys through the network and replay buffer. |
| Graph worker (lifespan task) | Idle-5-min and tab-close extraction without blocking lessons (FR-029, FR-036). | Running extraction inside the reply run blocks the lesson and was rejected in clarification Q2. |
| 4 `kg_*` tables | Merge, provenance, cascade on chat deletion, search (FR-030, FR-031, FR-035). | One JSON file needs its own locking, merge and a constitution amendment for a new folder (R7). |
