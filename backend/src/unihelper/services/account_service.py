"""Owner-only account management (FR-003b). Exposes account fields only (FR-003c)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.models import User
from unihelper.models.base import now_iso
from unihelper.services import auth_service
from unihelper.storage.storage_service import StorageService


def account_view(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "disabled": u.disabled_at is not None,
        "must_change_password": u.must_change_password,
        "created_at": u.created_at,
    }


def list_accounts(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.role.desc(), User.created_at)))


def _member(db: Session, user_id: str) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise not_found("Account")
    if u.is_owner:
        raise ApiError(
            422,
            "cannot_modify_owner",
            "The owner account can't be disabled, deleted, or reset here.",
        )
    return u


def create_member(
    db: Session, storage: StorageService, username: str, password: str, timezone: str | None
) -> User:
    return auth_service.create_member(db, storage, username, password, timezone)


def set_disabled(db: Session, user_id: str, disabled: bool) -> User:
    u = _member(db, user_id)
    u.disabled_at = now_iso() if disabled else None
    if disabled:
        auth_service.revoke_sessions(db, u.id)
    return u


def delete_member(db: Session, storage: StorageService, user_id: str) -> str:
    """Deletes metadata (cascade); the user's storage folder is kept (Principle I)."""
    u = _member(db, user_id)
    kept = u.username
    db.delete(u)
    return kept


def reset_password(db: Session, user_id: str, new_password: str) -> None:
    u = _member(db, user_id)
    auth_service.validate_password(new_password, u.username)
    u.password_hash = auth_service.hash_password(new_password)
    u.must_change_password = True
    auth_service.revoke_sessions(db, u.id)
