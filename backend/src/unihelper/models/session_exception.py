from __future__ import annotations

from datetime import date, time

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class SessionException(IdMixin, TimestampMixin, VersionMixin, Base):
    """A single-session change ("This session" scope): cancelled, or time/location override.
    Keyed by (lineage_id, original_date) — the session key — so it survives series splits."""

    __tablename__ = "session_exceptions"
    __table_args__ = (
        UniqueConstraint("lineage_id", "original_date", name="uq_session_exceptions_key"),
        CheckConstraint("kind IN ('cancelled', 'modified')", name="kind"),
        CheckConstraint(
            "start_time IS NULL OR end_time IS NULL OR end_time > start_time", name="time_order"
        ),
        CheckConstraint("location IS NULL OR length(location) <= 120", name="location_len"),
        Index("ix_session_exceptions_user_lineage", "user_id", "lineage_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lineage_id: Mapped[str] = mapped_column(String, nullable=False)
    original_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
