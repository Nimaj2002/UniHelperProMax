# Research: Editable Shortcut Keys

All Technical Context items were known from the codebase; no NEEDS CLARIFICATION remained. The
decisions below settle the design questions the spec leaves to planning.

## R1. Where custom shortcuts are stored

- **Decision**: A new `shortcuts` key in the existing per-user preferences object
  (`ui_preferences.data`, `GET/PATCH /api/v1/preferences`).
- **Rationale**: That object already holds per-account UI settings (theme, player volume, editor
  mode), is loaded once at start (`usePreferences`, `staleTime: Infinity`), is updated
  optimistically (`useUpdatePreferences`), and the `ui_preferences` table is already in the
  backup table list (`backend/src/unihelper/backup/tables.py`). FR-011 (account, all devices,
  backup/restore) comes for free. No migration: the column is a JSON text blob.
- **Alternatives considered**: a new `shortcuts` table and endpoint (more code, a migration and a
  backup-table entry for no gain); browser `localStorage` (fails FR-011: not per account, not
  backed up).

## R2. Stored shape: overrides only, per command

- **Decision**: `shortcuts: { [commandId]: [main, alternate] }`, each slot a `Chord` object or
  `null` (removed). A command absent from the map uses both defaults. A command is written only
  when at least one slot differs from its default; when a reset makes both slots equal the
  defaults again, the entry is deleted. The whole map is sent on each change (PATCH replaces the
  top-level `shortcuts` key, matching how the other preference keys behave).
- **Rationale**: Keeps the stored data small and readable, and lets new defaults in later releases
  reach users who never touched that command. Sending the whole map avoids a per-key merge
  protocol; the map is at most a few KB.
- **Known limit**: if a user changed one slot of a command and a later release changes that
  command's other default, the user keeps the old default in the other slot. Acceptable: rare,
  harmless, and fixed by "Reset".
- **Alternatives considered**: storing every slot always (stale defaults after updates); storing
  per-slot sentinels like `"default"` (more states to validate, no user-visible benefit).

## R3. How a key press is identified

- **Decision**: A chord is the physical key (`KeyboardEvent.code`) plus modifiers in fixed order
  `Ctrl+Meta+Alt+Shift+<code>`, e.g. `Alt+Shift+KeyK`. Each stored chord also keeps a `label`:
  what the user saw when recording (from `KeyboardEvent.key`, e.g. `Alt+Shift+K`, `?`, `é`).
  Defaults get their label from `navigator.keyboard.getLayoutMap()` when available (Chromium,
  Electron) and fall back to the US label otherwise.
- **Rationale**: The workspace shortcuts and the existing conflict test already use `code`, so
  non-US layouts and macOS Option characters work (spec edge case). Storing the label makes the
  hint match what the user pressed.
- **Alternatives considered**: matching on `key` (breaks with Alt/Option on macOS and on AZERTY
  for Alt+letter combos).

## R4. Command registry, one source of truth

- **Decision**: One frontend module lists every command on the shortcuts page: id, label, group
  (the page's sections), scope (`app` or one tool), default `[main, alternate]`, and flags
  (`worksWhileTyping`, `noShiftVariant`). The settings page, the calendar "?" dialog, every
  `aria-keyshortcuts` and tooltip hint, every key handler and the conflict unit test read from it.
- **Rationale**: Today the bindings live in 12 handlers plus three hand-written lists
  (`CALENDAR_SHORTCUTS`, `WORKSPACE_SHORTCUTS`, `ShortcutsSettings` GROUPS) that already drift
  (the settings page filters the calendar list with regexes). FR-005 needs one place.
- **Rows split per command** (FR-002): e.g. "D / W / M" → three commands; "← / → or K / J" →
  previous period (← / K) and next period (→ / J); "Arrow keys" in the time grid → four commands.

## R5. Conflict rule (FR-006) and its single implementation

- **Decision**: A pure function `findConflict(resolved, commandId, slot, chord)`. Scopes are
  `global` (every page), `workspace` and `calendar` (one page each), and one scope per tool. Two
  commands clash when they share a chord and either have the same scope, or one is `global` and
  the other is `workspace` or `calendar`. A tool never clashes with a page-wide key: every tool
  handler `preventDefault`s the keys it handles and every page-wide handler ignores
  `defaultPrevented` events, so inside a tool its own key always wins and an app-wide key can never
  override it (the clarified FR-006 case (c) cannot happen). The same function runs in the settings
  page, in the runtime resolver and in the unit test that checks the defaults.
- **Runtime resolver**: defaults are applied first, then user overrides. A default slot that
  conflicts with a user override is dropped (the spec edge case: a new command whose default the
  user already took starts as "Not set" and is flagged on the page).
- **Where the keymap lives at runtime**: `KeymapSync` (a global host, mounted once) resolves the
  stored preferences and publishes them to a small module store; handlers read it at key time
  (`matches`) and hints subscribe to it (`useKeymap`, `useSyncExternalStore`), so plain
  components don't need the query client. The settings page resolves from the preferences itself.
- **Backend does not check conflicts**: the backend validates shape and size only. Conflicts are
  about the command list, which lives in the frontend; a stored conflicting map cannot lose data
  and the resolver handles it deterministically (registry order wins). This keeps Principle III
  (the API is still the only path) without duplicating the registry in Python.

## R6. Keys that are refused (FR-007, FR-008)

- **Decision**: Refuse modifier-only presses, `Tab`, `Shift+Tab`, and a reserved list:
  Ctrl/Cmd + C, V, X, Z, Y, Shift+Z, A, W, Q, R, Shift+R, N, T, L, K, F5, plus the Alt menu
  accelerators the conflict test already guards (Alt+F/E/V/S/B/T/H) and the Electron app-menu
  accelerators (`desktop/src/window.ts` uses the `fileMenu`, `editMenu`, `windowMenu` roles:
  close, quit, minimize). Commands with `worksWhileTyping` (Notes workspace) require Alt, Ctrl
  or Meta.
- **Shift variants**: PDF annotation arrows use Shift for a bigger step, and the calendar grid
  uses Shift+↑/↓ for the range. Those move commands carry `noShiftVariant`: their chord may not
  include Shift, and Shift+<their chord> stays reserved for the bigger step.

## R7. Recording UI

- **Decision**: Each slot is a button showing the chord as `<kbd>`. Activating it enters
  recording: a `keydown` listener in the capture phase on that button takes the next
  non-modifier key, calls `preventDefault` and `stopPropagation` (so the press does not also run
  a command), validates, then saves or shows the refusal/conflict. Cancel is a visible button and
  blur; Esc is recorded like any key (spec clarification). While recording, every global key
  handler is paused through a shared flag in the keymap module.
- **Accessibility**: an `aria-live="polite"` region announces "Press the new shortcut",
  "Saved: Alt+Shift+M", "Alt+N is used by New note", or the refusal reason. Conflicts use the
  existing shadcn `AlertDialog` (reassign / cancel). Reset all uses `AlertDialog` too.

## R8. Save failures (FR-012)

- **Decision**: Use the mutation's error state: on failure, roll back the optimistic cache entry
  to the previous preferences and show an inline error on that row with "Try again". The
  current `useUpdatePreferences` has no rollback; add `onError` restoring `prev`, which also
  fixes the same gap for the other preferences.
