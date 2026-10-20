# Research: AI Chat in Session and Event Workspaces

Phase 0 of [plan.md](./plan.md). Provider documentation was checked on 2026-10-19. Sources:

- OpenAI: developers.openai.com/api/docs/guides (file-inputs, images-vision, error-codes,
  rate-limits)
- Anthropic: docs.anthropic.com/en/api (messages-streaming, errors, models-list) and
  docs.anthropic.com/en/docs/build-with-claude (vision, pdf-support)
- Google: ai.google.dev/api (generate-content, models) and ai.google.dev/gemini-api/docs
  (file-input-methods, audio, document-processing, troubleshooting)
- Local servers: docs.ollama.com/api/openai-compatibility and
  lmstudio.ai/docs/developer/openai-compat
- Python libraries: cryptography.io changelog and the keyring and platformdirs pages on PyPI

Every item below gives the **decision**, the **rationale** and the **alternatives considered**.

---

## R1. Where provider requests run: backend, as background "runs"

- **Decision**: The backend makes every provider request. A send creates a **chat run**: an
  asyncio task on the app's event loop, like the transcription worker.
  - The run owns the upstream HTTP stream and writes the answer as it arrives.
  - The browser *subscribes* to the run through `GET /api/v1/chat-runs/{runId}/events`, using
    server-sent events with `id:` sequence numbers and replay from `Last-Event-ID`.
  - Stop is `POST /chat-runs/{runId}/stop`. It cancels the task, which closes the upstream httpx
    stream.
- **Rationale**:
  - Keys must never reach the frontend (FR-066, Principle IV), so the browser can't call
    providers itself.
  - Making the run independent of the browser connection gives the spec's guarantees for free:
    - closing the panel, closing a chat tab, Expand/Dock, switching sessions, or a browser
      reload never interrupts an answer (FR-007, FR-045)
    - several chats can generate at once (FR-028)
    - the subscriber just re-attaches
  - Native `EventSource` is same-origin, sends cookies, needs no CSRF (it is a GET) and
    reconnects on its own. It needs no new frontend dependency and fits the CSP
    (`connect-src 'self'`).
- **Cancelling at the provider**: closing the connection aborts generation for OpenAI (widely
  observed, though not formally documented), Anthropic, Gemini, Ollama, llama.cpp and vLLM.
  - Stop closes the stream at once.
  - The run ignores anything that arrives after cancellation, so "no further text arrives"
    (FR-036) holds even if a provider keeps billing for a moment.
- **Concurrency**:
  - At most 4 runs per user and 8 in total. A further send answers 429 `too_many_runs` with a
    plain message.
  - Deltas are merged and flushed to subscribers every 50 ms. The answer is checkpointed to the
    chat file every 2 s and written for good on completion.
- **Alternatives considered**:
  - **Proxying one POST request whose response is the stream**: rejected. A navigation or tab
    close would cancel the answer, which breaks FR-045.
  - **WebSockets**: rejected. The Docker image deliberately leaves out `websockets`, and they
    offer nothing SSE lacks for one-way streaming.
  - **Polling**: rejected because of latency (SC-002).

## R2. "If the app closes during an answer" → Interrupted

- **Decision**: "The app" means the server process.
  - On a graceful shutdown, the lifespan cancels runs, and each one writes its partial answer
    with status `interrupted`.
  - On a crash, `chat_runs.recover()` runs at startup and changes any `streaming` answer to
    `interrupted`, keeping its last checkpoint (at most 2 s of text is lost, the same rule as
    the recording chunk).
  - Closing the browser does **not** interrupt the answer: it finishes on the server, and the
    rail shows it as unseen.
- **Rationale**: This matches Principle I and the transcription worker's `recover()` pattern.
- **Alternatives considered**: interrupting when the last subscriber leaves. Rejected: it
  contradicts FR-007 and FR-045.

## R3. Provider wire formats (FR-021), confirmed with the deviations noted

The three styles' wire formats are in [contracts/provider-styles.md](./contracts/provider-styles.md).
Findings that change details of the spec's table:

