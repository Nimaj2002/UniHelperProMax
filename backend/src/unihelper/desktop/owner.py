"""Single-user mode: the desktop app's one implicit owner (research R9, FR-025, FR-033)."""

from __future__ import annotations

import re
import secrets
import unicodedata
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.config import Settings
from unihelper.models import AuthSession, User
from unihelper.models.user import ROLE_OWNER
from unihelper.services import auth_service
from unihelper.storage.storage_service import StorageService

FALLBACK_USERNAME = "student"
DESKTOP_SESSION_ID = "desktop"


def desktop_username(login: str | None) -> str:
    """The computer's login name, made valid as a username (and so as a folder name)."""
    folded = unicodedata.normalize("NFKD", login or "").encode("ascii", "ignore").decode()
    name = re.sub(r"[^a-z0-9._-]+", "-", folded.lower()).strip("-._")[:32].rstrip("-._")
    return name if auth_service.USERNAME_RE.fullmatch(name) else FALLBACK_USERNAME


def _timezone(tz: str | None) -> str:
    try:
        return auth_service.validate_timezone(tz) if tz else "UTC"
    except Exception:
        return "UTC"


def ensure_desktop_owner(
    db: Session, storage: StorageService, settings: Settings, timezone: str | None = None
) -> str:
    """Create the owner on first start (no password anyone knows), return its id."""
    owner = db.scalar(select(User).where(User.role == ROLE_OWNER).order_by(User.created_at))
    if owner is None:
        username = desktop_username(settings.desktop_user)
        owner = User(
            username=username,
            # unusable: a random password nobody ever sees; login is not offered in desktop mode
            password_hash=auth_service.hash_password(secrets.token_urlsafe(48)),
            role=ROLE_OWNER,
            timezone=_timezone(timezone),
            must_change_password=False,
        )
        db.add(owner)
        db.flush()
        storage.ensure_dir([username])
    return owner.id


def desktop_session(user_id: str) -> AuthSession:
    """A transient (never stored) session object for the Auth dependency; desktop requests are
    authenticated by the client secret, not by a cookie."""
    now = datetime.now(UTC).isoformat()
    return AuthSession(
        id=DESKTOP_SESSION_ID,
        user_id=user_id,
        csrf_token="",
        created_at=now,
        last_seen_at=now,
        expires_at=now,
    )
