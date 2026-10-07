---

description: "Task list for feature 006 — Import Audio and Notes into a Session"
---

# Tasks: Import Audio and Notes into a Session

**Input**: `/specs/006-session-file-import/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: INCLUDED. Constitution VI requires tests for every endpoint, and this feature extends
the "transcribe → append to note" critical flow. Tests come first in each story.

**Order**: Foundational → US1 (upload audio, MVP) → US2 (reject unusable files) → US3 (manage and
transcribe imported audio) → US4 (import notes) → US5 (name conflicts) → Polish.

**References**: research decisions are cited as I1–I14 (`research.md`); UI text and layout come
from `contracts/ui-import.md`; API shapes come from `contracts/openapi.yaml`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add the 006 fields to the `Recording` schema in `specs/003-session-audio-recording/contracts/openapi.yaml`: `origin` (enum `recorded`, `imported`, required), `originalFileName` (`[string, "null"]`, required), and widen `mimeType` to the enum `audio/webm, audio/mp4, audio/mpeg, audio/wav, audio/ogg, audio/flac, audio/aac`. Add a description line pointing to 006. Keep it identical to the `Recording` schema in `specs/006-session-file-import/contracts/openapi.yaml`.
- [X] T002 [P] Test audio fixture generators in `backend/tests/audio_fixtures.py`, in the style of `tests/webm_fixture.py`. Write functions that return bytes for a given duration:
  - `wav(ms, rate=16000, channels=1)`
  - `flac(ms)`: a valid `fLaC` + STREAMINFO with `total_samples` and minimal frames
  - `ogg_opus(ms)` and `ogg_vorbis(ms)`: ID header plus pages, with the last page's granule position set to match the duration
  - `adts_aac(ms)`: valid ADTS frame headers, 1024 samples per frame
  - `mp3_cbr(ms)`, `mp3_xing(ms)`: ID3v2 tag + frame headers ± Xing header
  - `m4a(ms, moov_at_end=False)`: `ftyp` + `mdat` + `moov/mvhd` with timescale/duration

  Also write `truncated(data)` and `renamed_pdf()` (`%PDF-1.4…` bytes).

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: data model and migration, file probing, staging storage, and module skeletons that
US1–US3 all need. US4 and US5 need only T011 and T012.

- [X] T003 Change `upgrade_to_head` in `backend/src/unihelper/db/migrate.py` (research I2):
  - Get a raw connection and run `PRAGMA foreign_keys=OFF` before any transaction starts.
  - Run `command.upgrade` inside `conn.begin()`.
  - Before commit, run `PRAGMA foreign_key_check`. If it returns any rows, raise `RuntimeError` listing the table names, so the transaction rolls back.
  - In a `finally`, restore `PRAGMA foreign_keys=ON`.
  - Add a docstring explaining why: SQLite's DROP TABLE in a batch rebuild fires `ON DELETE CASCADE`.
- [X] T004 Update `Recording` in `backend/src/unihelper/models/recording.py` and add Alembic `backend/src/unihelper/db/migrations/versions/0008_recording_origin.py` (revision `"0008"`, down_revision `"0007"`):
  - New column `origin`: `String(16)`, NOT NULL, default `'recorded'`, plus CHECK `origin IN ('recorded', 'imported')` named `origin`.
  - New column `original_file_name`: `String(255)`, nullable.
  - Replace the `mime` CHECK with `mime_type IN ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac')`.
  - Upgrade with `batch_alter_table("recordings", recreate="always")` and `server_default="recorded"`, so existing rows become `recorded`.
  - Downgrade: raise if any row has `origin = 'imported'` or a mime type outside `('audio/webm','audio/mp4')`; otherwise rebuild back to the 0005 shape.
- [X] T005 [P] Integration test `backend/tests/integration/test_migration_0008.py`:
  - Build a database at revision `0007` with a user, a session folder, a recording with a file, and a `completed` transcription job pointing at it.
  - Upgrade to head with `upgrade_to_head`.
  - Assert the job row still exists with the same fields, and the recording has `origin='recorded'`, `original_file_name IS NULL`, unchanged `id`/`name`/`file_name`/`version`.
  - Assert `PRAGMA foreign_keys` is ON again on a new connection, and that inserting a recording with `mime_type='audio/mpeg'` now succeeds.
  - Assert a forced dangling reference makes `upgrade_to_head` raise and leaves the revision unchanged.
