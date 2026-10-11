# Phase 0 Research: Calendar Events and Quick Create (009)

Builds on 001 (`class_series` rule segments, lineage, `session_exceptions`, scopes, hierarchy and
folders), 002 (session keys, `session_folders`, timeline, workspace), 003/004/006/007 (content keyed
by `sessionKey`; documents shared across a course), 005 (settings, preferences), 008 (left card
sections). Constitution v1.2.0 (Principle II: events in a reserved semester-level folder that no
course name can take).

Facts about today's code that drive the decisions below:

- Sessions are virtual: `{lineage_id}:{YYYY-MM-DD}` keys expanded from `class_series` segments
  (`domain/recurrence.py`); `session_folders` rows are created lazily on first content and own
  notes, recordings and documents (FK CASCADE). `session_folders.course_id` is NOT NULL.
- Every workspace API (notes, recordings, documents, transcriptions, workspace state) is addressed
  by `sessionKey` and goes through `session_folder_service.resolve`, which requires a course.
- Deleting a class (any scope) changes only `class_series`/`session_exceptions`; folders and files
  are kept and shown on the course timeline as "No longer scheduled". Deleting a course, semester
  or year cascades in the DB down to notes/recordings/documents rows (files stay on disk).
- No trash, no undo-able creation, no last-used semester preference, no pointer-drag code exist.
  `TimeGrid` already lays out overlaps in columns (`layoutOverlaps.ts`) and has 30-minute slot
  buttons that open `/classes/new?date&start&end`.

## R1. Reserved events folder name: `_Events`

- **Decision**: every semester's events live in `<year>/<semester>/_Events/<event folder>/`. The
  reserved key is `safe_name("_Events").casefold()` = `_events`. A course whose `safe_name` (the
  folder it would get) casefolds to `_events` is refused with 422 `reserved_name` on create and
  rename (`hierarchy_service._clean`, also reached by inline course creation in `POST /classes` and
  the quick form). `_folder_for` for courses also skips `_events` as a sibling name.
- **Pre-existing conflict** (edge case): migration 0010 does not rename anything. Courses whose
  `folder_key` is `_events` are flagged (`reservedNameConflict: true` in the course tree); creating
  event content in that semester returns 409 `events_folder_conflict` until the course is renamed.
- **Rationale**: readable in a file browser, sorts above course folders, and a leading underscore is
  not something students name courses; checking the sanitized folder (not the display name) closes
  `"_Events."`, `" _events "`, etc.
- **Alternatives**: `Events` (likely real course name, more refusals); a dot-folder (`.events`,
  hidden on macOS/Linux — fails "browse outside the app"); per-event folders directly under the
  semester (collide with courses).

## R2. Events reuse the series/occurrence model in their own table

- **Decision**: new `event_series` (+ `event_links`) table with the same rule columns as
  `class_series` (`lineage_id`, `split_from_id`, `start_date`, times, `freq`, `interval_weeks`,
  `by_weekday`, `end_kind`, `until_date`, `count`) plus `semester_id` (FK CASCADE), `title`
  (1–120), `location`, `color` (default `blue`). Occurrence keys use the same
  `{lineage_id}:{date}` format; uuid7 lineages never clash with class lineages, so one keyspace
  serves both and every `sessionKey` API works for events unchanged.
- `domain/recurrence.py` and `domain/scopes.py` are already pure over `Rule` + segment records; the
  segment record becomes a small protocol both tables satisfy. `class_service._apply` is split into
  a generic `series_apply(changeset, repo)` used by `class_service` and a new `event_service`.
- **Rationale**: FR-005/FR-019 demand identical repetition and scope behaviour; sharing the pure
  planners gives that for free while keeping class rows untouched (FR-015).
