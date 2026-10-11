"""Calendar import/export payloads (010 contracts/openapi.yaml)."""

from __future__ import annotations

from datetime import date as Date
from typing import Literal

from pydantic import Field

from unihelper.schemas.classes import ColorKey, Link, RefId, RefNewSemester, Weekday
from unihelper.schemas.common import ApiModel

SkipReason = Literal[
    "all_day",
    "cancelled",
    "invalid_times",
    "has_content",
    "in_trash",
    "kind_mismatch",
    "unsupported_skipped",
    "not_selected",
]
Kind = Literal["class", "event"]


class Pattern(ApiModel):
    weekdays: list[Weekday]
    start_time: str
    end_time: str


class SkippedItem(ApiModel):
    title: str
    date: Date | None = None
    start_time: str | None = None
    reason: SkipReason
    message: str


class SavedTarget(ApiModel):
    kind: Kind
    year_name: str
    semester_name: str
    course_name: str | None = None
    color: ColorKey | None = None


class OpenEnded(ApiModel):
    suggested_end_date: Date


class GroupDefaults(ApiModel):
    selected: bool
    import_as: Kind
    color: ColorKey | None = None


class GroupMatches(ApiModel):
    create: int = 0
    update: int = 0
    unchanged: int = 0
    skip: int = 0


class ImportGroup(ApiModel):
    group_id: str
    title: str
    title_missing: bool = False
    occurrence_count: int
    patterns: list[Pattern]
    location: str | None = None
    repeating: bool
    unsupported: str | None = None
    open_ended: OpenEnded | None = None
    first_date: Date | None = None
    saved: SavedTarget | None = None
    defaults: GroupDefaults
    matches: GroupMatches
    issues: list[Literal["reserved_name", "title_required", "kind_mismatch"]]
    notes: list[str]
    skipped: list[SkippedItem]


class ImportPreview(ApiModel):
    upload_id: str
    file_name: str
    event_count: int
    timezone: str
    from_this_app: bool = False
    groups: list[ImportGroup]
    skipped: list[SkippedItem]
    expires_at: str


class CourseExisting(ApiModel):
    existing: str


class CourseNew(ApiModel):
    new: str = Field(min_length=1, max_length=120)


class GroupPlan(ApiModel):
    group_id: str
    selected: bool
    import_as: Kind
    title: str | None = Field(default=None, min_length=1, max_length=120)
    course: CourseExisting | CourseNew | None = None
    semester: Literal["saved", "destination"] = "saved"
    end_date: Date | None = None
    unsupported: Literal["first_only", "skip"] | None = None


class ImportPlan(ApiModel):
    destination: RefId | RefNewSemester
    groups: list[GroupPlan] = Field(max_length=5000)


class Counts(ApiModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0


class CreatedCourse(ApiModel):
    id: str
    name: str


class ImportResult(ApiModel):
    run_id: str
    classes: Counts
    events: Counts
    unchanged: int = 0
    courses_created: list[CreatedCourse]
    semester_id: str | None = None
    skipped: list[SkippedItem]
    notes: list[str]
    undo_available: bool = True


class RemovedCounts(ApiModel):
    classes: int = 0
    events: int = 0
    courses: int = 0
    semesters: int = 0
    years: int = 0


class KeptItem(ApiModel):
    title: str
    message: str


class UndoResult(ApiModel):
    removed: RemovedCounts
    kept: list[KeptItem]


__all__ = ["ImportPlan", "ImportPreview", "ImportResult", "Link", "UndoResult"]
