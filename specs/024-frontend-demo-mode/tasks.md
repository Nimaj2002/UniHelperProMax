# Tasks: Frontend-Only Demo Mode

**Input**: Design documents from `specs/024-frontend-demo-mode/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/demo-mode.md, quickstart.md

**Tests**: Included. The constitution (Principle VI) and the plan require them: handler unit tests
under `msw/node`, a demo Playwright suite, and the `check:no-demo` guard.

**Paths**: all frontend paths are relative to `frontend/` unless they start with `website/` or
`specs/`. Response objects MUST be typed with `Schemas["…"]` from `src/lib/api/schema.d.ts`
(research R12). Every handler file exports `handlers: HttpHandler[]` and only reads/writes the
store from `src/demo/store.ts`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

**Purpose**: dependency, build mode and scripts. Nothing user-visible yet.

- [X] T001 Add `msw` 2.x (≥ 2.10) as a devDependency with `corepack pnpm add -D msw` in `package.json`; do NOT run `msw init` into `public/` (the worker script must not ship in normal builds, research R2)
- [X] T002 Add a demo-mode branch to `vite.config.ts`: export a function config `({ mode })`; when `mode === "demo"`: `build.outDir = "dist-demo"`, `server.port = 5174`, no `/api` proxy, and an inline plugin that serves `node_modules/msw/lib/mockServiceWorker.js` at `/mockServiceWorker.js` in dev (`configureServer` middleware) and emits it as an asset with that exact file name in build (`generateBundle` → `this.emitFile({ type: "asset", fileName: "mockServiceWorker.js", source })`). Non-demo config must stay byte-identical in behaviour
- [X] T003 Add scripts to `package.json`: `"dev:demo": "pnpm run build:sandbox && vite --mode demo"`, `"build:demo": "tsc -b && pnpm run build:sandbox && vite build --mode demo"`, `"check:no-demo": "node scripts/check-no-demo.mjs"`, `"e2e:demo": "playwright test -c playwright.demo.config.ts"`
- [X] T004 [P] Add `dist-demo/` to `frontend/.gitignore` (create the entry next to the existing `dist` ignore; check the repo-root `.gitignore` too)
- [X] T005 [P] Create `src/demo/assets/README.md` stating the source and licence of each sample asset (PDF written for the demo; audio from the maintainer or an open-licence TTS voice — name the voice and licence)

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the store, the MSW bootstrap, the "unavailable" helper and the fallback, so the app
starts in demo mode at all.

- [X] T006 Create `src/demo/store.ts`: `DemoStore` type with the collections listed in data-model.md "DemoStore" table (`me`, `preferences`, `years`, `semesters`, `courses`, `sessions`, `notes` (meta + Markdown `body`), `documents`, `recordings`, `transcriptions`, `chats`, `chatRuns`, `teacherChats`, `knowledgeGraph`, `taskColumns`, `tasks`, `quickNotes`, `timeEntries`, `timeTags`, `timer`, `themes`, `trash`, `nextId`); a module-level `let store` with `getStore()`/`resetStore(seed)`; helpers `newId(prefix)` returning `demo-<n>`, `bump(item)` that increments `version`, and `checkIfMatch(request, item)` that returns the real API's `412 version_conflict` problem when `If-Match` differs ("every mutable item carries `version`; each change increments it")
- [X] T007 Create `src/demo/http.ts` with response helpers used by all handlers: `json(body, status?)`, `problem(status, code, title, detail?, errors?, extra?)` returning `application/problem+json` in the RFC 9457 shape `apiFetch` parses (`code`, `title`, `detail`, `errors[{field,code,message}]`), `notFound()`, `validation(errors)` (`422`), and `noContent()` (`204`)
- [X] T008 Create `src/demo/unavailable.ts`: `demoUnavailable(label: string)` → calls `toast(\`${label} is available in the UniHelperProMax app.\`, { action: { label: "Download", onClick: () => window.open("https://www.unihelperpromax.tech/#download", "_blank", "noopener") } })` from `sonner` and returns `problem(403, "demo_unavailable", "Not available in the demo", \`${label} is available in the UniHelperProMax app.\`)` exactly as in contracts/demo-mode.md §3
- [X] T009 Create `src/demo/handlers/fallback.ts`: catch-all `http.all("/api/v1/*")` — `GET` → `notFound()`, other methods → `demoUnavailable("This action")` (contracts §4). It MUST be the last handler in the list
- [X] T010 Create `src/demo/handlers/index.ts` exporting `handlers` = concatenation of every group file's `handlers` in the order: bootstrap, calendar, notes, documents, recordings, transcription, chat, teacher, tasks, time, themes, settings, unavailable, fallback (create empty-array stub files for groups not yet written so the import compiles)
- [X] T011 Create `src/demo/start.ts` exporting `async function startDemo()`: (1) if `!("serviceWorker" in navigator)` render the full-page "Open the demo in a normal browser window" message with the download link into `#root` and throw to stop boot (research R14); (2) in try/catch remove every `localStorage` key starting with `uh.` (R9); (3) replace `navigator.mediaDevices.getUserMedia` with a function that calls `demoUnavailable("Recording")` and rejects with `new DOMException("Demo", "NotAllowedError")` (R6); (4) `resetStore(createSeed(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone))`; (5) `setupWorker(...handlers).start({ onUnhandledRequest: "bypass", serviceWorker: { url: "/mockServiceWorker.js" }, quiet: true })`; (6) include the literal string `UNIHELPER_DEMO_BUILD` (e.g. `console.info("UNIHELPER_DEMO_BUILD")`) as the build marker
- [X] T012 Edit `src/main.tsx`: before `createRoot(...)`, add `if (import.meta.env.MODE === "demo") await (await import("./demo/start")).startDemo();` (top-level await; keep everything else unchanged). Confirm `tsconfig.app.json` target allows top-level await; if not, wrap render in an async IIFE instead
- [X] T013 Create `src/demo/seed.ts` skeleton: `createSeed(now: Date, timeZone: string): DemoStore` returning an empty-but-valid store plus `me` (`username: "demo-student"`, `role: "member"`, `mustChangePassword: false`, `timezone`) and default `preferences` (tour NOT seen, so Feature 023 starts); later tasks fill collections
- [X] T014 Create `src/demo/handlers/bootstrap.ts`: `GET /api/v1/health`, `GET /api/v1/setup/status` → `{ needsOwner: false, mode: "web" }`, `GET /api/v1/auth/me`, `GET/PATCH /api/v1/preferences`, `PATCH /api/v1/auth/profile`
- [X] T015 Create `tests/unit/demo/setup.ts` helper: `setupServer(...handlers)` from `msw/node`, `beforeEach(() => resetStore(createSeed(FIXED_NOW, "Europe/Istanbul")))`, and a `api<T>(path, init?)` that calls the real `apiFetch` so tests exercise the production client
- [X] T016 Unit test `tests/unit/demo/bootstrap.test.ts`: `/setup/status` returns `mode: "web"`; `/auth/me` returns the demo student; an unknown `GET /api/v1/nope` rejects with `ApiError` status 404; an unknown `POST` rejects with code `demo_unavailable`

**Checkpoint**: `corepack pnpm dev:demo` opens the app signed in (empty workspace), no network errors.

---

## Phase 3: User Story 1 — Visitor opens a ready-made workspace (P1) 🎯 MVP

**Goal**: populated, browsable workspace with banner. **Independent test**: open the demo with
all foreign origins blocked; home, calendar, a session (notes, PDF, recording, chat), task board
and settings open without errors and the banner is visible.

### Tests for US1

- [X] T017 [P] [US1] Unit test `tests/unit/demo/seed.test.ts`: for two different `now` values, the semester contains `now`, has ≥ 3 courses, sessions both before and after `now`, ≥ 1 event, notes on several past sessions (one containing a ```` ```mermaid ```` block and one with `$…$` math), 1 document, 1 recording with a completed transcription, 1 chat, 3 task columns with tasks in each, ≥ 1 general note (FR-004, FR-005)
- [X] T018 [P] [US1] Unit test `tests/unit/demo/read-handlers.test.ts`: `/course-tree`, `/sessions?…`, `/sessions/{key}/notes`, `/notes/{id}`, `/sessions/{key}/documents`, `/sessions/{key}/recordings`, `/sessions/{key}/chats`, `/task-columns`, `/tasks`, `/themes` all resolve; `GET /recordings/{id}/audio` with `Range: bytes=0-99` returns 206 with `Content-Range` and 100 bytes; `GET /documents/{id}/file` returns `application/pdf`
- [X] T019 [P] [US1] Unit test `tests/unit/demo/DemoBanner.test.tsx`: renders region "Demo notice", Download link points to `https://www.unihelperpromax.tech/#download`, Reset opens a dialog, and `axe` reports no violations
- [X] T020 [P] [US1] Create `playwright.demo.config.ts`: one webServer `corepack pnpm exec vite preview --mode demo --outDir dist-demo --port 5184 --strictPort`, `baseURL` `http://localhost:5184`, projects chromium-light and chromium-dark, testDir `tests/e2e-demo`; NO microphone permission/fake-device flags (FR-010)
- [X] T021 [P] [US1] Create `tests/e2e-demo/fixtures.ts`: a `test` fixture that, on every page, records each request whose origin is not `http://localhost:5184` and fails the test in `afterEach` if any exist (SC-003)
- [X] T022 [US1] E2E `tests/e2e-demo/browse.spec.ts`: home loads with sample data within 5 s and no login screen (SC-001); banner visible on home, calendar, session, tasks, settings; each of those screens shows no error toast or "Can't reach the server" text (SC-002); open the sample session and see note text, the PDF list item, the recording and the chat; skip Yuii's tour first

### Implementation for US1

- [X] T023 [P] [US1] Create the sample PDF `src/demo/assets/lecture-week3.pdf` ("Intro to Algorithms — Week 3", 3–5 pages, original text, < 300 KB)
- [ ] T024 [P] [US1] Create the sample audio `src/demo/assets/lecture-week3.webm` (~60 s Opus, < 600 KB, original lecture on the same topic) and record its duration for the seed. **Open:** a 30 s placeholder WAV of soft tones ships for now (no TTS/ffmpeg on the build machine); replace it per `src/demo/assets/README.md`
- [X] T025 [P] [US1] Create `src/demo/canned.ts` with: `TRANSCRIPT` (text matching the audio), 4–6 chat replies keyed by keyword (`summar`, `explain`, `quiz`, `example`, default) each ending with the line "_(Demo answer — connect your own AI provider in the app.)_", and teacher content (3 questions, grades, a hint, a plan) (FR-008)
- [X] T026 [US1] Fill `src/demo/seed.ts`: year (current academic year), semester spanning today −6 weeks … +8 weeks, 3–4 courses (e.g. Algorithms, Linear Algebra, Academic Writing, + optional) each with a weekly pattern expanded into sessions; 1–2 events; Markdown notes on past sessions (headings, lists, one mermaid diagram, KaTeX math); the PDF document with 2–3 annotations on the most recent Algorithms session; the recording + completed transcription on the same session (transcript appended to its note); 1 chat with 2 turns; a teacher chat + knowledge graph with a few ideas; 3 task columns with ~8 tasks (due dates around today, one with a checklist and quick note); a week of time entries with 3 tags; 1 general note. All ids stable strings, all dates computed from `now` in `timeZone` (research R10)
- [X] T027 [P] [US1] GET handlers in `src/demo/handlers/calendar.ts`: `/course-tree`, `/years`, `/semesters`, `/courses`, `/courses/{id}`, `/classes/{lineageId}`, `/events/{lineageId}`, `/semesters/{id}/events/timeline`, `/courses/{id}/timeline`, `/sessions` (honour its query filters from the OpenAPI), `/sessions/{key}`, and all `*/deletion-impact`
- [X] T028 [P] [US1] GET handlers in `src/demo/handlers/notes.ts`: `/sessions/{key}/notes`, `/general-notes`, `/notes/{id}`, `/notes/search` (case-insensitive substring over title and body), `GET /workspace/{key}`
- [X] T029 [P] [US1] GET handlers in `src/demo/handlers/documents.ts`: `/sessions/{key}/documents`, `…/documents/hidden`, `/documents/{id}`, `/documents/{id}/file` (fetch the bundled PDF via its `?url` import, return `application/pdf`), `/documents/{id}/position`, `/annotations`, `/viewer-annotations`
- [X] T030 [P] [US1] GET handlers in `src/demo/handlers/recordings.ts`: `/sessions/{key}/recordings`, `/recordings/active` (none), `/recordings/{id}`, `/recordings/{id}/audio` with `Range` support → `206` + `Content-Range`/`Accept-Ranges: bytes`, else `200` (research R4)
- [X] T031 [P] [US1] GET handlers in `src/demo/handlers/chat.ts` and `src/demo/handlers/teacher.ts`: `/ai/styles`, `/ai/endpoints` (one "Demo AI" endpoint, no key, masked fields empty), `/ai/settings`, `/sessions/{key}/chats`, `/chats/{id}`, `/sessions/{key}/chat-drafts`, `/chat-runs/active`; `/sessions/{key}/teacher-chats`, `/teacher-chats/{id}`, `/teacher-chats/{id}/graph-impact`, `/teacher/instructions`, `/knowledge-graph`, `/knowledge-graph/ideas`, `/knowledge-graph/ideas/{id}`
- [X] T032 [P] [US1] GET handlers in `src/demo/handlers/tasks.ts`, `src/demo/handlers/time.ts`, `src/demo/handlers/themes.ts`, `src/demo/handlers/settings.ts`: `/task-columns`, `/tasks`, `/tasks/{id}`, `/tasks/{id}/quick-notes`; `/time/timer`, `/time/entries`, `/time/tags`; `/themes`, `/themes/{id}`, `/trash`; `/settings/transcription`, `/settings/proxy`, `/secrets/status` (nothing configured), `/transcription/providers` (one "Demo transcriber"), `/transcription/status`, `/transcriptions`, `/transcriptions/active`, `/sessions/{key}/transcriptions`, `/transcriptions/{id}`
- [X] T033 [US1] Create `src/demo/DemoBanner.tsx`: fixed top bar (`role="region"`, `aria-label="Demo notice"`), text "You're trying the demo — changes aren't saved.", shadcn `Button` "Reset demo" opening a shadcn `AlertDialog` ("Reset the demo? Your changes will be lost." → Reset / Cancel; Reset clears `uh.*` keys in try/catch and calls `location.reload()`), and a `Button asChild` link "Download the app" to `https://www.unihelperpromax.tech/#download` (`target="_blank" rel="noopener"`). Theme tokens only (e.g. `bg-primary text-primary-foreground`), visible focus rings, no hard-coded colours (Principle V)
- [X] T034 [US1] In `src/demo/start.ts`, after the worker starts, mount `DemoBanner` in its own root (`<div id="demo-banner">` inserted before `#root`), measure its height with a `ResizeObserver` and set `document.documentElement.style.setProperty("--titlebar-h", \`${h}px\`)` so `AppShell` leaves room (research R7)
- [X] T035 [US1] Verify the PDF-worker risk (research R3) with quickstart scenario 4 in `corepack pnpm dev:demo`; if the PDF does not load through the handler, implement R3's fallback (copy the PDF into the build output at `/api/v1/documents/<seedId>/file` via the demo Vite plugin) and note the outcome in `specs/024-frontend-demo-mode/research.md` R3

**Checkpoint**: US1 independently testable — `build:demo` + `e2e:demo` browse.spec passes.

---

## Phase 4: User Story 5 — The real app is unaffected (P1)

**Goal**: prove normal and desktop builds contain no demo code. **Independent test**: build
normally; `check:no-demo` passes and existing tests pass unchanged.

- [X] T036 [P] [US5] Create `scripts/check-no-demo.mjs`: walk `dist/` recursively; exit 1 with the offending file names if any file contains `UNIHELPER_DEMO_BUILD` or `mockServiceWorker`, or if `dist/mockServiceWorker.js` exists; exit 1 if `dist/` is missing; otherwise print "dist/ is demo-free"
- [X] T037 [US5] Run `corepack pnpm build && corepack pnpm check:no-demo`, then `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`; fix any leak (e.g. a static import of `src/demo/*` outside the guarded block) — existing test expectations MUST NOT be edited (SC-005)
- [X] T038 [P] [US5] Add a `check:no-demo` step after the frontend build in `.github/workflows/desktop-release.yml` (and in any other workflow that builds the frontend — grep `.github/workflows/` for `pnpm build`). **Done as:** the release workflow builds through `scripts/build-desktop.sh`/`.ps1`, so the check runs there, plus in the `Dockerfile` frontend stage

**Checkpoint**: real builds verified clean.

---

## Phase 5: User Story 2 — Visitor edits things and sees the app react (P1)

**Goal**: create/edit/move/delete with version checks, per-tab state, reset. **Independent
test**: edit note, create+move task, add event, switch theme; all persist while navigating;
reload restores the sample data.

### Tests for US2

- [X] T039 [P] [US2] Unit test `tests/unit/demo/mutations.test.ts`: `PUT /notes/{id}/content` with the current version saves and bumps `version`; with a stale `If-Match` → 412 `version_conflict`; creating a task then `POST /tasks/{id}/move` changes its column; deleting a class series (scope `all`) adds a trash entry and `POST /trash/{id}/restore` brings it back with its notes; creating a course with an empty name → 422 with a field pointer; deleting a course removes its sessions' notes/documents/recordings/chats into one trash entry
- [X] T040 [P] [US2] E2E `tests/e2e-demo/edit-reset.spec.ts`: quickstart scenario 3 (note edit shows saved and survives navigation; task move; new event appears in calendar; dark theme applies) then reload → all reverted; repeat via banner Reset → confirm; second tab (`context.newPage()`) shows original data (US2 scenario 4)

### Implementation for US2

- [X] T041 [P] [US2] Mutations in `src/demo/handlers/calendar.ts`: `POST /years`, `PUT /years/order`, `PATCH/DELETE /years/{id}`, `POST /semesters`, `PATCH/DELETE /semesters/{id}`, `POST /courses`, `PATCH/DELETE /courses/{id}`, `POST /classes` (expand simple weekly patterns into sessions, else create the first session only — research R10), `POST /events`, `PATCH/DELETE /sessions/{key}`, `POST /creations/undo`. Rules from data-model.md: "Referential cleanup: deleting a course/semester/year removes its sessions and their notes, documents, recordings and chats (into trash as one entry …)"; "Validation: required fields and simple limits (empty titles, end before start) return the same `422` problem shape with field pointers"
- [X] T042 [P] [US2] Mutations in `src/demo/handlers/notes.ts`: `POST /sessions/{key}/notes`, `POST /general-notes`, `PATCH/DELETE /notes/{id}`, `PUT /notes/{id}/content` (`checkIfMatch` + `bump`), `PUT /workspace/{key}`; deletes go to trash
- [X] T043 [P] [US2] Mutations in `src/demo/handlers/documents.ts` and `src/demo/handlers/recordings.ts`: `PATCH/DELETE /documents/{id}`, `PUT/DELETE /sessions/{key}/documents/{id}/hidden`, `PUT /documents/{id}/position`, `POST /documents/{id}/annotations/ops`, `PUT /documents/{id}/viewer-annotations`; `PATCH/DELETE /recordings/{id}`
- [X] T044 [P] [US2] Mutations in `src/demo/handlers/tasks.ts`: `POST /task-columns`, `PUT /task-columns/order`, `PATCH/DELETE /task-columns/{id}`, `POST /tasks`, `PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/restore`, `POST /tasks/{id}/move`, `PUT /tasks/{id}/checklist`, `POST /tasks/{id}/quick-notes`, `PATCH/DELETE /quick-notes/{id}`, `POST /quick-notes/{id}/restore`
- [X] T045 [P] [US2] Mutations in `src/demo/handlers/time.ts`: `PATCH /time/timer` and every `POST /time/timer/*` action following the real `idle`/`running`/`paused` transitions; `POST /time/entries`, `PATCH/DELETE /time/entries/{id}`, `POST /time/entries/{id}/restore`; `POST /time/tags`, `PATCH/DELETE /time/tags/{id}`
- [X] T046 [P] [US2] Mutations in `src/demo/handlers/themes.ts`: `POST /themes`, `PUT/DELETE /themes/{id}`, `POST /trash/{id}/restore`, `DELETE /trash/{id}`
- [X] T047 [P] [US2] Local exports in `src/demo/handlers/exports.ts` (add to `index.ts` before fallback): `GET /tasks/export`, `GET /calendar-export` (minimal valid iCalendar from the store), `GET /time/entries/export.csv` — built from the store with the real content types and `Content-Disposition` headers; nothing leaves the tab

**Checkpoint**: US1 + US2 work; edit-reset.spec passes.

---

## Phase 6: User Story 3 — AI and lecture features (P2)

**Goal**: streamed canned AI replies, simulated append-only transcription, "available in the
app" for hardware/provider/account actions. **Independent test**: chat reply streams;
transcription appends without touching earlier text; Record shows the toast with no mic prompt.

### Tests for US3

- [X] T048 [P] [US3] Unit test `tests/unit/demo/simulated.test.ts`: `POST /chats/{id}/messages` returns a run id; reading `/chat-runs/{id}/events` yields `start`, ≥ 2 `delta`, `done` with increasing `id:` lines and the concatenated text ending with the demo-answer line; starting a transcription then advancing fake timers 6 s → job `completed` and the note body equals the old body + appended transcript (old body is an exact prefix); cancelling while running leaves the note unchanged
- [X] T049 [P] [US3] Unit test `tests/unit/demo/unavailable.test.ts`: for one operation from every row of contracts/demo-mode.md §3 (`POST /sessions/{key}/recordings`, `POST /sessions/{key}/documents/import`, `POST /ai/endpoints`, `PUT /settings/transcription`, `POST /backup/exports`, `POST /auth/logout`, `GET /desktop/identity`) the client rejects with code `demo_unavailable` and `toast` (mocked `sonner`) was called once with the matching label
- [X] T050 [P] [US3] E2E `tests/e2e-demo/ai-lecture.spec.ts`: quickstart scenarios 5–7 — audio plays and seeking to 50 % works; chat reply streams in; transcription appends below existing text; pressing Record shows the toast "Recording is available in the UniHelperProMax app." and no permission prompt (before clicking, wrap `navigator.mediaDevices.getUserMedia` via `page.evaluate` to count calls into the original; assert the original was never called); adding an AI provider shows the toast

### Implementation for US3

- [X] T051 [US3] Chat runs in `src/demo/handlers/chat.ts`: `POST /chats/preflight`, `POST /sessions/{key}/chats`, `PATCH/DELETE /chats/{id}`, `POST /chats/{id}/restore`, `PUT /sessions/{key}/chat-drafts`, `POST /chats/{id}/messages`, `…/turns/{tid}/regenerate`, `…/turns/{tid}/edit`, `…/turns/{tid}/selection`, `…/seen`; each message creates a turn + answer + run in `chatRuns` with the reply chosen from `canned.ts` by keyword (research R5)
- [X] T052 [US3] SSE in `src/demo/handlers/chat.ts`: `GET /chat-runs/{id}/events` returns `text/event-stream` from a `ReadableStream` emitting `id: n` / `event: start|delta|done` / `data: <json>` frames (shapes per `src/lib/api/stream.ts` `RunEvent`), ~30 ms between word-chunk deltas, honouring `?lastEventId` by skipping already-sent ids; `POST /chat-runs/{id}/stop` ends the stream with `stopped` and keeps the text so far; finished runs update the stored answer text/status
- [X] T053 [US3] `POST /chats/{id}/answers/{aid}/append-to-note` in `src/demo/handlers/chat.ts`: append the answer text to the end of the target note body with a blank-line separator, `bump` the note (append-only, Principle I)
- [X] T054 [US3] Teacher in `src/demo/handlers/teacher.ts`: `POST /sessions/{key}/teacher-chats`, `PATCH /teacher-chats/{id}`, `POST …/messages`, `…/answers` (grade from `canned.ts`), `…/questions/{qid}/dispute|hint|reveal`, `…/malformed/{sid}/retry`, `PUT …/idea-set`, `POST …/graph-update`, `DELETE /knowledge-graph/ideas/{id}`; streamed parts reuse T052's SSE builder with `question`/`grade`/`hint`/`plan` events
- [X] T055 [US3] Transcription in `src/demo/handlers/transcription.ts`: `POST /recordings/{id}/transcriptions` creates a job `queued` → `running` (progress 0→100 over ~5 s via `setTimeout`) → `completed`, then appends `canned.TRANSCRIPT` to the end of the chosen note and bumps it; `POST /transcriptions/{id}/cancel` → `cancelled`, note untouched; `…/retry` restarts; `…/seen` marks seen (data-model.md "State transitions")
- [X] T056 [US3] Create `src/demo/handlers/unavailable.ts`: one handler per operation in contracts/demo-mode.md §3, each returning `demoUnavailable(<row label>)` with the labels "Recording", "File upload", "AI provider setup", "Transcription & proxy setup", "Backup", "Account", "Desktop"
- [X] T057 [US3] In `src/demo/seed.ts`, make sure the chat UI considers AI "configured" (the "Demo AI" endpoint selected in `/ai/settings`) and transcription "ready" (Demo transcriber selected), so the UI enables Send and Transcribe without setup

**Checkpoint**: ai-lecture.spec passes.

---

## Phase 7: User Story 4 — Website visitors can find the demo (P2)

**Goal**: "Try the demo" links on the marketing site. **Independent test**: click the link in
hero and download sections; the demo opens in a new tab.

- [X] T058 [P] [US4] Add a "Try the demo" link next to the download buttons in the `#hello` (hero) and `#download` sections of `website/index.html`, `href="https://demo.unihelperpromax.tech/"`, `target="_blank" rel="noopener"`, styled with the existing secondary button class used in those sections; style any new rules in `website/styles.css` with the site's existing tokens
- [X] T059 [P] [US4] Add the demo URL to `website/public/sitemap.xml` only if it lists external subdomains (otherwise leave it), and add one line about the demo to `website/public/llms.txt`

---

## Phase 8: Polish & Cross-Cutting

- [X] T060 [P] Create `vercel.json` in `frontend/` for the demo project (research R13): `buildCommand: "corepack pnpm build:demo"`, `outputDirectory: "dist-demo"`, rewrite `/((?!api/|assets/|mockServiceWorker.js).*)` → `/index.html`, headers: CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self'`, `Permissions-Policy: microphone=(), camera=(), geolocation=()`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; then verify the CSP against `corepack pnpm build:demo && corepack pnpm exec vite preview --mode demo --outDir dist-demo` (Mermaid sandbox iframe, PDFium wasm, audio) and loosen only what breaks. **Not verified:** `vite preview` does not apply Vercel headers; check the CSP on the first Vercel preview deploy
- [X] T061 [P] Add a "Demo build" section to `frontend/README.md` (or `desktop/README.md`'s sibling docs if no frontend README exists) with the four commands from contracts/demo-mode.md §1 and the Vercel setup (root `frontend/`, domain `demo.unihelperpromax.tech`)
- [X] T062 [P] Add the demo commands to the Commands section of `CLAUDE.md` (frontend block): `corepack pnpm dev:demo`, `build:demo`, `check:no-demo`, `e2e:demo`
- [X] T063 Keyboard and theme pass on the banner and dialog (quickstart scenario 9): light, dark and one custom theme; Tab order Reset → Download; Esc closes the dialog; fix contrast issues with tokens only
- [X] T064 Run the full quickstart (`lint`, `typecheck`, `test`, `build`, `check:no-demo`, `build:demo`, `e2e:demo`) and tick the scenarios; record any deviation in `specs/024-frontend-demo-mode/research.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T005)** → **Foundational (T006–T016)** → user stories.
- **US1 (Phase 3)** needs Foundational. **US5 (Phase 4)** needs T012 (the guarded import) and
  ideally US1 so the demo chunk has real content to leak. **US2** needs US1's seed and GET
  handlers (same files). **US3** needs US1 (seed, canned texts, chat/recording GETs). **US4**
  is independent of the code and can run any time.
- **Polish** after the stories you ship.

### Within a story

- Tests first (they should fail), then assets/seed, then handlers, then UI.
- Handler tasks in different files are [P]; T051–T054 share `chat.ts`/`teacher.ts` and run in order.

### Parallel examples

```text
US1: T017, T018, T019, T020, T021 (tests/config)  |  T023, T024, T025 (assets/canned)
     then T027, T028, T029, T030, T031, T032 (one handler file each)
US2: T039, T040  then T041 … T047 (one file each)
US3: T048, T049, T050  then T055, T056 alongside T051→T052→T053→T054
US4: T058, T059 at any time
```

## Implementation Strategy

### MVP (US1 + US5)

1. Setup + Foundational.
2. US1: a populated, browsable demo with banner.
3. US5: prove the normal/desktop builds are clean.
4. **Stop and validate**: deploy `dist-demo` to a Vercel preview URL and click through.

### Incremental delivery

- + US2 → editable demo (deploy).
- + US3 → AI/transcription simulated, unavailable toasts (deploy).
- + US4 → link it from the website (this is the public launch; do it last so the link never points to a half-working demo).

## Notes

- Do not edit any file under `src/` outside `src/demo/` except the one guarded line in `src/main.tsx`.
- Do not change `openapi.json`, `schema.d.ts` or any backend file.
- Commit after each phase.
