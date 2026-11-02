"""Time tracking (020): the running timer's state machine, entries and tags.

The timer row is the only source of truth (research R1/R2): clients compute elapsed and remaining
time from its stored times. Pomodoro and Focus phases that ended while no window was open are
settled on the next read or write (research R3), with no background job.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.models import Course, Task, TimeEntry, TimeTag, TimeTimer, User
from unihelper.models.base import name_key
from unihelper.schemas.time_tracking import TimerSnapshot
from unihelper.services import workspace_service

MIN_SAVE_S = 5  # FR-011: shorter runs are not saved
SETTLE_GRACE = timedelta(seconds=60)  # an open window advances on time; reads settle after this
START_BACKDATE = timedelta(hours=24)  # an offline Start may be retried up to a day later
PURGE_AFTER = timedelta(hours=24)  # soft-deleted entries stay restorable this long
MAX_RANGE = timedelta(days=400)
MAX_FOCUS_MIN = 480
EXTEND_MIN = 5


def now() -> datetime:
    """The server clock; tests replace this."""
    return datetime.now(UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="milliseconds")


def parse(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _ms(delta: timedelta) -> int:
    return int(delta.total_seconds() * 1000)


def time_prefs(db: Session, user: User) -> dict[str, Any]:
    return workspace_service.get_preferences(db, user)["time"]  # type: ignore[no-any-return]


# ---- output ----------------------------------------------------------------------------------


def entry_out(e: TimeEntry) -> dict[str, Any]:
    span = int((parse(e.ended_at) - parse(e.started_at)).total_seconds())
    return {
        **{c: getattr(e, c) for c in _ENTRY_FIELDS},
        "duration_seconds": max(0, span - e.paused_seconds),
    }


_ENTRY_FIELDS = (
    "id", "started_at", "ended_at", "paused_seconds", "description", "tag_id", "source",
    "course_id", "task_id", "session_key", "link_title", "version",
)  # fmt: skip
_TIMER_FIELDS = (
    "style", "state", "started_at", "paused_at", "paused_ms", "planned_end_at", "finished_at",
    "description", "tag_id", "course_id", "task_id", "session_key", "link_title", "phase",
    "period", "focus_minutes", "goal", "hide_panels", "reminder_ack", "version",
)  # fmt: skip


def timer_out(t: TimeTimer | None) -> dict[str, Any] | None:
    return None if t is None else {c: getattr(t, c) for c in _TIMER_FIELDS}


def snapshot(t: TimeTimer) -> dict[str, Any]:
    out = timer_out(t)
    assert out is not None
    out.pop("version")
    out.pop("link_title")
    return out


def response(
    t: TimeTimer | None,
    *,
    settled: list[dict[str, Any]] | None = None,
    undo: dict[str, Any] | None = None,
    saved: TimeEntry | None = None,
) -> dict[str, Any]:
    return {
        "timer": timer_out(t),
        "server_now": iso(now()),
        "settled": settled or [],
        "undo": undo,
        "saved": entry_out(saved) if saved else None,
    }


# ---- links and tags --------------------------------------------------------------------------


def _check_tag(db: Session, user: User, tag_id: str | None) -> None:
    if tag_id is not None:
        tag = db.get(TimeTag, tag_id)
        if tag is None or tag.user_id != user.id:
            raise not_found("Tag")


def resolve_links(db: Session, user: User, links: dict[str, Any]) -> dict[str, Any]:
    """course_id / task_id / session_key → validated links plus course_id and link_title (R8)."""
    course_id = links.get("course_id")
    task_id = links.get("task_id")
    key = links.get("session_key")
    title: str | None = None
    if task_id is not None:
        task = db.get(Task, task_id)
        if task is None or task.user_id != user.id or not task.is_live:
            raise not_found("Task")
        course_id, title = task.course_id or course_id, task.title
    if key is not None:
        from unihelper.services import session_folder_service as sfs

        r = sfs.resolve(db, user, key)
        key = r.key
        if r.course is not None:
            course_id = r.course.id
        if title is None:
            title = r.title or (f"{r.course.name} {r.day.isoformat()}" if r.course else None)
    if course_id is not None:
        course = db.get(Course, course_id)
        if course is None or course.user_id != user.id:
            raise not_found("Course")
    return {
        "course_id": course_id,
        "task_id": task_id,
        "session_key": key,
        "link_title": title[:200] if title else None,
    }


# ---- entries ---------------------------------------------------------------------------------


def _save_entry(db: Session, user: User, t: TimeTimer, end: datetime) -> TimeEntry | None:
    """Save the timer's current stretch ending at `end`; None when under 5 s of counted time."""
    start = parse(t.started_at)
    counted = _ms(end - start) - t.paused_ms
    if counted < MIN_SAVE_S * 1000:
        return None
    description = t.description
    if t.style == "focus" and not description:
        description = t.goal or ""
    entry = TimeEntry(
        user_id=user.id,
        started_at=iso(start),
        ended_at=iso(end),
        paused_seconds=t.paused_ms // 1000,
        source=t.style,
        description=description,
        tag_id=t.tag_id,
        course_id=t.course_id,
        task_id=t.task_id,
        session_key=t.session_key,
        link_title=t.link_title,
    )
    db.add(entry)
    db.flush()
    return entry


