"""Resolve a session key to its session (scheduled or not) and its lazily created folder.

009: keys of event occurrences resolve too (`kind = "event"`, no course); their folders live
in `<year>/<semester>/_Events/<YYYY-MM-DD Title>/`. Folders of occurrences in the Trash are
never resolved.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.domain.naming import (
    EVENTS_DIR,
    class_date_folder_name,
    event_folder_name,
    is_reserved_course_folder,
    unique_sibling,
)
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
    kind: str  # "class" | "event"
    course: Course | None  # None for events
    semester: Semester
    year: Year
    folder: SessionFolder | None
    scheduled: bool
    title: str | None  # the event's title; the class session's title (if any)


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
        "kind": "class",
        "lineage_id": folder.lineage_id,
        "series_id": "",
        "series_version": 0,
        "course_id": course.id,
        "course_name": course.name,
        "semester_id": course.semester_id,
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


def _event_snapshot(user: User, folder: SessionFolder, semester: Semester) -> dict[str, Any]:
    """An event folder whose occurrence is no longer scheduled (it still has content)."""
    tz = ZoneInfo(user.timezone)
    start = datetime.combine(folder.original_date, folder.start_time, tzinfo=tz)
    return {
        "key": folder.session_key,
        "kind": "event",
        "lineage_id": folder.lineage_id,
        "series_id": None,
        "series_version": 0,
        "course_id": None,
        "course_name": None,
        "semester_id": semester.id,
        "title": folder.title,
        "date": folder.original_date,
        "start": start.isoformat(),
        "end": datetime.combine(folder.original_date, folder.end_time, tzinfo=tz).isoformat(),
        "location": folder.location,
        "color": "blue",
        "links": [],
        "recurrence_summary": "No longer scheduled",
        "is_exception": False,
        "exception_version": None,
        "status": "upcoming" if datetime.now(UTC) < start else "past",
        "scheduled": False,
    }


def _semester_parents(db: Session, user: User, semester_id: str) -> tuple[Semester, Year]:
    semester = hs.get_semester(db, user, semester_id)
    year = hs.get_year(db, user, semester.year_id)
    return semester, year


def resolve(db: Session, user: User, key: str) -> ResolvedSession:
    """Class lineages first, then (009) event lineages; then an unscheduled folder's snapshot.
    A folder in the Trash is never resolved (404)."""
    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    folder = find_folder(db, user, lineage_id, day)
    if folder is not None and folder.trash_entry_id is not None:
        raise not_found("Session")
    course: Course | None = None
    try:
        session, _series = session_query.find_session(db, user, key)
        course = hs.get_course(db, user, session["course_id"])
        session.setdefault("kind", "class")
        session.setdefault("semester_id", course.semester_id)
        kind = "class"
    except ApiError as err:
        if err.status != 404:
            raise
        try:
            session, _event = session_query.find_event_session(db, user, key)
            kind = "event"
        except ApiError as err2:
            if err2.status != 404 or folder is None:
                raise
            if folder.kind == "event":
                assert folder.semester_id is not None  # CHECK owner (not trashed)
                semester, _year = _semester_parents(db, user, folder.semester_id)
                session = _event_snapshot(user, folder, semester)
                kind = "event"
            else:
                assert folder.course_id is not None  # CHECK owner (not trashed)
                course = hs.get_course(db, user, folder.course_id)
                session = snapshot_session(user, folder, course)
                kind = "class"
            session["scheduled"] = False
    scheduled = session.get("scheduled", True)
    session["scheduled"] = scheduled
    if course is not None:
        semester, year = hs.course_parents(db, course)
    else:
        semester, year = _semester_parents(db, user, session["semester_id"])
    return ResolvedSession(
        key=f"{lineage_id}:{day.isoformat()}",
        lineage_id=lineage_id,
        day=day,
        session=session,
        kind=kind,
        course=course,
        semester=semester,
        year=year,
        folder=folder,
        scheduled=scheduled,
        title=session.get("title"),
    )


def owner_parts(user: User, r: ResolvedSession) -> list[str]:
    """The folder that holds the session folders: the course's, or the semester's `_Events`."""
    if r.course is not None:
        return hs.course_parts(user, r.year, r.semester, r.course)
    return [*hs.semester_parts(user, r.year, r.semester), EVENTS_DIR]


def folder_parts(user: User, r: ResolvedSession, folder: SessionFolder) -> list[str]:
    return [*owner_parts(user, r), folder.folder_name]


def _check_events_folder(db: Session, semester: Semester) -> None:
    """A course created before 009 may already own the `_Events` folder (research R1)."""
    folders = db.scalars(select(Course.folder_name).where(Course.semester_id == semester.id))
    if any(is_reserved_course_folder(f) for f in folders):
        raise ApiError(
            409,
            "events_folder_conflict",
            "A course in this semester uses the folder “_Events”, which is reserved for events. "
            "Rename that course first.",
        )


def _event_folder_name(
    db: Session, storage: StorageService, user: User, r: ResolvedSession, start: time
) -> str:
    """`YYYY-MM-DD Title`, unique among the semester's event folders and the directories
    already on disk (a folder the user made by hand is never reused)."""
    taken = list(
        db.scalars(
            select(SessionFolder.folder_name).where(SessionFolder.semester_id == r.semester.id)
        )
    )
    base = event_folder_name(r.day, r.title or "Event")
    parent = owner_parts(user, r)
    name = unique_sibling(base, taken)
    while storage.exists([*parent, name]):
        taken.append(name)
        name = unique_sibling(base, taken)
    return name


def get_or_create_folder(
    db: Session, storage: StorageService, user: User, r: ResolvedSession
) -> SessionFolder:
    if r.folder is not None:
        storage.ensure_dir([*folder_parts(user, r, r.folder), "notes"])
        return r.folder
    s = r.session
    start = time.fromisoformat(s["start"][11:16])
    end = time.fromisoformat(s["end"][11:16])
    if r.course is not None:
        existing = list(
            db.scalars(
                select(SessionFolder.folder_name).where(SessionFolder.course_id == r.course.id)
            )
        )
        name = class_date_folder_name(r.day, start, existing)
        # 009: a directory left on disk (e.g. by a course in the Trash) is never reused
        while storage.exists([*owner_parts(user, r), name]):
            existing.append(name)
            name = class_date_folder_name(r.day, start, existing)
        owner: dict[str, Any] = {"kind": "class", "course_id": r.course.id}
    else:
        _check_events_folder(db, r.semester)
        name = _event_folder_name(db, storage, user, r, start)
        owner = {"kind": "event", "semester_id": r.semester.id}
    folder = SessionFolder(
        user_id=user.id,
        lineage_id=r.lineage_id,
        original_date=r.day,
        folder_name=name,
        folder_key=name.casefold(),
        start_time=start,
        end_time=end,
        title=s.get("title"),
        location=s.get("location"),
        **owner,
    )
    db.add(folder)
    db.flush()
    r.folder = folder
    storage.ensure_dir([*folder_parts(user, r, folder), "notes"])
    return folder
