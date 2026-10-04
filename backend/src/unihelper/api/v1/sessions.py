from __future__ import annotations

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Query

from unihelper.api.deps import CurrentUser, DbSession, IfMatch
from unihelper.schemas.classes import ScopeResult, SessionEdit, SessionOut
from unihelper.services import class_service, session_folder_service, session_query

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionOut])
def list_sessions(
    user: CurrentUser,
    db: DbSession,
    range_from: date = Query(alias="from"),
    range_to: date = Query(alias="to"),
    course_id: str | None = Query(default=None, alias="courseId"),
) -> Any:
    return session_query.list_sessions(db, user, range_from, range_to, course_id)


@router.get("/{session_key}", response_model=SessionOut)
def get_session(session_key: str, user: CurrentUser, db: DbSession) -> Any:
    # scheduled sessions, or (002) unscheduled ones that still have content
    return session_folder_service.resolve(db, user, session_key).session


@router.patch("/{session_key}", response_model=ScopeResult)
def edit_session(
    session_key: str,
    body: SessionEdit,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    scope: Literal["this", "following", "all"] = Query(),
) -> Any:
    return class_service.apply_scope_edit(db, user, session_key, scope, body, version)


@router.delete("/{session_key}", response_model=ScopeResult)
def delete_session(
    session_key: str,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    scope: Literal["this", "following", "all"] = Query(),
) -> Any:
    return class_service.apply_scope_delete(db, user, session_key, scope, version)
