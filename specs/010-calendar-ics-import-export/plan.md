# Implementation Plan: Calendar Import and Export (.ics)

**Branch**: `events` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-calendar-ics-import-export/spec.md`

## Summary

Settings gains "Import and export". **Export** reads class and event lineages (optionally one
semester), writes one RFC 5545 file with `icalendar`: one repeating `VEVENT` per rule segment
(`RRULE` + `UNTIL`), `EXDATE` for cancelled occurrences, `RECURRENCE-ID` overrides for single
edits, `TZID` = the user's zone with a generated `VTIMEZONE`, and `X-UNIHELPER-*` fields for kind,
year, semester, course, colour and lineage. **Import** stages the uploaded file, parses and checks
it on the server, maps each `VEVENT` to the app's weekly rule space (unsupported rules flagged),
converts times into the user's zone (splitting a series into lineage segments where source-zone
DST differs), groups by title and returns a preview. The user's plan is applied in one
transaction that creates or updates ordinary `class_series` / `event_series` /
`session_exceptions` rows, remembers each file `UID` in `calendar_import_sources` for duplicate-
free re-imports, freezes content-bearing occurrences instead of moving them, and records a
`calendar_import_runs` row that powers the result screen and "Undo import".

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.9 / React 19 (frontend), as in 001–009.

**Primary Dependencies**: **new** backend package `icalendar` (≥ 6.1, < 8) for parsing/writing
(research R1); existing `python-dateutil` (rule expansion), `tzdata`/`zoneinfo`, FastAPI,
SQLAlchemy, Alembic. Frontend: no new packages (shadcn/Radix, TanStack Query, Sonner, existing
XHR uploader `lib/api/upload.ts`).

**Storage**: SQLite migration `0011_calendar_import`: `calendar_import_uploads`,
`calendar_import_runs`, `calendar_import_sources` ([data-model.md](./data-model.md)). Staged
files in `files/.uploads/<token>.part` (existing staging area), deleted after apply/cancel/expiry.
No new user-visible folders: year/semester/course folders are created as by hand; session folders
appear on first content.

**Testing**: pytest unit/contract/integration (research R16) with `.ics` golden fixtures (R15);
contract coverage guard picks up `contracts/openapi.yaml`; migration test 0011; Vitest (wizard
reducer, summaries); Playwright (keyboard import, cancel, undo, export, axe light/dark/custom);
manual interoperability check in Google Calendar, Apple Calendar and Outlook (quickstart 6).

**Target Platform**: evergreen desktop browsers; same server as before.

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: 5 MB / 5,000-event file reaches the preview in < 10 s including upload on
a local network (SC-008), parse itself < 3 s; apply of a 10-course semester < 2 s; export of a
full account (≤ 2,000 lineages) < 2 s.

**Constraints**: Constitution 1.2.0 — I (import never deletes; content-bearing occurrences never
move; apply atomic; undo only removes content-free items it created), II (imported entries use
the normal readable folders; DB stays metadata-only; exports contain no notes/audio/documents),
III (all via `/api/v1`; only `StorageService` touches files; frontend never parses `.ics`),
V (tokens, keyboard, live announcements, AA), VI (endpoint + flow tests), VII (one new
dependency, justified below).

**Scale/Scope**: ≤ 5 MB, ≤ 5,000 `VEVENT`s per file; ≤ 500 occurrences per series (existing
limit); one staged upload per user at a time (a new upload discards the previous one).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 010 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Import never deletes; never changes/moves an occurrence with notes, recordings or documents; failure changes nothing; undo safe | PASS | PASS — single transaction + `on_rollback` removal of new empty dirs (R13); content occurrences frozen as detached exceptions, reported skipped (R11); undo removes only created, content-free, non-Trash items, no files (R13); entries missing from a newer file untouched |
| II. Data ownership | Same readable folders as hand-made entries; no note/audio/document in files; DB not sole store | PASS | PASS — creation goes through `get_or_create_*` and series inserts; folders on first content (009); export reads schedule tables only; reserved `_Events` refused for imported course names (R12) |
| III. Separation | Versioned REST, documented contracts, file access via `StorageService` | PASS | PASS — 5 operations in `contracts/openapi.yaml`; staging via existing `receive_upload`/`StorageService`; parsing server-side only |
| IV. Transcription | Unaffected | PASS | PASS — no provider or key changes; imported sessions transcribe like any other |
| V. UI quality | shadcn primitives, tokens, light/dark/custom, keyboard, AA, no colour-only state | PASS | PASS — `contracts/ui-import-export.md`: drop area with button equivalent, live progress/result, text badges, named colour swatches, focus management, reduced motion |
| VI. Testing | Endpoint tests; critical flows green | PASS | PASS — contract tests per operation incl. every rejection; integration: import flow, re-import, failure atomicity, undo, round trip, migration; critical flow 3 re-run with imported classes |
| VII. Simplicity, spec discipline | SQLite only; justified deps; in-spec only | PASS (with justification) | PASS — one new pure-Python package (`icalendar`, see Complexity Tracking); no services, queues or caches; no out-of-scope behaviour (no sync, webcal, attendees, all-day) |

**Result**: all gates pass.

## Notes on the spec

- FR-005 ("one repeating event, not many separate events") is met per rule segment: a lineage
  split by "this and following" edits is written as one repeating `VEVENT` per segment, which is
  also how Google Calendar exports such series (research R10). No spec change needed.
- Matched entries whose type differs from the chosen "Import as" are skipped as `kind_mismatch`
  instead of converted (research R11) — consistent with "nothing is guessed silently".
- Floating/UTC repeating events are anchored in the file's calendar zone so local times stay
  constant (FR-030, research R5).

## Project Structure

### Documentation (this feature)

```text
specs/010-calendar-ics-import-export/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · ui-import-export.md
├── checklists/requirements.md
└── tasks.md                (next: /speckit-tasks)
```

### Source Code (changes)

```text
backend/
├── pyproject.toml                               # + icalendar
└── src/unihelper/
    ├── db/migrations/versions/0011_calendar_import.py
    ├── models/calendar_import.py                # CalendarImportUpload, CalendarImportRun, CalendarImportSource
    ├── domain/ical_read.py                      # parse + checks → SourceEntry (pure; text/link cleaning, Google block)
    ├── domain/ical_rules.py                     # RRULE → app Rule | Unsupported; tz conversion; DST segment split
    ├── domain/ical_write.py                     # lineages → VCALENDAR (VTIMEZONE, RRULE/UNTIL, EXDATE, RECURRENCE-ID, X-UNIHELPER-*)
    ├── domain/import_plan.py                    # grouping, ids, defaults, colour assignment, plan validation (pure)
    ├── storage/storage_service.py               # staged .ics helpers (reuse `.part` staging), remove-if-empty
    ├── services/calendar_import_service.py      # stage/preview, apply (match → create/update/freeze), discard, sweep
    ├── services/calendar_import_undo.py         # undo of a run (shares checks with creation_undo)
    ├── services/calendar_export_service.py      # scope query → ical_write; counts; file name
    ├── services/trash_service.py                # purge also deletes calendar_import_sources of the lineage; "is lineage in trash"
    ├── schemas/calendar_io.py
    ├── api/v1/calendar_io.py                    # 5 operations
    └── main.py                                  # router registration; startup sweep of expired uploads
