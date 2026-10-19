"""Task board (012): columns, tasks, checklist and quick notes."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Query, Response, status

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, check_version
from unihelper.schemas.tasks import (
    ChecklistReplace,
    QuickNoteOut,
    QuickNoteWrite,
    TaskColumnCreate,
    TaskColumnOrder,
    TaskColumnOut,
    TaskColumnPatch,
    TaskCreate,
    TaskDetailOut,
    TaskMove,
    TaskOut,
    TaskPatch,
)
from unihelper.services import quick_note_service as qns
from unihelper.services import task_column_service as tcs
from unihelper.services import task_service as ts

columns_router = APIRouter(prefix="/task-columns", tags=["tasks"])
tasks_router = APIRouter(prefix="/tasks", tags=["tasks"])
notes_router = APIRouter(prefix="/quick-notes", tags=["tasks"])
routers = (columns_router, tasks_router, notes_router)


def _no_content() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- columns -----------------------------------------------------------------------------


@columns_router.get("", response_model=list[TaskColumnOut])
def list_columns(user: CurrentUser, db: DbSession) -> Any:
    return tcs.list_columns(db, user)


@columns_router.post("", response_model=TaskColumnOut, status_code=status.HTTP_201_CREATED)
def create_column(body: TaskColumnCreate, user: CurrentUser, db: DbSession) -> Any:
    return tcs.create_column(db, user, body.name, body.counts_as_done)


# PUT /task-columns/order is declared before /task-columns/{column_id}.
@columns_router.put("/order", response_model=list[TaskColumnOut])
def reorder_columns(body: TaskColumnOrder, user: CurrentUser, db: DbSession) -> Any:
    return tcs.reorder_columns(db, user, body.column_ids)


@columns_router.patch("/{column_id}", response_model=TaskColumnOut)
def patch_column(
    column_id: str, body: TaskColumnPatch, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    col = tcs.get_column(db, user, column_id)
    check_version(version, col.version)
    return tcs.patch_column(db, user, col, {k: getattr(body, k) for k in body.model_fields_set})


@columns_router.delete("/{column_id}", response_model=list[TaskColumnOut])
def delete_column(
    column_id: str,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    move_to: str | None = Query(default=None, alias="moveTo"),
) -> Any:
    col = tcs.get_column(db, user, column_id)
    check_version(version, col.version)
    return tcs.delete_column(db, user, col, move_to)


# ---- tasks -------------------------------------------------------------------------------


@tasks_router.get("", response_model=list[TaskOut])
def list_tasks(user: CurrentUser, db: DbSession) -> Any:
    return ts.list_tasks(db, user)


@tasks_router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskCreate, user: CurrentUser, db: DbSession) -> Any:
    return ts.create_task(db, user, body)


# GET /tasks/export is declared before the /tasks/{task_id} routes.
@tasks_router.get(
    "/export",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
def export_tasks(user: CurrentUser, db: DbSession) -> Response:
    filename = ts.export_filename(user)
    return Response(
        content=ts.export_csv(db, user),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "no-store",
        },
    )


@tasks_router.get("/{task_id}", response_model=TaskDetailOut)
def get_task(task_id: str, user: CurrentUser, db: DbSession) -> Any:
    return ts.detail_out(db, ts.get_task(db, user, task_id))


@tasks_router.patch("/{task_id}", response_model=TaskDetailOut)
def patch_task(
    task_id: str, body: TaskPatch, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    task = ts.get_task(db, user, task_id)
    check_version(version, task.version)
    return ts.patch_task(db, user, task, {k: getattr(body, k) for k in body.model_fields_set})


@tasks_router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, version: IfMatch, user: CurrentUser, db: DbSession) -> Response:
    task = ts.get_task(db, user, task_id)
    check_version(version, task.version)
    ts.soft_delete_task(db, user, task)
    return _no_content()


@tasks_router.post("/{task_id}/restore", response_model=TaskOut)
def restore_task(task_id: str, user: CurrentUser, db: DbSession) -> Any:
    return ts.restore_task(db, user, task_id)


@tasks_router.post("/{task_id}/move", response_model=TaskOut)
def move_task(
    task_id: str, body: TaskMove, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    task = ts.get_task(db, user, task_id)
    check_version(version, task.version)
    return ts.move_task(db, user, task, body.column_id, body.index)


@tasks_router.put("/{task_id}/checklist", response_model=TaskDetailOut)
def replace_checklist(
    task_id: str, body: ChecklistReplace, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    task = ts.get_task(db, user, task_id)
    check_version(version, task.version)
    return ts.replace_checklist(db, user, task, body.items)


# ---- quick notes -------------------------------------------------------------------------


@tasks_router.get("/{task_id}/quick-notes", response_model=list[QuickNoteOut])
def list_quick_notes(task_id: str, user: CurrentUser, db: DbSession) -> Any:
    return qns.list_notes(db, user, ts.get_task(db, user, task_id))


@tasks_router.post(
    "/{task_id}/quick-notes", response_model=QuickNoteOut, status_code=status.HTTP_201_CREATED
)
def create_quick_note(task_id: str, body: QuickNoteWrite, user: CurrentUser, db: DbSession) -> Any:
    task = ts.get_task(db, user, task_id)
    return qns.create_note(db, user, task, body.title, body.body)


@notes_router.patch("/{note_id}", response_model=QuickNoteOut)
def patch_quick_note(
    note_id: str, body: QuickNoteWrite, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    note = qns.get_note(db, user, note_id)
    check_version(version, note.version)
    return qns.patch_note(db, user, note, {k: getattr(body, k) for k in body.model_fields_set})


@notes_router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quick_note(note_id: str, version: IfMatch, user: CurrentUser, db: DbSession) -> Response:
    note = qns.get_note(db, user, note_id)
    check_version(version, note.version)
    qns.soft_delete_note(db, note)
    return _no_content()


@notes_router.post("/{note_id}/restore", response_model=QuickNoteOut)
def restore_quick_note(note_id: str, user: CurrentUser, db: DbSession) -> Any:
    return qns.restore_note(db, user, note_id)
