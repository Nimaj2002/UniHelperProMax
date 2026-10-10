---

description: "Task list for feature 008 — Floating Card Layout"
---

# Tasks: Floating Card Layout

**Input**: `/specs/008-floating-card-layout/` (plan, spec, research R1–R15, data-model,
contracts `ui-layout.md`, quickstart)

**Tests**: INCLUDED. The constitution's merge gate requires UI checks in light/dark and keyboard-only,
and the spec's SC-002/SC-008 call for automated checks. Within each story, tests come first. This is
a frontend-only feature: no backend, API, schema or theme-format changes. Backend `pytest` must stay
green, untouched.

**Order**: Setup → Foundational (card grid, top bar removed) → US1 (session workspace in cards,
MVP) → US2 (close/reopen, rail, audio indicator) → US3 (calendar and course in the main card) →
US4 (focus mode) → US5 (activity pills) → US6 (theme colors) → US7 (narrow windows) → Polish.

**Conventions**:
- Paths are relative to the repo root.
- Unit tests live in `frontend/tests/unit/` (Vitest + vitest-axe); e2e tests live in
  `frontend/tests/e2e/` (Playwright, chromium-light and chromium-dark projects).
- Control names and landmarks come from `specs/008-floating-card-layout/contracts/ui-layout.md`;
  tests select elements by those roles and names.
