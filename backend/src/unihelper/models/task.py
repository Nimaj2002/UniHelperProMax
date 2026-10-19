from __future__ import annotations

from datetime import date, time
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    and_,
    false,
    text,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class Task(IdMixin, TimestampMixin, VersionMixin, Base):
    """A task on the board (012). Live = not soft-deleted and not in the Trash."""

    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_user_column_position", "user_id", "column_id", "position"),
        Index("ix_tasks_course", "user_id", "course_id"),
        Index("ix_tasks_trash", "trash_entry_id"),
        # at most one live task per event occurrence (FR-038)
        Index(
            "uq_tasks_event_key",
            "user_id",
            "event_key",
            unique=True,
            sqlite_where=text(
                "event_key IS NOT NULL AND deleted_at IS NULL AND trash_entry_id IS NULL"
            ),
        ),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    column_id: Mapped[str] = mapped_column(String, ForeignKey("task_columns.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )
    event_key: Mapped[str | None] = mapped_column(String, nullable=True)
    # cached event values for linked tasks live in title/due_date/due_time
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    previous_column_id: Mapped[str | None] = mapped_column(String, nullable=True)
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)
    trash_entry_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("trash_entries.id", ondelete="CASCADE"), nullable=True
    )

    checklist: Mapped[list[TaskChecklistItem]] = relationship(
        order_by="TaskChecklistItem.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @hybrid_property
    def is_live(self) -> bool:
        return self.deleted_at is None and self.trash_entry_id is None

    @is_live.inplace.expression
    @classmethod
    def _is_live_expression(cls) -> Any:
        return and_(cls.deleted_at.is_(None), cls.trash_entry_id.is_(None))


class TaskChecklistItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "task_checklist_items"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str] = mapped_column(
        String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class TaskQuickNote(IdMixin, TimestampMixin, VersionMixin, Base):
    __tablename__ = "task_quick_notes"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[str] = mapped_column(
        String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)
