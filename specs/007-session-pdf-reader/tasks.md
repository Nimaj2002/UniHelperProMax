---

description: "Task list for feature 007 — Session Documents & PDF Reader"
---

# Tasks: Session Documents & PDF Reader

**Input**: `/specs/007-session-pdf-reader/` (plan, spec, research R1–R15, data-model, contracts
`openapi.yaml` · `ui-reader.md` · `annotation-file.md`, quickstart)

**Tests**: INCLUDED — Constitution VI requires tests for every endpoint; Principle I and II
guarantees (original never modified, nothing lost on conflicts or retries) get integration tests.
Tests first in each story.

**Order**: Setup → Foundational → US1 (upload, MVP) → US2 (refusals) → US3 (reader in tab bar +
split view) → US4 (last page) → US5 (search) → US6 (annotate) → US7 (rename/delete) → Polish.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add `"pdfjs-dist": "6.4.299"` (exact, no caret) to `frontend/package.json` dependencies and install; add `frontend/scripts/copy-pdfjs-assets.mjs` copying `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs}` to `frontend/public/pdfjs/` (idempotent, deletes stale files), run it from `predev` and `prebuild` scripts; add `frontend/public/pdfjs/` to `.gitignore`
- [X] T002 Spike (research R3, R14) — `frontend/src/features/documents/reader/pdfjs.ts`: `GlobalWorkerOptions.workerSrc` from `pdfjs-dist/build/pdf.worker.min.mjs?url`; `loadDocument(url)` = `getDocument({ url, disableAutoFetch: true, disableStream: false, rangeChunkSize: 262144, useWasm: false, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/", enableXfa: false })`. Load the quickstart sample set behind the real CSP (`backend/src/unihelper/main.py` policy, via the production build served by the backend) and record in `specs/007-session-pdf-reader/research.md` R3/R14: console CSP violations (expected none; if blob images are blocked, add `img-src 'self' data: blob:` in `main.py` and note it), and the gzipped size of the reader chunk and worker
- [X] T003 [P] PDF test fixtures `backend/tests/pdf_fixtures.py`: generate minimal valid PDFs as bytes without new dependencies — `text_pdf(pages, text)` (Helvetica text objects), `image_only_pdf(pages)` (no text), `encrypted_pdf()` (trailer with `/Encrypt`), `annotated_pdf()` (one `/Highlight` and one `/Text` annotation), `linked_pdf()` (internal `/GoTo` + `/URI` links), `truncated(pdf)`, `fake_pdf()` (`%PDF-` header, no `%%EOF`)
- [X] T004 [P] Frontend e2e fixtures `frontend/tests/e2e/pdf-fixtures.ts`: same generators as T003 in TypeScript (Buffer output) for Playwright `setInputFiles`

---

## Phase 2: Foundational (blocks all stories)

