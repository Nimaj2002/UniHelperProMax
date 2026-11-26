---

description: "Task list for Simple UI Mode (026)"
---

# Tasks: Simple UI Mode

**Input**: `specs/026-simple-ui-mode/` (plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md)

**Tests**: included (constitution VI: the changed endpoint needs success + error tests; the UI needs component, axe and e2e coverage).

**Format**: `- [ ] T### [P?] [US?] Description with file path`. `[P]` = different files, no dependency on unfinished tasks.

Paths: backend `backend/src/unihelper/…`, backend tests `backend/tests/…`, frontend `frontend/src/…`, frontend tests `frontend/tests/…`.

## Phase 1: Setup

- [x] T001 Confirm `specs/026-simple-ui-mode/contracts/openapi.yaml` (already drafted) still matches the `Preferences` schema after T004; no new dependencies may be added (plan.md)
- [x] T002 [P] Create empty folders `frontend/src/app/simple/` and `frontend/tests/unit/simple/`

## Phase 2: Foundational (blocks all stories)

- [x] T003 [P] Write failing contract + unit tests for the preference in `backend/tests/contract/test_preferences_ui_mode.py` and `backend/tests/unit/test_preferences_ui_mode.py`: absent field reads as no `uiMode`; PATCH `{"uiMode":"simple"}` then GET returns `simple`; `"ultimate"` accepted; `null` accepted; `"fancy"` returns 422; per-user isolation (second user still absent)
- [x] T004 Add `ui_mode: Literal["ultimate", "simple"] | None = None  # 026` to `Preferences` in `backend/src/unihelper/schemas/notes.py` (`extra="forbid"` stays; field is optional and nullable; no migration, no service change expected: confirm `workspace_service.patch_preferences` stores unknown-to-it keys via the schema dump)
- [x] T005 Regenerate API artifacts: `cd backend && uv run python -m unihelper.export_openapi ../frontend/openapi.json`, then `cd frontend && corepack pnpm gen:api` (updates `frontend/openapi.json` and `frontend/src/lib/api/schema.d.ts`)
- [x] T006 Write `frontend/src/app/uiMode.tsx`: `useUiMode()` returns `{ mode: "ultimate" | "simple", ready: boolean, setMode(m) }`, built on `usePreferences`/`useUpdatePreferences` (`frontend/src/features/sessions/api.ts`); absent, null or unknown value ⇒ `"ultimate"`; `ready` is false until preferences have loaded
- [x] T007 [P] Unit test `frontend/tests/unit/simple/uiMode.test.tsx`: default Ultimate before and after load with no field, `setMode("simple")` updates optimistically, a failed save reverts to the previous mode
- [x] T008 Branch the shell in `frontend/src/app/shell/AppShell.tsx`: while `!ready` render exactly what Ultimate renders today (no flash of Simple); when `mode === "simple"` render `<SimpleShell />` (stub that renders `<Outlet />` for now); Ultimate code path must stay byte-for-byte unchanged in behaviour
- [x] T009 [P] Update demo wiring only if needed: confirm `frontend/src/demo/handlers/bootstrap.ts` PATCH merge carries `uiMode` and that `frontend/src/demo/seed.ts` preferences omit it (Ultimate default); run `corepack pnpm typecheck` to catch shape drift

**Checkpoint**: preference stored and readable; shell can branch. Stories can start.

## Phase 3: User Story 1 — Use the app through a Simple sidebar interface (P1) 🎯 MVP

**Goal**: One sidebar + one main area; Calendar landing; Courses grid; session sidebar with Ultimate-style tabs.

**Independent Test**: Set `uiMode` to `simple` (via PATCH or the story-2 control), then reach calendar, AI chat, courses (grid), a class session with notes/PDFs/recordings/chat/teacher/time, tasks and settings using only the sidebar and main area.

### Tests (write first)

