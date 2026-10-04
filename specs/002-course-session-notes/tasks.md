---

description: "Task list for feature 002 — Course Timeline & Session Notes Workspace"
---

# Tasks: Course Timeline & Session Notes Workspace

**Input**: Design documents from `/specs/002-course-session-notes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (openapi.yaml,
ui-workspace.md, storage-notes.md), quickstart.md; feature 001 implemented.

**Tests**: INCLUDED (Constitution VI: every endpoint tested; FR-019/SC-002 need interruption
tests). Write each story's tests first and confirm they fail.

**Organization**: by user story. Order: US1 (notes, MVP) → US2 (timeline) → US3 (switching) →
US4 (manage notes) → US5 (live preview) → US6 (upcoming status).

## Format: `[ID] [P?] [Story] Description`

## Path Conventions

Backend `backend/src/unihelper/`, tests `backend/tests/`; frontend `frontend/src/`, tests
`frontend/tests/`. All 001 conventions apply.

---

## Phase 1: Setup

- [X] T001 Install CodeMirror 6 in `frontend/package.json`: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/lang-markdown`, `@lezer/markdown`, `@lezer/highlight`
- [X] T002 [P] Extend the contract tooling to every feature contract: `backend/tests/contract/openapi_check.py` loads and merges `specs/*/contracts/openapi.yaml` (schema names namespaced per file when they clash, `check(data, name, spec="002")`), `contract_operations()` returns the union; `backend/tests/contract/test_coverage.py` compares the live API with the union

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: blocks all stories.

- [X] T003 [P] Create `SessionFolder` model in `backend/src/unihelper/models/session_folder.py` per data-model.md: `user_id` FK CASCADE, `course_id` FK→courses ON DELETE CASCADE, `lineage_id`, `original_date` with "UNIQUE (lineage_id, original_date)", `folder_name`, `folder_key` with "UNIQUE (course_id, folder_key)", snapshot `start_time`, `end_time`, `title`, `location`, `created_at`
- [X] T004 [P] Create `Note` model in `backend/src/unihelper/models/note.py`: `session_folder_id` FK CASCADE, `name` "1–120 chars", `name_key` with "UNIQUE (session_folder_id, name_key)", `file_name`, `file_key` with "UNIQUE (session_folder_id, file_key)", `content_hash` (SHA-256 hex), `size`, VersionMixin, timestamps
- [X] T005 [P] Create `WorkspaceState` (PK user_id+lineage_id+original_date, `open_note_ids` JSON text, `active_note_id`, `updated_at`) and `UiPreferences` (PK user_id, `data` JSON text, `updated_at`) models in `backend/src/unihelper/models/workspace_state.py` and `backend/src/unihelper/models/ui_preferences.py`; export all new models from `backend/src/unihelper/models/__init__.py`
- [X] T006 Add Alembic revision `0004_notes` in `backend/src/unihelper/db/migrations/versions/` creating the four tables with their constraints
- [X] T007 Extend `backend/src/unihelper/storage/storage_service.py` (research N2/N6): `write_text_atomic(parts, text)` (temp `.<name>.tmp-<rand>` in same folder → flush+fsync → `os.replace` with brief retry for Windows locks → fsync dir where supported; returns `(sha256, size)`), `read_bytes(parts)` (None if missing), `file_hash(parts)`, `rename_file(old_parts, new_parts)` returning undo, `delete_note_file(parts)` (only a `*.md` file whose parent folder is named `notes`; raises otherwise); update `backend/tests/unit/test_storage_service.py` (atomic write leaves no temp files, replace keeps old file if the write fails, delete refuses directories and non-notes paths, the only deleting method is `delete_note_file`)
- [X] T008 Implement `backend/src/unihelper/services/session_folder_service.py`: `resolve_session(db, user, key)` → (session view or snapshot, course, semester, year, folder | None, scheduled flag) using 001 `session_query.find_session` with fallback to an existing `SessionFolder` (unscheduled); `get_or_create_folder(db, storage, user, key)` assigning `class_date_folder_name` among the course's existing folder names, snapshotting time/title/location, creating `<…>/<folder>/notes/` with `on_rollback` compensation not needed (mkdir only); `folder_parts(user, folder)` → path parts
- [X] T009 Make `GET /sessions/{sessionKey}` return unscheduled sessions that have a session folder with `scheduled: false` (snapshot times, `status` from start vs now) in `backend/src/unihelper/services/session_query.py` and add `scheduled: bool = True` to `SessionOut` in `backend/src/unihelper/schemas/classes.py`; contract test in `backend/tests/contract/test_classes_sessions_read.py`
- [X] T010 [P] Create schemas in `backend/src/unihelper/schemas/notes.py`: `NoteMeta`, `Note`, `NoteCreate` (name 1–120, content ≤ 5,242,880 chars default ""), `NoteRename`, `ContentSave` (content, baseHash), `SaveResult`, `TimelineEntry`, `Timeline`, `WorkspaceState` (≤ 50 ids), `Preferences` (extra="forbid", `editorMode` live|raw, two booleans)
- [X] T011 [P] Frontend module skeleton `frontend/src/features/sessions/`: `routes.tsx` (lazy-loaded `WorkspacePage` at `courses/:courseId/sessions/:sessionKey`), `api.ts` (typed hooks: `useNotes`, `useNote`, `useTimeline`, `useWorkspaceState`, `usePreferences` + mutations), `useNow.ts` (re-render at a given instant and every minute), `workspace-panels.ts` (registry `registerWorkspacePanel`, default placeholder); register routes in `frontend/src/app/features.ts`; regenerate API types
- [X] T012 [P] Register an "Open notes" session action in `frontend/src/features/sessions/routes.tsx` via 001 `registerSessionAction`, linking to `/courses/:courseId/sessions/:sessionKey`

