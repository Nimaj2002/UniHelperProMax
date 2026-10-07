# Phase 0 Research: Import Audio and Notes into a Session (006)

Builds on 002 (`note_service.create_note`, `note_file_lock`, autosave controller), 003
(`recordings` table, `RecordingPanel`, `Player`, `StorageService`) and 004 (transcription jobs,
`prepare` sends non-WebM files whole). No new packages on either side.

## I1. Imported audio is a `Recording` row, not a new table

- **Decision**: Store imported audio in the existing `recordings` table with two new columns:
  `origin` (`recorded` | `imported`, default `recorded`) and `original_file_name` (nullable).
  Imports are created directly with `status = complete`, `next_seq = 0`, `started_at` = import
  time. The `mime_type` CHECK is widened to the six import formats (I3).
- **Rationale**: FR-011 requires exactly the same list, player, rename, delete and Transcribe
  behaviour. Every one of those (API, `recording_service`, `transcription_service.prepare`,
  `RecordingPanel`, the 004 extension registry, the timeline `audio_count`) keys off
  `recordings`; one row type means zero duplicated code paths.
- **Alternatives**: A separate `audio_imports` table + union views (duplicates rename/delete/
  transcribe, 004 jobs reference `recording_id`); a boolean `imported` (an enum leaves room and
  reads better in the API).

## I2. Migration 0008 must not cascade-delete transcription jobs

- **Problem**: Widening a CHECK constraint in SQLite needs a table rebuild (Alembic
  `batch_alter_table`: create new → copy → `DROP TABLE recordings` → rename). With
  `PRAGMA foreign_keys=ON` (set on every connection in `db/engine.py`), `DROP TABLE` runs an
  implicit `DELETE FROM`, which **fires `ON DELETE CASCADE` on `transcription_jobs`** and would
  silently delete every job's history. The pragma can't be changed inside a transaction, and
  `upgrade_to_head` runs inside `engine.begin()`. No earlier migration rebuilt a table with data
  in it, so this is new.
