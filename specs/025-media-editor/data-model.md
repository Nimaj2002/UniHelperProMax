# Data Model: Media Editor

No new tables. Existing `recordings` (see `models/recording.py`) is reused.

| Concept | Representation |
|---|---|
| Edit Source | existing `Recording` row + its file in `<session>/audios/` |
| Trim Selection | request fields `startMs`, `endMs` (not stored); valid when `0 ≤ start < end ≤ duration_ms`, `end-start ≥ 100`, and not the full range |
| Save Choice (new) | creates a `Recording` row: `name` = user's name (1–120, unique per session by `name_key`), `file_name` from `safe_name(name)+ext`, `origin='imported'`, `original_file_name` = source file name, `status='complete'` |
| Save Choice (overwrite) | same row: `size`, `duration_ms` updated, `version`+1; `name`/`file_name` unchanged |
| Recordings Browser | read-only view: `[{class, sessions:[{session, recordings[]}]}]` |
| Editing Tool | frontend-only registry entry `{id, title, icon, component}` |

State: while a trim runs, a per-session lock prevents concurrent imports/trims; no new status values.
