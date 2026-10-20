---

description: "Task list for 014 — AI Chat in Session and Event Workspaces"
---

# Tasks: AI Chat in Session and Event Workspaces

**Input**: Design documents from `/specs/014-session-ai-chat/`

**Prerequisites**:
- plan.md and spec.md (US1–US10, 5 clarifications)
- research.md (R1–R16) and data-model.md
- contracts/openapi.yaml, chat-stream.md, chat-file-format.md, provider-styles.md and
  ui-contract.md
- quickstart.md

**Tests**: Included. Constitution VI requires endpoint tests for success and the primary errors.
The contract coverage guard (`backend/tests/contract/test_coverage.py`,
`conftest.pytest_sessionfinish`) fails the full run unless every operation in
`specs/014-session-ai-chat/contracts/openapi.yaml` is implemented and hit with a 2xx. Validate
bodies with `backend/tests/contract/openapi_check.py` `check(body, "<Schema>", spec="014")`.

**Organization**: Phases follow the plan's implementation order. The secret store (US7) comes
first so that no AI key is ever stored in plaintext. Then come endpoints (US1), the panel (US2),
chat (US3, US4), Expand/Dock (US5), notes (US6), then P2 (US8, US9) and P3 (US10).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: the user story in spec.md (US1–US10).

## Conventions (apply to every task)

**Backend** (root `backend/src/unihelper/`):
- Models go in `models/` and are re-exported in `models/__init__.py` `__all__`, using the
  mixins `IdMixin` (uuid7), `TimestampMixin` and `VersionMixin` from `models/base.py`.
- Pydantic schemas go in `schemas/` and subclass `schemas/common.py` `ApiModel` (camelCase
  aliases, `from_attributes`).
- Logic goes in `services/`.
- Routers go in `api/v1/` and are registered in the `main.build_api_router()` module tuple.
- Use `api/deps.py` (`DbSession`, `CurrentUser`, `IfMatch` + `check_version` → 412
  `version_conflict`, 428 when missing) and `api/errors.py` (`ApiError(status, code, title,
  detail=None, errors=None, extra=None)`, `not_found`, `validation_error`).
- Every query filters on `user.id`.
- Files are touched **only** through `storage/storage_service.py` (`path_for`,
  `write_text_atomic`, `rename_dir`, `delete_content_file`).
- Log lines never contain keys, provider bodies or note text.

**Backend tests**:
- `backend/tests/{unit,contract,integration}/`.
- Fixtures from `tests/conftest.py`: `owner_client`, `make_member`, `tmp_data_dir`.
- `create_app(Settings(..., transcription_autorun=False))`.
- Every test sets `UNIHELPER_KEY_STORE=file` and `UNIHELPER_KEY_FILE=<tmp_path>/keys/master.key`
  through a conftest fixture added in T010.
- Provider HTTP goes to `tests/fake_llm.py` through `httpx.ASGITransport` (the same injection
  pattern as `worker.transport`).

**Frontend** (root `frontend/src/`):
- The API is called with `lib/api` `apiFetch<T>(path, {method, body, version, query, signal,
  keepalive})`. Types are `Schemas[...]` from `lib/api/schema.d.ts`; regenerate it with
  `cd backend && uv run python -m unihelper.export_openapi ../frontend/openapi.json && cd
  ../frontend && pnpm gen:api` after backend schema changes.
- Use TanStack Query; `sonner` `toast(..., {duration: 10_000, action: {label: "Undo",
  onClick}})`; `lib/storage.ts` `readLocal`/`writeLocal`; and `lib/shortcuts.ts`
  `isTypingTarget`/`hasModifier`.
- Use shadcn primitives from `components/ui/` and Phosphor icons.
- Colours come only from theme tokens, with `motion-reduce:` variants.

**Frontend tests**:
- Vitest in `frontend/tests/unit/`, using `test-utils.tsx` `mockFetch`, `on`, `json`,
  `problem`, `renderWithProviders`, and `vitest-axe`.
- Playwright in `frontend/tests/e2e/`, using `helpers.ts` (`signIn`, `seedClass`,
  `newHierarchy`), `layout-helpers.ts` and `@axe-core/playwright`, on the chromium-light and
  chromium-dark projects.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the governance prerequisite, dependencies and test infrastructure.

- [X] T000 **Blocking prerequisite**: run `/speckit-constitution` to amend `.specify/memory/constitution.md` to v1.3.0 (MINOR). Two changes:
  - Principle II: add `.../<class-date>/chats/` (and the event equivalent) to the hierarchy, naming each chat's open formats as a JSON file plus a regenerated Markdown transcript, with uploads in their original formats under `<stem>.files/`.
  - Principle IV: state that it applies to all provider secrets (transcription and AI endpoints).

  Include the Sync Impact Report. Implementation of Phase 2 and later MUST NOT start before this is ratified (plan.md, Constitution Check).
- [X] T001 [P] Add `design/reference/vscode-chat-sessions.png`, the visual reference named in the spec. Ask the user for the image if it is missing. Record in `design/reference/README.md` what it is used for: the history list and the message box.
- [X] T002 [P] Add the backend dependencies to `backend/pyproject.toml` `[project].dependencies`: `cryptography>=50.0.2,<51`, `keyring>=25.7.0,<26`, `platformdirs>=4.13.5,<5`, and `pypdf` pinned to an exact 6.x release at least 14 days old. Add `[[tool.mypy.overrides]]` entries for `keyring.*` and `pypdf.*` if they ship without types. Run `uv lock`.
- [X] T003 [P] Add the frontend dependencies, pinned exactly in `frontend/package.json` `dependencies`: `"react-markdown": "10.1.0"` and `"remark-gfm": "4.0.1"`. Run `pnpm install`, which updates `frontend/pnpm-lock.yaml`.
- [X] T004 [P] Create `backend/tests/fake_llm.py`, an ASGI (FastAPI) app that speaks all three styles as defined in `specs/014-session-ai-chat/contracts/provider-styles.md`.
  - **Routes**:
    - OpenAI: `GET /v1/models` and `POST /v1/chat/completions`.
    - Anthropic: `GET /anthropic/v1/models` and `POST /anthropic/v1/messages` (needs `x-api-key` and `anthropic-version`).
    - Gemini: `GET /gemini/v1beta/models` and `POST /gemini/v1beta/models/{model}:streamGenerateContent`.
  - **Scripted models**, chosen by model id:
    - `echo` streams back the last user text in 3 chunks.
    - `slow` sends one token every 100 ms for 200 tokens.
    - `fail-401`, `fail-404`, `fail-413`, `fail-429` (`retry-after: 7`, or Gemini `RetryInfo` `7s`), and `fail-midstream` (an Anthropic `event: error` `overloaded_error`).
    - `wrong-style` answers with another style's models shape.
    - `big-usage` reports usage.
  - **Recording**: it records the last request body, and whether the client disconnected before the end, in a module-level `STATE` dict with a `reset()` function.
  - Add a `__main__` so Playwright can run it as `uv run uvicorn tests.fake_llm:app --port 8021`.
- [X] T005 [P] Add a `fake_llm` webServer (port 8021, `cwd: ../backend`) to `frontend/playwright.config.ts`. Add `UNIHELPER_KEY_STORE=file` and `UNIHELPER_KEY_FILE=../data-e2e-keys/master.key` to the backend webServer's env. Add `data-e2e-keys/` to `.gitignore`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the schema, models, configuration and router skeletons every story uses.

**⚠️ No user story work can begin until this phase is complete.**

- [X] T006 Create migration `backend/src/unihelper/db/migrations/versions/0013_ai_chat.py` (`revision="0013"`, `down_revision="0012"`, batch ops for SQLite), with tables exactly as in `specs/014-session-ai-chat/data-model.md`:
  - **`secret_store_meta`**:
    - `id int PK` (always 1)
    - `installation_id str(36) NOT NULL`
    - `verifier_nonce blob NULL`, `verifier_ct blob NULL`
    - `store_kind str(20) NULL`
    - `migration_state str(20) NOT NULL default 'pending'`
    - `migration_error str(200) NULL`
    - `rotated_at str NULL`
  - **`secrets`**:
    - `id`, `user_id FK users ON DELETE CASCADE`
    - `owner_kind str(30) NOT NULL`, `owner_id str(64) NOT NULL`
    - `nonce blob NOT NULL`, `ciphertext blob NOT NULL`
    - timestamps
    - `UniqueConstraint(user_id, owner_kind, owner_id)`
  - **`ai_endpoints`**:
    - `id`, `user_id FK CASCADE`
    - `name str(60) NOT NULL`, `name_key str(60) NOT NULL`
    - `style str(20) NOT NULL`, `base_url str(2048) NOT NULL`, `locality str(10) NOT NULL`
    - `enabled bool NOT NULL default true`
    - `secret_id FK secrets ON DELETE SET NULL NULL`
    - `privacy_ack_at str NULL`
    - timestamps, `version`
    - `UniqueConstraint(user_id, name_key)`
  - **`ai_models`**:
    - `id`, `user_id FK CASCADE`
    - `endpoint_id FK ai_endpoints ON DELETE CASCADE`
    - `model_id str(200) NOT NULL`, `display_name str(80) NOT NULL`
    - `cap_images bool`, `cap_pdf bool`, `cap_audio bool`
    - `hidden bool NOT NULL default false`
    - `source str(10) NOT NULL`
    - `context_limit int NULL`, `output_limit int NULL`
    - `position int NOT NULL`
    - `UniqueConstraint(endpoint_id, model_id)`
  - **`ai_settings`**:
    - `user_id PK FK CASCADE`
    - `custom_instructions text NOT NULL default ''`
    - `last_model_id FK ai_models ON DELETE SET NULL NULL`
    - `version`
  - **`chats`**:
    - `id`, `user_id FK CASCADE`
    - `session_folder_id FK session_folders ON DELETE CASCADE NOT NULL`
    - `stem str(120) NOT NULL`, `title str(200) NOT NULL`
    - `model_ref_id FK ai_models ON DELETE SET NULL NULL`
    - `model_label str(200) NOT NULL default ''`
    - `message_count int NOT NULL default 0`
    - `generating bool NOT NULL default false`, `unseen_answer bool NOT NULL default false`
    - `file_hash str(64) NULL`
    - `deleted_at str NULL`
    - timestamps, `version`
    - `UniqueConstraint(session_folder_id, stem)`
    - index `ix_chats_folder_updated(session_folder_id, updated_at)`
  - **`chat_runs`**:
    - `id`, `user_id FK CASCADE`
    - `chat_id FK chats ON DELETE CASCADE`
    - `answer_id str(64) NOT NULL`
    - `status str(20) NOT NULL`
    - `started_at str NOT NULL`, `ended_at str NULL`
    - `error_category str(30) NULL`
  - **`chat_drafts`**:
    - `user_id FK CASCADE`
    - `lineage_id str NOT NULL`, `original_date str NOT NULL`
    - `chat_key str(64) NOT NULL default ''` (empty means the new-chat box)
    - `text text NOT NULL default ''`
    - `attachments_json text NOT NULL default '[]'`
    - `updated_at`
    - PK `(user_id, lineage_id, original_date, chat_key)`
  - **`chat_uploads`**:
    - `id`, `user_id FK CASCADE`
    - `session_folder_id FK session_folders ON DELETE CASCADE`
    - `kind str(10) NOT NULL`, `mime str(100) NOT NULL`, `size int NOT NULL`
    - `original_name str(255) NOT NULL`, `sha256 str(64) NOT NULL`
    - `rel_path str(500) NOT NULL`
    - `chat_id FK chats ON DELETE CASCADE NULL`
    - `created_at`
  - **`transcription_provider_configs`**: add `secret_id FK secrets ON DELETE SET NULL NULL`.

  The downgrade reverses all of this.
