# Research: Home General Notes (018)

## R1 — A general note is a `Note` row with no session

- **Decision**: Store general notes in the existing `notes` table with `session_folder_id = NULL`.
  Their file lives at `<user>/General Notes/<file_name>`. `note_service._note_with_path` gets one
  branch: no session folder → `[username, GENERAL_NOTES_DIR, file_name]`.
- **Rationale**: Every existing note endpoint (`GET /notes/{id}`, `PUT /notes/{id}/content`,
  `PATCH /notes/{id}`, `DELETE /notes/{id}`) and every frontend piece (`MarkdownEditor`,
  `NoteSaver`/`ensureSaver`, `ConflictDialog`, drafts, page-hide flush) is keyed by note id only.
  With a nullable folder they work for general notes unchanged, including version and
  disk-hash conflict guards (Principle I) and the per-note file lock.
- **Alternatives considered**:
  - New `general_notes` table plus its own service: duplicates about 200 lines of save/conflict
    logic, and the frontend editor host would need a second save path. Rejected.
  - Files only, with no database rows (id = file name): the editor's saver needs a stable id and
    a version, and renaming would change the id. Rejected.

## R2 — Effects of a nullable `session_folder_id` on existing code

Checked every reader of `Note.session_folder_id`:

| Code | Effect of `NULL` | Change needed |
|------|------------------|---------------|
| `note_search_service` (inner join on session folder) | General notes are excluded from search; search is out of scope (spec Assumptions) | none |
| `timeline_service` (join) | Not counted on any timeline | none |
| `calendar_import_service`, `event_service` (`exists()` by folder ids) | `NULL` never matches | none |
| `transcription_service` (`note.session_folder_id != folder.id`) | Transcription into a general note is refused | none |
| `workspace_service.folder_of` | Returns `None`; only used for workspace tabs, which never hold general notes | none |
| `note_service.meta`, `rename_note`, `list_notes`, `create_note` | Need the folder | branch on "general" scope |
| Backup `tables.py` / writer / restore | Row copied as-is; the folder walk covers the whole user root | none |
| Uniqueness constraints `uq_notes_folder_name` / `uq_notes_folder_file` | SQLite treats `NULL`s as distinct, so they no longer guard general notes | add partial unique indexes (R3) |

## R3 — Migration `0016_general_notes`

- **Decision**: Use `batch_alter_table("notes")` to make `session_folder_id` nullable. Add the
  partial unique indexes `uq_notes_general_name (user_id, name_key) WHERE session_folder_id IS NULL`
  and `uq_notes_general_file (user_id, file_key) WHERE session_folder_id IS NULL`.
- **Rationale**: Gives the same database-level uniqueness that session notes have. The existing
  migration runner already backs up the database before upgrading (Principle VIII).
- **Alternatives considered**: A sentinel "general" `SessionFolder` row. That fakes a session,
  and every session query would have to exclude it. Rejected.

## R4 — Reserved folder name

- **Decision**: Add `GENERAL_NOTES_DIR = "General Notes"` in `domain/naming.py`. When choosing
  folder names, year folders treat it as a taken sibling: `_folder_for(name, [*siblings,
  GENERAL_NOTES_DIR])`, the same pattern courses already use for `_Events`. A year named
  "General Notes" keeps its display name, but its folder becomes "General Notes (2)" (or whatever
  `unique_sibling` produces).
- **Rationale**: Year names are free text (1–80 characters), so they can collide (FR-011).
  Suffixing the folder is quieter than refusing the name and reuses existing code.
- **Known edge**: A user who already has a year folder called `General Notes` from before this
  feature. Listing only reads `*.md` files directly in the folder, and a year folder holds only
  semester subfolders, so nothing is misread. New general notes would sit beside those semester
  folders, which looks odd but loses no data. This is accepted, not migrated.

## R5 — Listing and syncing with the folder (FR-016, SC-005)

- **Decision**: `GET /general-notes` scans `<user>/General Notes/*.md` (top level only, not
  recursive). It inserts a row for each unknown file and deletes rows whose file is gone, then
  returns the list sorted by last-changed time, newest first. The last-changed time is the
  file's modification time, so edits made outside the app re-sort correctly. The sync does not
  hash files; content conflicts are still caught by the existing hash check on open and save.
  If the folder is missing, the list is empty.
- **Rationale**: Dropping a file into the folder makes it appear in the app, and deleting it
  outside makes it disappear, without a background watcher. One directory scan with a stat per
  file keeps 500 notes well under 1 s.
- **Alternatives considered**: A file watcher. That adds a new moving part, which Principle VII
  rules out.

## R6 — Naming, and discarding empty new notes (FR-015, edge cases)

- **Decision**: "New general note" calls `POST /general-notes` with an automatic name,
  `General note YYYY-MM-DD HH-mm` in local time. The server makes it unique the same way
  session notes are made unique. When the pop-up closes, the client first flushes the saver,
  then:
  1. If the note was created in this pop-up and its content is blank, it calls
     `DELETE /notes/{id}`. No confirmation is asked, because nothing is lost.
  2. Otherwise, if the name is still the automatic one and the text has a first line, it renames
     the note to that line (trimmed, at most 60 characters). If that name is taken, it keeps the
     automatic name.
- **Rationale**: This reuses the existing endpoints with no new server rules. A crash between
  creating and closing can leave one empty file behind, which is harmless and visible in the
  list.

## R7 — UI placement and pop-up

- **Decision**: Add `GeneralNotesSection` at the bottom of `TasksPanel`'s column, below the
  board or list, collapsible to its header. Its collapsed state is stored with the existing
  UI-preferences mechanism, using a new `general_notes_collapsed` key. The pop-up is
  `GeneralNoteDialog`, built on shadcn `Dialog`, about 640×480 and capped to the viewport. It
  has a "General note" badge, a name field, a save-state indicator (`SaveState` from tasks, or
  the workspace's status text), and `MarkdownEditor` in a compact layout. It has no session
  tools.
- **Rationale**: These are house components. The dialog handles focus trapping and returns
  focus to the element that opened it (FR-018). A dialog close that is blocked while a save is
  failing reuses the pattern from `WorkspacePage` (lines 684–709).
- **Terminology**: The on-screen label is "General notes", because Feature 012's
  `QuickNotesPopover` already uses "Quick notes" for task notes. The spec was normalized to
  match.

## R8 — Constitution Principle II amendment

- **Decision**: Before implementing, run `/speckit-constitution` to amend Principle II (MINOR,
  1.4.0 → 1.5.0). The amendment allows one reserved folder `<user folder>/General Notes/` that
  holds plain Markdown notes not tied to a course, session or event. Year folder names must not
  be able to take that name.
- **Rationale**: Principle II lists every allowed location. Events set the precedent for
  amending it.
