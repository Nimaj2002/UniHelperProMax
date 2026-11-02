# Quickstart: validate Editable Shortcut Keys

## Prerequisites

The usual dev setup (`./start.sh`, or backend `uv run` + frontend `pnpm dev`), signed in as any
user.

## Automated checks

```bash
cd backend && uv run pytest tests/contract/test_preferences.py
cd frontend && pnpm test -- shortcut keymap ShortcutsSettings
cd frontend && pnpm exec playwright test shortcuts
```

Expected: all pass. The conflict test fails if any two defaults clash (contracts/ui-keymap.md).

## Manual scenarios (spec user stories)

1. **Change** (US1): Settings → Keyboard shortcuts → "New note" main slot → press Alt+Shift+M.
   Row shows Alt+Shift+M and "Changed". Open a session: Alt+Shift+M makes a note, Alt+N does
   nothing. Hover the new-note button: hint shows Alt+Shift+M. Reload: still Alt+Shift+M.
2. **Esc is recordable, Cancel cancels** (US1-3): start recording "Stop generating", press Esc →
   saved as Esc. Start recording again, click Cancel → unchanged.
3. **Conflict** (US2): set "Close the current tab" to Alt+Shift+M → dialog names "New note".
   Reassign → New note shows "Not set". Repeat and Cancel → nothing changes.
4. **Different tools may share** (FR-006): set "Play or pause" alternate to C → accepted, even
   though PDF annotations use C.
5. **Refusals** (US2-2/3): Ctrl+C → refused (reserved); Q for "New note" → refused (needs a
   modifier); Tab → refused; Alt alone → nothing recorded.
6. **Two slots** (US4-2): remove the alternate of "Play or pause" → Space still works, K does
   nothing.
7. **Keyboard-only guard** (FR-007a): remove both slots of a time-grid move → the second Remove
   is disabled with a reason.
8. **Reset** (US3): Reset on "New note" → Alt+N back. Reset all → confirm → no "Changed" badges.
9. **Save failure** (FR-012): stop the backend, change a shortcut → "Not saved. Try again.",
   old key still works.
10. **Sync and backup** (FR-011): change a shortcut, make a backup, reset all, restore → the
    change is back. Sign in from a second browser → the change is there.
11. **Keyboard and screen reader** (FR-013): do scenario 1 with keyboard only; the live region
    announces recording start and the result. Check light and dark themes.
