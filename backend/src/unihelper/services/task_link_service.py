"""Tasks linked to event occurrences (012 US5, research R4/R5).

A linked task stores the occurrence's session key (`"{lineage_id}:{original_date}"`) and caches
its title, effective date (moved date if moved) and start time. The cache is refreshed on write:
`sync_lineage` runs after every event mutation. An occurrence that is no longer generated (and
not in the Trash) unlinks its task, which keeps its last title and date.

Deleting an occurrence, series or year/semester/course either unlinks its tasks (`keep`) or flags
them with the Trash entry the deletion created (`delete`); restoring the entry clears the flag,
purging it deletes them with their checklist and quick notes.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import ColumnElement, delete, false, func, or_, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.domain.recurrence import parse_session_key
from unihelper.models import Task, TaskChecklistItem, TaskColumn, TaskQuickNote, User
from unihelper.models.base import now_iso

LinkedTasks = Literal["keep", "delete"]


# ---- occurrences -----------------------------------------------------------------------------


def _not_an_event() -> ApiError:
    return ApiError(
        422,
        "not_an_event",
        "Only event occurrences can be linked to a task.",
        errors=[
            {
                "field": "/eventKey",
                "code": "not_an_event",
                "message": "Only event occurrences can be linked to a task.",
            }
        ],
    )


def _find(db: Session, user: User, key: str) -> dict[str, Any] | None:
    """The event occurrence's calendar row, or None when no segment or frozen occurrence
    shows it any more (or its folder is in the Trash)."""
    from unihelper.services import session_query

    parsed = parse_session_key(key)
    if parsed is None:
        return None
    try:
        view = session_query.find_event_session(db, user, key)[0]
    except ApiError as err:
        if err.status != 404:
            raise
        return None
    if key in session_query.trashed_keys(db, user, [parsed[0]]):
        return None
    return view


def occurrence_view(db: Session, user: User, key: str) -> dict[str, Any]:
    """The event occurrence a task links to: 404 `not_found` when unknown, 422 `not_an_event`
    for a class session."""
    from unihelper.services import lineage as lineage_mod

    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Event")
    kind = lineage_mod.kind_of(db, user, parsed[0])
    if kind == "class":
        raise _not_an_event()
    view = _find(db, user, key) if kind == "event" else None
    if view is None:
        raise not_found("Event")
    return view


def cached_values(view: dict[str, Any]) -> dict[str, Any]:
    """title / due_date / due_time a linked task takes from its occurrence row."""
    return {
        "title": str(view["title"])[:200],
        "due_date": view["date"],
        "due_time": datetime.fromisoformat(view["start"]).time().replace(tzinfo=None),
    }


# ---- queries ---------------------------------------------------------------------------------


def _prefix(lineage_id: str) -> ColumnElement[bool]:
    return Task.event_key.startswith(f"{lineage_id}:", autoescape=True)


def _of_lineages(lineage_ids: Iterable[str]) -> ColumnElement[bool]:
    ids = list(lineage_ids)
    return or_(*(_prefix(i) for i in ids)) if ids else false()


def _live_linked(db: Session, user: User, where: ColumnElement[bool]) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .where(Task.user_id == user.id, Task.event_key.is_not(None), Task.is_live, where)
            .order_by(Task.column_id, Task.position)
        )
    )


def _where(keys: Sequence[str] | None, lineage_ids: Sequence[str] | None) -> ColumnElement[bool]:
    conds: list[ColumnElement[bool]] = []
    if keys:
        conds.append(Task.event_key.in_(list(keys)))
    if lineage_ids:
        conds.append(_of_lineages(lineage_ids))
    return or_(*conds) if conds else false()


def linked_count(
    db: Session,
    user: User,
    keys: Sequence[str] | None = None,
    lineage_ids: Sequence[str] | None = None,
) -> int:
    """Live tasks linked to these occurrences (or to any occurrence of these lineages)."""
    where = _where(keys, lineage_ids)
    return int(
        db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.user_id == user.id, Task.event_key.is_not(None), Task.is_live, where)
        )
        or 0
    )


def task_ids_for_keys(db: Session, user: User, keys: Iterable[str]) -> dict[str, str]:
    """Session key → id of its live linked task (one query)."""
    wanted = list(set(keys))
    if not wanted:
        return {}
    return {
        k: tid
        for k, tid in db.execute(
            select(Task.event_key, Task.id).where(
                Task.user_id == user.id, Task.event_key.in_(wanted), Task.is_live
            )
        )
        if k is not None
    }


def has_live_task(db: Session, user: User, key: str, exclude_id: str | None = None) -> bool:
    stmt = select(Task.id).where(Task.user_id == user.id, Task.event_key == key, Task.is_live)
    if exclude_id is not None:
        stmt = stmt.where(Task.id != exclude_id)
    return db.scalar(stmt.limit(1)) is not None


# ---- sync on write ---------------------------------------------------------------------------


def sync_lineage(db: Session, user: User, lineage_id: str) -> None:
    """Refresh the cached title / date / time of the lineage's linked live tasks; a task whose
    occurrence is gone (no longer generated, not in the Trash) is unlinked and keeps its last
    values. Only changed tasks are written (and get a new version)."""
    tasks = _live_linked(db, user, _prefix(lineage_id))
    if not tasks:
        return
    for t in tasks:
        assert t.event_key is not None
        view = _find(db, user, t.event_key)
        if view is None:
            t.event_key = None
            continue
        for col, value in cached_values(view).items():
            if getattr(t, col) != value:
                setattr(t, col, value)
    db.flush()


# ---- deletion ---------------------------------------------------------------------------------


def unlink(
    db: Session,
    user: User,
    keys: Sequence[str] | None = None,
    lineage_ids: Sequence[str] | None = None,
) -> int:
    """`linkedTasks=keep`: the tasks stay as normal tasks with their last title and date."""
    tasks = _live_linked(db, user, _where(keys, lineage_ids))
    for t in tasks:
        t.event_key = None
    db.flush()
    return len(tasks)


def trash_linked(
    db: Session,
    user: User,
    entry_id: str,
    keys: Sequence[str] | None = None,
    lineage_ids: Sequence[str] | None = None,
) -> int:
    """`linkedTasks=delete`: the tasks go into the deletion's Trash entry (hidden everywhere);
    they keep their column and position for the restore."""
    from unihelper.services import task_service

    tasks = _live_linked(db, user, _where(keys, lineage_ids))
    columns = {t.column_id for t in tasks}
    for t in tasks:
        t.trash_entry_id = entry_id
    db.flush()
    for column_id in columns:
        task_service.renumber_column(db, user, column_id)
    return len(tasks)


def apply_choice(
    db: Session,
    user: User,
    choice: LinkedTasks,
    entry_id: str | None,
    keys: Sequence[str] | None = None,
    lineage_ids: Sequence[str] | None = None,
) -> None:
    if choice == "delete" and entry_id is not None:
        trash_linked(db, user, entry_id, keys=keys, lineage_ids=lineage_ids)
    else:
        unlink(db, user, keys=keys, lineage_ids=lineage_ids)


def entry_task_count(db: Session, entry_id: str) -> int:
    return int(
        db.scalar(select(func.count()).select_from(Task).where(Task.trash_entry_id == entry_id))
        or 0
    )


def restore_for_entry(db: Session, user: User, entry_id: str) -> None:
    """Restoring the Trash entry brings its tasks back, linked again: at their position in
    their column (the first column when theirs is gone), restored unlinked when the occurrence
    got another task meanwhile. Must run before the entry row is deleted."""
    from unihelper.services import task_column_service as tcs
    from unihelper.services import task_service

    tasks = list(
        db.scalars(
            select(Task)
            .where(Task.user_id == user.id, Task.trash_entry_id == entry_id)
            .order_by(Task.position, Task.created_at)
        )
    )
    if not tasks:
        return
    first = tcs.ensure_columns(db, user)[0]
    by_column: dict[str, list[Task]] = {}
    for t in tasks:
        column = db.get(TaskColumn, t.column_id)
        if column is None or column.user_id != user.id:  # pragma: no cover - FK keeps it valid
            t.column_id = first.id
            t.position = 1_000_000
            column = first
        if t.event_key is not None and has_live_task(db, user, t.event_key, exclude_id=t.id):
            t.event_key = None
        if column.counts_as_done:
            t.completed_at = t.completed_at or now_iso()
        else:
            t.completed_at = None
        by_column.setdefault(column.id, []).append(t)
    for column_id, restored in by_column.items():
        others = tcs.live_tasks_of(db, user, column_id)
        for t in restored:
            others.insert(min(t.position, len(others)), t)
            t.trash_entry_id = None
        db.flush()
        task_service.set_positions(db, others)


def delete_tasks(db: Session, where: ColumnElement[bool]) -> None:
    """Hard delete with checklist items and quick notes (explicitly: FK actions are not
    relied on)."""
    ids = select(Task.id).where(where)
    db.execute(delete(TaskQuickNote).where(TaskQuickNote.task_id.in_(ids)))
    db.execute(delete(TaskChecklistItem).where(TaskChecklistItem.task_id.in_(ids)))
    db.execute(delete(Task).where(where))


def purge_for_entry(db: Session, user: User, entry_id: str) -> None:
    """Permanently deleting the Trash entry deletes its tasks. Before the entry row goes."""
    delete_tasks(db, (Task.user_id == user.id) & (Task.trash_entry_id == entry_id))


def delete_for_lineage(db: Session, user: User, lineage_id: str) -> None:
    """`/creations/undo` of an event: the task `addToBoard` made goes with it."""
    delete_tasks(db, (Task.user_id == user.id) & _prefix(lineage_id))
