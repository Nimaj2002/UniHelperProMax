# Research: Proxy for Transcription and AI Provider Requests

## R1 — Where the proxy is applied

- **Decision**: The proxy is applied in the backend, where `httpx.AsyncClient` is created for a
  provider. There are exactly five such places:
  1. `transcription/worker.py` `_run` (transcription jobs)
  2. `services/transcription_settings_service.py` `test` (Transcription "Test connection")
  3. `services/ai_endpoint_service.py` `test` (AI "Test")
  4. `services/ai_endpoint_service.py` model discovery
  5. `chat/runs.py` `_run` (chat streaming)

  Each of these talks to exactly **one** provider address, so the proxy decision is made once
  per client: `proxy_url = proxy_service.route(db, user_id, section, target_url)` returns the
  proxy URL or `None`, and the client is built as `httpx.AsyncClient(transport=..., proxy=...)`.
- **Rationale**: one decision point, no change to adapters (`ai/http.py`, provider classes).
  Works identically in browser and desktop modes (spec Assumption).
- **Alternatives**: `httpx` `mounts` with per-host patterns (unneeded: one host per client);
  setting `HTTPS_PROXY` env vars (process-wide, not per user, and would also affect other users
  — violates FR-002).

## R2 — Local addresses bypass the proxy (Clarification 2026-11-05)

- **Decision**: reuse `domain/ai_addresses.host_locality()` (no DNS; loopback, private, CGNAT,
  link-local, `localhost`, `*.local`, single-label names → local). `route()` returns `None` when
  the target host is local, regardless of the switch. Transcription addresses use the same
  function on the provider's `address` value.
- **Rationale**: it is already the app's definition of "local" (Features 005/014); no DNS
  lookup means a public name can't be pointed at a private IP to dodge the proxy.
- **Alternatives**: a user bypass list (out of scope per spec).

## R3 — Proxy protocols and the SOCKS dependency

- **Decision**: support `http://`, `https://` (TLS to the proxy) and `socks5://`. HTTP/HTTPS are
  built into httpx 0.28. SOCKS5 needs the `socksio` package (`httpx[socks]` extra).
  Add `httpx[socks]` to `backend/pyproject.toml`.
- **Justification (Constitution VII)**: `socksio` is a small, pure-Python, sans-I/O package from
  the httpx maintainers; SOCKS5 is the most common proxy type students get from VPN/SSH tools
  (`ssh -D`, Shadowsocks clients). No new infrastructure. PyInstaller spec must include it
  (verify with the desktop smoke test).
- **Note**: httpcore sends the target host name to the SOCKS5 proxy (remote DNS), so blocked
  DNS on the local network doesn't break proxied requests. **Verified** (2026-11-05):
  `httpcore/_async/socks_proxy.py` builds `SOCKS5CommandRequest.from_address(CONNECT, (host,
  port))` with the origin's host name; `tests/unit/test_proxy_routing.py` asserts the request is
  `DOMAIN_NAME`. SOCKS5 auth failures surface as `ProxyError("Invalid username/password")`.
- **Alternatives**: HTTP only (rejected: excludes the most common student setup).

## R4 — No silent fallback; how proxy failures are reported

- **Decision**: when `route()` returns a proxy, the client is built with only that proxy; there
  is no retry without it (FR-010). Failures are recognised in the existing classifiers:
  - `httpx.ProxyError` → proxy refused (status 407 → "credentials rejected"; other → "proxy
    couldn't reach the provider").
  - `httpx.ConnectError` / `ConnectTimeout` **while proxied** → "proxy unreachable" (the only
    host the client connects to is the proxy).
- AI: new `AiError` category `proxy` (test outcome `proxy`, chat `AnswerError.category`
  `proxy`). `EndpointConfig` carries the proxy URL itself (`proxy`, hidden from repr), set by
  `config_for`/`_draft_config`, so chat runs, tests and discovery need no extra lookup.
- Transcription: reuse the existing job `error_category = "unavailable"` with a proxy-specific
  message (avoids changing the `transcription_jobs` CHECK constraint); connection-test category
  gains `proxy`.
- The classifier is told whether the client is proxied (a `proxied: bool` passed alongside the
  config/provider), so a direct connection never shows a proxy message.

## R5 — Proxy credentials storage

- **Decision**: the password goes into the existing `SecretStore` with a new owner kind
  `proxy` (owner id = user id). The username is stored in plain text (it is an identifier, like
  the provider address), shown in full.
- The proxy URL with credentials is assembled only inside `route()` at the moment of use and is
  never logged; log lines carry only `proxied=true/false`.
- Backups: like API keys, the password is **left out** and listed in the manifest's
  `keysLeftOut` with kind `proxy` (the spec's "same rules as API keys").
- **Alternatives**: password in the proxy row (violates Principle IV).

## R6 — "Test proxy" target

- **Decision**: `POST /settings/proxy/test` sends `GET https://www.gstatic.com/generate_204`
  through the draft proxy with a 15 s budget; **any** HTTP response from the target counts as
  success (the proxy got through). Outcomes: `working`, `unreachable` (connect error/timeout to
  the proxy), `credentials_rejected` (407), `no_onward_connection` (other `ProxyError`, or TLS/
  connection failure after the proxy accepted), `timeout`, `invalid`.
- **Rationale**: a fixed, tiny, highly available endpoint; testing against a user's provider
  is already covered by that section's own "Test connection", which now honours the switch.
- Constant lives in `proxy_service.TEST_URL`; tests inject a transport.

## R7 — Where the switches live

- **Decision**: `transcription_settings.use_proxy` and `ai_settings.use_proxy` boolean columns
  (default false), returned/accepted by the existing `GET/PUT /settings/transcription` and
  `GET/PUT /ai/settings`. Deleting the proxy sets both to false in the same transaction (FR-006)
  and the response lists which were on.
- Saving `useProxy: true` when no proxy is saved → 409 `proxy_not_configured`.

## R8 — Testing approach

- Pure unit tests for `route()` (switch × locality × configured) and the error classifiers.
- Contract tests for the four new proxy operations and the changed settings schemas; tests use
  `httpx.MockTransport`, which raises `ProxyError`/`ConnectError` to simulate failures.
- Because an injected test transport makes httpx ignore `proxy=`, the client helper asserts the
  chosen proxy URL through a small seam (`proxy_service.client(proxy, transport)`), and one
  integration test runs a real in-process HTTP CONNECT proxy (asyncio, ~40 lines in
  `tests/fake_proxy.py`) against a local HTTPS-less target with the locality check stubbed.
- The full-run key-leak check (`conftest.pytest_sessionfinish`) gains the proxy password.