- **OpenAI-compatible**:
  - `stream_options.include_usage=true` adds a last chunk that carries `usage` with an empty
    `choices` array. This is how usage is read (FR-061).
  - Ollama, LM Studio and llama.cpp accept images only as base64 data URLs. Ollama does not
    accept `file` (PDF) or `input_audio` parts, which is why capabilities default to Images only
    and the user can change them.
  - `input_audio.format` accepts only `wav` and `mp3`.
- **Anthropic**:
  - `anthropic-version: 2023-06-01` is still current. PDFs need no beta header.
  - Limits: 32 MB per request; 10 MB per image after base64 encoding; 100 images for 200k-context
    models (600 otherwise); PDFs up to 600 pages, or 100 pages below a 1M context.
  - `GET /v1/models` now reports `max_input_tokens`, `max_tokens` and `display_name`, which
    gives the context limit.
  - In-stream errors arrive as `event: error` with `overloaded_error` and similar types.
  - A 413 `request_too_large` comes from the edge.
- **Gemini**:
  - There is no `[DONE]` marker; the stream simply ends. Parts with `thought: true` must be
    skipped. `usageMetadata` carries usage.
  - The models list gives `inputTokenLimit` and `outputTokenLimit`. Filter on
    `supportedGenerationMethods` containing `generateContent`.
  - **The docs disagree on the inline limit** (the file-input page says 100 MB per request, and
    50 MB for PDFs; the audio page says 20 MB). **Decision**: the app uses **20 MB per request**,
    the conservative figure. Larger requests are refused with the message "Gemini accepts up to
    20 MB of attached files per message." Keeping it a constant in `ai/limits.py` lets it be
    raised later.
  - Accepted audio MIME types are wav, mp3, aiff, aac, ogg and flac. **WebM is not listed**
    (see R9).
- **Unverified points carried into tests rather than assumptions**:
  - OpenAI's 404 `model_not_found` code and its 413 behaviour.
  - Gemini's `RetryInfo.retryDelay`.

  The error classifier (R6) therefore also looks at HTTP status and message text, with tests
  for each shape.
- **The newer Gemini `interactions` API is not used.** `streamGenerateContent` is still
  documented and is what the spec names.

## R4. Detecting "does not look like this style"

- **Decision**: Test connection sends the probe *for the chosen style* and checks the response
  shape:
  - OpenAI style: top-level `data[]`, items with `id`, usually `object:"list"`.
  - Anthropic style: `data[]` items with `type:"model"`, plus `has_more`, `first_id` and
    `last_id`.
  - Gemini style: `models[]` whose `name` starts with `models/`.

  Error bodies are recognised in the same way:
  - Anthropic: top-level `type:"error"`
  - Google: `error.status` and `error.code`
  - OpenAI: `error.message`, `error.type` and `error.code`

  A well-formed response of *another* style, HTML, or JSON of an unknown shape yields
  `not_this_style`. The result names the style it looks like when it can tell.
- **Alternatives considered**: auto-detecting the style. Rejected; the spec makes the user
  choose, and auto-detection is only used to word the hint.

## R5. Base URL handling and Local/Remote

- **Decision**: In `domain/ai_addresses.py`:
  - Parse with `urllib.parse`. Lower-case the scheme and host, and drop the trailing slash.
  - Strip any request path the style knows, along with any query string:
    - OpenAI: `/chat/completions`, `/models`
    - Anthropic: `/v1/messages`, `/v1/models`, `/v1`
    - Gemini: `/v1beta/models…`, `/v1beta`
  - Return `{baseUrl, removedPath}` so the UI can say "Removed /chat/completions — the app adds
    it".
- **Local** means:
  - an IP literal that is loopback (127/8, ::1), private (10/8, 172.16/12, 192.168/16,
    fc00::/7, 100.64/10 CGNAT) or link-local (169.254/16, fe80::/10)
  - the host names `localhost`, `*.localhost`, `*.local`, `host.docker.internal`
  - single-label names such as `gpu-box`

  Every other host name is **Remote**, and the app never uses DNS to decide.
- **Remote** addresses must be `https`, and saving or testing one over `http` is refused with
  422 `https_required`. Keys are sent only after this check, in the adapter itself, so no code
  path can skip it (FR-016).
