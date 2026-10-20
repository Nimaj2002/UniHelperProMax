# Implementation Plan: AI Chat in Session and Event Workspaces

**Branch**: `014-session-ai-chat` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-session-ai-chat/spec.md` (5 clarifications of
2026-10-19).

## Summary

Session and event workspaces gain a **session panel** on the right. It has two sections:
Recordings (today's audio card) and Chat. Closed, it leaves a 44 px rail with activity
indicators. The Chat section holds per-session chats with streaming answers, and any chat can
be expanded into a workspace tab and docked back. Answers come only from endpoints the student
configures under Settings → AI, in three request styles.

Technical approach:

- **The backend talks to providers.**
  - Keys never leave the backend. Every send starts a **chat run**: an asyncio task on the app's
    event loop, independent of any browser connection.
  - The browser subscribes over **server-sent events** (`GET /chat-runs/{id}/events`, native
    `EventSource`, replay from `Last-Event-ID`). Stop cancels the task, which closes the
    upstream stream.
  - Because runs don't depend on a connection, closing the panel, Expand/Dock, closing a tab,
    reloading or running several chats at once never interrupts an answer.
  - A crash or shutdown ends a run as "Interrupted" through `recover()`, the same pattern as the
    transcription worker.
- **One adapter interface, three adapters** (`unihelper/ai/`): OpenAI-compatible, Anthropic and
  Gemini, built on httpx with no SDKs. They share the error classification, limits and size
  estimate, and the UI discovers the styles through `GET /ai/styles` (Principle IV's pattern).
- **Chats are files.** Each chat is `chats/<stem>.json` (the source of truth, with versions for
  Regenerate and for edit and resend), plus a regenerated `.md` transcript and a `.files/`
  folder for uploads and note snapshots, all inside the session folder. SQLite keeps only an
  index row per chat for listing, counts and deletion impact.
- **Shared secret store.** Envelope encryption with AES-256-GCM and only symmetric keys, so
  there is no public-key step to make post-quantum.
  - The master key is in the OS key store through `keyring`. When there is none, it is in a
    user-only key file outside the data folder (clarification Q1). Docker gets a separate
    `/keys` volume.
  - Transcription keys are migrated at startup in one transaction that can be rolled back.
- **Frontend**:
  - A `features/chat/` module with a singleton run store that panel and tab views both read.
  - `react-markdown` with `remark-gfm` for answers, with raw HTML off and remote images
    blocked.
  - A generalised right `SideRail`. `CollapsibleSection` and the weighted boundary are reused
    from the left card.
  - A new `chat` tab kind, and a Settings → AI section modelled on the transcription settings
    (masked keys, Undo until Save, Test connection).

## Technical Context

**Language/Version**: Python 3.12+ (backend: FastAPI, SQLAlchemy 2, Alembic) and TypeScript 5.9
with React 19.3 (frontend: Vite 8, TanStack Query 5, react-router 8, shadcn/ui on Radix).

**Primary Dependencies**:
- **New backend**: `cryptography` ≥ 50.0.2 < 51, `keyring` ≥ 25.7 < 26, `platformdirs` ≥ 4.13.5
  < 5, `pypdf` ≥ 6 < 7.
- **New frontend**, pinned exactly: `react-markdown@10.1.0`, `remark-gfm@4.0.1`.
- **Existing, reused**:
  - httpx (async, with `transport` injection for tests)
  - `StorageService`, `naming.safe_name`/`unique_sibling`, `note_service.append_to_note`,
    `domain/webm.py`, `domain/pdf_probe.py`, `domain/addresses.py`
  - sonner, cmdk `CommandDialog`, `PanelResizeHandle`, `CollapsibleSection`, the activity-signal
    registry, `useSyncExternalStore` stores
- Research R14 justifies each new dependency.

**Storage**:
- **SQLite**, migration `0013_ai_chat`, with these tables: `secret_store_meta`, `secrets`,
  `ai_endpoints`, `ai_models`, `ai_settings`, `chats` (index), `chat_runs`, `chat_drafts`,
  `chat_uploads`, plus `transcription_provider_configs.secret_id`.
- **Files**: `<session folder>/chats/` (see contracts/chat-file-format.md).
- **Browser localStorage**: `uh.sessionPanel`, `uh.chat.panel.<sessionKey>`,
  `uh.chat.scroll.<chatId>`.
- **Master key**: the OS key store, or the key file at `platformdirs.user_config_dir` /
  `UNIHELPER_KEY_FILE`, never under `UNIHELPER_DATA_DIR`.

**Testing**:
- **pytest**:
  - unit tests: URL normaliser and locality, the three SSE parsers and adapters (with recorded
    fixtures), error classifier, estimate, limits, Ogg remux, the PDF text check, envelope
    crypto, the chat file round trip and transcript
  - contract tests for every new operation against `specs/014-*/contracts/openapi.yaml` (the
    existing coverage gate enforces this)
  - integration tests listed in quickstart.md, using the new `tests/fake_llm.py` ASGI server
    through `httpx.ASGITransport`
- **Vitest**: run store, chat placement reducer, streaming Markdown block splitter, message box
  keys (IME), layout widths, shortcut-conflict table, settings form, rail indicators.
- **Playwright** on chromium-light and chromium-dark plus a custom theme, with the fake LLM as a
  webServer:
  - session panel and rail
  - chat streaming and Stop
  - history
  - Expand/Dock
  - settings → AI
  - attachments
  - 1,000-message performance
  - axe

**Target Platform**:
- The local single-process server: `start.sh`/`start.ps1` on Windows, macOS, Linux or WSL, and
  Docker.
- Evergreen desktop browsers.
- Local endpoints work offline (FR-074).

**Project Type**: Web application (the existing `backend/` and `frontend/`).

**Performance Goals**:
- Server to screen, the first text appears ≤ 1 s after the provider sends it, through 50 ms
  delta merging and rendering once per animation frame (SC-002).
- Stop takes effect within 0.5 s (SC-003).
- A 1,000-message chat scrolls without visible lag and typing stays under 50 ms per keystroke
  (SC-007).
- Two concurrent streams don't add measurable latency to note typing or recording chunk uploads
  (SC-007).

**Constraints**:
- Keys never reach the frontend, logs, errors or files (FR-019, FR-066).
- Remote addresses require https (FR-016).
- Nothing is truncated or dropped without saying so (FR-055).
- Existing recording, transcription and tab behaviour is unchanged (FR-075, SC-010).
- One server process (`single_process.py`), so in-process locks and the run registry are
  valid.
- The CSP stays `connect-src 'self'`.

**Scale/Scope**:
- One user to a handful of accounts.
- Up to about 100 chats per session and 1,000 messages per chat.
- At most 4 concurrent runs per user and 8 in total.
- 10 attachments per message, with uploads of 25 MB or less.

**Unknowns**: none remain. Every NEEDS CLARIFICATION was resolved in research.md (R1–R16).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|---|---|---|
| I. User work is never lost | Messages are saved as they complete. Answers are checkpointed every 2 s, and a crash is recovered as Interrupted (R2). Failed sends keep the text and attachments. Drafts are stored on the server. Add to note uses the existing append-only `append_to_note` with a heading. Deleting a session, course or semester still asks for confirmation and names its chats. Deleting one chat has Undo; a single chat isn't one of the objects the principle lists (R16) | ✅ |
| II. Data ownership and open formats | Chats are plain JSON plus a Markdown transcript, and uploads are kept in their original format, all in the session folder. The database holds only an index and isn't the sole copy (R11). **However, the principle's text lists only `notes/`, `audios/` and `documents/`.** Adding `chats/` needs a MINOR amendment (v1.3.0): add `chats/` to the hierarchy and name JSON plus a Markdown transcript as its open formats | ✅ (amended to v1.3.0 on 2026-10-19, task T000) |
| III. Frontend/backend separation | Every new capability is a documented `/api/v1` endpoint (contracts/openapi.yaml), and streaming is a documented SSE endpoint of the same version. The `TabRef.kind` change is additive. The frontend never touches the database, the files or the providers | ✅ |
| IV. Pluggable providers and secrets | AI styles sit behind one `ChatAdapter` interface, and the UI discovers them through `/ai/styles`. Keys are server-side only, masked (`last4`) and never logged; a test scans logs and files. The principle is extended in spirit to AI keys, and transcription keys gain encryption at rest. Provider failures are classified, recoverable errors and never change notes. *Suggested wording for the same amendment:* "Principle IV applies to all provider secrets (transcription and AI endpoints)" | ✅ (wording to be folded into the v1.3.0 amendment) |
| V. UI quality and accessibility | Built from shadcn primitives (Popover, Command, AlertDialog, DropdownMenu, Tooltip, Switch, RadioGroup). Colours come only from tokens. Everything works by keyboard, with visible focus and no traps, and focus returns after Stop, Expand and Dock. Indicators don't rely on colour. Screen readers get start and complete announcements only. Reduced motion is respected. axe runs in every theme. The design follows `design-taste-frontend` and the reference picture | ✅ |
| VI. Tests | Every new endpoint has contract tests for success and error cases (enforced by the coverage gate). The three critical flows are unchanged and stay green. New integration tests cover chat persistence, Stop, recovery, isolation and secret migration (quickstart) | ✅ |
| VII. Simplicity and spec discipline | No new infrastructure: SQLite only, and the OS key store isn't a service. Six new libraries, each justified (R14). Nothing outside the spec is built: no tools, web search or cost tracking. Complexity Tracking lists each deviation | ✅ (justified) |

**Gate result**: PASS. The blocking prerequisite was met on 2026-10-19 (constitution v1.3.0). The Principle II amendment, with the
Principle IV wording, must be ratified through `/speckit-constitution` before `/speckit-implement`
starts. `/speckit-tasks` lists it as task T000.

**Post-design re-check (after Phase 1)**: the result is unchanged.
- The data model adds tables only for metadata, indexes, secrets and transient drafts.
- The file contract keeps the conversations in plain files.
- The API contract keeps keys write-only.
- No design artifact introduced a new violation.

## Project Structure

### Documentation (this feature)

```text
specs/014-session-ai-chat/
├── plan.md                       # this file
├── research.md                   # R1–R16
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml              # 35 operations (feature 014 additions + amendments)
│   ├── chat-stream.md            # SSE event contract
│   ├── chat-file-format.md       # uh-chat/1 JSON + transcript + folder layout
│   ├── provider-styles.md        # outbound wire formats per style
│   └── ui-contract.md            # roles, names, shortcuts, behaviours
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml                         # + cryptography, keyring, platformdirs, pypdf
├── src/unihelper/
│   ├── config.py                          # + UNIHELPER_KEY_STORE, UNIHELPER_KEY_FILE (refuse paths under data_dir), run limits
│   ├── main.py                            # lifespan: secrets.open() → migrate_plaintext() → chat_runs.recover(); shutdown cancels runs
│   ├── secrets/                           # NEW
│   │   ├── master_key.py                  # keyring probe, key-file fallback, installation id
│   │   ├── store.py                       # SecretStore: put/remove/use()/mask/status, AES-256-GCM, verifier
│   │   └── migrate.py                     # plaintext transcription keys → secrets (one transaction)
│   ├── ai/                                # NEW
│   │   ├── base.py                        # ChatAdapter protocol, neutral request/parts, AiError
│   │   ├── sse.py                         # incremental SSE line parser (shared)
│   │   ├── openai_compat.py, anthropic.py, gemini.py
│   │   ├── errors.py                      # classification + message scrubbing
│   │   ├── limits.py, estimate.py         # per-style limits, token estimate
│   │   └── styles.py                      # registry → GET /ai/styles
│   ├── chat/                              # NEW
│   │   ├── files.py                       # uh-chat/1 read/write/atomic, transcript render, re-index
│   │   ├── runs.py                        # run registry, tasks, event buffers, checkpointing, recover(), limits
│   │   ├── context.py                     # build provider request: snapshots, PDFs, audio, uploads
│   │   └── sweep.py                       # deleted chats, stale uploads, old runs
│   ├── domain/
│   │   ├── ai_addresses.py                # base URL normalise, locality, https rule (+ shared LOCALHOST_HINT)
│   │   ├── ogg_opus.py                    # WebM/Opus → Ogg/Opus remux (no re-encode)
│   │   └── pdf_text.py                    # pypdf extraction with page/time limits, "has text" check
│   ├── models/                            # + ai_endpoint.py, ai_model.py, ai_settings.py, chat.py, chat_run.py, chat_draft.py, chat_upload.py, secret.py
│   ├── schemas/                           # + ai.py, chat.py; notes.py TabRef.kind + "chat"
│   ├── services/
│   │   ├── ai_endpoint_service.py, ai_settings_service.py, chat_service.py, chat_upload_service.py, note_search_service.py
│   │   ├── transcription_settings_service.py   # keys via SecretStore; status note
│   │   ├── trash_service.py, hierarchy_service.py  # content_counts + chats, chatTitles
│   │   └── note_service.py                # reuse append_to_note for "Add to note"
│   ├── transcription/config.py            # read_secret() via SecretStore (plaintext fallback only pre-migration)
│   ├── api/v1/                            # + ai.py, chats.py, chat_runs.py, secrets.py; notes.py + /notes/search
│   └── db/migrations/versions/0013_ai_chat.py
└── tests/
    ├── fake_llm.py                        # three-style scripted fake server
    ├── unit/ (ai_*, chat_files, ogg_opus, pdf_text, secrets_*, ai_addresses)
    ├── contract/ (test_ai.py, test_chats.py, test_chat_runs.py, test_secrets.py, test_notes_search.py)
    └── integration/ (see quickstart table) + test_migration_0013.py

