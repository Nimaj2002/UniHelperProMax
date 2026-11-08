# Research: Frontend-Only Demo Mode

## R1. How the demo answers the app's API calls

The frontend reaches `/api/v1` through five paths, not one:

| Path | Where |
|------|-------|
| `fetch` via `apiFetch` | `src/lib/api/client.ts` (almost everything) |
| raw `fetch` | recording chunks (`features/recordings/api.ts`), calendar export, task export |
| `XMLHttpRequest` | uploads with progress (`src/lib/api/upload.ts`) |
| `EventSource` | chat / teacher run streams (`src/lib/api/stream.ts`) |
| element / worker URLs | `<audio src>` recordings, PDF reader `src` (EmbedPDF engine fetch), `<img src>` chat files, `<a href>` CSV / backup downloads |

- **Decision**: Use **MSW 2.x in the browser** (Service Worker mode). One set of request handlers
  answers all five paths, because the Service Worker sees every request the page and its
  dedicated workers make, including media element and download requests.
- **Rationale**: Zero changes to production request code (FR-013). Handlers run in the page's
  main thread, so the in-memory store lives in tab memory: it is per-tab and gone on reload by
  construction (FR-007). The same handlers run under `msw/node` in Vitest, so the demo's logic
  is unit-testable without a browser.
- **Alternatives considered**:
  - *Patch `window.fetch` / XHR / `EventSource`*: misses `<audio src>`, PDF worker fetches and
    download links; covering those would need production code changes (blob URLs). Rejected.
  - *Hand-written Service Worker*: the same mechanism as MSW minus routing, request parsing,
    client resolution for worker requests and the SSE helper. More code to own for no gain.
  - *A real backend compiled to WebAssembly (Pyodide)*: the backend needs SQLite files,
    keyring, background threads; far too heavy for a marketing demo. Rejected.

## R2. Keeping the demo out of normal builds

- **Decision**: A Vite **mode** `demo`. `main.tsx` wraps its render in `render()` and gains one
  guarded block: `if (import.meta.env.MODE === "demo") void import("./demo/start").then((m) => m.startDemo()).then(render); else render();`
  (no top-level await: Vite's default build target doesn't allow it). Vite replaces `import.meta.env.MODE` with a string literal at build time,
  so in normal builds the branch is dead and the `./demo/*` chunk (handlers, seed, assets, MSW)
  is never emitted. Demo builds go to `frontend/dist-demo/`; `dist/` is untouched.
- The Service Worker script (`mockServiceWorker.js`) is **not** placed in `public/` (that would
  ship it in every build). A small inline Vite plugin, active only in demo mode, serves it in
  dev and emits it in build from `msw`'s package.
- **Verification**: a check script/test greps `dist/` for a demo marker string and for
  `mockServiceWorker` and fails if found (SC-005). The desktop packaging already uses the normal
  `build` script, so it inherits this guarantee.
- **Alternatives**: a separate Vite entry HTML (`demo.html`): also works, but duplicates the
  bootstrap and theme-boot wiring; the one-line guarded import is smaller.

## R3. Requests from the PDF engine's worker

- EmbedPDF's PDFium engine runs in a dedicated worker and may fetch the document URL from there.
  MSW's worker resolves the controlling window client for requests that come from a dedicated
  worker, so the handler in the page still answers them.
- **Risk**: if the engine version fetches in a way the Service Worker does not intercept, the
  fallback is a demo-only handler that is unaffected (the PDF fetch is then served as a static
  file at the same URL by placing the sample PDF in `dist-demo` and a rewrite). Verified in the
  quickstart (scenario 4) before the rest of the work depends on it.
- **Outcome (verified 2026-11-09)**: the PDF loads through the handler (`application/pdf`, served by
  the Service Worker) and renders with its seeded highlights; no fallback needed. The reader also
  loads a stamp library from `cdn.jsdelivr.net` and a font from Google Fonts — the real app does
  too. The demo answers those in the Service Worker (`handlers/fallback.ts`), so nothing leaves the
  tab; the E2E origin guard checks this at the network layer.

## R4. Audio playback and seeking

- `<audio>` sends `Range` requests. The handler for `GET /recordings/{id}/audio` returns
  `206 Partial Content` with `Content-Range` for ranged requests and `200` otherwise, from an
  `ArrayBuffer` of the bundled sample file. Without this, seeking fails in Chromium.

## R5. Streaming AI replies

- **Decision**: `POST` that starts a chat / teacher run returns the run ids as the real API
  does; `GET /chat-runs/{id}/events` returns a `text/event-stream` response built from a
  `ReadableStream` that emits `start`, a series of `delta` events with small delays, then
  `done`, with `id:` lines so the existing `subscribeRun` logic is exercised unchanged.