def _stretch_end(t: TimeTimer, at: datetime) -> datetime:
    """Where a stretch ends when the user stops at `at`: at the pause if paused, never after a
    planned end, never before the start."""
    end = parse(t.paused_at) if t.paused_at is not None else at
    if t.planned_end_at is not None:
        end = min(end, parse(t.planned_end_at))
    return max(end, parse(t.started_at))


# ---- the timer state machine -----------------------------------------------------------------


def get_row(db: Session, user: User) -> TimeTimer | None:
    return db.get(TimeTimer, user.id)


def _phase_minutes(prefs: dict[str, Any], phase: str) -> int:
    key = {"work": "pomodoro_work_min", "short_break": "pomodoro_short_min"}.get(
        phase, "pomodoro_long_min"
    )
    return int(prefs[key])


def _next_phase(prefs: dict[str, Any], phase: str, period: int) -> tuple[str, int]:
    if phase == "work":
        return ("long_break" if period >= prefs["pomodoro_periods"] else "short_break"), period
    return "work", (1 if phase == "long_break" else period + 1)


def _begin_phase(
    t: TimeTimer, prefs: dict[str, Any], phase: str, period: int, at: datetime, run: bool
) -> None:
    t.phase, t.period = phase, period
    t.started_at = iso(at)
    t.paused_at, t.paused_ms = None, 0
    t.planned_end_at = iso(at + timedelta(minutes=_phase_minutes(prefs, phase)))
    t.finished_at = None
    t.state = "running" if run else "waiting"


def _finish_phase(
    db: Session, user: User, t: TimeTimer, end: datetime, auto: bool
) -> tuple[TimeEntry | None, TimeTimer | None]:
    """A Pomodoro phase or Focus session reached its planned end at `end`."""
    saved = _save_entry(db, user, t, end) if t.phase in (None, "work") else None
    if t.style == "focus":
        db.delete(t)
        db.flush()
        return saved, None
    prefs = time_prefs(db, user)
    assert t.phase is not None and t.period is not None
    phase, period = _next_phase(prefs, t.phase, t.period)
    _begin_phase(t, prefs, phase, period, end, run=auto)
    if not auto:
        t.finished_at = iso(end)
    db.flush()
    return saved, t


def settle(db: Session, user: User) -> tuple[TimeTimer | None, list[dict[str, Any]]]:
    """Settle a phase that ended while nobody was watching (research R3); never auto-starts."""
    t = get_row(db, user)
    settled: list[dict[str, Any]] = []
    if t is None or t.state != "running" or t.planned_end_at is None:
        return t, settled
    end = parse(t.planned_end_at)
    if now() < end + SETTLE_GRACE:
        return t, settled
    phase = t.phase
    saved, t = _finish_phase(db, user, t, end, auto=False)
    settled.append(
        {"phase": phase, "finished_at": iso(end), "entry_id": saved.id if saved else None}
    )
    return t, settled


def _require(t: TimeTimer | None, version: int | None) -> TimeTimer:
    if t is None:
        raise ApiError(409, "no_timer", "No timer is running.")
    if version is not None and version != t.version:
        raise ApiError(
            412, "version_conflict", "The timer was changed elsewhere. Reload and try again."
        )
    return t


