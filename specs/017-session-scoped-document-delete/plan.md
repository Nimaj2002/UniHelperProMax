# Implementation Plan: Session-Scoped Document Deletion

**Branch**: `017-session-scoped-document-delete` (spec directory; work currently on `main`) |
**Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/017-session-scoped-document-delete/spec.md`

## Summary

Every session lists all PDFs of its course (or event series), but Delete and Rename act on the
one original file in its owning session, from whichever session they are used. This fix:

- **adds per-session hiding**: a new `document_hides` table, `PUT`/`DELETE` and `GET hidden`
  endpoints, and a list that excludes hidden PDFs;
- **limits Rename and Delete to the owning session**: menus differ per row, and an optional
  `fromSession` guard on `DELETE`/`PATCH /documents/{id}` answers 409 `not_owning_session`;
- **lets the student bring a PDF back**: a "Removed from this session (N)" control and an Undo
  toast;
- **keeps hides in backups** (`backup/tables.py`).

The chat attach menu drops hidden PDFs automatically because it uses the same session list. See
[research.md](research.md).

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5 / React 19 (frontend), Electron
desktop shell (unchanged)

**Primary Dependencies**: Existing only. FastAPI, SQLAlchemy 2, Alembic on the backend;
shadcn/ui, TanStack Query and sonner toasts on the frontend. No new packages.

**Storage**: SQLite gets the new table `document_hides`, migration `0015_document_hides`. The
file system is unchanged: no file is written, moved or deleted by hiding.

**Testing**:
- Backend: pytest (contract tests, integration tests with the real API, SQLite and temp dirs,
  and unit tests including the backup table classification test)
- Frontend: vitest + vitest-axe
- End to end: Playwright `documents.spec.ts`

**Target Platform**: Web (self-hosted) and the desktop app on Windows, macOS and Linux

**Project Type**: Web application (backend + frontend), packaged as a desktop app

**Performance Goals**: The document list costs the same as today: one extra `NOT EXISTS`
filter, indexed by the primary key. Hide and show answer in well under 200 ms locally. SC-005:
deletion shows up everywhere on the next list refresh (the existing `allDocumentsKey`
invalidation).

**Constraints**: No breaking change in `/api/v1` (Principle III). Original PDFs are never
touched by hide or show (Principles I and II). Destructive delete keeps its confirmation.

**Scale/Scope**: Tens of PDFs per course and tens of sessions, so at most hundreds of hide
rows per course.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. User work never lost | This feature fixes a data-loss path. Hiding never deletes. Deletion only happens in the owning session, after a confirmation that now names the cross-session effect. The server guard (FR-010) stops stale screens. | ✅ |
| II. Data ownership & open formats | PDFs stay in the owning session's `documents/` folder, unmodified. Hides are listing metadata in SQLite, which Principle II allows. No content lives only in the DB. | ✅ |
| III. Frontend/backend separation | All changes go through `/api/v1`. The new endpoints have a documented contract ([contracts/documents-api.md](contracts/documents-api.md)). `fromSession` is optional, so the change is additive and non-breaking. | ✅ |
| IV. Providers & secrets | Not touched. | ✅ N/A |
| V. UI quality & accessibility | Uses the existing shadcn `DropdownMenu`, `Button` and sonner toast, plus theme tokens. The removed list is a `Button` disclosure with `aria-expanded`, so no new primitive is needed. The new control is keyboard reachable. Light and dark are checked in quickstart step 7. | ✅ |
| VI. Tests | Every new or changed endpoint gets contract tests for success and error cases. An integration flow covers hiding → files untouched → deleting in the owning session. Critical flows 1–3 are unaffected. | ✅ |
| VII. Simplicity & spec discipline | One table, three small endpoints and an optional parameter. No new dependency or layer. Everything maps to FR-001–FR-014. | ✅ |
| VIII. Desktop data safety | The migration runs through the existing runner, which backs up the DB first. The data folder is untouched. | ✅ |

**Post-design re-check (after Phase 1)**: unchanged, all pass. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/017-session-scoped-document-delete/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R7
├── data-model.md        # Phase 1: DocumentHide + state transitions
├── quickstart.md        # Phase 1: validation guide
├── contracts/
│   └── documents-api.md # Phase 1: changed + new endpoints
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
backend/
├── src/unihelper/
│   ├── models/document.py                    # + DocumentHide model
│   ├── db/migrations/versions/0015_document_hides.py   # new
│   ├── services/document_service.py          # list excludes hides; list_hidden, hide, show;
│   │                                         #   owning-session guard in rename/delete
│   ├── api/v1/documents.py                   # + GET …/documents/hidden, PUT/DELETE …/hidden;
│   │                                         #   fromSession on DELETE/PATCH
│   └── backup/tables.py                      # + "document_hides" in _INCLUDED
└── tests/
    ├── contract/test_document_hides.py       # new
    ├── contract/test_documents.py            # fromSession cases
    └── integration/test_documents_flow.py    # hide → untouched → owner delete cascade

frontend/
├── src/features/documents/
│   ├── api.ts                                # hide/show/useHiddenDocuments; fromSession on
│   │                                         #   rename/delete
│   ├── DocumentList.tsx                      # per-row menu (owner vs other), Undo toast,
│   │                                         #   "Removed from this session (N)" control
│   └── DocumentDialogs.tsx                   # deleteText: cross-session warning
├── src/features/sessions/WorkspacePage.tsx   # tab title fallback for PDFs hidden here
├── src/lib/api/schema.d.ts                   # regenerated (npm run gen:api)
└── tests/
    ├── unit/…DocumentList.test.tsx           # menus, toast, removed control, axe
    └── e2e/documents.spec.ts                 # cross-session hide/delete scenario
```

**Structure Decision**: Use the existing web-application layout (`backend/` + `frontend/`).
All changes stay inside the documents feature, plus the backup table list and one workspace
fallback.

## Complexity Tracking

No violations; nothing to justify.