- **Alternatives**: one table with nullable `course_id`/`semester_id` (table rebuild of the busiest
  table, every class query gains a filter, higher regression risk); events as a special course
  (would show on course lists, counts and timelines — violates FR-009 and Principle II's layout).

## R3. Event occurrence overrides ("This event" edits every field)

- **Decision**: `session_exceptions` gains nullable `title`, `color`, `links_json`, `moved_date`
  (ADD COLUMN only). For events, a "This event" edit may change any field incl. date (`moved_date`);
  class exceptions keep today's limits (time/location) — validated per kind in the service.
  Expansion places a moved occurrence on `moved_date` but its key keeps `original_date`, so its
  folder and content stay attached.
- **Rationale**: spec FR-016 ("every field") while keeping the key and folder stable, exactly like
  sessions keep `original_date` today.

## R4. Series-wide edits protect events with content

- **Decision**: before applying a "following"/"all" event change, the service freezes every
  affected occurrence that has content (a `session_folders` row with ≥1 note, recording or
  document) or a `modified` exception: it writes (or completes) a `modified` exception holding the
  occurrence's current values, so the new rule does not change it and it stays scheduled even if
  the new rule no longer generates that date (exception kind `modified` + `detached = 1`, new
  nullable column). The response's new `unchangedCount` = frozen + already-modified occurrences;
  the dialog shows it (FR-020).
- Classes keep today's behaviour (only `modified` overrides are preserved) — FR-015.
- **Alternatives**: refusing the edit when content exists (blocks common edits); splitting frozen
  occurrences into their own series (changes their keys and folders).

## R5. Event folders, semester change, documents scope

- **Decision**: `session_folders` is rebuilt in migration 0010: `course_id` nullable, new nullable
  `semester_id` (FK), new nullable `trash_entry_id` (FK SET NULL), new nullable `origin_path`
  (relative path snapshot, used while trashed), CHECK exactly one of `course_id`/`semester_id` unless
  trashed-and-orphaned. Uniques: (course_id, folder_key) and (semester_id, folder_key).
- Event folder name: `safe_name("YYYY-MM-DD <title>")`, made unique among the semester's event
  folders **and** existing directories on disk (`unique_sibling` + `storage.exists`). Like session
  folders it is fixed at creation; later title/date edits do not rename it (spec edge case).
- Path: `semester_parts + ["_Events", folder_name]`.
- Semester change (FR-017/018): allowed only when no folder of the lineage holds content; empty
  folder rows are moved with the series (`storage.rename_dir` with rollback hook) or dropped if their
  directory is empty. The server enforces the lock (409 `semester_locked`); the form shows the reason
  from `EventDetail.semesterLocked`.
- Documents: today course-wide. For events they are shared across the occurrences of one event
  series (scope = event lineage). `document_service` gets a scope abstraction
  (`course_id` | `event_lineage_id`).
- **Recording rule**: Feature 002's clarification made recording allowed for every session,
  upcoming or past, and there is no recording gate in the code. Spec FR-012 says events follow "the
  same rules" as sessions but also restates the old "no recording when upcoming" rule. The plan
  follows the current session rule (recording allowed) and the spec was corrected accordingly;
  see plan "Spec corrections".

## R6. Trash: deletions become trash entries; content rows are detached, never deleted

- **Decision**: new `trash_entries` table (one row per confirmed deletion, per class/event lineage
  for hierarchy deletions). It stores:
  - `kind` (class|event), `label`, `year_name`, `semester_name`, `course_name` (class only),
    `covered` (first/last date + occurrence count), `deleted_at`, content counts;
  - `payload_json`: the exact before-images of the series segments, links and exceptions that the
    deletion removed or changed, plus the cancel exceptions it created (restore removes those);
  - links to the detached content: `session_folders.trash_entry_id`.
- Deleting (any scope) runs the existing scope planner, records the before-images, applies the
  change, and sets `trash_entry_id` + `origin_path` on every folder whose occurrence was removed.
  Trashed folders are hidden from timelines, the Events page, `GET /sessions/{key}` and counts.
  **No file is touched.**
- Hierarchy deletes (course/semester/year): for each class and event lineage inside, create a
  trash entry ("all" scope), detach its folders (`course_id`/`semester_id` → NULL, `origin_path`
  kept), then delete the hierarchy rows. Content rows survive because the folders no longer hang
  off the deleted rows. Unscheduled folders with content (old "No longer scheduled") go with their
  lineage's entry.
- **Restore** (FR-021c, FR-022b): in one transaction — `get_or_create` year → semester → course by
  name (recreating rows and folders; if one with that name exists, use it); re-insert the series
  segments/links/exceptions from `payload_json` (same lineage → same keys), dropping the cancel
  exceptions the deletion created; re-attach folders. If the current folder path differs from
  `origin_path` (different parent folder name, or a name now taken) the directory is moved with
  `storage.rename_dir` under a unique readable name; never overwritten. If segments of the lineage
  were edited since, restored dates are inserted as their own segment(s) of the same lineage.
- **Permanent delete** (FR-021d): deletes the entry, its folder rows (cascade notes, recordings,
  documents, annotation ops, transcription jobs) and, after commit, removes each folder directory
  with a new `StorageService.delete_tree(parts)` that only accepts a path inside the user's root
  and only directories recorded as session/event folders. Partial failure: the entry is kept with
  `purge_error`, the files that could not be removed are listed, retry allowed.
- **Rationale**: Principle I (nothing lost until "Yes"), Principle II (files stay where the user can
  browse them; nothing moves to a hidden trash folder), keys stay stable so restore is exact.
- **Alternatives**: soft-delete columns on every table (every query in 001–008 would need filters);
  moving files into a `.trash` folder (hides user files, cross-device moves, breaks Principle II).

## R7. Deletion confirmations with content counts

- **Decision**: `GET /sessions/{key}/deletion-impact?scope=` (classes and events) returns
  occurrence count and note/recording/document counts for the scope; hierarchy `deletion-impact`
  gains `events`, `notes`, `recordings`, `documents`. Dialog text: "…will move to Trash. You can
  restore it from Settings → Trash."

## R8. Calendar listing and the Events page

- **Decision**: `GET /sessions?from&to` returns classes and events together with
  `kind: "class" | "event"`; `courseId`/`courseName`/`seriesId` become nullable, `semesterId` and
  `title` added (additive; old clients read classes as before). `?courseId=` excludes events.
  New `GET /semesters/{id}/events/timeline` mirrors the course timeline (past/upcoming, counts incl.
  documents). Session counts (`deletion-impact`, timelines, course panel) never include events.

## R9. Last-used semester and quick-form type

- **Decision**: preferences gain `lastSemesterId` (string|null) and `quickCreateType`
  ("class"|"event", default "class"); written by the client after a successful create (any form).
  Preselection order: semester of the open course → `lastSemesterId` if it still exists → none.

## R10. Undo of a quick creation

- **Decision**: `POST /classes` and `POST /events` return `created: {yearId?, semesterId?,
  courseId?, lineageId}` listing rows this request created. `POST /creations/undo` with that object
  and the lineage's version deletes them — no trash entry — if no occurrence has content and no
  other class/event uses the created hierarchy rows; it removes the directories it created only if
  they are empty. Otherwise 409 `undo_unavailable`. The toast stays ≥10 s (Sonner `duration:
  10000`, action button) and is removed when the user opens the new entry's workspace.

## R11. Press-and-drag drafts in the time grid

- **Decision**: pointer events on the day column background (`pointerdown` with
  `setPointerCapture`), ignoring presses whose target is inside an `EventBlock`. Pure helpers in
  `features/calendar/draft.ts`: `yToMinutes`, `snap15`, `draftRange(pressMin, pointerMin)` (min 15,
  clamped 00:00–24:00), `isClick(dx,dy) = hypot < 4`. Auto-scroll: when the pointer is within 32 px
  of the scroller's edge, a `requestAnimationFrame` loop scrolls 4–16 px/frame proportional to the
  distance. Escape during the drag releases capture and clears. Grid granularity changes from 30 to
  15 minutes (`SLOT_MIN = 15`) for slot buttons and keyboard movement.
- The draft is a layout item with `kind: "draft"` passed through `layoutOverlaps`, so it gets a
  column beside overlapping entries without moving the others beyond that (FR-028).
- Month view: clicking empty day space (not the day number, not a chip, not "+N more") opens the
  quick form anchored to that cell with 09:00–10:00.
- Touch: `pointerType === "touch"` → no drag; `click` creates the 1-hour draft (FR-044).
- **Alternatives**: a calendar library (FullCalendar etc.) — would replace 001's grid, theming and
  keyboard model; not justified for one gesture (Principle VII).

## R12. Quick form

- **Decision**: Radix `Popover` anchored with `PopoverAnchor virtualRef` to the draft element (the
  same technique as `SessionDetails`), `modal={false}`, `onInteractOutside` prevented when the form
  is dirty (FR-039), `onEscapeKeyDown` → discard. Below desktop width it is a bottom `Sheet`.
  Fields reuse `HierarchyPicker`, `ColorPicker`-less compact rows, `LinksEditor`, time inputs.
  "More options" and "Custom" repeat navigate to `/classes/new` or `/events/new` with all values in
  router state (not query string, to carry links). Draft lives in a small reducer
  (`useDraft`) owned by `CalendarPage`; a `beforeunload`-free discard on route change (no data
  stored = nothing to warn about).
- Focus: form takes focus on open (first empty required field); on close, focus returns to the grid
  slot of the draft's start (or the new entry after save).
- Announcement: a polite live region in `CalendarPage` announces "New entry, from 10:00 to 11:15"
  on create and after each change (debounced 300 ms while dragging; final value on release).

## R13. Keyboard slot selection

- **Decision**: extend the existing roving-tabindex slot model: ↑/↓ 15 min, ←/→ one day (week view),
  Shift+↑/↓ shortens/extends the highlighted range (min 15 min), Enter/Space opens the quick form for
  the range, Escape clears the range. The highlighted range renders as the same draft block
  (`aria-hidden`), announced through the live region.

## R14. Event marker and full title

- **Decision**: `EventBlock` gets `kind`; events show a small "calendar-star" Phosphor icon plus
  visually hidden "Event:" in the accessible name, and a dashed left border token
  (`--event-marker`) — never colour alone. Full title via `title`-free `Tooltip` on hover and focus
  (keyboard reachable), because native `title` is not shown on focus.

## R15. Tests

- **Backend**: unit (`event folder naming`, reserved name, scopes with frozen occurrences, trash
  payload round-trip); contract for every new operation (coverage guard requires
  `contracts/openapi.yaml`); integration: event create → content → files under `_Events`
  (Principle II), series edit with content left unchanged, delete → trash → restore (byte-identical
  files, same keys), hierarchy delete → per-lineage entries → restore recreates names, permanent
  delete removes only that folder, quick-create undo, migration 0010 (data preserved, conflict
  flag). Existing critical flows (record, transcribe, recurring class creation) must stay green;
  `test_edit_scopes_flow` gains the trash expectations for class deletes.
- **Frontend**: Vitest for `draft.ts`, `layoutOverlaps` with drafts, quick-form validation reducer,
  keyboard range reducer; Playwright: drag-create class/event, click-create, month click, Escape
  paths, dirty click-outside, failed save + retry, undo, keyboard-only creation, Events page, Trash
  restore/delete, axe in light/dark/custom themes.

## Implementation notes

- **Phase 2, migration 0010**: `session_exceptions` is rebuilt (`batch_alter_table`, no child
  tables) instead of only `ADD COLUMN`, so its location CHECK can follow the event limit (≤ 200)
  and the new `title`/`color` columns get CHECKs; `session_folders.title`/`location` widen to
  120/200 in the same rebuild (folder snapshots of events).
- **Phase 2, hierarchy deletes until US4**: with `session_folders.course_id` SET NULL plus the
  owner CHECK, deleting a course/semester/year that has session folders would fail the CHECK.
  Until US4 moves lineages to the Trash, `hierarchy_service._drop_class_folders` deletes those
  folder rows explicitly (exactly what the old CASCADE did; files stay). US4 replaces it.
- **Phase 2, interim event guards**: `document_service` / `workspace_service` still scope
  documents by course; for event keys they return no documents (or refuse an import) until T028
  adds the event-lineage scope (`TODO(009 T028)` markers). `GET /sessions/{key}` for an event
  key needs the `Session` schema changes of T016.
- **Phase 2, resolver**: event occurrences are looked up by `session_query.find_event_session`
  (by original-date key, so moved and detached occurrences resolve); T018 builds on it.
  `recurrence.expand` now returns occurrences sorted by start, since a moved one may change places.
- **Phase 2, small contract-adjacent choices**: `reservedNameConflict` is on every `Course`
  response (a model property), not only in the course tree; the 002 `Preferences` schema
  (`additionalProperties: false`) lists `lastSemesterId`/`quickCreateType` like 003/005/007 did;
  `PATCH /preferences` now applies only the fields sent, so an explicit `null` clears
  `lastSemesterId`. Event links reuse the class `Link` limits (label ≤ 60, url ≤ 2048).
- **Phase 2, theme tokens**: custom and preset themes get `--draft-*` / `--event-marker` from
  `derivedCalendarVars` in `app/theme.tsx` (applied with the theme's variables) rather than as
  editable tokens, because saved themes carry a fixed token list (backend `schemas/themes.py`).
- **Phase 2, test locations**: reserved-name contract tests are in `tests/contract/test_hierarchy.py`
  (new), the preferences test in `tests/contract/test_preferences.py`, and a resolver test for
  event folders in `tests/integration/test_event_folder_resolver.py`.
- **US1, `Session.title`**: for classes `title` keeps 001's meaning (the class's own title, may be
  null) instead of the course name the 009 `SessionAddition` describes; changing it would alter
  every class block and label (FR-015). Events always carry their title. `seriesId` is null for
  events as documented; `seriesVersion` is the event segment's version (the `If-Match` for US3).
- **US1, `POST /classes`**: the 201 body is `ClassSeries` + `created` (`ClassCreated`); hierarchy
  rows found by name (not created) are omitted from `created`, so a reference-only create returns
  `{lineageId}`.
- **US1, preselection**: the forms are overlays of the calendar, so "the open course" is passed as
  router state (`from: {courseId | semesterId}`) by "New class"/"New event". Besides the toolbar
  button, a small "New event" icon sits next to "New class" beside the Courses heading, the only
  way to start an event while a course (or a semester's Events page) is open. Until US3, the
  session popover hides Edit/Delete for events (the class flows can't edit them yet).
- **US2, Events timeline**: `EventTimelineEntry` also carries `lineageId` and ISO `start`/`end`
  (additive) so the course timeline component renders it unchanged.
- **US2, workspace links without a semester**: recordings and transcription jobs of events know
  only the session key (`courseId` null), so `/workspace/:sessionKey` resolves the session and
  redirects to `/courses/…/sessions/…` or `/semesters/…/events/…` (keeping `?note=`).
- **US2, documents**: `document_service.DocumentScope` (course or event lineage) replaces the
  course-only helpers; folders in the Trash are outside every scope, as on the course timeline.
  The duplicate-name message says "in this event" for events.
- **US2, interim hierarchy deletes**: `hierarchy_service` now also drops the event folder rows of a
  deleted semester/year (files stay), like `_drop_class_folders`, until US4 moves them to the
  Trash; removing a semester's end date is refused while events repeat until it, as for classes.
- **US2, T033**: the existing error mapping already shows the server's `reserved_name` message on
  the name field (rename dialog: `conflictMessage`; class form: `/name` → course field); covered by
  `events.spec.ts`, no code change needed.
- **US3, event series edits (R4)**: the occurrence being edited is never frozen (it is the one
  the user changes; a one-off event is edited with scope `all`), and if it already has a
  modified exception the changed fields are written into it too. Every other occurrence in the
  scope with content or a `modified` exception is frozen with all its current values and
  `detached = 1` even when the new rule still generates its date (expansion is the same either
  way; it keeps the planners' reconciliation simple). `unchangedCount` counts those.
- **US3, `EventEdit.date` with `following`/`all`**: moves only the edited occurrence (exception
  `moved_date`, key unchanged) — it is how a one-off event changes its date; the series form of a
  repeating event does not show the date field.
- **US3, frozen occurrences no segment generates**: edits and deletes from such an occurrence
  plan from the lineage's next generated date (`lineage.planner_day`); "This event" delete drops
  its exception; If-Match is its exception version ("this") or the last segment's version.
- **US3, `PATCH /sessions/{key}` body**: documented as `SessionEdit | EventEdit`; both models now
  refuse unknown fields so the union never drops a field, and the body is validated again
  against the key's kind (class or event).
- **US3, class deletes**: `class_service.apply_scope_delete` is replaced by
  `trash_service.move_to_trash` for both kinds; a delete creates one entry even when no
  content exists. Classes report `unchangedCount = preservedOverrides`.
- **US4, payload**: cancel exceptions created by a delete are stored by date (unique per
  lineage) rather than by id. `after_versions` (segment id → version right after the delete)
  decides the restore path: unchanged since → exact revert of the before-images (same segment
  ids); otherwise each removed date that no segment generates comes back as its own one-date
  segment (`freq = none`) of the same lineage, with its exception before-image.
- **US4, restore parents**: the lineage's live course/semester when it still has segments; else
  the original rows by id when they still exist (e.g. renamed since); else found or recreated
  by name (semester with its stored dates, course with its colour). A recreated course name that
  is now reserved → 409 `reserved_name`.
- **US4, folder paths of trashed folders**: a folder keeps its owner for ordinary deletes (its
  path follows renames); hierarchy deletes detach it with `origin_path`, and renaming a
  year/semester/course now rewrites the `origin_path` prefix of detached folders under it.
  Restore moves a directory only when the path changed or the name is taken; when another live
  folder of the target course shares the very directory (a pre-009 name clash), only this
  folder's own files (notes, audios, documents with sidecars) move to the new unique folder.
- **US4, class folder names**: new class session folders also skip names of directories already
  on disk (as event folders do, R5), so a course in the Trash never shares its folders with a
  recreated course of the same name.
- **US4, permanent delete order**: files first (`delete_tree`), then rows. On any failure the
  entry and its rows stay, `purge_error` is committed and the request fails with 500
  `purge_failed` + `failedPaths`; a retry removes what is left (missing folders are fine). This
  replaces "rows, then files after commit", which could not keep the entry on failure.
- **US4, hierarchy deletes**: lineages that only have unscheduled folders get an entry only when a
  folder holds content; their empty folder rows (no files touched) and orphan exceptions are
  dropped. Hierarchy `deletion-impact` counts notes/recordings/documents in folders not already
  in the Trash.
- **US4, UI**: the hierarchy delete dialog's wording changes to name events, content counts and
  the Trash; the session delete dialog's buttons are "Cancel" · "Move to Trash" (e2e
  `edit-scopes` updated). `impactSentence` no longer writes "classs".
- **US5, slot model**: the `QUICK_CREATE` flag of T060 was not needed — US5–US7 landed together,
  so the old slot click that navigated to `/classes/new` is replaced outright. Slot buttons are
  15 minutes and named "New entry on <day> at HH:MM"; pointer presses are handled by the day
  column (`useGridDrag`), so a slot's own `onClick` only acts on clicks without a pointer
  (assistive technology). A drag covers every slot from the pressed one to the pointer's
  (`draftRange`), so a press at 13:00 dragged into the 14:30 slot gives 13:00 – 14:45. Drafts
  carry an increasing `id`, and every update/discard names it, so a late "discard" (e.g. Radix's
  outside-press of the old form) never removes the draft that replaced it.
- **US5, month view**: the draft chip reads "09:00 – 10:00 New entry"; the day cell's click is a
  pointer shortcut (keyboard users create entries in the time grid, which the day number opens).
- **US6, quick form**: values are converted to the full forms' own value types (`toClassForm`,
  `toEventForm`) and sent with `classPayload` / `eventPayload`, so quick entries equal full-form
  ones (FR-041): a class gets no title and its existing course's colour (new course: Blue).
  "Weekly on <weekday>" uses the full form's default end ("when the semester ends"); in a
  semester without an end date Save stays disabled and the message points to "Custom…".
  Required-field messages appear once the field was touched (Save is disabled meanwhile);
  "End must be after start" shows at once. The course picker lists every course labelled
  "<course> · <semester> <year>", the preselected semester's first. Times are entered with the
  same 5-minute inputs as the full forms, so form edits may leave the 15-minute grid. A draft
  ending at midnight is shown as 24:00 but entered as 23:59 (inputs and the API have no 24:00).
- **US6, Undo**: `POST /creations/undo` (in `api/v1/events.py`, service `creation_undo.py`)
  refuses with 409 `undo_unavailable` when content exists, part of the lineage is in the Trash,
  a created hierarchy row is used by anything else (other classes, courses, events or folders),
  or the refs do not match the entry's parents; 412 when the series was edited (version, or split
  into more segments). Directories are removed after the commit and only when no file is inside
  (`StorageService.remove_empty_dir`, which never deletes a file). The toast is not dismissed when
  the entry's workspace is opened (R10); the server refuses the Undo once content exists anyway.
- **US6, discard on navigation**: a path change discards the draft unless something was entered
  and the new calendar period still shows its day (edge case "view change"). While a filled form
  is open, clicks on an entry or a day heading in the grid or month view are ignored and focus
  returns to the form (`entryGuard.tsx`, FR-039); toolbar navigation stays a view change.
- **US7, keyboard**: a Shift+↑/↓ range is a draft in a `select` phase (rendered and announced
  like any draft); plain arrows then move the whole range. Enter/Space on a slot without a range
  opens a one-hour draft (as a click does, and as the 001 Enter shortcut did); with a range it
  opens exactly that range. The range is cleared when focus leaves the grid.
- **US7, e2e**: `calendar-navigation.spec.ts` now expects the quick form on Enter; its axe
  helper, and the one in `a11y-themes.spec.ts`, wait for running animations (view fade-in,
  tooltip zoom-in) to finish, since half-transparent text failed colour contrast intermittently.
  `layout.spec.ts` clicked an empty grid point to leave a dialog before pressing `n`; a grid click
  now starts a draft, so it clicks the period heading instead. The quick form keeps the values it
  opened with as its "nothing entered" baseline, so a later refetch never makes it dirty.
- **Polish, SC-003**: `quick-create-performance.spec.ts` drags a draft through a week with 50
  entries. The browser's long-task API reports tasks of 50 ms or more (not 16 ms), so the test
  asserts no long task and no gap over 100 ms between frames during the drag. The first run found
  5–7 long tasks (57–87 ms, dev build): each draft move re-rendered all 672 slot buttons and every
  entry. `TimeGrid` now renders slots (`ColumnSlots`) and entries (`ColumnEntries`) as memoized
  per-day components and lays out only the draft's day again while it moves; the same drag then has
  no long tasks.