- **Rationale**: Without DNS lookups, a public name can't be made "Local" by pointing it at a
  private IP. It is also deterministic in tests.
- **Reused**: the transcription `LOCALHOST_HINT` text and `_loopback` check. The hint is moved
  into `domain/addresses.py` so transcription and AI share it.
- **Alternatives considered**:
  - Resolving host names: rejected as unpredictable and a spoofing risk.
  - Allowing http for Remote addresses without a key: rejected because the spec says any other
    address must use https.

## R6. Error classification

- **Decision**: `ai/errors.py` maps each failure to one of these categories (FR-017, FR-039):
  - `network` (connection refused, DNS, TLS), with the local hint for Local addresses
  - `timeout`
  - `key_rejected` (401, 403, `authentication_error`, `PERMISSION_DENIED`)
  - `rate_limited`, with `retryAfterSeconds` taken from the `retry-after` header, Gemini
    `RetryInfo`, or none
  - `model_not_found` (404, `not_found_error`, `NOT_FOUND`, `model_not_found`)
  - `too_large` (413, `request_too_large`, Gemini `INVALID_ARGUMENT` mentioning size)
  - `context_exceeded`
  - `provider` (any other message, passed through)
  - `not_this_style`
- **Provider message handling**: the provider's own message is passed through only after
  - removing anything that looks like the endpoint's key or a key-shaped token (`sk-…`,
    `AIza…`, 32 or more base64url characters), and
  - cutting it to 500 characters.
- **Logging**: log lines carry only the endpoint id, the category, the status and the exception
  type, as the transcription client does. A test asserts that no log record contains the key.

## R7. Secrets at rest (FR-063–068)

