# Contract: Demo Mode

This feature adds **no API endpoints** and changes no existing contract. The demo answers the
existing `/api/v1` operations (contract: `frontend/openapi.json`, generated from the backend)
inside the browser. This file fixes what the demo build exposes and how it answers each
operation group.

## 1. Build interface

| Command (in `frontend/`) | Result |
|--------------------------|--------|
| `corepack pnpm dev:demo` | Vite dev server in `demo` mode on :5174, no `/api` proxy, MSW active |
| `corepack pnpm build:demo` | Static site in `frontend/dist-demo/` (incl. `mockServiceWorker.js`) |
| `corepack pnpm build` | Unchanged; output in `dist/` contains no demo code (checked by `check:no-demo`) |
| `corepack pnpm check:no-demo` | Fails if `dist/` contains the demo marker or `mockServiceWorker` |
| `corepack pnpm e2e:demo` | Playwright against `vite preview` of `dist-demo/` |

Demo marker: the string `UNIHELPER_DEMO_BUILD` appears in the demo chunk only.

## 2. Operations answered from the in-memory store (stateful)

Responses match the `Schemas[...]` types of the real API (enforced by `tsc`). Optimistic
concurrency: `version` increments on every change; `If-Match` mismatches return the same `412 version_conflict`
problem the real API returns.

| Group | Operations |
|-------|-----------|
| Bootstrap | `GET /health`, `GET /setup/status` (`mode: "web"`, `needsOwner: false`), `GET /auth/me` (role `member`), `GET/PATCH /preferences`, `PATCH /auth/profile` |
| Calendar tree | `/course-tree`, `/years*`, `/semesters*`, `/courses*`, `/classes*`, `/events*`, `/sessions*`, `/semesters/{id}/events/timeline`, `/courses/{id}/timeline`, `*/deletion-impact`, `POST /creations/undo`, `PUT /years/order` |
| Notes | `/sessions/{key}/notes`, `/general-notes`, `/notes/{id}*` (incl. `PUT …/content`), `GET /notes/search` (substring match), `/workspace/{key}` |
| Documents (read & annotate) | `GET /sessions/{key}/documents`, `…/hidden`, `GET/PATCH/DELETE /documents/{id}`, `GET /documents/{id}/file` (bundled PDF), `/position`, `/annotations`, `POST /annotations/ops`, `/viewer-annotations` |
| Recordings (play) | `GET /sessions/{key}/recordings`, `GET /recordings/active` (none), `GET/PATCH/DELETE /recordings/{id}`, `GET /recordings/{id}/audio` (bundled clip, `Range` → `206`) |
| Transcription (simulated) | `GET /transcription/providers` (one "Demo transcriber"), `GET /transcription/status`, `POST /recordings/{id}/transcriptions`, `GET /transcriptions*`, `…/cancel`, `…/seen`, `…/retry` — job goes `queued → running → completed` over ~5 s and **appends** the canned transcript to the target note |
| AI chat (simulated) | `GET /ai/styles`, `GET /ai/endpoints` (one "Demo AI" endpoint, no key), `GET/PUT /ai/settings`, `/sessions/{key}/chats`, `POST /chats/preflight`, `/chats/{id}*`, `POST …/messages`, `…/regenerate`, `…/edit`, `…/append-to-note` (append-only), `…/selection`, `…/seen`, `/chat-drafts`, `GET /chat-runs/active`, `GET /chat-runs/{id}/events` (SSE), `POST /chat-runs/{id}/stop` |
| AI teacher (simulated) | `/sessions/{key}/teacher-chats`, `/teacher-chats/{id}*` (canned questions, grades, hints, plan), `GET /teacher/instructions`, `/knowledge-graph*` |
| Tasks | `/task-columns*`, `/tasks*` (excl. export), `/quick-notes*` |
| Time tracking | `/time/timer*`, `/time/entries*` (excl. CSV export), `/time/tags*` |
| Themes & trash | `/themes*`, `GET /trash`, `POST /trash/{id}/restore`, `DELETE /trash/{id}` |
| Read-only settings | `GET /settings/transcription`, `GET /settings/proxy`, `GET /secrets/status` (nothing configured) |
| Exports (local) | `GET /tasks/export`, `GET /calendar-export`, `GET /time/entries/export.csv` — generated from the store, downloaded by the browser; nothing leaves the tab |

## 3. Operations answered with "available in the app"

Each shows a toast — *"<Feature> is available in the UniHelperProMax app."* with a
**Download** action linking to `https://www.unihelperpromax.tech/#download` — and returns:

```json
HTTP 403  Content-Type: application/problem+json
{ "type": "about:blank", "status": 403, "code": "demo_unavailable",
  "title": "Not available in the demo",
  "detail": "<Feature> is available in the UniHelperProMax app." }
```

| Feature label | Operations |
|---------------|-----------|
| Recording | `POST /sessions/{key}/recordings`, `PUT /recordings/{id}/chunks/{seq}`, `POST /recordings/{id}/stop`; plus `navigator.mediaDevices.getUserMedia` (rejects `NotAllowedError`, no prompt) |
| File upload | `POST /sessions/{key}/recordings/import`, `POST /sessions/{key}/documents/import`, `POST /sessions/{key}/chat-uploads`, `PUT /notes/{id}/import-replace`, `POST /calendar-imports*`, `DELETE /calendar-imports/{id}` |
| AI provider setup | `POST /ai/base-url/check`, `POST/PATCH/DELETE /ai/endpoints*`, `POST /ai/endpoints/test`, `…/models/discover`, `…/privacy-ack` |
| Transcription & proxy setup | `PUT /settings/transcription`, `POST /settings/transcription/test`, `PUT/DELETE /settings/proxy`, `POST /settings/proxy/test`, `POST /secrets/reset` |
| Backup | all `/backup/*` |
| Account | `POST /auth/login`, `POST /auth/logout`, `POST /auth/password`, `POST /setup/owner`, all `/admin/*` |
| Desktop | all `/desktop/*` |

## 4. Fallback

- Any other `/api/v1` request: `GET` → `404 { code: "not_found" }`; other methods → §3 response
  with label "This action".
- Any request outside `/api/v1` passes through to the static host (app assets only). The demo
  makes no request to any other origin (SC-003).

## 5. Demo UI surface

- **Banner**: fixed top bar, `role="region"` `aria-label="Demo notice"`; text "You're trying the
  demo — changes aren't saved."; buttons **Reset demo** (opens confirm dialog) and **Download the
  app** (link). Sets `--titlebar-h` to its height.
- **Reset**: confirm dialog → clears `uh.*` localStorage keys → reloads.
- **No Service Worker support**: full-page message with the download link instead of the app.
