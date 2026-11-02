# Data Model: Study Time Tracking

All times are UTC ISO-8601 strings with milliseconds (`2026-11-02T08:15:03.120Z`), the same
string style as `now_iso` in `models/base.py`. All tables are per user (`user_id` FK users,
CASCADE) and are included in backups (research R9).

## time_tags

| Field | Type | Rules |
|-------|------|-------|
| id | str (IdMixin) | |
| user_id | str | |
| name | str(30) | required, trimmed, 1–30 chars; unique per user ignoring case (`UNIQUE(user_id, name_key)`) |
| name_key | str(30) | `casefold(name)`, maintained by the service |
| color | str | one of the palette keys (`tag-1` … `tag-12`), mapped to theme tokens in the UI |
| created_at, updated_at, version | | TimestampMixin, VersionMixin |

Delete: hard delete after confirmation; `time_entries.tag_id` and `time_timers.tag_id` are
`ON DELETE SET NULL`. The confirm dialog uses `entry_count` from `GET /time/tags`.

## time_entries

| Field | Type | Rules |
|-------|------|-------|
| id | str | |
| user_id | str | |
| started_at | str | required |
| ended_at | str | required, `> started_at` |
| paused_seconds | int | default 0, `0 ≤ paused_seconds < (ended_at − started_at)`; counted duration = span − paused |
| description | str(500) | optional, trimmed |
| tag_id | str? | FK time_tags SET NULL |
| source | enum | `track` · `pomodoro` · `focus` · `manual` |
| course_id | str? | FK courses SET NULL (P2) |
| task_id | str? | FK tasks SET NULL (P2) |
| session_key | str? | session or event occurrence key (P2) |
| link_title | str(200)? | cached name of the linked task/session/event (P2) |
| deleted_at | str? | soft delete for Undo; rows deleted > 24 h ago are purged on the next list |
| created_at, updated_at, version | | |

Indexes: `(user_id, started_at)`, `(user_id, ended_at)` for range queries;
`(user_id, session_key)` for session totals.

Rules:
- Overlap is allowed; `POST`/`PATCH` responses include `overlaps: [{id, description, started_at, ended_at}]`.
- Editing start/end so that `paused_seconds ≥ span` sets `paused_seconds = 0`.
- Linking to a task or session sets `course_id` from it (overrides a manual course).

## time_timers (at most one row per user)

| Field | Type | Rules |
|-------|------|-------|
| user_id | str | primary key |
| style | enum | `track` · `pomodoro` · `focus` |
| state | enum | `running` · `paused` · `waiting` (Pomodoro phase done, waiting for user) |
| started_at | str | start of the current stretch / phase |
| paused_at | str? | set while `paused` |
| paused_ms | int | paused time within the current phase |
| planned_end_at | str? | Pomodoro/Focus only; moves forward by each pause and by +5 min |
| finished_at | str? | when `waiting`: the planned end of the phase that finished |
| description, tag_id, course_id, task_id, session_key, link_title | | as on entries |
| phase | enum? | `work` · `short_break` · `long_break` (Pomodoro) |
| period | int? | 1 … periods_before_long_break (Pomodoro) |
| completed_today | int | work periods saved today (P3 count) — recomputed from entries, not stored; listed here only as an API field |
| focus_minutes | int? | 1 … 480 total including extensions (Focus) |
| goal | str(200)? | Focus |
| hide_panels | bool | Focus "Hide panels while focusing" |
| reminder_ack | int | number of long-running thresholds already answered |
| version | int | VersionMixin |

### State transitions

```text
(none) --start--> running
running --pause--> paused --resume--> running          (Pomodoro, Focus; Track pause = stop)
running --stop/finish--> (none)        saves entry if ≥ 5 s (work phases / focus / track)
running --planned end (window open)--> alert → advance:
    Pomodoro work end: save entry; next = break; auto-start ? running : waiting
    Pomodoro break end: next = work (period+1, or 1 after long break); auto-start ? running : waiting
    Focus end: save entry → (none)
running --planned end (settled on read)--> waiting (Pomodoro) / (none) after saving (Focus)
waiting --start next--> running
any --skip--> next phase (work time so far saved if ≥ 5 s)
any --reset--> (none) (work time so far saved if ≥ 5 s), period back to 1
running --start other--> previous saved, new running (undo available)
```

## Preferences (`ui_preferences.data.time`, per user)

| Key | Default | Range |
|-----|---------|-------|
| pomodoro_work_min | 25 | 1–120 |
| pomodoro_short_min | 5 | 1–60 |
| pomodoro_long_min | 15 | 1–120 |
| pomodoro_periods | 4 | 2–8 |
| pomodoro_auto_start | false | |
| focus_hide_panels | false | |
| long_running_hours | 3 | 1–12 or null (off) |
| sound | true | |
| system_notifications | false | |
| indicator_combo | `combined` | `combined` · `stacked` · `recording_first` |
| daily_goal_min | null | 1–1440 or null (P3) |

## Per-browser (localStorage)

- `uh.home.tasksSection`: `tasks` · `notes` · `time` (existing key, new value).
- `uh.calendar.showTime`: boolean, default true.
- `uh.time.outbox`: pending timer/entry writes (research R5).
