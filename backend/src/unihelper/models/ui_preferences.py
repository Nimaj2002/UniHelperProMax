from __future__ import annotations

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, now_iso


class UiPreferences(Base):
    """Per-user UI conveniences (editor mode, workspace panel collapse) as a JSON object."""

    __tablename__ = "ui_preferences"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )
