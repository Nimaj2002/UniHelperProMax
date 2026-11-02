"""Per-user workspace tabs (002 FR-013; 007 typed tabs and split view) and UI preferences
(FR-008, FR-022; 007 dark pages)."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import validation_error
from unihelper.models import (
    Chat,
    Document,
    Note,
    SessionFolder,
    UiPreferences,
    User,
    WorkspaceState,
)
from unihelper.services import session_folder_service as sfs
from unihelper.services.document_service import scope_of

DEFAULT_PREFERENCES: dict[str, Any] = {
    "editor_mode": "live",
    "workspace_left_collapsed": False,
    "workspace_right_collapsed": False,
    "player_volume": 1.0,
    "player_muted": False,
    "theme": "system",
    "reader_dark_pages": False,  # 007 FR-022a
    "last_semester_id": None,  # 009 research R9: preselected semester in the forms
    "quick_create_type": "class",  # 009: type the quick form opens with
    "recording_bar_style": "full",  # floating recording pill: full | compact | minimal
    "general_notes_collapsed": False,  # 018: home page General notes section
    "shortcuts": {},  # 019: custom shortcuts {commandId: [main, alternate]}
    "time": {  # 020: timer settings
        "pomodoro_work_min": 25,
        "pomodoro_short_min": 5,
        "pomodoro_long_min": 15,
        "pomodoro_periods": 4,
        "pomodoro_auto_start": False,
        "focus_hide_panels": False,
        "long_running_hours": 3,
        "sound": True,
        "system_notifications": False,
        "indicator_combo": "combined",
        "timer_bar_style": "full",  # floating timer pill: full | compact | minimal
        "daily_goal_min": None,
    },
}
NULLABLE_TIME = {"long_running_hours", "daily_goal_min"}  # an explicit null turns these off
NULLABLE_PREFERENCES = {"last_semester_id"}  # an explicit null clears these
MAX_TABS = 50
NEW_CHAT_ID = re.compile(r"new:[0-9a-f-]{8,64}")


def _session_items(db: Session, user: User, r: sfs.ResolvedSession) -> dict[str, set[str]]:
    """Ids that can be open as tabs in this session: its notes, (007) its course's (009: its
    event series') documents and (014) its chats."""
    docs = set(db.scalars(scope_of(user, r).documents(user).with_only_columns(Document.id)))
    if r.folder is None:
        return {"note": set(), "document": docs, "chat": set()}
    notes = db.scalars(
        select(Note.id).where(Note.session_folder_id == r.folder.id, Note.user_id == user.id)
    )
    chats = db.scalars(
        select(Chat.id).where(
            Chat.session_folder_id == r.folder.id,
            Chat.user_id == user.id,
            Chat.deleted_at.is_(None),
        )
    )
    return {"note": set(notes), "document": docs, "chat": set(chats)}


Tab = dict[str, str]


def _valid_tabs(tabs: list[Tab], valid: dict[str, set[str]]) -> list[Tab]:
    seen: set[tuple[str, str]] = set()
    out: list[Tab] = []
    for t in tabs:
        key = (t.get("kind", ""), t.get("id", ""))
        # 014: a new, still empty chat tab has a client id until its first message is sent
        new_chat = key[0] == "chat" and NEW_CHAT_ID.fullmatch(key[1]) is not None
        if (new_chat or key[1] in valid.get(key[0], set())) and key not in seen:
            seen.add(key)
            out.append({"kind": key[0], "id": key[1]})
    return out[:MAX_TABS]


def _in(tab: Tab | None, tabs: list[Tab]) -> Tab | None:
    return tab if tab is not None and tab in tabs else None


def _clean_split(split: dict[str, Any] | None, tabs: list[Tab]) -> dict[str, Any] | None:
    """A split whose pane shows a tab that is gone turns off (007 FR-014a)."""
    if not split:
        return None
    left, right = _in(split.get("left"), tabs), _in(split.get("right"), tabs)
    enabled = bool(split.get("enabled")) and left is not None and right is not None
    ratio = min(0.8, max(0.2, float(split.get("ratio", 0.5))))
    focused = split.get("focused") if split.get("focused") in ("left", "right") else "left"
    return {"enabled": enabled, "left": left, "right": right, "focused": focused, "ratio": ratio}


