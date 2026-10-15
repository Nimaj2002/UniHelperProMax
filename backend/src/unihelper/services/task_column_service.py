"""Task board columns (012): seeding, create/rename, reorder, counts-as-done, delete."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.domain.naming import name_key, normalize_display
from unihelper.models import Task, TaskColumn, User
from unihelper.models.base import now_iso

MAX_COLUMNS = 12
MAX_NAME = 40
DEFAULT_COLUMNS = (("To do", False), ("In progress", False), ("Done", True))
NAME_RULE = "Column names are required, unique (ignoring case), up to 40 characters."


# ---- lookups -----------------------------------------------------------------------------


def _columns(db: Session, user: User) -> list[TaskColumn]:
    return list(
        db.scalars(
            select(TaskColumn).where(TaskColumn.user_id == user.id).order_by(TaskColumn.position)
        )
    )


def ensure_columns(db: Session, user: User) -> list[TaskColumn]:
    """The user's columns in order; seeds To do / In progress / Done on first use."""
    cols = _columns(db, user)
    if cols:
        return cols
    # a concurrent first request may seed at the same time: its rows win, ours are skipped
    db.execute(
        sqlite_insert(TaskColumn)
        .values(
            [
                {
                    "user_id": user.id,
                    "name": name,
                    "name_key": name_key(name),
                    "position": i,
                    "counts_as_done": done,
                }
                for i, (name, done) in enumerate(DEFAULT_COLUMNS)
            ]
        )
        .on_conflict_do_nothing()
    )
    return _columns(db, user)


def get_column(db: Session, user: User, column_id: str) -> TaskColumn:
    col = db.get(TaskColumn, column_id)
    if col is None or col.user_id != user.id:
        raise not_found("Column")
    return col


def live_tasks_of(db: Session, user: User, column_id: str) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .where(Task.user_id == user.id, Task.column_id == column_id, Task.is_live)
            .order_by(Task.position, Task.created_at)
        )
    )


def _task_counts(db: Session, user: User) -> dict[str, int]:
    rows = db.execute(
        select(Task.column_id, func.count())
        .where(Task.user_id == user.id, Task.is_live)
        .group_by(Task.column_id)
    )
    return {cid: int(n) for cid, n in rows}


def column_out(col: TaskColumn, task_count: int) -> dict[str, Any]:
    return {
        "id": col.id,
        "name": col.name,
        "position": col.position,
        "counts_as_done": col.counts_as_done,
        "task_count": task_count,
        "version": col.version,
    }


def columns_out(db: Session, user: User, cols: list[TaskColumn]) -> list[dict[str, Any]]:
    counts = _task_counts(db, user)
    return [column_out(c, counts.get(c.id, 0)) for c in cols]


def list_columns(db: Session, user: User) -> list[dict[str, Any]]:
    return columns_out(db, user, ensure_columns(db, user))


# ---- create / rename ----------------------------------------------------------------------


def _clean_name(db: Session, user: User, name: str, exclude_id: str | None = None) -> str:
    cleaned = normalize_display(name)
    if not cleaned or len(cleaned) > MAX_NAME:
        raise validation_error("/name", "validation_failed", NAME_RULE)
    key = name_key(cleaned)
    taken = db.scalar(
        select(TaskColumn.id).where(
            TaskColumn.user_id == user.id,
            TaskColumn.name_key == key,
            TaskColumn.id != (exclude_id or ""),
        )
    )
    if taken is not None:
        raise ApiError(
            409,
            "name_taken",
            "A column with this name already exists.",
            errors=[{"field": "/name", "code": "name_taken", "message": NAME_RULE}],
        )
    return cleaned


def create_column(db: Session, user: User, name: str, counts_as_done: bool) -> dict[str, Any]:
    cols = ensure_columns(db, user)
    if len(cols) >= MAX_COLUMNS:
        raise ApiError(409, "column_limit", "A board holds at most 12 columns.")
    cleaned = _clean_name(db, user, name)
    col = TaskColumn(
        user_id=user.id,
        name=cleaned,
        name_key=name_key(cleaned),
        position=len(cols),
        counts_as_done=counts_as_done,
    )
    db.add(col)
    db.flush()
    return column_out(col, 0)


