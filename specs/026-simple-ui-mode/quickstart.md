# Quickstart: validating Simple UI Mode

Prereqs: `cd backend && UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --port 8000`, `cd frontend && corepack pnpm dev`.

1. **Contract**: `uv run pytest tests/contract -k preferences` (uiMode accepted/rejected/persisted); then `uv run python -m unihelper.export_openapi ../frontend/openapi.json` and `corepack pnpm gen:api`.
2. **Default**: sign in as an existing user ⇒ Ultimate exactly as before (SC-005, FR-007).
3. **Switch**: Settings → Appearance → Interface → Simple (or account menu) ⇒ one sidebar + main, landing on the calendar; reload ⇒ still Simple; sign in elsewhere ⇒ Simple.
4. **Parity walk**: sidebar → Courses (grid of boxes) → open a course → open a class session ⇒ sidebar becomes the session sidebar (Calendar, Notes, PDFs, Recordings, Chat, Teacher, Time); open each ⇒ appears as a main-area tab; start a recording, switch to Ultimate ⇒ recording continues.
5. **Switch back** from the account menu in Simple ⇒ Ultimate, same page.
6. **Responsive/keyboard**: narrow viewport ⇒ menu button opens drawer; Tab/Esc work; axe passes.
7. **Automated**: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`; `corepack pnpm e2e`; `corepack pnpm build:demo && corepack pnpm e2e:demo`; `corepack pnpm check:no-demo`; full backend `uv run pytest`.