- Colors use existing theme tokens only (`frontend/tests/unit/no-hardcoded-colors.test.ts`).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add `WIDE_QUERY = "(min-width: 1100px)"` to `frontend/src/lib/useMediaQuery.ts`, next to `DESKTOP_QUERY`. Leave `DESKTOP_QUERY` in place for now; T012 and T029 remove its shell/workspace uses.
- [X] T002 [P] Create the e2e helpers in `frontend/tests/e2e/layout-helpers.ts`:
  - `cards(page)` returns the boxes of the landmarks `aside[aria-label="Side panel"]`, `main[aria-label="Workspace"]` and `aside[aria-label="Audio"]`.
  - `gap(a, b)`, `radius(locator)` (computed `border-top-left-radius`), `fixedBarsHeight(page)` (the tab row's bounding height), and `windowScrolls(page)` (`document.scrollingElement.scrollHeight > innerHeight`).
  - `openSession(page)`, which reuses `frontend/tests/e2e/helpers.ts` and `notes-helpers.ts` to sign in, create a course with past/current/upcoming sessions and a note, and open the current session.
  - Default viewport 1366 × 768.
- [X] T003 [P] Record the "before" action and shortcut inventory. Check that every row of `specs/008-floating-card-layout/contracts/ui-layout.md` §6–§7 matches the current code (`frontend/src/features/calendar/useCalendarKeyboard.ts`, `frontend/src/features/sessions/useWorkspaceKeyboard.ts`, `frontend/src/app/shell/AppShell.tsx`, `frontend/src/features/courses/CoursePanel.tsx`). Fix the contract table if anything is missing. This table is the SC-002 checklist used in T061.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the window becomes a grid of cards on the background, the top bar disappears, its controls are reachable again, and every page fits inside the main card. The audio panel stays inside the workspace until US1.

- [X] T004 [P] Unit test `frontend/tests/unit/layout-widths.test.ts` for `layoutWidths()` (research R11, data-model "Effective widths"). Cases:
  - left: rail = 44; open = clamp(240, stored, 480).
  - right: 0 when absent or closed; open = clamp(260, stored, 640).
  - `mainMin = 480`; gaps = 4 × 8 when the right card is present, otherwise 3 × 8.
  - When `left + right + 480 + gaps > viewport`, shrink right first, then left, down to their minimums.
  - 1100 px with both cards at maximum → main ≥ 480.
  - The resize limits returned for each handle keep main ≥ 480.
  - Stored values are never modified (the function is pure).
- [X] T005 [P] Implement `frontend/src/app/shell/widths.ts`: `layoutWidths({ viewport, mode, leftClosed, leftWidth, rightPresent, rightClosed, rightWidth, focus })` returning `{ leftEff, rightEff, mainMin: 480, leftLimit, rightLimit }`, plus the constants `GAP = 8`, `RAIL_W = 44`, `LEFT_MIN 240 / LEFT_MAX 480 / LEFT_DEFAULT 280`, `RIGHT_MIN 260 / RIGHT_MAX 640 / RIGHT_DEFAULT 300`, `MAIN_MIN = 480`. Make T004 pass.
- [X] T006 [P] Create `frontend/src/app/shell/Card.tsx`:
  - `Card({ as, label, id, className, header, children })` renders the given landmark element with `rounded-[14px] border border-strong-border bg-surface-elevated overflow-hidden flex flex-col min-h-0 min-w-0`. `--border` is the card border per research R14; check the Tailwind name in `frontend/src/index.css` `@theme inline`, where `border-strong-border` maps to `--border`.
  - An optional fixed `header` slot.
  - A body wrapper `min-h-0 flex-1 overflow-y-auto` with inner padding ≥ 8 px (`p-2`) and `scroll-padding-block: 8px`, so content never touches the edge and focus rings are not clipped (FR-003, FR-036).
- [X] T007 Create `frontend/src/app/shell/layout.tsx`, the layout context. It exposes:
  - `mode` (`"docked"` when `useMediaQuery(WIDE_QUERY)`, otherwise `"overlay"`).
  - `leftClosed` and `setLeftClosed`, which persist to localStorage `uh.panel.collapsed` (the existing key) only in docked mode.
  - `overlay: "none" | "left" | "right"` and `setOverlay`, reset to `"none"` whenever the mode becomes `overlay` (FR-030).
  - `toggleLeft()`: docked flips `leftClosed`; overlay toggles `"left"`.
  - `showLeft()`, used by the `/` shortcut to open the card.
  - A placeholder `focus: null` (filled in by US4).

  Wrap `AppShell` with it, and keep `PanelSectionProvider` working with `panelVisible` derived from it.
- [X] T008 Create `frontend/src/app/shell/slots.tsx`, which replaces `frontend/src/app/shell/toolbar.tsx`:
  - `ShellSlotsProvider`.
  - `useRightCard(card: { node, open, width, setWidth, onOpenChange } | null)`, set by a page while mounted and cleared on unmount, the same pattern as `usePageToolbar`.
  - `useRightCardSlot()` for the shell.

  Leave `usePageToolbar` callers alone until T013.
- [X] T009 [P] Move the Account menu out of `frontend/src/app/shell/TopBar.tsx` into `frontend/src/app/shell/AccountMenu.tsx`:
  - The same `DropdownMenu`, the same accessible name "Account menu", the same items ("Signed in as {username}", registered account menu items, Sign out with `signOutAllowed` guards).
  - A `variant: "full" | "icon"` prop: `full` shows a `UserCircle` icon plus the text "Account"; `icon` is icon-only for the rail.
  - Menu side and alignment is `top` / `start` because it opens from the bottom of the card.
- [X] T010 Change `frontend/src/app/shell/registry.ts`:
  - Replace `registerTopBarAction` / `useTopBarActions` with `registerPanelAction({ id, slot: "courses-heading" | "footer", component, priority })` and `usePanelActions(slot)`.
  - Update `frontend/src/features/settings/routes.tsx`: the Settings gear goes to slot `footer`, keeping the name "Settings". It must accept a `variant` prop so the rail can render it icon-only.
  - Update `frontend/src/features/calendar/routes.tsx`: "New class" goes to slot `courses-heading` and is rendered as an icon-only "+" button named "New class" (`frontend/src/features/classes/NewClassButton.tsx` gains `variant: "icon" | "full"`, keeping `aria-keyshortcuts="n"` on the full variant only).
- [X] T011 Create `frontend/src/app/shell/LeftCard.tsx` from the `SidePanel` in `frontend/src/app/shell/AppShell.tsx` (keep `id="course-panel"` and `aria-label="Side panel"`, rendered through `Card as="aside"`). From top to bottom (FR-007):
  - **Header** (fixed): app name link "UniHelperProMax" (name "Go to home", navigates to `/`) and an icon button "Hide side panel" (`SidebarSimple`, `aria-controls="course-panel"`, tooltip "[", calls `toggleLeft`).
  - **Body**:
    - The `CoursePanelSlot`.
    - The registered page sections, reusing the existing `CollapsibleSection`, weights (`uh.panel.sectionWeights`) and pair resize unchanged.
  - **Footer** (pinned, outside the scrolling body): `<AccountMenu variant="full" />` on the left, and the `footer` panel actions (Settings) on the right.
- [X] T012 Rewrite the `AppShell` render in `frontend/src/app/shell/AppShell.tsx` (research R1):
  - **Root**: `<div class="grid h-dvh overflow-hidden gap-2 p-2 bg-surface">` with `grid-template-columns` built from `layoutWidths()` CSS variables `--left-eff` / `--right-eff`: `var(--left-eff) minmax(480px,1fr)` plus `var(--right-eff)` when a right card is present.
  - **Left column**: the `LeftCard` in docked mode, with the existing `PanelResizeHandle` (`grow="right"`, label "Resize course panel", `controls="course-panel"`, `limit` from `layoutWidths().leftLimit`, width persisted to `uh.panel.width` as today).
  - **Main column**: `<Card as="main" id="main" label="Workspace">`, containing `<Outlet/>` and, for now, the existing `ActivityBar` at the bottom of the card (pills come in US5).
  - **Right column**: the right card slot from `useRightCardSlot()` when it is set (filled by US1).
  - **Remove**: the `TopBar` row and the bottom `ActivityBar` grid row. Keep `GlobalHosts`.
  - **Overlay mode**: keep the existing mobile `Sheet` drawer so nothing is lost; T059 turns it into the floating overlay.
  - **Replace** `DESKTOP_QUERY` with the layout context's `mode` here.
- [X] T013 Calendar toolbar in the page (research R5):
  - `frontend/src/features/calendar/CalendarPage.tsx` drops `usePageToolbar` and renders `<CalendarToolbar/>` as a fixed row at the top of its column (`flex h-full min-h-0 flex-col`). The section becomes `h-full` instead of `h-[calc(100dvh-3.5rem)]`.
  - `frontend/src/features/calendar/CalendarToolbar.tsx`: row height `h-12`, padding `px-2`, contents unchanged for now.
  - Delete `frontend/src/app/shell/toolbar.tsx` and its provider use in `AppShell.tsx`.
- [X] T014 [P] Replace the 3.5 rem top-bar height assumption with `h-full min-h-0` in:
  - `frontend/src/features/sessions/WorkspacePage.tsx` (:611)
  - `frontend/src/features/courses/CoursePage.tsx` (:27)
  - `frontend/src/features/settings/SettingsLayout.tsx` (:12)
  - `frontend/src/features/admin/AccountsPage.tsx` (:115)

  Afterwards, `grep -rn "3.5rem" frontend/src` must return nothing.
- [X] T015 Delete `frontend/src/app/shell/TopBar.tsx`. Remove every import of it and of `registerTopBarAction`. `npm run typecheck` must pass.
- [X] T016 [P] `frontend/src/features/courses/CoursePanel.tsx`: the course list gets a heading row "Courses" (`h2`, the same style as the `CollapsibleSection` titles) with the `courses-heading` panel actions ("New class" +) beside it (FR-007). Search (`#course-search`, `/`), the tree, the `HierarchyMenu`, Alt+↑/↓ and the empty states are unchanged. Update the empty-state text that pointed at the top-bar button so it says "use + beside Courses".
- [X] T017 [P] Card surface audit (research R14). Inside the three cards, switch backgrounds painted with `bg-surface` (the window color) to `bg-surface-elevated` or transparent:
  - the old `SidePanel` root;
  - `frontend/src/app/shell/panelSection.tsx`;
  - the sticky month `h2` in `frontend/src/features/sessions/SessionTimeline.tsx` (:60-66);
  - `frontend/src/features/courses/CoursePanel.tsx`;
  - the audio `aside` in `frontend/src/features/sessions/WorkspacePage.tsx` (:627);
  - `frontend/src/features/calendar/*`.

  Use `grep -rn "bg-surface\b" frontend/src` and decide per hit. Overlays and menus are unchanged.
- [X] T018 [P] `frontend/src/index.css`: keep `html, body, #root { min-height: 100dvh }`, add `overflow: hidden` on `body` while the shell is mounted (a `data-shell` attribute on `<html>` set by `AppShell`, so auth pages can still scroll), and remove the old border-divider separators the top bar relied on, if any.
- [X] T019 Get the existing suites passing on the new shell. Run `cd frontend && npm run typecheck && npm run lint && npm test`. Update the unit tests that referenced `TopBar` / `ActivityBar` / `usePageToolbar`: `frontend/tests/unit/course-panel.test.tsx`, `panel-resize-handle.test.tsx` and any test that renders `AppShell`.

**Checkpoint**: the app runs as cards on the background with no top bar. Account, Settings, New class, the calendar toolbar and every page are reachable inside the cards.

---

## Phase 3: User Story 1 — Work in a session inside three floating cards (P1) 🎯 MVP

**Goal**: the session workspace has a single 40 px tab row with a session chip, a floating save chip and centered note content. The audio panel is the right card with its header.

**Independent Test**: open a session at 1366 × 768 in light and dark. The three cards, the left card contents in order, the tab row as the only fixed bar (≤ 76.8 px), the chip and its details, the floating save state, independent scrolling, and every previously reachable action still working.

- [X] T020 [P] [US1] Write the e2e test `frontend/tests/e2e/layout.spec.ts` › "session workspace", using `layout-helpers.ts`. At 1366 × 768:
  - Three landmarks: "Side panel", "Workspace", "Audio".
  - Each card has radius ≈ 14 px (±1) and a 1 px border.
  - Gaps between cards and to the window edges are 8 px (±1).
  - `windowScrolls` is false.
  - No `banner` / `contentinfo` landmark exists.
  - The left card shows the heading "Courses" with the button "New class", the search box, and the "Account menu" and "Settings" buttons inside the left card's footer.
  - The only fixed element above the editor is the tab row, with height ≤ 76.8 px (expected 40).
  - The session chip shows the date and time, and on an upcoming session it shows "Upcoming".
  - Clicking the chip shows the course link, location, links and status.
  - Typing in the note shows "Saving…" then "Saved" in an element positioned `absolute` inside the editor pane, and the first line of text does not move while the status changes.
  - Scrolling a long note scrolls only the main card.
  - The audio card shows the heading "Audio", "Record", and the recordings with their "Transcribe" buttons.
- [X] T021 [P] [US1] Write the unit test `frontend/tests/unit/session-chip.test.tsx`:
  - The visible text is `EEE d MMM · HH:mm–HH:mm`.
  - The accessible name follows "Session details: {full date}, {start}–{end}{, upcoming}".
  - The "Upcoming" badge appears only for upcoming sessions (use the `statusAt` / `useNow` fixtures).
  - The popover lists the course link, title, location (omitted when empty), the class `links` (omitted when the list is empty, each opening with `target="_blank" rel="noreferrer"`), and the status (Upcoming / In progress / Past, plus "No longer scheduled" when it applies).
  - vitest-axe reports no violations.
- [X] T022 [US1] Implement `frontend/src/features/sessions/SessionChip.tsx` (research R6):
  - The chip is a shadcn `Button` with `variant="outline" size="sm"`, classes `h-7 rounded-full`, and a `CalendarBlank` icon.
  - The details open in a shadcn `Popover`.
  - The data comes from the session and class data `WorkspaceHeader.tsx` already uses, so no new requests are made.
  - Make T021 pass.
- [X] T023 [US1] `frontend/src/features/sessions/WorkspaceTabs.tsx`, the tab row (research R5). The row is `h-10` (40 px) with `flex items-center gap-1 px-1 border-b border-divider`.
  - **Tabs region**: the `tablist` "Open notes and documents" with `min-w-0 flex-1 overflow-x-auto` and a hidden scrollbar. The active tab is scrolled into view on change.
  - **Right cluster**: `shrink-0 flex items-center gap-1`, accepting children, in the order Live/Raw toggle, `SessionChip`, Split toggle (existing `aria-keyshortcuts="Alt+Backslash"`), then the audio reopen slot (US2) and the main-bar controls slot (US4/US7).
  - Tab keyboard behavior (←/→, Home/End, Delete, Shift+F10 / ContextMenu) is unchanged.
  - Update `frontend/tests/unit/workspace-tabs.test.ts` if the markup changes.
- [X] T024 [US1] `frontend/src/features/sessions/WorkspacePage.tsx`:
  - Remove the `WorkspaceHeader` render and the `AudioColumns` component (:58-114).
  - Render the tab row (T023) as the main card's only fixed row, followed by the editor area (`min-h-0 flex-1`).
  - Register the audio panel through `useRightCard({ node: <RightPanel/>, open: rightOpen, width, setWidth, onOpenChange })`. The width is kept in localStorage `uh.workspace.rightWidth`, clamped 260–640, default 300. `rightOpen` still comes from the existing account preference `workspaceRightCollapsed` (`usePreferences` / `useUpdatePreferences` in `frontend/src/features/sessions/api.ts`).
  - Delete `frontend/src/features/sessions/WorkspaceHeader.tsx`.
  - Keep the "note file missing" notice inside the editor area, not as a bar.
- [X] T025 [US1] `frontend/src/app/shell/AppShell.tsx`: render the right card from the slot as `<Card as="aside" id="workspace-audio-panel" label="Audio">`, with a `PanelResizeHandle` between the main and right cards:
  - `grow="left"`, label "Resize audio panel", `controls="workspace-audio-panel"`;
  - `limit` from `layoutWidths().rightLimit`, which keeps main ≥ 480 px (replacing `EDITOR_MIN 360`);
  - live drag updates the `--right-eff` CSS variable; on commit, call `setWidth`.

  The right card only exists while the session workspace is mounted (FR-019).
- [X] T026 [US1] `frontend/src/features/recordings/RecordingPanel.tsx`: the header row becomes the audio card header. It is a fixed row of `h-10` with `px-3`: h2 "Audio", then the "Record" button (shadcn `Button size="sm"`) and `UploadAudioButton`, then a trailing slot for the close button (filled in US2). The rest of the panel (live recording card, uploads, recordings with `Player` and "Transcribe") is unchanged. Pass the header to `Card`'s `header` prop through `RightPanel` in `WorkspacePage.tsx` so only the list scrolls.
- [X] T027 [US1] Floating save chip (research R7) in the `NotePane` in `frontend/src/features/sessions/WorkspacePage.tsx` (:209-211):
  - Wrap the pane in `relative`.
  - Render `StatusLabel` in a chip `absolute bottom-3 right-3 z-10 rounded-full border border-divider bg-surface-elevated/90 px-2 py-0.5 text-xs`, keeping `aria-live="polite"`. It takes no layout space, and each split pane gets its own chip.
  - The states and labels from `frontend/src/features/sessions/autosave.ts` are unchanged ("Saved", "Saving…", "Not saved — retrying", "Conflict"), and `ConflictDialog` is unchanged.
  - Give the editor scroller `padding-bottom: calc(2.5rem + var(--pills-h, 0px))` so the last line can be scrolled out from under the floating elements.
- [X] T028 [P] [US1] Note reading width in `frontend/src/features/sessions/editor/theme.ts`: `.cm-content` stays centered (`margin: 0 auto`) with `maxWidth: "72ch"` and grows with the card up to that width (FR-018). Make sure no parent sets a fixed width. Check the PDF tab is unaffected.
- [X] T029 [US1] Workspace sections are always portalled into the left card (research R4):
  - In `frontend/src/features/sessions/WorkspacePage.tsx`, change `usePanelSections(isDesktop ? leftSections : null)` (:255) to `usePanelSections(leftSections)`.
  - Remove the workspace's own mobile drawer (:474-489, :641-649) and its `drawer === "left"` state; keep `drawer === "right"` until US7.
  - Replace `DESKTOP_QUERY` / `isDesktop` with the layout context's `mode`.
  - Section order stays Notes (with "New note") → Documents → Sessions (timeline), shown when a session is open (FR-007, FR-010). The timeline styling is unchanged.
- [X] T030 [US1] Landmarks (FR-035): `main` gets `aria-label="Workspace"` (in `Card`). The left and audio `aside`s keep the names "Side panel" and "Audio" and are siblings of `main` (no nesting). Run T020 and T021 and make them pass in both Playwright projects.

**Checkpoint**: MVP. The session workspace works in the three-card layout with every existing action.

---

## Phase 4: User Story 2 — Close and reopen the side cards (P1)

**Goal**: the left card closes to a 44 px rail. The audio card closes to a tab-row reopen button that shows recording and transcription activity. States are remembered, with a ≤ 200 ms animation and focus return.

**Independent Test**: close and reopen each side card by pointer and keyboard, then reload and check the states and widths. Start a recording, then a transcription, with the audio card closed and check the indicator.

- [X] T031 [P] [US2] Write the e2e test `frontend/tests/e2e/layout.spec.ts` › "close and reopen" at 1366 × 768:
  - "Hide side panel" turns the left card into a rail of 44 px (±1) containing "Show side panel", the app mark link "Go to home", "Account menu" and "Settings".
  - "Account menu" and "Settings" in the rail work as before.
  - `[` toggles the left card.
  - "Hide audio panel" removes the audio card, the main card widens, and "Show audio panel" appears in the tab row. Alt+] toggles it.
  - After a reload, both states and both widths are restored.
  - Closing a card while focus is inside it moves focus to its reopen button.
  - With `page.emulateMedia({ reducedMotion: "reduce" })`, the grid's `transition-duration` is ≤ 0.01 s; otherwise it is ≤ 0.2 s.