- **Decision**: envelope encryption with symmetric keys only.
  - A random 256-bit **master key** per installation.
  - Each secret is encrypted with **AES-256-GCM** (`cryptography`'s `AESGCM`):
    - a fresh 12-byte random nonce per encryption
    - associated data `uh-secret-v1|{user_id}|{owner_kind}|{owner_id}`, so a ciphertext copied
      onto another row fails authentication
  - A `secret_store_meta` row holds a **verifier** (the encrypted constant `uh-verifier`). It
    tells "wrong or missing master key" apart from corrupt data.
- **Post-quantum requirement**: this scheme has **no public-key step**, so FR-064's
  post-quantum clause is met trivially.
  - AES-256 keeps about 128-bit security against Grover's algorithm and is the algorithm NSA
    CNSA 2.0 requires.
  - Adding a key-encapsulation scheme (ML-KEM is available in `cryptography` ≥ 48 via OpenSSL
    3.5) would bring complexity with no benefit, because nothing is exchanged between two
    parties. If a public-key step is ever added, it must use ML-KEM-1024 (hybrid with X25519).
- **Where the master key lives** (never in SQLite and never under `UNIHELPER_DATA_DIR`):
  1. **OS key store** via `keyring` 25.7.0: Windows Credential Locker, macOS Keychain, or Linux
     Secret Service / KWallet.
     - Service `UniHelperProMax`; account `master-key:{installation_id}`.
     - `installation_id` is a random UUID kept in `secret_store_meta`. It is not secret; it
       only tells installations on one machine apart.
     - A backend is usable if `keyring.get_keyring()` isn't the `fail` or `null` backend and
       has a priority above 0, **and** a write/read/delete probe succeeds.
  2. **Key file fallback** (clarification Q1):
     - The file is `platformdirs.user_config_dir("UniHelperProMax")/master-<installation_id>.key`.
     - It is created with `O_CREAT|O_EXCL`, mode `0600`. On Windows it relies on the profile
       ACL.
     - `UNIHELPER_KEY_FILE` overrides the location. Startup **refuses** a path inside the data
       folder with a clear error.
  3. **`UNIHELPER_KEY_STORE`** = `auto` (default), `keyring` or `file` forces the choice, for
     tests and Docker.
- **Docker** has no D-Bus, and its root file system is read-only.
  - `docker-compose.yml` gains a second named volume, `unihelper-keys`, mounted at `/keys`,
    with `UNIHELPER_KEY_STORE=file` and `UNIHELPER_KEY_FILE=/keys/master.key`.
  - A backup of `/data` alone then reveals no key, which satisfies FR-064.
  - The README says to back the two volumes up separately, or knowingly together.
  - **WSL/headless Linux** usually ends up on the key-file fallback, which Settings states.
- **Settings status** (`GET /secrets/status`):
  - `store`: `os_key_store` or `key_file`, with the plain-language weaker-protection sentence
    for the key file: "Keys are encrypted, but the encryption key is kept in a file in your
    user profile. Anyone who can sign in to this computer as you can read your keys."
  - `readable`: false when the verifier fails.
  - `unreadableSecrets`: a count.
  - `migration`: `done`, `failed` or `not_needed`, with a message.
- **Lost key**: if the verifier fails (the key store was wiped or the data was restored
  elsewhere), the app keeps running.
  - Every secret reads as `unreadable`; masked state shows "Key can't be read — enter it again".
    Calls needing the key fail with `key_unreadable`.
  - Entering a key re-encrypts it under a **new** master key once the user confirms a reset
    ("Start a new key store"). That replaces the verifier and drops the unreadable ciphertexts.
    No other data is touched (FR-068).
- **Rationale**: this is standard envelope encryption, needs no extra infrastructure
  (Principle VII), and keeps decryption in the backend at the moment of use (`SecretStore.use()`
  is a context manager that yields the plaintext and never stores it on objects with a `repr`).
- **Alternatives considered**:
  - **SQLCipher or whole-database encryption**: a heavier dependency, and it changes the
    database for every feature.
  - **Deriving the key from a passphrase**: rejected in clarification Q1.
  - **`keyrings.alt`**: its file backends are weak and unmaintained.
  - **Windows DPAPI directly**: redundant, since Credential Locker already uses it.

## R8. Migrating transcription keys (FR-067)

- **Decision**:
  - Migration `0013` (Alembic, pure schema) adds the new tables and
    `transcription_provider_configs.secret_id`. It keeps the plaintext column for now.
  - A **startup step** `secrets.migrate_plaintext()` runs after `upgrade_to_head`, because it
    needs the master key and Alembic must not touch the OS key store. In one `BEGIN IMMEDIATE`
    transaction it:
    1. obtains or creates the master key
    2. encrypts every non-null `secret`
    3. sets `secret_id`
    4. decrypts each row to check it
    5. sets `secret` to NULL
    6. commits
  - Any failure rolls the whole transaction back, so the plaintext stays and transcription keeps
    working. The failure is recorded in `secret_store_meta.migration_error` and shown in
    Settings; the migration is retried at the next start.
  - A later feature drops the column once no installation has rows left.
  - `transcription/config.read_secret()` reads through `SecretStore` and falls back to the
    plaintext column **only** while the migration hasn't succeeded.
- **Rationale**: nothing is lost and nothing is half-migrated. Existing transcription tests keep
  passing (SC-006, SC-010).
- **Alternatives considered**: encrypting inside the Alembic migration. Rejected because it
  couples schema migration to the OS key store and makes `alembic upgrade` fail in CI and
  Docker builds.

## R9. Attachments: formats, conversion and limits

- **Notes**: read on the server at send time. Each send takes a fresh snapshot (clarification Q2).
  - Snapshots are stored content-addressed in the chat's folder:
    `chats/<stem>.files/snapshots/<sha256[:16]>.md`, deduplicated.
  - The message records `{noteId, title, snapshot}`.
  - Notes are sent as text blocks: `--- Note: <title> ---\n<text>`.
- **Pictures**: PNG, JPEG, WebP and GIF; types are checked by magic bytes, not by extension.
  - GIF is sent as-is. OpenAI accepts only non-animated GIFs, so the provider's error is shown
    if it refuses one.
  - Gemini doesn't list GIF, so for the Gemini style GIF is refused with a reason.
  - No re-encoding, to avoid an image library.
- **PDFs**: a session document (by reference) or an upload.
  - If the model accepts PDFs, it is sent as a `file`, `document` or `inline_data` part.
  - Otherwise the user is offered the extracted text. Extraction uses **pypdf** (pure Python)
    in the backend, in a thread with a 20 s / 2,000-page limit.
  - A text yield below 20 characters per page on average counts as "no text" (a scan), and the
    app says so (FR-053).
  - Encrypted PDFs (already detected by `pdf_probe`) are refused with a reason.
- **Audio**: a session recording or an upload, offered only for models with the Audio
  capability.
  - **OpenAI-compatible**: `input_audio` takes only wav and mp3. Other formats (the app's own
    WebM/Opus recordings, M4A, OGG) are refused with "This model accepts WAV or MP3 audio. Use
    Transcribe for this recording."
  - **Gemini**: wav, mp3, aiff, aac, ogg and flac are sent directly. **WebM/Opus recordings are
    remuxed to Ogg/Opus with no re-encoding.** `domain/webm.py` already parses the EBML blocks;
    the new `domain/ogg_opus.py` writes Ogg pages (OpusHead/OpusTags plus packets). This covers
    the app's own recordings, the most common case. If remuxing fails, the user gets the
    Transcribe pointer.
  - **Anthropic**: audio is never offered.
  - Audio over the style's per-message limit is refused with the transcribe-first suggestion.
- **Limits** live in `ai/limits.py` (published by `GET /ai/styles`) and are shown before sending
  (FR-055). Attachment content is sent as base64, and requests are checked for size **after**
  encoding.

  | Style | Per file | Per message (all attachments) | Other |
  |---|---|---|---|
  | OpenAI-compatible | image 20 MB, PDF 50 MB, audio 25 MB | 50 MB | — |
  | Anthropic | image 7.5 MB raw (10 MB base64), PDF 32 MB | 32 MB request | 100 images, 100 PDF pages (600 for ≥ 1M context) |
  | Gemini | 20 MB | 20 MB inline | PDF ≤ 1000 pages |

  - The app-wide caps are 10 attachments per message and 25 MB per upload.
  - Nothing is ever truncated. Oversized items are refused with a sentence naming the limit.
- **Alternatives considered**:
  - Extracting PDF text in the browser with the PDFium engine already shipped for the reader:
    rejected, because the backend has to build the request anyway and doing both means two
    code paths.
  - Transcoding audio with ffmpeg: rejected, as it is a heavy system dependency.

## R10. Context estimate and limit (FR-056)

- **Decision**: `ai/estimate.py` estimates tokens as follows:
  - text: characters ÷ 4
  - images: 1,600 tokens each (upper bound)
  - PDFs as documents: 1,500 tokens per page for Anthropic, 258 per page for Gemini, and
    extracted characters ÷ 4 for OpenAI file parts
  - audio: 32 tokens per second for Gemini
- **The model's limit** comes from Anthropic's `max_input_tokens` or Gemini's
  `inputTokenLimit`, or from an optional "Context limit" field the user can type for a model.
  Without a limit, the size is shown without a comparison.
- **Preflight**: `POST /chats/preflight` returns the per-item acceptance (capability, size and
  availability), the estimate, the limit and the overflow.
  - Send refuses with 409 `context_exceeded` when the estimate goes over the limit.
  - The UI then offers "Remove items" or "Start a new chat" (carrying the draft over).
- **Rationale**: estimates are advisory; the provider's own `context_exceeded` error is still
  classified and shown.

## R11. Chat files (clarification Q4) and their place in the folder hierarchy

- **Decision**: chats live in `<session folder>/chats/`:
  - `<YYYY-MM-DD HHMM> <first-title, safe_name, ≤ 60>.json`: the source of truth. Its schema is
    in [contracts/chat-file-format.md](./contracts/chat-file-format.md).
  - `<same stem>.md`: the transcript, regenerated after every change from the JSON. If it is
    missing or edited, it is rebuilt at the next write or open.
  - `<same stem>.files/`: uploads and note snapshots.
  - The stem stays fixed after creation, so renaming a chat changes only its title. This avoids
    rename churn and broken references.
  - Writes use `StorageService.write_text_atomic` under a per-chat lock.
- **SQLite** keeps only an index row per chat (id, session folder, stem, title, times, flags)
  for listing, counting and the deletion impact. Principle II: the database is never the only
  copy.
  - On open, or when the index row and the file disagree, the file wins and the row is updated.
- **Moves**:
  - Chats hang off `session_folder_id`, and their paths are relative to the folder.
  - A rescheduled class session keeps its folder (the key is the original date), so its chats
    stay attached.
  - An event moved to another semester has its folder renamed by `event_service`, and the chats
    move with it because their paths are relative (FR-051).
  - Trash moves the whole folder, chats included, and restore brings it back. Purge deletes the
    rows by cascade and the files with the folder.
- **Constitution**: Principle II lists `notes/`, `audios/` and `documents/`. A `chats/` folder
  with JSON and Markdown files is in the spirit of the principle (open, readable, browsable),
  but it isn't in its text. **An amendment to v1.3.0 (MINOR) is required** that adds `chats/`
  and names JSON plus a Markdown transcript as the open formats. This is a prerequisite task
  before implementation (see the plan's Constitution Check).
- **Alternatives considered**:
  - Markdown only: rejected in clarification.
  - Storing the conversation in SQLite: violates Principle II.

## R12. Drafts (FR-032) and unseen answers

- **Decision**: drafts are stored **server-side** in the `chat_drafts` table: `(user,
  session_folder lineage key, chat_id or NULL for the new-chat box)` → text plus attachment
  references (staged upload ids, note ids, document ids, recording ids).
  - The client saves with a 400 ms debounce (`PUT`) and flushes on `pagehide` with `keepalive`.
  - A draft row is deleted when its message is sent.
  - Staged uploads with no draft or message pointing at them are deleted after 24 h by the
    startup sweep.
- **Rationale**:
  - Drafts can hold uploaded files, which must live on the server anyway.
  - Drafts survive restarts and other browsers.
  - Drafts are transient input, not user documents, so a database-only copy is acceptable under
    Principle II, as is the existing `uh.draft.*` precedent in the browser.
- **Unseen**: `chats.unseen_answer` is set when a run finishes while no subscriber has the chat
  in view. `POST /chats/{id}/seen` clears it; the client sends it whenever the Conversation view
  of a chat is visible and the document is visible.

## R13. Frontend architecture

- **Run store**: `features/chat/runStore.ts` is a module singleton read with
  `useSyncExternalStore`, the pattern `recorder()` already uses.
  - It holds one `EventSource` per active run, keyed by runId, plus the accumulated text.
  - The panel and tab views are only *views* on it, so moving a chat between them never touches
    the run (FR-045).
  - It feeds `registerActivitySignal("chat", …)` for the rail, the activity pills and focus mode
    (FR-006, FR-011).
- **Chat location**: per session, `panelChatId` (localStorage `uh.chat.panel.<sessionKey>`) and
  the workspace tabs (`TabRef {kind:"chat", id}`). The invariant "one place at a time" is
  enforced in one reducer, `chatPlacement.ts`: Expand moves a chat, choosing an "Open in tab"
  chat switches to it, and Dock moves it back.
  - The `TabRef.kind` enum in the backend gains `"chat"`. This is additive and keeps API v1.
  - `retain` drops chat tabs whose chat was deleted.
- **Markdown**: `react-markdown` 10.1.0 with `remark-gfm` 4.0.1, both pinned exactly and older
  than 14 days.
  - Raw HTML stays off (no `rehype-raw`), so output is safe without a sanitizer pass. The
    `urlTransform` default also strips `javascript:`.
  - Custom components:
    - `a` with `target="_blank" rel="noopener noreferrer"`
    - `img` → a "Remote image not loaded — Open link" placeholder (FR-033)
    - `pre/code` with the language label and a Copy button
  - No syntax highlighter; the spec asks only for the language and Copy.
  - **Streaming**: the growing text is split into top-level blocks at blank lines outside
    fences. Finished blocks are memoised; only the last block re-renders, at most once per
    animation frame. An unclosed fence is closed temporarily for display.
  - Rejected: `streamdown`, released on 2026-10-19 (less than 14 days old), and
    `shiki`/`rehype-highlight` (not needed).
- **Long chats** (SC-007): messages use `content-visibility: auto` with
  `contain-intrinsic-size` and memoised items.
  - The client fetches the whole chat (1,000 messages of text is about 1–3 MB of JSON) once,
    then patches it from run events.
  - Rejected: a virtualisation library. Measured with the 1,000-message fixture first; it is
    added only if the e2e performance check fails.
- **The right panel and rail**:
  - `SessionPanel` reuses `CollapsibleSection` and the weight-based boundary from `LeftCard`.
  - A generalised `SideRail` is extracted from `features/home/PanelRail.tsx` and takes a list of
    items with icon, name, indicator and `onActivate`.
  - `widths.ts` changes `RIGHT_MIN/DEFAULT/MAX` to 300/360/640 and adds the half-window cap and
    a right `RAIL_W`.
  - The open state moves from the server preference `workspaceRightCollapsed` to localStorage
    `uh.sessionPanel` = `{open, width, weights, collapsed}`, as the spec requires per browser.
    The first read seeds it from the old preference.
  - Below 1100 px the panel starts closed. The rail shows on the right like the left rail.
    Opening it uses the existing overlay `Sheet` if the docked panel would break the 480 px
    main-card minimum.
  - `AudioReopenButton` is removed from the tab row; its indicator logic moves to the rail.
- **Shortcuts** (FR-072):
  - `Alt+]` keeps toggling the panel (the existing binding).
  - **`Alt+K`** focuses the message box, opening the panel and Chat if needed.
  - **`Alt+Shift+K`** starts a new chat.
  - The checks: not used by Chrome, Edge or Firefox (Firefox's menu keys are F, E, V, S, B, T
    and H); not used by MDXEditor or Lexical; no app conflicts (Alt+N/W/PgUp/PgDn/[/]/\ and
    Alt+Shift+N are taken).
  - Matching uses `e.code` (`KeyK`), as the other Alt shortcuts do, so macOS's Option+K
    character doesn't block it.
  - A unit test, `shortcut-conflicts.test.ts`, lists every app binding and fails on duplicates.
- **Cross-session note picker**: a new `GET /notes/search?q=&courseId=&sessionKey=&limit=`
  returns notes with their course and session labels. The picker is a `CommandDialog` with
  "This session" and "Browse" (course → session) groups.

## R14. New dependencies (Principle VII)

| Package | Version | Side | Why |
|---|---|---|---|
| `cryptography` | ≥ 50.0.2, < 51 | backend | AES-256-GCM (R7) |
| `keyring` | ≥ 25.7.0, < 26 | backend | OS key store (R7) |
| `platformdirs` | ≥ 4.13.5, < 5 | backend | the per-user config folder for the key file (R7) |
| `pypdf` | ≥ 6, < 7 (exact pin at implementation, ≥ 14 days old) | backend | PDF text fallback (R9) |
| `react-markdown` | 10.1.0 | frontend | rendering answers (R13) |
| `remark-gfm` | 4.0.1 | frontend | tables, task lists and strikethrough in answers (R13) |

- No SSE client library is needed (native `EventSource`), nor any LLM SDK: three small httpx
  adapters keep one shared interface, which mirrors Principle IV's provider design and avoids
  three heavy SDKs.

## R15. Deletion confirmations "name its chats" (FR-051)

- **Decision**:
  - `content_counts` gains `chats`. Every deletion-impact response and Trash entry gains a
    `chats` count, and `trashSentence()` names it ("3 notes, 1 recording and 2 chats").
  - For a single session or event deletion, the dialog also lists up to 5 chat titles plus
    "and N more", from the new `chatTitles` field of `deletion-impact`.
- **Rationale**: this matches the existing count-based confirmations, while still naming chats
  where a list is short enough to read.

## R16. Chat deletion with Undo

- **Decision**: `DELETE /chats/{id}` sets `deleted_at` and hides the chat. `POST
  /chats/{id}/restore` undoes it within 10 minutes (the toast shows it for 10 s, the spec's
  minimum).
  - A sweep at startup and every 10 minutes deletes the files and rows of chats deleted more
    than 10 minutes ago.
  - A chat with a running answer is stopped first, and the partial answer is saved before the
    delete.
- **Constitution I**: a single chat isn't one of the listed objects that need a confirmation
  dialog. Undo is the safer UX the spec asks for. Deleting a session, course or semester still
  asks for confirmation and names its chats.