def _clamp_at(at: datetime | None, low: datetime, high: datetime) -> datetime:
    return high if at is None else min(max(at, low), high)


def start(db: Session, user: User, body: dict[str, Any]) -> dict[str, Any]:
    t, settled = settle(db, user)
    current = now()
    at = _clamp_at(body.get("at"), current - START_BACKDATE, current)
    _check_tag(db, user, body.get("tag_id"))
    links = resolve_links(db, user, body)
    undo: dict[str, Any] | None = None
    if t is not None:  # FR-010: stop and save the running timer, offer Undo
        prev = snapshot(t)
        saved = _save_entry(db, user, t, _stretch_end(t, max(at, parse(t.started_at))))
        undo = {"previous": prev, "entry_id": saved.id if saved else None}
        db.delete(t)
        db.flush()
    style = body["style"]
    t = TimeTimer(
        user_id=user.id,
        style=style,
        state="running",
        started_at=iso(at),
        paused_ms=0,
        description=(body.get("description") or "").strip(),
        tag_id=body.get("tag_id"),
        hide_panels=bool(body.get("hide_panels")),
        reminder_ack=0,
        **links,
    )
    if style == "pomodoro":
        _begin_phase(t, time_prefs(db, user), "work", 1, at, run=True)
    elif style == "focus":
        minutes = body.get("focus_minutes")
        if minutes is None:
            raise validation_error("/focusMinutes", "required", "Choose a length.")
        t.focus_minutes = minutes
        t.goal = (body.get("goal") or "").strip() or None
        t.planned_end_at = iso(at + timedelta(minutes=minutes))
    db.add(t)
    db.flush()
    return response(t, settled=settled, undo=undo)


def stop(db: Session, user: User, version: int, at: datetime | None) -> dict[str, Any]:
    t, settled = settle(db, user)
    if t is None and settled:  # it ended on its own meanwhile: nothing left to stop
        return response(None, settled=settled)
    t = _require(t, version)
    undo: dict[str, Any] | None = None
    saved = None
    if t.state != "waiting":  # a waiting Pomodoro has nothing unsaved
        end = _stretch_end(t, _clamp_at(at, parse(t.started_at), now()))
        if t.phase in (None, "work"):
            saved = _save_entry(db, user, t, end)
            if saved is None:
                undo = {"previous": snapshot(t), "entry_id": None}  # FR-011
    db.delete(t)
    db.flush()
    return response(None, settled=settled, undo=undo, saved=saved)


def set_end(db: Session, user: User, version: int, ended_at: datetime) -> dict[str, Any]:
    t = _require(get_row(db, user), version)
    if ended_at <= parse(t.started_at):
        raise validation_error(
            "/endedAt", "end_not_after_start", "The end must be after the start."
        )
    if ended_at > now():
        raise validation_error("/endedAt", "end_in_future", "The end can't be in the future.")
    saved = _save_entry(db, user, t, ended_at) if t.phase in (None, "work") else None
    db.delete(t)
    db.flush()
    return response(None, saved=saved)


def pause(db: Session, user: User, version: int, at: datetime | None) -> dict[str, Any]:
    t, settled = settle(db, user)
    t = _require(t, version)
    if t.style == "track":  # research R7: a Track pause ends the entry
        return stop(db, user, version, at)
    if t.state != "running":
        raise ApiError(409, "not_running", "The timer isn't running.")
    t.paused_at = iso(_stretch_end(t, _clamp_at(at, parse(t.started_at), now())))
    t.state = "paused"
    db.flush()
    return response(t, settled=settled)


def resume(db: Session, user: User, version: int) -> dict[str, Any]:
    t = _require(get_row(db, user), version)
    if t.state != "paused" or t.paused_at is None:
        raise ApiError(409, "not_paused", "The timer isn't paused.")
    pause_ms = max(0, _ms(now() - parse(t.paused_at)))
    t.paused_ms += pause_ms
    if t.planned_end_at is not None:
        t.planned_end_at = iso(parse(t.planned_end_at) + timedelta(milliseconds=pause_ms))
    t.paused_at, t.state = None, "running"
    db.flush()
    return response(t)


