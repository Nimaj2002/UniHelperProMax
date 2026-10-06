from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, model_validator

from unihelper.schemas.common import ApiModel

LANGUAGE = re.compile(r"^(auto|[a-z]{2})$")


class ProviderField(ApiModel):
    key: str
    label: str
    kind: Literal["url", "secret", "text"]
    required: bool
    placeholder: str | None


class ProviderSpec(ApiModel):
    id: str
    name: str
    fields: list[ProviderField]
    max_upload_bytes: int | None


class TranscriptionStatus(ApiModel):
    configured: bool
    provider_id: str | None
    provider_name: str | None
    default_language: str


class TranscriptionStart(ApiModel):
    note_id: str | None = None
    new_note_name: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default=None, pattern=LANGUAGE.pattern)

    @model_validator(mode="after")
    def _one_target(self) -> TranscriptionStart:
        if (self.note_id is None) == (self.new_note_name is None):
            raise ValueError("Choose an existing note or name a new one.")
        return self


class AppendResult(ApiModel):
    text: str
    previous_hash: str
    hash: str
    version: int


class TranscriptionJob(ApiModel):
    id: str
    recording_id: str
    recording_name: str
    session_key: str
    course_id: str
    note_id: str | None
    note_name: str
    language: str
    provider_id: str
    provider_name: str
    status: Literal[
        "queued", "uploading", "transcribing", "appending", "completed", "failed", "cancelled"
    ]
    part_index: int
    part_count: int
    progress: float | None
    stage_started_at: str | None
    error_category: (
        Literal[
            "not_configured",
            "invalid_credentials",
            "unavailable",
            "file_rejected",
            "quota_exceeded",
            "unknown",
        ]
        | None
    )
    error_message: str | None
    settings_related: bool
    cancel_requested: bool
    fallback_note_created: bool
    attempts: int
    seen: bool
    appended: AppendResult | None
    created_at: str
    started_at: str | None
    finished_at: str | None
