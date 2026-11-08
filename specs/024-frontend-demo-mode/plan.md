# Implementation Plan: Frontend-Only Demo Mode

**Branch**: `024-frontend-demo-mode` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/024-frontend-demo-mode/spec.md`

## Summary

Build the existing React frontend a second way — Vite mode `demo` — where MSW's Service Worker
answers every `/api/v1` request from an in-memory store seeded with a realistic student
workspace. The real screens run unchanged; the only production-code change is one guarded line
in `main.tsx` that Vite removes from normal builds. Simulated AI/transcription stream canned
text; recording, uploads, provider setup, backup and account actions show an "available in the
app" toast. A fixed banner (reusing the shell's `--titlebar-h` slot) offers Reset and Download.
The output `dist-demo/` deploys as a static Vercel site; the website links to it.

## Technical Context

**Language/Version**: TypeScript ~5.9, React 19, Vite 8 (existing frontend)

**Primary Dependencies**: existing stack + **msw 2.x** (new, devDependency; bundled only into
the demo build)

**Storage**: in-memory per tab; no localStorage for demo state (only clears the app's `uh.*` caches)

**Testing**: Vitest + Testing Library (handlers via `msw/node`), Playwright (`playwright.demo.config.ts` against `vite preview`)

**Target Platform**: evergreen desktop and mobile browsers with Service Worker support

**Project Type**: web frontend (build variant) + static marketing site link

**Performance Goals**: populated home screen < 5 s on broadband (SC-001); streamed replies feel live (~30 ms per token chunk)

**Constraints**: zero requests to other origins; normal `dist/` byte-for-byte free of demo code; sample assets < 1 MB total

**Scale/Scope**: ~216 API operations; ~150 answered statefully, the rest via "available in the app" / fallback (contracts/demo-mode.md)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. User work never lost | ✅ (justified) | Demo holds no real user work; banner on every screen says changes aren't saved (spec Constitution Notes). Real app autosave untouched. Transcription and append-to-note stay append-only in the demo. |
| II. Data ownership & open formats | ✅ N/A | Demo writes no files; real storage unchanged. |
| III. Frontend/backend separation | ✅ | Screens still use the same `/api/v1` client and contracts; only the demo build answers them in-browser. No API change, no new version. |
| IV. Providers & secrets | ✅ | No keys exist in the demo; provider setup endpoints are "available in the app". |
| V. UI quality & a11y | ✅ | Banner/dialog/toast use shadcn primitives + theme tokens; keyboard reachable; axe check in `e2e:demo`. |
| VI. Tests | ✅ | No endpoints added. Handlers unit-tested; demo E2E; `check:no-demo` guards real builds. Critical-flow integration tests unchanged. |
| VII. Simplicity & spec discipline | ✅ (justified) | One new dependency (msw) — see Complexity Tracking. No new infrastructure. |
| VIII. Desktop data safety | ✅ | Desktop consumes the normal `dist/`, which contains no demo code. |

**Post-design re-check**: unchanged — all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/024-frontend-demo-mode/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R14 decisions
├── data-model.md        # DemoStore + handler rules
├── quickstart.md        # validation guide
├── contracts/
│   └── demo-mode.md     # build commands, operation handling, demo UI surface
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
frontend/
├── src/
│   ├── main.tsx                 # + one guarded `import.meta.env.MODE === "demo"` block
│   └── demo/                    # NEW — only reachable from that block
│       ├── start.ts             # SW support check, clear uh.* keys, patch getUserMedia,
│       │                        #   start MSW worker, mount banner
│       ├── store.ts             # DemoStore type, createStore(), id/version helpers
│       ├── seed.ts              # createSeed(now, timeZone)
│       ├── canned.ts            # chat replies, transcript, teacher content
│       ├── unavailable.ts       # demoUnavailable(label) → toast + 403 problem
│       ├── handlers/            # one file per group in contracts/demo-mode.md §2–4
│       │   ├── index.ts         #   (bootstrap, calendar, notes, documents, recordings,
│       │   └── *.ts             #    transcription, chat, teacher, tasks, time, themes, misc)
│       ├── DemoBanner.tsx       # banner + reset confirm dialog
│       └── assets/              # lecture-week3.pdf, lecture-week3.webm, README.md (licences)
├── tests/
│   ├── unit/demo/               # handler tests under msw/node, seed-date test, banner a11y
│   └── e2e-demo/                # Playwright scenarios from quickstart.md
├── playwright.demo.config.ts    # NEW — preview server for dist-demo, blocks foreign origins
├── scripts/check-no-demo.mjs    # NEW — fails if dist/ contains demo marker / SW script
├── vite.config.ts               # + demo-mode plugin (serve/emit mockServiceWorker.js,
│                                #   outDir dist-demo, port 5174, no /api proxy)
├── package.json                 # + msw; scripts dev:demo, build:demo, check:no-demo, e2e:demo
└── vercel.json                  # NEW — demo site: build, output, SPA rewrite, CSP

website/index.html               # + "Try the demo" links (hero, download)
```

**Structure Decision**: Everything demo-specific lives in `frontend/src/demo/`, imported only
through the guarded block in `main.tsx`. No feature module, shell, or API client file changes.
The backend, desktop and contracts under other specs are untouched.

## Known limits (accepted)

- Choosing "upload" still opens the OS file picker before the toast appears (R6).
- Browsers without Service Workers (some private windows) get a "use a normal window" page (R14).
- Server-side validation is only re-implemented for required fields and simple limits; deeper
  rules (e.g. complex recurrence edits) may accept input the real app would reject.
- Search is plain substring matching, not the backend's ranking.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|-------------------------------------|
| `msw` devDependency | One interception point for fetch, XHR, EventSource, `<audio>`/PDF worker and download requests without touching production code (R1) | Patching `fetch`/XHR/`EventSource` misses media, worker and download requests; a hand-written Service Worker re-implements MSW's routing and client resolution |
| `src/demo/` in-browser API layer | The demo must run with no server (FR-001) and keep the real screens (FR-003) | A separate mock UI would drift from the product and double the UI work |
