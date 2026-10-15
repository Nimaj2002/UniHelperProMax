"""Tasks on the board (012): read, create, move, edit, checklist, soft delete + restore.

Positions are 0..n-1 per column among live tasks (research R3). Renumbering the other tasks of a
column does not bump their versions (a bulk UPDATE, no mapper events): only the task that was
moved or edited changes version, so a client holding the board does not get 412s for siblings.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import Integer, cast, delete, func, select, update
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.domain.recurrence import parse_session_key
from unihelper.models import Course, Task, TaskChecklistItem, TaskColumn, TaskQuickNote, User
from unihelper.models.base import now_iso
from unihelper.schemas.classes import parse_hhmm
from unihelper.schemas.tasks import TaskCreate
from unihelper.services import hierarchy_service as hs
from unihelper.services import task_column_service as tcs

UNDO_WINDOW = timedelta(hours=24)


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t is not None else None


def undo_cutoff() -> str:
    return (datetime.now(UTC) - UNDO_WINDOW).isoformat(timespec="seconds")


# ---- output ------------------------------------------------------------------------------


def _event_out(task: Task) -> dict[str, Any] | None:
    if task.event_key is None:
        return None
    day = task.due_date
    if day is None:
        parsed = parse_session_key(task.event_key)
        if parsed is None:
            return None
        day = parsed[1]
    return {
        "session_key": task.event_key,
        "title": task.title,
        "date": day,
        "start": _hhmm(task.due_time),
    }


def task_out(
    task: Task,
    course: Course | None,
    checklist: tuple[int, int],
    note_count: int,
) -> dict[str, Any]:
    done, total = checklist
    return {
        "id": task.id,
        "column_id": task.column_id,
        "position": task.position,
        "title": task.title,
        "description": task.description,
        "due_date": task.due_date,
        "due_time": _hhmm(task.due_time),
        "course_id": task.course_id,
        "course_name": course.name if course is not None else None,
        "course_color": course.default_color if course is not None else None,
        "event": _event_out(task),
        "completed_at": task.completed_at,
        "previous_column_id": task.previous_column_id,
        "checklist_done": done,
        "checklist_total": total,
        "quick_note_count": note_count,
        "version": task.version,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def _outs(db: Session, tasks: Sequence[Task]) -> list[dict[str, Any]]:
    """Batch-load courses, checklist counts and quick-note counts for the tasks."""
    ids = [t.id for t in tasks]
    if not ids:
        return []
    course_ids = {t.course_id for t in tasks if t.course_id}
    courses = (
        {c.id: c for c in db.scalars(select(Course).where(Course.id.in_(course_ids)))}
        if course_ids
        else {}
    )
    checklist: dict[str, tuple[int, int]] = {}
    for task_id, done, total in db.execute(
        select(
            TaskChecklistItem.task_id,
            func.sum(cast(TaskChecklistItem.done, Integer)),
            func.count(),
        )
        .where(TaskChecklistItem.task_id.in_(ids))
        .group_by(TaskChecklistItem.task_id)
    ):
        checklist[task_id] = (int(done or 0), int(total))
    notes = {
        task_id: int(n)
        for task_id, n in db.execute(
            select(TaskQuickNote.task_id, func.count())
            .where(TaskQuickNote.task_id.in_(ids), TaskQuickNote.deleted_at.is_(None))
            .group_by(TaskQuickNote.task_id)
        )
    }
    return [
        task_out(
            t,
            courses.get(t.course_id) if t.course_id else None,
            checklist.get(t.id, (0, 0)),
            notes.get(t.id, 0),
        )
        for t in tasks
    ]


def one_out(db: Session, task: Task) -> dict[str, Any]:
    return _outs(db, [task])[0]


def detail_out(db: Session, task: Task) -> dict[str, Any]:
    out = one_out(db, task)
    out["checklist"] = [{"id": i.id, "text": i.text, "done": i.done} for i in task.checklist]
    return out


# ---- lookups -----------------------------------------------------------------------------


def list_tasks(db: Session, user: User) -> list[dict[str, Any]]:
    """Live tasks ordered by column position, then position in the column."""
    tcs.ensure_columns(db, user)
    tasks = list(
        db.scalars(
            select(Task)
            .join(TaskColumn, TaskColumn.id == Task.column_id)
            .where(Task.user_id == user.id, Task.is_live)
            .order_by(TaskColumn.position, Task.position, Task.created_at)
        )
    )
    return _outs(db, tasks)


def get_task(db: Session, user: User, task_id: str) -> Task:
    """A live task of the user (soft-deleted and trashed tasks are "not found")."""
    t = db.get(Task, task_id)
    if t is None or t.user_id != user.id or not t.is_live:
        raise not_found("Task")
    return t


# ---- ordering ----------------------------------------------------------------------------


def set_positions(db: Session, tasks: Sequence[Task], moved: Task | None = None) -> None:
    """Positions 0..n-1 in list order. The moved task changes through the ORM (version bump);
    the others with a bulk UPDATE (no version bump)."""
    for i, t in enumerate(tasks):
        if t.position == i:
            continue
        if t is moved:
            t.position = i
        else:
            db.execute(update(Task).where(Task.id == t.id).values(position=i))
    db.flush()


def renumber_column(db: Session, user: User, column_id: str) -> None:
    set_positions(db, tcs.live_tasks_of(db, user, column_id))


# ---- create ------------------------------------------------------------------------------


def _check_course(db: Session, user: User, course_id: str | None) -> None:
    if course_id is not None:
        hs.get_course(db, user, course_id)


def _time_without_date() -> ApiError:
    return validation_error("/dueTime", "time_without_date", "Add a due date to set a time.")


def create_task(db: Session, user: User, body: TaskCreate) -> dict[str, Any]:
    cols = tcs.ensure_columns(db, user)
    col = tcs.get_column(db, user, body.column_id) if body.column_id is not None else cols[0]
    _check_course(db, user, body.course_id)
    values: dict[str, Any]
    if body.event_key is not None:
        # linked: title, date and time follow the occurrence (body values are not used)
        from unihelper.services import task_link_service as tls

        view = tls.occurrence_view(db, user, body.event_key)
        if tls.has_live_task(db, user, body.event_key):
            raise ApiError(409, "event_has_task", "This event already has a task on the board.")
        values = {"event_key": body.event_key, **tls.cached_values(view)}
    else:
        if body.title is None:
            raise validation_error("/title", "validation_failed", "Enter a title.")
        if body.due_time is not None and body.due_date is None:
            raise _time_without_date()
        values = {
            "title": body.title,
            "due_date": body.due_date,
            "due_time": parse_hhmm(body.due_time) if body.due_time is not None else None,
        }
    task = Task(
        user_id=user.id,
        column_id=col.id,
        position=len(tcs.live_tasks_of(db, user, col.id)),
        description=body.description,
        course_id=body.course_id,
        completed_at=now_iso() if col.counts_as_done else None,
        **values,
    )
    db.add(task)
    db.flush()
    return one_out(db, task)


# ---- move --------------------------------------------------------------------------------


def _enter_column(task: Task, old: TaskColumn | None, target: TaskColumn) -> None:
    """Record or clear completion when the task lands in `target`."""
    was_done = old is not None and old.counts_as_done
    if target.counts_as_done and not was_done:
        task.completed_at = now_iso()
        task.previous_column_id = old.id if old is not None else None
    elif target.counts_as_done:
        task.completed_at = task.completed_at or now_iso()
    else:
        task.completed_at = None


def move_task(db: Session, user: User, task: Task, column_id: str, index: int) -> dict[str, Any]:
    target = tcs.get_column(db, user, column_id)
    old = db.get(TaskColumn, task.column_id)
    if target.id != task.column_id:
        source = [t for t in tcs.live_tasks_of(db, user, task.column_id) if t.id != task.id]
        _enter_column(task, old, target)
        task.column_id = target.id
        set_positions(db, source)
    others = [t for t in tcs.live_tasks_of(db, user, target.id) if t.id != task.id]
    others.insert(min(index, len(others)), task)
    set_positions(db, others, moved=task)
    db.flush()
    return one_out(db, task)


# ---- edit --------------------------------------------------------------------------------

LINKED_FIELDS = ("title", "due_date", "due_time")


def patch_task(db: Session, user: User, task: Task, fields: dict[str, Any]) -> dict[str, Any]:
    if task.event_key is not None:
        locked = [f for f in LINKED_FIELDS if f in fields]
        if locked:
            raise ApiError(
                409,
                "linked_field_read_only",
                "The title and due date of a linked task follow its event. Edit the event.",
            )
    if "title" in fields:
        if fields["title"] is None:
            raise validation_error("/title", "validation_failed", "Enter a title.")
        task.title = fields["title"]
    if "description" in fields:
        task.description = fields["description"] or ""
    if "course_id" in fields:
        _check_course(db, user, fields["course_id"])
        task.course_id = fields["course_id"]
    due_date = fields["due_date"] if "due_date" in fields else task.due_date
    if "due_time" in fields:
        raw = fields["due_time"]
        due_time = parse_hhmm(raw) if raw is not None else None
    elif "due_date" in fields and due_date is None:
        due_time = None  # clearing the date clears its time
    else:
        due_time = task.due_time
    if due_time is not None and due_date is None:
        raise _time_without_date()
    task.due_date = due_date
    task.due_time = due_time
    db.flush()
    return detail_out(db, task)


def replace_checklist(db: Session, user: User, task: Task, items: Sequence[Any]) -> dict[str, Any]:
    """Keep the items whose ids are given, create the new ones, delete the missing ones;
    order = array order. Bumps the task's version (its single concurrency token)."""
    given = [i.id for i in items if i.id is not None]
    if len(given) != len(set(given)):
        raise validation_error("/items", "validation_failed", "Checklist item ids must be unique.")
    existing = {i.id: i for i in task.checklist}
    kept: list[TaskChecklistItem] = []
    for pos, item in enumerate(items):
        row = existing.get(item.id) if item.id is not None else None
        if row is None:
            row = TaskChecklistItem(user_id=user.id, task_id=task.id, position=pos)
            if item.id is not None and db.get(TaskChecklistItem, item.id) is None:
                row.id = item.id  # an item restored by Undo keeps its id
        row.text = item.text
        row.done = item.done
        row.position = pos
        kept.append(row)
    task.checklist = kept
    task.updated_at = now_iso()  # dirty → version bump
    db.flush()
    db.refresh(task, ["checklist"])
    return detail_out(db, task)


