from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from unihelper.api.deps import DbSession, Storage, get_settings, set_auth_cookies
from unihelper.schemas.auth import Me, NewAccount, SetupStatus
from unihelper.services import auth_service

router = APIRouter(prefix="/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatus)
def setup_status(db: DbSession) -> SetupStatus:
    return SetupStatus(needs_owner=auth_service.needs_owner(db))


@router.post("/owner", response_model=Me, status_code=status.HTTP_201_CREATED)
def create_owner(
    body: NewAccount, request: Request, response: Response, db: DbSession, storage: Storage
) -> Me:
    user = auth_service.create_owner(db, storage, body.username, body.password, body.timezone)
    issued = auth_service.issue_session(db, user)
    set_auth_cookies(response, get_settings(request), issued)
    return Me.model_validate(user)
