# Research: Session-Scoped Document Deletion

All Technical Context items were known from the code; no NEEDS CLARIFICATION remained. These
are the design decisions, each checked against the current code.

## Current behaviour (the bug)

- `GET /sessions/{key}/documents` returns every document of the session's **scope**: all
  non-trashed session folders of the course, or of the event series
  (`document_service.DocumentScope`, `_scope`).
- `DocumentList.tsx` shows each row's actions menu with Rename and Delete for every row. A PDF
  from another session only gets a "· from <date>" marker.
- `DELETE /documents/{id}` and `PATCH /documents/{id}` (rename) only know the document id. They
  delete or rename the single row and its PDF/sidecar in the **owning** session's `documents/`
  folder, whichever session the request came from.

## R1 — Where "hidden in this session" is stored

**Decision**: New SQLite table `document_hides` with one row per (session folder, document),
`user_id`, and `created_at`. Both foreign keys use `ON DELETE CASCADE`.

**Rationale**:
- A hide is UI metadata about a listing, not user content. Principle II lets the database hold
  metadata, and no file under the course folders changes.
- Cascading on `documents.id` means deleting the PDF in its own session drops every hide (spec
  edge case "Original deleted after being removed elsewhere").
- Cascading on `session_folders.id` drops a session's hides when its folder is purged, while a
  session that is only in the Trash keeps them for a restore (spec edge case "Session or course
  deletion").
- `SessionFolder.session_key` is `{lineage_id}:{original_date}`, and the row survives calendar
  moves. So a hide follows its session when the session is moved.

**Alternatives considered**:
- *Key by `session_key` string, no FK*: this avoids creating a folder for a session that has
  none yet. But hides would be orphaned when sessions are deleted, and cleanup would be needed
  in trash purge, course delete and backup. Rejected.
- *A JSON list on `workspace_states`*: that table is per-session UI state, but it isn't
  queryable. Listing would have to filter in Python, and there is no cascade when a document is
  deleted. Rejected.
- *A marker file in the session folder*: user-visible clutter for a UI preference, and it
  conflicts with "folders stay readable". Rejected.

## R2 — Hiding in a session that has no folder yet

A session (e.g. an upcoming one) may have no `session_folders` row until something is created in
it (`ResolvedSession.folder is None`).

**Decision**: The hide endpoint calls `session_folder_service.get_or_create_folder`, the same
call notes, recordings, documents and chats use for their first write. Showing a PDF again never
creates a folder: with no folder there is nothing to delete.

**Rationale**: This reuses the one existing path that creates a folder's DB row and its disk
folder, with readable names and the Trash-safe naming rules.

## R3 — Enforcing "only the owning session can delete or rename" (FR-010)

**Decision**: Add an optional query parameter `fromSession=<session key>` to
`DELETE /documents/{id}` and `PATCH /documents/{id}`; it is checked only when the patch has
`name`. When present and it is not the document's owning session, the backend answers
**409 `not_owning_session`** and changes nothing. The new frontend always sends it.
`PATCH` with `pageCount` (the reader, in any session) ignores it.

**Rationale**:
- Principle III forbids breaking changes inside `/api/v1`. An optional parameter is additive,
  so existing callers and tests keep working.
- The desktop app and the web build ship frontend and backend together, so every real client
  sends the parameter.
- The existing `If-Match` version check already protects against a stale *version*. This
  closes the stale-*screen* case (a session 5 tab rendered before the menu changed).

**Alternatives considered**:
- *Required parameter*: breaking. It would need `/api/v2` or a deprecation note. Rejected.
- *Session-scoped routes (`DELETE /sessions/{key}/documents/{id}`)*: duplicates the existing
  route for one check. Rejected for simplicity (Principle VII).

## R4 — Listing, the chat attach menu, and tabs

**Decision**: `list_documents` excludes documents that have a `document_hides` row for the
requested session's folder. A new `GET /sessions/{key}/documents/hidden` returns the hidden ones
for the "Removed from this session (N)" control.

**Consequences, checked in code**:
- `AttachMenu.tsx` (chat) uses `useDocuments(sessionKey)`, so hidden PDFs leave the attach menu
  without chat changes (FR-013).
- Chat history chips resolve a PDF by id (`GET /documents/{id}`), which is unchanged, so earlier
  messages still open a hidden PDF (FR-013, second half).
- `WorkspacePage.tsx` names document tabs from the session's list (`docById`). A hidden PDF
  opened from a chat chip would have no title. **Fix**: fall back to the single-document query
  (`useDocument(id)` / the `documentKey` cache) for tab titles.
- On "Remove from this session", `DocumentList` calls `closeDocument(id)` (already passed in) to
  close the tab in that session only (FR-005).
- The rename dialog's `others` list now omits hidden PDFs. The server still enforces course-wide
  name uniqueness (`name_taken`), so no rule weakens.
- Upload into session 5 with the name of a PDF hidden there: `import_document` already picks a
  unique name across the whole scope, hidden or not. This settles the spec edge case: behaviour
  is unchanged and the new PDF gets a numbered name.

## R5 — Backups (FR-007)

**Decision**: Add `document_hides` to `backup/tables.py` `_INCLUDED`. It has `user_id`, so
`account_where` needs no `PARENT` entry.

**Rationale**: The unit test there fails on any unclassified table, so this can't be forgotten.
`INCLUDED` is ordered from `Base.metadata.sorted_tables`, so FKs to `documents` and
`session_folders` restore in order.

## R6 — Migration

**Decision**: Alembic revision `0015_document_hides`, which creates the table plus an index on
`document_id`. The primary key is `(session_folder_id, document_id)`.

**Rationale**: The existing migration runner already backs up the database before upgrading
(Principle VIII). Downgrade drops the table, and no other data changes.

## R7 — UI wording and menu per row

**Decision** (in `DocumentList.tsx`, shadcn `DropdownMenu`, existing toast):
- **Owning session** (`d.sessionKey === sessionKey`): "Rename…", "Delete…".
- **Other session**: "Remove from this session". Then a toast "Removed “<name>” from this
  session." with an **Undo** action that calls the show endpoint.
- **Delete confirmation** (`deleteText`): adds "It is also listed in the course's other sessions
  and will disappear from all of them." ("event's other occurrences" for events).
- **Below the list**: a "Removed from this session (N)" disclosure (a shadcn `Button` with `aria-expanded`; the repo has no `Collapsible` primitive). It shows only when N > 0
  and has one row per PDF with a "Show in this session" button. It is keyboard reachable and
  uses theme tokens (Principle V).