frontend/
├── package.json                           # + react-markdown@10.1.0, remark-gfm@4.0.1
├── src/
│   ├── app/shell/
│   │   ├── widths.ts                      # right 300/360/640, half-window cap, right rail width
│   │   ├── layout.tsx                     # right rail state; RIGHT_CARD_ID → workspace-session-panel
│   │   ├── AppShell.tsx                   # render SideRail on the right when closed
│   │   └── SideRail.tsx                   # generalised from features/home/PanelRail.tsx (home rails reuse it)
│   ├── features/sessions/
│   │   ├── WorkspacePage.tsx              # SessionPanel replaces AudioCardHeader/RightPanel; chat tabs; remove AudioReopenButton use
│   │   ├── SessionPanel.tsx               # Recordings + Chat sections, boundary, uh.sessionPanel
│   │   ├── tabState.ts, WorkspaceTabs.tsx # TabKind "chat"
│   │   └── useWorkspaceKeyboard.ts        # Alt+K, Alt+Shift+K
│   ├── features/chat/                     # NEW
│   │   ├── api.ts, stream.ts, runStore.ts, chatPlacement.ts, drafts.ts
│   │   ├── ChatSection.tsx, ChatTab.tsx, HistoryView.tsx, ConversationView.tsx
│   │   ├── MessageBox.tsx, AttachMenu.tsx, NotePicker.tsx, ModelPicker.tsx, ContextList.tsx
│   │   ├── UserMessage.tsx, AnswerView.tsx, AnswerMarkdown.tsx, markdownBlocks.ts
│   │   ├── PrivacyNotice.tsx, AddToNoteDialog.tsx, ErrorNotice.tsx
│   │   └── routes.tsx                     # registers chat activity signal + pill, tab kind renderer
│   ├── features/settings/
│   │   ├── SettingsLayout.tsx, routes.tsx # + "AI"
│   │   ├── ai/AiSettings.tsx, EndpointForm.tsx, ModelList.tsx, KeyField.tsx (shared with transcription)
│   │   └── KeyProtectionNotice.tsx        # /secrets/status (also in Transcription)
│   └── lib/api/stream.ts                  # EventSource wrapper with Last-Event-ID and backoff
└── tests/
    ├── unit/ (run-store, chat-placement, markdown-blocks, message-box-keys, shortcut-conflicts, session-panel, side-rail, ai-settings, layout-widths)
    └── e2e/ (session-panel, chat-stream, chat-history, chat-expand-dock, chat-attachments, settings-ai, chat-perf, chat-a11y) + playwright webServer fake_llm :8021

