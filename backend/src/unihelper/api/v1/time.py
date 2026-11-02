"""Time tracking (020): the running timer, time entries and tags."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response, status
from pydantic import AwareDatetime

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, check_version
from unihelper.schemas.time_tracking import (
    EntryCreate,
    EntryOut,
    EntryPatch,
    EntryWithOverlaps,
    TagCreate,
    TagOut,
    TagPatch,
    TimerAt,
    TimerPatch,
    TimerResponse,
    TimerSetEnd,
    TimerStart,
    TimerUndo,
)
from unihelper.services import time_service as ts

router = APIRouter(prefix="/time", tags=["time"])


def _set(body: Any) -> dict[str, Any]:
    return {k: getattr(body, k) for k in body.model_fields_set}


# ---- timer -----------------------------------------------------------------------------------


@router.get("/timer", response_model=TimerResponse)
def get_timer(user: CurrentUser, db: DbSession) -> Any:
    return ts.read(db, user)


@router.post("/timer/start", response_model=TimerResponse, status_code=status.HTTP_201_CREATED)
def start_timer(body: TimerStart, user: CurrentUser, db: DbSession) -> Any:
    return ts.start(db, user, body.model_dump())


@router.post("/timer/stop", response_model=TimerResponse)
def stop_timer(
    version: IfMatch, user: CurrentUser, db: DbSession, body: TimerAt | None = None
) -> Any:
    return ts.stop(db, user, version, body.at if body else None)


@router.post("/timer/set-end", response_model=TimerResponse)
def set_end(body: TimerSetEnd, version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.set_end(db, user, version, body.ended_at)


@router.post("/timer/pause", response_model=TimerResponse)
def pause_timer(
    version: IfMatch, user: CurrentUser, db: DbSession, body: TimerAt | None = None
) -> Any:
    return ts.pause(db, user, version, body.at if body else None)


@router.post("/timer/resume", response_model=TimerResponse)
def resume_timer(version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.resume(db, user, version)


@router.post("/timer/advance", response_model=TimerResponse)
def advance_timer(version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.advance(db, user, version)


@router.post("/timer/skip", response_model=TimerResponse)
def skip_phase(version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.skip(db, user, version)


@router.post("/timer/reset", response_model=TimerResponse)
def reset_cycle(version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.reset(db, user, version)


@router.post("/timer/extend", response_model=TimerResponse)
def extend_focus(version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.extend(db, user, version)


@router.patch("/timer", response_model=TimerResponse)
def patch_timer(body: TimerPatch, version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return ts.patch_timer(db, user, version, _set(body))


@router.post("/timer/undo", response_model=TimerResponse)
def undo_timer(body: TimerUndo, user: CurrentUser, db: DbSession) -> Any:
    return ts.undo(db, user, body.model_dump())


# ---- entries ---------------------------------------------------------------------------------


@router.get("/entries", response_model=list[EntryOut])
def list_entries(
    user: CurrentUser,
    db: DbSession,
    start: AwareDatetime = Query(alias="from"),
    end: AwareDatetime = Query(alias="to"),
    session_key: str | None = Query(default=None, alias="sessionKey"),
) -> Any:
    return ts.list_entries(db, user, start, end, session_key)


# GET /time/entries/export.csv is declared before the /time/entries/{entry_id} routes.
@router.get(
    "/entries/export.csv", response_class=Response, responses={200: {"content": {"text/csv": {}}}}
)
def export_entries(
    user: CurrentUser,
    db: DbSession,
    start: AwareDatetime = Query(alias="from"),
    end: AwareDatetime = Query(alias="to"),
    tz: str = Query(max_length=64),
) -> Response:
    return Response(
        content=ts.export_csv(db, user, start, end, tz),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="time-entries.csv"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/entries", response_model=EntryWithOverlaps, status_code=status.HTTP_201_CREATED)
def create_entry(body: EntryCreate, user: CurrentUser, db: DbSession) -> Any:
    return ts.create_entry(db, user, body.model_dump())


@router.patch("/entries/{entry_id}", response_model=EntryWithOverlaps)
def patch_entry(
    entry_id: str, body: EntryPatch, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    e = ts.get_entry(db, user, entry_id)
    check_version(version, e.version)
    return ts.patch_entry(db, user, e, _set(body))


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: str, user: CurrentUser, db: DbSession) -> Response:
    ts.delete_entry(db, ts.get_entry(db, user, entry_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/entries/{entry_id}/restore", response_model=EntryOut)
def restore_entry(entry_id: str, user: CurrentUser, db: DbSession) -> Any:
    return ts.restore_entry(db, ts.get_entry(db, user, entry_id, deleted=True))


# ---- tags ------------------------------------------------------------------------------------


@router.get("/tags", response_model=list[TagOut])
def list_tags(user: CurrentUser, db: DbSession) -> Any:
    return ts.list_tags(db, user)


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, user: CurrentUser, db: DbSession) -> Any:
    return ts.create_tag(db, user, body.name, body.color)


@router.patch("/tags/{tag_id}", response_model=TagOut)
def patch_tag(
    tag_id: str, body: TagPatch, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    t = ts.get_tag(db, user, tag_id)
    check_version(version, t.version)
    return ts.patch_tag(db, user, t, _set(body))


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: str, user: CurrentUser, db: DbSession) -> Response:
    ts.delete_tag(db, user, ts.get_tag(db, user, tag_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
