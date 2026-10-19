"""Undo of a calendar import run (010 research R13).

Removes only what the run created and nobody has built on since: class and event lineages with
no note, recording or document and no part in the Trash, then created courses left without
classes, then a created semester and year left empty. Updated entries are never reverted, and
no Trash entry is made. Directories are removed after the commit and only when empty
(Principle I)."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError
from unihelper.db.engine import on_commit
from unihelper.models import (
    CalendarImportSource,
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
    Year,
)
from unihelper.models.base import now_iso
from unihelper.services import hierarchy_service as hs
from unihelper.services import lineage as lineage_mod
from unihelper.services.calendar_import_service import get_run
from unihelper.services.creation_undo import _remove_dirs
from unihelper.services.trash_service import folder_parts
from unihelper.storage.storage_service import StorageService


def _any(db: Session, *where: Any) -> bool:
    return bool(db.scalar(select(exists().where(*where))))


def _title(db: Session, kind: str, row: Any) -> str:
    if kind == "event":
        return str(row.title)
    course = db.get(Course, row.course_id)
    return course.name if course else "Class"


def undo_run(db: Session, storage: StorageService, user: User, run_id: str) -> dict[str, Any]:
    run = get_run(db, user, run_id)
    if run.undone_at is not None:
        raise ApiError(409, "undo_unavailable", "This import was already undone.")
    created = json.loads(run.created_json or "{}")
    removed = {"classes": 0, "events": 0, "courses": 0, "semesters": 0, "years": 0}
    kept: list[dict[str, str]] = []
    dirs: list[list[str]] = []

    for item in created.get("lineages", []):
        lineage_id, kind = item["id"], item["kind"]
        lin = lineage_mod.load(db, user, lineage_id, kind)
        if lin is None or not lin.rows:
            if _any(db, TrashEntry.user_id == user.id, TrashEntry.lineage_id == lineage_id):
                kept.append({"title": "An imported entry", "message": "it is in the Trash"})
            continue
        title = _title(db, kind, lin.rows[0])
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
            kept.append({"title": title, "message": "it has notes, recordings or documents"})
            continue
        if any(f.trash_entry_id for f in folders) or _any(
            db, TrashEntry.user_id == user.id, TrashEntry.lineage_id == lineage_id
        ):
            kept.append({"title": title, "message": "part of it is in the Trash"})
            continue
        for f in folders:
            parts = folder_parts(db, user, f)
            if parts is not None:
                dirs.append(parts)
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
        db.execute(
            delete(CalendarImportSource).where(
                CalendarImportSource.user_id == user.id,
                CalendarImportSource.lineage_id == lineage_id,
            )
        )
        for f in folders:
            db.delete(f)
        for row in lin.rows:
            db.delete(row)
        db.flush()
        if kind == "event":  # 012: tasks linked to it stay, unlinked
            from unihelper.services import task_link_service

            task_link_service.unlink(db, user, lineage_ids=[lineage_id])
        removed["classes" if kind == "class" else "events"] += 1

    for course_id in created.get("courseIds", []):
        course = db.get(Course, course_id)
        if course is None or course.user_id != user.id:
            continue
        if _any(db, ClassSeries.course_id == course.id) or _any(
            db, SessionFolder.course_id == course.id
        ):
            kept.append({"title": course.name, "message": "the course still has classes"})
            continue
        semester, year = hs.course_parents(db, course)
        dirs.append(hs.course_parts(user, year, semester, course))
        db.delete(course)
        db.flush()
        removed["courses"] += 1

    for semester_id in created.get("semesterIds", []):
        sem = db.get(Semester, semester_id)
        if sem is None or sem.user_id != user.id:
            continue
        if (
            _any(db, Course.semester_id == sem.id)
            or _any(db, EventSeries.semester_id == sem.id)
            or _any(db, SessionFolder.semester_id == sem.id)
        ):
            kept.append({"title": sem.name, "message": "the semester is not empty"})
            continue
        sem_year = db.get(Year, sem.year_id)
        assert sem_year is not None
        dirs.append(hs.semester_parts(user, sem_year, sem))
        db.delete(sem)
        db.flush()
        removed["semesters"] += 1

    renumber = False
    for year_id in created.get("yearIds", []):
        yr = db.get(Year, year_id)
        if yr is None or yr.user_id != user.id:
            continue
        if _any(db, Semester.year_id == yr.id):
            kept.append({"title": yr.name, "message": "the year is not empty"})
            continue
        dirs.append(hs.year_parts(user, yr))
        db.delete(yr)
        db.flush()
        removed["years"] += 1
        renumber = True
    if renumber:
        hs._renumber_years(db, hs.list_years(db, user))

    run.undone_at = now_iso()
    db.flush()
    on_commit(db, lambda: _remove_dirs(storage, dirs))
    return {"removed": removed, "kept": kept}
