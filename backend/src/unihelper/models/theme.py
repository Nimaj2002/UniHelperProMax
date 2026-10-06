from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class Theme(IdMixin, TimestampMixin, VersionMixin, Base):
    """A user-created colour theme (005). Colours are derived in the frontend; the server
    stores and validates them."""

    __tablename__ = "themes"
    __table_args__ = (
        UniqueConstraint("user_id", "name_key", name="uq_themes_user_name"),
        CheckConstraint("length(name) BETWEEN 1 AND 60", name="name_len"),
        CheckConstraint("base IN ('light', 'dark')", name="base"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    name_key: Mapped[str] = mapped_column(String, nullable=False)
    base: Mapped[str] = mapped_column(String(8), nullable=False)
    key_colors_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    overrides_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    colors_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    low_contrast: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
