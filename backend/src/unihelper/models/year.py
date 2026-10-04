from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class Year(IdMixin, TimestampMixin, VersionMixin, Base):
    __tablename__ = "years"
    __table_args__ = (
        UniqueConstraint("user_id", "name_key", name="uq_years_user_name"),
        # folder_key = casefold(folder_name): SQLite cannot index casefold() directly
        UniqueConstraint("user_id", "folder_key", name="uq_years_user_folder"),
        UniqueConstraint("user_id", "position", name="uq_years_user_position"),
        CheckConstraint("length(name) BETWEEN 1 AND 80", name="name_len"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)  # 1–80 chars free-form
    name_key: Mapped[str] = mapped_column(String, nullable=False)
    folder_name: Mapped[str] = mapped_column(String, nullable=False)
    folder_key: Mapped[str] = mapped_column(String, nullable=False)
    # user-defined display order (FR-022a); 0 = top
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