**Checkpoint**: tables, storage primitives, session/folder resolution, routes exist.

---

## Phase 3: User Story 1 - Write notes for a session (Priority: P1) 🎯 MVP

**Goal**: Workspace with note list, tabs and an editor; notes autosave to `.md` files; nothing typed is lost.

**Independent Test**: Open a session workspace by URL, create two notes, type, reload → content persists and both files exist in `…/<date>/notes/`.

### Tests for User Story 1 ⚠️

- [X] T013 [P] [US1] Contract tests in `backend/tests/contract/test_notes.py`: `GET/POST /sessions/{key}/notes` (201 creates folder + empty file, optional initial content, 409 `name_taken` case-insensitive, 422 empty/whitespace/121-char names, 404 foreign/unknown key), `GET /notes/{id}` (content, hash, `missing`), `PUT /notes/{id}/content` (200 bumps version and hash; 412 `version_conflict` with `current`; 409 `file_changed_on_disk` and `file_missing` with `current`; 428 without If-Match; 404 foreign; 422 over 5 MB)
- [X] T014 [P] [US1] Integration test in `backend/tests/integration/test_notes_flow.py`: create two notes in a session → files `files/<user>/2026/Fall 2026/CS 201/2026-09-28/notes/Lecture notes.md` etc. with exact content after saves; a second session of the same course on the same date gets `2026-09-28 1400`; external edit adopted on GET; external edit before PUT → 409 and file untouched; atomic write failure (monkeypatched `os.replace`) leaves the previous content
- [X] T015 [P] [US1] Unit tests in `frontend/tests/unit/autosave.test.ts` for `autosave.ts` with fake timers: debounce 800 ms, max 2 s while typing, serial queue (one request in flight per note), version/hash advance after success, retry backoff on network error, draft written to localStorage before the request and cleared after success, `flush()` resolves when idle, 412/409 surface as conflict state (no retry)

### Implementation for User Story 1

