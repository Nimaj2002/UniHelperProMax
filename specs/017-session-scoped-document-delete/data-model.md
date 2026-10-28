# Data Model: Session-Scoped Document Deletion

## Existing entities (unchanged)

- **Document** (`documents`): a PDF owned by exactly one `session_folders` row
  (`session_folder_id`). Its file is `<owning session folder>/documents/<file_name>`, with the
  annotation sidecar next to it. Names are unique across the document's scope, which is the
  course or the event series.
- **SessionFolder** (`session_folders`): one row per session or event occurrence that has
  content. `session_key = {lineage_id}:{original_date}` stays stable across calendar moves.
- **Document scope**: the non-trashed session folders of one course, or of one event series.
  Every session in the scope lists the scope's documents.

**Owning session** (derived, no new field): `Document.session_folder_id`. In API responses it is
`Document.sessionKey`. "Owned here" means `document.sessionKey == <current session key>`.

## New entity: DocumentHide (`document_hides`)

A record that one session does not list one document of its scope.

| Field | Type | Rules |
|---|---|---|
| `session_folder_id` | string, FK → `session_folders.id`, `ON DELETE CASCADE` | PK part. The session where the PDF is hidden. |
| `document_id` | string, FK → `documents.id`, `ON DELETE CASCADE` | PK part. Indexed. |
| `user_id` | string, FK → `users.id`, `ON DELETE CASCADE` | Indexed. Must equal both parents' `user_id`. |
| `created_at` | ISO-8601 string | Set on insert. |

**Primary key**: `(session_folder_id, document_id)`. Hiding twice is a no-op.

**Validation (service layer)**:
- The document must belong to the user and be in the session's scope; otherwise **404**.
- The session must not be the document's owning session (`document.session_folder_id !=
  folder.id`); otherwise **409 `own_session`**. A PDF is deleted in its own session, never hidden
  there.
- Hiding creates the session's folder if it has none (`get_or_create_folder`, research R2).
  Showing again never creates one.

## State transitions (per document × session)

```text
              hide (non-owning session only)
   Listed  ───────────────────────────────▶  Hidden
     ▲   ◀───────────────────────────────    │
     │          show / Undo                  │
     │                                       │
     └──── delete in owning session ─────────┴──▶  (document gone; all hides cascade away)
```

- A rename in the owning session doesn't affect hides. A hidden PDF stays hidden under its new
  name.
- A new session dated after a hide doesn't list that PDF; one dated before it does.
- A session moved to the Trash keeps its hides. Purging the folder removes them by cascade.

## Reach (change after implementation)

A hide made in session S applies to S and every session of the scope whose `original_date` is on
or after S's, except the PDF's owning session. "Show again" in a session deletes every hide of
the PDF that reaches that session.

## Derived lists

- **Session list** (`GET /sessions/{key}/documents`): the scope's documents, minus those with a
  hide that reaches this session (see Reach).
- **Hidden list** (`GET /sessions/{key}/documents/hidden`): the scope's documents with a hide that
  reaches this session (not the ones it owns).
- The chat attach menu uses the session list, so hidden PDFs aren't offered (FR-013).

## Backup

`document_hides` joins `backup/tables.py` `_INCLUDED` and is exported and restored with the
account (FR-007).
