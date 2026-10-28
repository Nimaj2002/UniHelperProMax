# API Contract: Session-Scoped Document Deletion (`/api/v1`)

All endpoints need the signed-in user (existing `CurrentUser`). Error bodies use the existing
`ApiError` shape: `{ "code", "message", "errors"? }`. Changes are additive: no existing request
becomes invalid (Principle III).

## Changed

### `GET /sessions/{sessionKey}/documents`

Same response (`Document[]`). It now **excludes** documents hidden in this session.

- 200: the scope's documents, newest first, minus the hidden ones.
- 404: unknown session (unchanged).

### `DELETE /documents/{documentId}?fromSession={sessionKey}`

New **optional** query parameter `fromSession`: the session the user is deleting from.

- 204: deleted (unchanged behaviour). All hides of the document cascade away.
- 409 `not_owning_session`: `fromSession` is given and isn't the document's owning session.
  Nothing changes. Message: "This PDF belongs to another session. Remove it from this session
  instead, or delete it in the session it was uploaded to."
- 404 `not_found` (unknown or not the user's document), 412 `version_conflict` via `If-Match`
  (unchanged).

### `PATCH /documents/{documentId}?fromSession={sessionKey}`

`fromSession` is checked **only when the body has `name`** (rename). `pageCount` patches ignore
it.

- 200: renamed (unchanged).
- 409 `not_owning_session`: rename from a non-owning session. Nothing changes. Message: "Rename
  this PDF in the session it was uploaded to."
- Other errors unchanged (`name_taken`, `name_required`, `name_too_long`, version).

## New

### `GET /sessions/{sessionKey}/documents/hidden`

The scope's documents hidden in this session.

- 200: `Document[]` (the same schema as the list), newest first. `[]` when the session has no
  folder or nothing is hidden.
- 404: unknown session.

### `PUT /sessions/{sessionKey}/documents/{documentId}/hidden`

Hide the document in this session. Idempotent. No body.

- 204: hidden (or already hidden). Creates the session's folder if missing.
- 404 `not_found`: unknown document, not the user's, or not in this session's scope.
- 404: unknown session.
- 409 `own_session`: this session owns the document. Message: "This PDF was uploaded to this
  session; delete it instead."

### `DELETE /sessions/{sessionKey}/documents/{documentId}/hidden`

Show the document in this session again. This is also Undo. Idempotent.

- 204: shown (or was not hidden, or the session has no folder).
- 404: unknown session; unknown document or one not in the scope.

## Tests required (Principle VI)

Contract tests in `backend/tests/contract/test_documents.py` or a new
`test_document_hides.py` cover:
- each new endpoint's success, idempotency and every error code above;
- the list excluding hidden PDFs, and the hidden list including them;
- `fromSession` on DELETE and on rename: owning session → success, other session → 409 with the
  file untouched on disk, parameter absent → today's behaviour;
- a `pageCount` patch with a non-owning `fromSession` still succeeds.