- [X] T005 Models + migration: `backend/src/unihelper/models/document.py` with `Document` (columns per data-model.md: `name` "1–120 chars" CHECK `length(name) BETWEEN 1 AND 120`; UNIQUE (`session_folder_id`, `name_key`); UNIQUE (`session_folder_id`, `file_key`); `original_file_name` String(255); `size` Integer "≤ 209,715,200"; `sha256` String(64); `encrypted` Boolean; `page_count` nullable; `uploaded_at`; IdMixin/TimestampMixin/VersionMixin), `DocumentPosition` (PK `user_id`,`document_id`; `page` CHECK ≥ 1), `AnnotationOp` (`op_id` String(64) PK, `document_id` FK cascade, `result_json`, `applied_at`); `WorkspaceState` + `tabs_json` Text nullable, `split_json` Text nullable; Alembic `backend/src/unihelper/db/migrations/versions/0009_documents.py` (revision "0009", down "0008"; `create_table` ×3 and `ADD COLUMN` ×2, no table rebuild); export from `models/__init__.py`
- [X] T006 [P] Integration test `backend/tests/integration/test_migration_0009.py`: populated 0008 DB (a note, a recording with a transcription job, a workspace state) upgrades to head with every row unchanged, new tables present, `tabs_json`/`split_json` NULL; downgrade drops them
- [X] T007 [P] `backend/src/unihelper/domain/pdf_probe.py` `probe_pdf(path) -> PdfProbe | None` (research R10): header `%PDF-1.` or `%PDF-2.` within the first 1024 bytes and `%%EOF` within the last 2048 bytes (seek, never read the whole file); `encrypted` = `/Encrypt` within the last 65,536 bytes; plus unit tests `backend/tests/unit/test_pdf_probe.py` with T003 fixtures (text, image-only, encrypted → `encrypted=True`, truncated → None, fake → None, PNG renamed → None, empty → None)
- [X] T008 `backend/src/unihelper/storage/storage_service.py`: `delete_content_file` accepts `documents/` with `.pdf` and names ending `.annotations.json`; add `rename_pair(old_parts, new_parts, sidecar)` returning one undo; `move_aside(parts, suffix)` for unreadable sidecars (never deletes); update the module docstring; tests in `backend/tests/unit/test_storage_service.py`
- [X] T009 [P] Schemas `backend/src/unihelper/schemas/documents.py` (`Document`, `DocumentPatch` {`name` 1–120, `pageCount` ≥ 1, at least one}, `Position`, `Annotation` with `type` enum `highlight|ink|textbox|comment`, `color` enum `yellow|green|blue|pink|orange|purple`, `text` max 10,000, `quoted` max 2,000, `rects` ≤ 500, `width` 0.5–24; `AnnotationOp`; `AnnotationOpsRequest` 1–200 ops; `AnnotationOpResult` status `ok|kept_both|kept_changed`) and additions to `backend/src/unihelper/schemas/notes.py`: `WorkspaceState.tabs/active/split` (optional on PUT), `Preferences.reader_dark_pages`
- [X] T010 [P] Frontend module skeleton `frontend/src/features/documents/` (`api.ts` typed calls, `routes.tsx` imported from `frontend/src/app/features.ts`); regenerate `frontend/src/lib/api/schema.d.ts` (`pnpm gen:api` after `python -m unihelper.export_openapi`); add tokens `--reader-page-dark-bg` / `--reader-page-dark-fg` to `frontend/src/styles/tokens.css` (identical in every theme; contrast ≥ 7:1, add to `tests/unit/tokens.contrast.test.ts`) and `frontend/src/styles/annotation-palette.json` (six named colours: Yellow, Green, Blue, Pink, Orange, Purple; each `{ fill, text }`, where `text` meets AA on white)
- [X] T011 Generalize the 006 upload queue: `frontend/src/features/imports/importQueue.ts` takes `{ upload: UploadFn, check: (file) => FileProblem | null, messages }` per instance; audio keeps its instance (`importQueue()`), add `documentQueue()`; existing tests `frontend/tests/unit/import-queue.test.ts` and `audio-files.test.ts` stay green

**Checkpoint**: migration and storage ready; all existing suites green except `test_coverage.py` (waits for the new routes).

---

## Phase 3: User Story 1 — Attach the lecture slides to a session (P1) 🎯 MVP

**Goal**: upload PDFs (button or drop) into the session's Documents section; listed with name, size and upload date; stored unchanged in `documents/`.

**Independent Test**: upload one PDF; it is listed with name, size and upload date; the file sits in `…/<date>/documents/` byte-identical.

