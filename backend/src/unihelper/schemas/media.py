from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.common import ApiModel


class MediaRecording(ApiModel):
    id: str
    name: str
    duration_ms: int
    version: int
    has_transcript: bool
    missing: bool
    mime_type: str


class MediaSession(ApiModel):
    session_key: str
    title: str
    date: str
    recordings: list[MediaRecording]


class MediaClassGroup(ApiModel):
    id: str | None
    name: str
    context: str  # "2025 · Fall" so same-named classes of different terms stay apart
    sessions: list[MediaSession]


class Peaks(ApiModel):
    duration_ms: int
    peaks: list[float]


class TrimRange(ApiModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=1)


class TrimRequest(ApiModel):
    """One window (`startMs`/`endMs`) or several (`ranges`, at most 20); exactly one form."""

    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=1)
    ranges: list[TrimRange] | None = Field(default=None, min_length=1, max_length=20)
    mode: Literal["new", "overwrite"]
    name: str | None = Field(default=None, max_length=120)
    combine: Literal["merge", "separate"] = "merge"


class TrimResult(ApiModel):
    mode: Literal["new", "overwrite"]
    recording: MediaRecording  # the first (or only) result
    recordings: list[MediaRecording] = []  # every result: several when saved separately
    transcript_stale: bool = False