- [X] T032 [P] [US2] Write the unit test `frontend/tests/unit/audio-reopen.test.tsx`, using the recorder and transcription store fixtures:
  - **No activity**: name "Show audio panel", no indicator.
  - **Recorder `recording` or `stopping`**: name "Show audio panel, recording in progress" and a pulsing dot with `motion-reduce:animate-none`.
  - **A running transcription job**: name "Show audio panel, transcription running" and a ring indicator.
  - **Both**: both suffixes and both indicators.
  - Indicators are `aria-hidden`, so meaning is never carried by color alone.
- [X] T033 [US2] Create `frontend/src/app/shell/Rail.tsx` (FR-011, docked mode only). It renders the same `aside#course-panel aria-label="Side panel"` as a `Card`, 44 px wide, with a vertical stack:
  - icon button "Show side panel" (`SidebarSimple`, tooltip "[", calls `toggleLeft`);
  - the app mark (a small accent square with "U", a link named "Go to home");
  - a spacer;
  - `<AccountMenu variant="icon" />`;
  - the `footer` panel actions with `variant="icon"` (Settings).

  Every button has a tooltip and an accessible name. `AppShell.tsx` renders `Rail` instead of `LeftCard` when `leftClosed` is set in docked mode, and hides the resize handle.
- [X] T034 [US2] Shortcuts through the layout context in `frontend/src/app/shell/AppShell.tsx`:
  - The `[` listener calls `toggleLeft()`. The guard is unchanged (`hasModifier`, `isTypingTarget` from `frontend/src/lib/shortcuts.ts`).
  - In `frontend/src/features/courses/CoursePanel.tsx`, `/` calls `showLeft()` first when the left card is closed, then focuses `#course-search` after the card mounts. This keeps the current behavior when the panel is collapsed.
  - In `frontend/src/features/sessions/useWorkspaceKeyboard.ts`, Alt+[ keeps collapsing/expanding the workspace sections and opens the left card if it is closed, as today.
- [X] T035 [US2] Create the audio close control. Add `frontend/src/features/sessions/audioCard.tsx` exporting `AudioCardControlsProvider` / `useAudioCardControls()` → `{ close() }`, provided by `WorkspacePage`. `RecordingPanel.tsx` renders an icon button "Hide audio panel" (mirrored `SidebarSimple`, tooltip "Alt+]", `aria-controls="workspace-audio-panel"`) in its header slot (T026). Because it uses the context, the recordings feature never imports workspace internals. Closing writes `workspaceRightCollapsed: true` through `useUpdatePreferences` (the existing optimistic PATCH), and Alt+] in `useWorkspaceKeyboard.ts` keeps toggling it.
- [X] T036 [US2] Create `frontend/src/features/sessions/AudioReopenButton.tsx` (research R9). It is rendered in the tab row's audio reopen slot (T023) only while the audio card is closed.
  - It reads the recorder store (`frontend/src/features/recordings/recorder.ts`, status `recording | stopping`) and the running transcription jobs (the store used by `frontend/src/features/transcription/TranscriptionBar.tsx`).
  - Recording: a pulsing `bg-danger` dot. Transcribing: a spinning `border-accent` ring with `motion-reduce:animate-none`.
  - The accessible name follows T032. Clicking opens the audio card.
  - Make T032 pass.
