from __future__ import annotations

from datetime import date, time

from sqlalchemy import (
    Boolean,
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

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin
from unihelper.models.course import COLOR_CHECK


class SessionException(IdMixin, TimestampMixin, VersionMixin, Base):
    """A single-session change ("This session" scope): cancelled, or time/location override.
    Keyed by (lineage_id, original_date) — the session key — so it survives series splits.

    009 (research R3, R4): event occurrences may also override `title`, `color`, `links_json`
    and move to `moved_date` (the key keeps `original_date`); `detached` keeps a frozen
    occurrence scheduled when the series rule no longer generates its date. Classes still set
    only times and location (service validation)."""

    __tablename__ = "session_exceptions"
    __table_args__ = (
        UniqueConstraint("lineage_id", "original_date", name="uq_session_exceptions_key"),
        CheckConstraint("kind IN ('cancelled', 'modified')", name="kind"),
        CheckConstraint(
            "start_time IS NULL OR end_time IS NULL OR end_time > start_time", name="time_order"
        ),
        CheckConstraint("location IS NULL OR length(location) <= 200", name="location_len"),
        CheckConstraint("title IS NULL OR length(title) BETWEEN 1 AND 120", name="title_len"),
        CheckConstraint(f"color IS NULL OR color {COLOR_CHECK}", name="color"),
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
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    links_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    moved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    detached: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
