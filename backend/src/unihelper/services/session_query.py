"""Expanded sessions for the calendar (and 002's course timeline)."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.domain.recurrence import (
    ExceptionView,
    SessionView,
    expand,
    expand_detached,
    generates,
    occurrence_view,
    parse_session_key,
    recurrence_summary,
    rule_of,
)
from unihelper.models import (
    ClassSeries,
    Course,
    EventSeries,
    Semester,
    SessionException,
    SessionFolder,
    User,
)
from unihelper.services.class_service import series_rule
from unihelper.services.task_link_service import task_ids_for_keys

MAX_RANGE_DAYS = 400


def load_exceptions(db: Session, lineage_ids: Sequence[str]) -> dict[str, list[ExceptionView]]:
    """Single-session exceptions per lineage."""
    out: dict[str, list[ExceptionView]] = {}
    if not lineage_ids:
        return out
    for e in db.scalars(
        select(SessionException).where(SessionException.lineage_id.in_(list(lineage_ids)))
    ):
        out.setdefault(e.lineage_id, []).append(exception_view(e))
    return out


def exception_view(e: SessionException) -> ExceptionView:
    links = None
    if e.links_json is not None:
        links = tuple((link.get("label"), link["url"]) for link in json.loads(e.links_json))
    return ExceptionView(
        original_date=e.original_date,
        kind=e.kind,
        start_time=e.start_time,
        end_time=e.end_time,
        location=e.location,
        version=e.version,
        title=e.title,
        color=e.color,
        links=links,
        moved_date=e.moved_date,
        detached=e.detached,
    )


def count_exceptions(db: Session, lineage_id: str) -> int:
    return len(load_exceptions(db, [lineage_id]).get(lineage_id, []))


def _rows(
    db: Session, user: User, course_id: str | None = None, lineage_id: str | None = None
) -> list[tuple[ClassSeries, Course, Semester]]:
    stmt = (
        select(ClassSeries, Course, Semester)
        .join(Course, Course.id == ClassSeries.course_id)
        .join(Semester, Semester.id == Course.semester_id)
        .where(ClassSeries.user_id == user.id)
    )
    if course_id:
        stmt = stmt.where(ClassSeries.course_id == course_id)
    if lineage_id:
        stmt = stmt.where(ClassSeries.lineage_id == lineage_id)
    return [(s, c, sem) for s, c, sem in db.execute(stmt).all()]


def _session_dict(view: Any, s: ClassSeries, course: Course) -> dict[str, Any]:
    return {
        "key": view.key,
        "kind": "class",
        "lineage_id": view.lineage_id,
        "series_id": s.id,
        "series_version": s.version,
        "course_id": course.id,
        "course_name": course.name,
        "semester_id": course.semester_id,
        "title": s.title,
        "date": view.date,
        "start": view.start.isoformat(),
        "end": view.end.isoformat(),
        "location": view.location,
        "color": s.color,
        "links": [{"label": link.label, "url": link.url} for link in s.links],
        "recurrence_summary": recurrence_summary(series_rule(s)),
        "is_exception": view.is_exception,
        "exception_version": view.exception_version,
        "status": view.status,
    }


def trashed_keys(db: Session, user: User, lineage_ids: Sequence[str]) -> set[str]:
    """Keys of occurrences whose folder is in the Trash (009): never listed."""
    if not lineage_ids:
        return set()
    return {
        f.session_key
        for f in db.scalars(
            select(SessionFolder).where(
                SessionFolder.user_id == user.id,
                SessionFolder.lineage_id.in_(list(lineage_ids)),
                SessionFolder.trash_entry_id.is_not(None),
            )
        )
    }


def list_sessions(
    db: Session,
    user: User,
    range_from: date,
    range_to: date,
    course_id: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Class sessions and (009) event occurrences in the range, sorted by start. `courseId`
    keeps one course's class sessions only: events belong to no course (FR-009)."""
    if range_to < range_from:
        raise validation_error("/to", "invalid_range", "'to' must be on or after 'from'.")
    if (range_to - range_from).days > MAX_RANGE_DAYS:
        raise ApiError(422, "range_too_large", f"Request at most {MAX_RANGE_DAYS} days at once.")
    rows = _rows(db, user, course_id=course_id)
    events = [] if course_id else event_rows(db, user)
    lineages = list({s.lineage_id for s, _, _ in rows} | {s.lineage_id for s, _ in events})
    exceptions = load_exceptions(db, lineages)
    trashed = trashed_keys(db, user, lineages)
    now = now or datetime.now(UTC)
    out: list[dict[str, Any]] = []
    for s, course, sem in rows:
        for view in expand(
            series_rule(s),
            lineage_id=s.lineage_id,
            series_id=s.id,
            semester_end=sem.end_date,
            range_from=range_from,
            range_to=range_to,
            tz=user.timezone,
            now=now,
            exceptions=exceptions.get(s.lineage_id, ()),
            location=s.location,
        ):
            if view.key not in trashed:
                out.append(_session_dict(view, s, course))
    event_out = [
        event_session_dict(view, ev)
        for view, ev in expand_events(events, exceptions, range_from, range_to, user.timezone, now)
        if view.key not in trashed
    ]
    task_ids = task_ids_for_keys(db, user, [e["key"] for e in event_out])  # 012, one query
    for e in event_out:
        e["task_id"] = task_ids.get(e["key"])
    out.extend(event_out)
    out.sort(key=lambda d: (d["start"], (d["course_name"] or d["title"]).casefold(), d["key"]))
    return out


