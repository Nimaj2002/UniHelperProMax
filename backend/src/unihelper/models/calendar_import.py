from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, now_iso

MAX_ICS_BYTES = 5 * 1024 * 1024
MAX_ICS_EVENTS = 5000


class CalendarImportUpload(IdMixin, Base):
    """A staged `.ics` file between preview and apply (010 research R2). The bytes are
    `files/.uploads/<staged_name>`; the row expires an hour after the upload."""

    __tablename__ = "calendar_import_uploads"
    __table_args__ = (
        CheckConstraint(f"size BETWEEN 1 AND {MAX_ICS_BYTES}", name="size"),
        CheckConstraint(f"event_count BETWEEN 0 AND {MAX_ICS_EVENTS}", name="event_count"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    staged_name: Mapped[str] = mapped_column(String, nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
    expires_at: Mapped[str] = mapped_column(String, nullable=False)


class CalendarImportRun(IdMixin, Base):
    """One confirmed import (R13): what it created and updated, and its result summary."""

    __tablename__ = "calendar_import_runs"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    destination_semester_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("semesters.id", ondelete="SET NULL"), nullable=True
    )
    created_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_json: Mapped[str] = mapped_column(Text, nullable=False)
    summary_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
    undone_at: Mapped[str | None] = mapped_column(String, nullable=True)


class CalendarImportSource(IdMixin, Base):
    """The file `UID` (and, for an override imported on its own, its RECURRENCE-ID) a lineage
    came from (R11), so a later import of the same calendar updates it."""

    __tablename__ = "calendar_import_sources"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "source_uid", "recurrence_key", name="uq_calendar_import_sources_key"
        ),
        CheckConstraint("kind IN ('class', 'event')", name="kind"),
        Index("ix_calendar_import_sources_user_lineage", "user_id", "lineage_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source_uid: Mapped[str] = mapped_column(String(1024), nullable=False)
    recurrence_key: Mapped[str] = mapped_column(
        String, nullable=False, default="", server_default=""
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    lineage_id: Mapped[str] = mapped_column(String, nullable=False)
    first_run_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("calendar_import_runs.id", ondelete="SET NULL"), nullable=True
    )
    last_run_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("calendar_import_runs.id", ondelete="SET NULL"), nullable=True
    )
