# Implementation Plan: Course Timeline & Session Notes Workspace

**Branch**: `002-course-session-notes` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-course-session-notes/spec.md`

## Summary

Replace the course placeholder page with a month-grouped timeline of every session (including
"no longer scheduled" sessions that have notes), and add a three-panel session workspace: session
timeline + note list (left), tabbed Markdown editor with live preview (main), and a reserved audio
panel (right, filled by feature 003). Notes are plain `.md` files in lazily created, never-renamed
session folders; saving is autosave with atomic writes, optimistic versions, external-edit
detection and a local draft safety net. Everything plugs into feature 001's API, storage, session
keys and shell registries.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.9 / React 19 (frontend) — as 001

**Primary Dependencies**: 001 stack plus CodeMirror 6 (`@codemirror/state`, `view`, `commands`,
`language`, `search`, `lang-markdown`, `@lezer/markdown`, `@lezer/highlight`). No new backend
dependencies.

**Storage**: SQLite tables `session_folders`, `notes`, `workspace_states`, `ui_preferences`
(revision `0004_notes`); Markdown files under
`files/<user>/<Year>/<Semester>/<Course>/<class_date>/notes/`.

**Testing**: pytest (unit/contract/integration; contract-coverage guard extended to all
`specs/*/contracts/openapi.yaml`), Vitest + Testing Library + axe, Playwright light/dark.

**Target Platform**: as 001.

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: autosave ≤ 2 s after a pause (FR-018); session switch < 1 s (SC-003);
timeline of 300 sessions renders and scrolls to now immediately (SC-005, endpoint < 200 ms);
editing a 50k-word note stays responsive (CodeMirror viewport rendering).

**Constraints**: Never lose or silently overwrite note text (Constitution I, FR-019/020); files are
standard Markdown only (II, FR-023); UI via `/api/v1` only (III); tokens/keyboard/AA (V); SQLite
only (VII).

**Scale/Scope**: per user ≤ ~1,500 sessions with content, ≤ 50 notes per session, notes ≤ 5 MB.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 002 | Pre | Post-design |
|---|---|---|---|
| I. User work never lost | Autosave; failures retried and kept; no silent overwrite; confirmed deletes | PASS | PASS — 800 ms debounce/2 s max, keepalive flush on hide/unload, local draft until confirmed, atomic writes, 412/409 conflicts with "Keep both" default, delete only after AlertDialog |
| II. Data ownership | Notes are `.md` in the readable hierarchy | PASS | PASS — `storage-notes.md`; files adopted when edited externally |
| III. Strict separation | UI only via `/api/v1` | PASS | PASS — 6 new paths in `contracts/openapi.yaml`; only `StorageService` touches disk |
| IV. Pluggable transcription | Right panel reserved, no provider logic | N/A | N/A — `registerWorkspacePanel` slot for 003 |
| V. UI quality | shadcn primitives, taste-skill, tokens, keyboard, AA | PASS | PASS — editor themed from tokens; tablist semantics; shortcuts table; muted text AA |
| VI. Testing | Every endpoint tested | PASS | PASS — contract tests per path; integration test for autosave/conflict/folder flow; coverage guard covers 002 contract |
| VII. Simplicity | No new infrastructure; spec scope only | PASS | PASS — CodeMirror is the only new dependency family (justified in research N1); no search/templates/images |

**Note**: 001 promised the storage layer never deletes. 002's spec requires deleting a note's file
after confirmation; this is a narrowly scoped `delete_note_file` (single `.md` in a `notes/`
folder) — see research N6. It is a spec requirement, not a constitution violation (Principle I
allows confirmed destructive operations).

**Result**: all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/002-course-session-notes/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/
│   ├── openapi.yaml        # 6 new paths (+ additive change to GET /sessions/{key})
│   ├── ui-workspace.md     # timeline, workspace, editor, dialogs, shortcuts
│   └── storage-notes.md    # session folders and note files
└── tasks.md                # /speckit-tasks
```

### Source Code (changes to the existing layout)

```text
backend/src/unihelper/
├── models/session_folder.py · note.py · workspace_state.py · ui_preferences.py
├── db/migrations/versions/0004_notes.py
├── storage/storage_service.py        # + write_text_atomic, read_bytes, rename_file, delete_note_file
├── services/session_folder_service.py # get-or-create folder for a session key (+ snapshot)
├── services/note_service.py           # create/read/save/rename/delete, conflict detection
├── services/timeline_service.py       # course timeline incl. unscheduled sessions + counts
├── services/workspace_service.py      # workspace state + preferences
├── services/session_query.py          # GET /sessions/{key}: unscheduled-with-content fallback
├── schemas/notes.py
└── api/v1/notes.py · timeline.py · workspace.py
backend/tests/{unit,contract,integration}/…   # new modules per router/service

frontend/src/
├── features/courses/CoursePage.tsx            # timeline page
├── features/sessions/                         # workspace
│   ├── routes.tsx · api.ts · useNow.ts
│   ├── SessionTimeline.tsx                    # shared by course page + workspace left panel
│   ├── WorkspacePage.tsx · WorkspaceHeader.tsx · NoteList.tsx · NoteTabs.tsx
│   ├── NoteDialogs.tsx · ConflictDialog.tsx · workspace-panels.ts (registry for 003)
│   ├── autosave.ts                            # per-note save queue, drafts, retry, flush
│   └── editor/ MarkdownEditor.tsx · livePreview.ts · theme.ts · keymap.ts
└── tests/unit/… · tests/e2e/notes.spec.ts · timeline.spec.ts
```

**Structure Decision**: same web-app layout as 001; a new `features/sessions` module owns the
workspace, `features/courses` owns the timeline page.

## Phase 0 — Research

Complete: [research.md](./research.md) (N1–N11): editor choice and live preview, atomic note
storage, lazy session folders, autosave/conflict/draft strategy, external edits, scoped file
deletion, timeline computation, live status, workspace state/preferences, routes/shortcuts,
session switching.

## Phase 1 — Design & Contracts

Complete: [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-workspace.md](./contracts/ui-workspace.md),
[contracts/storage-notes.md](./contracts/storage-notes.md), [quickstart.md](./quickstart.md).

Post-design Constitution Check: all PASS (table above).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Live-preview correctness (cursor jumps, hidden marks) | Decorations computed from the syntax tree, only for visible ranges; unit tests on the decoration builder; raw mode always available |
| Lost text across reload/network loss | Local draft + keepalive flush + retry; E2E scenario 4/5 |
| Race between autosave and rename/delete/switch | Per-note serial save queue; rename/delete wait for the queue; version checks server-side |
| Windows file locks during `os.replace` (WSL/Windows) | Retry replace briefly; surface `file_busy` as a retriable save failure |
| Bundle growth from CodeMirror | Lazy-load the workspace route (`React.lazy`) |

## Complexity Tracking

> No violations to justify.
