from __future__ import annotations

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Body, Query
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage
from unihelper.domain.recurrence import parse_session_key
from unihelper.schemas.classes import ScopeResult, SessionEdit, SessionOut
from unihelper.schemas.events import EventEdit
from unihelper.schemas.trash import SessionDeletionImpact
from unihelper.services import (
    class_service,
    event_service,
    lineage,
    session_folder_service,
    session_query,
    task_link_service,
    trash_service,
)
from unihelper.services.task_link_service import LinkedTasks

router = APIRouter(prefix="/sessions", tags=["sessions"])

Scope = Literal["this", "following", "all"]


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
    session = dict(session_folder_service.resolve(db, user, session_key).session)
    if session.get("kind") == "event":  # 012: its live linked task
        session["task_id"] = task_link_service.task_ids_for_keys(db, user, [session["key"]]).get(
            session["key"]
        )
    return session


def _validated(model: type[SessionEdit] | type[EventEdit], raw: dict[str, Any]) -> Any:
    try:
        return model.model_validate(raw)
    except ValidationError as err:
        raise RequestValidationError(
            [{**e, "loc": ("body", *e["loc"])} for e in err.errors()]
        ) from err


@router.patch("/{session_key}", response_model=ScopeResult)
def edit_session(
    session_key: str,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    body: SessionEdit | EventEdit = Body(),
    scope: Scope = Query(),
) -> Any:
    """`SessionEdit` for a class session, (009) `EventEdit` for an event occurrence. The
    union only documents both shapes: the body is validated again against the key's kind."""
    raw = body.model_dump(exclude_unset=True, by_alias=True, mode="json")
    parsed = parse_session_key(session_key)
    if parsed is not None and lineage.kind_of(db, user, parsed[0]) == "event":
        edit = _validated(EventEdit, raw)
        return event_service.apply_scope_edit(db, storage, user, session_key, scope, edit, version)
    return class_service.apply_scope_edit(
        db, user, session_key, scope, _validated(SessionEdit, raw), version
    )


@router.delete("/{session_key}", response_model=ScopeResult)
def delete_session(
    session_key: str,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    scope: Scope = Query(),
    linked_tasks: LinkedTasks = Query(default="keep", alias="linkedTasks"),
) -> Any:
    """Classes and (009) events: what the scope removes moves to the Trash (no file touched).
    012: `linkedTasks=delete` puts the occurrences' linked tasks into the same Trash entry."""
    return trash_service.move_to_trash(db, user, session_key, scope, version, linked_tasks)


@router.get("/{session_key}/deletion-impact", response_model=SessionDeletionImpact)
def deletion_impact(
    session_key: str, user: CurrentUser, db: DbSession, scope: Scope = Query()
) -> Any:
    return trash_service.deletion_impact(db, user, session_key, scope)
