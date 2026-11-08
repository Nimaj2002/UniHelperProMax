# Data Model: Frontend-Only Demo Mode

No database or file changes. All demo data lives in one in-memory object per browser tab.
Core collections live in `src/demo/store.ts`; each feature group keeps its own state in its
handler module and plugs in through `registerSlice` (seed, cascade, counts, trash snapshot).
Field shapes are the API's response schemas (`Schemas[...]` in `frontend/src/lib/api/schema.d.ts`);
this document lists what the store holds and the rules the handlers enforce.

## DemoStore

The single in-memory state. Created by `createSeed(now, timeZone)` when the page loads; never
persisted.

| Collection | Schema type(s) | Notes |
|------------|----------------|-------|
| `me` | `Me` | `demo-student`, role `member`, browser time zone |
| `preferences` | preferences schema | tour not yet seen, so Yuii starts (Feature 023) |
| `years`, `semesters`, `courses` | year/semester/course schemas | 1 year, 1 current semester, 3–4 courses |
| `sessions` | session schema | expanded from each course's weekly pattern + 1–2 events |
| `notes` | note meta + body (string) | body is Markdown; `version` per note |
| `documents` | document schema + annotation ops | one PDF (bundled asset) on one session |
| `recordings` | recording schema | one recording (bundled clip) with duration |
| `transcriptions` | transcription job schema | one completed job + any the visitor starts |
| `chats`, `chatRuns` | chat/turn/answer schemas, run state | one existing chat; runs created per message |
| `teacherChats`, `knowledgeGraph` | teacher schemas | one finished session with a few ideas |
| `taskColumns`, `tasks`, `quickNotes` | task schemas | 3 columns, ~8 tasks |
| `timeEntries`, `timeTags`, `timer` | time schemas | a week of entries, 3 tags, timer idle |
| `themes` | theme schema | built-ins only |
| `trash` | trash entry schema | empty at start; class/event series only |
| `nextId` | number | id counter for new items (`demo-<n>`) |

## Rules enforced by handlers

- **Versions**: every mutable item carries `version`; each change increments it. A request whose
  `If-Match` differs returns the real API's `412 version_conflict` problem.
- **Append-only**: transcription completion and chat "append to note" only ever add text at the
  end of the note body (Principle I).
- **Deletes**: as in the real API, only deleted classes/events (whole series) go to the Trash and
  can be restored with everything attached; tasks and time entries use their own soft-delete +
  restore; other deletes are immediate.
- **Referential cleanup**: deleting a course/semester/year removes its sessions and their notes,
  documents, recordings and chats; `deletion-impact` reports the counts first.
- **Validation**: required fields and simple limits (empty titles, end before start) return the
  same `422` problem shape with field pointers; other server-side rules are not re-implemented.

## State transitions

- **Transcription job**: `queued` → `running` (progress 0→100 over ~5 s) → `completed`, then the
  canned transcript is appended to the chosen note. `cancel` while running → `cancelled`, note
  untouched.
- **Chat run**: `start` → `delta`* → `done`; `stop` → `stopped` with the text so far kept.
- **Timer**: follows the real states (`idle`/`running`/`paused`) with the existing transitions.

## Sample assets (bundled, demo chunk only)

| Asset | Limit | Source |
|-------|-------|--------|
| `lecture-week3.pdf` | < 300 KB | written for the demo |
| `lecture-week3.webm` | < 600 KB, ~60 s | maintainer recording or open-licence TTS (licence in `src/demo/assets/README.md`) |
| canned texts | — | `src/demo/canned.ts`: chat replies, transcript, teacher questions |
