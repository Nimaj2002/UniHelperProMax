# Tasks: Yuii Guided Tour

**Input**: Design documents from `specs/023-yuii-guided-tour/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. The constitution (Principle VI) requires endpoint tests, and the plan calls
for unit, axe and e2e coverage.

**Codebase facts these tasks rely on** (verified 2026-11-08):
- Year, semester and course are **not** created by separate buttons. They are created inside the
  **New class** dialog (`features/classes/NewClassDialog.tsx`, route `/classes/new`) through
  `HierarchyPicker` (`features/classes/HierarchyPicker.tsx`, "Create “X”" options). Picking an
  existing item in the same picker is the "use existing" path (FR-014), so no extra picker is needed.
- `POST /classes` returns `ClassCreated` with `courseId`. The course page `/courses/:courseId`
  lists sessions as links to `/courses/:courseId/sessions/:sessionKey` (`SessionTimeline.tsx`).
- Existing hooks usable as targets: `[data-panel="calendar"]`, `[data-panel="tasks"]`,
  `#course-panel` (left card/rail), `#workspace-session-panel` (right card),
  `[data-rail-item="chat"]` / `[data-rail-item="teacher"]` (right rail),
  `a[href="/settings/<section>"]` (Settings nav).
- `useLayout()` (`app/shell/layout.tsx`) offers `showLeft`, `showRight`, `leftVisible`, `rightVisible`.
- "AI configured" = `useModels().choices.length > 0` (`features/chat/models.ts`).
- Routes outside the signed-in shell: `/setup`, `/login`, and `/account/password`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Copy the artwork into `frontend/src/features/tour/assets/`: from `Yuii/`, copy `point-left.png`, `point-left-low.png`, `point-left-arm-extended.png`, `point-up-left.png`, `point-up-left-high.png`, `point-up-left-raised.png`, `point-up-left-shallow.png`, `point-up-left-arm-extended.png`, `finger-heart-wink.png`; from `website/assets/yuii/`, copy `greeting.webp`, `instructional.webp`, `excited.webp`, `thinking.webp`, `shy.webp`, `dizzy.webp`, `tablet.webp`.

## Phase 2: Foundational (blocks every story)

- [X] T002 Backend: add `TourState` (`status: Literal["not_seen","in_progress","skipped","completed"]` required; `chapter: Literal["welcome","first_course","first_note","pdf_recording","ai","settings","goodbye"] | None = None`; `extra="forbid"`) and `tour: TourState | None = None` to `Preferences` in `backend/src/unihelper/schemas/notes.py`.
- [X] T003 Backend: add `"tour": {"status": "not_seen", "chapter": None}` to `DEFAULT_PREFERENCES` in `backend/src/unihelper/services/workspace_service.py`, so a PATCH with `tour` replaces the whole object.
- [X] T004 [P] Contract tests in `backend/tests/contract/test_preferences.py`, covering every case in `contracts/preferences-tour.md`: the default for a new user and for a row that has no `tour`; PATCH then GET; a second PATCH replaces the first; each 422 case (`missing`, `literal_error` for status and for chapter, `extra_forbidden`); a PATCH of `theme` keeps `tour`; two users have independent values.
- [X] T005 Add the `tour` schema to `Preferences` in `specs/002-course-session-notes/contracts/openapi.yaml`, regenerate `frontend/openapi.json` with `uv run python -m unihelper.export_openapi ../frontend/openapi.json` and `frontend/src/lib/api/schema.d.ts` with `corepack pnpm gen:api`.
- [X] T006 [P] Event bus in `frontend/src/features/tour/events.ts`: `tourEvents.emit(name, payload?)` and `tourEvents.on(name, fn) → off`. Names: `class.created {courseId}`, `note.created {noteId}`, `note.saved`, `document.added`, `recording.saved`, `chat.sent`, `action.failed {kind}`. `emit` never throws, and listener errors are swallowed.
- [X] T007 [P] Targets in `frontend/src/features/tour/targets.ts`: a `TargetId` union mapped to CSS selectors (reuse the existing hooks listed above; new ones use `[data-tour="…"]`), plus `findTarget(id): Element | null` that skips hidden elements.
- [X] T008 [P] Placement in `frontend/src/features/tour/placement.ts`: `place(target: DOMRect | null, viewport: {w,h}) → {mode: "full"|"small"|"bubble"|"center", side: "left"|"right", x, y, height, pose, mirrored, bubble: {x,y,maxWidth}}`. Yuii's height is `min(33vh, 340px)`, with a minimum of 160 px before switching to bubble only. Use the side with more room (right preferred) and a 16 px margin. Pick the pose from the angle (research R6): level → `point-left`; up → `point-up-left*` (steeper → `-high`); down → `point-left-low`; far away → `-arm-extended`. `mirrored = side === "left"`. Yuii and the bubble must never intersect the target rect padded by 8 px.
- [X] T009 [P] Unit tests in `frontend/tests/unit/tour/placement.test.ts`: never overlaps the target across 20 generated target positions at 1024–1920 px widths (SC-002); the facing direction matches the side; the small and bubble-only fallbacks; `null` target → center.
- [X] T010 [P] Unit tests in `frontend/tests/unit/tour/events.test.ts`: on/off, emit without listeners, a throwing listener does not break the others.
- [X] T011 Keep existing e2e specs free of the tour (research R12): `TourHost` does not auto-start under `navigator.webdriver` unless `localStorage["uh.tour.e2e"] === "1"`. (A `signIn` patch was tried first and dropped: it missed specs that sign in by hand.)

