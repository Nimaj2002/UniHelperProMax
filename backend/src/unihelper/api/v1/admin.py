from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from unihelper.api.deps import DbSession, NotInDesktop, OwnerUser, Storage
from unihelper.schemas.auth import Account, AccountUpdate, KeptFolder, NewAccount, PasswordReset
from unihelper.services import account_service as svc

# 015: no account management in the single-user desktop app (FR-033)
router = APIRouter(prefix="/admin/users", tags=["admin"], dependencies=[NotInDesktop])


@router.get("", response_model=list[Account])
def list_users(_owner: OwnerUser, db: DbSession) -> Any:
    return [svc.account_view(u) for u in svc.list_accounts(db)]


@router.post("", response_model=Account, status_code=status.HTTP_201_CREATED)
def create_user(body: NewAccount, _owner: OwnerUser, db: DbSession, storage: Storage) -> Any:
    return svc.account_view(
        svc.create_member(db, storage, body.username, body.password, body.timezone)
    )


@router.patch("/{user_id}", response_model=Account)
def update_user(user_id: str, body: AccountUpdate, _owner: OwnerUser, db: DbSession) -> Any:
    return svc.account_view(svc.set_disabled(db, user_id, body.disabled))


@router.delete("/{user_id}", response_model=KeptFolder)
def delete_user(user_id: str, _owner: OwnerUser, db: DbSession, storage: Storage) -> Any:
    return {"kept_folder": svc.delete_member(db, storage, user_id)}


@router.post("/{user_id}/password-reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: str, body: PasswordReset, _owner: OwnerUser, db: DbSession) -> Response:
    svc.reset_password(db, user_id, body.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
