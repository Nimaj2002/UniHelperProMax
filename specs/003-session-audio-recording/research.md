# Phase 0 Research: Session Audio Recording & Playback (003)

Builds on 001 (API conventions, `StorageService`, session keys) and 002 (`session_folders`,
workspace right-panel registry, `ui_preferences`, autosave/drafts patterns).

## A1. Capture format

- **Decision**: `MediaRecorder` on the default microphone (`echoCancellation`, `noiseSuppression`
  left to browser defaults). Preferred MIME `audio/webm;codecs=opus` (Chrome, Edge, Firefox);
  fallback `audio/mp4` (Safari) → stored as `.m4a`. Bitrate 48 kbps (≈ 86 MB for 4 h).
- **Rationale**: Opus/WebM is a standard, widely playable format (Constitution II) with small
  files; MediaRecorder emits it natively and progressively.
- **Alternatives**: PCM/WAV via AudioWorklet (≈ 460 MB per 4 h mono 16 kHz, heavy uploads);
  MP3 encoding in JS (extra library, CPU).

## A2. Progressive persistence (FR-007, SC-002)

- **Decision**: `MediaRecorder.start(5000)` → a chunk every 5 s. Each chunk is first written to
  **IndexedDB** (`uh-recordings` DB, store `chunks`, key `[recordingId, seq]`), then uploaded in
  order with `PUT /recordings/{id}/chunks/{seq}` (raw bytes). The server appends the bytes to the
  audio file and `fsync`s before answering; the client deletes the chunk from IndexedDB only after
  a 2xx. A crash loses at most the chunk being recorded (≤ 5 s) plus anything not yet in
  IndexedDB — well within 10 s.
- **Idempotency**: `seq == next_seq` → append; `seq < next_seq` → 200 no-op (already stored);
  `seq > next_seq` → 409 `chunk_gap` with `nextSeq` (client re-sends from there).
- **Rationale**: Bytes reach disk every 5 s while online, and are held on the device while
  offline or between crash and reopen (FR-008).
- **Alternatives**: Upload only at stop (loses everything on crash); WebSocket streaming (more
  moving parts, no gain at 5 s granularity); Service Worker background sync (not available
  everywhere, harder to test).

## A3. Recovery after a crash or closed tab (FR-009)

- **Decision**: Server row status `recording` → treated as **interrupted** when no chunk has
  arrived for 30 s and the recording was not stopped; reading it (list/get) finalizes it:
  status `interrupted`, duration computed from the file. On every app start the client's
  **recovery worker** uploads any chunks left in IndexedDB (appends are still accepted for
  `interrupted` recordings) and then calls `POST /recordings/{id}/stop` with
  `interrupted: true`, which re-finalizes. A live recording that was merely offline for > 30 s
  simply continues: its next chunk and its final stop move it back to `recording`/`complete`.
- **Rationale**: No background job needed (Constitution VII); state is derived from data.

## A4. Duration and seeking in WebM (FR-021, SC-004)

- **Decision**: MediaRecorder WebM has no duration and no cue index, so browsers report
  `Infinity` and cannot seek. On finalize the server runs a small pure-Python **EBML reader/
  writer** (`domain/webm.py`): it walks Segment → Clusters to find the last block timecode
  (duration = last cluster timecode + last block offset + one frame), then rewrites the file
  once (atomic temp + rename) with an `Info/Duration` element and a **`Cues`** element (one cue
  point per cluster) inserted after `Tracks`, adjusting nothing else (the Segment keeps its
  "unknown size"). With Duration + Cues all evergreen browsers show the length and seek
  instantly. For `.m4a` (Safari) the client-reported duration is stored; the container already
  has a duration when the recorder stops cleanly.
- **Playback** uses `GET /recordings/{id}/audio` with HTTP Range (Starlette `FileResponse`
  supports ranges), so playback starts without downloading the file.
- **Rationale**: Keeps files standard and seekable without shipping ffmpeg (Constitution VII).
- **Alternatives**: ffmpeg remux (external binary to install); client-side `ts-ebml` duration
  fix only (no cues → slow/unsupported seeking in long files).

## A5. One recording at a time, app-wide (FR-003, FR-005, FR-006, clarified A)

- **Decision**: A `RecorderController` singleton (plain TS, outside React) owns the
  `MediaStream`, `MediaRecorder`, `AnalyserNode` (input level), timer and upload queue, so
  navigating anywhere in the SPA never interrupts it. It renders through:
  - the workspace right panel (`registerWorkspacePanel`) for the session's recordings, and
  - the shell **activity bar** (`registerActivity`) — a recording bar with elapsed time, the
    owning session, Stop and "Go to session", visible on every screen while recording.
  The server refuses a second start (409 `recording_in_progress`) unless the active one is
  stale (> 30 s without chunks); other windows read `GET /recordings/active` and show
  "Recording in another window".
- **Guards (FR-010)**: `beforeunload` while recording; sign-out asks to stop first (shell
  registry `registerSignOutGuard`).

## A6. Pending audio and low device storage

- **Decision**: The panel shows "Upload pending" while IndexedDB holds chunks; before writing a
  chunk, `navigator.storage.estimate()` is checked and the user is warned when less than 50 MB
  (≈ 2 h of audio) remains.

## A7. File names, rename, delete

- **Decision**: Default name "Recording HH:MM" (local start time), unique per session (` (2)`).
  File `<safe_name(name)>.webm` (or `.m4a`) in `<session folder>/audios/`. Rename renames the
  file (compensated on rollback). Delete removes the single file after confirmation —
  `StorageService.delete_note_file` is generalised to `delete_content_file`, allowed only for
  `.md` in `notes/` and `.webm/.m4a` in `audios/`. The in-progress recording cannot be renamed or
  deleted (409 `recording_in_progress`).
- **Missing file** (moved/deleted outside the app): list shows `missing: true`; the entry can be
  deleted (metadata only).

## A8. Player (FR-017–FR-022)

- **Decision**: Custom controls over a hidden `<audio>`: Play/Pause, Stop (pause + seek 0),
  seek slider (shadcn `Slider`, keyboard arrows = ±5 s, PageUp/Down = ±60 s), Back 5 s,
  Forward 5 s (clamped), volume slider + mute; current/total time. Only one recording plays at a
  time (module-level "now playing" store). Volume and mute persist in `ui_preferences`
  (`playerVolume` 0–1, `playerMuted`). Keys while the player has focus: `Space`/`K` play/pause,
  `←`/`J` −5 s, `→`/`L` +5 s, `↑`/`↓` volume, `M` mute.

## A9. Course timeline audio count

- **Decision**: 002's timeline `audioCount` now counts recordings per session folder (an
  in-progress recording counts).