## Phase 3: User Story 1 — Yuii welcomes and shows the app (P1) 🎯 MVP

**Goal**: The tour appears on first run, the overview chapter works, and it never auto-starts again.
**Independent test**: fresh account → Yuii greets → step through the overview → skip → reload → no tour.

- [X] T012 [US1] Steps and chapters in `frontend/src/features/tour/steps.ts`, following data-model.md "Tour step". Write the `welcome` chapter: welcome (greeting, centered, "Start the tour" / "Maybe later"); side panel `#course-panel`; home link; calendar `[data-panel="calendar"]`; tasks `[data-panel="tasks"]`. Use a playful, 1–3 sentence speech line for each step (research R11).
- [X] T013 [US1] Engine in `frontend/src/features/tour/TourProvider.tsx`: holds `stepIndex`, `context` and `mode` (`passive` while `[role="dialog"][data-state="open"]` exists outside the tour, using a MutationObserver), plus `next/back/skipStep/end/finish/jumpTo(chapter)/start(chapter?)`. On each chapter change it persists `tour` through `useUpdatePreferences` (start → `in_progress` + chapter; end → `skipped`; finish → `completed`). It navigates to `step.route` (string or function of the context). `do` steps wait for `step.waitFor`: either a tour event name or `{ route: RegExp }` matched against `useLocation`. On `action.failed` it shows `errorText` with the `dizzy` expression and stays on the step. `requires` is checked against the context, showing a prerequisite message with "Skip" or "Back".
- [X] T014 [US1] Overlay in `frontend/src/features/tour/TourOverlay.tsx`, portalled to `document.body` at `z-[60]`:
  - an SVG mask backdrop using the `--overlay` token with a rounded hole and a `--ring` outline around the target;
  - Yuii's image (pose or expression, mirrored with `scale-x-[-1]`) and a speech bubble (`bg-popover text-popover-foreground`) with title, text, "Step N of M · Chapter", and the buttons Back / Next / Skip this step / End tour;
  - repositioning on resize, scroll and target ResizeObserver; while awaiting, the target is re-found every 300 ms for up to 3 s (scrolled into view, and `showLeft()`/`showRight()` used when the target lives in a closed panel), otherwise centered;
  - movement through `motion`, with tweens off when `useReducedMotion()` is set;
  - **interactive** mode: focus moves into the bubble (`role="dialog"`, `aria-modal="false"`); keys → / ← / Esc (Esc asks to confirm inside the bubble after the welcome step; no modal of its own); the backdrop blocks clicks except in the hole on `do` steps;
  - **passive** mode: `pointer-events: none`, no focusable elements, text in an `aria-live="polite"` region (research R5).
  The image `alt` is `"Yuii, <expression>"`.