backend/tests/
├── fixtures/ics/                                # google-fall(.v2), apple-floating, outlook-windows-tz, unsupported, all-day, edge, large-4000, too-big
├── unit/test_ical_read.py · unit/test_ical_rules.py · unit/test_ical_write.py · unit/test_import_plan.py
├── contract/test_calendar_imports.py · contract/test_calendar_export.py
└── integration/test_calendar_import_flow.py · integration/test_calendar_roundtrip.py · integration/test_migration_0011.py

frontend/src/
├── features/settings/SettingsLayout.tsx         # + "Import and export" section
├── features/settings/routes.tsx                 # + /settings/import-export (lazy)
└── features/settings/calendar-io/
    ├── api.ts                                   # upload (XHR with progress/cancel), apply, discard, undo, export (blob)
    ├── ImportExportPage.tsx
    ├── ExportCard.tsx
    ├── ImportWizard.tsx · wizardReducer.ts      # steps, plan state, validation (unit-tested)
    ├── DestinationPicker.tsx · GroupTable.tsx · GroupRow.tsx · CourseMappingCombobox.tsx
    └── ImportResult.tsx                         # counts, skipped reasons, Undo dialog
frontend/tests/
├── unit/calendar-io/wizardReducer.test.ts
└── e2e/calendar-import-export.spec.ts
```

**Structure Decision**: Existing web-application layout. Pure parsing/mapping/writing lives in
`domain/` (unit-testable without DB, like `recurrence.py`); orchestration in `services/`; one
new router. The frontend feature sits under Settings next to `trash/` and `themes/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New dependency `icalendar` (Principle VII) | Correct reading of real Google/Apple/Outlook files (folding, escaping, `VTIMEZONE`, Windows `TZID`s) and standards-conformant writing are required by FR-011, SC-002, SC-003 | A hand-written parser/writer re-implements RFC 5545 and its time-zone rules with high risk of subtle interop bugs; pure Python, no service or infrastructure added |
| New tables `calendar_import_sources` / `_runs` / `_uploads` | Duplicate-free re-import (FR-038), undo (FR-034) and preview→apply on the same file (R2) need durable state | Matching by title/time produces duplicates; storing source ids on series rows would spread import concerns across `class_series`, `event_series` and exceptions |
