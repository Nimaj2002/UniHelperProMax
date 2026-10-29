# API Contract: General Notes (018)

All endpoints are under `/api/v1`, need an authenticated user, and only ever touch that user's
notes. Errors use the existing problem shape (`ApiError`).

## New endpoints

### `GET /general-notes` → `200 NoteMeta[]`

Syncs the database with `<user>/General Notes/*.md`: adds rows for unknown files and drops rows
whose file is gone (research R5). Returns notes newest-changed first. A missing folder returns
`[]`; it is not an error.

### `POST /general-notes` → `201 Note`

Request: `{ "name": string, "content"?: string }`

- Creates the `General Notes` folder if it is missing (FR-010).
- `422 name_required`, `422 name_too_long`, `422 content_not_text` — the same rules as session
  notes.
- `409 name_taken` — another general note of this user already has that name.

## Reused endpoints (behaviour unchanged, now also accept general-note ids)

| Endpoint | Use |
|----------|-----|
| `GET /notes/{id}` | open in pop-up |
| `PUT /notes/{id}/content` (`If-Match` version + base hash) | autosave; `412 version_conflict`, `409 file_changed_on_disk`, `409 file_missing` as today |
| `PATCH /notes/{id}` `{ name }` | rename; `409 name_taken` is checked among the user's general notes; the file is renamed |
| `DELETE /notes/{id}` | delete the row and the file |

## Schema change

`NoteMeta.session_key: string` → `string | null` (`null` for general notes). This is additive
for existing clients, because session notes always send a string. Regenerate the frontend types
with `npm run gen:api`.

Transcription and import-replace refuse general notes. Transcription already does, through its
folder check. For import-replace, the UI never offers it on a general note, so no endpoint
change is needed.
