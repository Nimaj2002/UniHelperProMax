# Quickstart: validating the Yuii tour

## Prerequisites

```bash
cd backend && UNIHELPER_DATA_DIR=./data-tour uv run uvicorn unihelper.main:app --reload --port 8000
cd frontend && corepack pnpm dev        # http://localhost:5173
```

A fresh data dir (`./data-tour`) gives a brand-new owner account.

## Automated checks

```bash
cd backend && uv run pytest tests/contract/test_preferences.py      # tour key (contracts/preferences-tour.md)
cd backend && uv run ruff check . && uv run mypy
cd frontend && corepack pnpm lint && corepack pnpm typecheck
cd frontend && corepack pnpm exec vitest run tests/unit/tour       # placement, engine, events, a11y (axe)
cd frontend && corepack pnpm exec playwright test tests/e2e/tour.spec.ts
cd frontend && corepack pnpm e2e                                   # whole suite still green (research R12)
```

## Manual scenarios

| # | Do | Expect |
|---|----|--------|
| 1 | Sign in to the fresh account | Yuii waves (greeting) with "Start the tour" / "Maybe later" (US1-1) |
| 2 | Start, press Next through the overview | Each area highlighted, rest dimmed; Yuii beside it, pointing at it, facing the right way; "Step N of M" (US1-2, US1-5) |
| 3 | Resize the window narrow (~900 px) on a step | Yuii shrinks, then only the bubble shows; target never covered (FR-025) |
| 4 | First-course chapter: create year, semester, course via the real forms | Yuii stays visible but passive beside each dialog; on success she cheers and the tour advances (US2-1, US2-2) |
| 5 | Submit a duplicate/reserved name | Normal form error; Yuii dizzy with a hint; step unchanged (US2-3) |
| 6 | Note chapter: type in the note | Yuii points at the save status once it says saved (US3-2) |
| 7 | PDF step: upload a PDF; recording step: deny the microphone | PDF opens and tour advances; mic denial → shy/dizzy hint, "Skip this step" works (US4) |
| 8 | AI chapter with no provider configured | Yuii explains that Settings → AI is needed (US5-2) |
| 9 | Settings chapter → Finish | Each section highlighted; final step points at the Yuii rail button (US6) |
| 10 | Reload; sign in from another browser | Tour does not start again (SC-004) |
| 11 | Yuii rail button → chapter "AI" | Tour jumps there (US7-2) |
| 12 | Replay with existing data, reach "create year" | "Use my existing year" offered; no duplicates (US7-3, SC-005) |
| 13 | Close the tab mid-chapter, reopen | "Continue from <chapter>" / "End tour" (FR-021) |
| 14 | Switch to dark and a custom theme; enable reduced motion | Readable bubble, no movement tweens (FR-023, FR-024) |
| 15 | Keyboard only, whole tour | Every step completable or skippable (SC-003) |
| 16 | Old account (data dir from before the feature) | Tour auto-starts once; creation steps offer existing items (FR-022) |
