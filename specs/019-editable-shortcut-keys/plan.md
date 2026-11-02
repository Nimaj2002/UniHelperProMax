# Implementation Plan: Editable Shortcut Keys

**Branch**: `019-editable-shortcut-keys` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-editable-shortcut-keys/spec.md`

## Summary

Turn the read-only Settings → Keyboard shortcuts page into an editor for every listed shortcut,
with a main and an alternate key per command. Custom shortcuts are stored as one new `shortcuts`
key in the existing per-user preferences (no table, no migration, already backed up and synced).
On the frontend, one command registry (`lib/keymap`) replaces the three hand-written shortcut
lists and the hard-coded key checks in 12 handlers; handlers, hints, `aria-keyshortcuts`, the
calendar "?" dialog and the conflict test all read from it. Conflicts follow the scope rule from
the clarification session: only commands that can fire from the same place clash.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5.9 + React 19 (frontend)

**Primary Dependencies**: FastAPI, Pydantic 2; TanStack Query 5, shadcn/ui (`Button`,
`AlertDialog`, `DropdownMenu`, `Badge`). No new dependency.

**Storage**: SQLite `ui_preferences.data` (JSON text), new `shortcuts` key (research R1)

**Testing**: pytest (contract), vitest + vitest-axe (unit, component), Playwright (e2e)

**Target Platform**: Desktop app (Electron + local backend) and web build

**Project Type**: Web application (backend + frontend)

**Performance Goals**: a changed shortcut works on the next key press, no reload (FR-004); key
matching adds no noticeable delay (a lookup over ≈60 commands per key press)

**Constraints**: physical-key matching for non-US layouts (research R3); no key a keyboard-only
user needs can be removed entirely (FR-007a, Principle V)

**Scale/Scope**: ≈60 commands in 8 groups; 1 backend schema/service change; 1 new frontend
module, 1 rewritten settings page, 12 handlers and ≈21 hint sites rewired

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. User work never lost | ✅ | No user content touched. "Reset all" asks for confirmation. A failed save rolls back and says so (FR-012). |
| II. Data ownership & open formats | ✅ n/a | Settings, not user content; stays in the SQLite preferences row like theme. Included in backup. |
| III. Frontend/backend separation | ✅ | Additive field on the documented `/api/v1/preferences` endpoints; contract in `contracts/preferences-shortcuts.md`. No version bump. |
| IV. Providers & secrets | ✅ n/a | No providers or secrets. |
| V. UI quality & accessibility | ✅ | shadcn primitives and theme tokens; recorder fully keyboard operable with live-region announcements; Tab never assignable; keyboard-only commands keep at least one key (FR-007a). |
| VI. Tests | ✅ | Contract tests for the new field and each 422; unit tests for chord/conflict/resolver; component and Playwright tests. Critical flows untouched. |
| VII. Simplicity | ✅ | No new table, endpoint, migration or dependency. One new module replaces three duplicated lists. |
| VIII. Desktop data safety | ✅ n/a | No data-folder or schema change. |

**Post-design re-check**: all gates still pass. The registry module is a consolidation, not an
added layer (it removes `CALENDAR_SHORTCUTS`, `WORKSPACE_SHORTCUTS` and the page's own list).

## Project Structure

### Documentation (this feature)

```text
specs/019-editable-shortcut-keys/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── preferences-shortcuts.md
│   └── ui-keymap.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/unihelper/
│   ├── schemas/notes.py                 # Preferences.shortcuts + Chord model, validation
│   └── services/workspace_service.py    # DEFAULT_PREFERENCES["shortcuts"] = {}
└── tests/contract/test_preferences.py   # new cases

frontend/
├── src/
│   ├── lib/keymap/                      # NEW: commands.ts, chord.ts, conflicts.ts, useKeymap.ts
│   ├── features/settings/shortcuts/     # ShortcutsSettings.tsx (editor), ShortcutSlot.tsx (recorder)
│   ├── features/sessions/api.ts         # useUpdatePreferences: rollback on error
│   ├── features/calendar/               # ShortcutsDialog from registry; keyboard hooks rewired
│   └── (12 handler files, ≈21 hint files — contracts/ui-keymap.md)
└── tests/
    ├── unit/shortcut-conflicts.test.ts  # rewritten on the registry
    ├── unit/keymap.test.ts              # NEW
    └── e2e/shortcuts.spec.ts            # NEW
```

**Structure Decision**: Existing web-app layout (`backend/`, `frontend/`). The only new folder is
`frontend/src/lib/keymap/`, next to the existing `lib/shortcuts.ts` helpers it builds on.

## Phase 0: Research

See [research.md](research.md): storage (R1), stored shape (R2), chord identity (R3), registry
(R4), conflict rule (R5), refused keys (R6), recorder UI (R7), save failures (R8). No open
questions.

## Phase 1: Design

- [data-model.md](data-model.md): Chord, `Preferences.shortcuts`, Command registry, resolved
  binding, slot state transitions.
- [contracts/preferences-shortcuts.md](contracts/preferences-shortcuts.md): API delta, 422 cases,
  backend tests.
- [contracts/ui-keymap.md](contracts/ui-keymap.md): keymap module API, handler/hint migration
  list, page states, frontend tests.
- [quickstart.md](quickstart.md): automated and manual validation.

## Suggested order

1. Backend field + contract tests (small, unblocks the frontend).
2. `lib/keymap` with today's defaults; conflict test rewritten on it — must pass with no
   behavior change.
3. Move handlers and hints onto the keymap, one area at a time (each area testable alone).
4. Settings page editor (US1), conflicts and refusals (US2), reset (US3), remove (US4).
5. Playwright + manual quickstart in light and dark themes.

## Complexity Tracking

No violations to justify.