def _view(tabs: list[Tab], active: Tab | None, split: dict[str, Any] | None) -> dict[str, Any]:
    active = _in(active, tabs) or (tabs[0] if tabs else None)
    note_ids = [t["id"] for t in tabs if t["kind"] == "note"]
    active_note = active["id"] if active and active["kind"] == "note" else None
    return {
        "open_note_ids": note_ids,
        "active_note_id": active_note,
        "tabs": tabs,
        "active": active,
        "split": split,
    }


def get_state(db: Session, user: User, key: str) -> dict[str, Any]:
    r = sfs.resolve(db, user, key)
    row = db.get(WorkspaceState, (user.id, r.lineage_id, r.day))
    if row is None:
        return _view([], None, None)
    valid = _session_items(db, user, r)
    if row.tabs_json is not None:
        stored = json.loads(row.tabs_json)
        tabs = _valid_tabs(stored.get("tabs", []), valid)
        active = stored.get("active")
    else:  # written before 007: note tabs only
        tabs = _valid_tabs(
            [{"kind": "note", "id": i} for i in json.loads(row.open_note_ids)], valid
        )
        active = {"kind": "note", "id": row.active_note_id} if row.active_note_id else None
    split = _clean_split(json.loads(row.split_json) if row.split_json else None, tabs)
    return _view(tabs, active, split)


def put_state(db: Session, user: User, key: str, body: Any) -> dict[str, Any]:
    """Save open tabs, the active tab and the split view (002 FR-013, 007 FR-013/FR-014a).
    `body` is a WorkspaceState; a body without `tabs` (an older client) updates note tabs only
    and keeps open document tabs."""
    r = sfs.resolve(db, user, key)
    valid = _session_items(db, user, r)
    row = db.get(WorkspaceState, (user.id, r.lineage_id, r.day))
    if body.tabs is not None:
        tabs = _valid_tabs([t.model_dump() for t in body.tabs], valid)
        active = body.active.model_dump() if body.active else None
        split = _clean_split(body.split.model_dump() if body.split else None, tabs)
    else:
        if body.active_note_id is not None and body.active_note_id not in body.open_note_ids:
            raise validation_error(
                "/activeNoteId", "invalid_active", "The active note must be open."
            )
        current = get_state(db, user, key) if row is not None else _view([], None, None)
        docs = [t for t in current["tabs"] if t["kind"] == "document"]
        notes = [{"kind": "note", "id": i} for i in body.open_note_ids]
        tabs = _valid_tabs(notes + docs, valid)
        active = {"kind": "note", "id": body.active_note_id} if body.active_note_id else None
        split = _clean_split(current["split"], tabs)
    view = _view(tabs, active, split)
    if row is None:
        row = WorkspaceState(user_id=user.id, lineage_id=r.lineage_id, original_date=r.day)
        db.add(row)
    row.open_note_ids = json.dumps(view["open_note_ids"])
    row.active_note_id = view["active_note_id"]
    row.tabs_json = json.dumps({"tabs": view["tabs"], "active": view["active"]})
    row.split_json = json.dumps(split) if split else None
    db.flush()
    return view


def get_preferences(db: Session, user: User) -> dict[str, Any]:
    row = db.get(UiPreferences, user.id)
    stored = json.loads(row.data) if row else {}
    prefs = {**DEFAULT_PREFERENCES, **{k: v for k, v in stored.items() if k in DEFAULT_PREFERENCES}}
    prefs["time"] = {**DEFAULT_PREFERENCES["time"], **(stored.get("time") or {})}
    return prefs


def patch_preferences(db: Session, user: User, changes: dict[str, Any]) -> dict[str, Any]:
    theme = changes.get("theme")
    if theme is not None:
        from unihelper.services.theme_service import valid_theme_choice

        if not valid_theme_choice(db, user, theme):
            raise validation_error("/theme", "unknown_theme", "Choose one of your themes.")
    current = get_preferences(db, user)
    time_changes = changes.pop("time", None)
    merged = {
        **current,
        **{k: v for k, v in changes.items() if v is not None or k in NULLABLE_PREFERENCES},
    }
    if time_changes is not None:  # 020: a nested patch; null keeps a value unless it may be off
        merged["time"] = {
            **current["time"],
            **{k: v for k, v in time_changes.items() if v is not None or k in NULLABLE_TIME},
        }
    row = db.get(UiPreferences, user.id)
    if row is None:
        row = UiPreferences(user_id=user.id)
        db.add(row)
    row.data = json.dumps(merged)
    db.flush()
    return merged


def folder_of(db: Session, note: Note) -> SessionFolder | None:
    return db.get(SessionFolder, note.session_folder_id)
