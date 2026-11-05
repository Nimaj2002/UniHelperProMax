"""Chats, runs, drafts, uploads and the notes picker (014 contracts/openapi.yaml)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.ai import Limits, Locality, ModelRef
from unihelper.schemas.common import ApiModel

ItemKind = Literal["note", "document", "recording", "upload"]
AnswerStatus = Literal["queued", "streaming", "completed", "stopped", "interrupted", "failed"]
ErrorCategory = Literal[
    "network",
    "timeout",
    "key_rejected",
    "key_unreadable",
    "rate_limited",
    "model_not_found",
    "too_large",
    "context_exceeded",
    "provider",
    "not_this_style",
    "proxy",
]
MAX_ATTACHMENTS = 10


class ContextItemRef(ApiModel):
    kind: ItemKind
    ref: str = Field(min_length=1, max_length=64)
    pdf_mode: Literal["document", "text"] | None = None


class ContextItem(ContextItemRef):
    title: str
    mime: str | None = None
    size: int | None = None
    available: bool = True
    added_at: str | None = None


class SendMessage(ApiModel):
    text: str = Field(max_length=100_000)
    model: ModelRef
    attachments: list[ContextItemRef] = Field(default_factory=list)


class ChatSummary(ApiModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    generating: bool
    unseen_answer: bool
    message_count: int
    model_label: str
    match: str | None = None
    version: int


class SendResult(ApiModel):
    chat: ChatSummary
    run_id: str
    turn_id: str
    answer_id: str


class Usage(ApiModel):
    input: int | None = None
    output: int | None = None
    total: int | None = None


class AnswerError(ApiModel):
    category: ErrorCategory
    message: str
    retry_after_seconds: int | None = None


class AnswerOut(ApiModel):
    id: str
    text: str
    status: AnswerStatus
    endpoint_label: str
    model_label: str
    locality: Locality | None = None
    started_at: str
    ended_at: str | None = None
    usage: Usage | None = None
    error: AnswerError | None = None
    run_id: str | None = None


class NoteSnapshotRef(ApiModel):
    note_id: str
    title: str
    snapshot: str


class UserVersionOut(ApiModel):
    id: str
    text: str
    created_at: str
    attachments: list[ContextItem]
    note_snapshots: list[NoteSnapshotRef] = Field(default_factory=list)
    answers: list[AnswerOut]
    selected_answer: int


class TurnOut(ApiModel):
    id: str
    versions: list[UserVersionOut]
    selected: int


class ChatOut(ChatSummary):
    session_key: str
    model: ModelRef | None
    context: list[ContextItem]
    turns: list[TurnOut]


class ChatUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    model: ModelRef | None = None
    context: list[ContextItemRef] | None = None


class Regenerate(ApiModel):
    model: ModelRef | None = None


class Selection(ApiModel):
    version: int = Field(ge=0)
    answer: int = Field(ge=0)


class ChatDraftIo(ApiModel):
    chat_id: str | None
    text: str = Field(max_length=100_000)
    attachments: list[ContextItemRef] = Field(default_factory=list, max_length=MAX_ATTACHMENTS)
    updated_at: str | None = None


class ChatUploadOut(ApiModel):
    id: str
    kind: Literal["image", "pdf", "audio"]
    mime: str
    size: int
    name: str


class PreflightRequest(ApiModel):
    session_key: str
    chat_id: str | None = None
    model: ModelRef
    text: str = ""
    attachments: list[ContextItemRef] = Field(default_factory=list)


ReasonCode = Literal[
    "no_audio", "no_pdf", "no_images", "format", "too_large", "missing", "no_text", "encrypted"
]


class PreflightItem(ContextItem):
    accepted: bool
    reason: str | None = None
    reason_code: ReasonCode | None = None
    text_fallback_available: bool = False
    pdf_has_text: bool | None = None
    estimated_tokens: int


class PreflightResult(ApiModel):
    items: list[PreflightItem]
    estimated_tokens: int
    context_limit: int | None
    over_limit: bool
    limits: Limits
    locality: Locality
    privacy_ack_required: bool


class ChatRunOut(ApiModel):
    id: str
    chat_id: str
    session_key: str
    answer_id: str
    status: AnswerStatus


class AppendTarget(ApiModel):
    note_id: str | None = None
    new_note_title: str | None = Field(default=None, min_length=1, max_length=120)


class AppendResult(ApiModel):
    note_id: str
    text: str
    previous_hash: str | None
    hash: str
    version: int


class NoteSearchHit(ApiModel):
    id: str
    title: str
    session_key: str
    session_label: str
    course_id: str | None
    course_name: str | None
    updated_at: str
