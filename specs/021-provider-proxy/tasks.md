---

description: "Task list for feature 021 — Proxy for Transcription and AI Provider Requests"
---

# Tasks: Proxy for Transcription and AI Provider Requests

**Input**: Design documents from `/specs/021-provider-proxy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md

**Tests**: Included — Constitution VI requires success + main error tests for every endpoint, and
the spec's SC-002/SC-004 need automated verification.

**Organization**: Tasks are grouped by user story (US1 Proxy page, US2 Transcription switch,
US3 AI switch — all P1, ordered as in spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Paths: `backend/src/unihelper/…`, `backend/tests/…`, `frontend/src/…`, `frontend/tests/…`

---

## Phase 1: Setup

- [X] T001 Change the `httpx>=0.28` dependency to `httpx[socks]>=0.28` (both occurrences) in `backend/pyproject.toml`, then run `uv lock` and `uv sync` in `backend/` so `socksio` lands in `backend/uv.lock` (research R3)
- [X] T002 [P] Add `"socksio"` (plus `collect_submodules("socksio")`) to `hiddenimports` in `backend/packaging/unihelper-backend.spec`

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: data model, routing function, and proxy-aware error classification shared by all stories.

- [X] T003 Create `ProxySettings` model in `backend/src/unihelper/models/proxy.py` per data-model.md: table `proxy_settings`; `user_id` String PK FK `users.id` ON DELETE CASCADE; `scheme` String(8) with CHECK `scheme IN ('http','https','socks5')`; `host` String(253) NOT NULL; `port` Integer NOT NULL with CHECK `port BETWEEN 1 AND 65535`; `username` String(255) nullable ("empty string stored as NULL"); `secret_id` String nullable FK `secrets.id` ON DELETE SET NULL; use `VersionMixin` and `TimestampMixin`; `__repr__` must not include secret material. Export it from `backend/src/unihelper/models/__init__.py`
- [X] T004 [P] Add `"proxy"` to `OWNER_KINDS` in `backend/src/unihelper/models/secret.py`
- [X] T005 [P] Add `use_proxy: Mapped[bool]` (Boolean, NOT NULL, default False) to `TranscriptionSettings` in `backend/src/unihelper/models/transcription.py` and to `AiSettings` in `backend/src/unihelper/models/ai_endpoint.py`
- [X] T006 Create Alembic migration `backend/src/unihelper/db/migrations/versions/0018_provider_proxy.py` (down_revision = the 0017 revision id): create `proxy_settings` exactly as T003; add `use_proxy` BOOLEAN NOT NULL `server_default=sa.false()` to `transcription_settings` and `ai_settings` (use `batch_alter_table` for SQLite); downgrade reverses all three
- [X] T007 Create `backend/src/unihelper/services/proxy_service.py` with: `Section = Literal["transcription","ai"]`; `route(db, user_id, section, target_url) -> str | None` implementing the data-model.md table — return None if no `ProxySettings` row, if the section's `use_proxy` is false, or if `host_locality(urlsplit(target_url).hostname)` (from `unihelper.domain.ai_addresses`) is `"local"`; otherwise build `scheme://[user:pass@]host:port` with `urllib.parse.quote(..., safe="")` on username and password (password read via the `SecretStore` `use()`/`reveal()` API with owner kind `"proxy"`, owner id = user_id; IPv6 hosts wrapped in `[]`); and `client(proxy: str | None, transport) -> httpx.AsyncClient` returning `httpx.AsyncClient(transport=transport, proxy=proxy if transport is None else None)` with a one-line comment that an injected test transport bypasses the proxy. Never log the URL; log only `proxied=%s`
- [X] T008 [P] Unit tests in `backend/tests/unit/test_proxy_routing.py`: every row of the data-model.md routing table; local targets (`http://localhost:11434`, `http://192.168.1.5`, `http://gpu-box`) go direct with switch on; a password containing `@ : / space` is percent-encoded; IPv6 proxy host is bracketed; register the test password with `register_test_key` from `backend/tests/conftest.py`
- [X] T009 Add proxy-aware classification in `backend/src/unihelper/ai/errors.py`: new `MESSAGES` entries `proxy_unreachable` ("Couldn't reach the proxy."), `proxy_auth` ("The proxy rejected the credentials."), `proxy_onward` ("The proxy couldn't reach the AI server."); `classify_exception(exc, cfg, proxied: bool = False)` maps, when `proxied`, `httpx.ProxyError` with 407 → category `proxy` + `proxy_auth`, other `ProxyError` → `proxy` + `proxy_onward`, `ConnectError`/`ConnectTimeout` → `proxy` + `proxy_unreachable`; non-proxied behaviour unchanged. Add `"proxy"` to the `AiError` category type in `backend/src/unihelper/ai/base.py` and give `EndpointConfig` a `proxied: bool = False` field that `ai/http.py` passes through to `classify_exception`
- [X] T010 Add proxy-aware transport errors in `backend/src/unihelper/transcription/openai_client.py`: `OpenAITranscriptionClient.__init__(http, proxied=False)`; `_transport_error(exc, proxied)` returns `ProviderError("unavailable")` with a message starting "The proxy" for the same three cases as T009 (no change to `ERROR_CATEGORIES`, research R4); thread `proxied` through `build()` in `backend/src/unihelper/transcription/providers.py`
- [X] T011 [P] Unit tests in `backend/tests/unit/test_proxy_errors.py` for T009/T010 using `httpx.MockTransport` raising `httpx.ProxyError`/`httpx.ConnectError`: proxied → proxy messages; not proxied → existing messages unchanged

