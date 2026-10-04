from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, now_iso


class WorkspaceState(Base):
    """Open note tabs and the active tab, per user and session (FR-013)."""

    __tablename__ = "workspace_states"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    lineage_id: Mapped[str] = mapped_column(String, primary_key=True)
    original_date: Mapped[date] = mapped_column(Date, primary_key=True)
    open_note_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    active_note_id: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )
