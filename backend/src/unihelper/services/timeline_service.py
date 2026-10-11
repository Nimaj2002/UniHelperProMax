"""Course timeline: every session of every class of a course, plus sessions that are no longer
scheduled but still have content (FR-001, FR-005, FR-006). 009: the semester's events timeline;
folders in the Trash are on neither."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from unihelper.domain.recurrence import SegmentLike, expand, resolve_until, rule_of
from unihelper.models import ClassSeries, Document, Note, Recording, SessionFolder, User
from unihelper.services import hierarchy_service as hs
from unihelper.services import session_folder_service as sfs
from unihelper.services.class_service import series_rule
from unihelper.services.session_query import (
    event_rows,
    expand_events,
    load_exceptions,
    trashed_keys,
)

OPEN_ENDED = timedelta(days=366 * 2)  # "never"/count rules: count stops rrule itself


def _last_day(s: SegmentLike, semester_end: date | None) -> date:
    rule = rule_of(s)
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
    trashed = trashed_keys(db, user, list({s.lineage_id for s in series}))

    counts: dict[str, int] = dict(
        db.execute(
            select(SessionFolder.id, func.count(Note.id))
            .join(Note, Note.session_folder_id == SessionFolder.id)
            .where(SessionFolder.course_id == course.id)
            .group_by(SessionFolder.id)
        ).all()
    )
    audio: dict[str, int] = dict(
        db.execute(
            select(Recording.session_folder_id, func.count(Recording.id))
            .join(SessionFolder, SessionFolder.id == Recording.session_folder_id)
            .where(SessionFolder.course_id == course.id)
            .group_by(Recording.session_folder_id)
        ).all()
    )
    folders = {
        f.session_key: f
        for f in db.scalars(
            select(SessionFolder).where(
                SessionFolder.course_id == course.id, SessionFolder.trash_entry_id.is_(None)
            )
        )
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
            if view.key in trashed:
                continue
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
                    "audio_count": audio.get(folder.id, 0) if folder else 0,
                }
            )
    scheduled_keys = {e["key"] for e in entries}
    for key, folder in folders.items():
        if key in scheduled_keys or not (counts.get(folder.id) or audio.get(folder.id)):
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
                "audio_count": audio.get(folder.id, 0),
            }
        )
    entries.sort(key=lambda e: (e["start"], e["key"]))
    return {"course_id": course.id, "entries": entries}


# ---- the semester's events (009 FR-010) ---------------------------------------------------


def _folder_counts(db: Session, model: Any, folder_ids: Any) -> dict[str, int]:
    return dict(
        db.execute(
            select(model.session_folder_id, func.count(model.id))
            .where(model.session_folder_id.in_(folder_ids))
            .group_by(model.session_folder_id)
        ).all()
    )


def semester_events_timeline(
    db: Session, user: User, semester_id: str, now: datetime | None = None
) -> list[dict[str, Any]]:
    """Every event occurrence of the semester in date order (incl. frozen ones), with content
    counts; occurrences in the Trash are left out."""
    semester = hs.get_semester(db, user, semester_id)
    now = now or datetime.now(UTC)
    rows = event_rows(db, user, semester_id=semester.id)
    if not rows:
        return []
    lineages = list({s.lineage_id for s, _ in rows})
    exceptions = load_exceptions(db, lineages)
    trashed = trashed_keys(db, user, lineages)
    moved = [
        d
        for excs in exceptions.values()
        for e in excs
        for d in (e.moved_date, e.original_date if e.detached else None)
        if d is not None
    ]
    lo = min([s.start_date for s, _ in rows] + moved)
    hi = max([_last_day(s, sem.end_date) for s, sem in rows] + moved)
    folder_ids = select(SessionFolder.id).where(
        SessionFolder.semester_id == semester.id,
        SessionFolder.kind == "event",
        SessionFolder.trash_entry_id.is_(None),
    )
    folders = {
        f.session_key: f.id
        for f in db.scalars(select(SessionFolder).where(SessionFolder.id.in_(folder_ids)))
    }
    notes = _folder_counts(db, Note, folder_ids)
    audio = _folder_counts(db, Recording, folder_ids)
    docs = _folder_counts(db, Document, folder_ids)
    entries: list[dict[str, Any]] = []
    for view, s in expand_events(rows, exceptions, lo, hi, user.timezone, now):
        if view.key in trashed:
            continue
        fid = folders.get(view.key)
        entries.append(
            {
                "session_key": view.key,
                "lineage_id": view.lineage_id,
                "title": view.title or s.title,
                "date": view.date,
                "start_time": view.start.strftime("%H:%M"),
                "end_time": view.end.strftime("%H:%M"),
                "start": view.start.isoformat(),
                "end": view.end.isoformat(),
                "location": view.location,
                "color": view.color or s.color,
                "status": view.status,
                "note_count": notes.get(fid, 0) if fid else 0,
                "audio_count": audio.get(fid, 0) if fid else 0,
                "document_count": docs.get(fid, 0) if fid else 0,
            }
        )
    entries.sort(key=lambda e: (e["start"], e["session_key"]))
    return entries
