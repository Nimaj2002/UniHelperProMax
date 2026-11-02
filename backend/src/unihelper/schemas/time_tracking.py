"""Time tracking (020) request and response bodies; camelCase on the wire."""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, ConfigDict, Field

from unihelper.schemas.common import ApiModel

Style = Literal["track", "pomodoro", "focus"]
Source = Literal["track", "pomodoro", "focus", "manual"]
Phase = Literal["work", "short_break", "long_break"]
Color = Literal[
    "tag-1", "tag-2", "tag-3", "tag-4", "tag-5", "tag-6",
    "tag-7", "tag-8", "tag-9", "tag-10", "tag-11", "tag-12",
]  # fmt: skip
Description = Field(default="", max_length=500)


class Links(ApiModel):
    """P2 links; a task or session sets the course."""

    course_id: str | None = None
    task_id: str | None = None
    session_key: str | None = Field(default=None, max_length=200)


class TimerOut(ApiModel):
    style: Style
    state: Literal["running", "paused", "waiting"]
    started_at: str
    paused_at: str | None
    paused_ms: int
    planned_end_at: str | None
    finished_at: str | None
    description: str
    tag_id: str | None
    course_id: str | None
    task_id: str | None
    session_key: str | None
    link_title: str | None
    phase: Phase | None
    period: int | None
    focus_minutes: int | None
    goal: str | None
    hide_panels: bool
    reminder_ack: int
    version: int


class TimerSnapshot(Links):
    """What Undo needs to bring a timer back exactly as it was."""

    model_config = ConfigDict(extra="ignore")

    style: Style
    state: Literal["running", "paused", "waiting"]
    started_at: AwareDatetime
    paused_at: AwareDatetime | None = None
    paused_ms: int = Field(default=0, ge=0)
    planned_end_at: AwareDatetime | None = None
    finished_at: AwareDatetime | None = None
    description: str = Description
    tag_id: str | None = None
    phase: Phase | None = None
    period: int | None = Field(default=None, ge=1, le=8)
    focus_minutes: int | None = Field(default=None, ge=1, le=480)
    goal: str | None = Field(default=None, max_length=200)
    hide_panels: bool = False
    reminder_ack: int = Field(default=0, ge=0)


class EntryOut(ApiModel):
    id: str
    started_at: str
    ended_at: str
    paused_seconds: int
    duration_seconds: int
    description: str
    tag_id: str | None
    source: Source
    course_id: str | None
    task_id: str | None
    session_key: str | None
    link_title: str | None
    version: int


class Undo(ApiModel):
    previous: TimerSnapshot | None = None  # the timer to bring back
    entry_id: str | None = None  # the entry saved from it, removed by Undo


class Settled(ApiModel):
    phase: Phase | None
    finished_at: str
    entry_id: str | None


class TimerResponse(ApiModel):
    timer: TimerOut | None
    server_now: str
    settled: list[Settled] = []
    undo: Undo | None = None
    saved: EntryOut | None = None


class TimerStart(Links):
    model_config = ConfigDict(extra="forbid")

    style: Style
    description: str = Description
    tag_id: str | None = None
    focus_minutes: int | None = Field(default=None, ge=1, le=480)
    goal: str | None = Field(default=None, max_length=200)
    hide_panels: bool = False
    at: AwareDatetime | None = None  # when the user pressed Start (offline retry)


class TimerAt(ApiModel):
    model_config = ConfigDict(extra="forbid")

    at: AwareDatetime | None = None  # when the user acted (offline retry)


class TimerSetEnd(ApiModel):
    model_config = ConfigDict(extra="forbid")

    ended_at: AwareDatetime


class TimerPatch(Links):
    model_config = ConfigDict(extra="forbid")

    description: str | None = Field(default=None, max_length=500)
    tag_id: str | None = None
    reminder_ack: int | None = Field(default=None, ge=0)


class TimerUndo(ApiModel):
    model_config = ConfigDict(extra="forbid")

    undo: Undo
    timer_version: int | None = None  # the current timer's version; null when none runs


class EntryCreate(Links):
    model_config = ConfigDict(extra="forbid")

    started_at: AwareDatetime
    ended_at: AwareDatetime | None = None
    duration_seconds: int | None = Field(default=None, ge=1, le=7 * 24 * 3600)
    description: str = Description
    tag_id: str | None = None


class EntryPatch(Links):
    model_config = ConfigDict(extra="forbid")

    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    description: str | None = Field(default=None, max_length=500)
    tag_id: str | None = None


class Overlap(ApiModel):
    id: str
    description: str
    started_at: str
    ended_at: str


class EntryWithOverlaps(ApiModel):
    entry: EntryOut
    overlaps: list[Overlap]


class TagOut(ApiModel):
    id: str
    name: str
    color: Color
    entry_count: int
    version: int


class TagCreate(ApiModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=200)  # trimmed, then 1–30 (checked in the service)
    color: Color


class TagPatch(ApiModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    color: Color | None = None
