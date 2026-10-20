"""014 secret store status and reset (FR-065, FR-068)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from unihelper.api.deps import CurrentUser, DbSession, OwnerUser
from unihelper.api.errors import ApiError
from unihelper.schemas.ai import SecretReset, SecretStoreStatus
from unihelper.secrets.store import SecretStore

router = APIRouter(tags=["ai"])


def _store(request: Request) -> SecretStore:
    store: SecretStore = request.app.state.secrets
    return store


@router.get("/secrets/status", response_model=SecretStoreStatus)
def status(request: Request, user: CurrentUser, db: DbSession) -> Any:
    return _store(request).status(db)


@router.post("/secrets/reset", response_model=SecretStoreStatus)
def reset(body: SecretReset, request: Request, user: OwnerUser, db: DbSession) -> Any:
    store = _store(request)
    if store.readable:
        raise ApiError(409, "store_readable", "Saved keys can be read; there is nothing to reset.")
    store.reset(db)
    return store.status(db)
