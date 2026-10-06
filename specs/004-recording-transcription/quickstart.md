# Quickstart & Validation: Transcribe Recordings into Notes (004)

Same setup and checks as 001–003 (`README.md`). Configure a provider in **Settings →
Transcription** (feature 005): Voice Studio needs only its address; OpenAI-compatible needs an
address, an API key and a model. For manual checks without a real provider, run the fake
transcriber and use `http://localhost:8020` as the Voice Studio address:

```bash
cd backend
uv run uvicorn tests.fake_transcriber:app --port 8020   # returns predictable text
```

Note: if UniHelperProMax runs in WSL and the provider on Windows, `localhost` differs between
them (use WSL mirrored networking or the Windows host's address).

Automated: `uv run pytest` (contract + `integration/test_transcribe_append_flow.py`),
`corepack pnpm test`, `corepack pnpm e2e` (Playwright starts the fake transcriber itself).

| # | Scenario (spec ref) | Expected |
|---|---|---|
| 1 | Transcribe a recording into a note with content (US1) | Dialog lists notes; after completion the note's original bytes are unchanged and followed by `## Transcript — <name> · <date time> · <duration>` and the text |
| 2 | Transcribe twice into the same note (US1 #4) | Two sections in completion order, each with its heading |
| 3 | Note open with unsaved typing when the transcript arrives (US1 #5–6) | Typing kept, transcript appears at the end without reload, toast shown, save status returns to "Saved" |
| 4 | Session without notes (US2) | Dialog asks for a name (pre-filled "Transcript"); note appears in the list immediately; receives only heading + text |
| 5 | Duplicate / empty new note name (US2 #4) | Refused inline with 002's messages |
| 6 | While running (US3 #1–2) | All Transcribe buttons in every session disabled with explanation; stage + progress + Cancel shown in the panel and the activity bar |
| 7 | Close the tab / sign out during a job (US3 #3, FR-015) | Job completes; on next visit a toast reports it |
| 8 | Provider returns 401 / unreachable / 429 quota / 413 (US3 #4, US4 #3) | Error with category, note unchanged, Retry; settings-related errors link to Settings |
| 9 | Retry (US3 #5) | Runs again into the same note without asking |
| 10 | Cancel (US3 #6) | Nothing appended; buttons re-enabled |
| 11 | Restart the server mid-job (US3 #7) | Job resumes (or shows failed + Retry); appended exactly once |
| 12 | No provider configured (US4 #2) | Dialog explains and links to Settings → Transcription |
| 13 | History (US5) | "Transcribed → <note>" link opens the note; transcribing again warns |
| 14 | Target note deleted mid-job (FR-011) | New note "Transcript – <recording>" receives the text; user told |
| 15 | WebM recording larger than the provider limit (FR-022) | Split into parts; one section with all parts' text in order |
| 16 | Delete a recording being transcribed (edge case) | Refused until the job finishes or is cancelled |
| 17 | Keyboard + themes (FR-024) | All of the above keyboard-only in light and dark, axe AA, no key anywhere in responses/logs |
| 18 | Timing (SC-003, manual) | With a real cloud provider (OpenAI `whisper-1`, normal broadband), a 1-hour WebM recording is transcribed and appended within 15 minutes; record the measured time in the validation record |