- [X] T006 [P] Implement `backend/src/unihelper/domain/audio_probe.py` (research I4).
  - Public API: `FORMATS` maps each lower-case extension to a mime type:
    - `.mp3` → `audio/mpeg`
    - `.m4a` → `audio/mp4`
    - `.aac` → `audio/aac`
    - `.wav` → `audio/wav`
    - `.ogg`, `.oga`, `.opus` → `audio/ogg`
    - `.webm` → `audio/webm`
    - `.flac` → `audio/flac`
  - `ACCEPTED_EXTENSIONS` lists those keys.
  - `probe(path: Path, mime: str) -> ProbeResult | None`, where `ProbeResult(duration_ms: int | None)`. The file must match `mime`.
  - Read with seeks, never the whole file. Per format:
    - WAV: `RIFF`/`WAVE`, then `fmt ` and `data` chunks → `data_size*1000/byte_rate`.
    - FLAC: `fLaC` + STREAMINFO → `total_samples*1000/sample_rate`. `None` duration if `total_samples == 0`.
    - OGG: `OggS` + `OpusHead` (48 kHz, minus pre-skip) or `\x01vorbis` (rate). Duration from the granule of the last page; search backwards from the end in ≤ 64 KB windows.
    - M4A: `ftyp` first, then walk top-level boxes (64-bit sizes supported, `moov` may come after `mdat`) to `moov/mvhd` (v0/v1) → `duration*1000/timescale`.
    - AAC: ADTS sync `0xFFF`; count frames by walking frame lengths → `frames*1024*1000/rate`. Return `None` if the first frame is invalid.
    - MP3: skip ID3v2 (syncsafe size), require a valid MPEG audio frame header. Use a Xing/Info or VBRI frame count if present, else the CBR estimate `audio_bytes*8/bitrate`.
    - WebM: reuse `webm.analyse` on at most the first and last 4 MB. If it raises `WebmError`, return `None`; if it finds no duration, return `ProbeResult(None)`.
  - Return `None` when the header doesn't match, or when the computed duration is ≤ 0 where one was computable.
- [X] T007 [P] Unit tests `backend/tests/unit/test_audio_probe.py` using `tests/audio_fixtures.py`:
  - Every format's duration is correct within 50 ms (MP3 CBR within 2 %).
  - `m4a(moov_at_end=True)` works.
  - Each of the following returns `None`: `truncated(...)` headers, `renamed_pdf()` probed as `audio/mpeg`, WAV bytes probed as `audio/flac`, an empty file, random bytes.
  - `FORMATS` matches the table in research I3.
- [X] T008 Extend `backend/src/unihelper/storage/storage_service.py` (research I5):
  - `UPLOADS_DIR = ".uploads"`.
  - `open_upload() -> tuple[Path, BinaryIO]`: creates `files/.uploads/<token_hex(16)>.part` with mode `xb`.
  - `discard_upload(path)`: deletes only a `*.part` file whose parent is `files_root/.uploads`; raises `StoragePathError` otherwise; ignores missing files.
  - `commit_upload(path, parts) -> Callable[[], None]`: fsync the file, `ensure_dir(parts[:-1])`, refuse with `FileExistsError` if the target exists, `_replace_with_retry(path, target)`, `_fsync_dir`. Returns an undo that moves the file back to `.uploads/` and discards it.
  - `sweep_uploads(older_than: timedelta)`: deletes stale `*.part` files only.
  - `free_bytes() -> int`: `shutil.disk_usage(files_root).free`.
  - Let `delete_content_file` accept `.mp3 .m4a .aac .wav .ogg .oga .opus .webm .flac` in `audios/`.
  - Update the module docstring with the second delete exception.
- [X] T009 [P] Unit tests in `backend/tests/unit/test_storage_service.py`:
  - `open_upload` creates the file in `.uploads/`, never inside a user folder.
  - `discard_upload` refuses paths outside `.uploads/` and non-`.part` files.
  - `commit_upload` moves atomically, refuses an existing target (the existing file stays byte-identical), and its undo removes the moved file.
  - `sweep_uploads` deletes only stale `.part` files.
  - `delete_content_file` accepts the new audio extensions and still refuses e.g. `audios/x.txt`.