- [X] T007 [P] Write `backend/tests/integration/test_migration_0013.py`, following `test_migration_0012.py`:
  - Upgrading from 0012 creates every table, constraint and index of T006, and adds `transcription_provider_configs.secret_id`.
  - Existing rows, including plaintext `secret` values, are untouched by the Alembic step.
  - Downgrade removes everything.
- [X] T008 [P] Create the models. Each file holds the fields of T006 and is exported in `backend/src/unihelper/models/__init__.py`:
  - `backend/src/unihelper/models/secret.py`: `SecretStoreMeta`, `Secret`.
  - `backend/src/unihelper/models/ai_endpoint.py`: `AiEndpoint` with `models` relationship ordered by `position`, cascade delete-orphan.
  - `backend/src/unihelper/models/ai_model.py`: `AiModel`.
  - `backend/src/unihelper/models/ai_settings.py`: `AiSettings`.
  - `backend/src/unihelper/models/chat.py`: `Chat`, `ChatRun`, `ChatDraft`, `ChatUpload`.

  Also add `secret_id` to `ProviderConfig` in `backend/src/unihelper/models/transcription.py`.
- [X] T009 Extend `backend/src/unihelper/config.py` `Settings` with these fields:
  - `key_store: Literal["auto","keyring","file"]`, from env `UNIHELPER_KEY_STORE`, default `"auto"`.
  - `key_file: Path | None`, from env `UNIHELPER_KEY_FILE`, default `platformdirs.user_config_dir("UniHelperProMax")/master-<installation_id>.key`, resolved at runtime.
  - `chat_max_runs_per_user: int = 4` and `chat_max_runs_total: int = 8`.
  - `ai_transport: httpx.AsyncBaseTransport | None = None`, excluded from repr and used by tests.

  `Settings.validate()` raises a clear startup error `"UNIHELPER_KEY_FILE must not be inside the data folder"` when the resolved key file is under `data_dir`.
- [X] T010 [P] Add an autouse fixture to `backend/tests/conftest.py` that sets `UNIHELPER_KEY_STORE=file` and `UNIHELPER_KEY_FILE=tmp_path/"keys"/"master.key"`, outside `tmp_data_dir`. Add an `ai_transport` fixture that sets `app.state.settings.ai_transport = httpx.ASGITransport(app=fake_llm.app)` and calls `fake_llm.reset()`.
- [X] T011 [P] Create the empty router modules, tags `["ai"]`, `["chat"]` and `["ai"]`, and register them in `backend/src/unihelper/main.py` `build_api_router()`:
  - `backend/src/unihelper/api/v1/secrets.py` (prefix `/secrets`)
  - `backend/src/unihelper/api/v1/ai.py` (prefix `/ai`)
  - `backend/src/unihelper/api/v1/chats.py` (routers for `/sessions/{session_key}/chats`, `/sessions/{session_key}/chat-uploads`, `/sessions/{session_key}/chat-drafts`, `/chats`, `/chat-files`)
  - `backend/src/unihelper/api/v1/chat_runs.py` (prefix `/chat-runs`)
- [X] T012 [P] Create the schema skeletons `backend/src/unihelper/schemas/ai.py` and `backend/src/unihelper/schemas/chat.py`. Define every component of `specs/014-session-ai-chat/contracts/openapi.yaml` (`SecretState`, `SecretStoreStatus`, `AiStyle`, `Limits`, `Capabilities`, `BaseUrlCheck`, `BaseUrlResult`, `AiModel`, `AiModelInput`, `AiEndpoint`, `AiEndpointCreate`, `AiEndpointUpdate`, `AiEndpointTest`, `AiTestResult`, `AiDiscoverResult`, `AiSettings`, `AiSettingsUpdate`, `ModelRef`, `ContextItemRef`, `ContextItem`, `SendMessage`, `SendResult`, `ChatSummary`, `Usage`, `AnswerError`, `Answer`, `UserVersion`, `Turn`, `Chat`, `ChatUpdate`, `ChatDraft`, `ChatUpload`, `PreflightRequest`, `PreflightItem`, `PreflightResult`, `ChatRun`, `AppendResult`, `NoteSearchHit`) with these constraints copied verbatim:
  - `name` minLength 1, maxLength 60
  - `baseUrl` maxLength 2048
  - `apiKey` maxLength 4096
  - `modelId` 1–200 and `displayName` 1–80
  - `customInstructions` maxLength 8000
  - `text` maxLength 100000
  - `attachments` maxItems 10
  - `title` 1–200
  - `newNoteTitle` 1–120
  - `Style` enum `[openai, anthropic, gemini]` and `Locality` enum `[local, remote]`

  `AiEndpointUpdate.apiKey` must distinguish absent from null using `model_fields_set`, as `schemas/settings.py` does.
- [X] T013 [P] Add `"chat"` to the `TabRef.kind` literal in `backend/src/unihelper/schemas/notes.py`, and make sure the `workspace_service` validation accepts it. Extend `backend/tests/contract/test_workspace.py` (or its existing equivalent) with a round trip of a chat tab.

**Checkpoint**: the migration applies, the app starts, and the empty routers are mounted.

---

## Phase 3: User Story 7 — Keys are protected at rest (Priority: P1)

**Goal**: one encrypted secret store (AES-256-GCM, with the master key in the OS key store or a user-only key file outside the data folder), with transcription keys migrated automatically.

**Independent Test**: save a transcription key, restart, and confirm that the plaintext column is NULL, transcription still works, and a copy of the SQLite file plus the data folder contains no key bytes. Corrupt the key file and confirm `GET /secrets/status` reports `readable:false` and that reset keeps notes and recordings.

### Tests for User Story 7

- [X] T014 [P] [US7] Write unit tests `backend/tests/unit/test_secret_store.py`:
  - Round trip with AES-256-GCM.
  - A fresh 12-byte nonce on every encryption.
  - Associated data binding: a ciphertext copied to another `(user, owner_kind, owner_id)` fails to decrypt.
  - The verifier detects a wrong master key.
  - Masking: `"••••"+last4` for keys of 8 or more characters, `"••••"` for shorter keys, `None` when absent.
  - `use()` yields plaintext only inside the context, and `repr()` of the store and its rows contains no plaintext.
- [X] T015 [P] [US7] Write unit tests `backend/tests/unit/test_master_key.py`:
  - The keyring backend is used when `keyring.get_keyring()` is usable. Mock it with an in-memory backend; the write/read/delete probe must succeed.
  - The fallback to the key file when the backend is `fail`/`null` or its priority is ≤ 0.
  - The key file is created with mode 0600 on POSIX, using `O_CREAT|O_EXCL`.
  - `UNIHELPER_KEY_STORE=file` forces the file.
  - A key file under `data_dir` is refused.
  - The installation id names the keyring account `master-key:{installation_id}`.
- [X] T016 [P] [US7] Write integration test `backend/tests/integration/test_secrets_migration.py`:
  - Seed plaintext `ProviderConfig.secret` rows for two users and start the app. Every row gets `secret_id`, `secret` becomes NULL, `migration_state='done'`, and a transcription job against `fake_transcriber` authenticates with the migrated key.
  - Monkeypatch encryption to fail on the second row. Nothing changes: the plaintext stays, `secret_id` stays NULL, `migration_state='failed'`, the status message is shown, and the next startup retries and succeeds.
- [X] T017 [P] [US7] Write integration test `backend/tests/integration/test_secrets_at_rest.py`:
  - After saving a transcription key and an AI endpoint key, byte-scan `unihelper.sqlite3`, its `-wal`, and every file under `tmp_data_dir`. Neither key appears in plaintext, base64 or hex.
  - Delete the key file and restart. `GET /secrets/status` gives `readable:false` with `unreadableSecrets:2`, the masked state is `readable:false`, notes and recordings still load, and `POST /secrets/reset {confirm:true}` gives `readable:true` with the unreadable secrets removed and no other rows touched.
- [X] T018 [P] [US7] Write contract tests `backend/tests/contract/test_secrets.py`:
  - `GET /secrets/status` with each `store` value; validate with `check(body, "SecretStoreStatus", spec="014")`.
  - `POST /secrets/reset` returns 200 when the store is unreadable and 409 `store_readable` otherwise.
  - A member gets 403 `forbidden` on reset (the store is installation-wide).

### Implementation for User Story 7

- [X] T019 [US7] Implement `backend/src/unihelper/secrets/master_key.py`:
  - `load_or_create(settings, db) -> MasterKey(kind, key: bytes)`.
  - Creates the `secret_store_meta` row with a uuid4 `installation_id` on first run.
  - In `auto` mode it tries `keyring` (service `UniHelperProMax`, account `master-key:{installation_id}`, value = 32 random bytes as base64url) after the usability probe of research R7. Otherwise it uses the key file: `platformdirs.user_config_dir("UniHelperProMax")`, or `settings.key_file`, created with `os.open(..., O_CREAT|O_EXCL|O_WRONLY, 0o600)`.
  - Never logs the key.
  - Records `store_kind`.
- [X] T020 [US7] Implement `backend/src/unihelper/secrets/store.py` `SecretStore`:
  - `put(db, user_id, owner_kind, owner_id, plaintext) -> secret_id`, `remove(...)`, `state(...) -> SecretState`, and `use(...)`, a context manager that yields plaintext.
  - `status(db) -> SecretStoreStatus`, including `protectionNote` = "Keys are encrypted, but the encryption key is kept in a file in your user profile. Anyone who can sign in to this computer as you can read your keys." when the store is `key_file`.
  - `reset(db)`.
  - Use AES-256-GCM with associated data `uh-secret-v1|{user_id}|{owner_kind}|{owner_id}`, and a verifier over the constant `uh-verifier`.
  - Raise `KeyUnreadable` when the verifier fails.
  - Store one instance on `app.state.secrets`.
- [X] T021 [US7] Implement `backend/src/unihelper/secrets/migrate.py` `migrate_plaintext(db, store)`:
  - In one `BEGIN IMMEDIATE` transaction it encrypts every non-null `ProviderConfig.secret`, sets `secret_id`, decrypts the result to check it, sets `secret=NULL`, sets `migration_state='done'` and commits.
  - On any exception it rolls back, stores `migration_state='failed'` with a fixed category in `migration_error` (never a value), and logs only the exception type.
  - It is idempotent.
- [X] T022 [US7] Wire the startup in the `backend/src/unihelper/main.py` lifespan: after `upgrade_to_head`, call `master_key.load_or_create` → `SecretStore` → `migrate_plaintext`. A `KeyUnreadable` error doesn't stop startup; status reports it. Startup still fails on the T009 data-folder check.
- [X] T023 [US7] Route transcription keys through the store:
  - In `backend/src/unihelper/services/transcription_settings_service.py`, `save()` calls `store.put`/`remove` with `owner_kind="transcription_provider"` and `owner_id=provider_id`, and the masked state uses `store.state` (adding `readable`).
  - `backend/src/unihelper/transcription/config.py` `read_secret()` uses `store.use()`, falling back to the plaintext column only when `migration_state != 'done'`.
  - The existing transcription tests must pass unchanged.
- [X] T024 [US7] Implement `backend/src/unihelper/api/v1/secrets.py`:
  - `GET /secrets/status`.
  - `POST /secrets/reset`: owner only; body `{confirm: true}`; 409 `store_readable` when readable.
  - Add the `readable` field to the transcription secret state in `backend/src/unihelper/schemas/settings.py`.