- [X] T037 [US2] Card transitions (FR-037, research R12):
  - The shell grid gets `transition-[grid-template-columns] duration-200 ease-out`.
  - The left card swaps between `LeftCard` and `Rail` without layout jump: the inner content gets a fixed `min-width` during the transition and `overflow-hidden` on the column.
  - The right card goes from its width to 0 and unmounts after `transitionend`, or immediately when `matchMedia("(prefers-reduced-motion: reduce)")` matches. The global rule in `frontend/src/index.css` (:77-84) already zeroes durations under reduced motion.
- [X] T038 [US2] Focus return on close (FR-038):
  - In `frontend/src/app/shell/layout.tsx`, wrap every close action. Before closing, if `document.activeElement` is inside the card being closed, focus moves after the next frame to the card's reopen control.
  - Left card, docked: the rail's "Show side panel".
  - Audio card: the tab row's "Show audio panel".
  - Expose `registerReopenTarget(card, ref)` so `Rail` and `AudioReopenButton` can register their buttons.
  - Run T031 and make it pass in both projects.

**Checkpoint**: side cards close and reopen with remembered state, and an in-progress recording is always signalled.

---

## Phase 5: User Story 3 — Calendar and course pages in the main card (P2)

**Goal**: the calendar and course pages live entirely inside the main card with their own controls, and "New class" is on the calendar page.