- [X] T010 Add startup cleanup to the lifespan in `backend/src/unihelper/main.py`. After `files_root.mkdir`, call `app.state.storage.sweep_uploads(timedelta(hours=1))`, catching and logging `OSError`.
- [X] T011 Add origin fields to `backend/src/unihelper/schemas/recordings.py`: `Recording.origin: Literal["recorded", "imported"]`, `Recording.original_file_name: str | None`, and widen `mime_type` to the 7-value `Literal`. In `recording_service.view()` (`backend/src/unihelper/services/recording_service.py`), return `origin` and `original_file_name`. Update the existing contract tests' expectations in `backend/tests/contract/test_recordings.py` (they must still validate against the 003 schema changed in T001).
- [X] T012 [P] Frontend module skeleton `frontend/src/features/imports/`:
  - `routes.tsx` is imported from `frontend/src/app/features.ts` (no UI yet).
  - Regenerate `frontend/src/lib/api/schema.d.ts` with `pnpm gen:api` after exporting the backend OpenAPI (`backend/src/unihelper/export_openapi.py`).
  - `frontend/src/features/recordings/api.ts` `Recording` type now includes `origin` and `originalFileName`.

**Checkpoint**: migration safe, probe and staging tested, API returns origin fields. Existing suites still green, except `test_coverage.py`, which waits for T016 and T039.

---

## Phase 3: User Story 1 — Upload a lecture recording made elsewhere (P1) 🎯 MVP

**Goal**: pick or drop audio files; each uploads with progress and cancel, then appears in the audio list marked "Imported" and plays with the existing player.

**Independent Test**: upload one supported file and confirm it is listed as imported, plays with every control, and exists byte-identical in the session's `audios/` folder.

- [X] T013 [P] [US1] Contract tests `backend/tests/contract/test_recording_import.py` for `POST /sessions/{key}/recordings/import`. Validate bodies with `openapi_check` `spec="006"`.
  - 201 for a WAV fixture: `origin="imported"`, `status="complete"`, `originalFileName` as sent, `name` = file stem, `durationMs` from the probe, `mimeType="audio/wav"`, `nextSeq=0`, `active=false`. `startedAt` ≈ now.
  - Client `durationMs` is used only when the probe gives none (WebM without Duration).
  - Name clash with an existing recording → `"<stem> (2)"`; the existing row is unchanged.
  - An on-disk file with the target name (copied in by hand) → a different file name is used; the hand-copied file is byte-identical afterwards.
  - Works for an upcoming session (creates the session folder).
  - Two concurrent imports of `lecture.mp3` into one session (two threads) → names `lecture` and `lecture (2)`, both 201, no 500.
  - 404 foreign or unknown session.
  - The new row appears first in `GET /sessions/{key}/recordings` and is served by `GET /recordings/{id}/audio` with 206 Range.
- [X] T014 [P] [US1] Integration test `backend/tests/integration/test_import_flow.py::test_import_then_play` (real API, SQLite, temp files):
  - Import each of WAV, FLAC, OGG/Opus, AAC, MP3, M4A fixtures into one session.
  - Each file sits in `…/<class-date>/audios/` with sha256 equal to the upload.
  - The timeline `audioCount` for the session counts them.
  - `files/.uploads/` is empty after every request.
  - Simulated client disconnect half-way (an ASGI test client streaming generator that raises): no row, no file in `audios/`, no `.part` left.
