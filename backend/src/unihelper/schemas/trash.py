"""Settings → Trash (009 US4) and the deletion confirmations (R7)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from unihelper.schemas.common import ApiModel

Kind = Literal["class", "event"]


class SessionDeletionImpact(ApiModel):
    """`GET /sessions/{key}/deletion-impact?scope=` (contract schema `DeletionImpact`)."""

    kind: Kind
    occurrences: int
    notes: int
    recordings: int
    documents: int


class TrashEntryOut(ApiModel):
    id: str
    kind: Kind
    label: str
    year_name: str
    semester_name: str
    course_name: str | None
    first_date: date
    last_date: date
    start_time: str | None
    end_time: str | None
    occurrence_count: int
    note_count: int
    recording_count: int
    document_count: int
    deleted_at: str
    purge_error: str | None
    missing_files: int
    version: int


class Recreated(ApiModel):
    year: bool = False
    semester: bool = False
    course: bool = False


class RestoreResult(ApiModel):
    kind: Kind
    lineage_id: str
    first_session_key: str
    recreated: Recreated
    moved_folders: int = 0