**Checkpoint**: routing + classification ready; stories can start.

---

## Phase 3: User Story 1 — Save a proxy in Settings → Proxy (P1) 🎯 MVP

**Goal**: user can create, test, view (masked), update and delete one proxy.

**Independent Test**: save a reachable proxy, test it, reload Settings → Proxy: type/host/port kept, password masked; changing only the port keeps the password; delete with confirmation.

### Tests (write first, must fail)

- [X] T012 [P] [US1] Contract tests in `backend/tests/contract/test_proxy.py` against `specs/021-provider-proxy/contracts/openapi.yaml`: GET with no proxy (`proxy: null`, `usedBy: []`); PUT create → 200 masked `password` (`last4` only, none if < 8 chars); PUT with password absent keeps it, `null` removes it; PUT without `If-Match` when a proxy exists → 428, stale → 412; PUT `port: 70000` / host `http://x/y` / scheme `ftp` → 422 (`invalid_port`/`invalid_host`/`invalid_scheme`); DELETE → 200 `disabledSections`, DELETE when none → 404, DELETE without If-Match → 428; POST `/settings/proxy/test` outcomes `working`, `unreachable`, `credentials_rejected` (407), `no_onward_connection`, `timeout` via injected `httpx.MockTransport`; `useSavedPassword` uses the stored password; CSRF header missing → 403. Register every password with `register_test_key`
- [X] T013 [P] [US1] Frontend test `frontend/tests/unit/proxy-settings.test.tsx`: empty form fields (type select HTTP/HTTPS/SOCKS5, host, port, username, password), inline errors for bad port/host, masked password shows Replace/Remove, delete opens confirm dialog and toasts the turned-off sections, axe has no violations

### Implementation

