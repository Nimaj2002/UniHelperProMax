"""Settings → Trash (009 US4): list, restore and permanently delete deleted classes/events."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query, Response, status

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage
from unihelper.schemas.trash import RestoreResult, TrashEntryOut
from unihelper.services import trash_service

router = APIRouter(prefix="/trash", tags=["trash"])


@router.get("", response_model=list[TrashEntryOut])
def list_trash(
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    kind: Literal["class", "event"] | None = Query(default=None),
) -> Any:
    return trash_service.list_entries(db, storage, user, kind)


@router.post("/{entry_id}/restore", response_model=RestoreResult)
def restore(
    entry_id: str, version: IfMatch, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    return trash_service.restore(db, storage, user, entry_id, version)


@router.delete(
    "/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={500: {"description": "Some files could not be removed (entry kept)"}},
)
def purge(
    entry_id: str, version: IfMatch, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    """Permanent: the entry, its notes, recordings and documents, and their folders on disk."""
    trash_service.purge(db, storage, user, entry_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
