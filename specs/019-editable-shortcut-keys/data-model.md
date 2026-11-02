# Data Model: Editable Shortcut Keys

No new table and no migration. Custom shortcuts are one new key in the existing per-user
preferences JSON (`ui_preferences.data`, research R1).

## Chord (stored)

| Field | Type | Rules |
|-------|------|-------|
| `chord` | string | `^(Ctrl\+)?(Meta\+)?(Alt\+)?(Shift\+)?[A-Za-z0-9]{1,24}$`, modifiers in this order, last part is a `KeyboardEvent.code` (e.g. `Alt+Shift+KeyK`, `ArrowLeft`, `Escape`) |
| `label` | string | 1–32 chars; what the user pressed, shown in hints (e.g. `Alt+Shift+K`) |

## Preferences.shortcuts (stored)

`{ [commandId: string]: [Chord | null, Chord | null] }`

- Key: command id, `^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$`, max 64 chars (e.g.
  `workspace.newNote`, `player.playPause`).
- Value: exactly two slots, `[main, alternate]`. `null` = removed ("Not set").
- At most 200 entries. Default: `{}`.
- Only commands with at least one slot different from the default are stored (research R2).
- Unknown command ids are kept by the backend and ignored by the frontend (spec edge case:
  removed or renamed commands).

## Command (frontend registry, not stored)

| Field | Meaning |
|-------|---------|
| `id` | stable id, as above |
| `label` | text on the shortcuts page |
| `group` | page section: General, Notes workspace, AI chat, Calendar, Task board, Recording player, PDF annotations, Diagram viewer |
| `scope` | page-wide `global`, `workspace` or `calendar`, or a tool: `calendarGrid`, `taskBoard`, `checklist`, `player`, `pdfAnnotation`, `pdfAnnotationEditor`, `diagramViewer`, `chatBox` (research R5) |
| `defaults` | `[main, alternate]` chord strings or null |
| `worksWhileTyping` | true for Notes workspace commands → a modifier is required (FR-008) |
| `noShiftVariant` | true for the PDF annotation moves, whose Shift form means "bigger step" (research R6); the calendar grid's range keys are their own commands |
| `keyboardOnly` | the only keyboard way to do it: its last key can't be removed (FR-007a) |

## Resolved binding (runtime, not stored)

For each command: two slots, each `{ chord, label, source: "default" | "custom" | "dropped" }` or
none. `dropped` = a default removed because a user override took the same chord in a conflicting
scope; the page flags it (spec edge case).

## State transitions of one slot

```text
default ──record──▶ custom ──reset──▶ default
   │                  │
   └──remove──▶ removed (null) ◀──remove──┘
removed ──record──▶ custom;  removed ──reset──▶ default
any ──"Reset all" (confirmed)──▶ default  (map becomes {})
```

A reset or record that would create a conflict goes through the conflict flow (reassign: the
other slot becomes `null`; cancel: nothing changes). Removing the last slot of a command that has
no other way to run it is refused (FR-007a).