def advance(db: Session, user: User, version: int) -> dict[str, Any]:
    """The phase is due (window open): finish it, or start the waiting phase."""
    t = _require(get_row(db, user), version)
    if t.state == "waiting":
        assert t.phase is not None and t.period is not None
        _begin_phase(t, time_prefs(db, user), t.phase, t.period, now(), run=True)
        db.flush()
        return response(t)
    if t.state != "running" or t.planned_end_at is None or now() < parse(t.planned_end_at):
        raise ApiError(409, "not_due", "This phase hasn't ended yet.")
    auto = bool(time_prefs(db, user)["pomodoro_auto_start"])
    saved, t2 = _finish_phase(db, user, t, parse(t.planned_end_at), auto=auto)
    return response(t2, saved=saved)


def skip(db: Session, user: User, version: int) -> dict[str, Any]:
    t = _require(get_row(db, user), version)
    if t.style != "pomodoro":
        raise ApiError(409, "not_pomodoro", "Only a Pomodoro has phases to skip.")
    current = now()
    saved = None
    if t.phase == "work" and t.state != "waiting":
        saved = _save_entry(db, user, t, _stretch_end(t, current))
    prefs = time_prefs(db, user)
    assert t.phase is not None and t.period is not None
    phase, period = _next_phase(prefs, t.phase, t.period)
    _begin_phase(t, prefs, phase, period, current, run=True)
    db.flush()
    return response(t, saved=saved)


def reset(db: Session, user: User, version: int) -> dict[str, Any]:
    t = _require(get_row(db, user), version)
    if t.style != "pomodoro":
        raise ApiError(409, "not_pomodoro", "Only a Pomodoro has a cycle to reset.")
    saved = None
    if t.phase == "work" and t.state != "waiting":
        saved = _save_entry(db, user, t, _stretch_end(t, now()))
    db.delete(t)
    db.flush()
    return response(None, saved=saved)


def extend(db: Session, user: User, version: int) -> dict[str, Any]:
    t = _require(get_row(db, user), version)
    if t.style != "focus" or t.focus_minutes is None or t.planned_end_at is None:
        raise ApiError(409, "not_focus", "Only a Focus session can be extended.")
    if t.focus_minutes + EXTEND_MIN > MAX_FOCUS_MIN:
        raise validation_error("/focusMinutes", "too_long", "A Focus session is at most 8 hours.")
    t.focus_minutes += EXTEND_MIN
    t.planned_end_at = iso(parse(t.planned_end_at) + timedelta(minutes=EXTEND_MIN))
    db.flush()
    return response(t)


def patch_timer(db: Session, user: User, version: int, changes: dict[str, Any]) -> dict[str, Any]:
    t = _require(get_row(db, user), version)
    if "description" in changes:
        t.description = (changes["description"] or "").strip()
    if "tag_id" in changes:
        _check_tag(db, user, changes["tag_id"])
        t.tag_id = changes["tag_id"]
    if "reminder_ack" in changes and changes["reminder_ack"] is not None:
        t.reminder_ack = changes["reminder_ack"]
    if {"course_id", "task_id", "session_key"} & changes.keys():
        current = {"course_id": t.course_id, "task_id": t.task_id, "session_key": t.session_key}
        for k, v in resolve_links(db, user, {**current, **changes}).items():
            setattr(t, k, v)
    db.flush()
    return response(t)


def undo(db: Session, user: User, body: dict[str, Any]) -> dict[str, Any]:
    """Bring back the replaced or discarded timer (research R6)."""
    current = get_row(db, user)
    expected = body.get("timer_version")
    if (current is None) != (expected is None) or (current and current.version != expected):
        raise ApiError(409, "undo_unavailable", "This can no longer be undone.")
    u = body["undo"]
    if u.get("entry_id"):
        entry = db.get(TimeEntry, u["entry_id"])
        if entry is None or entry.user_id != user.id or entry.version != 1 or entry.deleted_at:
            raise ApiError(409, "undo_unavailable", "This can no longer be undone.")
        db.delete(entry)
    prev = u.get("previous")
    if prev is None:
        raise ApiError(409, "undo_unavailable", "This can no longer be undone.")
    snap = TimerSnapshot.model_validate(prev).model_dump()
    _check_tag(db, user, snap["tag_id"])
    links = resolve_links(db, user, snap)
    if current is not None:
        db.delete(current)
        db.flush()
    t = TimeTimer(user_id=user.id, **{k: v for k, v in snap.items() if k not in links}, **links)
    for k in ("started_at", "paused_at", "planned_end_at", "finished_at"):
        v = getattr(t, k)
        setattr(t, k, iso(v) if isinstance(v, datetime) else v)
    db.add(t)
    db.flush()
    return response(t)