- [X] T012 [P] [US1] Contract tests `backend/tests/contract/test_documents.py`: `POST /sessions/{key}/documents/import` 201 (`Document` schema, spec "007"; `name` = stem; `originalFileName`; `size`; `encrypted` false; `pageCount` null; `annotationCount` 0; `missing` false), name clash → "Name (2)" and the existing row unchanged, hand-copied file on disk never overwritten, upcoming session allowed, 404 foreign session; `GET /sessions/{key}/documents` newest first
- [X] T013 [P] [US1] Integration test `backend/tests/integration/test_documents_flow.py::test_upload_then_list`: stored file sha256 equals the upload; `files/.uploads/` empty after every request; client disconnect mid-upload leaves nothing (reuse `_asgi_upload` from `tests/integration/test_import_flow.py`)
- [X] T014 [US1] `backend/src/unihelper/services/document_service.py`: `list_documents`, `import_document` (006 pattern: `probe_pdf` → 422 `unreadable_pdf`; `session_import_lock`; name `normalize_display(stem)[:120]` or "Document", " (n)" suffix kept ≤ 120; file name `unique_sibling(safe_name(name) + ".pdf")` skipping DB names and on-disk files; `commit_upload` with `on_rollback`; sha256 while streaming; `encrypted` from the probe), `view()` with `missing`, `annotation_count` (from the sidecar, 0 when absent)
- [X] T015 [US1] Router `backend/src/unihelper/api/v1/documents.py` registered in `api/v1/__init__.py`: `GET /sessions/{session_key}/documents`, async `POST /sessions/{session_key}/documents/import` (copy of the 006 streaming route with `MAX = 209_715_200`, `.pdf` only)
- [X] T016 [US1] Frontend: `frontend/src/features/documents/DocumentList.tsx` (name, size via `formatBytes`, upload date, badges "File missing"/"Protected", ⋯ menu placeholder), `UploadPdfButton.tsx` (`accept=".pdf,application/pdf"`, multiple), drop zone on the section (reuse `AudioDropZone` generalized to `FileDropZone` with a label prop), upload rows (reuse `UploadList` with the `documentQueue()`), registered as a section below the note list in `frontend/src/features/sessions/WorkspacePage.tsx` via a new `registerSidePanelSection` hook in `frontend/src/features/sessions/workspace-panels.ts`
- [X] T017 [US1] Toasts and list refresh on upload settle (`documentsKey(sessionKey)`), leave/sign-out guard covers document uploads (extend `frontend/src/features/imports/routes.tsx` to check both queues)

**Checkpoint**: MVP — PDFs can be attached and found in the session folder.

---

## Phase 4: User Story 2 — Refuse files that aren't usable PDFs (P1)

**Independent Test**: pick a PDF, a non-PDF and a > 200 MB file; the two bad ones are refused before any request; the PDF uploads.

- [X] T018 [P] [US2] Contract error cases in `backend/tests/contract/test_documents.py`: 415 `unsupported_type` (`.pptx`, `.pdf.exe`, no extension), 411, 413 `file_too_large` with `maxBytes=209715200` (declared and streamed), 422 `unreadable_pdf` (`fake_pdf()`, `truncated()`, PNG renamed `.pdf`), 422 `incomplete_upload`, 507 — each leaving no row, no file, no staging file
- [X] T019 [P] [US2] Unit tests `frontend/tests/unit/pdf-files.test.ts` for `checkPdfFile`: `.PDF` accepted, others → "<name>: only PDF files can be added here", `209_715_201` bytes → "<name> is 200.0 MB. PDFs can be at most 200 MB.", empty file refused; rejected files never reach the upload function
- [X] T020 [US2] Implement `checkPdfFile` and server-problem messages (`unreadable_pdf` → "<name> couldn't be read as a PDF.") in `frontend/src/features/documents/pdfFiles.ts`, wired into `documentQueue()`

---

## Phase 5: User Story 3 — Read the slides while taking notes (P1)

**Goal**: a document opens as one tab of the workspace tab bar in the pdf.js reader (navigation, zoom, scroll, page indicator, dark pages, links, protected message); a toggleable split view shows two tabs side by side.

**Independent Test**: open a PDF from the list → one new tab in the workspace tab bar, no tab strip inside the reader; navigate, zoom; turn split on and type in a note next to it without the reader moving.

