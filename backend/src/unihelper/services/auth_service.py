"""Owner setup, sign-in sessions, and password handling (research R3)."""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import available_timezones

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, validation_error
from unihelper.models import AuthSession, User
from unihelper.models.base import now_iso
from unihelper.models.user import ROLE_MEMBER, ROLE_OWNER
from unihelper.storage.storage_service import StorageService

SLIDING = timedelta(days=30)
ABSOLUTE = timedelta(days=90)
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
MIN_PASSWORD = 10

_hasher = PasswordHasher()
# verified against when the username is unknown, to keep timing uniform
_DUMMY_HASH = _hasher.hash("unihelper-dummy-password")


@dataclass
class IssuedSession:
    token: str
    csrf_token: str
    user: User


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def validate_username(username: str) -> str:
    if not USERNAME_RE.fullmatch(username):
        raise validation_error(
            "/username",
            "invalid_username",
            "Username must be 3–32 characters: lowercase letters, digits, '.', '_' or '-'.",
        )
    return username


def validate_password(password: str, username: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise validation_error(
            "/password", "weak_password", f"Password must be at least {MIN_PASSWORD} characters."
        )
    if password.casefold() == username.casefold():
        raise validation_error(
            "/password", "weak_password", "Password must not be the same as the username."
        )


def validate_timezone(tz: str, field: str = "/timezone") -> str:
    if tz not in available_timezones() and tz != "UTC":
        raise validation_error(field, "invalid_timezone", "Unknown time zone.")
    return tz


def needs_owner(db: Session) -> bool:
    return db.scalar(select(func.count()).select_from(User)) == 0


def create_user(
    db: Session,
    storage: StorageService,
    *,
    username: str,
    password: str,
    role: str,
    timezone: str | None,
    must_change_password: bool,
) -> User:
    username = validate_username(username.strip().lower())
    validate_password(password, username)
    tz = validate_timezone(timezone) if timezone else "UTC"
    if db.scalar(select(User).where(User.username == username)) is not None:
        raise validation_error("/username", "name_taken", "This username is already taken.", 409)
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=role,
        timezone=tz,
        must_change_password=must_change_password,
    )
    db.add(user)
    db.flush()
    storage.ensure_dir([username])
    return user


def create_owner(
    db: Session, storage: StorageService, username: str, password: str, timezone: str | None
) -> User:
    if not needs_owner(db):
        raise ApiError(409, "owner_exists", "The owner account already exists.")
    return create_user(
        db,
        storage,
        username=username,
        password=password,
        role=ROLE_OWNER,
        timezone=timezone,
        must_change_password=False,
    )


def create_member(
    db: Session, storage: StorageService, username: str, password: str, timezone: str | None
) -> User:
    return create_user(
        db,
        storage,
        username=username,
        password=password,
        role=ROLE_MEMBER,
        timezone=timezone,
        must_change_password=True,
    )


def issue_session(db: Session, user: User) -> IssuedSession:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    now = _now()
    db.add(
        AuthSession(
            id=hash_token(token),
            user_id=user.id,
            csrf_token=csrf,
            created_at=_iso(now),
            last_seen_at=_iso(now),
            expires_at=_iso(now + SLIDING),
        )
    )
    db.flush()
    return IssuedSession(token=token, csrf_token=csrf, user=user)


def invalid_credentials() -> ApiError:
    return ApiError(401, "invalid_credentials", "Incorrect username or password.")


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        raise invalid_credentials()
    if not verify_password(user.password_hash, password) or user.disabled_at is not None:
        raise invalid_credentials()
    return user


def login(db: Session, username: str, password: str) -> IssuedSession:
    return issue_session(db, authenticate(db, username, password))


def logout(db: Session, token: str | None) -> None:
    if token:
        sess = db.get(AuthSession, hash_token(token))
        if sess is not None:
            db.delete(sess)


def resolve_session(db: Session, token: str | None) -> tuple[User, AuthSession] | None:
    if not token:
        return None
    sess = db.get(AuthSession, hash_token(token))
    if sess is None:
        return None
    now = _now()
    if datetime.fromisoformat(sess.expires_at) <= now:
        db.delete(sess)
        return None
    user = db.get(User, sess.user_id)
    if user is None or user.disabled_at is not None:
        db.delete(sess)
        return None
    # slide the expiry, at most once a minute, capped at the absolute maximum
    if now - datetime.fromisoformat(sess.last_seen_at) > timedelta(minutes=1):
        cap = datetime.fromisoformat(sess.created_at) + ABSOLUTE
        sess.last_seen_at = _iso(now)
        sess.expires_at = _iso(min(now + SLIDING, cap))
    return user, sess


def revoke_sessions(db: Session, user_id: str, keep_id: str | None = None) -> None:
    for sess in db.scalars(select(AuthSession).where(AuthSession.user_id == user_id)):
        if sess.id != keep_id:
            db.delete(sess)


def touch(user: User) -> None:
    user.updated_at = now_iso()


def change_password(db: Session, user: User, current: str, new: str, keep_session_id: str) -> None:
    if not verify_password(user.password_hash, current):
        raise invalid_credentials()
    validate_password(new, user.username)
    user.password_hash = hash_password(new)
    user.must_change_password = False
    revoke_sessions(db, user.id, keep_id=keep_session_id)


def update_profile(user: User, timezone: str | None) -> None:
    if timezone is not None:
        user.timezone = validate_timezone(timezone)
