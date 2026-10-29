# Implementation Plan: Home General Notes

**Branch**: `018-home-quick-notes` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-home-quick-notes/spec.md`

## Summary

Add a compact, collapsible **General notes** section under the home page's Tasks panel. Notes
open in a pop-up dialog that uses the same Markdown editor and autosave as session notes, and
they are stored as `.md` files in `<user folder>/General Notes/`. A general note is an ordinary
`Note` row with no session folder (research R1). Because of that, the existing note endpoints,
conflict guards, saver and conflict dialog are reused unchanged. The only new pieces are two
endpoints (list with folder sync, and create), one migration, one reserved folder name, and two
frontend components.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5.9 + React 19 (frontend)

**Primary Dependencies**: FastAPI, SQLAlchemy 2, Alembic; TanStack Query 5, shadcn/ui (`Dialog`),
existing `MarkdownEditor` (with the diagrams and math from 013)

**Storage**: SQLite `notes` table (metadata) + Markdown files in `<user>/General Notes/`

**Testing**: pytest (contract + integration, real SQLite and a temporary file system), vitest,
Playwright

**Target Platform**: Desktop app (Electron + local backend) and web build

**Project Type**: Web application (backend + frontend)

**Performance Goals**: list of 500 general notes in < 1 s (SC-005); typing starts within 2 s (SC-001)

**Constraints**: no lost text (Principle I); plain files (Principle II); keyboard and theme support (Principle V)

**Scale/Scope**: one user, up to hundreds of notes; two new endpoints, one migration, about 2 UI components

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. User work never lost | ✅ | Reuses the session-note autosave, `If-Match` and disk-hash guards, drafts and page-hide flush. The dialog does not close while a save is failing. Delete asks for confirmation, except for a blank new note (nothing to lose). |
| II. Data ownership & open formats | ✅ | Plain `.md` files in `<user>/General Notes/`, browsable without the app; the database is not the only copy. Allowed by the Principle II amendment (constitution 1.5.0); year folders avoid the reserved name (research R4). |
| III. Frontend/backend separation | ✅ | Two new `/api/v1/general-notes` endpoints with a contract. `NoteMeta.session_key` becoming nullable is an additive change, so no version bump. |
| IV. Providers & secrets | ✅ n/a | No providers involved. |
| V. UI quality & accessibility | ✅ | shadcn `Dialog`, theme tokens only, focus trapped and returned to the opener, keyboard operable. |
| VI. Tests | ✅ | Contract tests for both new endpoints and for reused endpoints called with general-note ids; an integration test for create → save → outside edit → sync. Critical flows are untouched. |
| VII. Simplicity | ✅ | No new table, service layer or dependency; one nullable column. |
| VIII. Desktop data safety | ✅ | Data stays in the data folder; the migration runs through the existing back-up-before-migrate path. |

**Post-design re-check**: all gates pass (constitution 1.5.0, amended 2026-10-29 for this feature).

## Project Structure

### Documentation (this feature)

```text
specs/018-home-quick-notes/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/general-notes-api.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
backend/src/unihelper/
├── domain/naming.py                     # + GENERAL_NOTES_DIR
├── models/note.py                       # session_folder_id nullable, partial unique indexes
├── db/migrations/versions/0016_general_notes.py
├── services/note_service.py             # general-scope branch in _note_with_path/meta/rename; list_general, create_general
├── services/hierarchy_service.py        # year folders avoid GENERAL_NOTES_DIR
├── services/workspace_service.py        # + general_notes_collapsed preference
├── schemas/notes.py                     # NoteMeta.session_key: str | None
└── api/v1/notes.py                      # GET/POST /general-notes
backend/tests/
├── contract/test_general_notes.py
└── integration/test_general_notes_flow.py

frontend/src/features/home/
├── GeneralNotesSection.tsx              # list, empty state, description, collapse
├── GeneralNoteDialog.tsx                # pop-up: badge, name, save state, MarkdownEditor
├── generalNotesApi.ts                   # useGeneralNotes / useCreateGeneralNote
└── TasksPanel.tsx                       # mounts the section below the board/list
```

**Structure Decision**: The existing `backend/` + `frontend/` web app layout. The new UI lives in
`features/home`, because the section belongs to the home page, and it imports the editor and
saver from `features/sessions`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Notes stored outside `<year>/<semester>/…` (Principle II) | The user explicitly asked for a `General Notes` folder directly under their user folder | Putting them inside a year or semester ties a general note to a term, which is the opposite of the request. Resolved by amending Principle II via `/speckit-constitution` (MINOR, 1.5.0). |
