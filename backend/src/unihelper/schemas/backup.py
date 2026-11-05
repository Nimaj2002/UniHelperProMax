"""016: /api/v1/backup/* shapes (contracts/backup-api.md)."""

from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict

from unihelper.schemas.common import ApiModel

Phase = Literal[
    "preparing",
    "writing",
    "ready",
    "validating",
    "awaiting_confirmation",
    "safety_backup",
    "staging",
    "swapping",
    "cleanup",
    "done",
    "rolled_back",
    "failed",
    "cancelled",
    "expired",
]


class BackupCounts(ApiModel):
    semesters: int
    courses: int
    sessions: int
    events: int
    notes: int
    recordings: int
    documents: int
    chats: int
    tasks: int
    themes: int
    files: int
    bytes: int


class BackupKeyLeftOut(ApiModel):
    kind: Literal["transcription_provider", "ai_endpoint", "proxy"]
    id: str
    name: str


class BackupExcludedItem(ApiModel):
    reason: Literal["recording_in_progress"]
    name: str


class BackupCurrentData(ApiModel):
    counts: BackupCounts


class BackupSafetyRef(ApiModel):
    created_at: str
    size: int


class BackupSafetyReplaces(ApiModel):
    replaces: BackupSafetyRef | None


class RestoreSummary(ApiModel):
    created_at: str
    app_version: str
    source: Literal["web", "desktop"]
    will_upgrade: bool
    counts: BackupCounts
    keys_left_out: list[BackupKeyLeftOut]
    excluded: list[BackupExcludedItem]
    current: BackupCurrentData
    files_not_in_backup: int
    safety_backup: BackupSafetyReplaces


class BackupJobError(ApiModel):
    model_config = ConfigDict(extra="allow")

    code: str
    title: str
    detail: str | None = None


class BackupJob(ApiModel):
    id: str
    kind: Literal["export", "restore"]
    phase: Phase
    bytes_done: int
    bytes_total: int | None
    expires_at: str | None
    file_name: str | None = None
    size: int | None = None
    summary: RestoreSummary | None = None
    error: BackupJobError | None = None


class SafetyBackup(ApiModel):
    created_at: str
    size: int
    path: str | None


class RestoreConfirm(ApiModel):
    confirm: Literal[True]
