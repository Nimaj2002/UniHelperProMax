# Contract: Time API (`/api/v1/time`)

Authentication, RFC 9457 problems, CSRF and optimistic concurrency follow the existing API:
writes to the running timer, an entry or a tag send `If-Match: "<version>"` (412
`version_conflict` when stale; 409 `no_timer` when none runs). Times are UTC ISO strings with
milliseconds. JSON keys are camelCase on the wire (`startedAt`), whatever the spelling below.
The machine-readable contract is [openapi.yaml](./openapi.yaml).

## Timer

`Timer` object:

```json
{
  "style": "pomodoro", "state": "running",
  "started_at": "…", "paused_at": null, "paused_ms": 0,
  "planned_end_at": "…", "finished_at": null,
  "description": "Linear algebra", "tagId": "…",
  "course_id": null, "task_id": null, "session_key": null, "link_title": null,
  "phase": "work", "period": 2, "focus_minutes": null, "goal": null, "hide_panels": false,
  "reminder_ack": 0, "version": 7
}
```

Every timer response: `{"timer": Timer | null, "server_now": "…", "settled": [Settled], "undo": Undo | null, "saved": Entry | null}`.
`settled` lists phases finished while no window was open (`{"phase", "finished_at", "entry_id"}`),
so the UI can say "Work 2 finished at 10:25".

| Method & path | Body | Result / errors |
|---|---|---|
| `GET /time/timer` | — | settles, then returns the timer (or null) |
| `POST /time/timer/start` | `{style, description?, tag_id?, course_id?, task_id?, session_key?, focus_minutes?, goal?, hide_panels?, at?}` | 201. Saves and replaces a running timer (`undo` set). 422 invalid ranges; 404 unknown tag/task/session/course |
| `POST /time/timer/stop` | `{at?}` (body optional) | saves the entry (`saved`) or, if < 5 s, discards it (`undo` set, `saved` null). `at` clamped to `[started_at, now]` |
| `POST /time/timer/set-end` | `{endedAt}` | "Stop and set end time"; 422 if before start or in the future |
| `POST /time/timer/pause` | `{at?}` (body optional) | Track: same as stop. Pomodoro/Focus: state paused |
| `POST /time/timer/resume` | — | 409 `not_paused` |
| `POST /time/timer/advance` | — | at or after `planned_end_at`: Pomodoro moves to next phase (auto-start from preferences); Focus finishes. 409 `not_due` if early |
| `POST /time/timer/skip` | — | Pomodoro: next phase now |
| `POST /time/timer/reset` | — | Pomodoro: saves work so far, timer removed |
| `POST /time/timer/extend` | — | Focus: +5 min, 422 above 480 total |
| `PATCH /time/timer` | `{description?, tagId?, links…, reminderAck?}` | edit fields of the running timer |
| `POST /time/timer/undo` | `{undo, timerVersion}` (null when no timer runs) | restores previous timer, deletes the auto-saved entry; 409 `undo_unavailable` |

## Entries

`Entry`: `{id, startedAt, endedAt, pausedSeconds, durationSeconds, description, tagId, source, courseId, taskId, sessionKey, linkTitle, version}`.

| Method & path | Body / query | Result / errors |
|---|---|---|
| `GET /time/entries` | `from`, `to` (UTC, required, ≤ 400 days apart), `session_key?` | entries overlapping `[from, to)`, by `started_at`; not deleted |
| `POST /time/entries` | `{started_at, ended_at? \| duration_seconds?, description?, tag_id?, links…}` | 201 `{entry, overlaps}`; 422 `end_not_after_start` |
| `PATCH /time/entries/{id}` | `{…fields}` + If-Match | `{entry, overlaps}`; 412 on a stale version |
| `DELETE /time/entries/{id}` | — | 204, soft delete |
| `POST /time/entries/{id}/restore` | — | 200 entry; 404 after purge |
| `GET /time/entries/export.csv` (P3) | `from`, `to`, `tz` (IANA) | `text/csv`: date, start, end, duration, description, tag, link |

## Tags

`Tag`: `{id, name, color, entry_count, version}`.

| Method & path | Body | Result / errors |
|---|---|---|
| `GET /time/tags` | — | all tags, by name |
| `POST /time/tags` | `{name, color}` | 201; 409 `tag_name_taken`; 422 name empty / > 30 / unknown color |
| `PATCH /time/tags/{id}` | `{name?, color?}` + If-Match | as above |
| `DELETE /time/tags/{id}` | — | 204; entries become untagged |

## Preferences

`GET/PATCH /api/v1/preferences` (existing) gains the `time` object from
[data-model.md](../data-model.md#preferences-ui_preferencesdatatime-per-user); out-of-range values → 422.
