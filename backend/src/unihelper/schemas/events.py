"""Events (009): creation, detail, and the semester's events timeline."""

from __future__ import annotations

from datetime import date
from datetime import date as _Date  # `EventEdit.date` shadows the name
from typing import Literal

from pydantic import ConfigDict, Field, field_validator

from unihelper.schemas.classes import (
    HHMM,
    ColorKey,
    CreatedRefs,
    Link,
    Recurrence,
    RefId,
    RefNewSemester,
)
from unihelper.schemas.common import ApiModel


class AddToBoard(ApiModel):
    """012: also create a task linked to the event's first occurrence in this column."""

    column_id: str


class EventCreate(ApiModel):
    title: str = Field(min_length=1, max_length=120)
    semester: RefId | RefNewSemester
    start_date: date
    start_time: HHMM
    end_time: HHMM
    location: str | None = Field(default=None, max_length=200)
    links: list[Link] = Field(default_factory=list, max_length=10)
    color: ColorKey = "blue"
    recurrence: Recurrence = Field(default_factory=lambda: Recurrence(freq="none"))
    add_to_board: AddToBoard | None = None  # 012

    @field_validator("title")
    @classmethod
    def _trimmed(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter a title.")
        return v


class EventEdit(ApiModel):
    """`PATCH /sessions/{key}` for an event occurrence: only the fields to change. With
    scope=this every field but `semesterId` and `recurrence` may change (`date` moves the
    occurrence; its key keeps the original date). `semesterId` applies to the whole series
    whatever the scope (FR-017) and is refused while the event has content (FR-018)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=120)
    semester_id: str | None = None
    date: _Date | None = None
    start_time: HHMM | None = None
    end_time: HHMM | None = None
    location: str | None = Field(default=None, max_length=200)
    links: list[Link] | None = Field(default=None, max_length=10)
    color: ColorKey | None = None
    recurrence: Recurrence | None = None


class EventCreated(ApiModel):
    lineage_id: str
    semester_id: str
    version: int
    created: CreatedRefs


class EventSegment(ApiModel):
    id: str
    title: str
    location: str | None
    color: ColorKey
    start_date: date
    start_time: str
    end_time: str
    recurrence: Recurrence
    links: list[Link]
    version: int


class EventDetail(ApiModel):
    lineage_id: str
    semester_id: str
    semester_name: str
    year_name: str
    segments: list[EventSegment]
    exception_count: int
    semester_locked: bool


class EventTimelineEntry(ApiModel):
    session_key: str
    lineage_id: str
    title: str
    date: date
    start_time: str
    end_time: str
    start: str  # ISO 8601 with offset, like the course timeline (client reuse)
    end: str
    location: str | None
    color: ColorKey
    status: Literal["past", "upcoming"]
    note_count: int
    audio_count: int
    document_count: int
