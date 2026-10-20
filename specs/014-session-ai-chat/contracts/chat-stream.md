# Contract: Chat Run Event Stream

`GET /api/v1/chat-runs/{runId}/events` sends `text/event-stream`. It uses the same cookie session
as the rest of the API, and needs no CSRF token because it is a GET. The browser reads it with
native `EventSource`. Background: research R1 and R2.

## Framing

- Every event has an `id:` set to a sequence number that starts at 1 and goes up by one per run.
- The `event:` names are listed below. Each `data:` holds one JSON object in camelCase.
- When the client reconnects with `Last-Event-ID: n`, the server replays every event with an id
  greater than n. The server buffers each run's events in memory until the run ends, plus
  60 seconds after that. After that window, replay is replaced by a single `snapshot` event.
- While the run is quiet, a `: keepalive` comment is sent every 15 seconds.
- The stream closes after a terminal event (`done`, `stopped`, `interrupted` or `failed`).
- Text is sent as merged deltas, flushed at most every 50 ms.

## Events

| event | data | Meaning |
|---|---|---|
| `start` | `{runId, chatId, turnId, answerId, endpointLabel, modelLabel, locality}` | The run was accepted. The UI shows the progress indicator and screen readers hear "Answer started" (FR-070) |
| `delta` | `{text}` | Text to append. Thought or reasoning parts from Gemini or Anthropic are never sent |
| `usage` | `{input?, output?, total?}` | Token usage, when the provider reports it (FR-061). It may come more than once; the last value wins |
| `snapshot` | `{text, status}` | Sent instead of replay when the buffer has expired. It replaces the answer text |
| `done` | `{status:"completed", usage?, endedAt}` | The answer is complete and saved. Screen readers hear "Answer complete" |
| `stopped` | `{status:"stopped", endedAt}` | The user stopped the answer. The partial text has been saved |
| `interrupted` | `{status:"interrupted"}` | The server shut down during the answer |
| `failed` | `{status:"failed", error:{category, message, retryAfterSeconds?}}` | A classified error (research R6). Any text that already arrived is kept |

## Guarantees

- **Saving**: the answer is checkpointed to the chat file at least every 2 seconds and written
  for good before the terminal event is sent.
- **Stop**: after `POST /chat-runs/{id}/stop` returns, no further `delta` is sent for the run.
  Stop is idempotent: stopping a run that has already ended returns its final state.
- **Several viewers**: several subscribers (for example two browser windows) receive the same
  events.
- **Leaving**: unsubscribing never affects the run.
