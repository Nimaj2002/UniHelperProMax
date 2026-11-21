---

description: "Task list for the Media Editor (025)"
---

# Tasks: Media Editor (Audio Trim)

**Input**: `specs/025-media-editor/` (plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md)

**Tests**: included (constitution VI: every endpoint needs success + main error tests; trim→save is a critical flow).

**Format**: `- [ ] T### [P?] [US?] Description with file path` — `[P]` = different files, no dependency on unfinished tasks.

Paths: backend `backend/src/unihelper/…`, tests `backend/tests/…`, frontend `frontend/src/…`.

## Phase 1: Setup

- [x] T001 Add backend dependency `av` (PyAV) in `backend/pyproject.toml` and run `uv lock`; add it (and its data/hidden imports) to `backend/packaging/unihelper-backend.spec`
- [x] T002 [P] Add frontend deps pinned exactly: `corepack pnpm add wavesurfer.js@8.1.0 @wavesurfer/react@1.0.14` in `frontend/package.json` (verify `corepack pnpm check:no-demo` and build still pass)
- [x] T003 [P] Create empty feature folders `frontend/src/features/media-editor/` and `frontend/src/features/media-editor/tools/trim/`

## Phase 2: Foundational (blocks all stories)

- [x] T004 Write `backend/src/unihelper/domain/audio_edit.py`: pure helpers `validate_range(start_ms, end_ms, duration_ms)` (valid only if `0 ≤ start < end ≤ duration_ms`, `end-start ≥ 100`, not the full range → else `invalid_range`), `trim_copy(src: Path, dst: Path, start_ms, end_ms)` (PyAV stream copy into the same container), `compute_peaks(src: Path, buckets: int) -> (duration_ms, peaks)` (streaming decode, interleaved min/max normalized to 0..1)
- [x] T005 [P] Unit tests for T004 on generated wav/ogg/webm/mp3 fixtures in `backend/tests/unit/test_audio_edit.py` (range validation, trimmed length within 0.1 s, peaks length = 2×buckets, unreadable file raises)
- [x] T006 [P] Write `backend/src/unihelper/schemas/media.py` from `contracts/openapi.yaml` (MediaRecording, MediaSession, MediaClassGroup, Peaks, TrimRequest with `mode` enum `new|overwrite` and `name` 1–120 chars, TrimResult)
- [x] T007 Write `backend/src/unihelper/services/media_service.py` skeleton and register `backend/src/unihelper/api/v1/media.py` router in the v1 router list (`backend/src/unihelper/api/v1/__init__.py`)
- [x] T008 [P] Create the tool registry in `frontend/src/features/media-editor/tools.ts`: `registerTool({id,title,icon,component})`, `useTools()` (same pattern as `app/shell/registry.ts`)
- [x] T009 [P] Create editor state context in `frontend/src/features/media-editor/session.tsx`: current recording id, `dirty` flag, `requestSwitch(id)` that runs the unsaved-changes guard
- [x] T010 [P] Create `frontend/src/features/media-editor/api.ts` with TanStack Query hooks `useMediaTree`, `usePeaks(id)`, `useTrim()` (invalidate `["media-tree"]`, `recordingsKey(sessionKey)` and `["timeline"]` on success); types from regenerated `schema.d.ts`

**Checkpoint**: domain, schemas and registry exist; stories can start.

## Phase 3: User Story 1 — Trim a session recording and save it (P1) 🎯 MVP

**Goal**: Edit from a session recording, trim, save as new or overwrite.

**Independent Test**: Quickstart steps 1–3 and 6.

### Tests (write first)

- [x] T011 [P] [US1] Contract tests for `GET /recordings/{id}/peaks` and `POST /recordings/{id}/trim` (201 new, 200 overwrite, 404, 409 `name_taken` / `recording_in_progress` / `recording_transcribing` / version conflict, 422 `invalid_range` / `name_required`, 428 missing If-Match on overwrite) in `backend/tests/contract/test_media.py`
- [x] T012 [P] [US1] Integration test in `backend/tests/integration/test_media_trim.py`: new copy leaves original byte-identical; overwrite shrinks duration; forced failure mid-save (monkeypatch) leaves original byte-identical and no stray row; transcript row untouched
- [x] T013 [P] [US1] Vitest for `TrimTool`, `SaveDialog` (name required, taken-name error, overwrite confirm text, transcript warning) and `Waveform` keyboard handles with axe in `frontend/tests/unit/MediaEditorTrim.test.tsx`