- [X] T025 [P] [US7] Add a `unihelper-keys` named volume mounted at `/keys` to `docker-compose.yml`, with env `UNIHELPER_KEY_STORE=file` and `UNIHELPER_KEY_FILE=/keys/master.key`. Add a "Key protection" section to `README.md`: the OS key store vs. the key file, backing up `/keys` separately from `/data`, what happens on restore to another machine, and the macOS Keychain prompt.
- [X] T026 [P] [US7] Create `frontend/src/features/settings/KeyProtectionNotice.tsx`, which reads `GET /secrets/status` (`useQuery(["secrets-status"])`):
  - For `key_file`, an inline notice with `protectionNote`.
  - When unreadable, a `role="alert"` banner: "Saved keys can't be read on this computer. Enter them again." with an AlertDialog-confirmed "Start a new key store" button that calls reset.
  - When migration failed, a warning with `migrationMessage`.

  Render it at the top of `frontend/src/features/settings/transcription/TranscriptionSettings.tsx`. Add `frontend/tests/unit/key-protection-notice.test.tsx` covering the three states and axe.

**Checkpoint**: transcription keys are encrypted at rest, and all existing transcription tests pass (SC-006, SC-010).

---

## Phase 4: User Story 1 — Configure an AI endpoint (Priority: P1)

**Goal**: Settings → AI lets the user add, edit, test, refresh models, enable or disable, and delete endpoints in the three styles, with keys in the secret store.

**Independent Test**: add a local OpenAI-compatible endpoint (`http://localhost:8021/v1/chat/completions/`, no key) and a remote Anthropic endpoint with a key. Test both, refresh, and save. Check that the base URL was normalised, the Local/Remote labels, the masked key, that https is refused for Remote, and that Test never saves anything.

### Tests for User Story 1

- [X] T027 [P] [US1] Write unit tests `backend/tests/unit/test_ai_addresses.py` for `normalize(style, url)`:
  - Trailing slash.
  - Removing `/chat/completions`, `/models`, `/v1/messages`, `/v1/models`, `/v1beta/models/x:streamGenerateContent?alt=sse` and query strings, with `removedPath` reported.
  - Lower-casing the scheme and host.
  - An invalid URL gives `invalid_url`.

  And for `locality(url)`: `localhost`, `*.localhost`, `*.local`, `host.docker.internal`, single-label names, 127/8, ::1, 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, fe80::/10 and fc00::/7 are `local`; `example.com` and `8.8.8.8` are `remote`; no DNS lookup is made (assert `socket.getaddrinfo` is not called). And `https_required`: a remote address over http is refused.
- [X] T028 [P] [US1] Write unit tests `backend/tests/unit/test_ai_adapters_models.py`, using `fake_llm` and recorded JSON fixtures in `backend/tests/fixtures/ai/`:
  - `list_models` per style, including Anthropic pagination via `after_id` and Gemini `pageToken` with the `generateContent` filter, stripping `models/`, and reading `max_input_tokens`/`inputTokenLimit` into `context_limit`.
  - `probe()` for the typed model.
  - Style detection (`not_this_style` with `looksLike`).
- [X] T029 [P] [US1] Write unit tests `backend/tests/unit/test_ai_errors.py`: classification of each shape in `contracts/provider-styles.md` (Errors rows) into `key_rejected`, `model_not_found`, `too_large`, `rate_limited` with `retryAfterSeconds` from the `retry-after` header or Gemini `RetryInfo`, `context_exceeded`, `network`, `timeout`, `provider` and `not_this_style`. Also message scrubbing: the endpoint's key, `sk-…`, `AIza…` and 32+ base64url character tokens are replaced with `[redacted]`, and the message is cut to 500 characters.
- [X] T030 [P] [US1] Write contract tests `backend/tests/contract/test_ai.py` covering every `/ai/*` operation:
  - `GET /ai/styles`.
  - `POST /ai/base-url/check`: 200, and 422 for `invalid_url` and `https_required`.
  - `GET`/`POST /ai/endpoints`: 201, 409 `name_taken` (case-insensitive), 422 validation.
  - `GET`/`PATCH`/`DELETE /ai/endpoints/{id}`: 428 without If-Match, 412 when stale; on PATCH, an absent `apiKey` keeps the key, a string replaces it and `null` removes it.
  - `POST /ai/endpoints/test`, with every `outcome` driven by the `fake_llm` models; assert the database is unchanged afterwards.
  - `POST /ai/endpoints/models/discover`, which saves nothing.
  - `POST /ai/endpoints/{id}/privacy-ack`.
  - `GET`/`PUT /ai/settings`.
  - Another user's endpoint gives 404.
  - Assert no response body contains the full key.
- [X] T031 [P] [US1] Write a key-leak test `backend/tests/integration/test_ai_key_never_leaks.py`. With `caplog` at DEBUG, create, test, discover and patch endpoints using key `sk-test-LEAKCHECK-1234567890`, including a failing test against `fail-401` whose body echoes the key. Assert that the key string never appears in any log record, response body or file under `tmp_data_dir`.

### Implementation for User Story 1

- [X] T032 [P] [US1] Implement `backend/src/unihelper/domain/ai_addresses.py` with `normalize`, `locality` and `require_secure` per research R5. Move `LOCALHOST_HINT` and `_loopback` from `services/transcription_settings_service.py` into `backend/src/unihelper/domain/addresses.py`, and import them from both places, leaving transcription behaviour unchanged.
- [X] T033 [P] [US1] Implement `backend/src/unihelper/ai/base.py`:
  - The `ChatAdapter` Protocol: `list_models`, `probe`, `stream`, `classify`.
  - Neutral types: `ChatRequest(system: str | None, messages: list[NeutralMessage], model_id, max_tokens)`, `NeutralMessage(role, parts)`, and parts `Text`, `Image(mime, data)`, `Pdf(name, data)`, `PdfText(name, text)`, `Audio(mime, data, format)`, `NoteText(title, text)`.
  - Stream events `Delta(text)`, `UsageEvent(input, output, total)`, `End(finish_reason)`.
  - `EndpointConfig(style, base_url, locality, api_key: str | None = field(repr=False))`.
  - `AiError(category, message, retry_after_seconds=None, looks_like=None)`.
- [X] T034 [P] [US1] Implement `backend/src/unihelper/ai/sse.py`, an incremental parser of server-sent events over `httpx.Response.aiter_lines()` yielding `(event, data)`. It handles multi-line `data:`, comments, `\r\n`, and a missing final blank line. Add unit tests `backend/tests/unit/test_ai_sse.py`.
- [X] T035 [P] [US1] Implement `backend/src/unihelper/ai/errors.py`, the classifier and scrubber described in T029, using httpx exceptions for `network`/`timeout` and the local hint from `domain/addresses.py`.
- [X] T036 [P] [US1] Implement `backend/src/unihelper/ai/limits.py`, with per-style `Limits` constants exactly as in the research R9 table (OpenAI: image 20 MB, pdf 50 MB, audio 25 MB, per message 50 MB; Anthropic: image 7.5 MB raw, pdf 32 MB, request 32 MB, 100 images, 100 PDF pages or 600 for context ≥ 1M; Gemini: 20 MB per file and per message, 1,000 PDF pages), plus `MAX_ATTACHMENTS = 10` and `MAX_UPLOAD = 25 MB`. Also implement `backend/src/unihelper/ai/styles.py`, the style registry: label, `exampleBaseUrls`, `chatPath`, `modelsPath`, `keyHeader`, `defaultCapabilities` (openai {images}, anthropic {images, pdf}, gemini {images, pdf, audio}) and `limits`.
- [X] T037 [US1] Implement the adapters' model listing and probe in `backend/src/unihelper/ai/openai_compat.py`, `backend/src/unihelper/ai/anthropic.py` and `backend/src/unihelper/ai/gemini.py`, following `contracts/provider-styles.md`:
  - Headers per style. The `Authorization` header is left out when there is no key.
  - `require_secure` is called before any key header is attached.
  - Timeouts: connect 10 s, read 120 s. No redirects when a key is present.
  - The client is created with `transport=settings.ai_transport` when it is set.
- [X] T038 [US1] Implement `backend/src/unihelper/services/ai_endpoint_service.py`:
  - `list`, `get`, `create`, `update`, `delete`, `test`, `discover`, `ack_privacy`.
  - Names are trimmed and unique by `name_key` (casefold).
  - `locality` is derived on every save.
  - Keys go through `SecretStore` with `owner_kind="ai_endpoint"`.
  - On create, models get the style's default capabilities; Anthropic `cap_audio` is forced false.
  - `models` are replaced as a set, keeping ids by `id`.
  - `test`/`discover` accept `useSavedKeyOf`, have a 15 s budget (`asyncio.wait_for`) and **never write**.
  - `delete` stops the endpoint's active runs (hook for T071/T073), sets chats' `model_label`, and removes the secret.

  Also implement `backend/src/unihelper/services/ai_settings_service.py` (`get`, `put` for custom instructions ≤ 8,000 characters, and `set_last_model`).
- [X] T039 [US1] Implement the routes in `backend/src/unihelper/api/v1/ai.py` exactly per `contracts/openapi.yaml`: `/ai/styles`, `/ai/base-url/check`, `/ai/endpoints` (GET, POST), `/ai/endpoints/test`, `/ai/endpoints/models/discover`, `/ai/endpoints/{endpointId}` (GET, PATCH, DELETE with If-Match), `/ai/endpoints/{endpointId}/privacy-ack`, and `/ai/settings` (GET, PUT with If-Match).
- [X] T040 [US1] Regenerate `frontend/openapi.json` and `frontend/src/lib/api/schema.d.ts`. Then create `frontend/src/features/settings/ai/api.ts`, with query keys `["ai-endpoints"]`, `["ai-styles"]` and `["ai-settings"]`, mutations for create, update (with `version`), delete, test, discover, base-url check and privacy-ack, and settings get/put.
- [X] T041 [P] [US1] Extract the masked-key control from `frontend/src/features/settings/transcription/TranscriptionSettings.tsx` into `frontend/src/features/settings/KeyField.tsx`:
  - It shows `masked`, with Replace and Remove.
  - Remove shows "The saved key will be removed when you save." with Undo.
  - Replace has "Keep saved key".
  - When `readable:false` it shows "Key can't be read — enter it again".

  Use it in both settings pages. `frontend/tests/unit/transcription-settings.test.tsx` must stay green.
- [X] T042 [US1] Create `frontend/src/features/settings/ai/EndpointForm.tsx`:
  - Fields: Name, and Style as a `RadioGroup` of the three styles from `/ai/styles` with example URLs as hints.
  - Base URL, with a debounced (300 ms) `/ai/base-url/check` showing "Removed <path> — the app adds it", the Local/Remote badge, and the https error inline.
  - `KeyField`, labelled "optional for local endpoints".
  - "Test connection", with the result in a `role="status"` region showing the outcome sentence and the hint.
  - Any field edit clears the test result.
  - Server field errors are mapped from JSON pointers, as in the transcription form.
- [X] T043 [US1] Create `frontend/src/features/settings/ai/ModelList.tsx`:
  - "Refresh" (discover) merges the candidates into the form state without saving, and "Add model ID" adds a manual model by its exact identifier.
  - Each row has: display name input, Switches for Images, PDF documents and Audio (Audio disabled with the reason "Anthropic doesn't accept audio" for that style), Hide, Remove, and an optional Context limit number input.
  - Everything stays local until Save.
- [X] T044 [US1] Create `frontend/src/features/settings/ai/AiSettings.tsx`:
  - At the top, `KeyProtectionNotice`.
  - An endpoint list with rows showing name, style, Local/Remote, an enabled `Switch` (PATCH with `version`), Edit, and Delete. Delete opens an `AlertDialog` that names the endpoint and says "Chats that used it keep their history."
  - "Add endpoint" opens `EndpointForm` with `ModelList`.
  - Below the list, the "Custom instructions" textarea (maxLength 8000, with a counter) and Save. That control belongs to US10 (T124); until then, render it disabled with a TODO.
  - Add the route and the `SECTIONS` entry "AI" after "Transcription" in `frontend/src/features/settings/routes.tsx` and `frontend/src/features/settings/SettingsLayout.tsx`.