- [X] T014 [P] [US1] Pydantic schemas in `backend/src/unihelper/schemas/proxy.py` matching contracts/openapi.yaml: `ProxyScheme`, `ProxyOut` (`password: SecretState` from `schemas/settings.py`), `ProxySettingsOut` (`proxy`, `used_by`), `ProxySave` (`host` 1–253 chars, `port` 1–65535, `username` ≤255, `password` ≤1024 with absent/str/null semantics via `model_fields_set`), `ProxyTest` (+ `use_saved_password: bool = False`), `ProxyTestResult` (`outcome` enum `working|unreachable|credentials_rejected|no_onward_connection|timeout`, `message`), `ProxyDeleted` (`disabled_sections`)
- [X] T015 [US1] Implement in `backend/src/unihelper/services/proxy_service.py`: `view(db, store, user)`; `put(db, store, user, body, if_match)` — validate host (no scheme, path, spaces, `@`; IPv4/IPv6 literal or hostname labels) → 422 `invalid_host`, store/replace/remove the password in `SecretStore` (owner kind `"proxy"`), 503 `secret_store_unreadable` when a password is given and the store can't encrypt, version check via the same helper the AI endpoints use; `delete(db, store, user, if_match)` deletes row + secret and sets `use_proxy=False` on `transcription_settings` and `ai_settings` in one transaction, returning which were on (FR-006)
- [X] T016 [US1] Implement `test(db, store, user, body, transport)` in `backend/src/unihelper/services/proxy_service.py`: build the draft proxy URL (saved password if `use_saved_password`), `GET TEST_URL = "https://www.gstatic.com/generate_204"` via `client(proxy, transport)` inside `asyncio.wait_for(..., 15)`; any HTTP response → `working`; `ConnectError`/`ConnectTimeout` → `unreachable`; `ProxyError` 407 → `credentials_rejected`; other `ProxyError` or TLS/read error → `no_onward_connection`; `TimeoutError` → `timeout`; messages start with "The proxy" for failures
- [X] T017 [US1] Add routes `GET/PUT/DELETE /settings/proxy` and `POST /settings/proxy/test` to `backend/src/unihelper/api/v1/settings.py` (CSRF on writes via existing deps, `If-Match` header, transport from the same app-state seam the transcription test uses)
- [X] T018 [US1] Backups: add `"proxy"` to the `kind` Literal in `backend/src/unihelper/backup/manifest.py` and `backend/src/unihelper/schemas/backup.py`; in `_keys_left_out` in `backend/src/unihelper/backup/writer.py` append `mf.KeyLeftOut(kind="proxy", id=uid, name="Proxy")` when `proxy_settings.secret_id IS NOT NULL`; extend `backend/tests/contract/test_backup_api.py` with that case; add `proxy` to `KeyLeftOut.kind` in `specs/016-data-backup-restore/contracts/openapi.yaml`
- [X] T019 [US1] Regenerate `frontend/openapi.json` (`uv run python -m unihelper.export_openapi ../frontend/openapi.json`) and `frontend/src/lib/api/schema.d.ts` (`corepack pnpm gen:api`)
- [X] T020 [P] [US1] API hooks in `frontend/src/features/settings/proxy/api.ts` (TanStack Query: `useProxy`, `useSaveProxy` with If-Match, `useDeleteProxy`, `useTestProxy`) following `frontend/src/features/settings/ai/api.ts`
- [X] T021 [US1] Page `frontend/src/features/settings/proxy/ProxySettings.tsx`: shadcn `select` (HTTP, HTTPS, SOCKS5), `input` host/port/username, password via existing `frontend/src/features/settings/KeyField.tsx`, "Test proxy" + "Save" buttons, result alert, "Delete proxy" with `alert-dialog` confirmation, a note that HTTP-type proxies receive the password unencrypted; theme tokens only, all fields labelled
- [X] T022 [US1] Register the route `{ path: "proxy", element: loading(<ProxySettingsPage />) }` in `frontend/src/features/settings/routes.tsx` and nav entry `{ to: "/settings/proxy", label: "Proxy" }` after "AI" in `frontend/src/features/settings/SettingsLayout.tsx`

**Checkpoint**: US1 fully usable on its own.

---

## Phase 4: User Story 2 — Use proxy for transcription (P1)

**Goal**: "Use proxy" switch in Settings → Transcription routes test + jobs through the proxy (remote addresses only).

**Independent Test**: proxy saved, switch on → transcription test and job reach the provider through the proxy; local Voice Studio goes direct; proxy down → job fails naming the proxy, recording intact; switch off → direct.

### Tests

- [X] T023 [P] [US2] Extend `backend/tests/contract/test_transcription_settings.py`: GET returns `useProxy: false` by default; PUT `useProxy: true` with no proxy → 409 `proxy_not_configured`; with proxy → saved; test endpoint returns category `proxy` when the injected transport raises `httpx.ConnectError` and the user is proxied; local address stays direct (assert `proxy_service.route` returned None via monkeypatch spy on `proxy_service.client`)
- [X] T024 [P] [US2] Integration test `backend/tests/integration/test_proxy_end_to_end.py` with a new in-process asyncio HTTP forward/CONNECT proxy in `backend/tests/fake_proxy.py` (~40 lines, counts requests, optional Basic auth): with `host_locality` monkeypatched to return `"remote"`, run a transcription job against `backend/tests/fake_transcriber.py` and assert the proxy saw the request; stop the proxy and assert the job fails with `error_category == "unavailable"`, message starting "The proxy", recording file untouched, no direct request made
- [X] T025 [P] [US2] Extend `frontend/tests/unit/transcription-settings.test.tsx`: switch disabled with link to `/settings/proxy` when no proxy; enabled and saved when a proxy exists; local-address hint visible when the address is local

