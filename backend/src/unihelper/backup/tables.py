"""Which tables a backup holds, and how one account's rows are found (research R4).

Every table of `Base.metadata` is in exactly one of INCLUDED or EXCLUDED; a unit test fails on
an unclassified table, so a new table can't be silently left out of backups. Rows are read and
written as raw SQLite values, so this works for any schema revision.
"""

from __future__ import annotations

from typing import Any

from unihelper.models import Base
from unihelper.models.transcription import ACTIVE_STATUSES

# tables whose rows belong to the account; INCLUDED orders them so every FK points backwards
_INCLUDED = frozenset(
    {
        "years",
        "semesters",
        "courses",
        "class_series",
        "class_links",
        "event_series",
        "event_links",
        "session_exceptions",
        "trash_entries",
        "session_folders",
        "notes",
        "recordings",
        "transcription_jobs",
        "documents",
        "document_positions",
        "annotation_ops",
        "chats",
        "chat_drafts",
        "chat_uploads",
        "task_columns",
        "tasks",
        "task_checklist_items",
        "task_quick_notes",
        "themes",
        "ui_preferences",
        "workspace_states",
        "transcription_settings",
        "provider_configs",
        "ai_settings",
        "ai_endpoints",
        "ai_models",
        "calendar_import_sources",
        "calendar_import_runs",
    }
)

EXCLUDED: dict[str, str] = {
    "users": "the account itself; only its time zone is restored",
    "auth_sessions": "sign-in sessions",
    "secrets": "API keys are never in a backup (FR-016)",
    "secret_store_meta": "the installation's key-store bookkeeping",
    "chat_runs": "answers being generated; the chat files are the source of truth",
    "calendar_import_uploads": "short-lived calendar import previews",
}

INCLUDED: tuple[str, ...] = tuple(
    t.name for t in Base.metadata.sorted_tables if t.name in _INCLUDED
)

# tables without user_id: their rows belong to the account through a parent row
PARENT: dict[str, tuple[str, str]] = {
    "class_links": ("series_id", "class_series"),
    "event_links": ("series_id", "event_series"),
    "annotation_ops": ("document_id", "documents"),
}

# values written instead of what's stored: never a key, never a "still generating" flag
COLUMN_OVERRIDES: dict[str, dict[str, Any]] = {
    "provider_configs": {"secret": None, "secret_id": None},
    "ai_endpoints": {"secret_id": None},
    "chats": {"generating": 0},
}

# rows left out on top of the account filter (active work isn't part of a snapshot)
_ACTIVE = ", ".join(f"'{s}'" for s in ACTIVE_STATUSES)
ROW_FILTERS: dict[str, str] = {
    "transcription_jobs": f"status NOT IN ({_ACTIVE})",
}


def account_where(table: str) -> str:
    """SQL condition selecting the account's rows of `table`; bind `:uid`."""
    if table in PARENT:
        column, parent = PARENT[table]
        return f"{column} IN (SELECT id FROM {parent} WHERE user_id = :uid)"
    return "user_id = :uid"


def single_pk(table: str) -> str | None:
    """The table's one primary-key column, if it has exactly one."""
    cols = list(Base.metadata.tables[table].primary_key.columns)
    return cols[0].name if len(cols) == 1 else None