docker-compose.yml                         # + unihelper-keys volume at /keys, UNIHELPER_KEY_STORE=file, UNIHELPER_KEY_FILE
README.md                                  # key protection, backing up keys volume separately
```

**Structure Decision**:
- This is the existing web application. The backend gains three cohesive packages: `secrets/`
  (a store with no knowledge of AI), `ai/` (provider adapters with no knowledge of chats) and
  `chat/` (conversations, files and runs).
- The services and routers follow the existing one-module-per-router pattern.
- The frontend adds one feature folder, `features/chat/`, and one settings subfolder. The shell
  changes are limited to the right rail and the new widths.

## Implementation Phases (for /speckit-tasks)

0. **Prerequisite**: amend the constitution to v1.3.0 (`chats/` in Principle II, and Principle
   IV covering all provider secrets). Add `design/reference/vscode-chat-sessions.png`.
1. **Secret store (US7)**: `secrets/`, migration 0013 (secret tables), `migrate_plaintext`,
   transcription read and write through the store, `/secrets/status`, Docker volume. This goes
   first so no AI key is ever stored in plaintext.
2. **Endpoints (US1)**: `ai_addresses`, `ai/` adapters with `fake_llm`, `/ai/*` endpoints, and
   Settings → AI.
3. **Session panel and rail (US2)**: widths, `SideRail`, `SessionPanel`, the localStorage layout,
   focus mode indicators. The audio card moves inside unchanged. Existing recording e2e tests
   stay green.
4. **Chat core (US3, US4)**:
   - chat files, index, runs, SSE, Stop, recover, drafts
   - History and Conversation views, message box, model picker, Markdown, errors, privacy
     notice
   - deletion impact and Trash counts
5. **Expand and Dock (US5)**: the `chat` tab kind, the placement reducer, scroll and draft
   persistence across moves.
6. **Notes as context (US6)**: `/notes/search`, the picker, snapshots.
7. **P2 (US8, US9)**: uploads, PDF documents and text fallback, audio with the Ogg remux,
   limits, preflight, the context list.
8. **P3 (US10)**: Add to note, edit and resend with versions, custom instructions, usage, search
   in text.
9. **Hardening**: the 1,000-message performance check, axe in every theme, the shortcut
   conflict test, key-leak scans, offline run with a local endpoint.

## Risks

- **Provider drift**: the wire formats change, and the Gemini inline limit is already
  inconsistent in the docs.
  - Mitigations: the adapters are small and parse fixtures recorded from real responses, the
    limits are constants, and unknown error shapes fall back to the provider's own message.
- **Local servers that differ from OpenAI's behaviour**: some don't support `stream_options`, or
  reject array `content`.
  - Mitigation: if the server answers 400 with a message mentioning `stream_options`, the adapter
    retries once without it. Text-only messages are sent as plain strings.
- **OS key store prompts**: on macOS the first `keyring` access may show a Keychain dialog,
  because the server runs as the user. This is documented in the README. A headless start with
  `UNIHELPER_KEY_STORE=file` avoids it.
- **The WebM → Ogg remux**: unusual WebM files (lacing, several tracks) may fail. In that case
  the user gets the "use Transcribe" message instead of a silent failure.
- **Long chats in the DOM**: 1,000 messages rely on `content-visibility`. The performance e2e
  test is the gate; virtualisation is the fallback, and would be added to Complexity Tracking if
  needed.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Principle II text: a new `chats/` folder and JSON plus Markdown files | Per-session chat history stored as user-owned readable files (FR-049, clarification Q4) | Markdown-only was rejected in clarification. SQLite-only storage would violate Principle II outright. **Resolved through the v1.3.0 amendment, not waived** |
| Background run registry and an SSE endpoint (the first streaming endpoint in the API) | Answers must survive panel and tab moves, reloads and parallel chats, and must stream (FR-007, FR-028, FR-035, FR-045) | A request-bound proxy stream dies with the browser connection. Polling can't meet SC-002. WebSockets are excluded from the Docker image and are unnecessary |
| Three hand-written provider adapters | One interface per Principle IV, small and testable | Three vendor SDKs would be heavier, would hide the wire details and couldn't serve local OpenAI-compatible servers uniformly |
| 4 backend dependencies (`cryptography`, `keyring`, `platformdirs`, `pypdf`) | Authenticated encryption, the OS key store, the per-user config path, and the PDF text fallback | Writing our own cryptography is unacceptable. Without `keyring` the OS key stores can't be reached portably. Text extraction without a library isn't feasible |
| 2 frontend dependencies (`react-markdown`, `remark-gfm`) | Safe Markdown rendering of answers with tables and code (FR-033) | Building a renderer on the existing mdast utilities would mean writing an HTML renderer and sanitisation by hand. `streamdown` is too new (less than 14 days) |
| A pure-Python WebM → Ogg/Opus remux | Gemini doesn't list WebM, and the app's own recordings are WebM/Opus (FR-054) | Transcoding with ffmpeg is a heavy system dependency, and refusing every app recording would make Audio unusable for the main case |
| A second Docker volume (`/keys`) | The master key must not live in the data folder or its backups (FR-064, FR-065) | A key file under `/data` would end up in every backup. The container has no OS key store |
| Progressive mounting of long chats in `ConversationView.tsx` (the last 30 turns first, then batches of 25 on the next tasks; every message ends up in the DOM) — added after T127's first run opened the 1,000-message chat in 2.4 s | SC-007's 2 s budget: rendering 1,000 Markdown messages in one pass took longer than the budget, even with `content-visibility: auto` | A virtualisation library (a new dependency, and messages leaving the DOM breaks find-in-page, screen-reader browsing of the log and the 48 px follow rule) — not needed once the first render is small |