### Backend

- [x] T014 [US1] `GET /recordings/{recording_id}/peaks?buckets=` (default 2000, 50–8000) in `api/v1/media.py` + `media_service.peaks()`: 422 `unreadable_audio`, in-memory cache keyed `(id, version)`
- [x] T015 [US1] `media_service.trim_new()`: validate range, block if active/transcribing, `session_import_lock`, stage output via storage service, unique safe file name from `name`, insert row (`origin='imported'`, `original_file_name`=source file name, `status='complete'`, `name` 1–120 unique per session by `name_key` → 409 `name_taken`), rollback hook removes file on failure
- [x] T016 [US1] `media_service.trim_overwrite()`: require `If-Match` (428/409), stage, atomically replace the source path, update `size`, `duration_ms`, `version`, set `transcriptStale` when a transcript exists; rollback keeps original intact
- [x] T017 [US1] `POST /recordings/{recording_id}/trim` in `api/v1/media.py` (201 for new, 200 for overwrite)
- [x] T018 [US1] Update the contract spec's examples if behaviour differs; regenerate `frontend/openapi.json` (`uv run python -m unihelper.export_openapi ../frontend/openapi.json`) and `corepack pnpm gen:api`

### Frontend

- [x] T019 [P] [US1] `frontend/src/features/media-editor/tools/trim/Waveform.tsx`: wrap `@wavesurfer/react` + Regions plugin with backend `peaks`/`duration` and the existing `/recordings/{id}/audio` URL as media; one editable region = keep range; theme tokens only (read colors from CSS variables); expose region start/end; keyboard: arrows move the focused handle (Shift = coarse), Space play/pause
- [x] T020 [P] [US1] `tools/trim/TimeFields.tsx`: exact start/end inputs (mm:ss.mmm), validated against `validate_range` rules mirrored client-side
- [x] T021 [US1] `tools/trim/SaveDialog.tsx` (shadcn AlertDialog/Dialog): choice "Save as new" (name field, default `<original> (trimmed)`) vs "Overwrite original" (confirmation text; transcript warning when `hasTranscript`); progress, success and error states
- [x] T022 [US1] `tools/trim/TrimTool.tsx`: composes Waveform, TimeFields, play-range preview, Save button (disabled when nothing to trim), sets `dirty`; registered as the first tool in `features/media-editor/tools.ts`
- [x] T023 [US1] `frontend/src/features/media-editor/MediaEditorPage.tsx`: three-panel layout using the shell (left card unchanged), main card `PageFrame` with top bar (tool tabs + settings area) and tool host area; loads `?recording=<id>`; error state for missing/unreadable audio
- [x] T024 [US1] `frontend/src/features/media-editor/routes.tsx`: `/media-editor` route; import it in `frontend/src/app/features.ts`
- [x] T025 [US1] Add **Edit…** item to each recording's menu in `frontend/src/features/recordings/RecordingPanel.tsx` (next to Rename/Delete) navigating to `/media-editor?recording=<id>`; disabled while recording is active
- [x] T026 [P] [US1] Demo handlers (024) for peaks and trim in `frontend/src/demo/handlers/` (fixture peaks, in-memory trim/overwrite); run `corepack pnpm typecheck`

**Checkpoint**: Edit from a session → trim → save new/overwrite works end to end.

## Phase 4: User Story 2 — Right-panel entry and Recordings browser (P2)

**Goal**: Open the editor from the right rails; browse class → session → audio without leaving.

**Independent Test**: Quickstart steps 4–5.

