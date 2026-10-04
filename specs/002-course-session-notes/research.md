# Phase 0 Research: Course Timeline & Session Notes (002)

Builds on feature 001 (see `specs/001-class-schedule-calendar/research.md`, R1–R15). All 001
conventions apply: `/api/v1`, camelCase JSON, RFC 9457 errors, `If-Match` versions, commit before
response, `StorageService` as the only file-system module, session key `{lineageId}:{date}`.

## N1. Markdown editor

- **Decision**: CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `search`,
  `lang-markdown` with the GFM extensions, `@lezer/markdown`) wrapped in a small React component
  (no wrapper library). One `EditorView` per workspace; each open tab keeps its own
  `EditorState` (cursor, selection, undo history) plus scroll position, swapped on tab change.
- **Live preview** (FR-022, clarified default): a custom extension using the Markdown syntax
  tree. On lines/blocks **not** containing a selection it (a) hides syntax marks (`#`, `*`, `_`,
  `` ` ``, `[`, `](url)`, `>`), (b) styles headings, emphasis, code, quotes and links, (c) renders
  task-list checkboxes as clickable widgets that toggle `[ ]`/`[x]`, and (d) replaces GFM tables
  with an HTML table widget; moving the cursor into a block reveals its raw Markdown. Links open
  in a new tab on click (or `Mod-Enter` with the cursor on the link).
- **Raw mode**: the same editor with the live-preview extension removed via a `Compartment`, so
  switching keeps the document, cursor and history.
- **Rationale**: The document stays the exact Markdown text the user typed (FR-023); a WYSIWYG
  editor (TipTap/Milkdown/BlockNote) round-trips through a document model and rewrites
  formatting. CodeMirror is accessible (contenteditable with ARIA), fast on 50k-word documents
  (viewport rendering), and themeable with CSS variables (Constitution V).
- **Alternatives**: `@uiw/react-codemirror` (extra wrapper, little benefit); Milkdown / TipTap
  (rewrites Markdown); a textarea + side preview (rejected by the clarification).

## N2. Note storage and atomic writes

- **Decision**: Each note is `<session folder>/notes/<safe_name(name)>.md` (UTF-8, `\n` kept as
  typed). Writes go through `StorageService.write_text_atomic`: write `.<name>.tmp-<random>` in the
  same folder → `flush` + `fsync` → `os.replace` → `fsync` the folder (where supported). The
  database stores per note: `version` (increments on every save), `content_hash` (SHA-256 of the
  file bytes last written or read) and `size`.
- **Rationale**: A crash mid-write leaves either the old or the new file, never a truncated one
  (Constitution I). The hash lets the server notice edits made outside the app.
- **Alternatives**: Content in SQLite (violates Principle II); in-place writes (truncation risk).

## N3. Session folders (lazy, recorded once)

- **Decision**: New table `session_folders` keyed by the session key (`lineage_id`,
  `original_date`). Created on the first note save for that session (feature 003 reuses it for
  audio). Name from 001's `class_date_folder_name`: `YYYY-MM-DD`, else `YYYY-MM-DD HHmm`, else a
  ` (2)` suffix; stored and never recomputed. The row also snapshots the course id, start/end time,
  class title and location so a session that later disappears from the schedule can still be shown
  ("No longer scheduled", FR-006).
- **Rationale**: Matches 001 contracts/storage-layout.md; avoids empty folders for every session.

## N4. Saving, conflicts and never losing typed text (FR-018–FR-020, SC-002)

- **Decision**:
  - Client autosaves 800 ms after the last keystroke and at most every 2 s while typing
    continuously; it also flushes on tab switch, session switch, `visibilitychange` (hidden) and
    `pagehide` (`fetch(..., { keepalive: true })`).
  - Until the server confirms, the latest text is also kept as a **local draft** in
    `localStorage` (`uh.draft.<noteId>` = `{ baseVersion, content, savedAt }`). On opening a note,
    a draft whose `baseVersion` equals the server version and whose content differs is restored
    and saved immediately; a draft based on an older version is offered in the conflict dialog.
  - `PUT /notes/{id}/content` requires `If-Match: "<version>"` and `baseHash`. The server
    re-hashes the file on disk first:
    - version mismatch → **412 `version_conflict`** (another window saved);
    - version matches but disk hash ≠ stored hash → **409 `file_changed_on_disk`** (edited
      outside the app) — or `file_missing` if the file was deleted;
    - both problems include `current: { content, version, hash }` so the client can resolve.
  - Conflict dialog offers: **Keep both** (default — saves the user's text as a new note
    "<name> (my version)"), **Use mine** (overwrite: retries with the current version/hash), and
    **Use the file's version** (discard local text; the draft is kept until the user confirms).
  - Failed saves retry with backoff (1, 2, 4 … 30 s); the tab shows "Not saved"; leaving the page
    or closing the tab with unsaved/failed text shows a confirmation.
- **Rationale**: Covers crash/reload/network loss (local draft), concurrent windows (version) and
  external editors (hash) without silent overwrites (Constitution I).
- **Alternatives**: CRDT/OT live sync (far beyond scope); last-write-wins (violates FR-020).

## N5. Reading notes edited outside the app

- **Decision**: `GET /notes/{id}` reads the file; if its hash differs from the stored hash and no
  client is mid-edit, the server adopts the disk version (stores the new hash, bumps `version`).
  A missing file returns `missing: true` with empty content; saving recreates the file only after
  the user chooses "Use mine".
- **Rationale**: Files are the source of truth (Principle II); users may edit notes in any editor.

## N6. Deleting note files

- **Decision**: `StorageService.delete_note_file(parts)` — removes a single `*.md` file located in
  a `notes/` folder under the user's root; refuses directories and anything else. Called only by
  `DELETE /notes/{id}` after the UI's explicit confirmation (FR-021, spec assumption "removed
  permanently"). 001's "storage never deletes" guarantee still holds for folders and for every
  hierarchy/class/account deletion.
- **Rationale**: Spec requires the file to leave the `notes/` folder; the narrow method keeps the
  blast radius minimal. 001's unit test is updated to allow exactly this method.
- **Alternatives**: Move to a `.trash/` folder (contradicts the "removed permanently" assumption;
  candidate for a later "undo" feature).

## N7. Course timeline

- **Decision**: `GET /courses/{courseId}/timeline` returns every session of every class of the
  course over the classes' full span (first `start_date` → last resolved end; count-based rules
  are expanded to their last occurrence), plus "no longer scheduled" sessions that have a session
  folder with notes. Each entry carries `noteCount` and `audioCount` (0 until feature 003). The
  client groups by month and scrolls to the current/next session. 300 sessions render without
  virtualization (plain list, `content-visibility: auto` on month groups).
- **Rationale**: One request for the whole course (SC-005); counts come from a grouped SQL query.

## N8. Upcoming → past without reload (FR-027)

- **Decision**: The client derives status from `start` vs. now with a `useNow()` hook that
  schedules a re-render at the next session start (and every minute as a fallback); the server's
  `status` is only the initial value.

## N9. Workspace state and preferences (FR-008, FR-013, FR-022)

- **Decision**: Server-side per user:
  - `workspace_states` (user, lineage_id, original_date) → `open_note_ids` (JSON list),
    `active_note_id` — `GET/PUT /workspace/{sessionKey}` (debounced 500 ms on change);
  - `ui_preferences` (user) → JSON object with `editorMode` (`live`|`raw`),
    `workspaceLeftCollapsed`, `workspaceRightCollapsed` — `GET/PATCH /preferences`.
- **Rationale**: Spec says "remembered per user", i.e. across devices; feature 005 will move theme
  and provider settings into its own tables, `ui_preferences` stays for UI conveniences.

## N10. Routes and shell integration

- **Decision**: `/courses/:courseId` → course timeline page (replaces 001 placeholder);
  `/courses/:courseId/sessions/:sessionKey` → workspace. The calendar's session details gain an
  "Open notes" action via 001's `registerSessionAction`. The workspace right panel is a registry
  slot (`registerWorkspacePanel`) with an explanatory placeholder until feature 003 registers the
  audio panel. Workspace keyboard shortcuts (FR-024): `Alt+N` new note, `Alt+W` close tab,
  `Alt+PageDown` / `Alt+PageUp` next/previous tab, `Alt+[` / `Alt+]` toggle left/right panel,
  `Mod+E` toggle live/raw. (Plain `Ctrl+W`/`Ctrl+Tab` belong to the browser.)

## N11. Session switching without losing text

- **Decision**: Switching session (or route) first awaits the autosave flush of every dirty tab;
  if a save fails the text stays in the local draft and the tab keeps "Not saved" when the user
  returns (US3 scenario 4). The note list, tabs and right panel re-key on the session key.