- Canned replies are picked by simple keyword match on the question (e.g. "summar", "quiz",
  "explain"), falling back to a generic answer. Every reply ends with a one-line note that it is
  a demo answer (FR-008).
- MSW's `sse()` helper is an option; a plain streamed `HttpResponse` is used if it keeps the
  handler simpler. Either is internal to the demo.

## R6. "Available in the app" actions

- **Decision**: a single `demoUnavailable(feature)` helper used by handlers for the operations
  listed in contracts/demo-mode.md §3. It (a) shows a sonner toast (the app already mounts a
  `Toaster`; `toast()` is a global store) with a "Download the app" link, and (b) returns a
  problem document `403 { code: "demo_unavailable" }` so the calling screen stops cleanly.
- **Microphone**: the recorder calls `getUserMedia` *before* any API request, so a handler
  alone would trigger the browser's permission prompt. `startDemo()` replaces
  `navigator.mediaDevices.getUserMedia` with a function that shows the same toast and rejects
  with `NotAllowedError`. No permission prompt is ever shown (FR-010).
- **File uploads**: the OS file picker still opens (the app opens it before calling the API);
  choosing a file then produces the toast and nothing is stored. Acceptable: no device
  permission is involved. Recorded as a known limit in the plan.
- **Unknown operations**: any `/api/v1` request no handler matches gets the same treatment for
  mutating methods and a `404 not_found` problem for `GET`, so nothing ever produces a
  "server unreachable" state (edge case in spec).

## R7. Demo banner placement without touching the shell

- The shell already reserves top space through `--titlebar-h` (used by the desktop title bar:
  `AppShell.tsx` `pt-[max(0.5rem,var(--titlebar-h,0px))]`). `startDemo()` renders the banner in
  its own small React root, fixed to the top, and sets `--titlebar-h` to its height. No shell
  change is needed. The banner uses `Button`/`Badge` primitives and theme tokens only, so it
  follows light/dark/custom themes (theme lives on `<html>`).

## R8. Signed-in state and mode

- Handlers return `GET /setup/status → { needsOwner: false, mode: "web" }` and
  `GET /auth/me → { username: "demo-student", role: "member", mustChangePassword: false,
  timezone: <browser tz> }`. `member` hides the owner-only accounts admin screen; `web` mode
  hides desktop-only settings. Sign-out handler shows the "available in the app" toast.

## R9. Fresh state on every load

- In-memory store → reload resets server-side state automatically.
- The app also caches some per-account conveniences in `localStorage` (`uh.*`, e.g. the theme
  cache read by `public/theme-boot.js`). `startDemo()` removes `uh.*` keys before the app starts,
  so the theme and tour state also start fresh. Wrapped in try/catch (private mode).
- "Reset demo" in the banner: confirm dialog → clear `uh.*` → `location.reload()`.
- Tabs: memory is per tab; `localStorage` is shared but only holds caches the app re-derives
  from the API, which each tab's own store answers.

## R10. Dates relative to today

- The seed is a function `createSeed(now: Date, timeZone: string)`: the semester spans
  roughly today −6 weeks … +8 weeks; the seed expands each course's weekly class pattern into
  sessions itself (no recurrence engine in the demo); past sessions get notes, upcoming ones are
  empty; tasks get due dates around today. Creating a *new* recurring course in the demo
  expands only simple weekly patterns; anything else creates the course with its first session.

## R11. Sample assets and size

- **PDF**: a small (< 300 KB), original lecture-slide PDF written for the demo (e.g. "Intro to
  Algorithms — Week 3"). No third-party course material.
- **Audio**: a ~60 s original lecture clip (< 600 KB, Opus/WebM) — recorded by the maintainer or
  produced with an open TTS voice whose licence allows redistribution; licence noted in
  `src/demo/assets/README.md`.
- Assets are imported with `?url`/fetched by the handlers, so they land only in the demo chunk.

## R12. Contract fidelity

- Handlers and seed objects are typed with `Schemas[...]` from `src/lib/api/schema.d.ts`, so
  `tsc` rejects a response shape that does not match the API contract (FR-003), with no new
  validation dependency. The frontend already regenerates this file from the live OpenAPI.

## R13. Hosting

- A second Vercel project with root `frontend/`, build `corepack pnpm build:demo`, output
  `dist-demo/`, SPA rewrite to `index.html`, and a CSP that allows `'self'`, `blob:` and
  `wasm-unsafe-eval` (PDFium). Kept in `frontend/vercel.json`, which only Vercel reads. Domain
  `demo.unihelperpromax.tech` is configured in Vercel (deployment step, not code).

## R14. Browser support limit

- Service Workers are unavailable in some private-browsing modes (notably older Firefox). In that
  case `startDemo()` shows a full-page message "The demo needs a normal browser window" with the
  download link instead of a broken app. This is the one case where the demo does not run.
