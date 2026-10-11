from __future__ import annotations

from datetime import date, time

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, now_iso

FOLDER_KINDS = ("class", "event")


class SessionFolder(IdMixin, Base):
    """The dated folder of one session (`{lineage_id}:{original_date}`), created on first content
    and never renamed. Snapshots keep "no longer scheduled" sessions displayable (FR-006).

    009: a class folder hangs off its course, an event folder off its semester (`kind`). While
    its occurrence is in the Trash, `trash_entry_id` is set and `origin_path` remembers where
    the files are, so the owner columns may be NULL (the parent may have been deleted)."""

    __tablename__ = "session_folders"
    __table_args__ = (
        UniqueConstraint("lineage_id", "original_date", name="uq_session_folders_key"),
        UniqueConstraint("course_id", "folder_key", name="uq_session_folders_course_folder"),
        UniqueConstraint("semester_id", "folder_key", name="uq_session_folders_semester_folder"),
        CheckConstraint("kind IN ('class', 'event')", name="kind"),
        CheckConstraint(
            "trash_entry_id IS NOT NULL"
            " OR (kind = 'class' AND course_id IS NOT NULL)"
            " OR (kind = 'event' AND semester_id IS NOT NULL)",
            name="owner",
        ),
        Index("ix_session_folders_user_course", "user_id", "course_id"),
        Index("ix_session_folders_user_semester", "user_id", "semester_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )
    semester_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("semesters.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(
        String(8), nullable=False, default="class", server_default="class"
    )
    trash_entry_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("trash_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    origin_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    lineage_id: Mapped[str] = mapped_column(String, nullable=False)
    original_date: Mapped[date] = mapped_column(Date, nullable=False)
    folder_name: Mapped[str] = mapped_column(String, nullable=False)
    folder_key: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)

    @property
    def session_key(self) -> str:
        return f"{self.lineage_id}:{self.original_date.isoformat()}"
