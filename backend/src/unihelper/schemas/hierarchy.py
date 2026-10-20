from __future__ import annotations

from datetime import date

from pydantic import Field

from unihelper.schemas.classes import ColorKey
from unihelper.schemas.common import ApiModel


class Year(ApiModel):
    id: str
    name: str
    folder_name: str
    position: int
    version: int


class YearInput(ApiModel):
    name: str = Field(min_length=1, max_length=80)


class Semester(ApiModel):
    id: str
    year_id: str
    name: str
    folder_name: str
    start_date: date | None = None
    end_date: date | None = None
    version: int


class SemesterCreate(ApiModel):
    year_id: str
    name: str = Field(min_length=1, max_length=80)
    start_date: date | None = None
    end_date: date | None = None


class SemesterUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    start_date: date | None = None
    end_date: date | None = None


class Course(ApiModel):
    id: str
    semester_id: str
    name: str
    folder_name: str
    default_color: ColorKey
    version: int
    # 009: the course already sits in the semester's reserved `_Events` folder (rename it)
    reserved_name_conflict: bool = False


class CourseCreate(ApiModel):
    semester_id: str
    name: str = Field(min_length=1, max_length=120)
    default_color: ColorKey | None = None


class CourseUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    default_color: ColorKey | None = None


class CourseDetail(Course):
    year: Year
    semester: Semester


class SemesterNode(ApiModel):
    semester: Semester
    courses: list[Course]
    event_count: int = 0  # 009: events in this semester


class YearNode(ApiModel):
    year: Year
    semesters: list[SemesterNode]


class DeletionImpact(ApiModel):
    semesters: int = 0
    courses: int = 0
    classes: int = 0
    # 009: what moves to the Trash with it (content in folders not already in the Trash)
    events: int = 0
    notes: int = 0
    recordings: int = 0
    documents: int = 0
    chats: int = 0  # 014
    kept_folder: str
    # 012: live tasks linked to its events; live tasks of its courses that become personal
    linked_task_count: int = 0
    task_count: int = 0


class YearOrder(ApiModel):
    year_ids: list[str] = Field(min_length=1)
