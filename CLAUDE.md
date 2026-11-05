# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

UniHelperProMax: a university-student workspace (calendar, per-session Markdown notes, PDF reader,
lecture recording + transcription, AI chat, task board). Python/FastAPI backend over SQLite + a
plain-file store, a React 19 + Vite + shadcn/ui frontend, and an Electron desktop wrapper.

## Commands

Backend (`backend/`, uses `uv`, Python 3.12+):

```bash
UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --reload --port 8000   # dev server
uv run ruff check . && uv run mypy          # lint + strict type check (mypy covers src/ only)
uv run pytest                               # all tests (unit, contract, integration)
uv run pytest tests/contract/test_ai.py::test_name   # single test
uv run pytest -m unit                       # markers: unit, contract, integration, slow
UNIHELPER_SLOW_TESTS=1 uv run pytest tests/integration/test_backup_performance.py
uv run python -m unihelper.export_openapi ../frontend/openapi.json   # dump live OpenAPI
UNIHELPER_DATA_DIR=./data uv run unihelper reset-owner-password       # operator CLI
```

Frontend (`frontend/`, pnpm via corepack):

```bash
corepack pnpm dev           # http://localhost:5173, proxies /api to :8000
corepack pnpm lint && corepack pnpm typecheck
corepack pnpm test          # Vitest + Testing Library + axe
corepack pnpm exec vitest run tests/unit/TaskCard.test.tsx   # single test file
corepack pnpm e2e           # Playwright (starts its own backend/frontend/fake transcriber)
# ports busy? E2E_BACKEND_PORT=8010 E2E_FRONTEND_PORT=5183 E2E_TRANSCRIBER_PORT=8021 corepack pnpm e2e
corepack pnpm gen:api       # regenerate src/lib/api/schema.d.ts from frontend/openapi.json
```

Desktop (`desktop/`, npm): `npm run dev` runs the backend from source (`backend/.venv`) with its own
profile in `data-desktop-dev/` on port 47823; frontend changes need `pnpm --dir ../frontend build`
first. Installers: `scripts/build-desktop.sh` / `.ps1` from the repo root. See `desktop/README.md`.

## Architecture

**Backend (`backend/src/unihelper/`)** — layered:
- `api/v1/*` — one FastAPI router per resource, all under `/api/v1`. Errors are RFC 9457 problem
  documents (`api/errors.py`); mutating requests need the CSRF header (`api/deps.py`), and
  optimistic concurrency uses `If-Match`.
- `services/*` — business logic; `schemas/*` — Pydantic request/response models; `models/*` —
  SQLAlchemy models; `domain/*` — pure logic (recurrence, iCal, file naming, WebM/Ogg parsing).
- `storage/storage_service.py` — the only code that touches the user file tree.
- `ai/` — AI chat providers behind one interface (`base.py`; OpenAI-compatible, Anthropic, Gemini)
  with SSE streaming; `chat/` runs chats in the background (`RunRegistry`).
- `transcription/` — pluggable transcription providers + background worker.
- `secrets/` — provider API keys, AES-GCM encrypted; the key lives in the OS keyring or a user
  file outside the data dir.
- `backup/` — zip backup/restore jobs, with a safety backup before restore and crash recovery.
- `desktop/` — desktop-mode handshake, owner and admission logic used by the Electron shell.
- `db/migrations/` — Alembic; migrations run automatically on startup (`main.create_app`).

**Single process only.** Note saves and transcript appends are serialized by an in-process lock;
`single_process.py` holds `<data>/server.lock` so a second server on the same data dir refuses to
start. Never add `--workers`.

**Data layout.** SQLite holds metadata only; note bodies, audio, PDFs, annotations (sidecars) and
chats (JSON + regenerated `.md`) live as plain files under
`<data>/files/<user>/<Year>/<Semester>/<Course>/<class-date>/{notes,audios,documents,chats}/`,
events under a reserved events folder per semester, and loose notes in `<user>/General Notes/`.

**API contracts.** Each feature's contract is `specs/NNN-*/contracts/openapi.yaml`. Contract tests
validate responses against these (`tests/contract/openapi_check.py`), and a **full** `pytest` run
fails if any contract operation is never exercised, or if an API key leaks into a response or
chat file (`tests/conftest.py::pytest_sessionfinish`; skipped for focused runs). Tests use
in-process fakes for the LLM and transcriber (`tests/fake_llm.py`, `tests/fake_transcriber.py`).
When you change an endpoint, update the spec's `openapi.yaml`, regenerate `frontend/openapi.json`
and `schema.d.ts`.

**Frontend (`frontend/src/`)**: `app/` (router, providers, theme, shell), `features/<area>/` per
domain, `components/ui/` shadcn primitives, `lib/api/client.ts` (typed fetch wrapper → `ApiError`)
with TanStack Query on top. `src/sandbox/` is a separately built script (`vite.sandbox.config.ts`)
that renders Mermaid inside a sandboxed iframe; `dev`/`build` build it first.

**Desktop (`desktop/src/`)**: Electron main process that launches a PyInstaller-bundled backend
(`backend/packaging/unihelper-backend.spec`) bound to 127.0.0.1 and loads the built frontend from it.
Release builds via `.github/workflows/desktop-release.yml`.

## Rules from the constitution (`.specify/memory/constitution.md` — it wins on conflicts)

- Never lose user work: notes autosave, recordings persist in chunks, **transcription only appends
  to a note**, destructive actions need confirmation.
- Frontend talks to the backend only via `/api/v1`; breaking changes need a new API version.
- API keys are never returned in full (masked only), never logged, never written to files.
- SQLite is the only database; no new infrastructure. New dependencies/abstractions must be
  justified in the feature plan.
- UI: shadcn/ui primitives, theme tokens only (no hard-coded colors), works in light/dark/custom
  themes, fully keyboard operable, WCAG AA. Design follows the `design-taste-frontend` skill.
- Every endpoint needs tests for success and main error cases.
- Features follow Spec Kit: specify → clarify → plan → tasks → implement (`/speckit-*` skills,
  artifacts in `specs/NNN-*/`). Don't implement outside an approved spec. Known bugs live in
  `specs/KNOWN-ISSUES.md`.
- Releases: `scripts/tag.sh X.Y.Z` updates the version everywhere, commits "Release X.Y.Z" and
  tags `vX.Y.Z`. It does not push. Don't edit version numbers by hand.
