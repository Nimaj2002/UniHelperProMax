"""Task board (012): columns, tasks, checklist and quick notes (contracts/openapi.yaml)."""

from __future__ import annotations

from datetime import date
from datetime import date as _Date  # `LinkedEventOut.date` shadows the name
from typing import Annotated, Self

from pydantic import ConfigDict, Field, StringConstraints, model_validator

from unihelper.schemas.classes import HHMM
from unihelper.schemas.common import ApiModel

ColumnName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ChecklistText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]


class _Strict(ApiModel):
    model_config = ConfigDict(extra="forbid")


class _Patch(_Strict):
    """At least one field (minProperties: 1)."""

    @model_validator(mode="after")
    def _not_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        return self


# ---- columns -----------------------------------------------------------------------------


class TaskColumnOut(ApiModel):
    id: str
    name: str
    position: int
    counts_as_done: bool
    task_count: int  # live tasks in the column
    version: int


class TaskColumnCreate(_Strict):
    name: ColumnName
    counts_as_done: bool = False


class TaskColumnPatch(_Patch):
    name: ColumnName | None = None
    counts_as_done: bool | None = None


class TaskColumnOrder(_Strict):
    column_ids: list[str] = Field(min_length=1, max_length=12)


# ---- tasks -------------------------------------------------------------------------------


class LinkedEventOut(ApiModel):
    session_key: str
    title: str
    date: _Date
    start: str | None = None


class ChecklistItemOut(ApiModel):
    id: str
    text: str
    done: bool


class TaskOut(ApiModel):
    id: str
    column_id: str
    position: int
    title: str
    description: str
    due_date: date | None
    due_time: str | None  # "HH:MM"
    course_id: str | None
    course_name: str | None
    course_color: str | None
    event: LinkedEventOut | None
    completed_at: str | None
    previous_column_id: str | None
    checklist_done: int
    checklist_total: int
    quick_note_count: int
    version: int
    created_at: str
    updated_at: str


class TaskDetailOut(TaskOut):
    checklist: list[ChecklistItemOut]


class TaskCreate(_Strict):
    # required unless eventKey is given (then taken from the event)
    title: TaskTitle | None = None
    column_id: str | None = None
    course_id: str | None = None
    due_date: date | None = None
    due_time: HHMM | None = None
    description: str = Field(default="", max_length=20000)
    event_key: str | None = None


class TaskPatch(_Patch):
    title: TaskTitle | None = None
    description: str | None = Field(default=None, max_length=20000)
    due_date: date | None = None
    due_time: HHMM | None = None
    course_id: str | None = None


class TaskMove(_Strict):
    column_id: str
    index: int = Field(ge=0)


class ChecklistItemIn(_Strict):
    id: str | None = None  # existing item to keep; omitted for new items
    text: ChecklistText
    done: bool


class ChecklistReplace(_Strict):
    items: list[ChecklistItemIn] = Field(max_length=200)


# ---- quick notes -------------------------------------------------------------------------


class QuickNoteOut(ApiModel):
    id: str
    task_id: str
    title: str
    body: str
    version: int
    created_at: str
    updated_at: str


class QuickNoteWrite(_Patch):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=20000)
