# Data Model: AI Chat in Session and Event Workspaces

There are three stores. A conversation's source of truth is always its file
([contracts/chat-file-format.md](./contracts/chat-file-format.md)).

- **SQLite**, migration `0013_ai_chat`: metadata, indexes and encrypted secrets.
- **Files** under the session folder: the conversations themselves.
- **Browser localStorage**: per-browser layout only.

Every table has `user_id → users.id ON DELETE CASCADE`, and every query filters on the signed-in
user (another user's ids return 404). Ids are UUIDv7, as elsewhere in the app.

## SQLite tables

### `secret_store_meta` (one row per installation)

| Column | Type | Notes |
|---|---|---|
| `id` | int PK = 1 | singleton |
| `installation_id` | uuid | names the key-store entry or key file; not secret |
| `verifier_nonce`, `verifier_ct` | blob | AES-GCM of the constant `uh-verifier`. A failing check means the master key is wrong or lost |
| `store_kind` | text | `os_key_store` or `key_file`, as last used |
| `migration_state` | text | `pending`, `done` or `failed` |
| `migration_error` | text NULL | a fixed category string; never contains secret values |
| `rotated_at` | datetime NULL | set when the user starts a new key store after a loss |

### `secrets`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | FK | |
| `owner_kind` | text | `ai_endpoint` or `transcription_provider` |
| `owner_id` | text | the endpoint id, or the transcription `provider_id` |
| `nonce` | blob(12) | fresh for every encryption |
| `ciphertext` | blob | AES-256-GCM with associated data `uh-secret-v1\|{user_id}\|{owner_kind}\|{owner_id}` |
| `last4` | text NULL | **not stored.** The mask is computed after decrypting in the backend, so no plaintext fragment lives at rest. The mask rule is FR-019 |
| `created_at`, `updated_at` | datetime | |

- Unique: `(user_id, owner_kind, owner_id)`.
- A row is replaced when a key is replaced, and deleted when a key is removed or its owner is
  deleted.

### `transcription_provider_configs` (existing; changed)

- **Adds** `secret_id → secrets.id NULL`.
- The `secret` (plaintext) column is kept only until `migrate_plaintext()` succeeds. It is
  NULL afterwards, and a later feature drops it.

### `ai_endpoints`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | FK | |
| `name` | text | required; 1–60 characters, trimmed; unique per user (case-insensitive) → 409 `name_taken` |
| `style` | text | `openai`, `anthropic` or `gemini` |
| `base_url` | text | normalised (research R5): no trailing slash, no request path, no query string |
| `locality` | text | `local` or `remote`, derived from `base_url` on every save and never accepted from the client |
| `enabled` | bool | default true |
| `secret_id` | FK NULL | absent = no key |
| `privacy_ack_at` | datetime NULL | set by `POST /ai/endpoints/{id}/privacy-ack`; only meaningful when `remote` |
| `version` | int | `VersionMixin`, so updates need `If-Match` |
| `created_at`, `updated_at` | datetime | |

- **Validation**:
  - A `remote` address with `http` → 422 `https_required`.
  - An unparsable URL → 422 `invalid_url`.
  - A key on an `http` address is allowed only when the address is `local`.

### `ai_models`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `endpoint_id` | FK → ai_endpoints ON DELETE CASCADE | |
| `model_id` | text | the exact identifier sent to the provider (1–200 characters); unique per endpoint |
| `display_name` | text | 1–80 characters; defaults to the provider's display name or `model_id` |
| `cap_images`, `cap_pdf`, `cap_audio` | bool | defaults by style. OpenAI: images. Anthropic: images and PDF. Gemini: images, PDF and audio |
| `hidden` | bool | hidden models are left out of the model button |
| `source` | text | `fetched` or `manual` |
| `context_limit` | int NULL | from the provider list, or typed by the user |
| `output_limit` | int NULL | Anthropic `max_tokens` from the list. Requests use `min(output_limit, 8192)` as `max_tokens`, or 4096 when it is unknown |
| `position` | int | display order |

- Models are replaced as a whole set by `PATCH /ai/endpoints/{id}` (`models` array). Refresh only
  **returns** candidates and never writes them (the Test/Refresh-never-saves rule).

### `ai_settings` (one row per user)

| Column | Type | Notes |
|---|---|---|
| `user_id` | PK FK | |
| `custom_instructions` | text | ≤ 8,000 characters; sent as the system instruction when not empty (FR-060) |
| `last_model_id` | FK → ai_models NULL ON DELETE SET NULL | the model new chats start with |
| `version` | int | |

### `chats` (an index of the chat files)

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | the same id as inside the JSON file |
| `user_id` | FK | |
| `session_folder_id` | FK → session_folders ON DELETE CASCADE | binds the chat to exactly one session or event (FR-048) |
| `stem` | text | file stem inside `chats/`, fixed after creation; unique per folder |
| `title` | text | 1–200 characters. Starts as the first 60 characters of the first message, whitespace collapsed (FR-029) |
| `model_ref_id` | FK → ai_models NULL ON DELETE SET NULL | the chat's current model |
| `model_label` | text | "Endpoint · Model" text kept for when the model or endpoint is gone (FR-020) |
| `message_count` | int | |
| `generating` | bool | true while a run is active |
| `unseen_answer` | bool | research R12 |
| `file_hash` | text | SHA-256 of the JSON as last written. A mismatch on read means the file was changed outside the app: re-index from the file |
| `deleted_at` | datetime NULL | soft delete for Undo (research R16) |
| `created_at`, `updated_at` | datetime | |
| `version` | int | `If-Match` on PATCH and DELETE |

- Lists are sorted by `updated_at` DESC (the newest activity first).
- An empty chat never gets a row, because a chat is created together with its first message
  (FR-028).
- `content_counts()` counts rows with `deleted_at IS NULL`.

### `chat_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id`, `chat_id` | FK | |
| `answer_id` | text | the answer version this run writes |
| `status` | text | `queued`, `streaming`, `completed`, `stopped`, `interrupted` or `failed` |
| `started_at`, `ended_at` | datetime | |
| `error_category` | text NULL | research R6 |

- At most one active run per chat; a second send answers 409 `run_active`.
- `recover()` at startup sets `queued` and `streaming` runs to `interrupted` and patches their
  answers in the files (research R2).
- Rows older than 7 days are pruned.

### `chat_drafts`

| Column | Type | Notes |
|---|---|---|
| `user_id` | FK | |
| `session_folder_lineage_id`, `session_original_date` | | the session key. A draft may exist before the session has a folder |
| `chat_id` | uuid NULL | NULL = the new-chat box |
| `text` | text | ≤ 100,000 characters |
| `attachments_json` | json | `[{kind, ref}]`; see the Attachment entity |
| `updated_at` | datetime | |

- Primary key: `(user_id, lineage_id, original_date, coalesce(chat_id, ''))`.
- Deleted on send, and when its chat is purged.

### `chat_uploads` (staged device files)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id`, `session_folder_id` | FK | uploading creates the session folder |
| `kind` | text | `image`, `pdf` or `audio` |
| `mime`, `size`, `original_name`, `sha256` | | the MIME type comes from magic bytes |
| `rel_path` | text | `chats/.uploads/<id>-<safe name>` until first sent, then moved to `chats/<stem>.files/` |
| `chat_id` | uuid NULL | set when first sent |
| `created_at` | datetime | |

- Uploads with no chat and no draft referencing them are swept after 24 h.

### Existing tables touched

- **`workspace_state.tabs_json` / `TabRef.kind`**: adds `"chat"`. The max of 50 tabs still
  applies, and `split_json` panes may hold a chat tab.
- **`ui_preferences`**: `workspace_right_collapsed` is now read only once, to seed
  `uh.sessionPanel` in the browser; it is no longer written.
- **Deletion impact and Trash payloads**: add `chats`, and add `chatTitles` (≤ 5) on
  session-level impact (research R15).

## Entities and states

### Chat → Turn → Version → Answer

These are kept in the file, with a summary in `chats`.

- **Chat**: `{id, title, sessionKey, createdAt, updatedAt, model: {endpointId, modelId, label},
  context: ContextItem[], turns: Turn[]}`.
- **Turn**: one exchange. `{id, versions: UserVersion[], selected: int}`.
  - Only the **last** turn can gain versions, through edit and resend (clarification Q5).
- **UserVersion**: `{id, text, createdAt, attachments: AttachmentRef[], noteSnapshots:
  {noteId, title, snapshot}[], answers: Answer[], selectedAnswer: int}`.
- **Answer**: `{id, text, status, endpointLabel, modelLabel, endpointId?, modelId?, startedAt,
  endedAt?, usage?: {input, output, total}, error?: {category, message, retryAfterSeconds?}}`.
  - Regenerate appends an answer to the selected UserVersion (clarification Q3).
- **The conversation sent to the provider** is, for each turn, the selected UserVersion followed
  by its selected Answer, up to and including the user version being answered.
  - Answers with status `failed`, or `stopped`/`interrupted` with empty text, are left out.
  - A `stopped` answer with text is included as it is.

**Answer status**

```text
queued ─► streaming ─► completed
             │  ├────► stopped      (Stop / Escape; partial text kept, FR-036)
             │  ├────► interrupted  (server shutdown or crash; recover(), FR-037)
             │  └────► failed       (classified error; message retryable, FR-039)
queued ─────────────► failed        (preflight or connection failure before the first byte)
```

- An answer with status `failed` keeps its user message and attachments. **Retry** creates a
  new answer version on the same user version.
- A send that fails *before* a chat exists (the very first message) creates no chat. The text
  and attachments stay in the new-chat draft, with the error shown above the box.

### ContextItem / AttachmentRef

| `kind` | `ref` | Stored as | Availability |
|---|---|---|---|
| `note` | `noteId` | a reference, plus a per-send snapshot file | `missing` if the note was deleted; the title is updated if it was renamed |
| `document` | `documentId` | a reference to the session PDF | `missing` if deleted |
| `recording` | `recordingId` | a reference to the session recording | `missing` if deleted |
| `upload` | `uploadId` | a file in `chats/<stem>.files/` | always available unless deleted outside the app |

- **Per item**: `{kind, ref, title, mime?, size?, pdfMode?: "document"|"text", addedAt}`.
  - `pdfMode` records the user's choice of extracted text for models without PDF support
    (FR-053).
- **Context membership**: items attached to a message join `chat.context` and stay until they
  are removed (FR-056). Each send includes every context item.
- **At most 10 attachments per message** (FR-055). The context list itself has no fixed cap:
  the size estimate governs it.

### AI Endpoint lifecycle

```text
(new form) ─Save─► enabled ⇄ disabled
                     │
                     └─Delete (confirm)─► removed: models cascade, the secret is deleted,
                                         chats keep model_label (FR-020)
```

- A chat whose model is gone, hidden or disabled shows `model_label` as text, and the model
  button asks the user to choose a model before the next send.

### Secret lifecycle

```text
absent ─set─► stored(encrypted) ─replace─► stored'   ─remove─► absent
                 │
                 └─master key lost / verifier fails─► unreadable ─user re-enters─► stored (new master key)
```

### Panel layout (browser localStorage, per browser — FR-009)

- `uh.sessionPanel` = `{open: bool, width: px, weights: {recordings: n, chat: n}, collapsed:
  {recordings: bool, chat: bool}}`.
  - Width is clamped to `[300, min(640, window/2)]`, keeping the main card ≥ 480 px.
- `uh.chat.panel.<sessionKey>` = `{chatId | null, view: "history" | "conversation"}`: which chat
  the panel shows.
- `uh.chat.scroll.<chatId>` = scroll offset, or `"bottom"`. Kept across moves between panel and
  tab, and across reloads.

## Validation summary (from the functional requirements)

- **FR-015/016**: base URL normalisation and the locality and https rules; enforced by the server
  on create, update, test and every request.
- **FR-019**: keys are write-only in the API. Responses carry `{configured, masked}`, where
  `masked` is `"••••" + last4` for keys of 8 or more characters and `"••••"` otherwise. A
  `PATCH` key field that is absent keeps the key, a string replaces it, and `null` removes it
  (the existing transcription semantics).
- **FR-031**: whitespace-only text is refused (422 `empty_message`) unless the message has at
  least one attachment. *(The spec says an empty message cannot be sent; attachments without
  text are allowed.)*
- **FR-055**: at most 10 attachments, and the per-style limits are checked after base64
  encoding.
- **FR-049**: no key, header or auth value is ever written to chat files. A test scans every
  chat file written during the test suite for the test keys.