def _set_done_flag(db: Session, user: User, col: TaskColumn, done: bool) -> None:
    """true → every live task of the column is completed now; false → completion cleared."""
    now = now_iso()
    for t in live_tasks_of(db, user, col.id):
        t.completed_at = (t.completed_at or now) if done else None
    col.counts_as_done = done


def patch_column(
    db: Session, user: User, col: TaskColumn, fields: dict[str, Any]
) -> dict[str, Any]:
    name = fields.get("name")
    if name is not None:
        cleaned = _clean_name(db, user, name, exclude_id=col.id)
        col.name = cleaned
        col.name_key = name_key(cleaned)
    done = fields.get("counts_as_done")
    if done is not None and done != col.counts_as_done:
        _set_done_flag(db, user, col, done)
    db.flush()
    return column_out(col, len(live_tasks_of(db, user, col.id)))


# ---- order ---------------------------------------------------------------------------------


def _renumber(db: Session, cols: list[TaskColumn]) -> None:
    """Positions 0..n-1 in list order without tripping UNIQUE(user_id, position): negative
    first, then final (hierarchy_service._renumber_years). Bulk UPDATEs, so the board order
    does not bump the columns' versions (they guard name and done flag)."""
    db.flush()
    changed = [(i, c) for i, c in enumerate(cols) if c.position != i]
    for i, c in changed:
        db.execute(update(TaskColumn).where(TaskColumn.id == c.id).values(position=-(i + 1)))
    for i, c in changed:
        db.execute(update(TaskColumn).where(TaskColumn.id == c.id).values(position=i))


def reorder_columns(db: Session, user: User, column_ids: list[str]) -> list[dict[str, Any]]:
    cols = ensure_columns(db, user)
    by_id = {c.id: c for c in cols}
    if len(column_ids) != len(set(column_ids)) or set(column_ids) != set(by_id):
        raise ApiError(
            409, "order_mismatch", "The list of columns has changed. Reload and try again."
        )
    ordered = [by_id[i] for i in column_ids]
    _renumber(db, ordered)
    return columns_out(db, user, ordered)


# ---- delete --------------------------------------------------------------------------------


def delete_column(
    db: Session, user: User, col: TaskColumn, move_to: str | None
) -> list[dict[str, Any]]:
    cols = ensure_columns(db, user)
    if len(cols) <= 1:
        raise ApiError(409, "last_column", "The board needs at least one column.")
    live = live_tasks_of(db, user, col.id)
    target: TaskColumn | None = None
    if move_to is not None:
        target = get_column(db, user, move_to)
        if target.id == col.id:
            raise validation_error(
                "/moveTo", "validation_failed", "Choose another column for its tasks."
            )
    if live and target is None:
        raise ApiError(
            409, "move_target_required", "Choose the column that receives this column's tasks."
        )
    if target is not None:
        end = len(live_tasks_of(db, user, target.id))
        now = now_iso()
        for i, t in enumerate(live):
            t.column_id = target.id
            t.position = end + i
            if target.counts_as_done:
                t.completed_at = t.completed_at or now
            else:
                t.completed_at = None
    remaining = [c for c in cols if c.id != col.id]
    # soft-deleted / trashed tasks still pointing here keep a valid column: the receiving one
    # (or the first); they are appended at the end of it when restored. Tasks in the Trash
    # with their event return to the first column (FR-043).
    home = target or remaining[0]
    for t in db.scalars(
        select(Task).where(Task.user_id == user.id, Task.column_id == col.id, ~Task.is_live)
    ):
        t.column_id = remaining[0].id if t.trash_entry_id is not None else home.id
        t.position = 1_000_000
    db.flush()
    db.delete(col)
    db.flush()
    _renumber(db, remaining)
    return columns_out(db, user, remaining)