- [X] T015 [US1] Host in `frontend/src/features/tour/TourHost.tsx`: lazy-loads the provider and overlay. It auto-starts only when signed in, preferences are loaded, the path is not `/setup`, `/login` or `/account/password`, and `tour.status` is `not_seen` (welcome step) or `in_progress` (a centered "Continue from <chapter>?" with Continue / End tour, FR-021). Expose `useTour()` with `start(chapter?)` for the entry points.
- [X] T016 [US1] Register the host with `registerGlobalHost({ id: "tour", component: TourHost })` in `frontend/src/features/tour/routes.tsx`, and import it in `frontend/src/app/features.ts`.
- [X] T017 [P] [US1] Unit tests in `frontend/tests/unit/tour/TourOverlay.test.tsx`: renders the welcome step with the greeting; Next/Back/End by click and keyboard; passive mode has no focusable controls and has a live region; axe finds no violations; reduced motion disables tweens.
- [X] T018 [P] [US1] Unit tests in `frontend/tests/unit/tour/TourHost.test.tsx`: auto-start for `not_seen`; none for `completed`/`skipped`; continue offer for `in_progress`; none on `/login`.

## Phase 4: User Story 2 — First year, semester and course (P1)

**Goal**: Yuii guides the real New class form; year, semester and course are created or picked there.
**Independent test**: empty account → follow the chapter → year/semester/course/class exist exactly as without the tour.

- [X] T019 [P] [US2] Add `data-tour="new-class"` to the button in `frontend/src/features/classes/NewClassButton.tsx`; add `data-tour="class-year"`, `"class-semester"` and `"class-course"` to the three field wrappers in `frontend/src/features/classes/HierarchyPicker.tsx`, each with `data-filled={!!value}`, so the tour sees a chosen or preselected level.
- [X] T020 [P] [US2] In `frontend/src/features/classes/NewClassDialog.tsx`, emit `class.created { courseId: made.courseId }` after `mutateAsync` succeeds. In the `submit` catch of `frontend/src/features/classes/ClassForm.tsx`, emit `action.failed { kind: "class" }`. Add `data-tour="class-save"` to the form's submit button.
- [X] T021 [US2] Add the `first_course` chapter to `steps.ts`:
  - "Click New class" (`do`, waits for route `/classes/new`);
  - year field (`do`, waits for `{ filled: true }`; the text mentions picking an existing one or typing a new name);
  - semester (`do`, waits for `{ filled: true }`);
  - course (`do`, waits for `{ filled: true }`);
  - time and save (`do`, target `class-save`, waits for `class.created`, sets `context.courseId`);
  - celebration (`excited`).
  Each `do` step is `optional`.
- [X] T022 [US2] In `TourProvider.tsx`, when a dialog-bound step's dialog closes without its event (user cancelled), return to the chapter's first step in interactive mode, so Skip and End are reachable again.

## Phase 5: User Story 3 — First note (P2)

**Goal**: Open the new course's session, create a note, type, and see it autosave.
**Independent test**: with a course, follow the chapter → a note file exists and the save status shows saved.

- [X] T023 [P] [US3] In `frontend/src/features/sessions/WorkspacePage.tsx`:
  - add `data-tour="new-note"` to the "New note" control in the notes section;
  - add `data-tour="note-editor"` to the `NotePane` editor wrapper;
  - emit `note.created { noteId }` after `createNote.mutateAsync({ name })` succeeds (~line 1031).
  In `frontend/src/features/sessions/WorkspaceTabs.tsx`, add `data-tour="save-status"` to `StatusLabel`. In `frontend/src/features/sessions/autosave.ts`, emit `note.saved` where the saver sets status `"saved"` after a successful save.
- [X] T024 [US3] Add the `first_note` chapter to `steps.ts`:
  - open a session (route `/courses/${context.courseId}`, target `a[href*="/sessions/"]`, `do`, waits for route `/sessions/`, requires `courseId`, and falls back to the first course from `useCourseTree` after a reload, research R10);
  - new note (`do`, waits for `note.created`);
  - type in the editor (`do`, waits for `note.saved`);
  - save status (`show`).

## Phase 6: User Story 4 — PDF and recording (P2)

**Goal**: Optional upload and recording steps with friendly failure handling.
**Independent test**: upload a PDF and record → both stored; rerun and skip both → tour continues.

