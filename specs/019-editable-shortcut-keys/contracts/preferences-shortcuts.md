# Contract: `shortcuts` in `/api/v1/preferences`

Additive change to the existing endpoints; no version bump (Principle III). Other preference
keys are unchanged.

## GET /api/v1/preferences

Response `200`, now also includes:

```json
{
  "shortcuts": {
    "workspace.newNote": [{ "chord": "Alt+Shift+KeyM", "label": "Alt+Shift+M" }, null],
    "player.playPause": [{ "chord": "Space", "label": "Space" }, null]
  }
}
```

`shortcuts` is `{}` when the user has no custom shortcuts.

## PATCH /api/v1/preferences

Request: any subset of preference keys. When `shortcuts` is present it **replaces** the stored
map as a whole.

```json
{ "shortcuts": { "workspace.newNote": [{ "chord": "Alt+Shift+KeyM", "label": "Alt+Shift+M" }, null] } }
```

Response `200`: the full merged preferences, as GET.

### Validation → `422` (existing `validation_failed` problem; each entry in `errors` has a JSON pointer and the standard validation code, like the other preference keys)

| Case | Code |
|------|------|
| More than 200 entries | `too_long` |
| Command id not matching the id pattern | `string_pattern_mismatch` |
| Command id > 64 chars | `string_too_long` |
| Value with fewer / more than two slots | `missing` / `too_long` |
| `chord` not matching the chord pattern (data-model.md) | `string_pattern_mismatch` |
| `label` empty / > 32 chars | `string_too_short` / `string_too_long` |
| Unknown field in a slot object | `extra_forbidden` |

The JSON schema is in the 002 contract (`specs/002-course-session-notes/contracts/openapi.yaml`,
`Preferences.shortcuts`).

`shortcuts: null` is rejected like other non-nullable preference keys (ignored as "unset" by the
current merge rule, so it never clears the map; clearing is `{}`).

The backend does **not** check conflicts or reserved keys (research R5); the frontend does.

## Backup / restore

No change: `ui_preferences` is already in the backup table list, so `shortcuts` is backed up and
restored with the rest of the preferences.

## Tests (Principle VI) — `backend/tests/contract/test_preferences.py`

- GET returns `shortcuts: {}` for a new user.
- PATCH with a valid map, then GET returns it; a second PATCH with another map replaces it.
- PATCH with `{}` clears it.
- Each 422 row above.
- PATCH of another key (e.g. `theme`) keeps `shortcuts` unchanged.
- Backup → restore round trip keeps `shortcuts` (extend the existing preferences backup test).