**Independent Test**: open the calendar and a course page. Every control is inside the main card, there is no full-width bar, "New class" works from the calendar toolbar, and no audio card is shown.

- [X] T039 [P] [US3] Write the e2e test `frontend/tests/e2e/layout.spec.ts` › "calendar and course":
  - On `/`, the buttons Today, Previous, Next, the range heading (h1), "New class" and the Day/Week/Month group are all inside `main[aria-label="Workspace"]`.
  - "New class" in the toolbar opens the class dialog, as does `n`.
  - On a course page, the content is inside the main card.
  - On both pages there is no `aside[aria-label="Audio"]`.
  - Update `frontend/tests/e2e/class-creation.spec.ts` and `calendar-navigation.spec.ts` for the new button locations; the names are unchanged.
- [X] T040 [US3] Create `frontend/src/app/shell/MainBarControls.tsx`, a `flex shrink-0 items-center gap-1` container placed at the start and end of each main-card top bar. It takes `position: "start" | "end"` and renders the registered controls for that position. US7 adds "Show side panel" at `start`; US4 adds the focus mode button at `end`. It renders nothing when it has no controls.
- [X] T041 [US3] `frontend/src/features/calendar/CalendarToolbar.tsx`:
  - Add `<NewClassButton variant="full" />` (with `aria-keyshortcuts="n"`) before the Day/Week/Month `ToggleGroup`.
  - Put `<MainBarControls position="start" />` first and `<MainBarControls position="end" />` last.
  - Keep the Today (T), Prev/Next and live range label behavior unchanged.
  - The toolbar row has no outer border on the card edge; use a bottom `border-divider` only.
- [X] T042 [P] [US3] `frontend/src/features/courses/CoursePage.tsx`: add a slim fixed row `h-10 px-2 flex items-center border-b border-divider` with `<MainBarControls position="start" />`, a spacer and `<MainBarControls position="end" />`, then the scrolling content (`max-w-3xl px-4 py-8`, unchanged: year · semester, h1 with swatch, `SessionTimeline variant="page"`).
- [X] T043 [P] [US3] Add the same slim row with `MainBarControls` above the content in `frontend/src/features/settings/SettingsLayout.tsx` and `frontend/src/features/admin/AccountsPage.tsx`. Keep each page's own headings, and keep the content scrolling inside the card.

**Checkpoint**: every page lives inside the main card with its own controls.

---

## Phase 6: User Story 4 — Focus mode (P2)