- [X] T025 [P] [US4] Add `data-tour="upload-document"` to the "Upload PDF" button in `frontend/src/features/documents/DocumentList.tsx`. Emit `document.added` from `onUploaded` in `frontend/src/features/documents/queue.ts`, and emit `action.failed { kind: "upload" }` where the import queue marks a document upload failed (`frontend/src/features/imports/importQueue.ts`).
- [X] T026 [P] [US4] Add `data-tour="record"` to the Record button in `frontend/src/features/recordings/RecordingPanel.tsx`. Emit `recording.saved` in the `onFinished` handler in `frontend/src/features/recordings/routes.tsx`, and `action.failed { kind: "recording" }` where `start()` fails (microphone denied) in `frontend/src/features/recordings/recorder.ts` or its caller.
- [X] T027 [US4] Add the `pdf_recording` chapter to `steps.ts`: upload (`do`, optional, waits for `document.added`, error text with the `shy` expression); record (`do`, optional, waits for `recording.saved`; the text explains chunked saving; mic errors use `shy`). Both require `sessionKey`.

## Phase 7: User Story 7 — Replay (P2)

**Goal**: Replay from Settings and from the rail button, with a chapter menu.
**Independent test**: after finishing, start from Settings → welcome; open the rail button → jump to "AI".

- [X] T028 [P] [US7] Rail and footer button in `frontend/src/features/tour/TourButton.tsx`, registered in `routes.tsx` with `registerPanelAction({ id: "tour", slot: "footer", component: TourButton, priority: 5 })`. It is an avatar icon button (`data-tour="tour-button"`, aria-label "Tour with Yuii", tooltip) that opens a shadcn `DropdownMenu` with "Start from the beginning" and the chapter names, calling `useTour().start(chapter)`.
- [X] T029 [P] [US7] Add a `Row title="Tour"` with the button "Replay tour with Yuii" (calls `start()`) after Time zone in `frontend/src/features/settings/account/AccountSettings.tsx`.
- [X] T030 [US7] Unit test in `frontend/tests/unit/tour/TourButton.test.tsx`: the menu lists every chapter, choosing one starts at that chapter, and it is keyboard operable.

## Phase 8: User Story 5 — AI chat and AI teacher (P2)

- [X] T031 [US5] Add the `ai` chapter to `steps.ts`, run in the session from the context:
  - right panel `#workspace-session-panel` (`show`, `showRight()` if hidden);
  - AI chat `[data-rail-item="chat"]` or the panel switch;
  - AI teacher `[data-rail-item="teacher"]`.
  The text depends on `context.aiConfigured` (from `useModels().choices.length > 0`): without a provider, Yuii (`thinking`) points to Settings → AI. With one, the optional "send a first message" `do` step waits for `chat.sent`.
- [X] T032 [P] [US5] Emit `chat.sent` after a successful `deliver` in `frontend/src/features/chat/ChatSection.tsx` (~line 254).

## Phase 9: User Story 6 — Settings tour (P3)

- [X] T033 [US6] Add the `settings` and `goodbye` chapters to `steps.ts`. In `settings`, for each section in order (ai, transcription, proxy, appearance, time, shortcuts, import-export, backup, trash, account, version), add a `show` step with route `/settings/<section>`, target `a[href="/settings/<section>"]` and a cute one-liner; sections the user cannot see are skipped automatically through the missing-target rule. `goodbye`: target `tour-button` (wink/greeting), "replay me anytime from here or Settings → Account", then Finish → `completed`.

## Phase 10: Polish and cross-cutting

- [X] T034 E2E test in `frontend/tests/e2e/tour.spec.ts`: the owner with `tour` reset to `not_seen` and the `uh.tour.e2e` flag set sees the welcome; it starts, steps through the overview, completes the first-course chapter through the New class form, ends the tour, reloads and checks that no tour appears; it then replays from the rail button, jumps to Settings, and finishes.
- [X] T035 Run `uv run ruff check . && uv run mypy && uv run pytest` (backend) and `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test` (frontend), then fix failures.
- [ ] T036 Run the full `corepack pnpm e2e` to confirm the existing specs still pass with the tour present (research R12), and walk the quickstart.md manual scenarios.

## Dependencies

