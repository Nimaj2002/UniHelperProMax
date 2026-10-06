"""Per-user workspace tabs (FR-013) and UI preferences (FR-008, FR-022)."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import validation_error
from unihelper.models import Note, SessionFolder, UiPreferences, User, WorkspaceState
from unihelper.services import session_folder_service as sfs

DEFAULT_PREFERENCES: dict[str, Any] = {
    "editor_mode": "live",
    "workspace_left_collapsed": False,
    "workspace_right_collapsed": False,
    "player_volume": 1.0,
    "player_muted": False,
    "theme": "system",
}


def _session_note_ids(db: Session, user: User, r: sfs.ResolvedSession) -> set[str]:
    if r.folder is None:
        return set()
    return set(
        db.scalars(
            select(Note.id).where(Note.session_folder_id == r.folder.id, Note.user_id == user.id)
        )
    )


def get_state(db: Session, user: User, key: str) -> dict[str, Any]:
    r = sfs.resolve(db, user, key)
    row = db.get(WorkspaceState, (user.id, r.lineage_id, r.day))
    if row is None:
        return {"open_note_ids": [], "active_note_id": None}
    valid = _session_note_ids(db, user, r)
    ids = [i for i in json.loads(row.open_note_ids) if i in valid]
    active = row.active_note_id if row.active_note_id in ids else (ids[0] if ids else None)
    return {"open_note_ids": ids, "active_note_id": active}


def put_state(
    db: Session, user: User, key: str, open_ids: list[str], active: str | None
) -> dict[str, Any]:
    if active is not None and active not in open_ids:
        raise validation_error("/activeNoteId", "invalid_active", "The active note must be open.")
    r = sfs.resolve(db, user, key)
    valid = _session_note_ids(db, user, r)
    ids = list(dict.fromkeys(i for i in open_ids if i in valid))
    active = active if active in ids else (ids[0] if ids else None)
    row = db.get(WorkspaceState, (user.id, r.lineage_id, r.day))
    if row is None:
        row = WorkspaceState(user_id=user.id, lineage_id=r.lineage_id, original_date=r.day)
        db.add(row)
    row.open_note_ids = json.dumps(ids)
    row.active_note_id = active
    db.flush()
    return {"open_note_ids": ids, "active_note_id": active}


def get_preferences(db: Session, user: User) -> dict[str, Any]:
    row = db.get(UiPreferences, user.id)
    stored = json.loads(row.data) if row else {}
    return {**DEFAULT_PREFERENCES, **{k: v for k, v in stored.items() if k in DEFAULT_PREFERENCES}}


def patch_preferences(db: Session, user: User, changes: dict[str, Any]) -> dict[str, Any]:
    theme = changes.get("theme")
    if theme is not None:
        from unihelper.services.theme_service import valid_theme_choice

        if not valid_theme_choice(db, user, theme):
            raise validation_error("/theme", "unknown_theme", "Choose one of your themes.")
    merged = {**get_preferences(db, user), **{k: v for k, v in changes.items() if v is not None}}
    row = db.get(UiPreferences, user.id)
    if row is None:
        row = UiPreferences(user_id=user.id)
        db.add(row)
    row.data = json.dumps(merged)
    db.flush()
    return merged


def folder_of(db: Session, note: Note) -> SessionFolder | None:
    return db.get(SessionFolder, note.session_folder_id)
