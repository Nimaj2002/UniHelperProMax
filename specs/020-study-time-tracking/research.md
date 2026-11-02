# Research: Study Time Tracking

## R1. One running timer per user

- **Decision**: Table `time_timers` with `user_id` as primary key (at most one row = at most one
  timer). Start replaces the row in one transaction, after saving the old one as an entry.
  Writes carry the row's `version` (existing `VersionMixin`); a stale version gets 409.
- **Rationale**: The database enforces FR-006 itself; two windows starting at once become a
  version conflict, not two timers.
- **Alternatives**: A `running` flag on `time_entries` (needs a partial unique index and makes
  entries mutable while running); client-only state (breaks across windows).

## R2. Time is computed, never ticked

- **Decision**: The timer row stores `started_at` (UTC, ms precision), `paused_at`,
  `paused_ms` (total paused time so far) and, for Pomodoro/Focus, `planned_end_at`. Every timer
  response includes `server_now`; the client keeps `offset = server_now − local receive time`
  and computes `elapsed = (now + offset) − started_at − paused_ms` (or remaining =
  planned_end − now). `clock.ts` is pure and unit-tested. The display re-renders every second
  but nothing is accumulated.
- **Rationale**: FR-007, SC-002 and the wrong-clock edge case. The existing `useElapsed` already
  computes from a start; it is extended with the offset rather than duplicated.

## R3. Phases that end while nobody is watching (lazy settlement)

- **Decision**: No background job. Every timer read or write first "settles": if
  `planned_end_at ≤ now` and the timer is running, the server saves the work entry ending at
  `planned_end_at` (breaks are not saved), and moves the timer to `waiting` with
  `finished_at = planned_end_at` and the next phase prepared. Automatic start only applies when
  a window is open at the moment of the end (the window calls `/advance`); a settled-on-read
  timer always waits (FR-025, edge case). Settlement is idempotent (guarded by state + version).
- **Rationale**: Principle VII forbids extra infrastructure; reads happen as soon as any window
  opens, which is exactly when the user needs the answer.

## R4. Alerts on time in hidden windows

- **Decision**: A dedicated Web Worker (`alerts.worker.ts`) receives `planned_end_at` (already
  converted to local time with the offset) and sets one `setTimeout`; on fire it posts to the
  page, which plays a short sound through an `AudioContext` unlocked by the Start click, shows a
  sonner toast, and, when `document.visibilityState !== "visible"` or the window lacks focus and
  the setting is on, shows a `Notification`. The page then calls `/advance` (or `/finish` for
  Focus). On the desktop, `permissions.ts` allows the `notifications` permission for the app's
  own origin (today only `media` is allowed).
- **Rationale**: Worker timers are not subject to the page's intensive background throttling;
  a single timeout is not a chained timer. The Notification API works in Electron renderers, so
  no IPC is needed.
- **Alternatives**: Electron main-process timer via IPC (desktop only, more code); Service
  Worker push (needs a push service, out of scope).

## R5. No time lost on failure

- **Decision**: Start, stop and entry writes go through a small outbox in `features/time/api.ts`:
  the mutation records the user's moment (`client_at`, corrected by the offset) and is stored in
  localStorage until the server confirms; it retries with backoff (2 s, 5 s, 15 s, then every
  30 s and on reconnect/focus) and shows "Not saved yet — retrying" in the timer card and the
  pill. The server accepts `at` on start and stop, clamped to `[started_at, server_now]` for stop
  and to `[server_now − 24 h, server_now]` for start. Each outbox item carries the timer
  `version` it expects, so a retry never stops a newer timer or saves twice.
- **Rationale**: FR-012/FR-062; the moment the user pressed Stop is what matters, not when the
  request arrived.

## R6. Undo for replace and for too-short runs

- **Decision**: `start` returns `undo: {entry_id, previous}` when it replaced a timer; `stop`
  returns `undo: {previous}` when the run was under 5 s and was discarded. `POST
  /time/timer/undo` takes that object plus the current timer `version`; the server deletes the
  auto-saved entry (if still unchanged), restores the previous timer row, and refuses with
  409 `undo_unavailable` if the current timer or the entry changed since (edge case). Same
  shape as the existing creation/import undo endpoints.

## R7. Pause

- **Decision**: As assumed in the spec (FR-014). Track: Pause = stop and save, the pill then
  shows "Paused" with Resume (= start again with same fields) for 10 minutes; the timer row is
  deleted. Pomodoro/Focus: `paused_at` is set; resume adds the pause to `paused_ms` and moves
  `planned_end_at` by the same amount. The saved entry keeps `paused_seconds`, and its counted
  duration is `end − start − paused_seconds`.

## R8. Linking (P2)

- **Decision**: Entries and the timer carry `task_id` (FK, SET NULL), `session_key` (the existing
  session/event occurrence key string used by the workspace routes) and `course_id` (FK, SET
  NULL). When linked to a task or session, the server fills `course_id` from it and caches
  `link_title` (as tasks cache event titles). A session's total = sum of entries with that
  `session_key`.
- **Rationale**: Reports group by course with one column; deleting a linked item leaves the
  entry (FR-058).

## R9. Backups

- **Decision**: Add `time_tags`, `time_timers`, `time_entries` to `_INCLUDED` in
  `backup/tables.py` (after `tasks`, tags before entries). The existing unit test that fails on
  unclassified tables guards this.

## R10. Calendar lane

- **Decision**: When "Show time" is on, `TimeGrid` reserves a fixed lane (10 px, or 14 px on
  pointer-coarse screens) at the right of each day column and lays out classes, events and
  tasks in the remaining width, so nothing is covered. Entries in the lane are split by local
  day (crossing midnight), laid out with the existing `layoutOverlaps.ts` into sub-lanes, and
  drawn with a 4 px minimum height. Pointer down in the lane stops propagation to
  `useGridDrag`. `showTime.ts` copies `showTasks.ts` (key `uh.calendar.showTime`, default on).

## R11. Reports and donut

- **Decision**: `GET /time/entries?from&to` returns entries overlapping the range; `report.ts`
  (pure, unit-tested) clips each entry to the range, splits by local day for "by day", groups,
  computes shares, and merges slices < 3 % into "Other" only for the chart. The donut is a
  hand-written SVG (arcs via `path`), each slice with tag color, a pattern fill from a fixed set
  of 6 SVG patterns, a label or leader-line label, `role="img"` with an `aria-label` summary,
  and the table as its text alternative. No chart library.
- **Alternatives**: recharts/visx (new dependency for one chart; rejected by Principle VII).

## R12. Cross-window sync

- **Decision**: After each timer change, the window posts `{type:"timer-changed"}` on a
  `BroadcastChannel("uh-time")`; other windows of the same origin refetch at once. Windows also
  refetch on `focus`/`visibilitychange` and every 30 s while visible, so other devices or a
  missed broadcast agree within 30 s. The calendar's running block and the pill use the same
  query.
