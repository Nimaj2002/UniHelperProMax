# Implementation Plan: Calendar Events and Quick Create

**Branch**: `events` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-calendar-events-quick-create/spec.md`

## Summary

Events are a second kind of series next to classes: a new `event_series` table that reuses 001's
pure recurrence and scope planners, owned by a semester instead of a course, with occurrence keys in
the same `{lineageId}:{date}` keyspace so every `sessionKey` workspace API (notes, recordings,
transcription, documents, workspace state) serves events unchanged. Event folders live in
`<year>/<semester>/_Events/<YYYY-MM-DD Title>/`; `_Events` is reserved and refused as a course
folder name. Deleting a class or event (any scope, and every class/event inside a deleted
course/semester/year) creates a Trash entry holding the exact before-images and detaches the
content folders without touching files; Settings → Trash restores (recreating missing parents by
name) or permanently deletes (the only path that removes files). The calendar gains event blocks
with a non-colour marker, 15-minute press-and-drag/click/keyboard drafts, and a quick form popover
with Undo.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.9 / React 19 (frontend) — as 001–008.

**Primary Dependencies**: no new packages. Backend FastAPI, SQLAlchemy, Alembic; frontend Radix
(shadcn) Popover/Sheet/AlertDialog/Tooltip, TanStack Query, Sonner (toast action for Undo), motion,
Phosphor icons.

**Storage**: SQLite migration `0010_events_trash`: new `event_series`, `event_links`,
`trash_entries`; `session_folders` rebuilt (`course_id` nullable, + `semester_id`, `kind`,
`trash_entry_id`, `origin_path`); `session_exceptions` + `title`, `color`, `links_json`,
`moved_date`, `detached`; preferences + `lastSemesterId`, `quickCreateType`. Files:
`…/<semester>/_Events/<folder>/{notes,audios,documents}`. New `StorageService.delete_tree` (Trash
permanent delete only).

**Testing**: pytest unit/contract/integration (list in research R15; contract coverage guard needs
every operation in `contracts/openapi.yaml` hit with 2xx); migration test 0010; Vitest (draft math,
overlap layout with drafts, quick-form reducer, keyboard range); Playwright (events, quick create,
trash, axe in light/dark/custom).

**Target Platform**: evergreen desktop browsers; touch devices get tap-to-create only.

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: draft follows the pointer within one frame (SC-003) with ≤ 50 entries per
week — drag state is local component state, no network or query invalidation during the drag;
`GET /sessions` for a week ≤ 300 ms with classes + events; restore/permanent delete of an entry
with 100 files ≤ 2 s.

**Constraints**: Constitution v1.2.0 — I (Trash keeps everything until "Yes"; confirmations name
content; quick form never stores before Save; failed saves keep data), II (`_Events` folder,
readable names, files never moved to hidden places, DB not sole store), III (all via `/api/v1`;
only `StorageService` touches files), V (tokens, non-colour marker, keyboard creation, AA,
reduced motion), VI (endpoint + critical flow tests), VII (no new dependency or service).

**Scale/Scope**: ≤ 500 occurrences per series (as classes); Trash unbounded (no auto-empty);
one draft at a time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 009 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Deletes confirmed with content named; nothing stored before Save; Undo removes only what it made; no file deleted without explicit confirmation | PASS | PASS — deletes detach folders into `trash_entries` (R6), files untouched until Trash "Yes"; undo refused once content exists (R10); restore never overwrites a directory; series edits freeze occurrences with content (R4) |
| II. Data ownership | Events at `<year>/<semester>/<reserved>/<date and title>/` with notes/audios/documents; reserved name never usable by a course | PASS | PASS — `_Events` (R1), checked on the sanitized folder name for create, rename, inline create and restore; pre-existing conflicts flagged, never merged; trashed files stay where the user put them |
| III. Separation | Versioned REST, documented contracts, file access via `StorageService` | PASS | PASS — 8 new operations + additive changes in `contracts/openapi.yaml`; `delete_tree` and `rename_dir` only in `StorageService` |
| IV. Transcription | Unchanged; works on event recordings through `sessionKey` | PASS | PASS — no provider or key changes |
| V. UI quality | shadcn primitives, tokens, light/dark/custom, keyboard, AA, no colour-only state | PASS | PASS — `contracts/ui-calendar.md`: Event icon + "Event:" name, draft tokens, keyboard slot ranges, focus management, live announcements, reduced motion |
| VI. Testing | Endpoint tests, critical flows green | PASS | PASS — contract per operation; integration for event storage, trash round-trip, hierarchy delete/restore, undo, migration; critical flows re-run (class delete expectations updated in `test_edit_scopes_flow`) |
| VII. Simplicity, spec discipline | SQLite only; no new deps; in-spec only | PASS | PASS — no packages, no services; `event_series` justified below vs. reusing `class_series` |

**Result**: all gates pass. One deliberate change of existing behaviour, required by the spec's
clarifications: class deletion now goes to the Trash and deleted sessions with content leave the
course timeline (previously shown as "No longer scheduled").

## Spec corrections made during planning

- FR-012 / US2 scenario 2 said upcoming events allow notes but not recording. Feature 002's
  clarification made recording allowed for every session, and the code has no such gate; since
  events follow "the same rules" as sessions, the spec now says recording is allowed for upcoming
  events too (research R5). Revert this if events should differ from sessions.

## Project Structure

### Documentation (this feature)

```text
specs/009-calendar-events-quick-create/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · ui-calendar.md
├── checklists/requirements.md
└── tasks.md                (next: /speckit-tasks)
```

### Source Code (changes)

```text
backend/src/unihelper/
├── db/migrations/versions/0010_events_trash.py
├── models/event_series.py                  # EventSeries, EventLink
├── models/trash_entry.py                   # TrashEntry
├── models/session_folder.py                # nullable course_id, semester_id, kind, trash_entry_id, origin_path
├── models/session_exception.py             # title, color, links_json, moved_date, detached
├── domain/naming.py                        # EVENTS_DIR="_Events", is_reserved_course_folder, event_folder_name
├── domain/recurrence.py · domain/scopes.py # segment protocol shared by class/event; moved/detached exceptions
├── domain/trash_payload.py                 # TrashPayloadV1 (before-images) build/apply, pure
├── storage/storage_service.py              # delete_tree (guarded), exists check for unique folder names
├── services/series_apply.py                # generic ChangeSet application (from class_service._apply)
├── services/event_service.py               # create/read/edit (freeze rule, semester lock), occurrences
├── services/trash_service.py               # move-to-trash, list, restore, purge
├── services/creation_undo.py               # undo of a fresh class/event + created hierarchy
├── services/session_folder_service.py      # resolve event keys; event folder parts; hide trashed
├── services/session_query.py               # list classes + events; kind
├── services/class_service.py               # delete → trash; created refs; reserved name via hierarchy
├── services/hierarchy_service.py           # reserved name; deletion → trash per lineage; impact counts
├── services/timeline_service.py            # exclude trashed; semester events timeline
├── services/document_service.py            # scope = course | event lineage
├── services/workspace_service.py           # lastSemesterId, quickCreateType
├── schemas/events.py · schemas/trash.py · schemas/classes.py · schemas/hierarchy.py · schemas/notes.py
└── api/v1/events.py · api/v1/trash.py · api/v1/sessions.py (deletion-impact) · main.py (routers)
backend/tests/
├── unit/test_event_naming.py · unit/test_event_scopes.py · unit/test_trash_payload.py
├── contract/test_events.py · contract/test_trash.py · contract/test_creation_undo.py · contract/test_sessions_events.py
└── integration/test_events_storage_flow.py · integration/test_trash_flow.py ·
    integration/test_hierarchy_delete_trash.py · integration/test_migration_0010.py

