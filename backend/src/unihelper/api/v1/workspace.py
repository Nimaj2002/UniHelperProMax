from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from unihelper.api.deps import CurrentUser, DbSession
from unihelper.schemas.notes import Preferences, WorkspaceState
from unihelper.services import workspace_service

router = APIRouter(tags=["workspace"])


@router.get("/workspace/{session_key}", response_model=WorkspaceState)
def get_workspace(session_key: str, user: CurrentUser, db: DbSession) -> Any:
    return workspace_service.get_state(db, user, session_key)


@router.put("/workspace/{session_key}", response_model=WorkspaceState)
def put_workspace(session_key: str, body: WorkspaceState, user: CurrentUser, db: DbSession) -> Any:
    return workspace_service.put_state(db, user, session_key, body)


@router.get("/preferences", response_model=Preferences)
def get_preferences(user: CurrentUser, db: DbSession) -> Any:
    return workspace_service.get_preferences(db, user)


@router.patch("/preferences", response_model=Preferences)
def patch_preferences(body: Preferences, user: CurrentUser, db: DbSession) -> Any:
    return workspace_service.patch_preferences(db, user, body.model_dump())