def read(db: Session, user: User) -> dict[str, Any]:
    t, settled = settle(db, user)
    return response(t, settled=settled)


# ---- entries API -----------------------------------------------------------------------------


def _overlaps(db: Session, user: User, e: TimeEntry) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.deleted_at.is_(None),
            TimeEntry.id != e.id,
            TimeEntry.started_at < e.ended_at,
            TimeEntry.ended_at > e.started_at,
        )
    )
    return [
        {
            "id": r.id,
            "description": r.description,
            "started_at": r.started_at,
            "ended_at": r.ended_at,
        }
        for r in rows
    ]


def get_entry(db: Session, user: User, entry_id: str, deleted: bool = False) -> TimeEntry:
    e = db.get(TimeEntry, entry_id)
    if e is None or e.user_id != user.id or (e.deleted_at is not None) != deleted:
        raise not_found("Entry")
    return e


def list_entries(
    db: Session, user: User, start: datetime, end: datetime, session_key: str | None
) -> list[dict[str, Any]]:
    if end <= start:
        raise validation_error("/to", "range_empty", "`to` must be after `from`.")
    if end - start > MAX_RANGE:
        raise validation_error("/to", "range_too_long", "Ask for at most 400 days at once.")
    _purge(db, user)
    q = select(TimeEntry).where(
        TimeEntry.user_id == user.id,
        TimeEntry.deleted_at.is_(None),
        TimeEntry.started_at < iso(end),
        TimeEntry.ended_at > iso(start),
    )
    if session_key is not None:
        q = q.where(TimeEntry.session_key == session_key)
    return [entry_out(e) for e in db.scalars(q.order_by(TimeEntry.started_at))]


def _purge(db: Session, user: User) -> None:
    cutoff = iso(now() - PURGE_AFTER)
    for e in db.scalars(
        select(TimeEntry).where(
            TimeEntry.user_id == user.id,
            TimeEntry.deleted_at.is_not(None),
            TimeEntry.deleted_at < cutoff,
        )
    ):
        db.delete(e)
    db.flush()


def _check_span(start: datetime, end: datetime) -> None:
    if end <= start:
        raise validation_error(
            "/endedAt", "end_not_after_start", "The end must be after the start."
        )


def create_entry(db: Session, user: User, body: dict[str, Any]) -> dict[str, Any]:
    start = body["started_at"]
    end = body.get("ended_at")
    if end is None:
        if body.get("duration_seconds") is None:
            raise validation_error("/endedAt", "required", "Give an end or a duration.")
        end = start + timedelta(seconds=body["duration_seconds"])
    _check_span(start, end)
    _check_tag(db, user, body.get("tag_id"))
    e = TimeEntry(
        user_id=user.id,
        started_at=iso(start),
        ended_at=iso(end),
        paused_seconds=0,
        source="manual",
        description=(body.get("description") or "").strip(),
        tag_id=body.get("tag_id"),
        **resolve_links(db, user, body),
    )
    db.add(e)
    db.flush()
    return {"entry": entry_out(e), "overlaps": _overlaps(db, user, e)}


def patch_entry(db: Session, user: User, e: TimeEntry, changes: dict[str, Any]) -> dict[str, Any]:
    start = changes.get("started_at") or parse(e.started_at)
    end = changes.get("ended_at") or parse(e.ended_at)
    _check_span(start, end)
    e.started_at, e.ended_at = iso(start), iso(end)
    if e.paused_seconds >= (end - start).total_seconds():
        e.paused_seconds = 0
    if "description" in changes:
        e.description = (changes["description"] or "").strip()
    if "tag_id" in changes:
        _check_tag(db, user, changes["tag_id"])
        e.tag_id = changes["tag_id"]
    if {"course_id", "task_id", "session_key"} & changes.keys():
        current = {"course_id": e.course_id, "task_id": e.task_id, "session_key": e.session_key}
        for k, v in resolve_links(db, user, {**current, **changes}).items():
            setattr(e, k, v)
    db.flush()
    return {"entry": entry_out(e), "overlaps": _overlaps(db, user, e)}