### Implementation

- [X] T026 [US2] Add `use_proxy: bool` to `TranscriptionSettings` and optional `use_proxy: bool | None = None` to `TranscriptionSettingsSave`, and `"proxy"` to `ConnectionTestResult.category`, in `backend/src/unihelper/schemas/settings.py`; update `specs/005-settings-providers-themes/contracts/openapi.yaml` identically
- [X] T027 [US2] In `backend/src/unihelper/services/transcription_settings_service.py`: return `use_proxy` in the view; on save, when `use_proxy` is True and no `ProxySettings` row exists raise 409 `proxy_not_configured`; in `test()` compute `proxy = proxy_service.route(db, user.id, "transcription", values["address"])`, create the client with `proxy_service.client(proxy, transport)`, pass `proxied=proxy is not None` to `build()`, and map proxy failures to category `proxy` with a `TEST_MESSAGES["proxy"]` entry
- [X] T028 [US2] In `backend/src/unihelper/transcription/worker.py` `_run`: before opening the client, compute the proxy in a thread (`asyncio.to_thread`) via a new `svc.proxy_for_job(maker, job_id)` in `backend/src/unihelper/services/transcription_service.py` that calls `proxy_service.route(db, job.user_id, "transcription", json.loads(job.provider_values_json)["address"])`; open the client with `proxy_service.client(proxy, self.transport)` and pass `proxied` to `build()`; the proxy is read at job start (spec edge case: edits apply to the next request)
- [X] T029 [US2] Shared component `frontend/src/features/settings/UseProxySwitch.tsx`: shadcn `switch` + `label` "Use proxy", disabled with a "Add a proxy first" link to `/settings/proxy` when `GET /settings/proxy` has `proxy: null`, optional `localHint` prop rendering "Local addresses always connect directly."
- [X] T030 [US2] Use `UseProxySwitch` in `frontend/src/features/settings/transcription/TranscriptionSettings.tsx`, saving `useProxy` with the existing save mutation; show the local hint when the address is local (reuse the same locality check the page already uses for the https rule, or `POST /ai/base-url/check`)

**Checkpoint**: US1 + US2 work independently.

---

## Phase 5: User Story 3 — Use proxy for AI chat (P1)

**Goal**: "Use proxy" switch in Settings → AI routes endpoint tests, model discovery and chat streaming through the proxy (remote endpoints only).

**Independent Test**: proxy saved, AI switch on → test, model list and a chat message go through the proxy; local endpoint goes direct; proxy drop mid-stream → error names the proxy, message + partial reply kept.

### Tests

- [X] T031 [P] [US3] Extend `backend/tests/contract/test_ai.py`: `GET/PUT /ai/settings` carry `useProxy` (409 `proxy_not_configured` without a proxy); `POST /ai/endpoints/test` returns outcome `proxy` when proxied and the transport raises `httpx.ProxyError`; a `locality == "local"` endpoint stays direct
- [X] T032 [P] [US3] Add to `backend/tests/integration/test_proxy_end_to_end.py`: a chat run through `fake_proxy.py` against `backend/tests/fake_llm.py` streams via the proxy; killing the proxy mid-stream ends the run with category `proxy`, user message and partial reply saved in the chat file, no direct request
- [X] T033 [P] [US3] Extend `frontend/tests/unit/ai-settings.test.tsx`: switch disabled + link without proxy; toggling saves `useProxy`

### Implementation