- T001 → T014 (assets). T002/T003 → T004, T005 → T013 (typed `tour` preference).
- T006–T008 → T013/T014. T012–T016 make up the MVP (US1).
- US2 (T019–T022) needs US1. US3 needs the `courseId` context from US2 (or the fallback). US4 and US5 need a session (from US3's context or its fallback). US7 needs only US1. US6 needs only US1.
- T011 must land before the first full e2e run.

## Parallel examples

- After T003: T004, T006, T007, T008, T009, T010 in parallel.
- US2: T019 and T020 in parallel, then T021.
- US7: T028 and T029 in parallel.

## Implementation strategy

MVP = Phases 1–3 (the tour appears, the overview works, the state persists). Then US2 → US3 → US4 →
US7 → US5 → US6 → Polish, verifying each chapter in the browser as it lands.

## Phase 11: Feedback round (2026-11-08)

- [X] T037 Fix "Skip this step" bouncing back on New class: add `dependsOn` to steps and `afterSkipping()` in `frontend/src/features/tour/steps.ts`, so skipping a step also skips the steps that need it; unit test in `frontend/tests/unit/tour/steps.test.ts`.
- [X] T038 Yuii uncovers hidden targets: `reveal` selectors (expand Notes/Documents, select the Recordings/Chat tab) clicked once per step in `TourRunner.tsx`.
- [X] T039 Recording in three steps: Record (waits for the new `recording.started` event emitted in `features/recordings/RecordingPanel.tsx`), Stop (`data-tour="record-stop"`, waits for `recording.saved`), Transcribe (points at the recording's Transcribe button, explains that text is only appended).
- [X] T040 AI teacher walkthrough: open the teacher tab (waits for `{ appears: "teacher-new" }`), start a lesson (waits for the lesson tab), then the lesson tab's columns; a no-AI variant explains the sleeping + button.
- [X] T041 Home right panel: a step for the panel and one per tab (tasks, general notes, time, knowledge graph), each selecting its tab.
- [X] T042 Tour button shows the "Kawaii Chicks in a Pink Circle" art (96 px `features/tour/chicks.webp`) instead of Yuii's face.
- [X] T043 E2E in `frontend/tests/e2e/tour.spec.ts` for skip, record → stop → transcribe, and the AI teacher lesson (10/10 passing, light and dark).
- [X] T044 Home right panel at narrow widths: reopen it from its rail (`#show-tasks`, rail items) and bring the calendar back (`#show-calendar`) for New class.
- [X] T045 "Open a class session" after skipping New class: point at calendar blocks (`[data-session-key]`), `free` steps don't block the app, and hands-on steps with no target never block it.
- [X] T046 A dialog, menu or dropdown list the user opens counts as passive: Yuii stands beside it, stops pointing at what it covers (`dialogText`), and her bubble never covers its items (fixes the AI teacher "New lesson" item being unclickable).
- [X] T047 Closed panels are taught, not opened for the user: a step's `panel` (left / right / home-right); when that panel is closed and the target is missing, Yuii first points at its open button ("Open the side panel" / "Open the right panel") and continues once it is open. Auto-opening of the right panels removed.
- [X] T048 Settings chapter starts at the gear button (`settings.enter`, waits for `/settings`); "The right panel" moved before recording; lesson column texts corrected (left = your questions, right strip = past questions marked right or wrong); "Jump to a chapter" label removed from the tour menu (separator only). E2E 12/12.
- [X] T049 PDF step now advances after an upload: `document.added` comes from the queue's "done" event (documents/routes.tsx owns `onUploaded` and replaced the old hook). Home page teaches opening a closed left panel first (`openFirst` on "Your side panel"). E2E 16/16.
- [X] T050 New class form: year and semester steps explain what they are and stay on screen ~4.5 s when the form preselected them (`minDwellMs`, only for fields already filled when Yuii arrives); a new semester gets a "When does the semester run?" step for its start and end dates (`class-semester-dates`, skipped for an existing semester via `skipIfMissing`); saving the form from any field jumps to the celebration (`dialog.doneAt`). E2E 16/16.
- [X] T051 "Home, sweet home" points at the open side panel's app-name link (`#course-panel a[href="/"]`), not only the rail icon; the first-run e2e now checks every overview step has its highlight.
