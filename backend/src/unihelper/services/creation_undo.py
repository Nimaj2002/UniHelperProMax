"""Undo of a just-made class or event (009 US6, research R10).

The quick form's Undo removes exactly what one `POST /classes` / `POST /events` made: the series
(one segment, unchanged since: `version`), its exceptions and empty folder rows, and the year,
semester and course rows that request created inline — refused (409 `undo_unavailable`) once an
occurrence holds a note, recording or document, once part of it is in the Trash, or when anything
else now uses a created hierarchy row. No Trash entry is made. Directories are removed after the
commit and only when no file is inside them (Principle I)."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from unihelper.api.deps import check_version
from unihelper.api.errors import ApiError, not_found
from unihelper.db.engine import on_commit
from unihelper.models import (
    ClassSeries,
    Course,
    Document,
    EventSeries,
    Note,
    Recording,
    Semester,
    SessionException,
    SessionFolder,
    TrashEntry,
    User,
    WorkspaceState,
)
from unihelper.schemas.classes import CreatedRefs
from unihelper.services import hierarchy_service as hs
from unihelper.services import lineage as lineage_mod
from unihelper.services.trash_service import folder_parts
from unihelper.storage.storage_service import StoragePathError, StorageService


def _unavailable(detail: str) -> ApiError:
    return ApiError(409, "undo_unavailable", "This can't be undone anymore.", detail=detail)


def _any(db: Session, *where: ColumnElement[bool]) -> bool:
    return bool(db.scalar(select(exists().where(*where))))


def undo_creation(
    db: Session, storage: StorageService, user: User, created: CreatedRefs, version: int
) -> None:
    lineage_id = created.lineage_id
    lin = lineage_mod.load(db, user, lineage_id)
    if lin is None or not lin.rows:
        raise not_found("Class or event")
    if len(lin.rows) != 1 or lin.rows[0].id != lineage_id:  # split by an edit since
        raise ApiError(
            412, "version_conflict", "This item was changed elsewhere. Reload and try again."
        )
    series = lin.rows[0]
    check_version(version, series.version)

    folders = list(
        db.scalars(
            select(SessionFolder).where(
                SessionFolder.user_id == user.id, SessionFolder.lineage_id == lineage_id
            )
        )
    )
    folder_ids = [f.id for f in folders]
    if folder_ids and any(
        _any(db, m.session_folder_id.in_(folder_ids)) for m in (Note, Recording, Document)
    ):
        raise _unavailable("It already has notes, recordings or documents.")
    if any(f.trash_entry_id for f in folders) or _any(
        db, TrashEntry.user_id == user.id, TrashEntry.lineage_id == lineage_id
    ):
        raise _unavailable("Part of it is in the Trash.")

    # the hierarchy rows this creation made, checked against the entry's own parents
    if lin.kind == "class":
        course = db.get(Course, series.course_id)
        assert course is not None
        semester, year = hs.course_parents(db, course)
    else:
        course = None
        semester = hs.get_semester(db, user, series.semester_id)
        year = hs.get_year(db, user, semester.year_id)
    drop_course = course is not None and created.course_id == course.id
    drop_semester = created.semester_id == semester.id
    drop_year = created.year_id == year.id
    if (
        (created.course_id and not drop_course)
        or (created.semester_id and not drop_semester)
        or (created.year_id and not drop_year)
    ):
        raise _unavailable("It no longer belongs to the year, semester or course it was made in.")
    others = SessionFolder.lineage_id != lineage_id
    if (
        drop_course
        and course is not None
        and (
            _any(db, ClassSeries.course_id == course.id, ClassSeries.lineage_id != lineage_id)
            or _any(db, SessionFolder.course_id == course.id, others)
        )
    ):
        raise _unavailable("Its new course is now used by another class.")
    if drop_semester and (
        _any(
            db,
            Course.semester_id == semester.id,
            Course.id != (course.id if drop_course and course else ""),
        )
        or _any(db, EventSeries.semester_id == semester.id, EventSeries.lineage_id != lineage_id)
        or _any(db, SessionFolder.semester_id == semester.id, others)
    ):
        raise _unavailable("Its new semester is now used by other courses or events.")
    if drop_year and _any(db, Semester.year_id == year.id, Semester.id != semester.id):
        raise _unavailable("Its new year now has other semesters.")

    # directories to take back (deepest first), resolved before their rows go
    dirs: list[list[str]] = []
    for f in folders:
        parts = folder_parts(db, user, f)
        if parts is not None:
            dirs.append(parts)
    if drop_year:
        dirs.append(hs.year_parts(user, year))
    elif drop_semester:
        dirs.append(hs.semester_parts(user, year, semester))
    elif drop_course and course is not None:
        dirs.append(hs.course_parts(user, year, semester, course))

    db.execute(
        delete(WorkspaceState).where(
            WorkspaceState.user_id == user.id, WorkspaceState.lineage_id == lineage_id
        )
    )
    db.execute(
        delete(SessionException).where(
            SessionException.user_id == user.id, SessionException.lineage_id == lineage_id
        )
    )
    for f in folders:
        db.delete(f)
    if lin.kind == "event":  # 012: the task `addToBoard` made (any task linked to it)
        from unihelper.services import task_link_service

        task_link_service.delete_for_lineage(db, user, lineage_id)
    db.delete(series)
    db.flush()
    if drop_course and course is not None:
        db.delete(course)
    if drop_semester:
        db.delete(semester)
    if drop_year:
        db.delete(year)
    db.flush()
    if drop_year:
        hs._renumber_years(db, hs.list_years(db, user))
    on_commit(db, lambda: _remove_dirs(storage, dirs))


def _remove_dirs(storage: StorageService, dirs: Sequence[Sequence[str]]) -> None:
    for parts in dirs:
        try:
            storage.remove_empty_dir(parts)
        except (StoragePathError, OSError):  # best effort: a folder left behind is harmless
            pass
