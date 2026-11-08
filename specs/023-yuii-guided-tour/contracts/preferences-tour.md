# Contract: `tour` in `/api/v1/preferences`

Additive change to the existing endpoints; no version bump (Principle III). Other preference
keys are unchanged. Same pattern as `shortcuts` (019).

## GET /api/v1/preferences

Response `200`, now also includes:

```json
{ "tour": { "status": "not_seen", "chapter": null } }
```

Every account without a stored value (including accounts created before this feature) gets the
default above.

## PATCH /api/v1/preferences

Request: any subset of preference keys. When `tour` is present it **replaces** the stored object.

```json
{ "tour": { "status": "in_progress", "chapter": "first_course" } }
```

Response `200`: the full merged preferences, as GET.

### Validation → `422` (existing `validation_failed` problem)

| Case | Code |
|------|------|
| `status` missing | `missing` |
| `status` not one of `not_seen`, `in_progress`, `skipped`, `completed` | `literal_error` |
| `chapter` not one of `welcome`, `first_course`, `first_note`, `pdf_recording`, `ai`, `settings`, `goodbye`, or null | `literal_error` |
| Unknown field inside `tour` | `extra_forbidden` |

`tour: null` is ignored as "unset" by the existing merge rule (it never clears the state).

## Schema addition

In `specs/002-course-session-notes/contracts/openapi.yaml`, `Preferences.properties`:

```yaml
tour:
  type: object
  additionalProperties: false
  required: [status]
  properties:
    status: { type: string, enum: [not_seen, in_progress, skipped, completed] }
    chapter:
      type: [string, "null"]
      enum: [welcome, first_course, first_note, pdf_recording, ai, settings, goodbye, null]
```

Then regenerate `frontend/openapi.json` and `frontend/src/lib/api/schema.d.ts`.

## Backup / restore

No change: `ui_preferences` is already in the backup table list.

## Tests (Principle VI) — `backend/tests/contract/test_preferences.py`

- GET returns `tour: {status: "not_seen", chapter: null}` for a new user.
- A user whose stored preferences predate the key (row without `tour`) also gets the default.
- PATCH with a valid object, then GET returns it; a second PATCH replaces it.
- Each 422 row above.
- PATCH of another key (e.g. `theme`) keeps `tour` unchanged.
- Two users have independent `tour` values.
