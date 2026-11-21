# Research: Media Editor (Audio Trim)

**R1 – Where trimming happens.** Decision: backend. Rationale: recordings can be hours long; browser
`decodeAudioData` would need gigabytes and re-encoding changes quality. Alternatives: browser
decode + WAV encode (memory, huge files); backend ffmpeg subprocess (not bundled, desktop packaging burden).

**R2 – How to trim.** Decision: PyAV stream copy (demux packets in [start,end], remux into the same
container). No quality loss, fast, keeps the format. Accuracy is one codec frame (~20–30 ms), inside
SC-003's 0.1 s. Alternatives: re-encode (slow, lossy); per-format byte cutters (too much code).
Risk: MediaRecorder WebM has no cues/duration until finalized; recordings are already finalized by
`webm.finalize` on stop, and PyAV reads by packet timestamps, so seek is by scan, not index.
Fallback if a format cannot be stream-copied: re-encode to the same codec; decide during implementation, covered by tests per format.

**R3 – Waveform.** Decision: `GET /recordings/{id}/peaks?buckets=N` decodes in a streaming loop and
returns N normalized min/max pairs plus duration; result cached in memory per (id, version). The browser
never decodes the file. UI: **wavesurfer.js 8.1.0 + Regions plugin via `@wavesurfer/react` 1.0.14** (web search 2026-11-16: the standard waveform library; official React wrapper from the same author, peers `react ^19`, `wavesurfer.js >=7.7.14`). It accepts precomputed `peaks` + `duration` and an external `<audio>` media element, so the backend peaks endpoint and streamed playback fit without decoding in the browser. Alternatives: older `react-wavesurfer` (v2-era), community `wavesurfer-react`, hand-built canvas. Playback uses the existing `GET /recordings/{id}/audio` in an `<audio>` element (range requests already work via FileResponse).

**R4 – Browser data.** Decision: new `GET /media/recordings` returning classes → sessions → recordings
(name, duration, ids, session label/date) in one call to avoid N+1; refreshed via TanStack Query invalidation after saves. Events/general sessions included only if they own recordings, under an "Events" group. Filter by name is client-side.

**R5 – Saving.** New: trimmed bytes staged in the storage service's staging area, then moved into the
session's `audios/` under a unique safe file name from the chosen name, row created like an import
(`origin='imported'`, original_file_name = source name) so no schema change. Overwrite: staged file
atomically replaces the original path (`replace_bytes_atomic`-style), row's size/duration/version updated in
the same request with a rollback hook; `If-Match` version required. Single in-process lock per session
(reuse `session_import_lock`). Blocked (409) while the recording is active or has an active transcription job (reuse `has_active_job_for_recording`).

**R6 – Transcript.** Kept untouched on overwrite (constitution I); the UI shows a warning when the
recording has a transcript. Lookup of "has transcript" through existing transcription listing; exposed as `hasTranscript` in the browse/trim responses to avoid extra calls.

**R7 – Entry points & right panel.** Home right panel uses `PanelRail`; the session panel uses
`useSessionRail`. Add one Media Editor item to each, navigating to `/media-editor?recording=<id>` when
coming from Edit. The editor page's own right rail is a `SideRail` with a single item. Requires a quick check of `SideRail` props during implementation.

**R8 – Unsaved changes.** Use the router's blocker plus `beforeunload`, driven by a `dirty` flag in the editor context; recording switches in the browser go through the same guard.

**R9 – Demo mode (024).** The three endpoints get MSW handlers returning fixture peaks and a fake trim; `tsc` flags drift.
