from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.domain.naming import is_reserved_course_folder
from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin

COLOR_KEYS = (
    "slate",
    "red",
    "orange",
    "amber",
    "lime",
    "green",
    "teal",
    "cyan",
    "blue",
    "indigo",
    "violet",
    "pink",
)
COLOR_CHECK = "IN (" + ", ".join(f"'{c}'" for c in COLOR_KEYS) + ")"


class Course(IdMixin, TimestampMixin, VersionMixin, Base):
    """A course ("syllabus" in the constitution's folder hierarchy)."""

    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint("semester_id", "name_key", name="uq_courses_semester_name"),
        UniqueConstraint("semester_id", "folder_key", name="uq_courses_semester_folder"),
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="name_len"),
        CheckConstraint(f"default_color {COLOR_CHECK}", name="default_color"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    semester_id: Mapped[str] = mapped_column(
        String, ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String, nullable=False)
    folder_name: Mapped[str] = mapped_column(String, nullable=False)
    folder_key: Mapped[str] = mapped_column(String, nullable=False)
    default_color: Mapped[str] = mapped_column(String(16), nullable=False, default="blue")

    @property
    def reserved_name_conflict(self) -> bool:
        """A course created before 009 whose folder is the reserved `_Events` (research R1)."""
        return is_reserved_course_folder(self.folder_name)
