from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class TaskColumn(IdMixin, TimestampMixin, VersionMixin, Base):
    """One column of the user's task board (012): 1–12 per user, ordered by `position`."""

    __tablename__ = "task_columns"
    __table_args__ = (
        UniqueConstraint("user_id", "name_key", name="uq_task_columns_user_name"),
        UniqueConstraint("user_id", "position", name="uq_task_columns_user_position"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    name_key: Mapped[str] = mapped_column(String(40), nullable=False)  # casefold(name)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    counts_as_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
