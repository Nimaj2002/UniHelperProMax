from __future__ import annotations

from datetime import date, time

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin
from unihelper.models.course import COLOR_CHECK


class ClassSeries(IdMixin, TimestampMixin, VersionMixin, Base):
    """One contiguous rule segment of a class; segments of one class share `lineage_id`."""

    __tablename__ = "class_series"
    __table_args__ = (
        CheckConstraint("end_time > start_time", name="time_order"),
        CheckConstraint("freq IN ('none', 'weekly')", name="freq"),
        CheckConstraint("interval_weeks >= 1", name="interval"),
        CheckConstraint("end_kind IN ('never', 'semester_end', 'until', 'count')", name="end_kind"),
        CheckConstraint("count IS NULL OR count BETWEEN 1 AND 500", name="count"),
        CheckConstraint("title IS NULL OR length(title) <= 60", name="title_len"),
        CheckConstraint("location IS NULL OR length(location) <= 120", name="location_len"),
        CheckConstraint(f"color {COLOR_CHECK}", name="color"),
        Index("ix_class_series_user_course", "user_id", "course_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    lineage_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    split_from_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("class_series.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String(60), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    color: Mapped[str] = mapped_column(String(16), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    freq: Mapped[str] = mapped_column(String(8), nullable=False)
    interval_weeks: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    by_weekday: Mapped[str] = mapped_column(String, nullable=False, default="")
    end_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    until_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    links: Mapped[list[ClassLink]] = relationship(
        back_populates="series",
        cascade="all, delete-orphan",
        order_by="ClassLink.position",
        lazy="selectin",
    )

    @property
    def weekdays(self) -> tuple[str, ...]:
        return tuple(d for d in self.by_weekday.split(",") if d)


class ClassLink(IdMixin, Base):
    __tablename__ = "class_links"
    __table_args__ = (
        CheckConstraint("label IS NULL OR length(label) <= 60", name="label_len"),
        CheckConstraint("length(url) <= 2048", name="url_len"),
    )

    series_id: Mapped[str] = mapped_column(
        String, ForeignKey("class_series.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    series: Mapped[ClassSeries] = relationship(back_populates="links")