def find_session(db: Session, user: User, key: str) -> tuple[dict[str, Any], ClassSeries]:
    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    rows = _rows(db, user, lineage_id=lineage_id)
    exceptions = load_exceptions(db, [lineage_id]).get(lineage_id, [])
    for s, course, sem in rows:
        views = expand(
            series_rule(s),
            lineage_id=lineage_id,
            series_id=s.id,
            semester_end=sem.end_date,
            range_from=day,
            range_to=day,
            tz=user.timezone,
            now=datetime.now(UTC),
            exceptions=exceptions,
            location=s.location,
        )
        if views:
            return _session_dict(views[0], s, course), s
    raise not_found("Session")


def get_session(db: Session, user: User, key: str) -> dict[str, Any]:
    """A class session or (009) an event occurrence."""
    try:
        return find_session(db, user, key)[0]
    except ApiError as err:
        if err.status != 404:
            raise
        session = find_event_session(db, user, key)[0]
        session["task_id"] = task_ids_for_keys(db, user, [key]).get(key)
        return session


# ---- events (009) -----------------------------------------------------------------------------


def event_rows(
    db: Session,
    user: User,
    semester_id: str | None = None,
    lineage_id: str | None = None,
) -> list[tuple[EventSeries, Semester]]:
    stmt = (
        select(EventSeries, Semester)
        .join(Semester, Semester.id == EventSeries.semester_id)
        .where(EventSeries.user_id == user.id)
        .order_by(EventSeries.lineage_id, EventSeries.start_date)
    )
    if semester_id:
        stmt = stmt.where(EventSeries.semester_id == semester_id)
    if lineage_id:
        stmt = stmt.where(EventSeries.lineage_id == lineage_id)
    return [(s, sem) for s, sem in db.execute(stmt).all()]


def _generated_by(segs: Sequence[tuple[EventSeries, Semester]]) -> Callable[[date], bool]:
    def generated(day: date) -> bool:
        return any(generates(rule_of(s), sem.end_date, day) for s, sem in segs)

    return generated


