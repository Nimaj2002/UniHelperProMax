from __future__ import annotations

from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class Semester(IdMixin, TimestampMixin, VersionMixin, Base):
    __tablename__ = "semesters"
    __table_args__ = (
        UniqueConstraint("year_id", "name_key", name="uq_semesters_year_name"),
        UniqueConstraint("year_id", "folder_key", name="uq_semesters_year_folder"),
        CheckConstraint("length(name) BETWEEN 1 AND 80", name="name_len"),
        CheckConstraint(
            "start_date IS NULL OR end_date IS NULL OR end_date >= start_date", name="date_order"
        ),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year_id: Mapped[str] = mapped_column(
        String, ForeignKey("years.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    name_key: Mapped[str] = mapped_column(String, nullable=False)
    folder_name: Mapped[str] = mapped_column(String, nullable=False)
    folder_key: Mapped[str] = mapped_column(String, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