def delete_entry(db: Session, e: TimeEntry) -> None:
    e.deleted_at = iso(now())
    db.flush()


def restore_entry(db: Session, e: TimeEntry) -> dict[str, Any]:
    e.deleted_at = None
    db.flush()
    return entry_out(e)


def export_csv(db: Session, user: User, start: datetime, end: datetime, tz: str) -> str:
    """P3: one row per entry, local times in `tz` (an IANA zone)."""
    import csv
    import io
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise validation_error("/tz", "unknown_tz", "Unknown time zone.") from exc
    tags = {t["id"]: t["name"] for t in list_tags(db, user)}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date", "start", "end", "duration", "description", "tag", "link"])
    for e in list_entries(db, user, start, end, None):
        s, f = parse(e["started_at"]).astimezone(zone), parse(e["ended_at"]).astimezone(zone)
        d = e["duration_seconds"]
        w.writerow([
            s.date().isoformat(), s.strftime("%H:%M:%S"), f.strftime("%H:%M:%S"),
            f"{d // 3600}:{d // 60 % 60:02}:{d % 60:02}", e["description"],
            tags.get(e["tag_id"], ""), e["link_title"] or "",
        ])  # fmt: skip
    return out.getvalue()


# ---- tags API --------------------------------------------------------------------------------


def _tag_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise validation_error("/name", "name_required", "Give the tag a name.")
    if len(name) > 30:
        raise validation_error("/name", "name_too_long", "A tag name is at most 30 characters.")
    return name


def _check_unique(db: Session, user: User, key: str, except_id: str | None = None) -> None:
    q = select(TimeTag.id).where(TimeTag.user_id == user.id, TimeTag.name_key == key)
    if except_id:
        q = q.where(TimeTag.id != except_id)
    if db.scalar(q) is not None:
        raise ApiError(409, "tag_name_taken", "A tag with this name already exists.")


def list_tags(db: Session, user: User) -> list[dict[str, Any]]:
    counts = dict(
        db.execute(
            select(TimeEntry.tag_id, func.count())
            .where(TimeEntry.user_id == user.id, TimeEntry.deleted_at.is_(None))
            .group_by(TimeEntry.tag_id)
        ).all()
    )
    tags = db.scalars(select(TimeTag).where(TimeTag.user_id == user.id).order_by(TimeTag.name_key))
    return [tag_out(t, counts.get(t.id, 0)) for t in tags]


def tag_out(t: TimeTag, count: int | None = None) -> dict[str, Any]:
    return {
        "id": t.id,
        "name": t.name,
        "color": t.color,
        "entry_count": count or 0,
        "version": t.version,
    }


def get_tag(db: Session, user: User, tag_id: str) -> TimeTag:
    t = db.get(TimeTag, tag_id)
    if t is None or t.user_id != user.id:
        raise not_found("Tag")
    return t


def _count(db: Session, user: User, tag_id: str) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                TimeEntry.user_id == user.id,
                TimeEntry.tag_id == tag_id,
                TimeEntry.deleted_at.is_(None),
            )
        )
        or 0
    )


def create_tag(db: Session, user: User, name: str, color: str) -> dict[str, Any]:
    name = _tag_name(name)
    key = name_key(name)[:30]
    _check_unique(db, user, key)
    t = TimeTag(user_id=user.id, name=name, name_key=key, color=color)
    db.add(t)
    db.flush()
    return tag_out(t, 0)


def patch_tag(db: Session, user: User, t: TimeTag, changes: dict[str, Any]) -> dict[str, Any]:
    if changes.get("name") is not None:
        name = _tag_name(changes["name"])
        key = name_key(name)[:30]
        _check_unique(db, user, key, t.id)
        t.name, t.name_key = name, key
    if changes.get("color") is not None:
        t.color = changes["color"]
    db.flush()
    return tag_out(t, _count(db, user, t.id))


def delete_tag(db: Session, user: User, t: TimeTag) -> None:
    """Entries and the running timer keep going, untagged (FR-042)."""
    for e in db.scalars(select(TimeEntry).where(TimeEntry.tag_id == t.id)):
        e.tag_id = None
    timer = get_row(db, user)
    if timer is not None and timer.tag_id == t.id:
        timer.tag_id = None
    db.delete(t)
    db.flush()
