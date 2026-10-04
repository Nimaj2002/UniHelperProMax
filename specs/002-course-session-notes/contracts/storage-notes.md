# Contract: Session Folders & Note Files

Extends `specs/001-class-schedule-calendar/contracts/storage-layout.md`.

```text
files/<username>/<Year>/<Semester>/<Course>/<class_date>/notes/<Note name>.md
```

- `<class_date>` is assigned once, on the first note of the session: `YYYY-MM-DD`; if the course
  already has that folder for another session, `YYYY-MM-DD HHmm`; then ` (2)`, ` (3)`. Stored in
  `session_folders` and never renamed (moving a session's time keeps its folder).
- `<Note name>.md` = `safe_name(name)` + `.md`, unique case-insensitively within `notes/` (suffix
  ` (2)` before `.md`). Renaming a note renames the file (`os.replace`), compensated on rollback.
- Files are UTF-8 Markdown exactly as typed; no front-matter or app-specific markup.
- Writes are atomic (temp file in the same folder + fsync + rename). Temp files start with `.`
  and end with `.tmp-<random>`; leftovers are ignored by the app.
- Deleting a note removes its single `.md` file after confirmation. Nothing else in the tree is
  ever deleted by the app (folders, other files, or anything when classes/courses are deleted).
- Files edited outside the app are adopted on next read; files deleted outside the app show the
  note as "missing" until the user recreates or deletes it.
