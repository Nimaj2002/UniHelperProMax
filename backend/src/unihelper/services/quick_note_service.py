"""Quick notes of a task (012): short plain text, soft delete with a 24 h Undo window."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.models import Task, TaskQuickNote, User
from unihelper.models.base import now_iso
from unihelper.services.task_service import undo_cutoff


def note_out(note: TaskQuickNote) -> dict[str, Any]:
    return {
        "id": note.id,
        "task_id": note.task_id,
        "title": note.title,
        "body": note.body,
        "version": note.version,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


def _live_task(db: Session, user: User, task_id: str) -> Task | None:
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id or not task.is_live:
        return None
    return task


def get_note(db: Session, user: User, note_id: str) -> TaskQuickNote:
    """A live note of a live task of the user."""
    note = db.get(TaskQuickNote, note_id)
    if (
        note is None
        or note.user_id != user.id
        or note.deleted_at is not None
        or _live_task(db, user, note.task_id) is None
    ):
        raise not_found("Quick note")
    return note


def list_notes(db: Session, user: User, task: Task) -> list[dict[str, Any]]:
    notes = db.scalars(
        select(TaskQuickNote)
        .where(
            TaskQuickNote.user_id == user.id,
            TaskQuickNote.task_id == task.id,
            TaskQuickNote.deleted_at.is_(None),
        )
        .order_by(TaskQuickNote.created_at.desc(), TaskQuickNote.id.desc())
    )
    return [note_out(n) for n in notes]


def _empty() -> ApiError:
    return validation_error("/body", "empty_quick_note", "Write a title or some text.")


def create_note(
    db: Session, user: User, task: Task, title: str | None, body: str | None
) -> dict[str, Any]:
    title, body = (title or "").strip(), body or ""
    if not title and not body.strip():
        raise _empty()
    note = TaskQuickNote(user_id=user.id, task_id=task.id, title=title, body=body)
    db.add(note)
    db.flush()
    return note_out(note)


def patch_note(
    db: Session, user: User, note: TaskQuickNote, fields: dict[str, Any]
) -> dict[str, Any]:
    title = (fields["title"] or "").strip() if "title" in fields else note.title
    body = (fields["body"] or "") if "body" in fields else note.body
    # an autosave may empty a note while it is being edited; the client discards it on close
    note.title = title
    note.body = body
    db.flush()
    return note_out(note)


def soft_delete_note(db: Session, note: TaskQuickNote) -> None:
    note.deleted_at = now_iso()
    db.flush()


def restore_note(db: Session, user: User, note_id: str) -> dict[str, Any]:
    note = db.get(TaskQuickNote, note_id)
    if (
        note is None
        or note.user_id != user.id
        or note.deleted_at is None
        or note.deleted_at < undo_cutoff()
        or _live_task(db, user, note.task_id) is None
    ):
        raise not_found("Quick note")
    note.deleted_at = None
    db.flush()
    return note_out(note)