- [X] T045 [P] [US1] Write Vitest `frontend/tests/unit/ai-settings.test.tsx`:
  - The empty list, add, the URL normalisation notice, the https error, and Test outcomes rendered distinctly.
  - Key Remove → Undo, a disabled Anthropic audio switch, and the delete confirmation text.
  - axe has no violations.
- [X] T046 [US1] Write Playwright `frontend/tests/e2e/settings-ai.spec.ts` against `fake_llm` on :8021:
  - Add a local endpoint with a pasted full path, Test → Working, Refresh → `echo`/`slow`, Save.
  - Remote `http://example.com` is refused.
  - A wrong key against the Anthropic fake gives "key rejected".
  - Disable and enable, delete with confirmation.
  - axe passes in light and dark.

**Checkpoint**: endpoints can be configured; no chat yet.

---

## Phase 5: User Story 2 — The session panel with Recordings, Chat and a rail (Priority: P1)

**Goal**: the right card becomes a two-section session panel that closes to a 44 px rail with indicators. Recording behaviour is unchanged.

**Independent Test**: collapse and expand each section; drag and keyboard-move the boundary; resize between 300 and 640 px; close with Alt+]; reopen through the rail's Chat icon; record while the panel is closed and see the indicator; reload and see the same layout; at 1000 px width the panel starts closed; focus mode keeps the pills.

### Tests for User Story 2

- [X] T047 [P] [US2] Update `frontend/tests/unit/layout-widths.test.ts` for the new right limits:
  - `RIGHT_MIN=300`, `RIGHT_DEFAULT=360`, `RIGHT_MAX=640`.
  - The cap `≤ innerWidth/2`.
  - The main card keeps ≥ 480 px.
  - A right rail width of 44 when closed.
  - If 300 px doesn't fit, the panel closes to its rail.
- [X] T048 [P] [US2] Write Vitest `frontend/tests/unit/session-panel.test.tsx`:
  - Collapsing Recordings makes Chat fill, and vice versa.
  - Boundary keys ↑/↓ change by 5%, Home/End, Enter resets to 50/50.
  - The `uh.sessionPanel` round trip.
  - Seeding from the `workspaceRightCollapsed` preference when no local value exists.
  - The close button sits in the Recordings header.
- [X] T049 [P] [US2] Write Vitest `frontend/tests/unit/side-rail.test.tsx`:
  - Rail items render with their accessible names, plus the suffixes ", recording in progress", ", transcription running", ", answer being generated" and ", new answer".
  - Each indicator has a non-colour shape.
  - Activating Chat calls `onActivate("chat")`.
  - Reduced motion stops animation but keeps the indicator.

  Update `frontend/tests/unit/audio-reopen.test.tsx`, replacing it with a test that the tab-row reopen button is gone.
- [X] T050 [US2] Update Playwright helpers `frontend/tests/e2e/layout-helpers.ts`: `audioCard` → `sessionPanel` (complementary "Session panel"), and add `sessionRail`. Update the existing specs that use it (`layout.spec.ts`, `responsive.spec.ts`, `recording.spec.ts`, `transcription.spec.ts`, `side-panel.spec.ts`, `workspace-switch.spec.ts`) only where they reference the old card name or the tab-row reopen button. Their assertions about recording behaviour must not change.

### Implementation for User Story 2

- [X] T051 [US2] Update `frontend/src/app/shell/widths.ts`:
  - `RIGHT_MIN=300`, `RIGHT_DEFAULT=360`, `RIGHT_MAX=640`.
  - The right rail width `RIGHT_RAIL_W=44`.
  - `layoutWidths()` caps the right width at `floor(innerWidth/2)`, keeps `MAIN_MIN=480`, and reports `rightRail: true` when the panel is closed (or doesn't fit) in a session workspace.
- [X] T052 [US2] Create `frontend/src/app/shell/SideRail.tsx`, generalising `frontend/src/features/home/PanelRail.tsx`:
  - Props: `side: "left"|"right"`, `label`, `reopen: {label, shortcut, onActivate}`, and `items: {id, icon, name, indicator?: "recording"|"running"|"unseen", onActivate}[]`.
  - Indicator shapes: a pulsing dot, a spinner and a filled dot, with `motion-reduce:animate-none`.
  - Port `features/home/PanelRail.tsx` to use it, keeping `frontend/tests/unit/usePanels.test.ts` and `home-panels.spec.ts` green.
- [X] T053 [US2] Update `frontend/src/app/shell/layout.tsx` and `frontend/src/app/shell/AppShell.tsx`:
  - `RIGHT_CARD_ID` becomes `"workspace-session-panel"`.
  - When a page registers a right card with `rail: RailSpec` and the card is closed (docked mode), render `<SideRail side="right">` in the right column at `RIGHT_RAIL_W`.
  - `moveFocusAfterClose` focuses "Show session panel".
  - Focus mode hides the rail.
  - Below 1100 px the right card starts closed and the rail stays visible. Opening it uses the existing overlay `Sheet` when docking would break the main-card minimum.
- [X] T054 [US2] Create `frontend/src/features/sessions/SessionPanel.tsx`:
  - Two `CollapsibleSection`s (from `frontend/src/app/shell/panelSection.tsx`): "Recordings" holds the existing `RightPanel` content from `useWorkspacePanels()`; "Chat" holds a slot filled by `features/chat` (T084), and until then an empty placeholder.
  - A weighted boundary using `PanelResizeHandle`, with `grow="up"`, as in `frontend/src/app/shell/LeftCard.tsx`. It is labelled "Resize Recordings and Chat", with `aria-valuenow` = the Recordings percentage.
  - Each section's minimum is its header plus 120 px.
  - The Recordings header holds the existing `RecordingHeaderActions` and the "Close session panel" button (`aria-keyshortcuts="Alt+BracketRight"`).
  - State is kept in localStorage `uh.sessionPanel` = `{open, width, weights:{recordings, chat}, collapsed:{recordings, chat}}` via `readLocal`/`writeLocal`. It is seeded once from the `workspaceRightCollapsed` preference, and that preference is never written again.
- [X] T055 [US2] Update `frontend/src/features/sessions/WorkspacePage.tsx`:
  - Replace `AudioCardHeader`/`RightPanel` with `SessionPanel` through `useRightCard({..., rail})`.
  - Remove `<AudioReopenButton/>` from the tab row's `end` slot, keeping `<FocusModeButton/>`.
  - The rail items: Recordings, with its indicator from `useActivitySignals()` (`recording` → "recording", transcription → "running"), and Chat, from the chat signal (T075). Activating one opens the panel with that section expanded.
  - Delete `frontend/src/features/sessions/AudioReopenButton.tsx` once nothing imports it.
- [X] T056 [US2] Verify that focus mode keeps the activity pills (`frontend/src/app/shell/ActivityPills.tsx`) visible while the panel and rail are hidden. Add a case to `frontend/tests/unit/focus-mode.test.tsx`.
- [X] T057 [US2] Write Playwright `frontend/tests/e2e/session-panel.spec.ts`:
  - The sections, collapse, boundary drag and keys, width limits, and Alt+] close and reopen.
  - The rail reopens with the chosen section.
  - Start a recording, close the panel: the rail's Recordings indicator shows and the recording continues (chunks keep uploading).
  - Reload: the layout is kept.
  - A 1000 px viewport starts closed.
  - Focus mode shows the pills.
  - axe in light and dark.

**Checkpoint**: the panel and rail work, and every existing recording and transcription e2e test is green.

---

## Phase 6: User Story 3 — Ask a question and get a streaming answer (Priority: P1) 🎯 MVP

**Goal**: send a message, stream the answer from any style, then Stop, Copy, Regenerate, switch model, see classified errors, acknowledge the privacy notice, with answers kept in chat files.

**Independent Test**: with the `fake_llm` local and remote endpoints, ask in a session and watch it stream; Stop a `slow` answer; Regenerate (it becomes version 2/2); switch to the Anthropic-style model mid-chat; trigger `fail-401` and retry. Nothing typed is lost, and the chat JSON and `.md` exist in `chats/`.

### Tests for User Story 3

- [X] T058 [P] [US3] Write unit tests `backend/tests/unit/test_ai_adapters_stream.py`, one per style, using `fake_llm` and recorded SSE fixtures:
  - The request body mapping per `contracts/provider-styles.md`: OpenAI `stream_options.include_usage` and plain-string content for text-only messages; Anthropic `max_tokens`, top-level `system`, merged same-role messages and `anthropic-version`; Gemini `system_instruction`, the `model` role and `alt=sse`.
  - Deltas in order and usage extraction.
  - Anthropic `thinking_delta` and Gemini `thought:true` are skipped.
  - `[DONE]` and Gemini's end without a marker.
  - A mid-stream `event: error` becomes an `AiError`.
  - The OpenAI retry without `stream_options` when the server says so.
- [X] T059 [P] [US3] Write unit tests `backend/tests/unit/test_chat_files.py`:
  - `uh-chat/1` write/read round trip with fixed key order and 2-space indent.
  - Unknown fields are kept.
  - The atomic write (no partial file left when interrupted).
  - Transcript rendering per `contracts/chat-file-format.md`: only the selected versions, and status lines `*(Stopped)*`/`*(Interrupted)*`.
  - The stem `YYYY-MM-DD HHMM <title>` with `safe_name`, ≤ 60 characters, and the ` (2)` collision suffix.
  - An invalid JSON file → `ChatFileUnreadable`, never overwritten.
  - A missing `.md` is rebuilt.
- [X] T060 [P] [US3] Write integration test `backend/tests/integration/test_chat_send_stream_save.py`. For each style (`echo` on each fake):
  - `POST /sessions/{key}/chats` → 201 `SendResult`, then subscribe to `/chat-runs/{runId}/events` and collect `start`, `delta*`, `usage` and `done`.
  - The JSON and `.md` files exist under `<session folder>/chats/`. The title is the first 60 characters of the message, the answer is `completed` with `endpointLabel`/`modelLabel`/`usage`, and the chat index row has `message_count=2`.
  - No key in the files (byte scan).
  - Reconnecting with `Last-Event-ID: 2` replays from event 3.
- [X] T061 [P] [US3] Write integration test `backend/tests/integration/test_chat_stop_cancels_upstream.py`. Start `slow`, read 3 deltas, then `POST /chat-runs/{id}/stop`:
  - The response status is `stopped`.
  - No `delta` event has an id greater than the last one before the stop response.
  - `fake_llm.STATE["disconnected"]` is true within 0.5 s.
  - The file's answer is `stopped` with its partial text.
  - Stopping again returns the same final state.
- [X] T062 [P] [US3] Write integration test `backend/tests/integration/test_chat_runs_survive_clients.py`. Start `slow` and never subscribe (or subscribe and disconnect): the run completes and is saved, `unseen_answer` is true, and two subscribers receive identical events. Send 5 runs for one user: the 5th gets 429 `too_many_runs`.
- [X] T063 [P] [US3] Write integration test `backend/tests/integration/test_chat_recover_interrupted.py`:
  - Start `slow`, let a checkpoint happen (≤ 2 s), then shut the app down. The answer is `interrupted`, with the checkpointed text.
  - Simulate a crash: write a run row as `streaming` with a file answer `streaming`, then start the app. `recover()` marks both `interrupted`.
