"""Notes across sessions and courses for the chat's attach picker (014 FR-046)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import validation_error
from unihelper.domain.recurrence import parse_session_key
from unihelper.models import Course, Note, SessionFolder, User


def _label(folder: SessionFolder, course: Course | None) -> str:
    day = folder.original_date.strftime("%a %d %b")
    if folder.kind == "event":
        return f"{folder.title or 'Event'} · {day}"
    return f"{course.name if course else 'Class'} · {day}"


def search(
    db: Session,
    user: User,
    q: str | None = None,
    course_id: str | None = None,
    session_key: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = (
        select(Note, SessionFolder, Course)
        .join(SessionFolder, SessionFolder.id == Note.session_folder_id)
        .outerjoin(Course, Course.id == SessionFolder.course_id)
        .where(Note.user_id == user.id, SessionFolder.trash_entry_id.is_(None))
    )
    text = (q or "").strip()
    if text:
        query = query.where(Note.name_key.contains(text.casefold()))
    if course_id:
        query = query.where(SessionFolder.course_id == course_id)
    if session_key:
        parsed = parse_session_key(session_key)
        if parsed is None:
            raise validation_error("/sessionKey", "invalid", "Not a session key.")
        query = query.where(
            SessionFolder.lineage_id == parsed[0], SessionFolder.original_date == parsed[1]
        )
    rows = db.execute(query.order_by(Note.updated_at.desc(), Note.id).limit(limit)).all()
    return [
        {
            "id": note.id,
            "title": note.name,
            "session_key": folder.session_key,
            "session_label": _label(folder, course),
            "course_id": course.id if course else None,
            "course_name": course.name if course else None,
            "updated_at": note.updated_at,
        }
        for note, folder, course in rows
    ]
