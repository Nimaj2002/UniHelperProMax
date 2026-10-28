---

description: "Task list for 017 Session-Scoped Document Deletion"
---

# Tasks: Session-Scoped Document Deletion

**Input**: Design documents from `/specs/017-session-scoped-document-delete/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/documents-api.md,
quickstart.md

**Tests**: Included. Constitution Principle VI requires automated tests for every new or changed
endpoint, and the contract lists the required cases.

**Organization**: Tasks are grouped by user story (spec.md: US1 P1, US2 P1, US3 P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2 or US3

## Path Conventions

- Backend: `backend/src/unihelper/`, tests in `backend/tests/{contract,integration,unit}/`
- Frontend: `frontend/src/`, tests in `frontend/tests/{unit,e2e}/`

---

## Phase 1: Setup

**Purpose**: Work on a feature branch (the spec was written while `main` was checked out).

- [X] T001 Create and switch to git branch `017-session-scoped-document-delete` from `main` (repository root)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `DocumentHide` table, its migration and its backup classification. US1 and US3
need them, and US2's cascade relies on them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add model `DocumentHide` (`__tablename__ = "document_hides"`) to `backend/src/unihelper/models/document.py`. Columns:
  - `session_folder_id`: String, FK → `session_folders.id`, `ondelete="CASCADE"`, PK part.
  - `document_id`: String, FK → `documents.id`, `ondelete="CASCADE"`, PK part, `index=True`.
  - `user_id`: String, FK → `users.id`, `ondelete="CASCADE"`, `nullable=False`, `index=True`.
  - `created_at`: String, `nullable=False`, `default=now_iso`.
  - Primary key `(session_folder_id, document_id)`.
  - Docstring: "A course PDF hidden from one session's list (017); the PDF itself is untouched."
- [X] T003 Export `DocumentHide` from `backend/src/unihelper/models/__init__.py`: add it to the `from unihelper.models.document import …` line and to `__all__`.
- [X] T004 Create Alembic migration `backend/src/unihelper/db/migrations/versions/0015_document_hides.py`. Set `revision = "0015"` and `down_revision = "0014"`, with a docstring in the style of `0014_data_epoch.py`.
  - `upgrade()` creates `document_hides` with exactly the columns, FKs (`ON DELETE CASCADE`), composite PK and indexes from T002.
  - `downgrade()` drops the table.
- [X] T005 [P] Add `"document_hides"` to `_INCLUDED` in `backend/src/unihelper/backup/tables.py`, after `"annotation_ops"`. It has `user_id`, so it needs no `PARENT` entry. Run `backend/tests/unit/test_backup_tables.py` to confirm the table is classified once and found by account.

**Checkpoint**: The migration applies, the model imports, and backup table tests pass.

---

## Phase 3: User Story 1 - Removing a PDF from another session's list keeps the original (Priority: P1) 🎯 MVP

**Goal**: In a session that doesn't own a PDF, the menu offers only "Remove from this session".
That hides the PDF in this session alone and never touches the file, its annotations or other
sessions. Hidden PDFs also leave this session's chat attach menu (FR-001–FR-005, FR-011, FR-013,
FR-014).

**Independent Test**: Upload a PDF to session 1 and annotate it. In session 5, remove it. Session
5 no longer lists it, and neither does its chat attach menu. Session 1 and session 3 still list
it. The file and sidecar in session 1's `documents/` folder are byte-identical.

### Tests for User Story 1

> Write these first and make sure they FAIL before implementing.

- [X] T006 [P] [US1] Create contract tests in `backend/tests/contract/test_document_hides.py`, reusing `backend/tests/contract/document_helpers.py`. They cover `PUT /api/v1/sessions/{key}/documents/{id}/hidden`:
  - 204 on success, and 204 again when the PDF is already hidden.
  - 404 for an unknown document, another user's document, or a document outside the session's course or event series.
  - 404 for an unknown session.
  - 409 `own_session` when the session owns the document.
  - 204 for a session with no folder yet; the folder is then created.
  - `GET /api/v1/sessions/{key}/documents` excludes the hidden PDF in that session but still lists it in the owning session and in a third session.
- [X] T007 [P] [US1] Add an integration test in `backend/tests/integration/test_documents_flow.py` that uses the real API, SQLite and temp dir:
  - Upload to session A and save an annotation.
  - Hide the PDF in session B.
  - Assert the PDF and sidecar bytes in A's `documents/` folder are unchanged.
  - Assert `GET /documents/{id}` and `/file` still work, and the reading position is kept.
- [X] T008 [P] [US1] Add frontend unit tests in `frontend/tests/unit/document-list.test.tsx` (vitest + vitest-axe):
  - A row whose `sessionKey` differs from the current session shows only "Remove from this session", with no Rename and no Delete.
  - Choosing it calls the hide API, calls `closeDocument(id)`, and shows a confirmation toast.
  - No axe violations.

### Implementation for User Story 1

- [X] T009 [US1] In `backend/src/unihelper/services/document_service.py`, change `list_documents` to exclude documents that have a `DocumentHide` row for the resolved session's folder: a `NOT EXISTS` subquery on `(session_folder_id, document_id)`. Skip the filter when `resolved.folder is None`. Update the docstring.
- [X] T010 [US1] In `backend/src/unihelper/services/document_service.py`, add `hide_document(db, storage, user, session_key, document_id) -> None`:
  - Resolve the session with `sfs.resolve`.
  - Load the document with `get_owned` and check it is in `scope_of(user, resolved)`; otherwise `not_found("Document")`.
  - Get the folder with `sfs.get_or_create_folder` (research R2).
  - If `document.session_folder_id == folder.id`, raise `ApiError(409, "own_session", "This PDF was uploaded to this session; delete it instead.")`.
  - Insert a `DocumentHide(user_id=user.id, session_folder_id=folder.id, document_id=document.id)` unless one exists (idempotent), then commit.
- [X] T011 [US1] In `backend/src/unihelper/api/v1/documents.py`, add `PUT /sessions/{session_key}/documents/{document_id}/hidden` with `status_code=204`. It calls `svc.hide_document` and returns `Response(status_code=204)`, in the style of the existing `delete_document` route.
- [X] T012 [US1] Regenerate frontend API types:
  - Run `python -m unihelper.export_openapi ../frontend/openapi.json` from `backend/`.
  - Run `npm run gen:api` in `frontend/`.
  - This updates `frontend/src/lib/api/schema.d.ts`.
- [X] T013 [US1] In `frontend/src/features/documents/api.ts`, add `hideDocument(sessionKey: string, id: string)`: a `PUT` to `/sessions/${enc(sessionKey)}/documents/${enc(id)}/hidden` via `apiFetch<void>`.
- [X] T014 [US1] Update the actions menu in `frontend/src/features/documents/DocumentList.tsx`:
  - When `d.sessionKey !== sessionKey`, render one `DropdownMenuItem` "Remove from this session" instead of Rename/Delete.
  - On select: call `hideDocument(sessionKey, d.id)`, call `closeDocument(d.id)`, then invalidate `documentsKey(sessionKey)` (and the hidden list key once T024 exists).
  - Then show `toast.success(\`Removed “${d.name}” from this session.\`)`. T030 adds its Undo action once the show endpoint exists (US3). Don't add an Undo button that does nothing.
  - Show errors through the existing toast/refresh pattern.
  - Keep the "· from <date>" marker (FR-011).
- [X] T015 [US1] In `frontend/src/features/sessions/WorkspacePage.tsx`, make `titleOf` fall back to the single-document query cache (`documentKey(id)` / `useDocument`) when a document tab's id isn't in `docById`. That way a PDF hidden in this session but opened from a chat chip still shows its name (research R4).
  - **Outcome**: no change needed. Chat chips never open PDFs as workspace tabs, removing a PDF closes its tab here (T014), and `WorkspaceTabs` already skips tabs it can't name.
- [X] T016 [US1] Confirm that `frontend/src/features/chat/AttachMenu.tsx` (which uses `useDocuments(sessionKey)`) no longer offers hidden PDFs (FR-013). Add a case to the chat attach unit test, or to T008's file, with a mocked list that omits the hidden PDF. Change no chat code unless the test fails.
  - **Outcome**: verified by reading the code. `AttachMenu` maps `useDocuments(sessionKey)` as is, and the backend list filter is covered by `test_hide_leaves_only_that_session`. A mocked-list test would be tautological, so none was added.

**Checkpoint**: US1 works on its own. Removing a PDF in a non-owning session hides it there only.

---

## Phase 4: User Story 2 - Deleting the PDF in the session it was uploaded to (Priority: P1)

**Goal**: Only the owning session offers "Rename…" and "Delete…". The delete confirmation warns
that the PDF disappears from every session. The server refuses delete and rename from other
sessions (FR-008–FR-010, FR-012).

**Independent Test**: Upload to session 1 and hide it in session 5. Delete it from session 1 and
confirm. The PDF disappears from every session and from session 5's hidden list, and its files
are gone. Calling `DELETE /documents/{id}?fromSession=<session 5 key>` on another PDF returns 409
and the file stays.

### Tests for User Story 2

- [X] T017 [P] [US2] Extend `backend/tests/contract/test_documents.py`:
  - `DELETE /api/v1/documents/{id}?fromSession=<owning key>` returns 204.
  - `?fromSession=<other session key>` returns 409 `not_owning_session`, and the PDF row and file remain on disk.
  - With no `fromSession`, today's behaviour (204) is unchanged.
  - `PATCH` with `{name}` and a non-owning `fromSession` returns 409 `not_owning_session`, and the name is unchanged.
  - `PATCH` with `{pageCount}` and a non-owning `fromSession` returns 200.
  - Deleting a document removes its `document_hides` rows (cascade).
- [X] T018 [P] [US2] Extend `frontend/tests/unit/document-dialogs.test.tsx` and `frontend/tests/unit/document-list.test.tsx`:
  - In the owning session the menu shows "Rename…" and "Delete…".
  - `deleteText` includes "It is also listed in the course's other sessions and will disappear from all of them." For an event, it says "event's other occurrences".
  - Rename and delete calls pass `fromSession`.

### Implementation for User Story 2

- [X] T019 [US2] In `backend/src/unihelper/services/document_service.py`, add an optional `from_session: str | None = None` parameter to `delete_document` and `rename_document`.
  - When it is given, resolve it with `sfs.resolve`. If it has no folder, or `folder.id != d.session_folder_id`, raise `ApiError(409, "not_owning_session", …)` before any change.
  - Delete's message: "This PDF belongs to another session. Remove it from this session instead, or delete it in the session it was uploaded to."
  - Rename's message: "Rename this PDF in the session it was uploaded to."
  - `set_page_count` stays unchanged.
- [X] T020 [US2] In `backend/src/unihelper/api/v1/documents.py`, add the optional query parameter `from_session: Annotated[str | None, Query(alias="fromSession")] = None` to `delete_document` and `patch_document`. Pass it to `svc.delete_document`, and to `svc.rename_document` only (not `set_page_count`). Then re-run T012's type regeneration.
- [X] T021 [US2] In `frontend/src/features/documents/api.ts`, change `renameDocument(id, version, name, fromSession)` and `deleteDocument(id, version, fromSession)` to append `?fromSession=${enc(fromSession)}`. Update the calls in `frontend/src/features/documents/DocumentList.tsx` to pass `sessionKey`.
- [X] T022 [US2] In `frontend/src/features/documents/DocumentList.tsx`, render "Rename…" and "Delete…" only when `d.sessionKey === sessionKey`. On a 409 `not_owning_session`, show the server message as a toast and refresh the list.
- [X] T023 [US2] In `frontend/src/features/documents/DocumentDialogs.tsx`, extend `deleteText(doc, kind)` to add "It is also listed in the course's other sessions and will disappear from all of them." Use "event's other occurrences" when the session is an event, with the kind supplied by the caller from the workspace session. Keep the annotation and "can't be undone" wording.

**Checkpoint**: US1 and US2 both work. A PDF can be deleted only from its owning session.

---

## Phase 5: User Story 3 - Bringing a removed PDF back to a session (Priority: P2)

**Goal**: A "Removed from this session (N)" control lists the PDFs hidden in this session, and
"Show in this session" restores one. Undo uses the same call (FR-006, FR-007).

**Independent Test**: Hide a PDF in session 5 and dismiss the toast. Open "Removed from this
session (1)" and choose "Show in this session". The PDF is listed again with "from <date>" and
the control disappears.

### Tests for User Story 3

- [X] T024 [P] [US3] Extend `backend/tests/contract/test_document_hides.py`:
  - `GET /api/v1/sessions/{key}/documents/hidden` returns the hidden PDFs newest first, `[]` for a session with no folder, and 404 for an unknown session.
  - `DELETE /api/v1/sessions/{key}/documents/{id}/hidden` returns 204 and lists the PDF again, returns 204 when it was not hidden or the session has no folder (no folder created), and returns 404 for a document outside the scope.
  - A hide in session B doesn't affect session C after "show" in B.
- [X] T025 [P] [US3] Extend `frontend/tests/unit/document-list.test.tsx`:
  - The "Removed from this session (N)" button is absent when N = 0.
  - It has `aria-expanded` and toggles with the keyboard.
  - "Show in this session" calls the show API.
  - The toast's Undo calls the show API.
  - No axe violations.
- [X] T026 [P] [US3] Add a backup roundtrip case to `backend/tests/integration/test_backup_roundtrip.py`: a `document_hides` row survives export → restore, and the restored session still hides the PDF (FR-007).

### Implementation for User Story 3

- [X] T027 [US3] In `backend/src/unihelper/services/document_service.py`, add:
  - `list_hidden_documents(db, storage, user, session_key)`: the scope's documents that have a `DocumentHide` for the session's folder, ordered `uploaded_at desc, id desc`, and `[]` if there is no folder. Map each through `view`.
  - `show_document(db, user, session_key, document_id) -> None`: check the document is in scope (404 otherwise), then delete the hide row for `(folder.id, document_id)` if the folder exists. It is idempotent and never creates a folder.
- [X] T028 [US3] In `backend/src/unihelper/api/v1/documents.py`, add:
  - `GET /sessions/{session_key}/documents/hidden` (`response_model=list[Document]`). Declare it before any `/sessions/{session_key}/documents/{document_id}` route that could shadow it.
  - `DELETE /sessions/{session_key}/documents/{document_id}/hidden` (204).
  - Then re-run T012's type regeneration.
- [X] T029 [US3] In `frontend/src/features/documents/api.ts`, add:
  - `hiddenDocumentsKey(sessionKey)`.
  - `useHiddenDocuments(sessionKey)`, a TanStack `useQuery` on `/sessions/${enc(sessionKey)}/documents/hidden`.
  - `showDocument(sessionKey, id)`, a `DELETE` on `/sessions/${enc(sessionKey)}/documents/${enc(id)}/hidden`.
- [X] T030 [US3] In `frontend/src/features/documents/DocumentList.tsx`, add the "Removed from this session (N)" disclosure below the list. Render it only when N > 0. It is a shadcn `Button` with `aria-expanded`/`aria-controls`, styled with theme tokens only.
  - When expanded, show each hidden PDF's name, size and "from <date>", with a "Show in this session" `Button`.
  - On show: call `showDocument`, then invalidate `documentsKey(sessionKey)` and `hiddenDocumentsKey(sessionKey)`.
  - Add an **Undo** action to the T014 toast that calls the same handler (FR-005).

**Checkpoint**: All three stories work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T031 [P] Add an e2e scenario to `frontend/tests/e2e/documents.spec.ts`, reusing `frontend/tests/e2e/documents-helpers.ts`:
  - Upload in session 1 and remove it in session 5.
  - Session 1 still lists and opens it.
  - Restore it via "Removed from this session".
  - Delete it from session 1 and see it gone from session 5.
- [X] T032 Run the backend gates: `cd backend && ruff check src tests && mypy src && pytest`. Fix any failure.
- [X] T033 Run the frontend gates: `cd frontend && npm test && npm run e2e -- documents.spec.ts`, plus the project's lint/typecheck scripts. Fix any failure.
- [ ] T034 Walk through `specs/017-session-scoped-document-delete/quickstart.md` steps 1–7 by hand: keyboard only, light and dark themes, restart, backup/restore. Note results in the PR description.
  - **Status**: not done by hand yet. Automated checks cover steps 1, 3 and 4, keyboard, and light/dark (e2e `017:` scenario in both Playwright projects); backup/restore (FR-007) is covered by `test_a_hidden_pdf_stays_hidden_after_a_restore`. Still open: the app restart (step 6) and the chat attach menu by hand (step 2).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T005)** → user stories.
