"""Expanded sessions for the calendar (and 002's course timeline)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.domain.recurrence import (
    ExceptionView,
    expand,
    parse_session_key,
    recurrence_summary,
)
from unihelper.models import ClassSeries, Course, Semester, SessionException, User
from unihelper.services.class_service import series_rule

MAX_RANGE_DAYS = 400


def load_exceptions(db: Session, lineage_ids: Sequence[str]) -> dict[str, list[ExceptionView]]:
    """Single-session exceptions per lineage."""
    out: dict[str, list[ExceptionView]] = {}
    if not lineage_ids:
        return out
    for e in db.scalars(
        select(SessionException).where(SessionException.lineage_id.in_(list(lineage_ids)))
    ):
        out.setdefault(e.lineage_id, []).append(
            ExceptionView(
                original_date=e.original_date,
                kind=e.kind,
                start_time=e.start_time,
                end_time=e.end_time,
                location=e.location,
                version=e.version,
            )
        )
    return out


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
        "lineage_id": view.lineage_id,
        "series_id": s.id,
        "series_version": s.version,
        "course_id": course.id,
        "course_name": course.name,
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


def list_sessions(
    db: Session,
    user: User,
    range_from: date,
    range_to: date,
    course_id: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    if range_to < range_from:
        raise validation_error("/to", "invalid_range", "'to' must be on or after 'from'.")
    if (range_to - range_from).days > MAX_RANGE_DAYS:
        raise ApiError(422, "range_too_large", f"Request at most {MAX_RANGE_DAYS} days at once.")
    rows = _rows(db, user, course_id=course_id)
    exceptions = load_exceptions(db, list({s.lineage_id for s, _, _ in rows}))
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
            out.append(_session_dict(view, s, course))
    out.sort(key=lambda d: (d["start"], d["course_name"].casefold(), d["key"]))
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
    return find_session(db, user, key)[0]
