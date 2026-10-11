# Interoperability and quickstart results: Calendar Import and Export (.ics)

**Purpose**: Record the manual checks of FR-011 / SC-002 / SC-003 (quickstart scenario 6) and the
quickstart run (T037, T060).
**Feature**: [spec.md](../spec.md) · [quickstart.md](../quickstart.md)

## Automated (done 2026-10-12)

- [x] Export structure: `VCALENDAR` 2.0, `PRODID`, `UID`/`DTSTAMP`/`DTSTART`/`DTEND` on every
      `VEVENT`, one `VTIMEZONE` per `TZID`, lines ≤ 75 octets, `UNTIL` in UTC
      (`tests/unit/test_ical_write.py`)
- [x] Expanding the exported rule with `dateutil` in the zone gives the app's dates at the same
      wall-clock time on both sides of a DST change (`test_round_trip_across_dst`)
- [x] Export → import into a fresh account restores kinds, years, semesters (with dates),
      courses, colours, times, locations, links, a moved and a cancelled session and a
      two-segment lineage; re-importing into the source account changes nothing
      (`tests/integration/test_calendar_roundtrip.py`)
- [x] Google-, Apple- and Outlook-shaped files (Meet block, custom `VTIMEZONE`, floating times,
      Windows `TZID`s) import at the expected local times (`tests/unit/test_ical_rules.py`,
      `tests/integration/test_calendar_import_flow.py`)
- [x] Quickstart scenarios 1–5, 7–11 covered by the backend suite and
      `frontend/tests/e2e/calendar-import-export.spec.ts` (light and dark) and the 010 test in
      `frontend/tests/e2e/a11y-themes.spec.ts` (custom theme)

## Manual: import an exported file into other calendar apps (not done yet)

Export a semester with a weekly class (one moved and one cancelled session), a one-time event
and a repeating event, then import the file into each app and compare each entry.

| Check | Google Calendar | Apple Calendar | Outlook |
|---|---|---|---|
| Imports without errors | [ ] | [ ] | [ ] |
| Weekly class shows as one repeating event | [ ] | [ ] | [ ] |
| Moved session at its new time | [ ] | [ ] | [ ] |
| Cancelled session absent | [ ] | [ ] | [ ] |
| Same wall-clock times in the week after a DST change | [ ] | [ ] | [ ] |
| Locations and links present | [ ] | [ ] | [ ] |

## Notes

- The manual table needs accounts in the three apps and was not run in this environment.
