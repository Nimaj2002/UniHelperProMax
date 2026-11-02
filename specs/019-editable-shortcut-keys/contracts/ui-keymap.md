# Contract: frontend keymap module and shortcuts page

## Module `frontend/src/lib/keymap/`

| Export | Purpose |
|--------|---------|
| `COMMANDS` | the registry (data-model.md "Command"); the only place defaults are written |
| `chordFromEvent(e)` | `KeyboardEvent` → `{ chord, label }`, or `null` for a modifier-only press |
| `checkChord(command, chord)` | `ok`, or a refusal: `modifierOnly`, `tab`, `reserved`, `needsModifier`, `shiftReserved` (research R6) |
| `findConflict(resolved, commandId, slot, chord)` | the other `{ commandId, slot }` that clashes, or `null` (research R5) |
| `resolveKeymap(overrides)` | defaults + overrides → resolved bindings, with `dropped` defaults marked |
| `useKeymap()` | resolved bindings from `usePreferences()`; stable between preference changes |
| `matches(e, id)` / `matchFirst(e, ids)` | for handlers: true / the first command whose keys this event is, read at key time |
| `useShortcut(id)` / `hintOf(keymap, id)` | `{ label, aria }`: `label` for tooltips, `aria` for `aria-keyshortcuts` (undefined when not set) |
| `ShortcutKbd` | `<kbd>` with a command's current key, or nothing |
| `KeymapSync` | global host that publishes the account's shortcuts to the store the above read |
| `isRecording()` | true while the settings page records a key; global handlers return early |

Rules for handlers:

- Every key handler listed on the shortcuts page uses `matches(e, id)` (or `matchFirst` for
  several ids) instead of comparing `e.key` / `e.code`.
- Single-key `app` commands keep the existing `isTypingTarget` guard.
- Every `aria-keyshortcuts` and visible key hint for a listed command uses `useShortcut(id)`.

## Handlers to move onto the keymap

| Area | File |
|------|------|
| General (`[`, `\`, `/`) | `app/shell/AppShell.tsx`, `features/courses/CoursePanel.tsx` |
| Home panels (Shift+C, Shift+T) | `features/home/HomePage.tsx` |
| Notes workspace | `features/sessions/useWorkspaceKeyboard.ts` |
| Calendar | `features/calendar/useCalendarKeyboard.ts`, `features/calendar/TimeGrid.tsx` |
| Task board | `features/tasks/board/Board.tsx`, `features/tasks/ChecklistEditor.tsx` (Alt+↑/↓) |
| Recording player | `features/recordings/Player.tsx` |
| PDF annotations | `features/documents/reader/annotations/AnnotationItem.tsx` |
| Diagram viewer | `features/sessions/editor/diagram-math/DiagramViewer.tsx` |
| AI chat box | `features/chat/MessageBox.tsx` |

Hint sites: every file with `aria-keyshortcuts` or a `<kbd>` hint for a listed command (21 files
today, found with `grep -rl aria-keyshortcuts frontend/src`), plus the calendar
`ShortcutsDialog`, which renders from `COMMANDS` instead of `CALENDAR_SHORTCUTS`.
`CALENDAR_SHORTCUTS` and `WORKSPACE_SHORTCUTS` are removed.

## Shortcuts page (`features/settings/shortcuts/ShortcutsSettings.tsx`)

Per group, per command, one row: label, main slot, alternate slot, "Changed" badge when it
differs from default, a row menu with "Reset" and "Remove" per slot. Page header: "Reset all"
(confirmation dialog). A command with a `dropped` default shows "Not set — its default is used by
<other command>".

Slot button states: `idle` (shows `<kbd>` or "Not set") → `recording` ("Press keys…", Cancel
button visible) → `saving` → `idle` | `error` (inline "Not saved. Try again.").

Recording outcomes:

| Outcome | UI |
|---------|----|
| ok | saved, announced "Saved: <label>" |
| refused | stays recording, shows and announces the reason |
| conflict | `AlertDialog`: "<label> is used by <command>." Buttons: "Reassign" (other slot becomes Not set), "Cancel" |
| remove last slot of a `keyboardOnly` command | "Remove" is disabled, with the reason as its description (FR-007a) |

`keyboardOnly` (registry flag): commands that are the only keyboard path to an action — time grid
moves and range, task board pick-up/move/drop, checklist reorder, annotation move and finish editing,
diagram pan, chat new line. Their last slot cannot
be removed, so a keyboard-only user can never lock themselves out (Principle V).

## Frontend tests

- `tests/unit/shortcut-conflicts.test.ts`: rewritten on `COMMANDS` + `findConflict`; still fails
  on any conflict among defaults and on reserved browser keys.
- Unit: `chordFromEvent` (letters, Shift+Slash `?`, Numpad, AZERTY `key` vs `code`),
  `checkChord` (each refusal), `findConflict` (each scope case), `resolveKeymap` (dropped default).
- Component: recording on a row saves; Esc is recorded; Cancel restores; conflict dialog both
  branches; Reset, Remove, Reset all; save failure rolls back; axe check on the page.
- Playwright: change "New note", use it in a workspace, old key does nothing, reload keeps it,
  tooltip shows the new key.
