# Validation Record: Course Timeline & Session Notes (002)

**Date**: 2026-10-05

## Automated checks

| Check | Result |
|---|---|
| `ruff check` / `ruff format --check` | ✅ |
| `mypy` (strict, 63 files) | ✅ |
| `pytest` (unit, contract, integration) | ✅ 163 passed; coverage guard: every operation in both feature contracts exercised with a 2xx; live API = union of contracts |
| `eslint .`, `tsc -b --noEmit` | ✅ |
| `vitest` | ✅ 228 passed (autosave engine, live preview, timeline, dialogs, tabs, axe) |
| `playwright` light + dark | ✅ 20 passed (001 + 002 flows) |
| Production build | ✅ workspace lazy chunk 192 kB gzip; main bundle 262 kB gzip |

## Quickstart scenarios → evidence (automated)

- [x] 1 Course timeline — `e2e/notes.spec.ts`, `unit/timeline.test.tsx`, `contract/test_timeline.py`
- [x] 2 Open workspace (header, shareable URL) — `e2e/notes.spec.ts`
- [x] 3 Notes + autosave + files on disk — `e2e/notes.spec.ts`, `integration/test_notes_flow.py`
- [x] 4 Reload within a second keeps text — `e2e/notes.spec.ts` (local draft / server)
- [x] 5 Offline → retry → saved — `e2e/notes-resilience.spec.ts`, `unit/autosave.test.ts`
- [x] 6 External edit → conflict → Keep both — `e2e/notes-resilience.spec.ts`, `contract/test_notes.py`
- [x] 7 Session switching restores tabs, < 1 s, typed text kept — `e2e/workspace-switch.spec.ts`
- [x] 8 Rename / close / delete — `e2e/workspace-switch.spec.ts`, `contract/test_notes_manage.py`
- [x] 9 Live / raw, remembered — `e2e/notes.spec.ts`, `unit/live-preview.test.ts`, `contract/test_preferences.py`
- [x] 10 Duplicate / unsafe names — `e2e/notes.spec.ts`, `integration/test_notes_flow.py`
- [x] 11 Two sessions same day → `YYYY-MM-DD HHmm` — `integration/test_notes_flow.py`
- [x] 12 No longer scheduled — `contract/test_timeline.py`, `contract/test_classes_sessions_read.py`, `unit/timeline.test.tsx`
- [x] 13 Upcoming → past without reload — `unit/use-now.test.tsx`
- [x] 14 Keyboard + themes + axe — all E2E in light and dark; axe on timeline and workspace

A manual walk-through by a person has not been done yet.

Not yet done (manual checks):
- **SC-005** — create a course with 300 sessions (e.g. a class meeting several times a week over
  a long semester) and time how long the course page and the side-panel timeline take to open
  (target ≤ 1 s, current session in view); scroll the whole timeline and watch for stutter; open
  a note with about 50,000 words and type in it, checking that characters appear without
  noticeable lag (≤ 100 ms).

## Bugs found and fixed during implementation

- Tab state was lost when switching session within 500 ms of a change (debounced save was
  cancelled) — now flushed on switch/unmount.
- A save after the file was deleted outside the app could not be told apart from "recreate it"
  — the API now reports a missing file with an empty hash; only saves based on it recreate the file.
- Close buttons inside the tab list violated ARIA (axe) — tabs close with `Delete`/`Alt+W`; the
  “×” is a pointer-only icon.