- [X] T015 [US1] Implement `import_audio(db, storage, user, key, staged_path, original_file_name, client_duration_ms)` in `backend/src/unihelper/services/recording_service.py`:
  - Get the mime from `audio_probe.FORMATS` by the lower-case extension.
  - `probe()`; if `None` → `discard_upload` and raise `ApiError(422, "unreadable_audio", …)`.
  - Resolve the session and get or create its folder.
  - Name: `normalize_display(stem)[:120]` or `"Imported audio"`, made unique with " (n)" against `name_key`s in the folder (generalize `_default_name`'s loop into `_unique_name(base, taken)`).
  - File name: `unique_sibling(safe_name(name) + ext, db file names)`, looping while `storage.read_bytes`/`absolute_path(...).exists()` reports an on-disk file, as `create_note` does.
  - `on_rollback(db, storage.commit_upload(staged, parts))`.
  - Insert `Recording(origin="imported", original_file_name=…, status="complete", started_at=_now() iso ms, duration_ms=probe or client or 0, size=stat size, next_seq=0)`.
  - Hold `session_import_lock(user.id, key)` (new, module-level `dict[str, threading.Lock]` like `note_file_lock`) from resolving the session and getting or creating its folder through `db.flush(); db.commit()`, so concurrent imports into one session never both create the session folder or compute the same name. (Widened from a per-folder lock during implementation: the first two uploads into a new session raced on creating the folder row.)
  - Also replace the fixed `EXT[r.mime_type]` in `rename_recording` with the row's own extension (`Path(r.file_name).suffix.lower()`).
- [X] T016 [US1] Add the async route `POST /sessions/{session_key}/recordings/import` in `backend/src/unihelper/api/v1/recordings.py` (research I5):
  - Query `fileName` (1–255) and optional `durationMs` (≥ 0).
  - Before reading the body: check the extension is in `ACCEPTED_EXTENSIONS`, else 415 `unsupported_type` with `accepted`; require `Content-Length` (411 `length_required`); `> 1_073_741_824` → 413 `file_too_large` with `maxBytes`; `storage.free_bytes() < length + 64 MiB` → 507 `insufficient_storage`; resolve the session (404) in a thread.
  - Stream: `open_upload()`, then `async for chunk in request.stream()`, writing through `anyio.to_thread.run_sync` in ≤ 1 MiB writes and counting bytes. Count > 1 073 741 824 → stop reading, 413 `file_too_large`. Stream ends with count ≠ `Content-Length` → 422 `incomplete_upload`.
  - On `ClientDisconnect`, any exception, or `OSError` ENOSPC (→ 507), call `discard_upload` and re-raise.
  - Then call `import_audio` in a thread with the request's DB session. Return 201 `Recording`.
  - Add a `ClientDisconnect` handler so the response is not logged as a server error.
- [X] T017 [P] [US1] Unit tests `frontend/tests/unit/import-queue.test.ts` with a fake `XMLHttpRequest`:
  - Enqueuing 3 files starts 2 and queues 1.
  - `upload.onprogress` updates `loaded/total`; renders are throttled to ≤ 4/s.
  - Cancel on `uploading` calls `abort()`, sets `cancelled` and removes the entry; cancel on `queued` never opens a request.
  - 201 → `done` with `recordingId`, invalidates `["recordings", sessionKey]` and `["timeline"]`.
  - A network error → `failed` with Retry, which requeues; 4xx problem → `failed` with `error.code` equal to the server's `code` (message text is tested in T026/T028).
  - Entries keep their `sessionKey` across navigation (the store is module-level).
- [X] T018 [US1] Implement `importAudio(sessionKey, file, durationMs, onProgress, signal)` in `frontend/src/features/recordings/api.ts`, using `XMLHttpRequest`:
  - `POST ${API_BASE}/sessions/${enc(key)}/recordings/import?fileName=…&durationMs=…`, body = the `File`, headers `Content-Type: application/octet-stream` and `X-CSRF-Token` as in `putChunk`, `withCredentials`.
  - Reject with `ApiError` built from the problem JSON.
  - The `AbortSignal` calls `xhr.abort()`.
- [X] T019 [US1] Implement `frontend/src/features/imports/importQueue.ts`: an `ImportQueue` singleton outside React, like `recorder()`.
  - Entries per data-model.md "Upload": `id, sessionKey, courseId, sessionLabel, file, durationMs, state, loaded, total, error, recordingId`.
  - States `checking → queued → uploading → verifying → done | cancelled | failed | rejected`, concurrency 2, `cancel(id)`, `retry(id)`, `dismiss(id)`.
  - `useImportQueue(sessionKey)` returns that session's entries; `hasActiveUploads()`.
- [X] T020 [US1] Implement `frontend/src/features/imports/audioFiles.ts` `probeDuration(file): Promise<number | undefined>`: a detached `<audio preload="metadata">` with an object URL, `loadedmetadata` with a finite duration → ms, 5 s timeout or `error` → `undefined` (never a rejection, research I4). Always revoke the URL.
- [X] T021 [US1] Build `UploadAudioButton.tsx`, `AudioDropZone.tsx` and `UploadList.tsx` in `frontend/src/features/imports/` per `contracts/ui-import.md`, then wire them into `frontend/src/features/recordings/RecordingPanel.tsx`.
  - `UploadAudioButton.tsx`: an outline `Button` "Upload audio" beside Record, always enabled, with a hidden `<input type="file" multiple accept=".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.webm,.flac">`.
  - `AudioDropZone.tsx`: wraps the panel; on `dragenter` with `Files`, shows an overlay ("Drop audio files to upload", dashed `border-primary`); ignores folders via `webkitGetAsEntry()` with the folder message.
  - `UploadList.tsx`: rows with name, size, `Progress` (`aria-label="Uploading <name>"`) + percentage, Cancel icon button named "Cancel upload of <name>", "Waiting…"/"Checking…" states, and error text + Retry + Dismiss.
  - A polite live region announces start, every 25 %, done and cancelled.
- [X] T022 [US1] Show origin in the list in `RecordingPanel.tsx`:
  - For `origin === "imported"`: `Badge variant="outline"` "Imported", the date line reads `Imported <d MMM yyyy · HH:mm>`, and the name has a `title`/tooltip "Imported from <originalFileName>".
  - Recorded items' date line reads `Recorded …`.
- [X] T023 [US1] Add a leave guard in `frontend/src/features/imports/routes.tsx`, following the pattern in `features/recordings/routes.tsx`:
  - A `beforeunload` handler is active while `hasActiveUploads()`.
  - `registerSignOutGuard` warns "Uploads in progress will be cancelled."
  - Sign-out confirmed → cancel all.
- [X] T024 [US1] Show a toast when uploads settle in `frontend/src/features/imports/UploadList.tsx`. One file: "Uploaded “<name>”". Several files in one pick/drop batch: "Uploaded 4 of 6 files" with a Details action opening `ImportSummaryDialog.tsx` (shared with US4/US5; create it here with per-file rows `{ fileName, outcome, detail }`).

**Checkpoint**: MVP — users can bring outside recordings into a session and play them.

---

## Phase 4: User Story 2 — Clear rejection of unusable audio files (P1)

**Goal**: unsupported or oversized files are refused before upload; unreadable files are refused after upload with nothing kept.

**Independent Test**: pick a supported file, an unsupported type and an oversized file together. The bad two are rejected instantly with specific messages and no request is sent; the good one uploads.

- [X] T025 [P] [US2] Add the error cases to `backend/tests/contract/test_recording_import.py`. Every case leaves no row, no file in `audios/` and no `.part`.
  - 415 `unsupported_type` for `.pdf`/`.mp4`/no extension, with `accepted` listing the extensions.
  - 411 without `Content-Length`.
  - 413 `file_too_large` with `maxBytes=1073741824` when `Content-Length` is over the limit (no body read).
  - 413 `file_too_large` when the streamed body passes 1 GB even though `Content-Length` claimed less.
  - 422 `incomplete_upload` when the body ends shorter than `Content-Length`.
  - 422 `unreadable_audio` for `renamed_pdf()` as `.mp3` and for WAV bytes named `.flac`.
  - 507 `insufficient_storage` with `free_bytes` monkeypatched low.
- [X] T026 [P] [US2] Unit tests `frontend/tests/unit/audio-files.test.ts` for `checkAudioFile(file)`:
  - `.MP3` upper-case is accepted.
  - `.pdf`/`.mp4`/`.docx` → `{ code: "unsupported_type" }` with the ui-import.md message listing "MP3, M4A, AAC, WAV, OGG, Opus, WebM or FLAC".
  - A size of `1_073_741_825` → `file_too_large` with the human size ("1.4 GB") and the 1 GB limit.
  - A rejected file never reaches `importAudio` (spy).
- [X] T027 [US2] Implement `checkAudioFile` in `frontend/src/features/imports/audioFiles.ts`, using the same extension list as `audio_probe.ACCEPTED_EXTENSIONS` (export one `AUDIO_EXTENSIONS` constant reused by the `accept` attribute). Call it in `ImportQueue.enqueue` (`checking` → `rejected` with no request, shown within the same tick) before `probeDuration`.
- [X] T028 [US2] Map server problems to the ui-import.md messages in `frontend/src/features/imports/importQueue.ts`:
  - `unreadable_audio` → "<name> couldn't be read as audio."
  - `insufficient_storage` → "There isn't enough space on the server for <name>."
  - `file_too_large`/`unsupported_type` → same text as the client check.
  - network → "Upload of <name> failed — check your connection."
  - Only network/5xx get Retry; 4xx rejections get Dismiss only.

**Checkpoint**: bad files never cost a long upload and never leave anything behind.

---

## Phase 5: User Story 3 — Manage and transcribe imported audio (P2)

**Goal**: rename, delete and transcribe imported items exactly like recordings.

**Independent Test**: rename, transcribe and delete an imported item. The file is renamed, the transcript is appended to the chosen note, and the file is removed after confirmation.

- [X] T029 [P] [US3] Contract tests in `backend/tests/contract/test_recordings_manage.py` for imported rows:
  - Rename an imported `.mp3` → the file is renamed with `.mp3` kept (not `.webm`).
  - Delete it → the `.mp3` file is removed (allowed by `delete_content_file`).
  - Chunk `PUT` to an imported row → 409 `recording_finished`.
  - Deleting while a transcription job is active → 409 `recording_transcribing`.
- [X] T030 [P] [US3] Integration test `backend/tests/integration/test_import_flow.py::test_import_transcribe_append` (extends critical flow 2), using the fake transcriber:
  - Import a WAV, `POST` transcription into an existing note with content.
  - The transcript is appended after the last character and the existing content is byte-identical before it.
  - `AudioPart` has `filename` ending `.wav` and mime `audio/wav`.
  - With a provider spec `max_upload_bytes` smaller than the file → the job fails with `file_rejected` "too long for …" and the note is unchanged.
- [X] T031 [US3] In `prepare()` in `backend/src/unihelper/services/transcription_service.py` (research I8), for `rec.mime_type != "audio/webm"`: `stat` the file via `storage.absolute_path(parts)`. If size > `limit`, raise the existing "too long" `ProviderError` before reading. Only then call `read_bytes`. WebM (recorded or imported) keeps the current split path.
- [X] T032 [US3] In `frontend/src/features/recordings/Player.tsx`, on `MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED` for `origin === "imported"`, show "This browser can't play <FORMAT> files. Try another browser, or transcribe it." (FORMAT from the file extension, upper-case). Keep the existing messages otherwise. Extend `frontend/tests/unit/player.test.tsx` for this case.

**Checkpoint**: imported audio is a first-class session recording.

---

## Phase 6: User Story 4 — Import existing notes (P2)

**Goal**: pick `.md`/`.txt` files; each becomes a new note named after the file, with identical content.

**Independent Test**: import one `.md` and one `.txt` with unused names. Two notes appear, named after the files, with content identical to the files.

- [X] T033 [P] [US4] Contract test in `backend/tests/contract/test_notes.py`: `POST /sessions/{key}/notes` with `content` containing `\u0000` → 422 `content_not_text` and nothing created (no row, no file). CRLF content and a 5 MB-character body round-trip byte-identical on disk.
- [X] T034 [P] [US4] Unit tests `frontend/tests/unit/note-files.test.ts` for `readNoteFile(file)`:
  - `.md`, `.MD`, `.txt` accepted; `.docx`/`.pdf` → "isn't a .md or .txt file".
  - Size `> 5 * 1024 * 1024` → "larger than 5 MB".
  - Invalid UTF-8 (UTF-16LE bytes) → "isn't readable text (save it as UTF-8 and try again)".
  - A NUL byte → same message.
  - A UTF-8 BOM is stripped; CRLF is preserved.
  - Name = file name without its last extension (`"Lecture 3.md"` → `"Lecture 3"`, `".md"` → `"Imported note"`).
  - An empty file → `""` content, accepted.
  - A name longer than 120 characters is shortened to 120 (after `normalize_display`-style whitespace collapsing and trimming), so `create_note` never answers `name_too_long`.
- [X] T035 [US4] Server check in `create_note` (`backend/src/unihelper/services/note_service.py`): if `"\x00" in content` → `validation_error("/content", "content_not_text", "This text contains characters that aren't allowed in a note.")` with status 422, before any file is written.
- [X] T036 [US4] Implement `frontend/src/features/imports/noteFiles.ts` (`readNoteFile` using `TextDecoder("utf-8", { fatal: true })`) and `noteImport.ts`: `runNoteImport(sessionKey, files, ui)`.
  - Process files sequentially: read/validate (name already shortened to ≤ 120) → `createNote(sessionKey, { name, content })` from `frontend/src/features/sessions/api.ts` → `imported`. A 422 `name_too_long` is treated as a bug (an assertion in tests), not shown to the user.
  - A file whose name is empty after removing the extension gets the first free name among "Imported note", "Imported note (2)", … (checked against the loaded note list and earlier files in this run). It never gets a conflict prompt; a 409 `name_taken` on it (a race) moves to the next number.
  - On `ApiError` 409 `name_taken` → `ui.resolveConflict(...)`, a stub returning `skip` until US5.
  - Other errors → `rejected(reason)`.
  - Returns per-file results.
  - Invalidate the session's notes query after each created note.
- [X] T037 [US4] Add an "Import note" outline `Button` beside "New note" in `frontend/src/features/sessions/NoteList.tsx` (new prop `onImport`), via `ImportNoteButton.tsx` in `frontend/src/features/imports/`.
  - Hidden `<input type="file" multiple accept=".md,.txt,text/markdown,text/plain">`.
  - Wire the `Alt+Shift+N` shortcut in `frontend/src/features/sessions/useWorkspaceKeyboard.ts` and show it in the WorkspacePage empty state next to Alt+N.
  - A single imported note opens in a tab; several are only added to the list.
  - Results: one-file toast, several → toast "Imported 4 of 6 notes" + Details (`ImportSummaryDialog.tsx`).

**Checkpoint**: notes from other editors can be brought in without touching existing notes.

---

## Phase 7: User Story 5 — Resolve note name conflicts (P2)

**Goal**: on a name clash the user chooses Rename, Replace or Skip. An existing note changes only after a confirmed Replace, and Replace is refused when it could lose work.

**Independent Test**: import a file whose name matches an existing note and try Rename, Replace (cancel, then confirm) and Skip. The existing note changes only after the confirmed Replace.

- [X] T038 [P] [US5] Contract tests `backend/tests/contract/test_note_import_replace.py` for `PUT /notes/{id}/import-replace`:
  - 200 → the `Note` with new `content`, `hash`, `version` +1, same `name`/`fileName`, and the file on disk equals the content.
  - 412 `version_conflict` with a stale `If-Match` → the file is unchanged.
  - 409 `note_transcribing` when a `TranscriptionJob` with `note_id` = this note is in an `ACTIVE_STATUSES` status → unchanged.
  - 409 `file_changed_on_disk` when the file was edited outside the app → unchanged.
  - The file is missing → recreated with the imported content.
  - 422 `content_not_text` for NUL.
  - 404 foreign note.
  - Integration in `backend/tests/integration/test_import_flow.py::test_replace_vs_append`: a replace and a transcript append racing on one note serialize under `note_file_lock`, and the final file is either replace+transcript or the 409, never a lost transcript.
- [X] T039 [US5] Implement `import_replace(db, storage, user, note_id, version, content)` in `backend/src/unihelper/services/note_service.py` (research I11):
  - The NUL check comes first.
  - Then, `with note_file_lock(note_id)`: load note + path; check version (412 `version_conflict`).
  - Active job check: `select TranscriptionJob.id where note_id == note.id and status in ACTIVE_STATUSES` → 409 `note_transcribing` "A transcription is being added to this note."
  - Disk hash ≠ `content_hash` (file exists) → 409 `file_changed_on_disk` with `current`.
  - `write_text_atomic`; update `content_hash`, `size`, `updated_at`; `db.flush(); db.commit()` inside the lock.
  - Return the full `Note` dict.
  - Log at INFO "note replaced by import" with the note id (never the content).
  - Add the route `PUT /notes/{note_id}/import-replace` in `backend/src/unihelper/api/v1/notes.py`: `IfMatch` version, body schema `NoteImportReplace { content: str = Field(max_length=MAX_CONTENT) }` in `backend/src/unihelper/schemas/notes.py`, response `Note`.
- [X] T040 [P] [US5] Unit tests `frontend/tests/unit/note-import.test.tsx` for `runNoteImport` with a fake API and fake UI:
  - Rename → create with the new name; a second 409 prompts again.
  - Skip and close → `skipped`, no write.
  - Replace when `getSaver(id)?.status` is `dirty|saving|error|conflict` → refused with the unsaved-changes message and no request.
  - Replace confirmed → `importReplaceNote` called with the note's current version, then `adoptServerReplace` on an open saver.
  - Replace cancelled at confirmation → back to the prompt.
  - 409 `note_transcribing`/412 → `rejected` with the ui-import.md text, the note untouched.
  - `a.md` + `A.txt` in one run → the second conflicts with the first.
  - Apply-to-all Rename uses suggested names without prompting; apply-to-all Replace asks for one confirmation listing all names.
  - Suggested rename = first free `"Name (n)"` against the loaded note list.
  - `.md` and `.txt` (empty names) in one run, with an existing "Imported note" → created as "Imported note (2)" and "Imported note (3)" without prompting.
- [X] T041 [US5] Add `importReplaceNote(noteId, version, content)` in `frontend/src/features/sessions/api.ts`, and `NoteSaver.adoptServerReplace({ content, hash, version })` in `frontend/src/features/sessions/autosave.ts`:
  - Allowed only when `status === "saved"`; returns `false` otherwise.
  - Sets version/hash/content/savedContent, clears the draft, and notifies a new `onServerReplace(listener)` channel modeled on `onServerAppend`.
  - Make the editor (`frontend/src/features/sessions/editor/`) subscribe and replace its document without a conflict dialog.
  - Extend `frontend/tests/unit/autosave.test.ts`.
- [X] T042 [US5] Build `NoteConflictDialog.tsx` and `ReplaceConfirmDialog.tsx` in `frontend/src/features/imports/` per `contracts/ui-import.md` (AlertDialog, focus starts on the rename `Input`, live validation for empty/taken names, Skip = Escape/close, the "Apply to all N remaining conflicts" `Checkbox` only when ≥ 2 remain, destructive Replace… → second dialog listing every note to be replaced, Cancel returns). Implement `ui.resolveConflict` in `noteImport.ts` with them, replacing the US4 stub. Record `renamed`/`replaced`/`skipped` outcomes in `ImportSummaryDialog.tsx`.

**Checkpoint**: every conflict path is the user's choice; nothing is merged or overwritten silently.

---

## Phase 8: Polish & Cross-Cutting

- [X] T043 [P] Playwright `frontend/tests/e2e/import.spec.ts` (generated fixtures written to a temp dir; follow `notes-helpers.ts`/`helpers.ts`):
  - Upload WAV via the picker: progress → listed "Imported", plays, seeks.
  - Drag-and-drop 2 files (`DataTransfer` in `page.evaluate`).
  - Cancel a throttled upload (`page.route` slows the request) → nothing listed.
  - `.pdf` + an oversized fake `File` → instant messages, no request (`page.on("request")`).
  - Note import `.md` + `.txt`.
  - Conflict: Rename, Skip, Replace→Cancel, Replace→Replace with the open tab showing the new content.
  - Reload during an upload shows the `beforeunload` dialog.
- [X] T044 [P] Accessibility: extend `frontend/tests/e2e/a11y-themes.spec.ts` with the audio panel showing upload rows and an Imported item, and with the conflict and replace dialogs open. Run axe in light, dark and one custom theme; check keyboard-only completion of upload (picker via Enter), cancel and every conflict choice (SC-008, FR-026).
- [X] T045 [P] Docs: in `README.md`, add a short "Importing audio and notes" section (formats, limits, where files go, `.uploads/` staging folder). In `specs/003-session-audio-recording/spec.md` Assumptions, change "Uploading existing audio files from the user's device is out of scope." to "…was out of scope for 003; added by 006."
- [X] T046 Run the full quality gate: `cd backend && uv run ruff check . && uv run mypy && uv run pytest` (`test_coverage.py` must now pass with the 2 new operations), `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. Then walk the manual scenarios in `specs/006-session-file-import/quickstart.md` (1–25), including #25 on a copy of a real pre-006 `app.db`.

---

## Dependencies & Execution Order

```text
Setup (T001–T002)
   └─ Foundational (T003–T012)
        ├─ US1 (T013–T024)  ──┬─ US2 (T025–T028)   needs T016/T019 (route + queue)
        │                     └─ US3 (T029–T032)   needs T015 (import_audio)
        └─ US4 (T033–T037)  ──── US5 (T038–T042)   needs T036 (runNoteImport)
Polish (T043–T046) after all stories
```

- US4 needs only T011/T012 from Foundational (it never touches recordings), so it can start in parallel with US1.
- Within a story, tests come first and must fail before implementation.
- Same-file tasks are sequential: `recording_service.py` (T011 → T015), `RecordingPanel.tsx` (T021 → T022), `importQueue.ts` (T019 → T027 → T028), `note_service.py` (T035 → T039).

## Parallel Examples

- **Foundational**: T005, T006, T007, T009 and T012 in parallel after T003/T004 (T006 and T007 are independent of the migration).
- **US1**: T013, T014 and T017 (tests) together; then T015 and T018–T020 in parallel (backend vs frontend files).
- **US2**: T025 and T026 together, then T027 and T028.
- **US4 ∥ US1**: one developer on T033–T037 while another does T013–T024.
- **US5**: T038 and T040 together; T039 (backend) in parallel with T041–T042 (frontend).

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1. Students can upload outside recordings, see them as Imported and play them. Validate quickstart #1–#6.
2. **+US2**: add the safety net for bad files (quickstart #7–#8). Ship the audio half.
3. **+US3**: the Transcribe and rename/delete guarantees (#12–#13).
4. **+US4 → US5**: the notes half. Do not release US4 without US5: until T042, conflicts are always skipped (safe, but the user isn't asked).
5. Polish: e2e, accessibility, docs, full gate.
