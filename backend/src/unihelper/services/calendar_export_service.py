"""Calendar export (010 research R9, R10, R14): every class and event lineage of the user (or of
one semester) as one .ics file. Only schedule data is read — never notes, recordings or
documents. Lineages in the Trash have no series rows and are therefore never exported."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError
from unihelper.domain.ical_write import (
    ExportLineage,
    ExportOccurrence,
    ExportSegment,
    write_calendar,
)
from unihelper.domain.naming import safe_name
from unihelper.domain.recurrence import generates, rule_of
from unihelper.models import ClassSeries, Course, EventSeries, Semester, User, Year
from unihelper.services import hierarchy_service as hs
from unihelper.services import lineage as lineage_mod

APP = "UniHelperProMax"


def _links(row: Any) -> list[tuple[str | None, str]]:
    return [(lk.label, lk.url) for lk in row.links]


def _segment(row: Any, kind: str, title: str, semester_end: date | None) -> ExportSegment | None:
    """None for a segment that schedules nothing (until semester end, without an end date)."""
    seg = ExportSegment(
        id=row.id,
        title=title,
        freq=row.freq,
        start_date=row.start_date,
        start_time=row.start_time,
        end_time=row.end_time,
        interval_weeks=row.interval_weeks,
        weekdays=row.weekdays,
        location=row.location,
        links=_links(row),
        color=row.color,
    )
    if row.freq == "weekly":
        if row.end_kind == "count":
            seg.count = row.count
        elif row.end_kind == "until":
            seg.until_date = row.until_date
        elif row.end_kind == "semester_end":
            if semester_end is None:
                return None
            seg.until_date = semester_end
        else:  # "never" (legacy rows): stop at the semester end when there is one
            seg.until_date = semester_end
    return seg


def _lineage(
    db: Session,
    user: User,
    kind: str,
    lineage_id: str,
    semester: Semester,
    year: Year,
    course: Course | None,
) -> ExportLineage | None:
    lin = lineage_mod.load(db, user, lineage_id, kind)
    if lin is None or not lin.rows:
        return None
    out = ExportLineage(
        kind=kind,
        lineage_id=lineage_id,
        year_name=year.name,
        semester_name=semester.name,
        semester_start=semester.start_date,
        semester_end=semester.end_date,
        course_name=course.name if course else None,
        segments=[],
    )
    pairs: list[tuple[Any, ExportSegment]] = []
    for row in lin.rows:
        title = course.name if course is not None else row.title
        seg = _segment(row, kind, title, lin.semester_ends[row.id])
        if seg is not None:
            pairs.append((row, seg))
            out.segments.append(seg)
    if not pairs:
        return None
    for exc in lin.exceptions:
        owner = next(
            (
                (row, seg)
                for row, seg in pairs
                if generates(rule_of(row), lin.semester_ends[row.id], exc.original_date)
            ),
            None,
        )
        base_row, base_seg = owner or pairs[-1]
        if exc.kind == "cancelled":
            if owner is not None:
                base_seg.exdates.append(exc.original_date)
            continue
        occ = ExportOccurrence(
            original=exc.original_date,
            day=exc.moved_date or exc.original_date,
            start=exc.start_time or base_row.start_time,
            end=exc.end_time or base_row.end_time,
            title=(exc.title if kind == "event" and exc.title else base_seg.title),
            location=exc.location if exc.location is not None else base_row.location,
            links=list(exc.links) if exc.links is not None else _links(base_row),
        )
        if owner is not None:
            base_seg.overrides.append(occ)
        elif exc.detached:
            out.standalone.append(occ)
    return out


def _filename(user: User, semester: Semester | None, year: Year | None) -> str:
    today = datetime.now(UTC).astimezone(ZoneInfo(user.timezone)).date().isoformat()
    if semester is None or year is None:
        return f"{APP}-calendar-{today}.ics"
    part = re.sub(r"\s+", "-", f"{safe_name(year.name)} {safe_name(semester.name)}")
    part = re.sub(r"[^\w.-]", "", part, flags=re.UNICODE) or "semester"
    return f"{APP}-{part}-{today}.ics"


def export(db: Session, user: User, semester_id: str | None) -> tuple[bytes, str, dict[str, int]]:
    semester_filter = hs.get_semester(db, user, semester_id) if semester_id else None
    class_q = (
        select(ClassSeries.lineage_id, Course, Semester, Year)
        .join(Course, Course.id == ClassSeries.course_id)
        .join(Semester, Semester.id == Course.semester_id)
        .join(Year, Year.id == Semester.year_id)
        .where(ClassSeries.user_id == user.id)
        .order_by(Year.position, Semester.name, Course.name, ClassSeries.start_date)
    )
    event_q = (
        select(EventSeries.lineage_id, Semester, Year)
        .join(Semester, Semester.id == EventSeries.semester_id)
        .join(Year, Year.id == Semester.year_id)
        .where(EventSeries.user_id == user.id)
        .order_by(Year.position, Semester.name, EventSeries.start_date)
    )
    if semester_filter is not None:
        class_q = class_q.where(Semester.id == semester_filter.id)
        event_q = event_q.where(Semester.id == semester_filter.id)

    lineages: list[ExportLineage] = []
    seen: set[str] = set()
    counts = {"class": 0, "event": 0}
    for lineage_id, course, semester, year in db.execute(class_q):
        if lineage_id in seen:
            continue
        seen.add(lineage_id)
        lin = _lineage(db, user, "class", lineage_id, semester, year, course)
        if lin is not None:
            lineages.append(lin)
            counts["class"] += 1
    for lineage_id, semester, year in db.execute(event_q):
        if lineage_id in seen:
            continue
        seen.add(lineage_id)
        lin = _lineage(db, user, "event", lineage_id, semester, year, None)
        if lin is not None:
            lineages.append(lin)
            counts["event"] += 1
    if not lineages:
        raise ApiError(409, "nothing_to_export", "There is nothing to export.")
    filter_year = db.get(Year, semester_filter.year_id) if semester_filter else None
    data = write_calendar(lineages, user.timezone)
    return data, _filename(user, semester_filter, filter_year), counts
