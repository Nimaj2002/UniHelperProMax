"""Shared request dependencies: auth, owner guard, CSRF, If-Match, cookies."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request, Response
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError
from unihelper.config import Settings
from unihelper.db.engine import get_db
from unihelper.models import AuthSession, User
from unihelper.services import auth_service
from unihelper.services.auth_service import IssuedSession
from unihelper.storage.storage_service import StorageService

SESSION_COOKIE = "uh_session"
CSRF_COOKIE = "uh_csrf"
CSRF_HEADER = "X-CSRF-Token"
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_EXEMPT_SUFFIXES = ("/setup/owner", "/auth/login")
# endpoints a user who must change their password may still call (FR-003d)
PASSWORD_CHANGE_ALLOWED_SUFFIXES = ("/auth/me", "/auth/password", "/auth/logout")

# scope="function": commit (or roll back) BEFORE the response is sent, so a client that
# gets 2xx can rely on the change being durable (FR-026, Constitution I). The default
# ("request") would commit after the response, racing the client's next request.
DbSession = Annotated[Session, Depends(get_db, scope="function")]


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_storage(request: Request) -> StorageService:
    storage: StorageService = request.app.state.storage
    return storage


Storage = Annotated[StorageService, Depends(get_storage)]


@dataclass
class Auth:
    user: User
    session: AuthSession


def _desktop_auth(request: Request, db: Session) -> Auth:
    """015 single-user mode: admission already checked the client secret (research R9)."""
    from unihelper.desktop.owner import desktop_session

    owner_id: str | None = getattr(request.app.state, "desktop_owner_id", None)
    user = db.get(User, owner_id) if owner_id else None
    if user is None:
        raise ApiError(503, "not_ready", "The app is still starting. Try again in a moment.")
    return Auth(user=user, session=desktop_session(user.id))


def _authenticate(request: Request, db: Session) -> Auth:
    if get_settings(request).desktop:
        return _desktop_auth(request, db)
    resolved = auth_service.resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if resolved is None:
        raise ApiError(401, "unauthorized", "Please sign in.")
    user, sess = resolved
    if user.must_change_password and not request.url.path.endswith(
        PASSWORD_CHANGE_ALLOWED_SUFFIXES
    ):
        raise ApiError(403, "password_change_required", "You must change your password first.")
    return Auth(user=user, session=sess)


def current_auth(request: Request, db: DbSession) -> Auth:
    return _authenticate(request, db)


def current_user(auth: Annotated[Auth, Depends(current_auth)]) -> User:
    return auth.user


CurrentUser = Annotated[User, Depends(current_user)]
CurrentAuth = Annotated[Auth, Depends(current_auth)]


def require_owner(user: CurrentUser) -> User:
    if not user.is_owner:
        raise ApiError(403, "forbidden", "Only the owner can do this.")
    return user


OwnerUser = Annotated[User, Depends(require_owner)]


def csrf_protect(request: Request) -> None:
    """Double-submit check: X-CSRF-Token header must equal the uh_csrf cookie."""
    if request.method not in MUTATING or request.url.path.endswith(CSRF_EXEMPT_SUFFIXES):
        return
    if get_settings(request).desktop:  # 015: the main process's client-secret header replaces it
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise ApiError(403, "csrf_failed", "Security check failed. Reload the page and retry.")


def not_in_desktop(request: Request) -> None:
    """015: account management does not exist in the single-user desktop app (FR-033)."""
    if get_settings(request).desktop:
        raise ApiError(404, "not_in_desktop", "Accounts are not used in the desktop app.")


NotInDesktop = Depends(not_in_desktop)


def if_match_version(if_match: Annotated[str | None, Header(alias="If-Match")] = None) -> int:
    if if_match is None:
        raise ApiError(428, "if_match_required", "This request needs an If-Match header.")
    raw = if_match.strip()
    if raw.startswith("W/"):
        raw = raw[2:]
    raw = raw.strip('"')
    try:
        return int(raw)
    except ValueError as exc:
        raise ApiError(
            400, "invalid_if_match", "If-Match must be a quoted version number."
        ) from exc


IfMatch = Annotated[int, Depends(if_match_version)]


def check_version(expected: int, actual: int) -> None:
    if expected != actual:
        raise ApiError(
            412, "version_conflict", "This item was changed elsewhere. Reload and try again."
        )


def set_auth_cookies(response: Response, settings: Settings, issued: IssuedSession) -> None:
    max_age = int(auth_service.ABSOLUTE.total_seconds())
    response.set_cookie(
        SESSION_COOKIE,
        issued.token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        issued.csrf_token,
        max_age=max_age,
        httponly=False,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