- [X] T034 [US3] Add `use_proxy: bool` to `AiSettingsOut`, optional `use_proxy: bool | None = None` to `AiSettingsUpdate`, and `"proxy"` to `TestOutcome` in `backend/src/unihelper/schemas/ai.py`; update `specs/014-session-ai-chat/contracts/openapi.yaml` identically (also the discovery result outcome if it shares the enum)
- [X] T035 [US3] In `backend/src/unihelper/services/ai_settings_service.py`: include `use_proxy` in `view()`; `put()` accepts it and raises 409 `proxy_not_configured` when True with no proxy; add `"proxy"` to `OUTCOME_MESSAGES` / outcome mapping in `backend/src/unihelper/services/ai_endpoint_service.py`
- [X] T036 [US3] In `backend/src/unihelper/services/ai_endpoint_service.py` `test()` and model discovery: `proxy = proxy_service.route(db, user.id, "ai", cfg.base_url)`, set `cfg.proxied`, open the client with `proxy_service.client(proxy, transport)`
- [X] T037 [US3] In `backend/src/unihelper/chat/runs.py` `_run`: resolve the proxy when the run is created (where `cfg` is built, in the DB thread) via `proxy_service.route(db, user_id, "ai", cfg.base_url)`, carry it on the run state, set `cfg.proxied`, open the client with `proxy_service.client(proxy, self._transport())`
- [X] T038 [US3] Use `UseProxySwitch` (with `localHint`) in `frontend/src/features/settings/ai/AiSettings.tsx`, saving `useProxy` through the existing AI settings mutation in `frontend/src/features/settings/ai/api.ts`

**Checkpoint**: all three stories work independently.

---

## Phase 6: Polish & Cross-Cutting

- [X] T039 Regenerate `frontend/openapi.json` and `frontend/src/lib/api/schema.d.ts` again after US2/US3 schema changes; `corepack pnpm typecheck`
- [X] T040 [P] Extend the leak check in `backend/tests/conftest.py` so registered proxy passwords are also searched in the data dir's files and the backup zips (SC-004); confirm `uv run pytest` (full run) passes, including the "every contract operation exercised" gate for the 4 new operations
- [X] T041 [P] Add a test in `backend/tests/unit/test_proxy_routing.py` asserting SOCKS5 uses remote DNS (the httpcore SOCKS request carries the hostname, not a resolved IP) — research R3; if false, note it in `specs/021-provider-proxy/research.md`
- [X] T042 Run `uv run ruff check . && uv run mypy` in `backend/` and `corepack pnpm lint && corepack pnpm test` in `frontend/`
- [ ] T043 Manual quickstart validation (`specs/021-provider-proxy/quickstart.md` scenarios 1–9) including keyboard-only and light/dark checks; build the desktop backend and run `unihelper.desktop.smoke` to confirm `socksio` is bundled

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T011)** → stories.
- T006 needs T003–T005; T007 needs T003/T004; T009/T010 independent of T007.
- **US1 (T012–T022)** needs Foundational. US2 and US3 need the `ProxySettings` row and
  `proxy_service.route` (Foundational) and, for their 409 check / UI link, US1's T015 (`put`) and
  T020 (`useProxy` hook) — implement US1 first.
- **US2** and **US3** are independent of each other; T029 (`UseProxySwitch`) is created in US2
  and reused by T038 — if US3 is done first, move T029 into US3.
- T019 after T014/T017; T039 after T026/T034.
- Polish after the stories you ship.

## Parallel Examples

- Foundational: T004, T005, T008, T011 together once T003 exists.
- US1: T012 + T013 + T014 + T020 in parallel; then T015 → T016 → T017; T021 → T022.
- US2: T023 + T024 + T025 in parallel; T026 → T027; T028 in parallel with T029 → T030.
- US3: T031 + T032 + T033 in parallel; T034 → T035 → T036/T037 (parallel, different files) → T038.

## Implementation Strategy

1. **MVP** = Setup + Foundational + US1: proxy can be saved/tested/deleted (no traffic routed yet).
2. Add **US2** (transcription routing) → validate quickstart scenarios 3, 5, 7.
3. Add **US3** (AI routing) → validate scenarios 4, 5, 6.
4. Polish: leak check, full test run, desktop bundle check.

## Implementation notes (2026-11-05)

- T003/T006: no `secret_id` column; the password is found by owner in `SecretStore` (data-model.md).
- T012/T023/T031: the US2/US3 contract tests live in `backend/tests/contract/test_proxy.py`
  next to US1's, rather than spread over `test_transcription_settings.py` / `test_ai.py`.
- T018: the backup check was added to `tests/integration/test_backup_contents.py` (the test that
  already asserts keys left out), not `test_backup_api.py`.
- T030/T038: the local-bypass hint is shown under the switch at all times, not only when the
  address is local.
- T040: proxy passwords are registered with `register_test_key`, so the existing log and
  chat-file leak checks cover them; the backup test asserts the password isn't in the zip.
- T043 (manual quickstart + desktop bundle smoke test) is not done: it needs a real proxy, a
  browser and a PyInstaller build.