def expand_events(
    rows: Sequence[tuple[EventSeries, Semester]],
    exceptions: dict[str, list[ExceptionView]],
    range_from: date,
    range_to: date,
    tz: str,
    now: datetime,
) -> list[tuple[SessionView, EventSeries]]:
    """Every event occurrence shown in the range: each segment's (with its exceptions'
    overrides and moved dates), plus frozen occurrences no segment generates any more (R4)."""
    by_lineage: dict[str, list[tuple[EventSeries, Semester]]] = {}
    for s, sem in rows:
        by_lineage.setdefault(s.lineage_id, []).append((s, sem))
    out: list[tuple[SessionView, EventSeries]] = []
    for lineage_id, segs in by_lineage.items():
        excs = exceptions.get(lineage_id, [])
        for s, sem in segs:
            for view in expand(
                rule_of(s),
                lineage_id=lineage_id,
                series_id=s.id,
                semester_end=sem.end_date,
                range_from=range_from,
                range_to=range_to,
                tz=tz,
                now=now,
                exceptions=excs,
                location=s.location,
            ):
                out.append((view, s))
        if not any(e.detached for e in excs):
            continue
        last = segs[-1][0]
        for view in expand_detached(
            excs,
            _generated_by(segs),
            lineage_id=lineage_id,
            series_id=last.id,
            range_from=range_from,
            range_to=range_to,
            tz=tz,
            now=now,
            start_time=last.start_time,
            end_time=last.end_time,
            location=last.location,
        ):
            out.append((view, last))
    return out


def event_session_dict(view: Any, s: EventSeries) -> dict[str, Any]:
    """A calendar row for one event occurrence (`kind = "event"`; no course)."""
    links = (
        view.links if view.links is not None else tuple((link.label, link.url) for link in s.links)
    )
    return {
        "key": view.key,
        "kind": "event",
        "lineage_id": view.lineage_id,
        "series_id": None,  # events have no class series; `seriesVersion` is the segment's
        "series_version": s.version,
        "course_id": None,
        "course_name": None,
        "semester_id": s.semester_id,
        "title": view.title or s.title,
        "date": view.date,
        "start": view.start.isoformat(),
        "end": view.end.isoformat(),
        "location": view.location,
        "color": view.color or s.color,
        "links": [{"label": label, "url": url} for label, url in links],
        "recurrence_summary": recurrence_summary(rule_of(s)),
        "is_exception": view.is_exception,
        "exception_version": view.exception_version,
        "status": view.status,
    }


def find_event_session(
    db: Session, user: User, key: str, now: datetime | None = None
) -> tuple[dict[str, Any], EventSeries]:
    """The event occurrence with this key — wherever it is shown (a moved occurrence keeps its
    original-date key) and including frozen occurrences no rule generates any more."""
    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    rows = [
        (s, sem)
        for s, sem in db.execute(
            select(EventSeries, Semester)
            .join(Semester, Semester.id == EventSeries.semester_id)
            .where(EventSeries.user_id == user.id, EventSeries.lineage_id == lineage_id)
            .order_by(EventSeries.start_date)
        ).all()
    ]
    if not rows:
        raise not_found("Session")
    exc = next(
        (
            e
            for e in load_exceptions(db, [lineage_id]).get(lineage_id, [])
            if e.original_date == day
        ),
        None,
    )
    if exc is not None and exc.kind == "cancelled":
        raise not_found("Session")
    now = now or datetime.now(UTC)
    for s, sem in rows:
        if generates(rule_of(s), sem.end_date, day):
            view = occurrence_view(
                day,
                exc,
                lineage_id=lineage_id,
                series_id=s.id,
                start_time=s.start_time,
                end_time=s.end_time,
                location=s.location,
                zone=ZoneInfo(user.timezone),
                now=now,
            )
            return event_session_dict(view, s), s
    if exc is not None:
        s = rows[-1][0]
        detached = expand_detached(
            [exc],
            lambda _d: False,
            lineage_id=lineage_id,
            series_id=s.id,
            range_from=date.min,
            range_to=date.max,
            tz=user.timezone,
            now=now,
            start_time=s.start_time,
            end_time=s.end_time,
            location=s.location,
        )
        if detached:
            return event_session_dict(detached[0], s), s
    raise not_found("Session")
