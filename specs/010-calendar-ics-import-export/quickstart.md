# Quickstart: validating Calendar Import and Export (.ics)

How to prove feature 010 works end to end. Contracts: [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-import-export.md](./contracts/ui-import-export.md); data: [data-model.md](./data-model.md);
decisions: [research.md](./research.md).

## Prerequisites

- Backend dependencies synced after adding `icalendar` (`cd backend && uv sync`).
- Migration `0011_calendar_import` applied (runs on startup).
- Frontend dev server or built SPA; a user whose time zone has DST (e.g. `Europe/Berlin`) and a
  second user in `Europe/Istanbul` (no DST) to exercise zone conversion.
- Fixtures in `backend/tests/fixtures/ics/` (research R15).

## Automated checks

```bash
cd backend
uv run pytest tests/unit -k "ical or import_plan"
uv run pytest tests/contract/test_calendar_imports.py tests/contract/test_calendar_export.py tests/contract/test_coverage.py
uv run pytest tests/integration/test_calendar_import_flow.py tests/integration/test_calendar_roundtrip.py tests/integration/test_migration_0011.py
uv run pytest            # full suite incl. critical flows 1–3 (Principle VI)
uv run ruff check . && uv run mypy

cd ../frontend
npm run typecheck && npm run lint && npm test
npx playwright test tests/e2e/calendar-import-export.spec.ts
```

Expected: all green; the coverage guard confirms the five new operations are documented and hit.

## Manual scenarios

1. **Google import (US1)**: Settings → Import and export → drop `google-fall.ics`. Preview lists
   "Linear Algebra" (Mon, Wed 10:00–11:30, selected, Class) and "Physics II" (Tue, selected,
   Class); "Dentist" not selected, Event; all-day "Holiday" in the skipped list with "all-day
   events are not supported yet". Choose an existing semester that has "linear algebra " →
   mapped to it; "Physics II" shows "New course" with a palette colour. Import → result counts
   match; sessions appear on the calendar and course timelines; adding a note creates the usual
   `<year>/<semester>/<course>/<date>/notes/` folder.
2. **Re-import (US3)**: add a note to one Linear Algebra session; import `google-fall-v2.ics`
   (time moved 10:00 → 10:40, one class added). Preview shows "will update"; result: updated
   count > 0, the noted session listed as skipped ("has notes, recordings or documents") and still
   at 10:00; no duplicates on the calendar.
3. **Undo (US3)**: on the result screen choose "Undo import" → only content-free entries and
   empty new courses are removed; the noted session's class remains and is listed as kept.
4. **Unsupported rules (US4)**: import `unsupported.ics` (daily, monthly, yearly). Groups show
   "Not supported"; confirm is disabled until each has "first occurrence only" or "Skip".
5. **Time zones (US4)**: as the Istanbul user, import `newyork-weekly.ics` spanning the US DST
   change: preview notes "Times change on <date>"; after import, sessions before/after the change
   differ by one hour locally, matching Google Calendar's display for the same zone.
6. **Export (US2)**: export "2026 · Fall 2026" → file `UniHelperProMax-2026-Fall-2026-<date>.ics`.
   Import it into Google Calendar (Settings → Import), Apple Calendar (File → Import) and Outlook
   (Add calendar → Upload from file). For each, check: weekly classes show as repeating, the moved
   session at its new time, the cancelled one absent, times right in the week after the DST
   change, locations and links present. Record results in the PR.
7. **Round trip (US3)**: as a fresh user, import the exported file: kinds, years, semesters,
   courses and colours restored without choosing them.
8. **Rejections**: empty file, a `.ics` of 5 MB + 1 byte, a renamed PNG, a 5,001-event file →
   each shows its message; the calendar is unchanged.
9. **Nothing to export**: export an empty semester → "There is nothing to export…"; no download.
10. **Keyboard and themes (US5)**: complete scenario 1 with keyboard only and a screen reader in
    light, dark and a custom theme; cancel once during reading of `large-4000.ics`; progress and
    the result summary are announced.
11. **Atomicity**: with the failure-injection test hook (integration test only) the apply fails
    mid-way: no new rows, no new course/semester folders.