# ---- delete / restore --------------------------------------------------------------------


def soft_delete_task(db: Session, user: User, task: Task) -> None:
    """Hidden at once, restorable for 24 h (Undo); never touches the linked event."""
    task.deleted_at = now_iso()
    db.flush()
    renumber_column(db, user, task.column_id)


def restore_task(db: Session, user: User, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if (
        task is None
        or task.user_id != user.id
        or task.deleted_at is None
        or task.trash_entry_id is not None
        or task.deleted_at < undo_cutoff()
    ):
        raise not_found("Task")
    column = db.get(TaskColumn, task.column_id)
    if column is None or column.user_id != user.id:  # pragma: no cover - FK keeps it valid
        column = tcs.ensure_columns(db, user)[0]
        task.column_id = column.id
    if task.event_key is not None:
        taken = db.scalar(
            select(Task.id).where(
                Task.user_id == user.id,
                Task.event_key == task.event_key,
                Task.id != task.id,
                Task.is_live,
            )
        )
        if taken is not None:
            task.event_key = None  # the occurrence got another task meanwhile
    if column.counts_as_done:
        task.completed_at = task.completed_at or now_iso()
    else:
        task.completed_at = None
    others = tcs.live_tasks_of(db, user, column.id)
    others.insert(min(task.position, len(others)), task)
    task.deleted_at = None
    db.flush()
    set_positions(db, others, moved=task)
    return one_out(db, task)


def purge_expired(db: Session) -> None:
    """Startup: hard-delete tasks and quick notes soft-deleted more than 24 h ago (checklist
    items and quick notes go with their task)."""
    cutoff = undo_cutoff()
    db.execute(
        delete(TaskQuickNote).where(
            TaskQuickNote.deleted_at.is_not(None), TaskQuickNote.deleted_at < cutoff
        )
    )
    expired = select(Task.id).where(Task.deleted_at.is_not(None), Task.deleted_at < cutoff)
    db.execute(delete(TaskQuickNote).where(TaskQuickNote.task_id.in_(expired)))
    db.execute(delete(TaskChecklistItem).where(TaskChecklistItem.task_id.in_(expired)))
    db.execute(delete(Task).where(Task.deleted_at.is_not(None), Task.deleted_at < cutoff))
    db.commit()


# ---- CSV export (US7, research R19) ------------------------------------------------------

CSV_HEADER = (
    "Title",
    "Description",
    "Column",
    "Due date",
    "Due time",
    "Course",
    "Linked event",
    "Checklist",
    "Quick notes",
    "Completed at",
)


def export_filename(user: User) -> str:
    from zoneinfo import ZoneInfo

    from unihelper.services.calendar_export_service import APP

    today = datetime.now(UTC).astimezone(ZoneInfo(user.timezone)).date().isoformat()
    return f"{APP}-tasks-{today}.csv"


def checklist_cell(items: Sequence[tuple[str, bool]]) -> str:
    """One line per item: `[x] text` / `[ ] text`."""
    return "\n".join(f"[{'x' if done else ' '}] {text}" for text, done in items)


def quick_notes_cell(notes: Sequence[tuple[str, str]]) -> str:
    """`Title: text` blocks separated by blank lines (a missing title or text is left out)."""
    blocks = [f"{title}: {body}" if title and body else (title or body) for title, body in notes]
    return "\n\n".join(blocks)


def csv_bytes(rows: Iterable[Sequence[str]]) -> bytes:
    """Header + rows as RFC 4180 CSV (quoted when needed, CRLF line ends), UTF-8 with a BOM so
    spreadsheet programs read non-ASCII text correctly."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    writer.writerows(rows)
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def export_csv(db: Session, user: User) -> bytes:
    """Every live task in board order (`GET /tasks/export`)."""
    columns = {c.id: c for c in tcs.ensure_columns(db, user)}
    tasks = list(
        db.scalars(
            select(Task)
            .join(TaskColumn, TaskColumn.id == Task.column_id)
            .where(Task.user_id == user.id, Task.is_live)
            .order_by(TaskColumn.position, Task.position, Task.created_at)
        )
    )
    ids = [t.id for t in tasks]
    course_ids = {t.course_id for t in tasks if t.course_id}
    courses = (
        {c.id: c.name for c in db.scalars(select(Course).where(Course.id.in_(course_ids)))}
        if course_ids
        else {}
    )
    checklists: dict[str, list[tuple[str, bool]]] = {}
    notes: dict[str, list[tuple[str, str]]] = {}
    if ids:
        for item in db.scalars(
            select(TaskChecklistItem)
            .where(TaskChecklistItem.task_id.in_(ids))
            .order_by(TaskChecklistItem.position)
        ):
            checklists.setdefault(item.task_id, []).append((item.text, item.done))
        for note in db.scalars(
            select(TaskQuickNote)
            .where(TaskQuickNote.task_id.in_(ids), TaskQuickNote.deleted_at.is_(None))
            .order_by(TaskQuickNote.created_at, TaskQuickNote.id)
        ):
            notes.setdefault(note.task_id, []).append((note.title, note.body))

    def row(t: Task) -> tuple[str, ...]:
        linked = ""
        if t.event_key is not None:
            event = _event_out(t)
            linked = f"{t.title} ({event['date'].isoformat()})" if event else t.title
        return (
            t.title,
            t.description,
            columns[t.column_id].name if t.column_id in columns else "",
            t.due_date.isoformat() if t.due_date else "",
            _hhmm(t.due_time) or "",
            courses.get(t.course_id, "") if t.course_id else "",
            linked,
            checklist_cell(checklists.get(t.id, [])),
            quick_notes_cell(notes.get(t.id, [])),
            t.completed_at or "",
        )

    return csv_bytes(row(t) for t in tasks)
