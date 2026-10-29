from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import ConfigDict, Field

from unihelper.schemas.common import ApiModel

MAX_CONTENT = 5 * 1024 * 1024


class NoteMeta(ApiModel):
    id: str
    session_key: str | None  # None for a general note (018)
    name: str
    file_name: str
    version: int
    size: int
    created_at: str
    updated_at: str


class Note(NoteMeta):
    content: str
    hash: str
    missing: bool = False


class NoteCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(default="", max_length=MAX_CONTENT)


class NoteImportReplace(ApiModel):
    content: str = Field(max_length=MAX_CONTENT)


class NoteRename(ApiModel):
    name: str = Field(min_length=1, max_length=120)


class ContentSave(ApiModel):
    content: str = Field(max_length=MAX_CONTENT)
    base_hash: str = Field(max_length=64)


class SaveResult(ApiModel):
    version: int
    hash: str
    size: int
    updated_at: str


class TimelineEntry(ApiModel):
    key: str
    lineage_id: str
    course_id: str
    date: date
    start: str
    end: str
    title: str | None
    location: str | None
    color: str
    status: Literal["upcoming", "past"]
    scheduled: bool
    note_count: int
    audio_count: int


class Timeline(ApiModel):
    course_id: str
    entries: list[TimelineEntry]


class TabRef(ApiModel):
    kind: Literal["note", "document", "chat"]  # 014: chat tabs
    id: str = Field(min_length=1, max_length=64)


class SplitState(ApiModel):
    enabled: bool
    left: TabRef | None = None
    right: TabRef | None = None
    focused: Literal["left", "right"] = "left"
    ratio: float = Field(default=0.5, ge=0.2, le=0.8)


class WorkspaceState(ApiModel):
    open_note_ids: list[str] = Field(default_factory=list, max_length=50)
    active_note_id: str | None = None
    # 007: typed tabs and split view; when `tabs` is omitted (older clients) it is derived
    # from open_note_ids / active_note_id
    tabs: list[TabRef] | None = Field(default=None, max_length=50)
    active: TabRef | None = None
    split: SplitState | None = None


class Preferences(ApiModel):
    model_config = ConfigDict(extra="forbid")

    editor_mode: Literal["live", "raw"] | None = None
    workspace_left_collapsed: bool | None = None
    workspace_right_collapsed: bool | None = None
    player_volume: float | None = Field(default=None, ge=0, le=1)
    player_muted: bool | None = None
    # 005: "system" | "light" | "dark" | a custom theme id (per account)
    theme: str | None = Field(default=None, min_length=1, max_length=64)
    reader_dark_pages: bool | None = None  # 007 FR-022a
    last_semester_id: str | None = Field(default=None, min_length=1, max_length=64)  # 009 R9
    quick_create_type: Literal["class", "event"] | None = None  # 009
    recording_bar_style: Literal["full", "compact", "minimal"] | None = None
    general_notes_collapsed: bool | None = None  # 018