- [x] T010 [P] [US1] Unit test the pure sidebar model in `frontend/tests/unit/simple/sidebarModel.test.ts`: general order is Calendar, AI chat, Courses, Tasks (footer: Settings, account); session order is Calendar, Notes, PDFs, Recordings, Chat, Teacher, Time plus back-to-general; no Graph, no Events entry; session entries follow the registries (a registered extra panel appears)
- [x] T011 [P] [US1] Component test `frontend/tests/unit/simple/CoursesGridPage.test.tsx`: one box per course for the selected semester, semester filter and search narrow the grid, a box links to `/courses/:courseId`, empty state when no courses, axe passes
- [x] T012 [P] [US1] Component test `frontend/tests/unit/simple/SimpleShell.test.tsx`: renders exactly one `nav` landmark and one `main`, selected item has `aria-current="page"`, `/` shows the calendar, session routes switch to the session sidebar, back link returns to general, axe passes
- [x] T013 [P] [US1] E2E `frontend/tests/e2e/simple-ui.spec.ts`: with `uiMode=simple` open Courses → course box → session → open Notes, a PDF, Recordings, Chat from the sidebar as tabs; Tasks and Settings reachable; no Graph entry (SC-002, SC-003, SC-004)

### Implementation

- [x] T014 [US1] Write the pure `frontend/src/app/simple/sidebarModel.ts`: `buildGeneralEntries()` and `buildSessionEntries(inputs)` returning ordered entries `{id, label, icon, to | onSelect}`; session inputs come from `useWorkspacePanels`, `useChatSection`, `useTeacherSection`, `useSidePanelSections` in `frontend/src/features/sessions/workspace-panels.ts` (research R4)
- [x] T015 [US1] Write `frontend/src/app/simple/SimpleSidebar.tsx`: shadcn primitives only, theme tokens only, `<nav aria-label="Main">`; general and session variants chosen from the current route (`/courses/:courseId/sessions/:sessionKey`, `/semesters/:semesterId/events/:sessionKey`, `/workspace/:sessionKey`); footer holds Settings and the account menu (reuse `frontend/src/app/shell/AccountMenu.tsx` items via `useAccountMenuItems`)
- [x] T016 [US1] Replace the T008 stub with the real `frontend/src/app/simple/SimpleShell.tsx`: sidebar + `<main>` with `<Outlet />`, and mount `useGlobalHosts()` (same host list as `AppShell.tsx` so recording, chat, transcription, tour, theme/keymap sync, restore and update hosts keep running); wrap in the layout/panel providers the pages need (`LayoutProvider`, `PanelSectionProvider`) with right card and left card hidden
- [x] T017 [P] [US1] Write `frontend/src/features/courses/CoursesGridPage.tsx`: Moodle-style cards from `useCourseTree()` (`frontend/src/features/courses/api.ts`), semester filter defaulting to preference `lastSemesterId`, text search, empty state; each card links to `/courses/:courseId`
- [x] T018 [US1] Register the new routes in `frontend/src/features/courses/routes.tsx` (`/courses` ⇒ `CoursesGridPage` in Simple, `<Navigate to="/" replace />` in Ultimate) and `frontend/src/features/tasks/routes.tsx` (`/tasks` ⇒ existing board components full-width in Simple via `frontend/src/features/home/TasksPanel.tsx` content, redirect to `/` in Ultimate); both read `useUiMode()`
- [x] T019 [US1] Calendar landing in Simple: make `/` and `/calendar/:view?/:date?` render the calendar alone in the main area when `mode === "simple"` (`frontend/src/features/home/HomeLayout.tsx`, reuse `frontend/src/features/home/CalendarPanel.tsx`); keep the Ultimate two-panel home untouched
- [x] T020 (no session-less chat exists: Simple has no general AI chat entry; chat is a session tool, see research R6) [US1] AI chat entry: resolve research R6 first (read `frontend/src/features/chat/routes.tsx` and `frontend/src/features/home/` to see whether Ultimate offers a session-less chat). If it does, link to it; otherwise add the smallest route that opens the existing chat UI for the most recent session, and record the decision in `specs/026-simple-ui-mode/research.md` (R6)
- [ ] T021 (not done: Simple reuses the session panel as an overlay, no WorkspacePage change) [US1] Session presentation variant at the one seam in `frontend/src/features/sessions/WorkspacePage.tsx` (where it builds `SessionPanel` and registers `useRightCard`, around lines 448–470): when `useUiMode().mode === "simple"` register no right card and do not render `SessionPanel`; leave every Ultimate branch untouched
- [ ] T022 (not done: no Recordings/Time tab kinds (persisted by the backend), see research R3) [US1] Add tab kinds `recordings` and `time` to `frontend/src/features/sessions/tabState.ts` (and `WorkspaceTabs.tsx` rendering) so the Recordings panel (`registerWorkspacePanel` "audio") and the Time section render as main-area tabs in Simple; closing the tab must not stop a recording (recording state stays in the existing global host, `frontend/src/features/recordings/routes.tsx`)
- [x] T023 (done differently: sidebar tools are the session panel rail items) [US1] Wire session sidebar entries to the workspace: selecting Notes/PDFs/Recordings/Chat/Teacher/Time dispatches `open` (or focuses an already-open tab) through the existing tab actions in `WorkspacePage.tsx` (`act({ type: "open", tab })`); expose them to the sidebar through a small context in `frontend/src/features/sessions/` rather than props across the shell
- [x] T024 (done differently: Notes/PDFs/Tasks sections portal into the sidebar like Ultimate's side panel) [US1] Notes and PDFs lists inside the session sidebar: render `NoteList` (`frontend/src/features/sessions/NoteList.tsx`) and the Documents section (`registerSidePanelSection` "documents") as sidebar groups under their entries, with the new-note and upload actions Ultimate offers in those sections
- [ ] T025 [US1] Suppress the guided-tour auto-start in Simple (research R8): gate the host in `frontend/src/features/tour/routes.tsx` on `useUiMode().mode === "ultimate"`; make Ultimate-only panel shortcuts in `frontend/src/lib/keymap` no-ops when Simple is active

**Checkpoint**: Simple is fully usable when `uiMode=simple`. Run T010–T013.

## Phase 4: User Story 2 — Choose between Ultimate and Simple (P1)

**Goal**: A labelled setting; choice persists per account; switching keeps location and loses nothing.

**Independent Test**: Quickstart steps 2, 3, 5.

### Tests (write first)

- [x] T026 [P] [US2] Component test `frontend/tests/unit/simple/UiModeSwitch.test.tsx`: radio group named "Interface" with options "Ultimate" and "Simple", current value checked, selecting calls `setMode`, keyboard operable, axe passes
- [ ] T027 [P] [US2] E2E `frontend/tests/e2e/ui-mode-switch.spec.ts`: fresh existing user sees Ultimate; choose Simple in Settings → Appearance ⇒ layout changes without sign-out; reload ⇒ still Simple; type unsaved text in a note, switch ⇒ text still there afterwards; start a recording, switch ⇒ recording continues; the URL is unchanged by the switch (FR-009, FR-014)
- [ ] T028 [P] [US2] Backend integration check in `backend/tests/integration/test_ui_mode_persistence.py`: set `uiMode` for the owner via the API, new login session reads it back (cross-device, FR-006)

### Implementation

- [x] T029 [US2] Write `frontend/src/app/simple/UiModeSwitch.tsx`: shadcn `RadioGroup`, labels "Ultimate" and "Simple" with one-line descriptions, calls `useUiMode().setMode`
- [x] T030 [US2] Add an "Interface" section using `UiModeSwitch` to `frontend/src/features/settings/themes/AppearanceSettings.tsx` (or the Settings page chosen there), under a heading "Interface"
- [ ] T031 [US2] Guard the switch against losing work: before `setMode` takes effect run the same pending-changes check navigation uses (`frontend/src/features/calendar/entryGuard.tsx` and note autosave flush in `frontend/src/features/sessions/autosave.ts`); on a failed flush keep the current interface and show the existing conflict/error UI

**Checkpoint**: users can choose, and the choice persists.

## Phase 5: User Story 3 — Switch interface from where you are (P2)

**Goal**: The switch is reachable from each interface's account menu in at most two interactions.

**Independent Test**: Quickstart step 5.

- [ ] T032 [P] [US3] E2E `frontend/tests/e2e/ui-mode-account-menu.spec.ts`: from Simple open the sidebar account menu ⇒ "Switch to Ultimate"; from Ultimate open the account menu ⇒ "Switch to Simple"; each lands on the same page in at most two interactions
- [x] T033 [US3] Register account menu items in `frontend/src/features/settings/routes.tsx` via `registerAccountMenuItem` ("Switch to Simple" when Ultimate is active, "Switch to Ultimate" when Simple is active) using `useUiMode` and the T031 guard; confirm `frontend/src/app/shell/AccountMenu.tsx` shows registered items in both shells

**Checkpoint**: nobody can get stuck in the wrong interface.

## Phase 6: User Story 4 — Small screens and keyboard (P3)

**Goal**: Collapsible sidebar, drawer on narrow screens, keyboard operable, all themes.

**Independent Test**: Quickstart step 6.

- [ ] T034 [P] [US4] Component + axe test `frontend/tests/unit/simple/SidebarResponsive.test.tsx`: narrow viewport hides the sidebar behind a labelled menu button and opens it as a dialog drawer; Esc closes and focus returns to the button; collapse state persists in `localStorage` and a throwing storage falls back to expanded
- [ ] T035 [P] [US4] E2E `frontend/tests/e2e/ui-mode-responsive.spec.ts`: phone width keyboard-only open, navigate to Courses, close; wide width collapse and reload keeps collapsed; run the axe pass over light, dark and a custom theme
- [ ] T036 [US4] Implement collapse and drawer in `frontend/src/app/simple/SimpleShell.tsx` and `SimpleSidebar.tsx`: wide ⇒ collapsible to an icon rail (tooltips on icons) persisted under `uh.simple.sidebarCollapsed` with `readLocal`/`writeLocal` from `frontend/src/lib/storage`; narrow (`useMediaQuery` with `WIDE_QUERY` from `frontend/src/lib/useMediaQuery`) ⇒ `Sheet` drawer opened from a menu button in the main top bar
- [ ] T037 [US4] Visible focus, skip-to-main link and theme-token-only styling pass over `frontend/src/app/simple/*` (no hard-coded colors); verify AA contrast in every built-in theme

**Checkpoint**: all four stories independently functional.

## Phase 7: Polish & Cross-Cutting

- [ ] T038 [P] Demo parity: `corepack pnpm build:demo && corepack pnpm e2e:demo`; add a demo e2e `frontend/tests/e2e-demo/simple-ui.spec.ts` that switches to Simple and opens Courses
- [ ] T039 [P] Run `corepack pnpm check:no-demo`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`
- [ ] T040 [P] Run full backend `uv run ruff check . && uv run mypy && uv run pytest` (full run enforces the contract-coverage and key-leak checks)
- [ ] T041 Regression guard for Ultimate: run the existing Playwright suite `corepack pnpm e2e` unchanged and compare; any failure means T008/T021/T025 changed Ultimate behaviour and must be fixed
- [ ] T042 Documentation: add the interface switch and Simple's layout to `README.md` / website text where Ultimate's layout is described, and note the feature in `specs/KNOWN-ISSUES.md` only if a gap remains (e.g. no tour in Simple)
- [ ] T043 Run through `specs/026-simple-ui-mode/quickstart.md` end to end on web and in the desktop dev profile (`desktop/` `npm run dev`)

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T003 → T004 → T005; T006 → T007; T008 needs T006) → Phases 3–6 → Phase 7.
- US1 needs Phase 2 only (it can be tested by setting `uiMode` through the API). US2 needs Phase 2 and is easiest after US1 so the switch has something to show. US3 needs US2 (T031 guard, T029 control). US4 refines US1's shell (T036 edits `SimpleShell.tsx`, so run after T016).
- Inside US1: T014 → T015 → T016; T017 and T018 parallel with T014–T016; T021 → T022 → T023 → T024; T019, T020, T025 independent of the session chain.

## Parallel Opportunities

- Phase 2: T003, T007, T009 in parallel with T004–T006 once their inputs exist.
- US1 tests T010–T013 together; T017 alongside T014–T016.
- US2 tests T026–T028 together; US4 tests T034–T035 together.
- Polish T038–T040 together.

## Implementation Strategy

1. **MVP = Phase 1 + 2 + US1**: Simple works end to end when selected via the API, and Ultimate is unchanged.
2. Add **US2** (the visible control) next, so real users can opt in. Releasing at this point is reasonable.
3. Add **US3** (account-menu switch) and **US4** (responsive polish), then Phase 7.
4. Keep T041 (existing e2e suite) green after every phase; the main risk is regressing Ultimate through `AppShell.tsx` and `WorkspacePage.tsx`.