- [X] T064 [P] [US3] Write contract tests `backend/tests/contract/test_chats_send.py`:
  - `POST /sessions/{key}/chats`: 201; 422 `empty_message` for whitespace-only text with no attachments; 422 `too_many_attachments` for 11; 409 `privacy_ack_required` for an unacknowledged remote endpoint; 409 `model_unavailable` for a hidden, disabled or deleted model; 409 `key_unreadable`.
  - `POST /chats/{id}/messages`: 202, and 409 `run_active`.
  - `POST /chats/{id}/turns/{turnId}/regenerate`: 202, creating a new answer version.
  - `PUT /chats/{id}/turns/{turnId}/selection`.
  - `GET /chats/{id}` validates as `Chat`.
  - `GET /chat-runs/active`, `GET /chat-runs/{id}/events` (text/event-stream) and `POST /chat-runs/{id}/stop`.
  - `POST /chats/{id}/seen` → 204.
  - Another user's chat or run → 404.
- [X] T065 [P] [US3] Write Vitest `frontend/tests/unit/markdown-blocks.test.ts`, for splitting a growing text into top-level blocks at blank lines outside fences: an unclosed fence is closed for display only, and only the last block changes identity as text is appended.
- [X] T066 [P] [US3] Write Vitest `frontend/tests/unit/run-store.test.ts`, with a fake `EventSource`:
  - Events accumulate text, the status follows `start` → `done`/`stopped`/`failed`, and reconnects use `Last-Event-ID`.
  - A `snapshot` event replaces the text.
  - Subscribers on two views share one EventSource.
  - Unsubscribing every view doesn't stop the run.
  - The activity signal reports `generating`/`unseen`.
- [X] T067 [P] [US3] Write Vitest `frontend/tests/unit/message-box-keys.test.tsx`:
  - Enter sends, and Shift+Enter inserts a newline.
  - Enter with `isComposing` or `keyCode 229` doesn't send.
  - Whitespace only can't be sent.
  - While generating, typing works and Send is replaced by Stop; Escape stops and focus returns to the textbox.
  - The textarea grows to 8 lines and then scrolls.
  - Every button has an accessible name.

### Implementation for User Story 3

- [X] T068 [US3] Implement `stream()` in `backend/src/unihelper/ai/openai_compat.py`, `backend/src/unihelper/ai/anthropic.py` and `backend/src/unihelper/ai/gemini.py`:
  - Map `ChatRequest` per `contracts/provider-styles.md`.
  - Yield `Delta`/`UsageEvent`/`End`.
  - Classify HTTP and in-stream errors through `ai/errors.py`.
  - Close the response in a `finally` block, so that cancellation closes the upstream connection.
  - `max_tokens` = `min(output_limit, 8192)`, or 4096 when it is unknown.
- [X] T069 [US3] Implement `backend/src/unihelper/chat/files.py`:
  - `ChatDocument` dataclasses that mirror the `uh-chat/1` schema in `contracts/chat-file-format.md`.
  - `read(storage, folder, stem)` and `write(storage, folder, stem, doc)` (atomic, through `write_text_atomic`), then `render_transcript()` to write the `.md`.
  - `new_stem(created_at, title, existing)` using `naming.safe_name` and `unique_sibling`.
  - A per-chat `threading.Lock` registry, like `note_file_lock`.
  - Re-indexing: if the file's sha256 differs from `chats.file_hash`, adopt the file.
  - Unknown fields are preserved.
- [X] T070 [US3] Implement `backend/src/unihelper/chat/context.py` `build_request(db, storage, chat_doc, user_version, model, settings) -> ChatRequest`:
  - The system text is the custom instructions when not empty (T124 fills them in; read through `ai_settings_service`).
  - For each earlier turn, the selected UserVersion's text, then its selected Answer if its status is `completed` or `stopped` with text. Answers with status `failed`, or empty `stopped`/`interrupted` answers, are left out.
  - The current user version's text.
  - Context items are resolved by kind: notes in T104, files in T114, so for US3 only text is built.
- [X] T071 [US3] Implement `backend/src/unihelper/chat/runs.py`:
  - `RunRegistry` on `app.state`: `start(user, chat_id, answer_id, request, cfg) -> run_id`, which creates the `chat_runs` row and starts an `asyncio.create_task`.
  - An in-memory event buffer per run (ids from 1, kept for 60 s after the end).
  - Deltas are merged and flushed every 50 ms.
  - A checkpoint writes the answer text to the chat file every 2 s, with status `streaming`.
  - On the end, the final write gives `completed`/`failed` with usage or the error, and sets `chats.generating=false` and `unseen_answer = no subscriber had the chat in view` (tracked by the `seen` heartbeat).
  - `stop(run_id)` cancels the task, waits for the cancel, writes `stopped` with the partial text and emits `stopped`. It is idempotent.
  - `subscribe(run_id, last_event_id) -> AsyncIterator`.
  - Limits: 4 runs per user and 8 in total → `ApiError(429, "too_many_runs")`.
  - `recover(db)` at startup: `queued`/`streaming` → `interrupted`, in both the database and the files.
  - `shutdown()` in the lifespan cancels all runs and writes `interrupted`.
- [X] T072 [US3] Implement `backend/src/unihelper/services/chat_service.py` (send and run parts):
  - `start_chat(user, session_key, SendMessage)`: resolve or create the session folder via `session_folder_service.get_or_create_folder`, validate the model (enabled, not hidden, endpoint enabled, else 409 `model_unavailable`), require the privacy acknowledgement for a remote endpoint (409 `privacy_ack_required`), check the text (422 `empty_message`) and the attachment count (≤ 10 → 422 `too_many_attachments`), create the stem and `ChatDocument` with turn 1 / version 1 / answer 1 (`queued`), write the file, insert the `chats` row (title = first 60 characters of the text with whitespace collapsed), call `ai_settings_service.set_last_model`, delete the new-chat draft row, start the run, and return `SendResult`.
  - `send(chat_id, SendMessage)`: 409 `run_active` when a run is active; append a turn.
  - `regenerate(chat_id, turn_id, model?)`: a new Answer on the selected UserVersion (clarification Q3); also used for Retry.
  - `select(chat_id, turn_id, version, answer)`: 409 `run_active` while that turn generates.
  - `get(chat_id) -> Chat`, and `mark_seen`.
  - Secrets are read only at run start, through `SecretStore.use()`, and are never placed on the request object's repr.
- [X] T073 [US3] Implement the routes in `backend/src/unihelper/api/v1/chats.py` and `backend/src/unihelper/api/v1/chat_runs.py`:
  - `POST /sessions/{sessionKey}/chats`, `GET /chats/{chatId}`, `POST /chats/{chatId}/messages`, `POST /chats/{chatId}/turns/{turnId}/regenerate`, `PUT /chats/{chatId}/turns/{turnId}/selection`, `POST /chats/{chatId}/seen`.
  - `GET /chat-runs/active`.
  - `GET /chat-runs/{runId}/events` as a `StreamingResponse(media_type="text/event-stream")`, with headers `Cache-Control: no-cache` and `X-Accel-Buffering: no`, a 15 s keepalive comment, and `Last-Event-ID` read from the header; it ends after a terminal event.
  - `POST /chat-runs/{runId}/stop`.

  Wire `RunRegistry` startup (`recover`) and `shutdown` into the `backend/src/unihelper/main.py` lifespan, and connect the T038 endpoint-delete hook so it stops that endpoint's runs.
- [X] T074 [US3] Regenerate the API types. Create `frontend/src/lib/api/stream.ts`, a `subscribeRun(runId, {lastEventId, onEvent})` wrapper over native `EventSource` at `/api/v1/chat-runs/{id}/events`, with typed events from `contracts/chat-stream.md`, reconnect backoff, and close on terminal events. Create `frontend/src/features/chat/api.ts`, with queries `["chat", id]`, `["chats", sessionKey, q]` and `["chat-runs-active"]`, and the send, start, regenerate, select, stop and seen mutations.
- [X] T075 [US3] Create `frontend/src/features/chat/runStore.ts`:
  - A module singleton holding `runs: Map<runId, {chatId, sessionKey, answerId, text, status, usage, error}>`, read with `useSyncExternalStore` (the `recorder()` pattern).
  - One `EventSource` per run. On load it reattaches to `GET /chat-runs/active`.
  - Text updates are coalesced to one notify per `requestAnimationFrame`.
  - On a terminal event it invalidates `["chat", chatId]` and `["chats", sessionKey]`.
  - `registerActivitySignal("chat", …)`, which exposes generating and unseen per session for the rail and the pills.
  - Add a "Answering…" `ActivityPill`, so focus mode still shows it (FR-011).
- [X] T076 [P] [US3] Create `frontend/src/features/chat/markdownBlocks.ts`, the block splitter tested in T065. Create `frontend/src/features/chat/AnswerMarkdown.tsx`:
  - `react-markdown` with `remark-gfm`, with no `rehype-raw`.
  - Components: `a` with `target="_blank" rel="noopener noreferrer"`; `img` → a placeholder "Remote image not loaded" with a link to the source; `pre`/`code` with the language label and `button "Copy code"` (`navigator.clipboard.writeText`, with a toast).
  - Memoised per block, so only the last block re-renders while streaming.
  - Styles use only tokens.
- [X] T077 [P] [US3] Create `frontend/src/features/chat/UserMessage.tsx` (`article "You"`, plain text with `whitespace-pre-wrap`) and `frontend/src/features/chat/AnswerView.tsx` (`article "Assistant"`):
  - A footer with "<Endpoint> · <Model>" and a Local/Remote badge.
  - A status label for Stopped and Interrupted.
  - Copy (the raw Markdown) and Regenerate.
  - `‹ n/m ›` version controls that call selection (keyboard accessible, `aria-label="Answer version n of m"`).
  - A failed answer shows `ErrorNotice`.
- [X] T078 [P] [US3] Create `frontend/src/features/chat/ErrorNotice.tsx`, with plain-language sentences for each `AnswerError.category`:
  - `network`: "Couldn't reach <host>." plus the local hint.
  - `key_rejected`: "The provider rejected the key." with a link to `/settings/ai`.
  - `rate_limited`: "Rate limited — try again in N s" (no time when unknown).
  - `model_not_found`, `too_large`, `context_exceeded`: their own sentences.
  - `provider`: the provider's message as given.

  Each notice has a Retry button that calls regenerate.
- [X] T079 [US3] Create `frontend/src/features/chat/MessageBox.tsx`, following `contracts/ui-contract.md` "Message box":
  - An attachment chip slot, then the auto-growing textarea (placeholder "Ask about this session…", max 8 lines), then a toolbar with Attach (a menu; its items arrive in US6 and US8, and until then it is disabled with the tooltip "Coming soon" — remove this once T105 lands), `ModelPicker`, and Send/Stop in the same place.
  - The key rules of T067.
  - Escape stops while generating.
  - Focus returns to the textarea after Stop and after sending.
  - The box is disabled with the empty state when no model is configured.
- [X] T080 [US3] Create `frontend/src/features/chat/ModelPicker.tsx`:
  - A `Popover` with a `listbox "Models"` grouped by endpoint, with a Local/Remote badge per group and capability icons with accessible names.
  - A `searchbox "Search models"` when there are more than 8 models.
  - Hidden models and disabled endpoints are left out.
  - The button label is "Model: <name>, Local|Remote".
  - The choice is saved per chat (PATCH `model`); new chats use `/ai/settings.lastModel`.
  - When the chosen model doesn't accept items in context (from preflight in US9; for US3, check only the capabilities of existing attachments), a dialog lists them with Remove.
  - A chat whose model is gone shows `modelLabel` as text and asks for a choice.
