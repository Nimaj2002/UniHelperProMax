# Quickstart: Validating Session-Scoped Document Deletion

Contracts: [contracts/documents-api.md](contracts/documents-api.md).
Data model: [data-model.md](data-model.md).

## Prerequisites

- The backend dev environment (`backend/`, Python 3.12) and frontend (`frontend/`, Node) are set
  up as for earlier features.
- The migration `0015_document_hides` is applied (the app runs migrations at start-up).
- After API changes: export the OpenAPI schema and run `npm run gen:api` in `frontend/`, so
  `Schemas` includes the new routes.

## Automated checks

```bash
# backend: contract + integration + unit (includes the backup table classification test)
cd backend && pytest tests/contract/test_document_hides.py tests/contract/test_documents.py \
  tests/integration/test_documents_flow.py tests/integration/test_backup_roundtrip.py tests/unit
ruff check src tests && mypy src

# frontend
cd frontend && npm test -- documents && npm run e2e -- documents.spec.ts
```

Expected: everything passes. The backup roundtrip test restores a hide row.

## Manual scenario (maps to the spec's user stories)

Use a course with at least three sessions: S1, S3 and S5.

1. **Hide in a non-owning session (US1)**
   - In S1, upload `Week 1 slides.pdf` and add one annotation.
   - Open S5. The row shows "· from <S1 date>".
   - Open the row's menu. It shows only **Remove from this and later sessions**: no Rename and no Delete.
   - Choose it. The row disappears, and a toast "Removed … from this and later sessions" offers **Undo**.
     If the PDF was open as a tab in S5, that tab closes.
   - Open S6 or later: the PDF is not listed. Open S1: it is listed, opens at its last page, and
     has its annotation. Open S3: the PDF
     is listed.
   - On disk, `<course>/<S1 folder>/documents/Week 1 slides.pdf` and its sidecar are unchanged.
2. **Chat (FR-013)**
   - In S5's chat, open Attach → PDFs. The hidden PDF is not offered.
   - A chat message in S5 that attached the PDF before it was hidden still opens it. The tab
     shows the PDF's name.
3. **Bring it back (US3)**
   - In S5, open **Removed from this session (1)** and choose **Show again**. The PDF
     is listed again with "from <S1 date>".
   - The control disappears when nothing is hidden.
4. **Delete in the owning session (US2)**
   - Hide the PDF in S5 again.
   - In S1, the menu shows **Rename…** and **Delete…**. The Delete confirmation says the PDF is
     also listed in the course's other sessions and will disappear from all of them, and names
     the annotation count.
   - Confirm. The PDF is gone from S1, S3, S5 and from S5's removed list, and the file is gone
     from disk.
5. **Stale screen (FR-010)**: with S5 open in two windows, hide the PDF in one window. In the
   other window the list refreshes, and opening the old row deletes nothing. Run
   `DELETE /api/v1/documents/{id}?fromSession=<S5 key>` and expect **409
   `not_owning_session`**, with the file still on disk.
6. **Restart and backup (FR-007)**: restart the app, and S5 still hides the PDF. Make a backup,
   restore it, and S5 still hides it.
7. **Themes and keyboard (Principle V)**: repeat steps 1 and 3 with the keyboard only, in light
   and dark themes.
