"""Time tracking (020): tags, saved time entries and the one running timer per user."""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin

TAG_COLORS = tuple(f"tag-{i}" for i in range(1, 13))
ENTRY_SOURCES = ("track", "pomodoro", "focus", "manual")
TIMER_STYLES = ("track", "pomodoro", "focus")
TIMER_STATES = ("running", "paused", "waiting")
PHASES = ("work", "short_break", "long_break")


class TimeTag(IdMixin, TimestampMixin, VersionMixin, Base):
    __tablename__ = "time_tags"
    __table_args__ = (UniqueConstraint("user_id", "name_key"),)

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    name_key: Mapped[str] = mapped_column(String(30), nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False)


class _Linked:
    """Fields shared by entries and the running timer (description, tag, P2 links)."""

    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    tag_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("time_tags.id", ondelete="SET NULL"), nullable=True
    )
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    session_key: Mapped[str | None] = mapped_column(String, nullable=True)
    link_title: Mapped[str | None] = mapped_column(String(200), nullable=True)


class TimeEntry(IdMixin, TimestampMixin, VersionMixin, _Linked, Base):
    __tablename__ = "time_entries"
    __table_args__ = (
        Index("ix_time_entries_user_start", "user_id", "started_at"),
        Index("ix_time_entries_user_end", "user_id", "ended_at"),
        Index("ix_time_entries_user_session", "user_id", "session_key"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    ended_at: Mapped[str] = mapped_column(String, nullable=False)
    paused_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source: Mapped[str] = mapped_column(String, nullable=False)
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)


class TimeTimer(VersionMixin, _Linked, Base):
    """At most one per user: the primary key is the user (research R1)."""

    __tablename__ = "time_timers"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    style: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    paused_at: Mapped[str | None] = mapped_column(String, nullable=True)
    paused_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    planned_end_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
    phase: Mapped[str | None] = mapped_column(String, nullable=True)
    period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    focus_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    goal: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hide_panels: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    reminder_ack: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