- **Decision**: `db/migrate.py` runs migrations on a connection with `PRAGMA foreign_keys=OFF`
  set *before* the transaction begins (SQLite's documented 12-step ALTER procedure), then runs
  `PRAGMA foreign_key_check` before commit and aborts the upgrade if it reports anything. The
  0008 migration adds the two columns with `ADD COLUMN` and rebuilds only to replace the CHECK.
- **Test**: an integration test migrates a 0007 database holding a recording with a completed
  transcription job and asserts the job, the recording and its file survive unchanged.
- **Alternatives**: Keep the old CHECK and store the real format in a new column (two sources of
  truth for one fact); drop the CHECK entirely (loses a guard the 003 design relied on).

## I3. Accepted formats, extensions and MIME types (FR-003)

| Format | Extensions accepted | Stored `mime_type` | Stored extension |
|---|---|---|---|
| MP3 | `.mp3` | `audio/mpeg` | `.mp3` |
| M4A / AAC | `.m4a`, `.aac` | `audio/mp4` (`.m4a`), `audio/aac` (`.aac`, raw ADTS) | as uploaded |
| WAV | `.wav` | `audio/wav` | `.wav` |
| OGG (Vorbis/Opus) | `.ogg`, `.oga`, `.opus` | `audio/ogg` | as uploaded |
| WebM (Opus) | `.webm` | `audio/webm` | `.webm` |
| FLAC | `.flac` | `audio/flac` | `.flac` |

- **Decision**: The extension (case-insensitive) decides the expected format; the client checks
  it before upload (FR-003) and the server re-checks it and then verifies the bytes match (I4).
  The browser-reported `File.type` is ignored (unreliable across OSes, often empty for `.opus`/
  `.flac`). `.mp4`/`.mov`/`.mkv` are video containers and are rejected (spec assumption).
- `StorageService.delete_content_file` and the rename path accept the new extensions in
  `audios/`. `recording_service.EXT` becomes a per-row extension taken from `file_name`, so a
  rename keeps the original extension.

## I4. Verifying "playable audio" and finding the duration without new dependencies (FR-007)

- **Decision**: New pure-Python module `domain/audio_probe.py`: `probe(path) -> ProbeResult |
  None` reads the header (and for OGG the last page) of the staged file and returns
  `(format, duration_ms)` or `None` when it isn't recognisable audio of the expected format:
  - WAV: `RIFF…WAVE`, `fmt ` + `data` chunks → `data_size / byte_rate`.
  - FLAC: `fLaC` + STREAMINFO → `total_samples / sample_rate`.
  - OGG: `OggS` + Vorbis/Opus ID header → last page granule position (`/48000` for Opus,
    `/rate` for Vorbis, minus Opus pre-skip).
  - M4A: `ftyp` box, then `moov/mvhd` → `duration / timescale` (walks top-level boxes; `moov`
    may be at the end).
  - AAC (ADTS): sync word `0xFFF` → frame count × 1024 / sample rate (scan, bounded by size).
  - MP3: skip ID3v2, find a valid frame header; Xing/Info or VBRI header → frames × samples per
    frame / rate; otherwise CBR estimate `audio_bytes × 8 / bitrate`.
  - WebM: existing `domain/webm.py` duration reader; if the file has no Duration element, fall
    back to the client duration (below).
- **Client duration as fallback**: before upload the browser loads the file into a detached
  `<audio>` element (`loadedmetadata`, 5 s timeout) and sends `durationMs` when it gets a finite
  value. The server uses its own value when it has one, else the client's, else 0 (shown as "—").
  A browser that can't decode a valid format (e.g., Safari with some OGG files) must not block the
  upload, so a failed client probe is *not* a rejection — only the server decides "unreadable".
- **Rationale**: Header checks catch wrong/renamed/truncated-at-start files, which is what
  "couldn't be read as audio" means for users; full decoding would need ffmpeg (Constitution VII).
- **Alternatives**: `mutagen` (covers all formats, but GPL-2.0-or-later and a new dependency);
  ffprobe (new system dependency); trust the client entirely (server can't guarantee FR-007).

## I5. Upload transport: one streamed request per file, staged, then moved (FR-004–FR-006, FR-024)

- **Decision**: `POST /sessions/{sessionKey}/recordings/import?fileName=…&durationMs=…` with the
  raw file as the body (`Content-Type: application/octet-stream`). The client sends it with
  `XMLHttpRequest` (fetch has no upload progress events) and `xhr.abort()` cancels.
- **Server flow** (async route, file I/O via `anyio.to_thread`):
  1. Reject before reading: unsupported extension → 415 `unsupported_type`;
     `Content-Length` missing → 411; over 1 GB → 413 `file_too_large`; not enough free disk
     (`shutil.disk_usage` < size + 64 MB) → 507 `insufficient_storage`; session not found → 404.
  2. Stream `request.stream()` into `files/.uploads/<random>.part`, counting bytes; abort with
     413 `file_too_large` as soon as the count passes 1 GB; if the stream ends with a count
     different from `Content-Length`, answer 422 `incomplete_upload`; on client disconnect
     (`ClientDisconnect`) or any error the `.part` file is deleted.
  3. `fsync`, `audio_probe.probe` → 422 `unreadable_audio` (and delete) when `None`.
  4. In the DB transaction: name + file name (I6), `os.replace` the `.part` into the session's
     `audios/` folder (same file system), insert the row; `on_rollback` moves it back out and
     deletes it, so a failed commit leaves no stray file.
- **Staging location**: `files/.uploads/` — inside `files_root` so the final move is an atomic
  rename on the same file system, but outside every user folder so a half-written file never
  appears in `audios/` (FR-024). Usernames can't start with `.` (`safe_name` strips it), so it
  can't collide with a user folder. On startup, `.part` files older than 1 hour are deleted
  (interrupted server). This is the second, documented exception to "StorageService never
  deletes": it only ever deletes `*.part` files in `.uploads/`.
- **Concurrency**: the client runs at most 2 uploads at a time and queues the rest (each keeps its
  own progress and cancel). The backend is single-process (004 plan), so the free-space check is
  done per request and the stream aborts on `OSError(ENOSPC)` as a backstop.
- **Rationale**: One request keeps cancel = abort and failure = nothing kept, matching the spec's
  "no resume" assumption. Streaming to disk keeps memory flat for 1 GB files.
- **Alternatives**: Reuse the 003 chunk protocol (resumable, but creates a visible
  `status=recording` row during upload and needs a separate cancel/cleanup path); multipart form
  (`python-multipart` spools to its own temp dir, harder to control and to count bytes); tus
  protocol (new dependency, resume is out of scope).

## I6. Names for imported audio (FR-009)

- **Decision**: Display name = `normalize_display(stem of original file name)`, truncated to 120
  characters; empty → "Imported audio". If the name key is taken in the session, append " (2)",
  " (3)" … (same loop as `_default_name`). File name = `unique_sibling(safe_name(name) + ext,
  existing file names)`, and like `create_note`, loop while a file with that name already exists
  on disk (a file copied in by hand is never overwritten). `original_file_name` stores the name as
  uploaded (for the list's tooltip and the import summary).
- **Concurrency**: two uploads (2 run at once) may pick the same free name, and the first two
  into a new session would both create its folder row. `import_audio` takes a per-session
  `threading.Lock` (same pattern as `note_file_lock`, single process) from resolving the session
  and creating its folder until the row is committed, so the second upload sees the first one's
  folder and name and gets the next free one. Chosen over retrying on `IntegrityError` to avoid error-driven control
  flow.

## I7. The list shows origin and import date (FR-010)

- **Decision**: API adds `origin` and `originalFileName` to `Recording`. The panel shows an
  "Imported" badge (text) for `origin = imported`; recorded items keep the existing badges and get
  no new badge (absence of "Imported" means recorded, and the date line reads "Recorded 5 Oct ·
  10:02" vs "Imported 6 Oct · 14:31" so the difference is in text, not only the badge). Ordering
  stays `started_at DESC` — import time for imports.

## I8. Transcribing imported audio (FR-011, spec edge case)

- **Decision**: No change to the provider interface. `prepare` already sends non-WebM files whole
  and fails with "too long for this provider" over the limit. One fix: `prepare` currently reads
  the whole file into memory *before* the size check; for non-WebM files it must `stat` first, so a
  1 GB WAV for a 25 MB-limit provider fails without loading 1 GB. Imported WebM files go through
  `webm.split` like recordings (falls back to whole-file on `WebmError`). `AudioPart` carries the
  row's `mime_type` and file name, so providers receive the right extension.
- Voice Studio and OpenAI-compatible providers accept mp3, m4a, wav, ogg, webm and flac; `.aac`
  (raw ADTS) is sent as `audio/aac` and a provider that rejects it returns its normal
  `file_rejected` error.

## I9. Imported WebM files are not finalized

- **Decision**: Imported files are stored byte-for-byte (FR-008 "unchanged"), so `webm.finalize`
  (which rewrites Duration/Cues for 003 recordings) is not run on imports. A cue-less WebM still
  plays; seeking may be slower. Recorded WebM is unaffected.

## I10. Notes import: read in the browser, create through the existing API (FR-014–FR-019)

- **Decision**: The client reads each picked file: extension `.md`/`.txt` (case-insensitive),
  `size ≤ 5 MB`, `TextDecoder("utf-8", { fatal: true })` (throws → "not readable text"), a NUL
  character → "not readable text", leading BOM stripped. Then it calls the existing
  `POST /sessions/{sessionKey}/notes` with `{ name, content }` — `create_note` already writes the
  file atomically before inserting the row, never overwrites an existing file, and returns 409
  `name_taken` on a clash. Files are processed one at a time in pick order, so a clash with an
  earlier file in the same import surfaces as the same 409 (FR-018).
- **Rationale**: No new endpoint for the common path; the atomicity, naming and file-collision
  guarantees already exist and are tested.
- **Server-side check**: `create_note` rejects content containing `\x00` with 422
  `content_not_text`, so the guarantee holds for any client.
- **Alternatives**: A multipart "import notes" endpoint (duplicates `create_note`; the browser can
  validate UTF-8 itself); read as Latin-1 fallback (silent mojibake contradicts "identical content").

## I11. Replace: a dedicated endpoint with the guards the spec names (FR-020)

- **Decision**: `PUT /notes/{noteId}/import-replace` with `If-Match: <version>` and
  `{ content }`. Under `note_file_lock(note_id)`:
  1. version mismatch → 412 `version_conflict` (the note changed after the user confirmed);
  2. a transcription job in an active status with `note_id = noteId` → 409 `note_transcribing`;
  3. file on disk differs from `content_hash` (edited outside the app) → 409
     `file_changed_on_disk`; file missing → the note is recreated with the imported content
     (that is what the user asked for);
  4. `write_text_atomic`, update hash/size/`updated_at`, commit before releasing the lock (004-D1).
- **Client-side guard for unsaved edits**: before showing Replace's confirmation the importer asks
  the autosave registry (`getSaver(noteId)` in `sessions/autosave.ts`) for the note's saver; status `dirty | saving | error | conflict` →
  Replace is refused with "Lecture 3 has unsaved changes. Wait for it to save, then try again."
  The server's version check (1) catches a save that lands between confirmation and request.
- **Open tab after replace**: `NoteSaver` gains `adoptServerReplace({ content, hash, version })`
  (allowed only in status `saved`; sets saved content, clears the draft) and emits it through a
  listener like `onServerAppend`, so the open editor swaps its document to the replaced content
  without a conflict dialog. If the saver is not `saved` by then, the next save gets the normal
  412 and the existing conflict dialog keeps both versions (Principle I).
- **Rationale**: `save_content` has the right locking but not the transcription guard, and its
  `base_hash` contract is about the editor's own edits; a separate operation keeps editor saves
  unchanged and makes the destructive action explicit in the API and logs.
- **Known issue interplay**: Batch B (`KNOWN-ISSUES.md`) — rename/delete don't take
  `note_file_lock`. Replace takes it, so it is safe against appends and saves; it doesn't widen the
  rename/delete race.

## I12. Conflict prompt and "apply to all" (FR-018, FR-021)

- **Decision**: A single `AlertDialog` per conflict: "A note named “Lecture 3” already exists in
  this session." → **Rename…** (inline name field pre-filled with the first free "Name (n)",
  validated live against the loaded note list and by the server's 409) · **Replace…** · **Skip**,
  plus an "Apply to all remaining conflicts" checkbox (only when ≥ 2 conflicts remain). Escape /
  close = Skip. Replace (single or apply-to-all) opens a second destructive `AlertDialog` listing
  every note to be replaced; Cancel returns to the conflict prompt. Apply-to-all Rename uses the
  auto-suggested names without asking again.

## I13. Upload UI, drag and drop and leaving the page (FR-002, FR-005, FR-012, FR-025, FR-026)

- **Decision**: An app-level `importQueue` singleton (outside React, like the 003 `recorder`)
  holds uploads so they survive navigation; `RecordingPanel` renders the entries for its session.
  Each entry: file name, size, progress bar (shadcn `Progress`, `aria-valuenow`), Cancel; done →
  disappears into the list with a toast; failed → message + Retry + Dismiss. A polite live region
  announces start, every 25 %, and the result. The existing `registerSignOutGuard` / `beforeunload`
  hook is extended to warn while uploads run.
- **Drop zone**: the whole audio panel; `dragenter` with `Files` shows a dashed token-coloured
  overlay "Drop audio files to upload"; folders (`webkitGetAsEntry().isDirectory`) are ignored
  with a message. "Upload audio" (a `Button` + hidden `<input type=file multiple
  accept=".mp3,.m4a,…">`) is the keyboard path.
- **Summary**: a multi-file import ends with one toast summarising counts and a "Details" action
  opening a small dialog listing each file's result (FR-025); single-file imports use a single
  toast.
- Uses the existing shadcn `Progress`, `AlertDialog`, `Checkbox`, `Badge`; no new UI primitive or dependency.

## I14. Tests (Constitution VI)

- **Contract**: every new/changed operation (`POST …/recordings/import` success + 404/411/413/
  415/422/507, `PUT /notes/{id}/import-replace` success + 409/412, `POST …/notes` `content_not_text`).
- **Integration (real API + SQLite + temp file system)**:
  - *Import → play → transcribe*: upload a generated WAV/OGG/MP3 fixture, file lands in `audios/`
    unchanged (hash), row `origin=imported`, audio endpoint serves it with Range, transcription
    with the fake transcriber appends to a note (extends the 004 critical flow).
  - *Import never damages existing data*: cancelled upload (client disconnect mid-stream),
    oversized stream, unreadable bytes, name clash with existing recording and with a hand-copied
    file on disk → existing rows/files byte-identical, no `.part` left after the request.
  - *Replace guards*: active transcription job → 409, note untouched; stale version → 412.
  - *Migration 0008*: I2 test.
- **Unit**: `audio_probe` on generated fixtures for every format plus truncated/renamed files;
  naming (I6). Frontend Vitest: file pre-checks, conflict flow state machine, upload queue with a
  fake XHR (progress, cancel, concurrency 2). Playwright: upload with progress + cancel, drag and
  drop, note import with each conflict choice, keyboard-only, light/dark axe.
- Fixtures are generated in tests (WAV/FLAC/OGG headers written by small helpers, like
  `webm_fixture.py`); no binary fixtures committed except one short real MP3 and M4A
  (< 50 KB each) for header variants that are tedious to synthesise.