**Goal**: `\` or a button hides both side cards, the rail included. Using it again restores the exact previous states. Activity stays visible.

**Independent Test**: for all four combinations of left and audio open/closed, enter and leave focus mode by key and by button and check the restore. Start a recording and check the pill stays visible.

- [X] T044 [P] [US4] Write the unit test `frontend/tests/unit/focus-mode.test.tsx`, rendering the layout provider with a fake media query:
  - Entering stores the snapshot `{ leftClosed, rightClosed }`; both cards are hidden (`leftEff = 0`, `rightEff = 0`); leaving restores the snapshot. Cover all 4 combinations (SC-004).
  - localStorage `uh.panel.collapsed` and the `workspaceRightCollapsed` PATCH are never written by focus mode.
  - `\` with Alt / Ctrl / Meta / Shift does nothing, and `\` while focus is in an input, textarea, contenteditable or CodeMirror does nothing (`isTypingTarget`).
  - `[` and Alt+] during focus mode leave focus mode first, then toggle.
  - On a remount (reload), `focus` is `null`.
- [X] T045 [P] [US4] Write the e2e test `frontend/tests/e2e/layout.spec.ts` › "focus mode":
  - Pressing `\` on the workspace (focus on the tab list) leaves only the "Workspace" landmark visible: no rail, no audio card.
  - Pressing `\` again restores the previous state.
  - The same works with the "Enter focus mode" / "Leave focus mode" button (`aria-pressed` toggles).
  - Typing `\` in the note inserts a backslash and does not toggle.
  - With a recording running, the "Recording" pill is visible in focus mode. Run this after US5; mark it `test.fixme` until T053 lands.
  - Focus mode on the calendar and the course page works the same way.
- [X] T046 [US4] Focus mode in `frontend/src/app/shell/layout.tsx` (data-model "FocusMode", research R10):
  - State `focus: null | { leftClosed, rightClosed }`, with `enterFocus()` and `leaveFocus()`.
  - On enter: capture the docked states (the right state comes from the right card slot's `open`), set `overlay = "none"`, and if focus is inside a side card, move it to the focus mode button.
  - On leave: re-show the cards from the snapshot (overlay mode: both stay closed).
  - Feed `focus` into `layoutWidths()` so both side columns become 0.
  - Never call `setLeftClosed`, the PATCH or `onOpenChange` while entering or leaving.
  - `toggleLeft` and the right card toggle call `leaveFocus()` first when focus mode is on.
- [X] T047 [US4] Add the `\` shortcut in `frontend/src/app/shell/AppShell.tsx`: a window `keydown` listener on `e.key === "\\"` with `!hasModifier(e) && !isTypingTarget(e.target)` that toggles focus mode and calls `preventDefault`. Check there's no clash with Alt+\ split view (`useWorkspaceKeyboard.ts`, matched on `e.code` with Alt), the PDF reader keymap (`frontend/src/features/documents/reader/PdfReader.tsx:398-425`), `Player.tsx`, `useCalendarKeyboard.ts` or the CodeMirror keymaps. Add a code comment listing them.
- [X] T048 [US4] Create the focus mode button `frontend/src/app/shell/FocusModeButton.tsx`:
  - An icon `Toggle` / `Button` with `aria-pressed`.
  - Its name and tooltip are "Enter focus mode" or "Leave focus mode", with `aria-keyshortcuts="Backslash"` and the tooltip hint `\`.
  - Icon `ArrowsOut` or `ArrowsIn` (phosphor).
  - Register it into `MainBarControls position="end"`, so it appears in the tab row, calendar toolbar, course page and settings/accounts rows.
  - Make T044 and T045 pass, except for the US5 `fixme`.

**Checkpoint**: focus mode works everywhere and restores exactly.

---

## Phase 7: User Story 5 — Activity and status inside the cards (P2)

**Goal**: recording and transcription bars become compact pills floating at the bottom center of the main card on every page, with the same contents and controls.

**Independent Test**: during a recording, then a transcription, check the pills on the calendar, the course page and the workspace (audio card open and closed, focus mode). Check Stop, Cancel and "Go to session" work and the pills don't overlap the save chip.

- [X] T049 [P] [US5] Write the unit test `frontend/tests/unit/activity-pills.test.tsx`:
  - With both activities registered and active, two pills render, recording first (priority 0) then transcription (priority 1).
  - The container is `role="region"` named "Activity", `pointer-events-none`, with `pointer-events-auto` pills.
  - With nothing active the region renders empty.
  - The `--pills-h` CSS variable is published on the main card (mock `ResizeObserver`).
- [X] T050 [P] [US5] Write the e2e test `frontend/tests/e2e/layout.spec.ts` › "activity pills" (use the fake recorder and fake transcriber from `frontend/tests/e2e/helpers.ts` and `recording.spec.ts`):
  - Start a recording in a session and navigate to the calendar. A pill with the elapsed time, label, "Go to session" and "Stop" is horizontally centered within the main card (±2 px), near its bottom.
  - "Go to session" navigates there, and "Stop" stops the recording.
  - A transcription pill shows "Transcribing", progress and "Cancel"; Cancel works.
  - With both active, the pills stack vertically without overlapping each other or the save chip's box.
  - The pills are visible with the audio card closed and in focus mode (remove the T045 `fixme`).
  - Update `frontend/tests/e2e/recording.spec.ts` and `transcription.spec.ts`, which located the old activity bar.
- [X] T051 [US5] Create `frontend/src/app/shell/ActivityPills.tsx`, which replaces `frontend/src/app/shell/ActivityBar.tsx`:
  - The container is `absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 pointer-events-none` inside the main card, which gets `relative`.
  - `max-width: calc(100% - 16rem)`, centered, so it stays clear of the bottom-right save chip.
  - It renders `useActivities()` in priority order.
  - A `ResizeObserver` writes `--pills-h` (the stack height plus 12 px, or 0 when empty) onto the main card element.
  - Render it in `AppShell.tsx` inside the main `Card`, and delete `ActivityBar.tsx`.
- [X] T052 [P] [US5] `frontend/src/features/recordings/RecordingBar.tsx`, pill layout. The root is `section aria-label="Recording"` with `pointer-events-auto flex items-center gap-2 rounded-full border border-strong-border bg-surface-elevated px-3 py-1 text-sm shadow-[0_4px_16px_var(--shadow-tint)]`. Contents are the same as today, in this order:
  - pulsing dot (with `motion-reduce:animate-none`);
  - "Recording";
  - elapsed time (`font-mono tabular-nums`, with the spoken label);
  - the label (`min-w-0 truncate`);
  - "Go to session" (`Button size="sm" variant="ghost"`, shown only when not already on that session);
  - "Stop" (`variant="destructive" size="sm"`).

  Check `--shadow-tint` exists in both themes in `frontend/src/styles/tokens.css`.
- [X] T053 [P] [US5] `frontend/src/features/transcription/TranscriptionBar.tsx`, the same pill styling. Contents as today: "Transcribing", recording → note names (truncate), the `RunningJob` progress (compact, `w-24`), "Go to session" and "Cancel" (existing action). Make T049 and T050 pass.

**Checkpoint**: there are no full-width bars left anywhere.

---

## Phase 8: User Story 6 — Cards in every theme (P2)

**Goal**: in every theme, the window background, card surface and card border come from the existing Background, Surface / card and Border colors. The editor warns when card edges vanish. Old themes and exported files work unchanged.

**Independent Test**: apply the built-in themes, an old custom theme and an old exported theme file; card edges are visible and colors map correctly. Edit Border close to Background and check the warning appears without blocking saving.

- [X] T054 [P] [US6] Write the unit test `frontend/tests/unit/theme-colors.test.ts` (extend it):
  - The `CONTRAST_PAIRS` entry `border` on `surface` (min 3) has the label "Border on Background — card edges".
  - `contrastIssues()` reports it for a theme where border ≈ background (for example `#f0f0f0` on `#f8f8f9`).
  - Both built-ins (`BUILT_IN.light`, `BUILT_IN.dark`) report no issues.
  - The `TOKENS` list and `KEY_COLORS` are unchanged (snapshot), so no new colors exist.
- [X] T055 [P] [US6] Write the e2e test `frontend/tests/e2e/layout.spec.ts` › "themes" (`frontend/tests/e2e/settings.spec.ts` helpers for themes):
  - For light, dark and a custom theme created through the existing editor: the computed `background-color` of the shell root equals `--surface`, of each card equals `--surface-elevated`, and each card's `border-color` equals `--border`.
  - Importing a theme JSON file in the Feature 005 export format (no new fields) succeeds and applies.
  - Switching themes updates the cards without a reload, and the new colors are present within 100 ms of the click (SC-009).
- [X] T056 [US6] `frontend/src/features/settings/themes/colors.ts`: give the existing `pair("border", "surface", 3)` the custom label `"Border on Background — card edges"` (allow an optional `label` override in the `pair()` helper). Don't change other pairs, thresholds, `TOKENS`, `KEY_COLORS`, `derive()`, the theme API types or the export/import format (FR-039 – FR-042). The `ThemeEditor.tsx` warning rendering (:193-218) and the confirm-before-save (:133) are unchanged.
- [X] T057 [US6] Built-in values check (FR-044, research R14): run `frontend/tests/unit/tokens.contrast.test.ts` and confirm `--border` vs `--surface` ≥ 3:1 in light (≈ 3.45) and dark (≈ 3.57). Do not change `frontend/src/styles/tokens.css` unless the T070 visual review (and T071 user approval) asks for it, and then only within the existing tokens and keeping ≥ 3:1.

**Checkpoint**: the theme behavior is verified with no data or format changes.

---

## Phase 9: User Story 7 — Smaller windows (P3)

**Goal**: below 1100 px the side cards start closed (no rail). A "Show side panel" button sits in the main card's top bar, and opened cards float over the main card. The main card is never narrower than 480 px.

**Independent Test**: at 900–1099 px, open each side card. It overlays without changing the main card's width, Escape closes it and focus returns. Resize wide → narrow → wide and check the remembered states return. At 1100 px with both cards at maximum, main ≥ 480 px.

- [X] T058 [P] [US7] Rewrite the e2e test `frontend/tests/e2e/responsive.spec.ts` from 390 × 844 (now out of scope) to 1000 × 700, plus add `layout.spec.ts` › "narrow windows":
  - On load: no "Side panel" landmark and no rail, no "Audio" card, and the button "Show side panel" is the first control in the main card's top bar on the calendar, a course page and the workspace.
  - Opening the left card shows it floating over the main card with an 8 px inset, the main card's box unchanged; it contains courses, Sessions and notes, "Account menu" and "Settings".
  - Escape closes it and focus returns to "Show side panel".
  - Opening the audio card ("Show audio panel" or Alt+]) works the same way from the right.
  - Clicking a course link inside the left overlay closes it.
  - Resizing 1366 → 1000 → 1366 restores the remembered wide states and widths.
  - At 1100 × 768, after dragging and arrow-key resizing both cards to their maximum, the main card is ≥ 480 px wide (SC-006).
