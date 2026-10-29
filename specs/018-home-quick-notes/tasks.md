---

description: "Task list for 018 Home General Notes"
---

# Tasks: Home General Notes

**Input**: Design documents from `/specs/018-home-quick-notes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/general-notes-api.md, quickstart.md

**Tests**: Included. Constitution Principle VI requires automated tests for every endpoint (success
and primary errors), and the plan requires a migration test.

**Organization**: Tasks are grouped by user story so each story can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Paths: `backend/src/unihelper/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`

## Key facts every task can rely on

- A **general note** is a `Note` row with `session_folder_id = NULL`. Its file is at
  `<files_root>/<username>/General Notes/<file_name>` (research R1).
- The existing endpoints `GET /notes/{id}`, `PUT /notes/{id}/content`, `PATCH /notes/{id}` and
  `DELETE /notes/{id}` must work for general notes **without changing their contracts**.
- On screen the feature is called **"General notes"**. Never write "Quick notes": Feature 012's
  `frontend/src/features/tasks/QuickNotesPopover.tsx` already uses that name for task notes.
- Reuse these: `MarkdownEditor` (`frontend/src/features/sessions/editor/MarkdownEditor.tsx`);
  `ensureSaver` / `getSaver` / `removeSaver` / `useSaveStatus` (`frontend/src/features/sessions/autosave.ts`);
  `fetchNote` / `saveNoteContent` (`frontend/src/features/sessions/api.ts`);
  `ConflictDialog` (`frontend/src/features/sessions/ConflictDialog.tsx`); the shadcn `Dialog`
  (`frontend/src/components/ui/dialog.tsx`). See `frontend/src/features/sessions/WorkspacePage.tsx`
  (around lines 40–55 and 660–720) for how a note is loaded into a saver, flushed and closed.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The reserved folder name, shared by everything that follows

- [X] T001 Add `GENERAL_NOTES_DIR = "General Notes"` with a one-line comment (018: per-user folder of general notes; no year folder may take it) next to `EVENTS_DIR` in backend/src/unihelper/domain/naming.py
- [X] T002 [P] Add unit tests asserting `GENERAL_NOTES_DIR == "General Notes"` and that `safe_name(GENERAL_NOTES_DIR) == GENERAL_NOTES_DIR` in backend/tests/unit/test_naming.py

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, storage path and response shape that every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Write migration `0016` (revision `"0016"`, down_revision `"0015"`) in backend/src/unihelper/db/migrations/versions/0016_general_notes.py. In `batch_alter_table("notes")`, make `session_folder_id` nullable. Create the partial unique indexes `uq_notes_general_name` on `(user_id, name_key)` and `uq_notes_general_file` on `(user_id, file_key)`, both `sqlite_where=sa.text("session_folder_id IS NULL")`. The downgrade drops both indexes and deletes rows `WHERE session_folder_id IS NULL` before restoring `nullable=False`. The docstring follows the style of 0015_document_hides.py.
- [X] T004 Update the `Note` model in backend/src/unihelper/models/note.py: `session_folder_id: Mapped[str | None]` (nullable), plus the two partial `Index(..., unique=True, sqlite_where=...)` entries in `__table_args__`, matching T003 exactly.
- [X] T005 [P] Add a migration test that upgrades a 0015 database with existing session notes to 0016: rows are unchanged, a NULL-folder row can be inserted, and a second NULL-folder row with the same `(user_id, name_key)` is rejected. Put it in backend/tests/integration/test_migration_0016.py, following test_migration_0013.py.
- [X] T006 Change `NoteMeta.session_key: str` to `session_key: str | None` in backend/src/unihelper/schemas/notes.py.
- [X] T007 In backend/src/unihelper/services/note_service.py, add general-scope support without changing session behaviour: `_note_with_path` returns `folder=None` and `parts=[user.username, GENERAL_NOTES_DIR, note.file_name]` when `note.session_folder_id is None`; `meta(note, folder)` accepts `folder: SessionFolder | None` and returns `session_key=None` for it. Add a private helper `_same_scope(note_or_folder_id, user)` that returns the SQLAlchemy condition (`Note.session_folder_id == id`, or `Note.session_folder_id.is_(None) & (Note.user_id == user.id)`), and use it in `rename_note`'s clash and siblings queries.
- [X] T008 In backend/src/unihelper/services/hierarchy_service.py `get_or_create_year`, pass `[*siblings, GENERAL_NOTES_DIR]` to `_folder_for`, the same pattern as courses' `EVENTS_DIR` at line ~92, so no year folder can be named `General Notes` (FR-011).
- [X] T009 [P] Add a test that creating a year named "General Notes" keeps that display name but gets a folder name different from `General Notes`. Add it to the existing year/hierarchy contract tests in backend/tests/contract/ (find the file that tests year creation and append to it).
- [X] T010 Regenerate the OpenAPI types: run `python -m unihelper.export_openapi` (from backend, as the repo already does) and then `npm run gen:api` in frontend, updating frontend/openapi.json and frontend/src/lib/api/schema.d.ts. Fix any type errors from `session_key` now being nullable (`npm run typecheck`).

**Checkpoint**: The full backend suite still passes (`cd backend && pytest`), so session notes, search, timeline and backup are unaffected.

---

## Phase 3: User Story 1 - Jot a general note from the home page (Priority: P1) 🎯 MVP

**Goal**: From the home page, create a general note in a pop-up, type with autosave, close it, and find it listed and stored as `.md` in `<user>/General Notes/`.

**Independent Test**: Create a note from the home page, type, close, reload. It is listed with the same content, and the file exists in `General Notes/`.

### Tests for User Story 1 ⚠️

> Write these first and make sure they fail before implementing.

- [X] T011 [P] [US1] Contract tests in backend/tests/contract/test_general_notes.py, using helpers from backend/tests/contract/notes_helpers.py:
  - `POST /api/v1/general-notes` returns 201 with `session_key: null` and creates `<user>/General Notes/<name>.md`
  - `422 name_required` for an empty name; `422 name_too_long` for a name over 120 characters; `422 content_not_text` for content containing NUL
  - `409 name_taken` for a duplicate name, case-insensitive
  - `GET /api/v1/general-notes` returns `[]` when the folder is missing and lists created notes newest first
  - `GET`/`PUT /notes/{id}/content` work for a general note, including `412 version_conflict` and `409 file_changed_on_disk`
  - user B gets 404 on user A's general note through every endpoint (FR-017)
- [X] T012 [P] [US1] Integration test in backend/tests/integration/test_general_notes_flow.py with a real database and a temporary file system: create, save twice, edit the file on disk, then save with a stale hash gives 409 and the file is unchanged; drop `extra.md` into the folder and list, and it appears with its content; delete a file outside the app and list, and its row is gone; session notes in the same account are untouched.

### Implementation for User Story 1

- [X] T013 [US1] Add `create_general_note(db, storage, user, name, content="")` to backend/src/unihelper/services/note_service.py. Rules: `_clean_name` ("1–120 chars after `normalize_display`"), `_check_text`, uniqueness by `name_key` among the user's general notes (409 `name_taken`, with the message "A general note with this name already exists."), file name via `_file_name` plus the never-clobber loop, `storage.write_text_atomic` to `[username, GENERAL_NOTES_DIR, file_name]` (this creates the folder, FR-010), and the `on_rollback` file cleanup. Return the same shape as `create_note`.
- [X] T014 [US1] Add `list_general_notes(db, storage, user)` to backend/src/unihelper/services/note_service.py, per research R5:
  - scan only the top level of `<user>/General Notes/*.md`; a missing folder returns `[]`
  - insert a row for each file with no row: `name` is the file stem, `name_key`/`file_key` are derived, `content_hash` is `storage.hash_bytes`
  - delete rows whose file is gone
  - set `updated_at` from the file's modification time when it is newer than the row
  - return `meta()` for each note, sorted by `updated_at` descending
  - use a storage helper to list the folder (add `list_files(rel_parts, suffix)` to backend/src/unihelper/storage/storage_service.py if none exists; it must stay inside the storage root)
- [X] T015 [US1] Add `GET /general-notes` (`response_model=list[NoteMeta]`) and `POST /general-notes` (status 201, `response_model=Note`, request body is the existing create-note schema `{name, content?}`) to backend/src/unihelper/api/v1/notes.py, calling T013 and T014. Commit like the existing `create_note` route does.
- [X] T016 [P] [US1] Create frontend/src/features/home/generalNotesApi.ts:
  - `generalNotesKey = ["general-notes"]`
  - `useGeneralNotes()` — a `useQuery` on `/general-notes`
  - `useCreateGeneralNote()` — a `useMutation` POST that invalidates `generalNotesKey`
  - use the same `apiFetch` and `Schemas` types as frontend/src/features/sessions/api.ts
- [X] T017 [US1] Create frontend/src/features/home/GeneralNoteDialog.tsx with props `{ noteId: string | null; createdHere: boolean; onClose(): void }`:
  - built on shadcn `Dialog` + `DialogContent`, about `max-w-2xl h-[min(480px,80vh)]`, theme tokens only
  - header: a "General note" badge and the note name
  - load the note with `fetchNote`, then `ensureSaver(id, {content, version, hash}, saveFn)` where `saveFn` wraps `saveNoteContent` as WorkspacePage does
  - body: `MarkdownEditor` (with the user's `editor_mode` from `usePreferences`) whose `onChange` feeds the saver
  - show the save state with `useSaveStatus`: saving / saved / not saved
  - on close (X button, Escape, or overlay click): `await getSaver(id)?.flush()`; if that fails, keep the dialog open and show "Not saved — try again"
  - on success: invalidate `generalNotesKey`, call `removeSaver(id)`, then `onClose`
  - render `ConflictDialog` for the saver's conflict state, as WorkspacePage does
- [X] T018 [US1] Create frontend/src/features/home/GeneralNotesSection.tsx: a heading "General notes", a "New general note" button, and a list from `useGeneralNotes()`. Each row is a button showing the name and the relative last-changed time; clicking it opens `GeneralNoteDialog`. "New" calls `useCreateGeneralNote` with the name `General note YYYY-MM-DD HH-mm` (local time) and opens the dialog with `createdHere=true`. If that name is already taken (409), retry once with ` (2)` appended.
- [X] T019 [US1] Mount `<GeneralNotesSection />` at the bottom of the Tasks panel's column, below the board or list, in frontend/src/features/home/TasksPanel.tsx. It must not take over the task list's scroll area: the section gets its own scroll area with a max height of about 40% of the column.
- [X] T020 [P] [US1] Add a Vitest test in frontend/tests/unit/generalNotes.test.tsx, using the repo's fetch mocking and vitest-axe setup: create a note, type, close the dialog; it asserts that `saveNoteContent` was called before the dialog unmounted, and that there are no axe violations in the open dialog.

**Checkpoint**: The MVP works. A note can be created, autosaved, listed and found on disk.

---

## Phase 4: User Story 2 - Clearly tell general notes apart from main notes (Priority: P1)

**Goal**: The section and pop-up clearly read as a scratchpad, and the section is collapsible and remembers that.

**Independent Test**: The section shows the description and empty state; the pop-up shows the "General note" badge and no session tools; collapse it, reload, and it stays collapsed.

### Tests for User Story 2 ⚠️

- [X] T021 [P] [US2] Add a contract test to backend/tests/contract/test_general_notes.py: `PUT /api/v1/preferences` with `{"general_notes_collapsed": true}` round-trips through GET, and the default is `false`. Use the existing preferences endpoint path; check backend/src/unihelper/api/v1/workspace.py.

### Implementation for User Story 2

- [X] T022 [US2] Add the preference `general_notes_collapsed: bool | None = None` to `Preferences` in backend/src/unihelper/schemas/notes.py, and `"general_notes_collapsed": False` to `DEFAULT_PREFERENCES` in backend/src/unihelper/services/workspace_service.py. Then rerun T010's type generation.
- [X] T023 [US2] In frontend/src/features/home/GeneralNotesSection.tsx:
  - Under the heading, add the muted one-line description: "Scratchpad for quick thoughts that don't belong to a class. Lecture notes go in a class session."
  - Add an empty state: "No general notes yet. Use them for reminders, ideas and to-dos — not for lecture notes." plus the "New general note" button.
  - Add a collapse toggle on the header (`aria-expanded`, keyboard operable) bound to `general_notes_collapsed` through `usePreferences` / `useUpdatePreferences`. When collapsed, only the header is rendered (FR-019).
  - Style the section as visibly secondary: smaller heading and a muted surface token, never hard-coded colours.
- [X] T024 [US2] In frontend/src/features/home/GeneralNoteDialog.tsx, add a `DialogDescription`: "General note — not linked to any class." The dialog must not render any session tools (timeline, recordings, documents, chat, import/replace) and must not offer transcription (FR-005).
- [X] T025 [P] [US2] Extend frontend/tests/unit/generalNotes.test.tsx:
  - the empty state text renders
  - the collapse toggle calls the preferences update and hides the list
  - the dialog has an accessible name and description

**Checkpoint**: US1 and US2 both work on their own.

---

## Phase 5: User Story 3 - Find, reopen, rename and delete general notes (Priority: P2)

**Goal**: Notes can be reopened, renamed (unique names), deleted after confirmation, and new blank notes are discarded.

**Independent Test**: With several notes, open one, edit it, rename it, and delete another after confirming. The list and `General Notes/` both reflect the changes; a new note closed while blank leaves nothing behind.

### Tests for User Story 3 ⚠️

- [X] T026 [P] [US3] Add to backend/tests/contract/test_general_notes.py:
  - `PATCH /notes/{id}` renames a general note and its file on disk
  - renaming to another general note's name gives `409 name_taken`
  - renaming to a name used by a *session* note in the same account succeeds, because the scopes are separate
  - `DELETE /notes/{id}` removes both the row and the file

### Implementation for User Story 3

- [X] T027 [US3] Verify, and fix if needed, that `rename_note` and `delete_note` in backend/src/unihelper/services/note_service.py work for general notes through the T007 changes. The `name_taken` message must be scope-appropriate ("A general note with this name already exists." for general notes).
- [X] T028 [US3] In frontend/src/features/home/GeneralNoteDialog.tsx:
  - Make the header name an editable field. On blur or Enter, call the existing rename mutation pattern (`PATCH /notes/{id}` with the version), and on a 409 show the inline error "Another general note already has this name."
  - Add a "Delete" action that opens an `AlertDialog` confirmation (`frontend/src/components/ui/alert-dialog.tsx`). On confirm, call `DELETE /notes/{id}`, `removeSaver`, invalidate `generalNotesKey`, and close (FR-014, Principle I).
- [X] T029 [US3] In the close path of frontend/src/features/home/GeneralNoteDialog.tsx, after a successful flush (research R6):
  - If `createdHere` and the content is blank (`trim() === ""`), call `DELETE /notes/{id}` with no confirmation (constitution 1.5.0 Principle I allows this, FR-015).
  - Otherwise, if the name still matches `^General note \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?$` and the text has a non-empty first line, rename the note to that line with leading `#` and whitespace removed, cut to 60 characters. On a 409, keep the automatic name silently.
- [X] T030 [P] [US3] Extend frontend/tests/unit/generalNotes.test.tsx:
  - a blank new note is deleted on close
  - a note with text "Buy milk\n…" is renamed to "Buy milk"
  - delete asks for confirmation, and cancelling keeps the note

**Checkpoint**: All three stories work.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T031 [P] Add a Playwright end-to-end test in frontend/tests/e2e/general-notes.spec.ts covering quickstart.md steps 1–8: create, type math, Escape, see the list, rename, delete with confirmation, collapse and reload; keyboard only; run once in a dark theme.
- [X] T032 [P] Add `General Notes/` (one line, beside `_Events/`) to the user-facing folder layout description in backend/src/unihelper/backup/manifest.py, so the README text inside backups mentions the new folder.
- [X] T033 Add a backup round-trip check for a general note to backend/tests/integration/test_backup_roundtrip.py: after restore, the row (with `session_folder_id` NULL) and `General Notes/<file>.md` are both present (FR-020).
- [X] T034 Run the full gates: `cd backend && pytest && ruff check && mypy`, and `cd frontend && npm run typecheck && npm run lint && npm test`. Then do the manual checks from quickstart.md in light and dark themes, keyboard only (constitution quality gates).

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T010)** → the user stories.
- **US1 (T011–T020)** is the MVP and must come first: US2 and US3 extend its two components.
- **US2 (T021–T025)** and **US3 (T026–T030)** both depend on US1, and both edit `GeneralNoteDialog.tsx`, so do them one after the other (US2, then US3) rather than in parallel.
- **Polish (T031–T034)** comes after the stories it covers.

Within a phase: tests → service → endpoint → frontend API → components → mount.

## Parallel Opportunities

- Phase 1: T002 can be written alongside T001.
- Phase 2: T005 and T009 (tests) in parallel once T003/T004 and T008 are done.
- US1: T011 and T012 (backend tests) in parallel; T016 (frontend API) in parallel with T013–T015 (backend).
- Polish: T031 and T032 in parallel.

```text
# US1 parallel example
Task: "T011 Contract tests in backend/tests/contract/test_general_notes.py"
Task: "T012 Integration test in backend/tests/integration/test_general_notes_flow.py"
Task: "T016 frontend/src/features/home/generalNotesApi.ts"
```

## Implementation Strategy

1. **MVP**: Phases 1–3 (T001–T020), then validate with quickstart.md steps 1–5.
2. Add US2 (labelling and collapse): this is the user's "don't confuse it with main notes" requirement, so ship it together with the MVP if possible.
3. Add US3 (rename, delete, blank discard, auto-naming).
4. Polish: e2e test, backup check, full gates.

## Implementation Notes (2026-10-29)

- T009: the year tests live in backend/tests/contract/test_general_notes.py (create and rename).
- T011/T015: the suite requires every route in a `specs/*/contracts/openapi.yaml`, so
  contracts/openapi.yaml was added for 018, and `generalNotesCollapsed` was added to the 002
  `Preferences` schema (which forbids unknown keys). backend/tests/contract/test_preferences.py
  now expects the new default.
- T013/T027: `StorageService.delete_content_file` refused files outside `notes/`; it now also
  allows `.md` files directly in `<user>/General Notes/`.
- T020/T025/T030: frontend tests are in frontend/tests/unit/general-notes.test.tsx.
- T028: rename reuses the existing `NoteNameDialog` (a "Rename" button) instead of an inline
  field. `DeleteNoteDialog` gained an optional `where` prop for the folder wording.
- FR-018: the pop-up's own focus restore is turned off; the section returns focus to whatever
  opened it, or to "New general note" when that row was deleted. The e2e test caught this.
- E2E: port 8000 was busy locally, so the run used `E2E_BACKEND_PORT=8130 E2E_FRONTEND_PORT=5273
  E2E_TRANSCRIBER_PORT=8120 E2E_LLM_PORT=8121`.
- T034: automated gates all green (backend 1077 passed / 1 skipped, ruff, mypy; frontend typecheck, lint, 1098 unit tests, e2e 4/4 light+dark). The manual look-over in the running app was not done by hand.
- Follow-up (user request): the Tasks column now works like the session panel. Tasks and
  General notes are collapsible sections (frontend/src/features/home/tasksColumn.ts,
  TasksPanel.tsx) with a resizable boundary, and the closed panel's rail has a Tasks item (with
  its counts) and a General notes item (PanelRail.tsx; `SideRailItem.content` added in
  app/shell/SideRail.tsx). home-panels.spec.ts: the rail check now looks for the Tasks item, and
  the US10 tooltip test waits for the Calendar to stop widening before it points at the close
  button. It was already flaky before this change (1 failure in 6 runs).
