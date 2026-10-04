"""Course timeline: every session of every class of a course, plus sessions that are no longer
scheduled but still have content (FR-001, FR-005, FR-006)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from unihelper.domain.recurrence import expand, resolve_until
from unihelper.models import ClassSeries, Note, SessionFolder, User
from unihelper.services import hierarchy_service as hs
from unihelper.services import session_folder_service as sfs
from unihelper.services.class_service import series_rule
from unihelper.services.session_query import load_exceptions

OPEN_ENDED = timedelta(days=366 * 2)  # "never"/count rules: count stops rrule itself


def _last_day(s: ClassSeries, semester_end: date | None) -> date:
    rule = series_rule(s)
    if rule.freq == "none":
        return s.start_date
    until = resolve_until(rule, semester_end)
    if until is not None:
        return until
    if rule.end_kind == "count" and rule.count:
        return s.start_date + timedelta(weeks=rule.interval_weeks * (rule.count + 1))
    return s.start_date + OPEN_ENDED


def course_timeline(
    db: Session, user: User, course_id: str, now: datetime | None = None
) -> dict[str, Any]:
    course = hs.get_course(db, user, course_id)
    semester, _year = hs.course_parents(db, course)
    now = now or datetime.now(UTC)
    series = list(db.scalars(select(ClassSeries).where(ClassSeries.course_id == course.id)))
    exceptions = load_exceptions(db, list({s.lineage_id for s in series}))

    counts: dict[str, int] = dict(
        db.execute(
            select(SessionFolder.id, func.count(Note.id))
            .join(Note, Note.session_folder_id == SessionFolder.id)
            .where(SessionFolder.course_id == course.id)
            .group_by(SessionFolder.id)
        ).all()
    )
    folders = {
        f.session_key: f
        for f in db.scalars(select(SessionFolder).where(SessionFolder.course_id == course.id))
    }

    entries: list[dict[str, Any]] = []
    for s in series:
        for view in expand(
            series_rule(s),
            lineage_id=s.lineage_id,
            series_id=s.id,
            semester_end=semester.end_date,
            range_from=s.start_date,
            range_to=_last_day(s, semester.end_date),
            tz=user.timezone,
            now=now,
            exceptions=exceptions.get(s.lineage_id, ()),
            location=s.location,
        ):
            folder = folders.get(view.key)
            entries.append(
                {
                    "key": view.key,
                    "lineage_id": view.lineage_id,
                    "course_id": course.id,
                    "date": view.date,
                    "start": view.start.isoformat(),
                    "end": view.end.isoformat(),
                    "title": s.title,
                    "location": view.location,
                    "color": s.color,
                    "status": view.status,
                    "scheduled": True,
                    "note_count": counts.get(folder.id, 0) if folder else 0,
                    "audio_count": 0,
                }
            )
    scheduled_keys = {e["key"] for e in entries}
    for key, folder in folders.items():
        if key in scheduled_keys or not counts.get(folder.id):
            continue
        snap = sfs.snapshot_session(user, folder, course, now)
        entries.append(
            {
                "key": key,
                "lineage_id": folder.lineage_id,
                "course_id": course.id,
                "date": folder.original_date,
                "start": snap["start"],
                "end": snap["end"],
                "title": folder.title,
                "location": folder.location,
                "color": course.default_color,
                "status": snap["status"],
                "scheduled": False,
                "note_count": counts.get(folder.id, 0),
                "audio_count": 0,
            }
        )
    entries.sort(key=lambda e: (e["start"], e["key"]))
    return {"course_id": course.id, "entries": entries}
