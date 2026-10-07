# Quickstart & Validation: Import Audio and Notes into a Session (006)

Same setup and checks as 001–005 (`README.md`). Contracts: [openapi.yaml](./contracts/openapi.yaml),
[ui-import.md](./contracts/ui-import.md). Data: [data-model.md](./data-model.md).

## Automated

```bash
cd backend && uv run pytest                       # contract + integration + unit (incl. migration 0008)
cd frontend && pnpm test && pnpm e2e tests/e2e/import.spec.ts
```

Expected: all green; `test_coverage.py` confirms the two new operations are documented and
exercised.

## Sample files

Have ready: a 1–5 min MP3 from a phone, an M4A, a WAV, a FLAC, an OGG/Opus, a `.webm` saved from
another browser recording, a PDF renamed to `.mp3`, a > 1 GB file, `Lecture 3.md`, `questions.txt`,
an empty `.txt`, a UTF-16 `.txt`, a `.docx`.

## Manual scenarios

| # | Scenario (spec ref) | Expected |
|---|---|---|
| 1 | Upload one MP3 to a past session (US1 #1) | Progress shown; item appears with file's name, import date, correct duration, "Imported" badge |
| 2 | Play it (US1 #2) | Play/pause/stop, seek anywhere, ±5 s clamped, volume — same as a recording |
| 3 | Browse `…/<date>/audios/` outside the app (US1 #6, SC-006) | File present under its readable name, byte-identical to the original, plays |
| 4 | Pick all six formats at once (US1 #4) | Each has its own progress; at most 2 upload at a time; all appear |
| 5 | Drag the files onto the panel (US1 #3) | Drop overlay appears; same result as picking |
| 6 | Cancel a large upload half-way (US1 #5) | Row disappears; nothing in the list; no new file in `audios/`; `files/.uploads/` empty |
| 7 | Pick a PDF, a `.docx` and the > 1 GB file (US2 #1–2, SC-002) | All rejected instantly with name + reason; no network request (DevTools) |
| 8 | Upload the PDF renamed to `.mp3` (US2 #3) | "couldn't be read as audio"; nothing kept |
| 9 | Upload a file named like an existing recording | Imported as "Name (2)"; existing recording unchanged |
| 10 | Kill the network during an upload | Failed + Retry; Retry succeeds; no duplicates |
| 11 | Navigate to the calendar during an upload, then back | Upload continued; reload while uploading prompts first |
| 12 | Rename, Transcribe, Delete an imported item (US3) | Same as for recordings; transcript appended to the chosen note |
| 13 | Transcribe a 90-min imported MP3 with an OpenAI-compatible provider (25 MB limit) | Clear "too long for this provider" error; note unchanged |
| 14 | Import `Lecture 3.md` + `questions.txt` (US4 #1–2, SC-005) | Notes "Lecture 3" and "questions"; content identical to the files (`diff` the `.md` files) |
| 15 | Import the UTF-16 `.txt`, the `.docx` and the empty `.txt` (US4 #3) | First two rejected with reasons; empty file → empty note |
| 16 | Import `Lecture 3.md` again → Rename (US5 #2) | Suggested "Lecture 3 (2)"; new note created; original unchanged |
| 17 | Again → Replace → Cancel, then Replace → Replace (US5 #3) | Cancel returns to the prompt; confirmed Replace changes content only; open tab shows new content |
| 18 | Again → Skip, and again → Escape (US5 #4, #6) | Nothing changes |
| 19 | Import 3 conflicting files with "Apply to all" → Replace (US5 #5) | One confirmation listing all 3 notes |
| 20 | Type in "Lecture 3" and import over it immediately → Replace (edge case) | Refused: unsaved changes; note keeps the typed text |
| 21 | Start transcribing into "Lecture 3", then import-Replace it | Refused: transcription in progress; note unchanged; transcript appended normally |
| 22 | Import `a.md` and `A.txt` together | Second gets the conflict prompt |
| 23 | Upcoming session, and while a recording runs | Both imports allowed; recording continues |
| 24 | Keyboard only, light + dark + a custom theme (SC-008, FR-026) | All flows operable; axe AA clean; progress/results announced |
| 25 | Start the app on a database from before 006 that has transcription history | History still shown for every recording; existing recordings show as recorded |