- [X] T081 [US3] Create `frontend/src/features/chat/PrivacyNotice.tsx`, an `AlertDialog` reading "Messages and attachments will be sent to <host>, the address you set up for <endpoint>." with Send and Cancel. Send calls privacy-ack, then retries the send. It is triggered by the 409 `privacy_ack_required` response and before the first send to a remote endpoint that hasn't been acknowledged.
- [X] T082 [US3] Create `frontend/src/features/chat/ConversationView.tsx`:
  - The header from `contracts/ui-contract.md`: Back to history, the title as an h3, New chat and Expand.
  - `log "Conversation"` (`aria-live="off"`) with `UserMessage`/`AnswerView` items using `content-visibility:auto` and `contain-intrinsic-size`.
  - A progress indicator before the first delta.
  - It follows new text while within 48 px of the bottom, otherwise shows `button "Jump to latest"`.
  - A visually hidden `role="status"` region announces only "Answer started", "Answer complete", "Answer stopped" and "Answer failed: <category>".
  - While the view is visible and `document.visibilityState === "visible"`, it calls `POST /chats/{id}/seen`.
- [X] T083 [US3] Create `frontend/src/features/chat/ChatSection.tsx`, the Chat section body for one session:
  - With no enabled endpoint and model, the empty state explains the setup and has `button "Open AI settings"`; the box is disabled.
  - Otherwise it shows the view state machine. For US3 this is a new chat (an empty History placeholder plus the box), then a send that switches to the Conversation view.
  - The panel's chat state is kept in localStorage `uh.chat.panel.<sessionKey>` = `{chatId, view}`.
- [X] T084 [US3] Create `frontend/src/features/chat/routes.tsx`, which registers the Chat section into `SessionPanel` (replacing the T054 placeholder) and the chat activity signal and pill (T075), and is imported by the app's feature registry in `frontend/src/app/features.ts`. Feed the rail's Chat indicator in `WorkspacePage.tsx` (T055) from this signal.
- [X] T085 [US3] Write Playwright `frontend/tests/e2e/chat-stream.spec.ts`, with endpoints seeded through the API:
  - Ask → streaming text appears progressively; Stop a `slow` answer with Escape → "Stopped", and focus is in the box.
  - Regenerate → `‹ 2/2 ›`.
  - Switch the model to the Anthropic fake → the next answer is labelled with it.
  - `fail-401` → the key-rejected notice with the settings link; Retry after fixing the key.
  - The privacy dialog appears once for the remote endpoint.
  - Links have `target=_blank`, and a remote image isn't requested (`page.route` asserts no request).
  - Close the panel during `slow` → the rail spinner, then the unseen dot.
  - axe in light and dark.

**Checkpoint**: MVP. Chat streams in a session with all three styles, and answers are saved as files.

---

## Phase 7: User Story 4 — Chat history per session (Priority: P1)

**Goal**: the History view with the newest five and More, title search, rename, delete with Undo, drafts, isolation between sessions, and deletion and Trash integration.

**Independent Test**: create three chats in session A and one in session B; rename; delete and Undo; search; run two answers at once; restart. Each session shows only its own chats with their drafts, and deleting session A's course names its chats.

### Tests for User Story 4

- [X] T086 [P] [US4] Write integration test `backend/tests/integration/test_chat_session_isolation.py`:
  - Chats listed per session only, newest `updated_at` first.
  - Another user → 404.
  - A class session rescheduled with the calendar keeps its chats (same `session_folder_id`).
  - An event moved to another semester (`event_service` folder rename) keeps working chats: the files are found at the new path and the stems are unchanged.
  - Deleting the session → Trash; the chats are hidden and restored with the session; purge removes the files and rows.
  - Session-level `deletion-impact` includes `chats` and `chatTitles` (≤ 5); hierarchy `deletion-impact` and Trash entries include `chats`/`chatCount`.
- [X] T087 [P] [US4] Write contract tests `backend/tests/contract/test_chats_history.py`:
  - `GET /sessions/{key}/chats` with `q` (title).
  - `PATCH /chats/{id}` (title 1–200; 412 when stale).
  - `DELETE /chats/{id}` → 204 and hidden from the list.
  - `POST /chats/{id}/restore` → 200; 410 `undo_expired` after the window (freeze the clock).
  - `GET`/`PUT /sessions/{key}/chat-drafts`: a new-chat draft with `chatId:null` and per-chat drafts; empty text with no attachments deletes the draft; 422 for text over 100,000 characters.
  - Deleting a chat with an active run stops it first.
- [X] T088 [P] [US4] Write Vitest `frontend/tests/unit/chat-history.test.tsx`:
  - Five items, then `More (N)` expands.
  - Titles are truncated, with the full title in `title` and on focus.
  - Relative age with the exact date in `title`.
  - Generating and "Open in tab" badges.
  - The menu Rename/Delete is keyboard operable.
  - Delete → toast with Undo for 10 s.
  - The search filters the list.
  - Sending from History starts a new chat.
  - Back during generation keeps the run (the store keeps streaming).

### Implementation for User Story 4

- [X] T089 [US4] Extend `backend/src/unihelper/services/chat_service.py`:
  - `list(session_key, q, in="title")`, which excludes `deleted_at`.
  - `rename`, which changes only the title, with the stem fixed.
  - `delete`: stop the active run, write the file, set `deleted_at`.
  - `restore`: 410 `undo_expired` after 10 minutes.
  - Drafts `get_drafts(session_key)` and `put_draft(session_key, ChatDraft)` on `chat_drafts`, with an empty `chat_key` for the new-chat box.
  - Implement `backend/src/unihelper/chat/sweep.py`. At startup and every 10 minutes it purges chats deleted more than 10 minutes ago (their files and `.files/` folders through `StorageService.delete_content_file`/`delete_tree`), and prunes `chat_runs` older than 7 days.
- [X] T090 [US4] Add the routes `GET /sessions/{sessionKey}/chats`, `PATCH /chats/{chatId}`, `DELETE /chats/{chatId}`, `POST /chats/{chatId}/restore`, and `GET`/`PUT /sessions/{sessionKey}/chat-drafts` to `backend/src/unihelper/api/v1/chats.py`.
- [X] T091 [US4] Integrate chats with deletion and Trash:
  - `content_counts()` in `backend/src/unihelper/services/trash_service.py` counts `chats` with `deleted_at IS NULL`.
  - Session `deletion_impact` adds `chats` and `chatTitles` (≤ 5, newest first).
  - Hierarchy `deletion_impact` in `backend/src/unihelper/services/hierarchy_service.py` adds `chats`.
  - Trash `entry_out` adds `chatCount`.
  - Purge deletes chat rows through the folder cascade and the files with the folder.
  - Add the fields to the existing response schemas in `backend/src/unihelper/schemas/trash.py` and `backend/src/unihelper/schemas/hierarchy.py`.
  - Update `trashSentence()` in `frontend/src/features/classes/DeleteSessionFlow.tsx` to name chats ("…, 2 chats"), and list `chatTitles` with "and N more" in the session delete dialog. Update the hierarchy and Trash UI counts to match.
- [X] T092 [US4] Create `frontend/src/features/chat/HistoryView.tsx`:
  - `list "Chats"` ordered newest first.
  - The visible title is truncated to one line, with `title` and `aria-label` set to the full title.
  - `<time>` with a relative age (`date-fns` `formatDistanceToNow`) and the exact date in `title`.
  - Badges for Generating (from `runStore`) and "Open in tab" (from placement, T098).
  - `DropdownMenu` "Chat actions" with Rename (an inline input, Enter saves, Escape cancels) and Delete (a toast with Undo for 10 s that calls restore).
  - Five items, then `button "More (N)"`.
  - The header's search toggles a `searchbox "Search chats"` (title filter, debounced 200 ms).
- [X] T093 [US4] Complete the view state machine in `frontend/src/features/chat/ChatSection.tsx`:
  - A new chat shows History. The first send switches to Conversation.
  - Opening a chat from the list shows its Conversation view.
  - Back and "+" return to History without stopping a run.
  - Sending from History starts a new chat.
  - "+" (`aria-keyshortcuts="Alt+Shift+KeyK"`) starts a new chat.
- [X] T094 [US4] Create `frontend/src/features/chat/drafts.ts`, a `useChatDraft(sessionKey, chatId|null)` hook that loads `GET /sessions/{key}/chat-drafts` once per session, saves with a 400 ms debounce through `PUT`, flushes on `pagehide` with `keepalive:true`, and clears on send. Use it in `MessageBox.tsx` so the draft text and attachment chips survive view switches, tabs, sessions and restarts.
- [X] T095 [US4] Write Playwright `frontend/tests/e2e/chat-history.spec.ts`:
  - Three chats in A and one in B, each shown only in its own session.
  - More appears after 5.
  - Rename, Delete → Undo, and search.
  - Two chats generating at the same time.
  - A typed draft survives a reload.
  - The course delete dialog names the chats.
  - axe.

**Checkpoint**: chats are kept per session, survive restarts, and are part of deletion and Trash.

---

## Phase 8: User Story 5 — Expand a chat into a tab and dock it back (Priority: P1)

**Goal**: Expand moves a chat into a workspace tab, which can be split, and Dock moves it back. A chat is in one place at a time, and moves never interrupt anything.

**Independent Test**: during a `slow` answer, Expand, split the tab beside a note, then Dock. The answer never stops; the draft, scroll position and attachments survive; and focus is in the message box after each move.

### Tests for User Story 5

- [X] T096 [P] [US5] Write Vitest `frontend/tests/unit/chat-placement.test.ts`, for the reducer:
  - Expand moves the panel chat into a tab and closes the panel.
  - Expanding a new empty chat opens an empty chat tab.
  - Choosing an "Open in tab" history entry focuses that tab.
  - Dock closes the tab, shows the chat in the panel and reopens the panel.
  - Closing a chat tab returns the chat to history.
  - A chat is never in both places.
  - `retain` drops tabs whose chat was deleted.
  - Extend `frontend/tests/unit/workspace-tabs.test.ts` with the `chat` kind round trip through `toServer`/`fromServer`.

### Implementation for User Story 5

- [X] T097 [US5] Add `TabKind "chat"` to `frontend/src/features/sessions/tabState.ts`. In `frontend/src/features/sessions/WorkspacePage.tsx`:
  - `titleOf` returns the chat title or "New chat".
  - `pane()` renders `ChatTab`.
  - `closeTab` returns the chat to history.
  - Add a chat icon (`ChatCircleText`) in `frontend/src/features/sessions/WorkspaceTabs.tsx`.
  - A new empty chat tab uses the id `new:<uuid>` until its first send replaces it with the real chat id.
- [X] T098 [US5] Create `frontend/src/features/chat/chatPlacement.ts`, the reducer and hook in T096, which combines the workspace tabs with `uh.chat.panel.<sessionKey>`. Wire Expand (`button "Expand chat into a tab"`) in the Chat section header and Conversation header: it closes the panel through `layout.setRightOpen(false)`, then opens a chat tab and focuses its textbox.
- [X] T099 [US5] Create `frontend/src/features/chat/ChatTab.tsx`. It shows the same `ChatSection` views centred with `max-w-[72ch]`, plus `button "Dock chat to the panel"`, which closes the tab, places the chat in the panel, reopens the panel and focuses its textbox. Keep scroll position in `uh.chat.scroll.<chatId>` (an offset, or `"bottom"`), restored on mount in both places. Make sure the run store isn't touched by moves.
- [X] T100 [US5] Write Playwright `frontend/tests/e2e/chat-expand-dock.spec.ts`:
  - Expand mid-stream: the panel closes to the rail, the tab shows the streaming answer, and the history entry says "Open in tab" (choosing it focuses the tab).
  - Split beside a note.
  - Dock mid-stream: the answer continues.
  - Draft, attachments and scroll are kept.
  - Close the tab during a `slow` answer: it finishes and is saved.
  - Focus after Expand and Dock is in the textbox.