- [X] T059 [US7] In `frontend/src/app/shell/AppShell.tsx` overlay mode (research R4), replace the old mobile drawer with two shadcn `Sheet`s (`side="left"` / `side="right"`) controlled by the layout context's `overlay`:
  - `SheetContent` is styled as a floating card: `inset-y-2 left-2` (or `right-2`), `w-[min(var(--stored-width),calc(100vw-1rem))]`, `rounded-[14px] border border-strong-border bg-surface-elevated`, with no dimming overlay beyond a light scrim; open/close duration ≤ 200 ms.
  - The left sheet renders `LeftCard` (the same component, so the sections portal into it).
  - The right sheet renders the right card slot's node.
  - Radix provides Escape, the focus trap and focus return to the trigger.
  - Close the left sheet on navigation, as the old drawer did.
- [X] T060 [US7] Register the "Show side panel" icon button (`SidebarSimple`, tooltip "[", `aria-controls="course-panel"`) into `MainBarControls position="start"`, rendered only when `mode === "overlay"` (FR-011). It calls `toggleLeft()`. Remove the remaining `drawer === "right"` state in `frontend/src/features/sessions/WorkspacePage.tsx` in favor of the layout context's `overlay === "right"`. In overlay mode the right card is never a grid column, and `AudioReopenButton` opens the right sheet. Make T058 pass.

