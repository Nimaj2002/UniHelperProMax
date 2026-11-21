# Implementation Plan: Media Editor (Audio Trim)

**Branch**: `025-media-editor` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/025-media-editor/spec.md`

## Summary

A new `/media-editor` page in the shell: left card unchanged, main card = top bar (tool tabs and
settings) + editor area + collapsible Recordings browser (class → session → audio), right rail
with only the Media Editor icon. v1 ships one tool, **Trim**, behind a small tool registry so new
tools add a file and a registration, not layout changes. Trimming is done by the backend by
**stream-copying** the selected range (no re-encode, no quality loss, original format kept) into
a staged file, then either adding it as a new recording or atomically swapping it over the
original. The waveform comes from a backend peaks endpoint (a 3-hour file is never decoded in the
browser). Entry points: a Media Editor item in both right rails (home, session workspace) and an
"Edit…" item in each recording's menu in the session Audio panel.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript / React 19 (frontend)

**Primary Dependencies**: existing FastAPI, SQLAlchemy, TanStack Query, shadcn/ui, Phosphor icons. **One new backend dependency: PyAV (`av`)** for demux/decode/mux (see Complexity Tracking). **Two new frontend dependencies: `wavesurfer.js` (8.1.0) with its Regions plugin and `@wavesurfer/react` (1.0.14)** for the waveform, draggable trim region and playback (see R3 and Complexity Tracking).

**Storage**: unchanged. Trimmed audio is a plain file in the session's `audios/` folder; a `recordings` row per audio (existing). No migration expected: overwrite updates `size`, `duration_ms`, `version` of the existing row; new audio is an `origin='imported'`-style row (see research R5).

**Testing**: pytest (unit for the trim/peaks domain code on generated fixtures; contract tests against `contracts/openapi.yaml`; integration test for trim→save on real SQLite + temp files incl. failure leaves the original intact), Vitest + Testing Library + axe for the page, tool registry and browser; Playwright e2e for session Edit → trim → save-as-new → overwrite.

**Target Platform**: web (desktop browsers) and the Electron desktop app (PyInstaller backend must bundle PyAV).

**Project Type**: web application (backend + frontend) with desktop wrapper.

**Performance Goals**: peaks for a 3 h file in a few seconds and cached; trim of a 3 h file in seconds (stream copy); UI stays responsive (SC-005).

**Constraints**: single process; never lose the original (write to staging, fsync, atomic replace, DB commit after file in place with rollback hook); keys/secrets untouched; theme tokens only; keyboard operable.

**Scale/Scope**: one new page, one tool, 3 endpoints, 1 backend module + service, ~10 frontend components.

## Constitution Check

| Principle | Status |
|---|---|
| I. Work never lost | PASS. Staged write + atomic replace; overwrite needs explicit confirm; unsaved-changes guard; blocked while recording/transcribing; transcript is never touched. |
| II. Open formats / layout | PASS. Output keeps the source's standard format in `audios/`; readable file name from the user's chosen name. |
| III. Frontend/backend separation | PASS. All through `/api/v1`; binary audio via existing `/recordings/{id}/audio`. Additive endpoints, no breaking change. |
| IV. Providers/secrets | N/A. |
| V. UI quality | PASS (to verify in tasks): shadcn primitives, theme tokens, keyboard-operable handles, AA. |
| VI. Tests | PASS (planned): every endpoint success+error; integration test of the trim flow. |
| VII. Simplicity | PASS WITH JUSTIFICATION: one new dependency (PyAV) — see below. SQLite only, no new infra. |
| VIII. Desktop data safety | PASS. Files stay in the data folder; no uninstall impact. |

Re-check after design: unchanged, still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/025-media-editor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/openapi.yaml
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
backend/
├── src/unihelper/
│   ├── domain/audio_edit.py          # pure: clamp/validate range, stream-copy trim, peaks (PyAV)
│   ├── services/media_service.py     # browse tree, peaks, trim (new / overwrite) with staging + rollback
│   ├── schemas/media.py
│   └── api/v1/media.py               # GET /media/recordings, GET /recordings/{id}/peaks, POST /recordings/{id}/trim
├── pyproject.toml                    # + av
├── packaging/unihelper-backend.spec  # bundle av
└── tests/{unit,contract,integration}/…media…

frontend/src/
├── app/features.ts                   # import features/media-editor/routes
├── features/media-editor/
│   ├── routes.tsx                    # /media-editor route + right-rail entry registration
│   ├── MediaEditorPage.tsx           # three-panel layout: PageFrame bar + RecordingsBrowser + tool host
│   ├── tools.ts                      # tool registry: {id,title,icon,component}; Trim registered first
│   ├── session.tsx                   # editor context: current recording, dirty flag, guard
│   ├── RecordingsBrowser.tsx         # class → session → audio, filter, highlight, collapse
│   ├── api.ts                        # tree, peaks, trim hooks
│   ├── tools/trim/{TrimTool,Waveform,TimeFields,SaveDialog}.tsx   # Waveform wraps wavesurfer + Regions
│   └── MediaEditorRail.tsx           # right rail: only the editor icon
├── features/recordings/RecordingPanel.tsx   # + "Edit…" menu item
├── features/home/PanelRail.tsx, features/sessions/SessionPanel.tsx  # + Media Editor entry
├── lib/api/schema.d.ts, frontend/openapi.json  # regenerated
└── demo/handlers/…                   # demo-mode handlers for the 3 endpoints (024)
```

**Structure Decision**: web-application layout already in the repo; the editor is a self-contained
`features/media-editor/` module registered like other features, so future tools live in
`tools/<name>/` and register in `tools.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New dependency PyAV (`av`) | Lossless range copy and peak extraction across webm/opus, ogg, mp3, m4a, wav, flac; no ffmpeg exists in the repo or desktop bundle | Hand-written container cutters per format (like `domain/webm.py`) for 7 formats is far more code and risk; browser decode+re-encode cannot handle 3 h files (GBs of memory) and changes quality. |
| New frontend deps `wavesurfer.js` + `@wavesurfer/react` | Draggable/resizable trim region, zoom, seek and playback on a waveform with precomputed peaks is the library's core job (web search: the de-facto standard, v7+ Regions plugin, React 19 compatible) | Hand-writing canvas drawing, region drag handles, zoom and keyboard/a11y handling is large and error-prone; other React wrappers (`react-wavesurfer`, `wavesurfer-react`) are older/community-only. |
| Tool registry (`tools.ts`) | Spec FR-015/SC-006 require adding tools without layout changes | Hard-coding Trim in the page would force a layout rewrite for the second tool. |