**Checkpoint**: the panel ⇄ tab moves work without interrupting anything.

---

## Phase 9: User Story 6 — Attach notes as context (Priority: P1)

**Goal**: attach the open note, session notes and notes from other sessions or courses. They are sent as titled text, with a fresh snapshot on every send (clarification Q2).

**Independent Test**: attach the open note and a note from another course, then ask. Edit the note and ask again. The chat JSON shows a different snapshot hash for each message, and the fake server received the note text.

### Tests for User Story 6

- [X] T101 [P] [US6] Write contract tests `backend/tests/contract/test_notes_search.py` for `GET /notes/search` with `q`, `courseId`, `sessionKey` and `limit` (1–100, default 50). Results include `sessionLabel` and `courseName`, events count as sessions, another user's notes are never returned, and bodies validate as `NoteSearchHit`.
- [X] T102 [P] [US6] Write integration test `backend/tests/integration/test_chat_note_snapshots.py`:
  - Send with a note attached: `fake_llm` receives `--- Note: <title> ---\n<text>`, and the snapshot file `chats/<stem>.files/snapshots/<sha256[:16]>.md` exists.
  - Edit the note and send again with no new attachment (the note stays in context): a new snapshot hash is used, the first message still references the old one, and duplicates are stored once.
  - A deleted note gives an attachment marked `available:false` in `GET /chats/{id}`, with the send skipping it and naming it in the response.

### Implementation for User Story 6

- [X] T103 [P] [US6] Implement `backend/src/unihelper/services/note_search_service.py` and add `GET /notes/search` to `backend/src/unihelper/api/v1/notes.py`. Match the title case-insensitively, order by `updated_at` DESC, join the session folder, course and event for labels, and filter by the user.
- [X] T104 [US6] Extend `backend/src/unihelper/chat/context.py` for notes:
  - On every send, resolve each `note` context item. Read its current text through `note_service`, write the content-addressed snapshot with `write_text_atomic` if it doesn't exist yet, and record `noteSnapshots` on the user version.
  - Emit `NoteText(title, text)` parts.
  - When building earlier turns, use the snapshots those turns recorded.
  - Attachments sent with a message are merged into `chat.context` (deduplicated by kind and ref).
  - `GET /chats/{id}` marks context items `available:false` when their note, document or recording no longer exists, and updates titles from the current note title.
- [X] T105 [US6] Create `frontend/src/features/chat/NotePicker.tsx`, a `CommandDialog` with these groups:
  - "Open note": attach the active note tab's note.
  - "This session": the session's notes.
  - "Browse": search all notes through `/notes/search` with a course filter `Select`, showing `sessionLabel`.

  It supports multi-select up to the 10-attachment limit. Create `frontend/src/features/chat/AttachMenu.tsx`, a `DropdownMenu` "Attach" with "Notes" (Pictures, PDFs and Audio come in US8), and enable the Attach button in `MessageBox.tsx` (removing the T079 placeholder). Attachment chips show the note title, with `button "Remove <title>"`.
- [X] T106 [US6] Write Playwright `frontend/tests/e2e/chat-attachments.spec.ts` (notes part): the quick "attach the open note", browsing to another course's note, removing a chip, sending, and the fake server's last request containing both note texts.

**Checkpoint**: all P1 stories are done.

---

## Phase 10: User Story 8 — Attach pictures, PDFs and audio (Priority: P2)

**Goal**: pictures (from the device, paste or drop), PDFs (as documents or as extracted text) and audio (with the WebM→Ogg remux for Gemini), within each style's limits.

**Independent Test**: paste a screenshot; attach a session PDF for the Anthropic model; attach a PDF for a model without PDF support and accept the text; attach a scanned PDF and see "no text"; attach a WebM recording for the Gemini model (sent as Ogg); see Audio disabled for OpenAI-style models; refuse an 11th attachment.

### Tests for User Story 8

- [X] T107 [P] [US8] Write unit tests `backend/tests/unit/test_ogg_opus.py`:
  - Remuxing the WebM/Opus fixture from `tests/webm_fixture.py` produces a valid Ogg stream: an `OggS` capture pattern, OpusHead/OpusTags pages, correct granule positions and CRC32 checksums, and the same packet count as the input.
  - Unsupported WebM (no Opus track, or laced blocks) raises `RemuxUnsupported`.
- [X] T108 [P] [US8] Write unit tests `backend/tests/unit/test_pdf_text.py`, with `tests/pdf_fixtures.py`: a text PDF extracts text; a PDF with fewer than 20 characters per page on average reports `has_text=False`; an encrypted PDF gives `encrypted`; there is a 2,000-page / 20 s limit.
- [X] T109 [P] [US8] Write integration test `backend/tests/integration/test_chat_attachments.py`:
  - Uploads are checked by magic bytes (PNG, JPEG, WebP, GIF, PDF; audio wav, mp3, ogg, flac, m4a/aac, webm). A wrong type gives 415 `unsupported_type`, and more than 25 MB gives 413 `upload_too_large`.
  - A sent upload moves from `chats/.uploads/` to `chats/<stem>.files/NN-<name>`.
  - Per style, the parts reach `fake_llm` exactly as in `contracts/provider-styles.md`: OpenAI `image_url`/`file`/`input_audio`; Anthropic `image`/`document`; Gemini `inline_data` with `audio/ogg` for a WebM recording.
  - Audio with the OpenAI style in WebM gives 409 `attachment_not_accepted` with the reason code `format`.
  - Anthropic and audio → `no_audio`.
  - Gemini and GIF → `format`.
  - Over the per-message limit → 413 `too_large` naming the limit, and nothing is truncated.
  - `pdfMode:"text"` sends `PdfText`.
  - A referenced document or recording that was deleted shows `available:false`.
  - Uploads unreferenced for 24 h are swept.
- [X] T110 [P] [US8] Write contract tests `backend/tests/contract/test_chat_uploads.py`: `POST /sessions/{key}/chat-uploads` (201, 413, 415), and `GET /chat-files/{uploadId}` (200 with the stored MIME type; `Content-Disposition: attachment` for anything but images; another user gets 404).

### Implementation for User Story 8

- [X] T111 [P] [US8] Implement `backend/src/unihelper/domain/ogg_opus.py` `remux_webm_opus(data: bytes) -> bytes`. Read the blocks through `domain/webm.py` and write Ogg pages per RFC 7845: OpusHead from CodecPrivate, OpusTags, then audio packets with granule positions at 48 kHz, a CRC-32 per Ogg page, and an EOS flag on the last page.
- [X] T112 [P] [US8] Implement `backend/src/unihelper/domain/pdf_text.py` `extract(path, max_pages=2000, timeout_s=20) -> PdfText(text, pages, has_text, encrypted)` with `pypdf`, run in `asyncio.to_thread`. `has_text` is false when the average is below 20 characters per page.
- [X] T113 [US8] Implement `backend/src/unihelper/services/chat_upload_service.py`:
  - Streamed multipart through the existing `api/uploads.py` helpers into `<session folder>/chats/.uploads/<id>-<safe name>`.
  - The MIME type from magic bytes, ≤ 25 MB, a sha256, and the `chat_uploads` row.
  - The move to `chats/<stem>.files/NN-<name>` on first send.
  - `serve(upload_id)`.
  - Add the routes `POST /sessions/{sessionKey}/chat-uploads` and `GET /chat-files/{uploadId}` to `backend/src/unihelper/api/v1/chats.py`.
  - The 24 h sweep goes in `chat/sweep.py`.
- [X] T114 [US8] Extend `backend/src/unihelper/chat/context.py` for files:
  - `document` → read the session PDF. `recording` → read the session audio. `upload` → read the stored file.
  - Map them to `Image`/`Pdf`/`PdfText`/`Audio` per the model's capabilities and style.
  - Remux WebM for Gemini.
  - Refuse WebM, M4A or OGG for OpenAI with the reason "This model accepts WAV or MP3 audio. Use Transcribe for this recording."
  - Refuse GIF for Gemini.
  - Check the per-file and per-message limits from `ai/limits.py` **after** base64 encoding, then raise `ApiError(409, "attachment_not_accepted", extra={"unaccepted": [...]})` or `ApiError(413, "too_large", detail=<limit sentence>)`.
- [X] T115 [US8] Extend `frontend/src/features/chat/AttachMenu.tsx` and `MessageBox.tsx`:
  - "Pictures…": a file input `accept="image/png,image/jpeg,image/webp,image/gif"`, plus paste (`onPaste` with image items) and drop on the box.
  - "PDFs…": a submenu with the session documents (from the existing documents query) and "Upload from device".
  - "Audio…": a submenu with the session recordings and an upload. It is disabled (`aria-disabled`) with the reason "This model doesn't accept audio — use Transcribe on the recording" when the current model lacks the Audio capability.
  - Uploads go through `lib/api/upload.ts` with progress shown on the chip; image chips show a thumbnail from `/chat-files/{id}`.
  - When the model can't take a PDF, a choice dialog offers "Send the PDF's text instead", or says "This PDF has no text (for example a scan)" when `pdfHasText:false`.
  - The 10-attachment cap is enforced in the UI with a message.
- [X] T116 [US8] Extend `frontend/tests/e2e/chat-attachments.spec.ts`: paste an image → thumbnail chip; a PDF to the Anthropic fake as a document; the text fallback for an OpenAI fake without PDF; a scanned PDF → no-text message; a WebM recording to the Gemini fake; Audio disabled for the OpenAI-style model; an 11th attachment refused.

**Checkpoint**: multimodal attachments work within the limits.

---

## Phase 11: User Story 9 — See and manage what is in context (Priority: P2)

**Goal**: a context list with a size estimate against the model's limit, removable items, and the over-limit handling.

**Independent Test**: attach two notes and a PDF; open the context list and see the item estimates and the total against the limit; remove one; add more until the limit is exceeded; choose "Start a new chat" and see the draft carried over.

### Tests for User Story 9

- [X] T117 [P] [US9] Write unit tests `backend/tests/unit/test_ai_estimate.py` for the research R10 heuristics: text is characters ÷ 4; an image is 1,600 tokens; a PDF is 1,500 tokens per page for Anthropic, 258 per page for Gemini, and extracted characters ÷ 4 for OpenAI; audio for Gemini is 32 tokens per second (from `audio_probe` durations). Write contract tests `backend/tests/contract/test_chat_preflight.py` for `POST /chats/preflight`: per-item `accepted`/`reasonCode`/`textFallbackAvailable`/`pdfHasText`; `estimatedTokens`; `contextLimit` (null when unknown); `overLimit`; `limits`; `privacyAckRequired`. Also, a send whose estimate is over the limit gives 409 `context_exceeded`.

### Implementation for User Story 9

- [X] T118 [US9] Implement `backend/src/unihelper/ai/estimate.py`, and add `preflight(user, PreflightRequest)` to `backend/src/unihelper/services/chat_service.py`. It reuses the `chat/context.py` resolution in a dry-run mode that reads only metadata (sizes, page counts, durations, the PDF text check). Add the route `POST /chats/preflight` to `backend/src/unihelper/api/v1/chats.py`. Make `send`/`start_chat`/`regenerate`/`edit` refuse with 409 `context_exceeded` when the estimate is above `context_limit`.
- [X] T119 [US9] Create `frontend/src/features/chat/ContextList.tsx`:
  - A `button "Context (N items, ~X tokens of Y)"` (or "~X tokens" when the limit is unknown) in the message box toolbar.
  - It opens a `Popover` listing the context items with their estimates and `button "Remove <title>"` (PATCH `context`).
  - The chosen style's per-file and per-message limits are shown under the list (FR-055).
  - When `overLimit`, an `alert` reads "This conversation is larger than the model can take" with "Remove items" (which opens the list) and "Start a new chat" (which carries the draft text and attachments into the new-chat draft).
  - Preflight runs with a 400 ms debounce on changes to the model, attachments or context.
  - `ModelPicker` uses the preflight `unaccepted` items for its warning dialog (T080).
