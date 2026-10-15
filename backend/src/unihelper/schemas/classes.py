from __future__ import annotations

from datetime import date, time
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import ConfigDict, Field, field_validator

from unihelper.schemas.common import ApiModel

ColorKey = Literal[
    "slate",
    "red",
    "orange",
    "amber",
    "lime",
    "green",
    "teal",
    "cyan",
    "blue",
    "indigo",
    "violet",
    "pink",
]
Weekday = Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


def parse_hhmm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


class Link(ApiModel):
    label: str | None = Field(default=None, max_length=60)
    url: str = Field(max_length=2048, pattern=r"^https?://")

    @field_validator("url")
    @classmethod
    def _absolute(cls, v: str) -> str:
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Enter a full web address starting with http:// or https://")
        return v


class RecurrenceEnd(ApiModel):
    kind: Literal["semester_end", "until", "count"]
    until_date: date | None = None
    count: int | None = Field(default=None, ge=1, le=500)


class Recurrence(ApiModel):
    freq: Literal["none", "weekly"]
    interval_weeks: int = Field(default=1, ge=1, le=8)
    by_weekday: list[Weekday] = Field(default_factory=list)
    end: RecurrenceEnd | None = None


class _Strict(ApiModel):
    model_config = ConfigDict(extra="forbid")


class RefId(_Strict):
    id: str


class NewYear(_Strict):
    name: str = Field(min_length=1, max_length=80)


class RefNewYear(_Strict):
    new: NewYear


class NewSemester(_Strict):
    name: str = Field(min_length=1, max_length=80)
    start_date: date | None = None
    end_date: date | None = None
    year: RefId | RefNewYear


class RefNewSemester(_Strict):
    new: NewSemester


class NewCourse(_Strict):
    name: str = Field(min_length=1, max_length=120)
    semester: RefId | RefNewSemester


class RefNewCourse(_Strict):
    new: NewCourse


class ClassFields(ApiModel):
    title: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=120)
    color: ColorKey | None = None
    start_time: HHMM | None = None
    end_time: HHMM | None = None
    links: list[Link] | None = Field(default=None, max_length=10)
    recurrence: Recurrence | None = None


class ClassCreate(ClassFields):
    course: RefId | RefNewCourse
    start_date: date
    start_time: HHMM
    end_time: HHMM
    color: ColorKey
    recurrence: Recurrence
    links: list[Link] = Field(default_factory=list, max_length=10)


class CreatedRefs(ApiModel):
    """Rows a create request made (for the quick form's Undo, 009 research R10)."""

    lineage_id: str
    year_id: str | None = None
    semester_id: str | None = None
    course_id: str | None = None


class UndoCreation(ApiModel):
    """`POST /creations/undo` body: what a create returned, and its series version."""

    created: CreatedRefs
    version: int


class ClassSeriesOut(ApiModel):
    id: str
    lineage_id: str
    course_id: str
    title: str | None
    location: str | None
    color: ColorKey
    start_date: date
    start_time: str
    end_time: str
    links: list[Link]
    recurrence: Recurrence
    version: int


class ClassDetail(ApiModel):
    lineage_id: str
    course: dict[str, object]
    segments: list[ClassSeriesOut]
    exception_count: int


class SessionOut(ApiModel):
    """A class session or (009) an event occurrence (`kind`). Events have no course or class
    series: `courseId`, `courseName` and `seriesId` are null and `title` is the event's title;
    for classes `title` keeps 001's meaning (the class's own title, if any)."""

    key: str
    kind: Literal["class", "event"] = "class"
    lineage_id: str
    series_id: str | None
    series_version: int
    course_id: str | None
    course_name: str | None
    semester_id: str
    title: str | None
    date: date
    start: str
    end: str
    location: str | None
    color: ColorKey
    links: list[Link]
    recurrence_summary: str
    is_exception: bool
    exception_version: int | None
    status: Literal["upcoming", "past"]
    scheduled: bool = True
    task_id: str | None = None  # 012: live task linked to this event occurrence (classes: null)


class SessionEdit(ClassFields):
    """Fields to change. With scope=this only startTime, endTime and location are allowed.
    009: unknown fields are refused, so `PATCH /sessions/{key}` can tell it from `EventEdit`."""

    model_config = ConfigDict(extra="forbid")


class ClassCreated(ClassSeriesOut):
    """`POST /classes` 201: the series plus the rows the request created (009 research R10)."""

    created: CreatedRefs


class ScopeResult(ApiModel):
    lineage_id: str
    affected_series_ids: list[str]
    preserved_overrides: int = 0
    removed_overrides: int = 0
    # 009: occurrences a series edit left unchanged (events: content or edited individually;
    # classes: = preservedOverrides) and the Trash entry a delete created
    unchanged_count: int = 0
    trash_entry_id: str | None = None
