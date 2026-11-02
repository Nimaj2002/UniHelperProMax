---

description: "Task list for Editable Shortcut Keys"
---

# Tasks: Editable Shortcut Keys

**Input**: Design documents from `/specs/019-editable-shortcut-keys/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Principle VI requires endpoint tests, and plan.md / contracts list the unit,
component and e2e tests.

**Organization**: Grouped by user story. Paths are from the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [X] T001 Run the baseline suites and note any failures that already exist, so later failures can be told apart: `cd backend && uv run pytest tests/contract/test_preferences.py tests/integration/test_backup_roundtrip.py` and `cd frontend && pnpm test -- shortcut-conflicts`

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: Stored field on the backend, and the keymap module with today's defaults and no behavior change.

### Backend `shortcuts` preference

- [X] T002 [P] Add contract tests to backend/tests/contract/test_preferences.py per contracts/preferences-shortcuts.md "Tests": GET returns `shortcuts: {}` for a new user; PATCH valid map then GET returns it; second PATCH replaces it; PATCH `{}` clears it; PATCH `theme` keeps `shortcuts`; one test per 422 row (`too_many`, `invalid_command_id`, `invalid_slots`, `invalid_chord`, `invalid_label`, `extra_forbidden`)
- [X] T003 [P] Extend backend/tests/integration/test_backup_roundtrip.py so a user with `shortcuts` set gets the same map back after backup → restore
- [X] T004 Add a `Chord` model (`model_config = ConfigDict(extra="forbid")`; `chord`: string matching `^(Ctrl\+)?(Meta\+)?(Alt\+)?(Shift\+)?[A-Za-z0-9]{1,24}$`; `label`: 1–32 chars) and `shortcuts: dict[str, tuple[Chord | None, Chord | None]] | None = None` to `Preferences` in backend/src/unihelper/schemas/notes.py. Validate: at most 200 entries (`too_many`); each key matches `^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$`, max 64 chars (`invalid_command_id`); value exactly two slots (`invalid_slots`). Errors use the existing validation-error shape with the JSON pointers in contracts/preferences-shortcuts.md
- [X] T005 Add `"shortcuts": {}` to `DEFAULT_PREFERENCES` in backend/src/unihelper/services/workspace_service.py (so `get_preferences` returns it and PATCH replaces it whole); confirm T002–T003 pass
- [X] T006 Regenerate frontend/openapi.json from the backend (`backend/src/unihelper/export_openapi.py`) and update the `Preferences` type used by frontend/src/features/sessions/api.ts to include `shortcuts?: Record<string, [Chord | null, Chord | null]>`

### Frontend keymap module (no behavior change yet)

- [X] T007 [P] Create frontend/src/lib/keymap/chord.ts: `chordFromEvent(e)` → `{ chord, label } | null` (modifiers in order `Ctrl+Meta+Alt+Shift+<code>`, label from `e.key`, null for a modifier-only press); `chordLabel(chord)` for defaults using `navigator.keyboard.getLayoutMap()` when present, US labels otherwise; `toAria(chord)` for `aria-keyshortcuts`; `checkChord(command, chord)` returning `ok` or `modifierOnly | tab | reserved | needsModifier | shiftReserved` with the reserved list from research.md R6 (Ctrl/Meta + C, V, X, Z, Y, Shift+Z, A, W, Q, R, Shift+R, N, T, L, K, F5; Alt+F/E/V/S/B/T/H; Tab, Shift+Tab). Reuse `isTypingTarget`/`hasModifier` from frontend/src/lib/shortcuts.ts
- [X] T008 [P] Create frontend/src/lib/keymap/commands.ts: the `COMMANDS` registry (fields per data-model.md "Command": `id`, `label`, `group`, `scope`, `defaults`, `worksWhileTyping`, `noShiftVariant`, `firesInTools`, `keyboardOnly`). Fill it from today's bindings, one command per action (research.md R4 split rule), copying every default from: frontend/src/app/shell/AppShell.tsx, frontend/src/features/home/HomePage.tsx, frontend/src/features/courses/CoursePanel.tsx, frontend/src/features/sessions/useWorkspaceKeyboard.ts (`WORKSPACE_SHORTCUTS`), frontend/src/features/calendar/useCalendarKeyboard.ts (`CALENDAR_SHORTCUTS`), frontend/src/features/calendar/TimeGrid.tsx, frontend/src/features/tasks/board/Board.tsx, frontend/src/features/tasks/ChecklistEditor.tsx, frontend/src/features/recordings/Player.tsx, frontend/src/features/documents/reader/annotations/AnnotationItem.tsx, frontend/src/features/sessions/editor/diagram-math/DiagramViewer.tsx, frontend/src/features/chat/MessageBox.tsx. Second keys become the alternate (e.g. `player.playPause`: Space / KeyK; diagram zoom in: Shift+Equal / NumpadAdd). `keyboardOnly` on: time-grid moves and range, task-board pick-up/move/drop, annotation move, chat send
- [X] T009 [P] Create frontend/src/lib/keymap/conflicts.ts: `findConflict(resolved, commandId, slot, chord)` implementing FR-006 / research.md R5 (both `app`; same tool; `app` with `firesInTools` vs any tool) and `resolveKeymap(overrides)` (defaults first, then overrides; a default slot that conflicts with an override becomes `source: "dropped"`; unknown command ids ignored)
- [X] T010 Create frontend/src/lib/keymap/useKeymap.ts: `useKeymap()` (resolved bindings from `usePreferences()`, memoized on the `shortcuts` value), `useShortcut(id)` → `{ matches(e), label, aria }`, and `isRecording()`/`setRecording()` (module-level flag). Add frontend/src/lib/keymap/index.ts re-exporting the public API from contracts/ui-keymap.md
- [X] T011 [P] Unit tests in frontend/tests/unit/keymap.test.ts: `chordFromEvent` (letter, Shift+Slash → `?`, Numpad, AZERTY `key` ≠ `code`, modifier-only → null); every `checkChord` refusal; every `findConflict` scope case incl. "different tools may share"; `resolveKeymap` dropped default and unknown id
- [X] T012 Rewrite frontend/tests/unit/shortcut-conflicts.test.ts on `COMMANDS` + `findConflict`: fail on any conflict among defaults and on any default in the reserved list; keep the browser-accelerator checks it has today
- [X] T013 Add `onError` rollback (restore the `prev` snapshot from `onMutate`) to `useUpdatePreferences` in frontend/src/features/sessions/api.ts (research.md R8)

**Checkpoint**: Backend stores shortcuts; keymap module returns today's defaults; all existing tests pass.

---

## Phase 3: User Story 1 — Change a shortcut (P1) 🎯 MVP

**Goal**: Record a new key for any command; it works everywhere at once, the old key stops working, hints update, and it survives reload and other devices.

**Independent test**: quickstart.md scenarios 1, 2 and 10.

### Move handlers onto the keymap (each file independent)

- [X] T014 [P] [US1] Replace the `[`, `\`, `/` checks in frontend/src/app/shell/AppShell.tsx and the `/` handler in frontend/src/features/courses/CoursePanel.tsx with `useKeymap()` matches for the General commands; keep the `isTypingTarget` guard; return early when `isRecording()`
- [X] T015 [P] [US1] Replace the `KeyC`/`KeyT` checks in frontend/src/features/home/HomePage.tsx with the calendar-panel / tasks-panel commands
- [X] T016 [P] [US1] Rewrite frontend/src/features/sessions/useWorkspaceKeyboard.ts to match through `useKeymap()` (any slot of a workspace command); remove `WORKSPACE_SHORTCUTS`; keep the open-dialog guard; return early when `isRecording()`
- [X] T017 [P] [US1] Rewrite frontend/src/features/calendar/useCalendarKeyboard.ts on the keymap; remove `CALENDAR_SHORTCUTS`; render frontend/src/features/calendar/ShortcutsDialog.tsx from `COMMANDS` (Calendar, Task board and General groups) with current labels
- [X] T018 [P] [US1] Replace the arrow, Shift+↑/↓, PageUp/PageDown, Home/End, Enter, Esc checks in frontend/src/features/calendar/TimeGrid.tsx with calendar-grid commands (Shift on a `noShiftVariant` command still extends the range)
- [X] T019 [P] [US1] Replace key checks in frontend/src/features/tasks/board/Board.tsx (pick-up, move ×4, drop, cancel) and the Alt+↑/↓ reorder in frontend/src/features/tasks/ChecklistEditor.tsx with task-board / checklist commands
- [X] T020 [P] [US1] Replace key checks in frontend/src/features/recordings/Player.tsx (play/pause, skip back/forward, volume up/down, mute) with player commands; keep the slider-target exception
- [X] T021 [P] [US1] Replace key checks in frontend/src/features/documents/reader/annotations/AnnotationItem.tsx (move ×4 with Shift = bigger step, edit, finish editing, menu, delete) with PDF-annotation commands
- [X] T022 [P] [US1] Replace the key map in frontend/src/features/sessions/editor/diagram-math/DiagramViewer.tsx (zoom in/out, reset, pan ×4) with diagram-viewer commands
- [X] T023 [P] [US1] Replace Enter / Shift+Enter / Esc checks in frontend/src/features/chat/MessageBox.tsx with chat-box commands; keep the IME composition guard

### Hints follow the user's keys (FR-005)

- [X] T024 [P] [US1] Use `useShortcut(id).aria` / `.label` for every hard-coded `aria-keyshortcuts` and `<kbd>` hint of a listed command in: frontend/src/app/shell/LeftCard.tsx, frontend/src/app/shell/MainBarControls.tsx, frontend/src/app/shell/Rail.tsx, frontend/src/app/shell/SideRail.tsx (and its caller in frontend/src/app/shell/AppShell.tsx), frontend/src/features/home/PanelCloseButton.tsx
- [X] T025 [P] [US1] Same as T024 for: frontend/src/features/calendar/CalendarToolbar.tsx, frontend/src/features/classes/NewClassButton.tsx, frontend/src/features/events/NewEventButton.tsx, frontend/src/features/courses/CoursePanel.tsx
- [X] T026 [P] [US1] Same as T024 for: frontend/src/features/sessions/NoteList.tsx, frontend/src/features/sessions/SessionPanel.tsx, frontend/src/features/sessions/WorkspacePage.tsx, frontend/src/features/sessions/WorkspaceTabs.tsx, frontend/src/features/chat/ChatSection.tsx, frontend/src/features/chat/MessageBox.tsx, frontend/src/features/recordings/Player.tsx, frontend/src/features/documents/reader/annotations/AnnotationItem.tsx, frontend/src/features/tasks/ChecklistEditor.tsx. Leave PDF reader page/zoom/search/undo hints in ReaderToolbar.tsx, SearchBox.tsx, AnnotationToolbar.tsx unchanged (not on the shortcuts page)

### Settings page: record and save

- [X] T027 [US1] Create frontend/src/features/settings/shortcuts/ShortcutSlot.tsx: a `Button` showing `<kbd>{label}</kbd>` or "Not set"; activating it enters `recording` ("Press keys…", visible Cancel button, `setRecording(true)`); a capture-phase `keydown` takes the next `chordFromEvent` (Esc is recorded), calls `preventDefault`/`stopPropagation`, runs `checkChord` (refusals stay in recording and show the reason — full refusal copy in US2), then calls `onSave(chord)`; Cancel or blur restores `idle`. States `idle → recording → saving → idle | error` per contracts/ui-keymap.md; an `aria-live="polite"` region announces start and result
- [X] T028 [US1] Rewrite frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx from `COMMANDS`: one section per group, one row per command (label, main `ShortcutSlot`, alternate `ShortcutSlot`); saving builds the new overrides map (only commands that differ from defaults, research.md R2) and calls `useUpdatePreferences().mutate({ shortcuts })`; on mutation error the slot shows "Not saved. Try again." (FR-012). Remove the hand-written `GROUPS` and `WORKSPACE_LABELS`
- [X] T029 [P] [US1] Component test frontend/tests/unit/shortcuts-settings.test.tsx: record Alt+Shift+M on "New note" → PATCH body has the override; Esc is recorded as `Escape`; Cancel keeps the old key; failed PATCH shows the error and keeps the old key; vitest-axe has no violations
- [X] T030 [P] [US1] Playwright frontend/tests/e2e/shortcuts.spec.ts: change "New note" to Alt+Shift+M, open a session, the new key creates a note, Alt+N does not, the new-note button's `aria-keyshortcuts` is `Alt+Shift+M`, reload keeps it

**Checkpoint**: US1 complete — quickstart scenarios 1, 2, 10 pass.

---

## Phase 4: User Story 2 — Prevent and resolve conflicts (P1)

**Goal**: No conflicting state can be saved; the user sees who owns a key and chooses reassign or cancel; impossible keys are refused with a reason.

**Independent test**: quickstart.md scenarios 3, 4, 5.

- [X] T031 [US2] In frontend/src/features/settings/shortcuts/ShortcutSlot.tsx, show and announce a sentence per refusal code: `modifierOnly` (keep waiting, no message), `tab` ("Tab moves between controls and can't be a shortcut."), `reserved` ("<label> is used by your browser or system."), `needsModifier` ("This command also works while typing, so it needs Alt, Ctrl or Cmd."), `shiftReserved` ("Shift with this key already means a bigger step.")
- [X] T032 [US2] Create frontend/src/features/settings/shortcuts/ConflictDialog.tsx (shadcn `AlertDialog`): "<label> is used by <command>." with "Reassign" (other slot → `null`, then save both in one PATCH) and "Cancel" (no change); wire it into the save path of frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx using `findConflict`
- [X] T033 [US2] In frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx, show a slot with `source: "dropped"` as "Not set — its default is used by <other command>"
- [X] T034 [P] [US2] Extend frontend/tests/unit/shortcuts-settings.test.tsx: conflict → Reassign clears the other slot; conflict → Cancel keeps both; Ctrl+C refused; Q on "New note" refused; Tab refused; C on player alternate accepted while PDF annotations use C; dropped default is shown

**Checkpoint**: US1 + US2 complete — quickstart scenarios 3–5 pass.

---

## Phase 5: User Story 3 — Reset to defaults (P2)

**Goal**: Reset one slot, or all shortcuts with confirmation; changed slots are marked.

**Independent test**: quickstart.md scenario 8.

- [X] T035 [US3] In frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx add a "Changed" `Badge` on rows whose resolved slots differ from defaults, and a row `DropdownMenu` with "Reset main" / "Reset alternate" (a reset that conflicts goes through `ConflictDialog`; when both slots equal defaults the command is removed from the map)
- [X] T036 [US3] Add a "Reset all" button to the page header in frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx with an `AlertDialog` confirmation; confirming sends `shortcuts: {}`
- [X] T037 [P] [US3] Extend frontend/tests/unit/shortcuts-settings.test.tsx: reset one slot restores the default and the badge goes away; reset into a conflict opens the dialog; Reset all asks first and sends `{}`

---

## Phase 6: User Story 4 — Remove a shortcut (P3)

**Goal**: Clear one slot; never leave a keyboard-only command with no key.

**Independent test**: quickstart.md scenarios 6 and 7.

- [X] T038 [US4] Add "Remove main" / "Remove alternate" to the row menu in frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx (slot → `null`); for a `keyboardOnly` command whose other slot is already empty, disable the item with the reason "This is the only keyboard way to do this." (FR-007a)
- [X] T039 [P] [US4] Extend frontend/tests/unit/shortcuts-settings.test.tsx: removing the player alternate leaves Space working and stores `[main, null]`; the last slot of a time-grid move can't be removed

---

## Phase 7: Polish & cross-cutting

- [X] T040 [P] Search frontend/src for leftover hard-coded key checks or hints of listed commands (`grep -rnE "e\.(key|code) ===|aria-keyshortcuts=\"" frontend/src`) and move any found onto the keymap
- [X] T041 [P] Update the page subtitle in frontend/src/features/settings/shortcuts/ShortcutsSettings.tsx (now editable; "On macOS, Alt is the Option key.") and any shortcut mention in docs/ that says shortcuts can't be changed
- [X] T042 Run frontend lint and type check (`cd frontend && pnpm lint && pnpm typecheck`) and backend checks (`cd backend && uv run ruff check && uv run mypy`)
- [ ] T043 Run all of quickstart.md, including keyboard-only use and light + dark themes (Principle V), and the full backend and frontend suites

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → stories.** Phase 2 blocks everything.
- Inside Phase 2: T004 → T005 → T006; T007, T008, T009 in parallel → T010 → T011, T012; T013 any time.
- **US1** needs Phase 2. T014–T026 are independent files and can run in parallel. T027 → T028 → T029/T030.
- **US2** needs T027–T028 (it extends the slot and page).
- **US3** needs T028 and T032 (reset may open the conflict dialog).
- **US4** needs T028 (row menu from T035 if done; otherwise it adds the menu).
- **Polish** after the stories you ship.

## Parallel examples

```text
# Phase 2
T002, T003 (backend tests)  |  T007, T008, T009 (keymap files)  |  T013

# US1 — after Phase 2
T014 T015 T016 T017 T018 T019 T020 T021 T022 T023   (one handler file each)
T024 T025 T026                                       (hint files)
```

## Implementation Strategy

- **MVP = Phase 1 + 2 + US1**: shortcuts can be changed and work everywhere. Ship only together
  with US2 if users can reach the page, because without the conflict check a user can make a
  command unreachable.
- Then US3 (reset) and US4 (remove), each testable on its own.
- Phase 2 must land with zero behavior change: the rewritten conflict test (T012) and the
  existing e2e suites prove it.
