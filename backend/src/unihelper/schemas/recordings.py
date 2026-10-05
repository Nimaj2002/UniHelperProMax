from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.common import ApiModel


class Recording(ApiModel):
    id: str
    session_key: str
    name: str
    file_name: str
    mime_type: str
    status: Literal["recording", "complete", "interrupted"]
    started_at: str
    duration_ms: int
    size: int
    next_seq: int
    active: bool
    missing: bool
    version: int


class RecordingStart(ApiModel):
    mime_type: Literal["audio/webm", "audio/mp4"]


class RecordingStop(ApiModel):
    interrupted: bool = False
    duration_ms: int | None = Field(default=None, ge=0)


class RecordingRename(ApiModel):
    name: str = Field(min_length=1, max_length=120)


class ChunkResult(ApiModel):
    next_seq: int
    size: int
