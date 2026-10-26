from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from unihelper.api.deps import (
    DbSession,
    NotInDesktop,
    Storage,
    get_settings,
    set_auth_cookies,
)
from unihelper.schemas.auth import Me, NewAccount, SetupStatus
from unihelper.services import auth_service

router = APIRouter(prefix="/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatus)
def setup_status(request: Request, db: DbSession) -> SetupStatus:
    if get_settings(request).desktop:  # 015: the owner is created by the app itself
        return SetupStatus(needs_owner=False, mode="desktop")
    return SetupStatus(needs_owner=auth_service.needs_owner(db), mode="web")


@router.post(
    "/owner",
    response_model=Me,
    status_code=status.HTTP_201_CREATED,
    dependencies=[NotInDesktop],
)
def create_owner(
    body: NewAccount, request: Request, response: Response, db: DbSession, storage: Storage
) -> Me:
    user = auth_service.create_owner(db, storage, body.username, body.password, body.timezone)
    issued = auth_service.issue_session(db, user)
    set_auth_cookies(response, get_settings(request), issued)
    return Me.model_validate(user)
