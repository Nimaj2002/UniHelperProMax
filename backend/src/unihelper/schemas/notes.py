from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import ConfigDict, Field

from unihelper.schemas.common import ApiModel

MAX_CONTENT = 5 * 1024 * 1024


class NoteMeta(ApiModel):
    id: str
    session_key: str
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


class WorkspaceState(ApiModel):
    open_note_ids: list[str] = Field(default_factory=list, max_length=50)
    active_note_id: str | None = None


class Preferences(ApiModel):
    model_config = ConfigDict(extra="forbid")

    editor_mode: Literal["live", "raw"] | None = None
    workspace_left_collapsed: bool | None = None
    workspace_right_collapsed: bool | None = None
