from __future__ import annotations

from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, VersionMixin, now_iso


class TrashEntry(IdMixin, VersionMixin, Base):
    """One deleted class or event lineage (009 research R6). Holds the before-images needed for
    an exact restore (`payload_json`, schema `TrashPayloadV1`); its content folders point here
    through `session_folders.trash_entry_id`. Files are never touched until a permanent delete."""

    __tablename__ = "trash_entries"
    __table_args__ = (
        CheckConstraint("kind IN ('class', 'event')", name="kind"),
        CheckConstraint("reason IN ('delete', 'hierarchy_delete')", name="reason"),
        CheckConstraint("occurrence_count >= 1", name="occurrence_count"),
        CheckConstraint(
            "note_count >= 0 AND recording_count >= 0 AND document_count >= 0", name="counts"
        ),
        Index("ix_trash_entries_user_deleted", "user_id", "deleted_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    lineage_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    year_name: Mapped[str] = mapped_column(String, nullable=False)
    semester_name: Mapped[str] = mapped_column(String, nullable=False)
    course_name: Mapped[str | None] = mapped_column(String, nullable=True)
    first_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_date: Mapped[date] = mapped_column(Date, nullable=False)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False)
    note_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recording_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    purge_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
