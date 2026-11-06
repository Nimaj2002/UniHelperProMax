from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from unihelper.api.deps import (
    SESSION_COOKIE,
    CurrentAuth,
    DbSession,
    NotInDesktop,
    clear_auth_cookies,
    get_settings,
    set_auth_cookies,
)
from unihelper.api.errors import ApiError
from unihelper.schemas.auth import LoginRequest, Me, PasswordChange, ProfileUpdate
from unihelper.services import auth_service
from unihelper.services.login_throttle import LoginThrottle

router = APIRouter(prefix="/auth", tags=["auth"])


def _throttle(request: Request) -> LoginThrottle:
    throttle: LoginThrottle = request.app.state.login_throttle
    return throttle


@router.post("/login", response_model=Me, dependencies=[NotInDesktop])
def login(body: LoginRequest, request: Request, response: Response, db: DbSession) -> Me:
    throttle = _throttle(request)
    ip = request.client.host if request.client else "unknown"
    wait = throttle.retry_after(body.username, ip)
    if wait:
        raise ApiError(
            429,
            "too_many_attempts",
            "Too many sign-in attempts. Wait a moment and try again.",
            headers={"Retry-After": str(wait)},
        )
    try:
        issued = auth_service.login(db, body.username, body.password)
    except ApiError:
        throttle.failure(body.username, ip)
        raise
    throttle.success(body.username, ip)
    set_auth_cookies(response, get_settings(request), issued)
    return Me.model_validate(issued.user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[NotInDesktop])
def logout(request: Request, db: DbSession) -> Response:
    auth_service.logout(db, request.cookies.get(SESSION_COOKIE))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_auth_cookies(response)
    return response


@router.get("/me", response_model=Me)
def me(auth: CurrentAuth) -> Me:
    return Me.model_validate(auth.user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[NotInDesktop])
def change_password(body: PasswordChange, auth: CurrentAuth, db: DbSession) -> Response:
    auth_service.change_password(
        db, auth.user, body.current_password, body.new_password, keep_session_id=auth.session.id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/profile", response_model=Me)
def update_profile(body: ProfileUpdate, auth: CurrentAuth) -> Me:
    auth_service.update_profile(auth.user, body.timezone)
    return Me.model_validate(auth.user)
