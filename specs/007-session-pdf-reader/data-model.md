# Data Model: Session Documents & PDF Reader (007)

Migration `0009_documents` (new tables + `ADD COLUMN` on `workspace_states`; no table rebuild).
Files follow Constitution v1.1.0 Principle II.

## Files (source of truth for content)

```text
files/<user>/<Year>/<Semester>/<Course>/<YYYY-MM-DD>/documents/
├── Lecture 5 — Trees.pdf                     # the upload, byte-identical, never written again
└── Lecture 5 — Trees.annotations.json        # sidecar, only once annotations exist
```

- Sidecar format: `contracts/annotation-file.md`.
- Rename: both files renamed together (undo on rollback). Delete: both removed (confirmed).
- An unreadable sidecar is moved to `<Name>.annotations.unreadable-<YYYYMMDD-HHMMSS>.json`, never
  overwritten.

## `documents` (new)

| Column | Type | Rules |
|---|---|---|
| `id` | UUIDv7 string | PK |
| `user_id` | FK users | cascade |
| `session_folder_id` | FK session_folders | cascade |
| `name` | String(120) | 1–120 chars; CHECK `length(name) BETWEEN 1 AND 120` |
| `name_key` | String | `casefold(nfc(trim(name)))`; UNIQUE (`session_folder_id`, `name_key`) |
| `file_name` | String | `<safe name>.pdf`; UNIQUE (`session_folder_id`, `file_key`) |
| `file_key` | String | casefold of `file_name` |
| `original_file_name` | String(255) | as uploaded |
| `size` | Integer | bytes, ≤ 209,715,200 (200 MB) |
| `sha256` | String(64) | of the stored file (ETag; SC-007/SC-010 checks) |
| `encrypted` | Boolean | `/Encrypt` found in the trailer region (FR-021) |
| `page_count` | Integer, nullable | reported by the reader on first open |
| `uploaded_at` | ISO string | list order: newest first (FR-001) |
| `created_at`, `updated_at`, `version` | mixins | `version` for `If-Match` on rename/delete |

**Naming**: new document name = `normalize_display(stem)[:120]` or "Document"; clashes get
" (2)", " (3)"… (shortened to stay ≤ 120); file names never reuse a DB name or an on-disk file
(006 I6 rules). **Missing file**: API `missing: true` when the PDF is gone ("File missing").

## `document_positions` (new) — FR-019

| Column | Type | Rules |
|---|---|---|
| `user_id` | FK users | PK part, cascade |
| `document_id` | FK documents | PK part, cascade |
| `page` | Integer | ≥ 1 |
| `updated_at` | ISO string | |

## `annotation_ops` (new) — idempotent retries (research R7)

| Column | Type | Rules |
|---|---|---|
| `op_id` | String(64) | PK (client-generated UUID) |
| `document_id` | FK documents | cascade |
| `result_json` | Text | the per-op result returned to the client |
| `applied_at` | ISO string | rows older than 30 days are pruned on startup |

Metadata only; annotation content lives in the sidecar (Principle II).

## `workspace_states` (changed) — FR-013, FR-014a

| Column | Change |
|---|---|
| `tabs_json` | **new**, Text nullable: `[{ "kind": "note"\|"document", "id": "<uuid>" }]` (≤ 50) |
| `split_json` | **new**, Text nullable: `{ "enabled": bool, "left": TabRef\|null, "right": TabRef\|null, "focused": "left"\|"right", "ratio": 0.2–0.8 }` |
| `open_note_ids`, `active_note_id` | kept; written from `tabs` for older clients |

Read rules: unknown or deleted tab ids are dropped; `active` falls back to the first tab; a split
pane whose tab was dropped turns split off.

## `ui_preferences` (changed)

- New key `reader_dark_pages: bool` (default false), exposed as `Preferences.readerDarkPages`.

## Annotation (sidecar item; client model mirrors it) — FR-025–FR-036

| Field | Type | Rules |
|---|---|---|
| `id` | UUID string | unique in the file |
| `type` | `highlight` \| `ink` \| `textbox` \| `comment` | |
| `page` | integer ≥ 1 | 1-based page index |
| `color` | palette name | `yellow` \| `green` \| `blue` \| `pink` \| `orange` \| `purple` (hex resolved from `annotation-palette.json`, also written as `colorHex` for readers outside the app) |
| `rects` | `[[x1,y1,x2,y2], …]` | highlight only; PDF page space (pt), unrotated, origin bottom-left |
| `quoted` | string ≤ 2,000 | highlight only: the highlighted text (screen readers, plain-file readers) |
| `strokes` | `[[[x,y], …], …]`, `width` pt | ink only; ≤ 5,000 points per stroke after simplification |
| `box` | `[x1,y1,x2,y2]` | textbox only |
| `anchor` | `[x,y]` | comment only |
| `text` | string ≤ 10,000 | textbox and comment |
| `rev` | integer ≥ 1 | incremented by the server on every change |
| `conflictOf` | id, optional | set on a copy kept by FR-036 |
| `createdAt`, `updatedAt` | ISO strings | |

Limits: ≤ 10,000 annotations and ≤ 10 MB per sidecar (beyond → 413 `too_many_annotations`).

## Client-side (not persisted on the server)

- **Pending op** (IndexedDB `uh-annotations`/`ops`, key `[documentId, seq]`): `{ opId, kind,
  annotation?, id?, baseRev }`; deleted after the server's result.
- **Annotation save state** (per open document): `saved` → `pending` (debounce) → `saving` → `saved`
  | `error` (retrying) ; notices for `kept_both` / `kept_changed` results.
- **Undo stack** (per document tab): commands with forward/inverse op lists; cap 200.