- [X] T021 [P] [US3] Contract tests: `GET /documents/{id}` and `GET /documents/{id}/file` (200 with `Accept-Ranges: bytes` + `ETag`; `Range: bytes=0-1023` → 206 with exactly those bytes; 404 `file_missing` when the file is gone) and `PATCH /documents/{id}` `{pageCount}` in `backend/tests/contract/test_documents.py`; workspace typed tabs + split round-trip, dropping unknown/deleted tab ids, split turning off when a pane's tab is gone, `openNoteIds` derived from `tabs` in `backend/tests/contract/test_workspace.py`; `readerDarkPages` in `backend/tests/contract/test_preferences.py`
- [X] T022 [US3] Backend: `GET /documents/{document_id}` and `/file` (`FileResponse`, `media_type="application/pdf"`, `content_disposition_type="inline"`, `ETag` = sha256, `Cache-Control: private, max-age=0, must-revalidate`) and `PATCH` for `pageCount` in `backend/src/unihelper/api/v1/documents.py` + service; `backend/src/unihelper/services/workspace_service.py` reads/writes `tabs_json`/`split_json` (≤ 50 tabs; `ratio` 0.2–0.8; validation of kinds/ids against the session's notes and documents) and `reader_dark_pages` preference
- [X] T023 [P] [US3] Unit tests `frontend/tests/unit/workspace-tabs.test.ts` for the reducer: open/focus/close tabs of both kinds, split on/off keeps all tabs, select shows tab in the focused pane, "show in other pane", closing a pane's tab turns split off, restore from server state, narrow-width rendering shows one tab
- [X] T024 [US3] `frontend/src/features/sessions/workspaceTabs.ts` (pure reducer + `TabRef`), replace `NoteTabs.tsx` by `WorkspaceTabs.tsx` (note + document tabs, document icon, "· L"/"· R" pane markers with screen-reader text "shown in left pane", split toggle button `aria-pressed` at the end, tab menu "Show in other pane"), and refactor `frontend/src/features/sessions/WorkspacePage.tsx` to render one or two panes (`PanelResizeHandle` divider, offered at ≥ 1100 px main-area width), persisting `tabs`/`active`/`split` via `putWorkspace`; `Alt+\` toggles split in `useWorkspaceKeyboard.ts`; existing notes unit and e2e tests stay green
- [X] T025 [US3] Reader core `frontend/src/features/documents/reader/PdfReader.tsx` (lazy-loaded via `React.lazy` from the document tab host): `EventBus`, `PDFLinkService` (internal links navigate; external links `target=_blank rel=noopener` — FR-020), `PDFViewer` with `annotationMode: AnnotationMode.ENABLE`, `annotationEditorMode: AnnotationEditorType.DISABLE`, `enableScripting: false`; continuous vertical scroll; reports `pageCount` once; one reader instance per open document tab kept mounted while the tab is open; protected PDFs (`encrypted` or `PasswordException`) show the ui-reader.md message instead of pages; per-page render errors shown in that page, others readable
- [X] T026 [US3] `frontend/src/features/documents/reader/ReaderToolbar.tsx` + `reader.css`: previous/next, page field ("Page 12 of 42", Enter jumps, out-of-range → nearest page + polite message), zoom − / + over the steps in ui-reader.md (50–400 %), Fit width, zoom indicator, page indicator in a polite live region; pdf.js CSS variables mapped to theme tokens; keys while focus is in the reader: PageUp/PageDown, Home/End, `Ctrl/Cmd +/-/0`, `Escape` → tab bar
- [X] T027 [US3] Dark pages (FR-022a): toggle button (`aria-pressed`) in the toolbar, `pageColors: { background: var(--reader-page-dark-bg), foreground: var(--reader-page-dark-fg) }` (resolved from the tokens at runtime), re-creating the `PDFViewer` while restoring page, zoom and scroll offset; preference `readerDarkPages` read/written via `usePreferences`
- [X] T028 [US3] Playwright `frontend/tests/e2e/documents.spec.ts` (evening-slot seeded classes, as in `import.spec.ts`): open from list → exactly one new workspace tab and no `role=tablist` inside the reader; next/prev/page 999/zoom/fit width; split on with `Alt+\`, PDF left + note right, type 2 minutes, reader page and scroll unchanged; reload restores split; dark pages on/off keeps page; protected PDF message; internal link jumps

---

## Phase 6: User Story 4 — Pick up where I left off (P2)

**Independent Test**: read to page 27, close, reopen (also in a second browser context) → page 27.

- [X] T029 [P] [US4] Contract tests `GET/PUT /documents/{id}/position` (null when never opened; `page` ≥ 1, 422 for 0; per user — another member gets null) in `backend/tests/contract/test_documents.py`
- [X] T030 [US4] Backend routes + service functions for position (upsert `document_positions`)
- [X] T031 [US4] `frontend/src/features/documents/reader/usePosition.ts`: open at `min(page, numPages)` after `pagesinit`; save on `pagechanging` (debounced 1 s) and on tab close; e2e case in `documents.spec.ts` with two browser contexts

---

## Phase 7: User Story 5 — Find a term in the document (P2)

**Independent Test**: search a multi-page PDF → count, highlighted current match, next/previous across pages; image-only PDF → "no searchable text".

- [X] T032 [US5] `frontend/src/features/documents/reader/SearchBox.tsx`: `Ctrl/Cmd+F` inside the reader opens it; dispatches pdf.js `find` events (`query`, `highlightAll: true`, `findPrevious`, `again`); shows "3 of 11" from `updatefindmatchescount`/`updatefindcontrolstate`; "No matches"; "This document has no searchable text." when every page's text content is empty; results in a polite live region; find highlight colours mapped to tokens in `reader.css`
- [X] T033 [US5] e2e search cases in `frontend/tests/e2e/documents.spec.ts` (text PDF with the word on 3 pages; image-only PDF message)

---

## Phase 8: User Story 6 — Annotate a document (P2)

**Goal**: highlight, freehand, text box, comment; recolour, move, delete, undo/redo; autosave with visible state; sidecar next to the untouched PDF; merge across windows; existing annotations displayed only.

**Independent Test**: add one of each type, reload and open in a second browser → all present; the PDF's sha256 is unchanged.

- [X] T034 [P] [US6] Unit tests `backend/tests/unit/test_annotation_ops.py` for the pure merge in `domain/annotations.py`: insert (rev 1); replace when `baseRev == rev` (rev+1); `baseRev != rev` → stored kept + incoming added as copy with `conflictOf` (`kept_both`); delete with matching rev; stale delete keeps the changed annotation (`kept_changed`); delete of missing id → ok; unknown fields preserved; limits 10,000 annotations / 10 MB → `too_many_annotations`
- [X] T035 [US6] `backend/src/unihelper/domain/annotations.py`: sidecar model per `contracts/annotation-file.md` (`format: "unihelper-annotations"`, `version: 1`, `document {fileName, sha256}`, `palette`, `annotations[]`; `colorHex` written from `annotation-palette.json` values duplicated in `domain/annotations.py` palette constant) and `apply_ops(file_model, ops, now) -> (new_model, results)` (pure)
- [X] T036 [P] [US6] Contract tests `backend/tests/contract/test_annotations.py`: `GET` empty set; `POST …/ops` batch of four types → `ok`, sidecar written next to the PDF; replay of the same `opId`s returns identical results and creates no duplicates; 422 for page < 1, bad colour, oversize text; 413 over limits; 404 foreign document
- [X] T037 [P] [US6] Integration tests `backend/tests/integration/test_annotation_merge.py`: (a) SC-010 — 200 random ops incl. undo-style inverses, PDF sha256 unchanged; (b) two clients editing the same comment → both versions in the one sidecar with `kept_both`; (c) sidecar edited by hand between requests → the edit is kept and merged; (d) sidecar made invalid JSON → moved aside to `<Name>.annotations.unreadable-<YYYYMMDD-HHMMSS>.json`, `notice: "unreadable_file_moved"`, new file written; (e) concurrent requests serialize under the per-document lock
- [X] T038 [US6] `backend/src/unihelper/services/annotation_service.py` (`document_file_lock(document_id)` like `note_file_lock`; read sidecar from disk inside the lock; `apply_ops`; atomic write via `write_text_atomic`; record/replay `annotation_ops` results) + routes `GET /documents/{id}/annotations`, `POST /documents/{id}/annotations/ops` in `backend/src/unihelper/api/v1/documents.py`; prune `annotation_ops` older than 30 days at startup in `backend/src/unihelper/main.py`
- [X] T039 [P] [US6] Unit tests `frontend/tests/unit/annotation-geometry.test.ts` (page space ↔ viewport at zoom 0.5/1/4 and rotation 0/90/180/270; selection rects → merged per-line quads) and `annotation-simplify.test.ts` (RDP at 0.5 pt keeps endpoints, reduces points, ≤ 5,000 per stroke)
- [X] T040 [US6] `frontend/src/features/documents/reader/annotations/geometry.ts` and `simplify.ts`
- [X] T041 [P] [US6] Unit tests `frontend/tests/unit/annotation-queue.test.ts` (fake IndexedDB): ops persisted before sending and removed after the result; debounce 500 ms / flush ≤ 2 s; save state `saved → saving → saved`, failure → `error` with retry backoff to 30 s; replays survive "reload"; `kept_both` / `kept_changed` produce notices; in-memory fallback warns; and `annotation-undo.test.ts` (inverse ops for create/edit/move/recolour/delete; redo; cap 200; undo enqueues ops)
- [X] T042 [US6] `frontend/src/features/documents/reader/annotations/opQueue.ts` (IndexedDB `uh-annotations`, store `ops`, key `[documentId, seq]`), `saveState.ts`, `undo.ts`
- [X] T043 [US6] `frontend/src/features/documents/reader/annotations/AnnotationLayer.tsx` + `AnnotationItem.tsx` + `tools.ts`: per-page SVG overlay mounted on pdf.js `pagerendered`/removed on eviction; tools Select/Highlight/Draw/Text/Comment as a `ToggleGroup`; Highlight acts on the text-layer selection; Draw with pointer events; Text box with inline editing; Comment marker button + popover textarea (Esc closes and saves); colour menu with the six named colours from `annotation-palette.json`; each annotation focusable in page order with an accessible name ("Highlight, page 12: ‘…’"); selected: focus-ring outline + handles, arrows move 1 pt (Shift 10 pt), `Enter` edits, `C` colour, `Delete` removes; `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` bound on the reader root only
- [X] T044 [US6] Save state in the toolbar (polite live region "Saving…", "Saved", "Not saved — retrying"), conflict toast, leave guards: `beforeunload`, sign-out guard and the document-tab close dialog from ui-reader.md while ops are pending (extend the registry pattern in `frontend/src/features/documents/routes.tsx`)
- [X] T045 [US6] No selectable text (FR-032): track pages' text content; Highlight disabled with "This document has no selectable text, so text can't be highlighted" (per page: "This page has no selectable text"); Draw/Text/Comment unaffected; annotations already in the PDF render through pdf.js's annotation layer, not selectable or editable (FR-033)
- [X] T046 [US6] Playwright `frontend/tests/e2e/annotations.spec.ts`: every tool by pointer; highlight/text box/comment/select/move/recolour/delete by keyboard; undo/redo; "Saved" within 2 s; reload and second context show everything; PDF bytes from `GET /file` unchanged; offline (`context.setOffline(true)`) → "Not saved — retrying", leaving warns, back online → saved; two pages editing the same comment → notice and both versions; image-only PDF → Highlight disabled with the message; annotated PDF's own annotations visible and not focusable as ours

---

## Phase 9: User Story 7 — Manage documents (P2)

**Independent Test**: rename an annotated document → list, tab and both files renamed, annotations intact; delete after confirmation → PDF and sidecar gone, tab closed.

- [X] T047 [P] [US7] Contract tests in `backend/tests/contract/test_documents.py`: `PATCH {name}` renames the PDF and the sidecar (sidecar `document.fileName` updated), 409 `name_taken`, 422 empty/121 chars, 412 stale `If-Match`; `DELETE` removes both files (204), 412 stale; annotations of a renamed document still returned
- [X] T048 [US7] Rename/delete in `backend/src/unihelper/services/document_service.py` using `rename_pair` with `on_rollback`, taking `document_file_lock` so an annotation save can't race a rename/delete; `annotationCount` in `view()`
- [X] T049 [US7] `frontend/src/features/documents/DocumentDialogs.tsx` (Rename dialog with live validation; Delete AlertDialog with the annotation count text from ui-reader.md) wired into `DocumentList.tsx` ⋯ menu; deleting closes the document's tab; e2e cases in `frontend/tests/e2e/documents.spec.ts`

---

## Phase 10: Polish & Cross-Cutting

- [X] T050 [P] Accessibility e2e in `frontend/tests/e2e/a11y-themes.spec.ts`: Documents section, reader toolbar, search box, annotation tools and a selected annotation, split view — axe AA (animations settled) in light, dark, one preset and one custom theme, plus with dark pages on; keyboard-only completion of every flow except freehand (SC-008)
- [X] T051 [P] Performance check in `frontend/tests/e2e/documents.spec.ts`: generated 100-page ~20 MB PDF shows its first page ≤ 2 s and page changes ≤ 1 s (SC-003); search over 300 pages ≤ 3 s (SC-004); a 150 MB PDF issues 206 range requests before the full size is downloaded
- [X] T052 [P] Docs: `README.md` "Documents and PDF reader" section (formats, 200 MB, `documents/` layout, sidecar files, split view `Alt+\`, reader shortcuts) and shortcut tables; `specs/002-course-session-notes/contracts/ui-workspace.md` note that tabs are typed and split view exists (007)
- [X] T053 Full gate: `cd backend && uv run ruff check . && uv run mypy && uv run pytest` (`test_coverage.py` green with the 10 new operations), `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`; walk `specs/007-session-pdf-reader/quickstart.md` 1–18

---

## Dependencies & Execution Order

```text
Setup (T001–T004)
  └─ Foundational (T005–T011)
       ├─ US1 upload (T012–T017) ── US2 refusals (T018–T020)
       └─ US3 reader + split (T021–T028)   needs US1 for documents to open
              ├─ US4 position (T029–T031)
              ├─ US5 search (T032–T033)
              └─ US6 annotate (T034–T046)
                     └─ US7 rename/delete (T047–T049)   needs the sidecar from US6
Polish (T050–T053)
```

- Same-file sequences: `document_service.py` T014 → T022 → T030 → T048; `api/v1/documents.py` T015 → T022 → T030 → T038; `WorkspacePage.tsx` T016 → T024; `PdfReader.tsx` T025 → T027 → T031 → T032 → T043/T045; `documents.spec.ts` T028 → T031 → T033 → T049 → T051.
- T002 (spike) gates T025: if the CSP needs a change, it is made before the reader lands.

## Parallel Examples

- Foundational: T006, T007, T009, T010 together after T005; T011 independent of the backend.
- US1: T012 + T013 (tests) together; backend T014–T015 in parallel with frontend T016.
- US3: T021 and T023 together; backend T022 in parallel with T024; T025–T027 after T024.
- US6: T034, T036, T037, T039, T041 (all tests) together; backend T035 → T038 in parallel with frontend T040 → T042 → T043.

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1 (+ US2) — documents attached and stored safely.
2. **+US3**: reading in the workspace with split view — the feature's core value.
3. **+US4, US5**: remembered page and search.
4. **+US6 → US7**: annotations, then rename/delete that carry sidecars along.
5. Polish: accessibility across themes, performance checks, docs, full gate.
