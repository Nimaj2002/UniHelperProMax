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


class YearNode(ApiModel):
    year: Year
    semesters: list[SemesterNode]


class DeletionImpact(ApiModel):
    semesters: int = 0
    courses: int = 0
    classes: int = 0
    kept_folder: str


class YearOrder(ApiModel):
    year_ids: list[str] = Field(min_length=1)
