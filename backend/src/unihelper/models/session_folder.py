from __future__ import annotations

from datetime import date, time

from sqlalchemy import Date, ForeignKey, Index, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, now_iso


class SessionFolder(IdMixin, Base):
    """The dated folder of one session (`{lineage_id}:{original_date}`), created on first content
    and never renamed. Snapshots keep "no longer scheduled" sessions displayable (FR-006)."""

    __tablename__ = "session_folders"
    __table_args__ = (
        UniqueConstraint("lineage_id", "original_date", name="uq_session_folders_key"),
        UniqueConstraint("course_id", "folder_key", name="uq_session_folders_course_folder"),
        Index("ix_session_folders_user_course", "user_id", "course_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    lineage_id: Mapped[str] = mapped_column(String, nullable=False)
    original_date: Mapped[date] = mapped_column(Date, nullable=False)
    folder_name: Mapped[str] = mapped_column(String, nullable=False)
    folder_key: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    title: Mapped[str | None] = mapped_column(String(60), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)

    @property
    def session_key(self) -> str:
        return f"{self.lineage_id}:{self.original_date.isoformat()}"