- [x] T027 [P] [US2] Contract + unit tests for `GET /media/recordings` (grouping by class then session, empty classes/sessions omitted, `hasTranscript`, only the user's recordings, events under an "Events" group) in `backend/tests/contract/test_media.py` and `backend/tests/unit/test_media_service.py`
- [x] T028 [US2] `media_service.browse()` + `GET /media/recordings` in `api/v1/media.py`: one query joining recordings → session folders → courses; sort classes by name, sessions by date desc
- [x] T029 [P] [US2] `frontend/src/features/media-editor/RecordingsBrowser.tsx`: collapsible class → session → audio tree (shadcn Collapsible/Accordion), name + duration, name filter, empty states, highlights current audio, auto-expands the current audio's class and session, whole section collapsible; arrow-key navigable
- [x] T030 [US2] Wire browser into `MediaEditorPage.tsx`; selecting an item calls `requestSwitch` (guard from US3 plugs in); highlight follows the current recording; refreshes after saves (query invalidation from T010)
- [x] T031 [P] [US2] `frontend/src/features/media-editor/MediaEditorRail.tsx`: the editor page's right rail with only the Media Editor icon (current, `aria-current`), built on `app/shell/SideRail.tsx`
- [x] T032 [P] [US2] Add a Media Editor entry to the home right rail in `frontend/src/features/home/PanelRail.tsx` and to the session rail in `frontend/src/features/sessions/SessionPanel.tsx` (`useSessionRail`), linking to `/media-editor`; add a keymap command only if the existing keymap pattern requires it (`frontend/src/lib/keymap`)
- [x] T033 [P] [US2] Demo handler for `GET /media/recordings` in `frontend/src/demo/handlers/`
- [x] T034 [P] [US2] Vitest for `RecordingsBrowser` (grouping, filter, highlight, empty state, axe) in `frontend/tests/unit/RecordingsBrowser.test.tsx`

## Phase 5: User Story 3 — Leave safely and extend later (P3)

**Goal**: Unsaved-changes protection; tool list ready for future tools.

**Independent Test**: Quickstart step 5; tool registry unit test.

- [x] T035 [US3] Implement the guard in `session.tsx`: router `useBlocker` + `beforeunload` when `dirty`; `requestSwitch` opens a discard-confirm AlertDialog; wire into `MediaEditorPage.tsx`
- [x] T036 [US3] Render the top bar's tool tabs from `useTools()` in `MediaEditorPage.tsx` (single tab visible for now; layout, rail and save flow must not depend on Trim)
- [x] T037 [P] [US3] Vitest: dirty guard blocks navigation and switching; registering a second dummy tool shows it in the top bar without layout changes, in `frontend/tests/unit/MediaEditorGuard.test.tsx`
- [x] T038 [P] [US3] Add `frontend/src/features/media-editor/README.md` (≤20 lines): how to add a tool (`tools/<name>/`, `registerTool`)

## Phase 6: Polish

- [x] T039 [P] Playwright e2e `frontend/e2e/media-editor.spec.ts`: session Edit → trim → save as new → overwrite; right-rail entry → browser pick → switch with discard warning (use fake transcriber/fixtures already in e2e setup)
- [x] T040 [P] Demo e2e check: `corepack pnpm build:demo && corepack pnpm e2e:demo` still passes; `corepack pnpm check:no-demo` passes
- [ ] T041 [P] Accessibility/theme pass in light, dark and a custom theme: focus rings, handle labels, contrast, no hard-coded colors in `Waveform.tsx`
- [x] T042 [P] Large-file check: trim and peaks on a ~3 h generated file stay within the plan's goals (`@pytest.mark.slow` in `backend/tests/integration/test_media_trim.py`, run with `UNIHELPER_SLOW_TESTS=1`)
- [ ] T043 Desktop packaging check: build backend with `backend/packaging/unihelper-backend.spec`, confirm PyAV loads and a trim works in the bundled backend (`scripts/build-desktop.sh`)
- [x] T044 Run `uv run ruff check . && uv run mypy && uv run pytest` (full run: contract coverage must exercise all 3 operations), `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`; walk through `quickstart.md`
- [x] T045 Add any problems found to `specs/KNOWN-ISSUES.md` and update `CLAUDE.md` Architecture notes only if a new convention was introduced

## Dependencies & Order

- Phase 1 → Phase 2 → stories. US1 is the MVP. US2 needs T010, T023 (page) and T028; it can start after T023. US3 needs the page (T023) and browser (T030) for the switch guard, so run it last.
- Within a story: tests first (must fail), then backend, then frontend; T018 (schema regeneration) precedes all frontend API typing.
- Parallel examples: T005/T006/T008/T009/T010 after T004; in US1, T011–T013 together, then T019/T020 together; in US2, T029/T031/T032/T033/T034 together once T028 lands.

## Implementation Strategy

MVP = Phases 1–3 (Edit from a session, trim, save new/overwrite). Then US2 (rails + browser), then US3 (guard + extensibility proof), then Polish.
