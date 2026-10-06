from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from unihelper.api.deps import CurrentUser, DbSession, IfMatch
from unihelper.schemas.themes import Theme, ThemeCreate, ThemeWrite
from unihelper.services import theme_service as svc

router = APIRouter(tags=["themes"])


@router.get("/themes", response_model=list[Theme])
def list_themes(user: CurrentUser, db: DbSession) -> Any:
    return svc.list_themes(db, user)


@router.post("/themes", response_model=Theme, status_code=status.HTTP_201_CREATED)
def create_theme(body: ThemeCreate, user: CurrentUser, db: DbSession) -> Any:
    return svc.create_theme(db, user, body)


@router.get("/themes/{theme_id}", response_model=Theme)
def get_theme(theme_id: str, user: CurrentUser, db: DbSession) -> Any:
    return svc.get_theme(db, user, theme_id)


@router.put("/themes/{theme_id}", response_model=Theme)
def update_theme(
    theme_id: str, body: ThemeWrite, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    return svc.update_theme(db, user, theme_id, version, body)


@router.delete("/themes/{theme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_theme(theme_id: str, version: IfMatch, user: CurrentUser, db: DbSession) -> Response:
    svc.delete_theme(db, user, theme_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