- [X] T016 [US1] Implement `backend/src/unihelper/services/note_service.py`: `list_notes`, `create_note` (folder get-or-create, unique name/file name via `safe_name`+`unique_sibling`, atomic write of initial content), `get_note` (read file; adopt external edits by updating hash/size and bumping version; `missing` flag), `save_content` (If-Match version → 412; disk hash ≠ stored → 409 `file_changed_on_disk`/`file_missing`; else atomic write, update hash/size/version), problem extension `current: {version, hash, content}`
- [X] T017 [US1] Implement routers `backend/src/unihelper/api/v1/notes.py` (`GET/POST /sessions/{sessionKey}/notes`, `GET /notes/{noteId}`, `PUT /notes/{noteId}/content`) and register in `main.py`; allow `ApiError` to carry extra problem members (`current`) in `backend/src/unihelper/api/errors.py`
- [X] T018 [P] [US1] Implement `frontend/src/features/sessions/autosave.ts`: per-note `NoteSaver` (content, baseVersion, baseHash, status `saved|saving|dirty|error|conflict`), debounce/max-wait, serial queue, exponential retry (1→30 s), localStorage drafts `uh.draft.<noteId>`, `flush()`/`flushAll()`, keepalive save on `pagehide`, `beforeunload` guard while any saver is not `saved`; React hook `useNoteSaver(noteId)` exposing status
- [X] T019 [US1] Build `frontend/src/features/sessions/editor/MarkdownEditor.tsx` (CodeMirror 6, markdown language with GFM, history, search keymap, line wrapping, token-based theme in `editor/theme.ts`, `aria-label` = note name), keeping one `EditorView` and swapping per-tab `EditorState` + scroll position (US1 #5)
- [X] T020 [US1] Build the workspace in `frontend/src/features/sessions/WorkspacePage.tsx`, `WorkspaceHeader.tsx`, `NoteList.tsx`, `NoteTabs.tsx`: header (course, date, time, location, back link), left panel (note list + "New note"), tablist with per-tab save status text, editor, right panel slot showing the registered workspace panel (placeholder); "New note" dialog in `NoteDialogs.tsx` (name field, duplicate error) opening the new note in a tab with focus in the editor; on open restore local drafts (same base version → restore and save; older → conflict dialog)
- [X] T021 [US1] Build `frontend/src/features/sessions/ConflictDialog.tsx`: explains external vs other-window change, previews both texts, actions **Keep both** (default: create "<name> (my version)" with local text), **Use mine** (retry with `current` version/hash), **Use the file's version** (load current; draft kept until confirmed)
- [X] T022 [P] [US1] Component tests in `frontend/tests/unit/workspace-notes.test.tsx`: create note, tab appears with "Saved", duplicate name error, conflict dialog actions call the right API, axe clean

**Checkpoint**: MVP — notes are written, autosaved and safe.

---

## Phase 4: User Story 2 - Course timeline page (Priority: P1)

**Goal**: Course page lists every session by month with past/upcoming styling, counts, and "No longer scheduled" entries.

**Independent Test**: Course with sessions around today → page lists all in order, scrolled to current/next, each opens its workspace.

### Tests for User Story 2 ⚠️

- [X] T023 [P] [US2] Contract tests in `backend/tests/contract/test_timeline.py`: `GET /courses/{id}/timeline` order, full span (until, semester end, count rules), `noteCount`, `audioCount` = 0, unscheduled entry with `scheduled: false` after deleting a session that has a note, cancelled sessions without notes absent, 404 foreign
- [X] T024 [P] [US2] Performance test in `backend/tests/integration/test_timeline_performance.py`: 300 sessions → timeline < 200 ms (best of 5)
- [X] T025 [P] [US2] Component tests in `frontend/tests/unit/timeline.test.tsx`: month groups, upcoming badge + muted style, "No longer scheduled" badge, note count text, links to workspace, empty state, axe clean

### Implementation for User Story 2

- [X] T026 [US2] Implement `backend/src/unihelper/services/timeline_service.py` (course span, expand via 001 recurrence with exceptions, merge unscheduled folders with notes, grouped counts) and `GET /courses/{courseId}/timeline` in `backend/src/unihelper/api/v1/timeline.py`
- [X] T027 [US2] Build `frontend/src/features/sessions/SessionTimeline.tsx` (variants `page` and `compact`): month `<h2>` groups, rows as links with weekday/date, time, title, location, counts, "Upcoming"/"No longer scheduled" badges, live status via `useNow`; scroll current/next into view on mount
- [X] T028 [US2] Replace `frontend/src/features/courses/CoursePage.tsx` with the timeline page (header + `SessionTimeline` page variant + empty state linking to New class)

**Checkpoint**: US1 + US2 together form the core flow.

---

## Phase 5: User Story 3 - Switch between sessions (Priority: P2)

**Goal**: Left-panel session timeline switches sessions; tabs per session restored; no text lost on switch.

**Independent Test**: Open 2 tabs, switch session, return → same tabs/active tab; switch < 1 s.

### Tests for User Story 3 ⚠️

- [X] T029 [P] [US3] Contract tests in `backend/tests/contract/test_workspace.py`: `GET /workspace/{key}` default empty; `PUT` stores order and active id, drops unknown/foreign note ids, 422 > 50 ids or active not in list, 404 foreign key
- [X] T030 [P] [US3] Playwright E2E `frontend/tests/e2e/workspace-switch.spec.ts`: open two notes, switch via left timeline (< 1 s to show notes), come back → tabs restored; type then switch immediately → text saved; back/forward navigation

### Implementation for User Story 3

- [X] T031 [US3] Implement `backend/src/unihelper/services/workspace_service.py` + `GET/PUT /workspace/{sessionKey}` in `backend/src/unihelper/api/v1/workspace.py`
- [X] T032 [US3] Add the compact `SessionTimeline` to the workspace left panel (current session highlighted and scrolled into view); on session change `await flushAll()` then navigate; persist tab state (debounced 500 ms) and restore on load in `WorkspacePage.tsx`

---

## Phase 6: User Story 4 - Manage notes (Priority: P2)

**Goal**: Rename (file renamed), close tabs, delete with confirmation (file removed).

**Independent Test**: Rename → list, tab, file name change; close tab → note stays; delete → gone from list and `notes/`.

### Tests for User Story 4 ⚠️

- [X] T033 [P] [US4] Contract tests in `backend/tests/contract/test_notes_manage.py`: `PATCH /notes/{id}` (200 renames file, 409 duplicate, 412 stale, 422 invalid, 404 foreign), `DELETE /notes/{id}` (204 removes only that file, 412 stale, 404 foreign); rename rollback restores the file name on simulated DB failure
- [X] T034 [P] [US4] Component tests in `frontend/tests/unit/note-manage.test.tsx`: selecting an open note focuses its tab (never two tabs), close tab keeps note, rename dialog, delete AlertDialog text names the file

### Implementation for User Story 4

- [X] T035 [US4] Implement `rename_note` (unique name/file, `rename_file` + `on_rollback`) and `delete_note` (`delete_note_file`, remove from workspace states) in `note_service.py`; `PATCH`/`DELETE /notes/{noteId}` in `notes.py`
- [X] T036 [US4] Note list menus (Rename…, Delete…), tab close buttons and `Alt+W`; rename/delete wait for the note's save queue; delete AlertDialog per `ui-workspace.md`

---

## Phase 7: User Story 5 - Markdown live preview (Priority: P2)

**Goal**: Live mode renders formatting in place (raw on cursor line), raw mode toggle, remembered per user.

**Independent Test**: Type headings/lists/tasks/table/link → formatted in live mode; `Mod+E` → raw; mode survives reload; file has plain Markdown.

### Tests for User Story 5 ⚠️

- [X] T037 [P] [US5] Contract tests in `backend/tests/contract/test_preferences.py`: `GET /preferences` defaults, `PATCH` merges known keys, 422 unknown key or bad value
- [X] T038 [P] [US5] Unit tests in `frontend/tests/unit/live-preview.test.ts`: decoration builder hides heading/emphasis/code/link marks only outside the selection lines, task checkbox widget toggles `[ ]`↔`[x]`, tables replaced by a widget only when the cursor is outside, document text never changes except via checkbox toggle

### Implementation for User Story 5

- [X] T039 [US5] Implement `backend/src/unihelper/services/workspace_service.py` preferences + `GET/PATCH /preferences` in `workspace.py`
- [X] T040 [US5] Implement `frontend/src/features/sessions/editor/livePreview.ts` (ViewPlugin/StateField over the syntax tree: hidden marks, heading/emphasis/code/quote/link styling, checkbox widget, table widget, link click/`Mod-Enter` opens new tab) and the Live|Raw switch + `Mod+E` via a `Compartment`, persisted through `/preferences`

---

## Phase 8: User Story 6 - Upcoming sessions (Priority: P3)

**Goal**: Upcoming styling flips to past at start time without reload; notes always allowed.

### Tests for User Story 6 ⚠️

- [X] T041 [P] [US6] Unit test `frontend/tests/unit/use-now.test.tsx` with fake timers: a timeline row switches from "Upcoming" to normal exactly at its start time; workspace header badge likewise

### Implementation for User Story 6

- [X] T042 [US6] Derive status client-side in `SessionTimeline.tsx` and `WorkspaceHeader.tsx` with `useNow(nextStart)`; notes and the right panel are identical for upcoming sessions

---

## Phase 9: Polish & Cross-Cutting

- [X] T043 [P] Workspace keyboard shortcuts per `ui-workspace.md` (`Alt+N`, `Alt+W`, `Alt+PageDown/PageUp`, `Alt+[`/`Alt+]`, `Mod+E`, `Esc` → tab) in `frontend/src/features/sessions/useWorkspaceKeyboard.ts`; panel collapse persisted in `/preferences`; narrow screens use drawers
- [X] T044 [P] Playwright E2E `frontend/tests/e2e/notes.spec.ts` (light + dark, keyboard-only, axe): quickstart scenarios 1–4, 8–10, 12; reload within 1 s keeps text (SC-002)
- [X] T045 [P] Playwright E2E `frontend/tests/e2e/notes-resilience.spec.ts`: offline save (route aborts) → "Not saved — retrying" → recovers; external file edit → conflict → Keep both creates "(my version)"; large note (50k words) types and saves
- [X] T046 Run all checks (ruff, mypy, pytest incl. coverage guard over both contracts, eslint, tsc, vitest, playwright) and record results in `specs/002-course-session-notes/checklists/validation.md`; update `README.md` (notes on disk, editor shortcuts)

---

## Dependencies & Execution Order

- Setup → Foundational → US1 (MVP) → US2 → US3 → US4 → US5 → US6 → Polish
- US2 depends only on Foundational (can run parallel to US1); US3/US4 need US1's workspace; US5 needs US1's editor; US6 needs US2's timeline
- Within stories: tests first → backend → frontend

### Parallel Opportunities

- Foundational: T003–T005, T010–T012
- US1: T013–T015 together; T018 alongside T016/T017
- US2: T023–T025 together; US2 backend parallel to US1 frontend
- US3–US5 tests in parallel; Polish T043–T045

## Implementation Strategy

MVP = Phases 1–3 (notes in a workspace reached via calendar "Open notes"). Then timeline (US2),
switching (US3), management (US4), live preview (US5), live status (US6), polish.
