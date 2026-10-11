# Contract: Storage Layout & Folder Naming

The on-disk layout is a user-facing contract (Constitution II): users browse it without the app,
and features 002–003 write into it. Feature 001 creates the year/semester/course levels only.

## Layout

```text
<UNIHELPER_DATA_DIR>/                      default: ./data
├── unihelper.sqlite3                      metadata only (never the sole copy of content)
└── files/
    └── <username>/                        one folder per account (owner-first model)
        └── <Year>/                        e.g. "2026"
            └── <Semester>/                e.g. "Fall 2026"
                └── <Course>/              e.g. "CS 201"
                    └── <class_date>/      e.g. "2026-10-05"        ← created by 002/003
                        ├── notes/         Markdown files            ← 002
                        └── audios/        audio files               ← 003
```

## Safe folder names (`safe_name(display_name)`)

Applied to year, semester, course, note, and recording names.

1. Unicode NFC normalise; collapse internal whitespace to single spaces; trim.
2. Replace each of `/ \ : * ? " < > |` and control characters (U+0000–U+001F, U+007F) with `-`.
3. Trim leading/trailing spaces and dots (Windows forbids trailing dots/spaces).
4. If the result (case-insensitive, ignoring extension) is a Windows reserved name — `CON`, `PRN`,
   `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` — append `_`.
5. Truncate to 80 characters (on a character boundary; then re-trim).
6. If empty after the above, use `Untitled`.
7. Sibling collision (case-insensitive, since Windows/macOS file systems are): append ` (2)`,
   ` (3)`, … before any extension.

Examples: `"CS 201: Intro"` → `CS 201- Intro`; `"Fall/Spring"` → `Fall-Spring`; `"con"` → `con_`.

The display name stays exactly as typed; only the folder name is sanitised. The chosen
`folder_name` is stored in the database and reused, never recomputed on read.

## class_date folder naming (implemented by 002, specified here)

A session's folder is created the first time content (note or recording) is saved for it, and its
name is then stored in `session_folders` and never changes:

1. `YYYY-MM-DD` (session date) if no sibling folder of that name exists for the course.
2. Otherwise `YYYY-MM-DD HHmm` using the session's start time (e.g. `2026-10-05 1400`).
3. Otherwise apply the collision suffix rule ` (2)`, ` (3)`.

Because the name is recorded at creation, a second session added later on the same date never
renames an existing folder, and moving a single session's time (scope "This session") keeps its
folder.

## Lifecycle rules

| Event | Filesystem effect |
|---|---|
| Create year/semester/course (incl. inline via `POST /classes`) | `mkdir -p` its folder before the DB commit |
| Rename year/semester/course | compute new `safe_name`; `os.replace(old, new)`; on DB failure rename back |
| Delete class / course / semester / year | **no deletion** — folders and files stay (FR-019); API returns `keptFolder` |
| Trash → Delete → "Yes" (009) | that class session's or event's folder (`…/<date>/` or `…/_Events/<date title>/`) and everything in it is removed; nothing else |
| Delete member account | DB rows removed; `files/<username>/` kept; owner told the path |
| Folder renamed or deleted outside the app | next create/rename recreates as needed; 002 reports missing files instead of failing |

Only the backend `StorageService` touches the file system (Constitution III); paths returned by the
API are relative to the user's folder.
