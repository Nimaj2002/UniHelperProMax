# Quickstart: validating AI Chat (feature 014)

These checks show the feature works end to end. Request and response shapes are in
[contracts/openapi.yaml](./contracts/openapi.yaml), events in
[contracts/chat-stream.md](./contracts/chat-stream.md), and files in
[contracts/chat-file-format.md](./contracts/chat-file-format.md).

## Prerequisites

- `backend/` with `uv sync`, and `frontend/` with `pnpm install`. The new dependencies are listed
  in research R14.
- **Fake LLM server**: `backend/tests/fake_llm.py`, a small ASGI app that speaks all three
  styles.
  - Paths: `/v1/chat/completions` and `/v1/models`; `/anthropic/v1/messages` and `/v1/models`;
    `/gemini/v1beta/models[:streamGenerateContent]`.
  - Scripted behaviours, chosen by model id: `echo`, `slow` (one token every 100 ms), `fail-401`,
    `fail-429` (`retry-after: 7`), `fail-404`, `big-usage`, and `wrong-style`.
  - It records whether the client disconnected, so Stop can be shown to cancel upstream.
  - Run it with `uv run uvicorn tests.fake_llm:app --port 8021`. Playwright starts it as a
    webServer.
- **Optional real servers**: Ollama at `http://localhost:11434/v1`, or keys for OpenAI,
  Anthropic and Gemini. No key or address ships with the app (FR-012).
- **Key store for tests**: `UNIHELPER_KEY_STORE=file` and
  `UNIHELPER_KEY_FILE=<tmp>/keys/master.key`, outside the data directory.

## Automated checks

```bash
cd backend && uv run pytest -m "unit or contract or integration"   # includes the new contract coverage for specs/014
cd backend && uv run ruff check && uv run mypy
cd frontend && pnpm gen:api && pnpm typecheck && pnpm lint && pnpm test
cd frontend && pnpm exec playwright test chat settings-ai session-panel secrets   # chromium-light + chromium-dark
```

The suite contains these integration tests (real SQLite, real files, fake LLM):

| Test | Proves |
|---|---|
| `test_chat_send_stream_save.py` | Sending in each style streams deltas and saves the JSON and `.md` files. Usage is recorded, and no key appears in the chat files or the logs (FR-035, FR-049, SC-005) |
| `test_chat_stop_cancels_upstream.py` | Stop: no deltas after the stop response, the fake server saw the disconnect, and the answer is `stopped` with its partial text (FR-036, SC-003) |
| `test_chat_runs_survive_clients.py` | The answer completes and is saved with no subscriber. Reconnecting with `Last-Event-ID` replays (FR-007, FR-045) |
| `test_chat_recover_interrupted.py` | A server shutdown or a simulated crash in the middle of a stream ends as `interrupted` at the next start (FR-037) |
| `test_chat_session_isolation.py` | Chats appear only in their own session. Another user gets 404. A moved event keeps its chats. Trash, restore and purge (FR-048, FR-051, SC-004) |
| `test_secrets_migration.py` | Plaintext transcription keys are migrated, and transcription still works. A forced failure rolls back with the plaintext intact (FR-067, SC-006) |
| `test_secrets_at_rest.py` | Copying the database and the data folder reveals no key. A lost master key gives `readable=false`, and reset keeps the other data (FR-064, FR-068) |
| `test_chat_attachments.py` | Note snapshots are taken on every send. A PDF is sent as a document or as text, and a scanned PDF is reported as having no text. WebM audio is remuxed to Ogg for Gemini and refused for OpenAI. The 10-attachment and size limits refuse with clear messages (FR-047, FR-053–055) |
| `test_transcribe_append_flow.py` (existing) | Unchanged, and still green (Principle VI) |

## Manual walkthrough (about 10 minutes)

1. **Empty state**. Open a session. The right panel shows Recordings above Chat. Chat says
   there is no AI endpoint, offers **Open AI settings**, and the message box is disabled
   (FR-022).
2. **Add a local endpoint**. In Settings → AI, add `Fake local` with the OpenAI-compatible
   style, base URL `http://localhost:8021/v1/chat/completions/`.
   - The URL becomes `http://localhost:8021/v1`, with the note "Removed /chat/completions" and
     the label Local.
   - **Test connection** reports Working.
   - **Refresh** lists `echo` and `slow`. Save.
3. **Https rule**. Add `Fake remote` with the Anthropic style and `http://example.com`. Save is
   refused because https is required, and the field explains why (FR-016). The unit tests in
   `test_ai_addresses.py` and the e2e spec `settings-ai` cover the https path.
4. **Stream and Stop**. Back in the session, type "Hello" and press Enter.
   - The chat switches to the Conversation view and the answer streams.
   - Send `slow` text, then press **Escape**. Text stops at once, the answer is marked
     "Stopped", and focus is in the box (FR-036).
5. **History, rename, delete and Undo**. Press **Back to history**. The chat is listed with its
   age. Rename it. Delete it, then press Undo (FR-025, FR-026).
6. **Rail**. Start a `slow` answer, then close the panel with Alt+].
   - The rail shows a Chat spinner.
   - When the answer finishes, the rail shows the "new answer" dot. Activate Chat on the rail:
     the panel opens with Chat expanded (FR-005, FR-006).
7. **Expand and Dock**. In the middle of a `slow` answer, press **Expand**.
   - The panel closes, and the chat continues in a tab. Split it beside a note.
   - Press **Dock**: the chat is back in the panel and the answer never stopped (FR-042–045).
8. **Notes**. Attach the open note, ask a question, then edit the note and ask again. Each
   message's snapshot in the chat JSON differs (clarification Q2).
9. **Restart**. Stop the backend in the middle of an answer and start it again. The answer reads
   "Interrupted", and the drafts are still there (FR-032, FR-037).
10. **Files on disk**. Open `<data>/files/<user>/…/<session>/chats/`. There is a readable `.md`
    transcript and a JSON file, with no keys in either (FR-049).
11. **Accessibility**. Using only the keyboard, run the chat flow with Alt+K, the model picker,
    the attach menu, Stop and Dock. axe reports no violations in the light, dark and custom
    themes (SC-008).
