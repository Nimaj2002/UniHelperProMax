from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, now_iso

ACTIVE_STATUSES = ("queued", "uploading", "transcribing", "appending")
STATUSES = (*ACTIVE_STATUSES, "completed", "failed", "cancelled")
ERROR_CATEGORIES = (
    "not_configured",
    "invalid_credentials",
    "unavailable",
    "file_rejected",
    "quota_exceeded",
    "unknown",
)


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class TranscriptionSettings(Base):
    """Per-user transcription choice (005 writes it; 004 reads it)."""

    __tablename__ = "transcription_settings"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    active_provider_id: Mapped[str | None] = mapped_column(String, nullable=True)
    default_language: Mapped[str] = mapped_column(String(8), nullable=False, default="auto")
    use_proxy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # 021
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )


class ProviderConfig(Base):
    """One provider's settings for one user. `secret` (the API key) is never serialized."""

    __tablename__ = "provider_configs"
    __table_args__ = (
        CheckConstraint("test_status IN ('not_tested', 'connected', 'failed')", name="test_status"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    provider_id: Mapped[str] = mapped_column(String, primary_key=True)
    values_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    secret: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # plaintext until 014 migrates it
    # 014: the encrypted key in the shared secret store
    secret_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("secrets.id", ondelete="SET NULL"), nullable=True
    )
    # 005: last connection test of the saved values
    test_status: Mapped[str] = mapped_column(String(16), nullable=False, default="not_tested")
    test_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    tested_at: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )


class TranscriptionJob(IdMixin, TimestampMixin, Base):
    """One request to transcribe a recording into a note (data-model.md)."""

    __tablename__ = "transcription_jobs"
    __table_args__ = (
        CheckConstraint(f"status IN ({_in(STATUSES)})", name="status"),
        CheckConstraint(
            f"error_category IS NULL OR error_category IN ({_in(ERROR_CATEGORIES)})",
            name="error_category",
        ),
        CheckConstraint("part_count >= 1 AND part_index >= 0", name="parts"),
        Index(
            "uq_transcription_jobs_one_active",
            "user_id",
            unique=True,
            sqlite_where=text(f"status IN ({_in(ACTIVE_STATUSES)})"),
        ),
        Index("ix_transcription_jobs_status_created", "status", "created_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recording_id: Mapped[str] = mapped_column(
        String, ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("notes.id", ondelete="SET NULL"), nullable=True
    )
    note_name: Mapped[str] = mapped_column(String(120), nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="auto")
    provider_id: Mapped[str] = mapped_column(String, nullable=False)
    provider_values_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    part_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    part_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    part_texts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    source_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress: Mapped[float | None] = mapped_column(Float, nullable=True)
    stage_started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    settings_related: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    appended_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fallback_note_created: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    seen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
