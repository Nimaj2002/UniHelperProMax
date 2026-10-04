"""Resolve a session key to its session (scheduled or not) and its lazily created folder."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.domain.naming import class_date_folder_name
from unihelper.domain.recurrence import parse_session_key
from unihelper.models import Course, Semester, SessionFolder, User, Year
from unihelper.services import hierarchy_service as hs
from unihelper.services import session_query
from unihelper.storage.storage_service import StorageService


@dataclass
class ResolvedSession:
    key: str
    lineage_id: str
    day: date
    session: dict[str, Any]  # SessionOut-shaped dict (scheduled or snapshot)
    course: Course
    semester: Semester
    year: Year
    folder: SessionFolder | None
    scheduled: bool


def find_folder(db: Session, user: User, lineage_id: str, day: date) -> SessionFolder | None:
    return db.scalar(
        select(SessionFolder).where(
            SessionFolder.user_id == user.id,
            SessionFolder.lineage_id == lineage_id,
            SessionFolder.original_date == day,
        )
    )


def snapshot_session(
    user: User, folder: SessionFolder, course: Course, now: datetime | None = None
) -> dict[str, Any]:
    tz = ZoneInfo(user.timezone)
    start = datetime.combine(folder.original_date, folder.start_time, tzinfo=tz)
    end = datetime.combine(folder.original_date, folder.end_time, tzinfo=tz)
    now = now or datetime.now(UTC)
    return {
        "key": folder.session_key,
        "lineage_id": folder.lineage_id,
        "series_id": "",
        "series_version": 0,
        "course_id": course.id,
        "course_name": course.name,
        "title": folder.title,
        "date": folder.original_date,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "location": folder.location,
        "color": course.default_color,
        "links": [],
        "recurrence_summary": "No longer scheduled",
        "is_exception": False,
        "exception_version": None,
        "status": "upcoming" if now < start else "past",
        "scheduled": False,
    }


def resolve(db: Session, user: User, key: str) -> ResolvedSession:
    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    folder = find_folder(db, user, lineage_id, day)
    try:
        session, _series = session_query.find_session(db, user, key)
        session["scheduled"] = True
        course = hs.get_course(db, user, session["course_id"])
        scheduled = True
    except ApiError as err:
        if err.status != 404 or folder is None:
            raise
        course = hs.get_course(db, user, folder.course_id)
        session = snapshot_session(user, folder, course)
        scheduled = False
    semester, year = hs.course_parents(db, course)
    return ResolvedSession(
        key=f"{lineage_id}:{day.isoformat()}",
        lineage_id=lineage_id,
        day=day,
        session=session,
        course=course,
        semester=semester,
        year=year,
        folder=folder,
        scheduled=scheduled,
    )


def folder_parts(user: User, r: ResolvedSession, folder: SessionFolder) -> list[str]:
    return [*hs.course_parts(user, r.year, r.semester, r.course), folder.folder_name]


def get_or_create_folder(
    db: Session, storage: StorageService, user: User, r: ResolvedSession
) -> SessionFolder:
    if r.folder is not None:
        storage.ensure_dir([*folder_parts(user, r, r.folder), "notes"])
        return r.folder
    s = r.session
    start = time.fromisoformat(s["start"][11:16])
    end = time.fromisoformat(s["end"][11:16])
    existing = list(
        db.scalars(select(SessionFolder.folder_name).where(SessionFolder.course_id == r.course.id))
    )
    name = class_date_folder_name(r.day, start, existing)
    folder = SessionFolder(
        user_id=user.id,
        course_id=r.course.id,
        lineage_id=r.lineage_id,
        original_date=r.day,
        folder_name=name,
        folder_key=name.casefold(),
        start_time=start,
        end_time=end,
        title=s.get("title"),
        location=s.get("location"),
    )
    db.add(folder)
    db.flush()
    r.folder = folder
    storage.ensure_dir([*folder_parts(user, r, folder), "notes"])
    return folder