frontend/src/
├── styles/tokens.css                       # --draft-*, --event-marker
├── features/events/
│   ├── api.ts · routes.tsx                 # /events/new, /semesters/:id/events(/:sessionKey)
│   ├── EventForm.tsx · NewEventDialog.tsx · EditEventFlow.tsx
│   └── EventsPage.tsx                      # semester events timeline
├── features/calendar/
│   ├── draft.ts                            # pure snap/range/click helpers (unit-tested)
│   ├── useDraft.ts                         # one-draft reducer, discard rule, announcements
│   ├── useGridDrag.ts                      # pointer capture, auto-scroll, Escape
│   ├── QuickCreateForm.tsx                 # popover/sheet form, type switch, Undo toast
│   ├── TimeGrid.tsx · MonthView.tsx · EventBlock.tsx · layoutOverlaps.ts · CalendarToolbar.tsx
│   └── useCalendarKeyboard.ts              # `e` = New event; range selection
├── features/classes/                       # DeleteSessionFlow (impact + Trash), EditSessionFlow (kind branch), prefill via router state
├── features/courses/CoursePanel.tsx        # "Events" row per semester; reserved-name warning
├── features/sessions/                      # WorkspacePage + SessionTimeline accept event context
└── features/settings/trash/                # TrashPage, api.ts; SettingsLayout nav + route
frontend/tests/
├── unit/draft.test.ts · unit/quick-create.test.tsx · unit/overlap-layout.test.ts (+draft) · unit/trash-page.test.tsx
└── e2e/events.spec.ts · e2e/quick-create.spec.ts · e2e/trash.spec.ts · e2e/a11y-themes.spec.ts (+new screens)
```

**Structure Decision**: a new `features/events` module plus calendar-level drafting in
`features/calendar`, and a Trash page under `features/settings/trash`. Backend mirrors the classes
modules with a separate `event_series` table sharing the pure planners, and a `trash_service` that
wraps every deletion path.

## Phase 0 — Research

Complete: [research.md](./research.md) (R1–R15). The spec had no open markers after the
2026-10-10 clarifications; the plan fixes the reserved name (`_Events`), the Trash mechanics,
event document scope (per event series) and the recording rule correction above.

## Phase 1 — Design & Contracts

Complete: [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-calendar.md](./contracts/ui-calendar.md), [quickstart.md](./quickstart.md).
Post-design Constitution Check: PASS.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `session_folders` rebuild corrupts content links | Migration in one transaction with `foreign_key_check`; `test_migration_0010` copies a 0009 DB with notes/recordings/documents and verifies every row and path |
| Restore after the series was edited again | Restored dates inserted as their own segments of the same lineage (R6); integration test edits between delete and restore |
| Hierarchy delete leaves orphans (exceptions, workspace states have no FK) | Trash payload captures exceptions; workspace states keyed by lineage+date survive and reattach on restore; permanent delete removes them |
| Permanent delete removes the wrong directory | `delete_tree` accepts only paths recorded as a session/event folder, inside the user root, resolved without symlinks |
| Drag jank in large weeks | Drag state local to the column; no React Query updates during drag; layout recomputed only for the draft's day |
| Class deletion behaviour change surprises existing tests | Update `test_edit_scopes_flow` and 002 timeline expectations explicitly; release note in the quickstart |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Separate `event_series` table duplicating rule columns | Events must not touch class rows, queries or counts (FR-009, FR-015) | Nullable `course_id` on `class_series` needs a rebuild of the busiest table and a filter in every 001–008 query |
| `trash_entries` with JSON before-images | Restore must be exact after any scope and after parents were deleted | Soft-delete flags on every table would change every existing query; moving files to a hidden trash folder breaks Principle II |
