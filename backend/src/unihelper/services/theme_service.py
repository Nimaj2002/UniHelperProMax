"""Custom themes (005 US4/US5). Colours are derived in the browser; the server only validates
that every value is a `#rrggbb` colour for a known token and stores them."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.deps import check_version
from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.domain.naming import name_key, normalize_display
from unihelper.models import Theme, User
from unihelper.schemas.themes import KEY_COLORS, TOKENS, ThemeCreate, ThemeWrite

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
BUILT_IN = ("system", "light", "dark")


def view(t: Theme) -> dict[str, Any]:
    return {
        "id": t.id,
        "name": t.name,
        "base": t.base,
        "key_colors": json.loads(t.key_colors_json),
        "overrides": json.loads(t.overrides_json),
        "colors": json.loads(t.colors_json),
        "low_contrast": t.low_contrast,
        "version": t.version,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def _name(raw: str) -> str:
    name = normalize_display(raw)
    if not name:
        raise validation_error("/name", "name_required", "Enter a name for the theme.")
    if len(name) > 60:
        raise validation_error("/name", "name_too_long", "Use at most 60 characters.")
    return name


def _colors(values: dict[str, str], allowed: tuple[str, ...], pointer: str, complete: bool) -> str:
    for key, value in values.items():
        if key not in allowed:
            raise validation_error(f"{pointer}/{key}", "unknown_color", f"Unknown colour “{key}”.")
        if not isinstance(value, str) or not HEX.match(value):
            raise validation_error(
                f"{pointer}/{key}", "invalid_color", "Use a colour like #1a2b3c."
            )
    if complete and set(values) != set(allowed):
        missing = sorted(set(allowed) - set(values))
        raise validation_error(pointer, "missing_colors", f"Missing colours: {', '.join(missing)}.")
    return json.dumps({k: values[k].lower() for k in allowed if k in values})


def _taken(db: Session, user: User, key: str, exclude: str | None = None) -> bool:
    q = select(Theme.id).where(Theme.user_id == user.id, Theme.name_key == key)
    if exclude:
        q = q.where(Theme.id != exclude)
    return db.scalar(q) is not None


def _name_taken() -> ApiError:
    msg = "A theme with this name already exists."
    return ApiError(
        409, "name_taken", msg, errors=[{"field": "/name", "code": "name_taken", "message": msg}]
    )


def _apply(t: Theme, body: ThemeWrite) -> None:
    t.key_colors_json = _colors(body.key_colors, KEY_COLORS, "/keyColors", complete=True)
    t.overrides_json = _colors(body.overrides, TOKENS, "/overrides", complete=False)
    t.colors_json = _colors(body.colors, TOKENS, "/colors", complete=True)
    t.low_contrast = body.low_contrast


def _get(db: Session, user: User, theme_id: str) -> Theme:
    t = db.get(Theme, theme_id)
    if t is None or t.user_id != user.id:
        raise not_found("Theme")
    return t


def list_themes(db: Session, user: User) -> list[dict[str, Any]]:
    themes = db.scalars(select(Theme).where(Theme.user_id == user.id).order_by(Theme.name_key))
    return [view(t) for t in themes]


def get_theme(db: Session, user: User, theme_id: str) -> dict[str, Any]:
    return view(_get(db, user, theme_id))


def create_theme(db: Session, user: User, body: ThemeCreate) -> dict[str, Any]:
    name = _name(body.name)
    if _taken(db, user, name_key(name)):
        if not body.unique_name:
            raise _name_taken()
        n = 2
        while _taken(db, user, name_key(f"{name[:54]} ({n})")):
            n += 1
        name = f"{name[:54]} ({n})"
    t = Theme(user_id=user.id, name=name, name_key=name_key(name), base=body.base)
    _apply(t, body)
    db.add(t)
    db.flush()
    return view(t)


def update_theme(
    db: Session, user: User, theme_id: str, version: int, body: ThemeWrite
) -> dict[str, Any]:
    t = _get(db, user, theme_id)
    check_version(version, t.version)
    name = _name(body.name)
    if _taken(db, user, name_key(name), exclude=t.id):
        raise _name_taken()
    t.name, t.name_key = name, name_key(name)
    _apply(t, body)
    db.flush()
    return view(t)


def delete_theme(db: Session, user: User, theme_id: str, version: int) -> None:
    from unihelper.services import workspace_service

    t = _get(db, user, theme_id)
    check_version(version, t.version)
    if workspace_service.get_preferences(db, user).get("theme") == t.id:
        workspace_service.patch_preferences(db, user, {"theme": t.base})  # fall back to its base
    db.delete(t)
    db.flush()


def valid_theme_choice(db: Session, user: User, choice: str) -> bool:
    if choice in BUILT_IN:
        return True
    t = db.get(Theme, choice)
    return t is not None and t.user_id == user.id