**Checkpoint**: narrow windows behave per spec, and the remembered wide-window states are untouched.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T061 Action and shortcut inventory e2e test, `frontend/tests/e2e/layout.spec.ts` › "inventory" (SC-002). Walk every row of `contracts/ui-layout.md` §6–§7 and invoke each action once by keyboard and once by pointer:
  - Account menu items and Sign out (cancel the dialog), Settings, New class (both places), Go home.
  - Toggle the side panel (button, rail, `[`), course search (`/`), audio toggle (button, reopen, Alt+]), Alt+[, Alt+\, split view, tabs, Live/Raw, chip details.
  - Stop and Cancel from the pills, focus mode.
- [X] T062 [P] Update the e2e tests affected by the moved controls: `frontend/tests/e2e/side-panel.spec.ts` ("Hide side panel" / "Show side panel" replace "Hide/Show course panel"; rail), `settings.spec.ts` and `accounts.spec.ts` ("Account menu" and "Settings" now in the left card footer), `notes.spec.ts` and `notes-resilience.spec.ts` (save chip location, no header), `workspace-switch.spec.ts` (session chip instead of header h1), `documents.spec.ts` and `annotations.spec.ts` (tab row, split view at 1600 × 1000 still available).
- [X] T063 [P] Accessibility in `frontend/tests/e2e/a11y-themes.spec.ts` (SC-008). In light, dark and one custom theme, run axe (`@axe-core/playwright`) on the calendar, a course page and the session workspace, with both side cards open and with the rail; there must be no violations. Assert the landmarks "Side panel", "Workspace" and "Audio" are present, and that every `button` has a non-empty accessible name. Add a keyboard-only pass: Tab through the left card, main card and audio card; every focused element shows a visible focus ring that is not clipped (its bounding box plus a 2 px ring fits inside its card's box).
- [X] T064 [P] Many-tabs edge case in `frontend/tests/e2e/layout.spec.ts`: with 20 open tabs at 1100 px, the tab row height stays 40 px. The chip, "Split view", "Show audio panel" and the focus button stay visible, and the tabs region scrolls horizontally with the active tab in view.
- [ ] T065 [P] Long-list edge case: with 60 courses and 40 notes, the left card's header and footer (Account menu, Settings) stay visible while the body scrolls (`frontend/tests/e2e/layout.spec.ts`).
- [X] T066 [P] Run `frontend/tests/unit/no-hardcoded-colors.test.ts`, and grep the new and changed files for `#`, `rgb(` and `hsl(` outside `frontend/src/styles/tokens.css`. Any hit must be replaced with tokens.
- [X] T067 [P] Remove dead code: `DESKTOP_QUERY` if it is unused (`grep -rn DESKTOP_QUERY frontend/src`), `EDITOR_MIN`, `useTopBarActions`, the workspace `drawer` state, `WorkspaceHeader` imports, and any leftover `h-14` / `3.5rem`. `npm run lint` must be clean.
- [X] T068 Run the full check: `cd frontend && npm run typecheck && npm run lint && npm test && npm run e2e`, then `cd backend && pytest` (backend unchanged, must stay green). Fix any regressions.
- [X] T069 Do the quickstart walkthrough in `specs/008-floating-card-layout/quickstart.md`, steps 1–11, in light, dark and the custom theme at 1366 × 768 and 1000 × 700. Note any deviations in the checklist below.
- [X] T070 Visual review against `design/layout-mockups/1 · Panels open@1x.png` and `2 · Panels closed@1x.png` at 1366 × 768 (SC-010) and against the design-taste guidance in `.claude/skills/design-taste-frontend/`. Check card proportions, gaps, radius, header and footer spacing, the tab row and the chip. Allowed deviations are only those the spec mandates: no rail below 1100 px, pills, and Border color edges.
- [X] T071 If T070 finds the built-in Border edges too strong compared with the mockups, raise it with the user before changing `frontend/src/styles/tokens.css`. Any tuning must stay ≥ 3:1 against `--surface`, and T057 must be re-run.
- [X] T072 Set `**Status**` in `specs/008-floating-card-layout/spec.md` to "Implemented" and add any newly found limitations to `specs/KNOWN-ISSUES.md`.

---

## Implementation notes (deviations from the task text)

- T008: the right card slot lives in `app/shell/layout.tsx` (`useRightCard`) together with the
  layout state; there is no separate `slots.tsx`. The shell owns the audio card's width
  (`uh.workspace.rightWidth`, same key).
- T016: the course search moved out of the course list and sits above the "Courses" section
  (`registerCoursePanel({ search })`), matching FR-007's order; the section is renamed from
  "Academic years" to "Courses".
- T035: the audio card's close button is rendered by the workspace's card header
  (`AudioCardHeader`), and Record/Upload come from the panel registration's `headerActions`; no
  extra context was needed.
- T040: `MainBarControls` reads the layout context directly (no registry); `PageFrame` wraps the
  course, settings and accounts pages with it.
- T053: the transcription pill gains a Cancel button (the old bar had none).
- T057/T071: built-in colours unchanged; the visual review found the Border edges acceptable, so
  no tuning was proposed.
- Workspace: the visible session header is gone; a screen-reader-only `h1` keeps the page title.
- T065 (60 courses / 40 notes long-list check) was not automated; the card structure (fixed
  header/footer, scrolling body) is covered by T020 and the side-panel spec.

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T019)** → user stories.
- **US1 (T020–T030)** depends on Foundational. It is the MVP.
- **US2 (T031–T038)** depends on US1: the tab row reopen slot (T023), the right card slot (T024/T025) and the audio header slot (T026).
- **US3 (T039–T043)** depends on Foundational only (T013). It can run in parallel with US1 and US2, apart from `MainBarControls` (T040), which US4 and US7 need.
- **US4 (T044–T048)** depends on US3's `MainBarControls` (T040) and on US2's right card open state. Its pill assertion waits for US5.
- **US5 (T049–T053)** depends on Foundational (main card) and US1's save chip (T027, for the overlap rule).
- **US6 (T054–T057)** depends on Foundational only (`Card` colors). It can run in parallel with every other story.
- **US7 (T058–T060)** depends on US1 (right card slot), US2 (reopen controls) and US3 (`MainBarControls`).
- **Polish (T061–T072)** runs after all stories.

Story completion order: Foundational → US1 → US2 → (US3 ∥ US6) → US4 → US5 → US7 → Polish.

## Parallel Execution Examples

- **Foundational**: T004 + T006 + T009 together (different new files), then T005; T014 + T016 + T017 + T018 together after T012.
- **US1**: T020 + T021 (tests) together; T028 alongside T022–T027.
- **US2**: T031 + T032 together; T033 (Rail) alongside T035 (audio close).
- **US3**: T042 + T043 together after T040.
- **US4**: T044 + T045 together.
- **US5**: T049 + T050 together; T052 + T053 together after T051.
- **US6**: T054 + T055 together, at any time after Foundational.
- **Polish**: T062–T067 together.

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1. The app is in cards with no top bar, and the session workspace has the single tab row, the chip, the floating save state and the audio card. Ship and verify in light and dark.
2. **Increment 2**: US2 (closing, rail, recording indicator). Required before release so that a recording can never be hidden (constitution Principle I).
3. **Increment 3**: US3 + US6 in parallel, then US4 (focus mode), then US5 (pills; this removes the last full-width bar).
4. **Increment 4**: US7 (narrow windows), then Polish, with the inventory, a11y and visual review as the merge gate.
