# Data Model: Home General Notes (018)

## Note (existing table `notes`, extended)

A general note is a `Note` whose `session_folder_id` is `NULL` (research R1).

| Field | Change | Notes |
|-------|--------|-------|
| `session_folder_id` | now **nullable** | `NULL` = general note |
| `user_id` | unchanged | owner; every query filters by it (FR-017) |
| `name`, `name_key` | unchanged | 1–120 chars after `normalize_display`; unique per user among general notes |
| `file_name`, `file_key` | unchanged | `safe_name(name) + ".md"`, made unique with `unique_sibling` |
| `content_hash`, `size`, `version`, timestamps | unchanged | same save and conflict rules as session notes |

**New constraints** (migration `0016_general_notes`):

- `uq_notes_general_name` — unique `(user_id, name_key)` where `session_folder_id IS NULL`
- `uq_notes_general_file` — unique `(user_id, file_key)` where `session_folder_id IS NULL`

**File location**: `<files_root>/<username>/General Notes/<file_name>`.

**Lifecycle**:

```text
POST /general-notes ──► live ──(PUT content / PATCH name)──► live
                         │
                         ├─ DELETE /notes/{id} (after confirm, or blank on first close) ─► gone (row + file)
                         └─ file removed outside app ─► row dropped on next list sync
file added outside app ─► row created on next list sync ─► live
```

## Reserved name

- `GENERAL_NOTES_DIR = "General Notes"` (`domain/naming.py`). Year folders treat it as a taken
  sibling, so a year can never get that folder name (FR-011).

## UI preference

- `general_notes_collapsed: bool` (default `false`), added to the existing UI preferences, so
  the section stays collapsed or expanded across visits (FR-019).
