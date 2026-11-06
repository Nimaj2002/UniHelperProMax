# Contract: Teacher Run Events

Teacher runs use 014's `GET /api/v1/chat-runs/{runId}/events` stream unchanged (framing, ids,
replay, keepalive, Stop, terminal events — see `specs/014-session-ai-chat/contracts/chat-stream.md`).
For teacher runs the server adds these events. The AI chat UI listens only for its own event
names, so it ignores them.

| event | data | Meaning |
|---|---|---|
| `delta` | `{text}` | Prose only. Text inside `uh-*` blocks is never sent as `delta` (research R3). |
| `question` | `Question` without `key`/`explanation` (see `openapi.yaml`) | A complete, valid question block. The UI adds a question segment at the current end of the reply, a card to the Current question column and an entry to the Questions column (FR-019). |
| `malformed` | `{id, reason}` | A block that could not be read; the UI shows "This question could not be displayed" with Retry (FR-025). |
| `grade` | `{questionId, grade, feedback, by: "teacher", at}` | A grade block was applied; the Questions column status updates (FR-022). |
| `plan` | `Plan` | A new plan version (FR-027). |
| `hint` | `{questionId, text, createdAt}` | A hint was recorded (FR-040). |

## Ordering and saving

- Structured events are emitted in the order their blocks close, interleaved with `delta`s in
  text order, so a client that appends segments in event order rebuilds exactly the segments the
  read endpoint returns.
- Questions, grades, plans and hints are written to the chat file **before** their event is
  emitted (at the next checkpoint at the latest), so a reload after any event shows it.
- `snapshot` (after the replay buffer expired) carries `{segments, status}` instead of `{text}`
  for teacher runs; the client then refetches `GET /teacher-chats/{id}` for questions and plans.
- On `stopped`, `interrupted` or `failed`, questions already emitted stay answerable; an open
  `uh-*` block becomes a `malformed` segment (`unterminated`).