- **US1 (Phase 3)** depends only on Foundational. It is the MVP.
- **US2 (Phase 4)** depends on Foundational. Its backend (T017, T019, T020) is independent of US1. Its frontend tasks T021–T022 edit the same `DocumentList.tsx` menu as T014, so do them after T014.
- **US3 (Phase 5)** depends on Foundational and on US1's hide endpoint, because a PDF must be hideable before it can be shown again. T030 adds the Undo action to the toast from T014.
- **Polish** comes after all stories.

### Within Each Story

- Tests first (they should fail), then service, endpoint, type regeneration, frontend API, and UI.
- `document_service.py`, `documents.py`, `api.ts` and `DocumentList.tsx` are shared across stories. Tasks touching the same file run in sequence.

### Parallel Opportunities

- T005 runs in parallel with T002–T004 (a different file).
- US1 tests T006, T007 and T008 run in parallel.
- US2 tests T017 and T018 run in parallel, and run in parallel with US1 implementation.
- US3 tests T024, T025 and T026 run in parallel.
- Backend work on US2 (T019–T020) can run alongside frontend work on US1 (T013–T016).

## Parallel Example: User Story 1

```bash
# Tests together:
Task: "Contract tests for PUT …/hidden and list exclusion in backend/tests/contract/test_document_hides.py"
Task: "Integration test: files untouched after hide in backend/tests/integration/test_documents_flow.py"
Task: "Unit tests for non-owning row menu in frontend/tests/unit/document-list.test.tsx"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T005 (branch, table, migration, backup).
2. T006–T016 (US1). This stops the reported bug: a non-owning session can no longer delete.
3. **Stop and validate** with quickstart step 1–2.

### Incremental Delivery

1. Add US2 (T017–T023). The server guard and the clearer confirmation in the owning session.
2. Add US3 (T024–T030). The way back for hidden PDFs, plus a working Undo.
3. Polish (T031–T034) and merge.
