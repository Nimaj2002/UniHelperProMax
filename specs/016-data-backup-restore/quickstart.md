# Quickstart: Validate Backup & Restore

**Feature**: 016-data-backup-restore

These scenarios prove the feature end to end. Endpoint and error details are in
[contracts/backup-api.md](./contracts/backup-api.md), screens in
[contracts/ui-contract.md](./contracts/ui-contract.md), and file and job shapes in
[data-model.md](./data-model.md).

## Prerequisites

- Backend dependencies: `cd backend && uv sync`
- Frontend dependencies: `cd frontend && pnpm install`
- A seeded account with at least one of every item: semester, course with sessions, event, note
  with a diagram, recording, imported audio, PDF with annotations, AI chat with an attachment,
  task with checklist, custom theme, a transcription provider key and an AI endpoint key. The
  integration tests build this with `tests/e2e_seed.py` helpers.

## Automated checks

```bash
cd backend
uv run pytest tests/contract/test_backup_api.py         # every endpoint + error code
uv run pytest tests/unit/test_backup_tables.py          # every table classified (R4)
uv run pytest tests/unit/test_backup_archive.py         # safe paths, manifest, hashes (R3, R9)
uv run pytest tests/integration/test_backup_roundtrip.py
uv run pytest tests/integration/test_restore_atomicity.py
uv run pytest tests/integration/test_restore_upgrade.py
uv run pytest tests/integration/test_backup_account_isolation.py
uv run ruff check . && uv run mypy src

cd ../frontend
pnpm test -- backup                                      # page states, blocked state, epoch reload
pnpm e2e tests/e2e/backup-restore.spec.ts
pnpm lint && pnpm typecheck
```

## Manual scenarios

### 1. Backup contents (US1, FR-002…FR-006, SC-001, SC-007)

1. Settings → Backup & restore → **Create backup**. The progress bar moves, and the file
   downloads as `UniHelperProMax-backup-<date>-<time>.zip`. In the desktop app a save dialog
   opens instead.
2. Open the zip with the OS archive tool:
   - `files/<year>/<semester>/…` mirrors the data folder: notes open as Markdown, audio plays,
     PDFs open.
   - `manifest.json` shows the counts.
3. Search the zip bytes for each key you entered. There should be **no match**:
   `unzip -p backup.zip | grep -c "<key>"` → `0`.

### 2. Round trip into an empty account (US2, SC-002)

1. In a fresh data folder (desktop) or a new web account, restore the zip.
2. The summary shows the backup date and counts, and lists the two keys to re-enter.
3. Confirm. All classes, notes, recordings, documents with annotations, chats, tasks, events
   and themes open.
4. `diff -r` of the extracted `files/` against the new account folder shows no differences.
5. Providers show "not configured" until the keys are entered again.

### 3. Replacing existing data and the safety backup (FR-013, FR-014)

1. Add a note and drop `extra.txt` into a session folder with the file manager.
2. Restore the earlier backup. The confirmation says 1 file will be removed and a safety
   backup will be made.
3. After the restore, the note and `extra.txt` are gone.
4. The Safety backup card shows the new safety file (path on desktop, download on web), and it
   contains both.
5. Restore the safety backup. The note and `extra.txt` are back. Only one safety file exists.

### 4. Refused files (FR-011, FR-019, FR-020, SC-005)

Each of these is refused with the right message, and the data stays unchanged:

| File | Expected result |
|---|---|
| a random `.zip` | "not a backup" |
| a backup with one byte changed in a note | "damaged or modified" |
| a backup with `../evil.txt` added | "unsafe" |
| a backup whose manifest has a future `schemaRevision` | "update the app first" |

A fixture backup from the previous schema revision is accepted, and the summary says "Upgraded
from an older version".

### 5. Blocking and interruption (FR-015, FR-017, SC-004)

1. Start a recording, then try to restore. **Restore…** is disabled with "Stop the recording
   first".
2. Start a restore of a large backup and kill the backend during "Restoring". Restart it. The
   data is either entirely the old data or entirely the backup, and no `.restore-*` folders
   remain.
3. Open a second tab during a restore. It shows "Restoring your data…", then reloads with the
   restored data.

### 6. Size (FR-022, FR-023, SC-003)

1. With about 1 GB of audio, backup takes under 2 minutes and restore under 3 minutes on a
   typical laptop. Memory stays flat (watch the backend process).
2. Fill the disk until less space is free than the backup's size, then try a restore. You get
   "not enough space", with the needed size, and nothing changes.

### 7. Accounts (web)

As a member, restore a backup. The owner's data and folder are unchanged, and so is the
member's login.

## Done when

Every automated check above passes, and manual scenarios 1–7 are verified in light and dark
themes with keyboard-only navigation (Constitution quality gates).
