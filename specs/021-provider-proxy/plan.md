# Implementation Plan: Proxy for Transcription and AI Provider Requests

**Branch**: `021-provider-proxy` | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/021-provider-proxy/spec.md`

## Summary

Each user can save one proxy (HTTP, HTTPS or SOCKS5, optional username/password) on a new
Settings → Proxy page and turn it on separately for Transcription and AI. The backend decides
per outgoing provider client: `route(user, section, target)` returns the proxy URL when the
section's switch is on and the target is a remote address, otherwise direct (local addresses
always bypass). The five places that open provider clients pass that proxy to `httpx`; there is
no fallback to direct. The password lives in the existing encrypted `SecretStore`. Proxy
failures are classified and shown with messages that name the proxy.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript / React 19 (frontend)

**Primary Dependencies**: FastAPI, SQLAlchemy, Alembic, httpx 0.28 (+ `socksio` via the
`httpx[socks]` extra, research R3); frontend: TanStack Query, shadcn/ui (`switch`, `select`,
`input`, `alert-dialog`), existing `KeyField`

**Storage**: SQLite — new `proxy_settings` table, `use_proxy` columns on
`transcription_settings` and `ai_settings`; password in `secrets` (owner kind `proxy`)

**Testing**: pytest (unit, contract against `contracts/openapi.yaml`, integration with an
in-process fake CONNECT proxy); Vitest + Testing Library + axe; Playwright not required

**Target Platform**: local web app and Electron desktop (Windows/macOS/Linux)

**Project Type**: web application (backend + frontend) with desktop wrapper

**Performance Goals**: proxy test finishes or reports within 15 s; routing decision adds no
network round trip (no DNS lookup, research R2)

**Constraints**: single process; no process-wide proxy env vars (per-user isolation, FR-002);
no fallback to direct when proxied (FR-010); password never in responses, logs or files

**Scale/Scope**: one proxy per user; 4 new operations; 5 client construction sites; 1 new
settings page + 2 switches

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. User work never lost | Proxy failure fails the job/run through the existing paths: recording untouched, chat message and partial reply kept, retry available (FR-012). Proxy delete needs confirmation. | Pass |
| II. Data ownership & open formats | No user files change; password excluded from backup and listed under keys left out. | Pass |
| III. Frontend/backend separation | New UI talks only to `/api/v1/settings/proxy*`; additive schema fields, no version bump. | Pass |
| IV. Pluggable providers & secrets | Password encrypted in `SecretStore`, masked in API, never logged; proxy URL with credentials built only at use time. Applies to every provider equally via one routing function. | Pass |
| V. UI quality & accessibility | shadcn primitives, theme tokens, keyboard operable, labelled switch with link when disabled, verified light/dark + axe. | Pass |
| VI. Test coverage | Contract tests for all 4 operations (success + 409/412/422/428/404), unit tests for routing/classification, integration test with a fake proxy, leak check extended. | Pass |
| VII. Simplicity & spec discipline | One new dependency (`socksio`, justified in R3); no new infrastructure; no abstraction beyond one `route()` + client helper. | Pass (justified) |
| VIII. Desktop data safety | Proxy is outbound only; backend stays bound to 127.0.0.1. `socksio` added to the PyInstaller spec. | Pass |

**Post-design re-check**: Pass — design artifacts introduce nothing beyond the above.

## Project Structure

### Documentation (this feature)

```text
specs/021-provider-proxy/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/openapi.yaml
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml                          # httpx → httpx[socks]
├── packaging/unihelper-backend.spec        # hidden import socksio
├── src/unihelper/
│   ├── db/migrations/versions/0018_provider_proxy.py   # new table + 2 columns
│   ├── models/proxy.py                     # ProxySettings (new); secret.py OWNER_KINDS += "proxy"
│   ├── models/transcription.py, ai_endpoint.py          # use_proxy columns
│   ├── schemas/proxy.py                    # new; settings.py / ai.py gain use_proxy
│   ├── services/proxy_service.py           # get/put/delete/test, route(), client()
│   ├── services/transcription_settings_service.py       # use_proxy save; test routes via proxy
│   ├── services/ai_settings_service.py     # use_proxy save
│   ├── services/ai_endpoint_service.py     # test + discovery route via proxy
│   ├── chat/runs.py                        # chat client routes via proxy
│   ├── transcription/worker.py             # job client routes via proxy
│   ├── transcription/openai_client.py      # proxy-aware transport errors
│   ├── ai/errors.py                        # proxy category/messages
│   ├── backup/manifest.py, writer.py, schemas/backup.py # keysLeftOut kind "proxy"
│   └── api/v1/settings.py                  # /settings/proxy routes
└── tests/
    ├── unit/test_proxy_routing.py, test_proxy_errors.py
    ├── contract/test_proxy.py              # + updates to settings/ai contract tests
    ├── integration/test_proxy_end_to_end.py
    ├── fake_proxy.py                       # tiny asyncio CONNECT/forward proxy
    └── conftest.py                         # leak check includes proxy password

frontend/src/features/settings/
├── proxy/ProxySettings.tsx, api.ts         # new page
├── UseProxySwitch.tsx                      # shared switch (disabled + link when no proxy)
├── transcription/TranscriptionSettings.tsx # uses switch
├── ai/AiSettings.tsx                       # uses switch
├── SettingsLayout.tsx, routes.tsx          # "Proxy" nav entry + route
frontend/tests/unit/ProxySettings.test.tsx, UseProxySwitch.test.tsx
frontend/openapi.json, src/lib/api/schema.d.ts   # regenerated
specs/005-…/contracts/openapi.yaml, specs/014-…/contracts/openapi.yaml  # additive useProxy/proxy fields
```

**Structure Decision**: existing web-app layout (`backend/` + `frontend/`); the feature adds one
service and one settings page, and touches the five provider client sites listed in research R1.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New dependency `socksio` (`httpx[socks]`) | SOCKS5 is in the spec's supported types and the most common student proxy setup | HTTP-only would exclude SSH `-D` / Shadowsocks users |
