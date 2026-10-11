"""Calendar import and export (010): stage an .ics file and preview it, apply a plan, discard,
undo a run, and download the calendar as one .ics file."""

from __future__ import annotations

from typing import Annotated, Any
from urllib.parse import quote

import anyio
from fastapi import APIRouter, Query, Request, Response, status

from unihelper.api import uploads
from unihelper.api.deps import CurrentUser, DbSession, Storage
from unihelper.api.errors import ApiError
from unihelper.models.calendar_import import MAX_ICS_BYTES
from unihelper.schemas.calendar_io import ImportPlan, ImportPreview, ImportResult, UndoResult
from unihelper.services import calendar_export_service as export_svc
from unihelper.services import calendar_import_service as svc
from unihelper.services import calendar_import_undo

router = APIRouter(tags=["calendar-io"])

WHAT = "A calendar file"


@router.post("/calendar-imports", response_model=ImportPreview, status_code=status.HTTP_201_CREATED)
async def upload_calendar(
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    file_name: Annotated[str, Query(alias="fileName", min_length=1, max_length=255)],
) -> Any:
    """Stream an .ics file into staging, check it and return the preview (research R2, R3).
    Nothing in the calendar changes until the plan is applied."""
    length = uploads.declared_length(request, MAX_ICS_BYTES, WHAT)
    if length == 0:
        raise ApiError(422, "file_empty", "This file is empty.")
    staged = await uploads.receive_upload(request, storage, length, MAX_ICS_BYTES, WHAT)
    try:
        upload = await anyio.to_thread.run_sync(
            svc.register_upload, db, storage, user, staged, file_name
        )
        return await anyio.to_thread.run_sync(svc.preview, db, storage, user, upload)
    except BaseException:
        await anyio.to_thread.run_sync(storage.discard_upload, staged.path)
        raise


@router.delete("/calendar-imports/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_upload(upload_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Response:
    svc.discard(db, storage, user, upload_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/calendar-imports/{upload_id}/apply", response_model=ImportResult)
def apply_import(
    upload_id: str, body: ImportPlan, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    upload = svc.get_upload(db, user, upload_id)
    return svc.apply(db, storage, user, upload, body)


@router.post("/calendar-imports/runs/{run_id}/undo", response_model=UndoResult)
def undo_import(run_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return calendar_import_undo.undo_run(db, storage, user, run_id)


@router.get(
    "/calendar-export",
    response_class=Response,
    responses={200: {"content": {"text/calendar": {}}}},
)
def export_calendar(
    user: CurrentUser,
    db: DbSession,
    semester_id: Annotated[str | None, Query(alias="semesterId")] = None,
) -> Response:
    data, filename, counts = export_svc.export(db, user, semester_id)
    return Response(
        content=data,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            ),
            "X-Export-Counts": f"classes={counts['class']}; events={counts['event']}",
            "Cache-Control": "no-store",
        },
    )