- [X] T120 [US9] Add a context-list case to `frontend/tests/e2e/chat-attachments.spec.ts`: estimates shown, removing an item updates the total, and an over-limit model (a `fake_llm` model with `contextLimit` 100) shows the alert and "Start a new chat" carries the draft.

---

## Phase 12: User Story 10 — Extras (Priority: P3)

**Goal**: Add to note, edit and resend with versions, custom instructions, usage display, and search in chat text.

**Independent Test**: append an answer to an existing note and to a new note; edit and resend the last message (`‹ 2/2 ›` on the user message); set custom instructions and see them in the fake server's system field; see usage on `big-usage`; search a word that only appears inside an answer.

### Tests for User Story 10

- [X] T121 [P] [US10] Write integration test `backend/tests/integration/test_chat_extras.py`:
  - Append to note: the note's existing bytes are unchanged and a heading `## Chat — <title> · <YYYY-MM-DD HH:MM>` is appended after the last character using `transcript.separator_for`. A new note is created with that content. 409 `answer_incomplete` while the answer is streaming.
  - Edit: only the last turn (409 `not_last_turn` otherwise). Version 1 is kept with its answers, and version 2 is selected and answered.
  - Custom instructions reach the system field in each style.
  - `GET /sessions/{key}/chats?q=word&in=text` finds a chat by answer text, with a `match` snippet.

  Write the contract tests for `POST /chats/{id}/answers/{answerId}/append-to-note` and `POST /chats/{id}/turns/{turnId}/edit` in `backend/tests/contract/test_chats_extras.py`.

### Implementation for User Story 10

- [X] T122 [US10] Implement `append_answer_to_note(chat_id, answer_id, noteId|newNoteTitle)` in `backend/src/unihelper/services/chat_service.py`. It reuses `note_service.append_to_note` (the per-note lock, fsync, version bump, and the `{text, previousHash, hash, version}` result) with the heading `## Chat — {chat title} · {YYYY-MM-DD HH:MM}`. A new note is created through `note_service` in the chat's session. Add the route.
- [X] T123 [US10] Implement `edit(chat_id, turn_id, SendMessage)` in `chat_service.py`: last turn only; append a UserVersion, select it, and start a run. Add the route `POST /chats/{chatId}/turns/{turnId}/edit`. Implement text search in `list(..., in="text")` by scanning the session's chat JSON files (selected and all versions' text) with a snippet of ±40 characters.
- [X] T124 [US10] Frontend extras:
  - **Edit and resend**: `UserMessage.tsx` gets "Edit and resend" on the last message, which puts its text and attachments into an inline editor and sends through edit, plus `‹ n/m ›` on the user message for its versions.
  - **Add to note**: `AnswerView.tsx` gets "Add to note", which opens `frontend/src/features/chat/AddToNoteDialog.tsx` (the session's notes plus "New note…"; on success a toast with "Open note"). The open note editor merges through the existing append-merge path used by transcripts.
  - **Usage**: a usage line "Tokens: in N · out M" when `usage` is present.
  - **Custom instructions**: enable the textarea in `AiSettings.tsx` (PUT `/ai/settings` with `version`).
  - **Search**: `HistoryView.tsx` search gets a "Search in messages" toggle (`in=text`) that shows the `match` snippets.
- [X] T125 [US10] Write Playwright `frontend/tests/e2e/chat-extras.spec.ts` covering each item in the Independent Test, plus checking that the note editor shows the appended answer without a conflict.

---

## Phase 13: Polish & Cross-Cutting Concerns

- [X] T126 [P] Add the shortcuts to `frontend/src/features/sessions/useWorkspaceKeyboard.ts`, matched by `e.code`:
  - `Alt+KeyK` focuses the chat message box: it opens the panel and expands Chat, or focuses the chat tab if the panel chat lives in a tab.
  - `Alt+Shift+KeyK` starts a new chat.

  Add `aria-keyshortcuts` to the relevant buttons. Create `frontend/tests/unit/shortcut-conflicts.test.ts`, a table of every app binding (AppShell `[`, `\`, `/`; the workspace Alt bindings; HomePage Shift+C/T; the calendar `CALENDAR_SHORTCUTS`; editor Mod+E; and the new ones) that fails on duplicates and on the reserved browser keys (Alt+F/E/V/S/B/T/H, Ctrl/Cmd+K/L/T/W/N).
- [X] T127 [P] Write a performance check `frontend/tests/e2e/chat-perf.spec.ts`. Seed a 1,000-message chat file through the API: open it in under 2 s; scroll to the top and back with no long task over 100 ms (`PerformanceObserver`); typing in the box stays under 50 ms per keystroke; during two concurrent `slow` streams, typing in a note editor stays under 50 ms per keystroke. If this fails, add list virtualisation and record it in plan.md Complexity Tracking.
- [X] T128 [P] Write accessibility checks `frontend/tests/e2e/chat-a11y.spec.ts`:
  - A keyboard-only run of the whole flow: Alt+K, type, Enter, Escape (Stop), the model picker with arrows, the attach menu, history menu Rename/Delete/Undo, Expand and Dock, with focus-return assertions.
  - The screen-reader status region announces only start and complete.
  - axe in the light, dark and a custom theme (use the `a11y-themes.spec.ts` helpers).
  - Reduced motion (`page.emulateMedia({reducedMotion:"reduce"})`): no animations, and the indicators stay visible.
- [X] T129 [P] Write an offline check `frontend/tests/e2e/chat-offline.spec.ts`. With `context.setOffline(false)` for localhost only (route-abort every non-localhost request), a chat with the local fake endpoint works end to end, and a remote endpoint shows the network error with Retry (FR-074).
- [X] T130 [P] Add a test-suite-wide key-leak guard to `backend/tests/conftest.py`. At `pytest_sessionfinish`, scan `tmp_path_factory` chat files and captured logs for every test key string registered through a `register_test_key()` helper, failing on any hit (SC-005).
- [X] T131 [P] Write the documentation:
  - An "AI chat" section in `README.md`: no service ships with the app; adding endpoints in the three styles with examples (OpenAI `https://api.openai.com/v1`, Ollama `http://localhost:11434/v1`, Anthropic `https://api.anthropic.com`, Gemini `https://generativelanguage.googleapis.com`); Local vs Remote; where chats are stored; the shortcuts.
  - Update `website/` only if it lists features.
- [X] T132 Re-run the full quickstart (`specs/014-session-ai-chat/quickstart.md`): all automated checks, the Constitution VI critical flows (`test_record_save_flow.py`, `test_recording_recovery.py`, `test_transcribe_append_flow.py`, `test_recurring_class_creation.py`), the contract coverage gate, `ruff`/`mypy`/`pnpm lint`/`typecheck`, and the manual walkthrough. Fix whatever fails.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T000 (the constitution amendment) blocks Phase 2 onward. T001–T005 can run in parallel with T000.
- **Foundational (Phase 2)**: T006 comes before T007 and T008. T009 comes before T010. T011–T013 can start after T008. Phase 2 blocks every story.
- **US7 (Phase 3)**: first. It blocks storing any AI key (US1 T038).
- **US1 (Phase 4)**: needs US7.
- **US2 (Phase 5)**: frontend only. It needs only Phase 2, so it can run **in parallel** with US7 and US1.
- **US3 (Phase 6)**: needs US1 (endpoints and adapters) and US2 (the Chat slot in the panel).
- **US4 (Phase 7)**: needs US3.
- **US5 (Phase 8)**: needs US3 and US4 (the history entry "Open in tab").
- **US6 (Phase 9)**: needs US3. It can run in parallel with US4 and US5.
- **US8 (Phase 10)**: needs US6 (the Attach menu and context resolution).
- **US9 (Phase 11)**: needs US8 (file estimates). The note-only estimate could start after US6.
- **US10 (Phase 12)**: needs US4. The custom-instructions part only needs US3.
- **Polish (Phase 13)**: after the desired stories.

### Within each story

- Tests are written first and must fail before the implementation.
- Order: models/domain → adapters/services → routes → regenerate API types → frontend → e2e.
- Regenerate `frontend/openapi.json` and `schema.d.ts` after every backend schema change, before the frontend tasks.

## Parallel Opportunities

- **Phase 1**: T001, T002, T003, T004 and T005.
- **Phase 2**: T007, T008, T010, T011, T012 and T013 once T006 and T009 are done.
- **US7**: tests T014–T018 together; T025 and T026 in parallel with T019–T024.
- **US1**: tests T027–T031 together; the domain and adapter pieces T032–T036 together.
- **US2 (frontend) in parallel with US7 and US1 (backend)**.
- **US3**: tests T058–T067 together; the frontend pieces T076–T078 in parallel with the backend T068–T073.
- **US6 in parallel with US4 and US5**, on different files (the backend `note_search_service` vs `chat_service` history).

### Parallel example: User Story 3

```bash
# Tests first, together:
Task: "T058 adapter stream unit tests in backend/tests/unit/test_ai_adapters_stream.py"
Task: "T059 chat files unit tests in backend/tests/unit/test_chat_files.py"
Task: "T060 send/stream/save integration in backend/tests/integration/test_chat_send_stream_save.py"
Task: "T061 stop cancels upstream in backend/tests/integration/test_chat_stop_cancels_upstream.py"
Task: "T065 markdown blocks in frontend/tests/unit/markdown-blocks.test.ts"
Task: "T066 run store in frontend/tests/unit/run-store.test.ts"

# Then frontend rendering pieces alongside backend runs:
Task: "T076 AnswerMarkdown in frontend/src/features/chat/AnswerMarkdown.tsx"
Task: "T077 UserMessage/AnswerView in frontend/src/features/chat/"
Task: "T078 ErrorNotice in frontend/src/features/chat/ErrorNotice.tsx"
Task: "T071 RunRegistry in backend/src/unihelper/chat/runs.py"
```

### Parallel example: US2 alongside US7/US1

```bash
Task: "T051–T057 session panel and rail (frontend/src/app/shell/, frontend/src/features/sessions/)"
Task: "T019–T024 secret store (backend/src/unihelper/secrets/)"
```

## Implementation Strategy

### MVP first

1. Phase 1, including the T000 amendment, then Phase 2.
2. US7 (keys encrypted) → US1 (endpoints) → US2 (panel) → US3 (streaming chat).
3. **Stop and validate** with the US3 Independent Test and quickstart steps 1–4 and 6. This is a usable MVP: one chat per send, streamed, stoppable and saved.

### Incremental delivery (a single `/speckit-implement` run, in this order)

1. US4: history, drafts, deletion and Trash.
2. US5: Expand and Dock.
3. US6: notes as context. This completes all of P1.
4. US8, then US9: P2 attachments and context.
5. US10: P3 extras.
6. Polish: shortcuts, performance, accessibility, offline, the leak guard, docs and the full quickstart.

## Notes

- **Everywhere**:
  - Never put a key in a log, an error, a response or a file.
  - Every Remote request goes through `require_secure` before a key header is attached.
- **Existing behaviour**:
  - Existing recording, transcription and tab tests must stay green after every phase (FR-075, SC-010). If one needs to change, only its selectors may change (T050), never its assertions.
- **Plan discipline**:
  - If an implementation decision departs from research.md, update research.md and plan.md first (Constitution VII).
