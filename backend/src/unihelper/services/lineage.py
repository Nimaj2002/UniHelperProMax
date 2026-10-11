"""One class or event lineage as the scope planners and the Trash see it (009).

`load(db, user, lineage_id)` finds the lineage in `class_series` or `event_series`, with its
segments (planner view), its single-occurrence exceptions and every occurrence it schedules.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from unihelper.domain.recurrence import (
    SessionView,
    expand,
    expand_detached,
    generates,
    rule_of,
)
from unihelper.domain.scopes import Segment, segment_of
from unihelper.models import (
    ClassSeries,
    Course,
    EventSeries,
    Semester,
    SessionException,
    SessionFolder,
    User,
)
from unihelper.services.class_service import CLASS_REPO
from unihelper.services.event_service import EVENT_REPO
from unihelper.services.series_apply import SeriesRepo
from unihelper.services.session_query import exception_view


def kind_of(db: Session, user: User, lineage_id: str) -> str | None:
    """ "event" or "class" when the lineage has segments; otherwise the kind of its folders."""
    if db.scalar(
        select(exists().where(EventSeries.lineage_id == lineage_id, EventSeries.user_id == user.id))
    ):
        return "event"
    if db.scalar(
        select(exists().where(ClassSeries.lineage_id == lineage_id, ClassSeries.user_id == user.id))
    ):
        return "class"
    folder = db.scalar(
        select(SessionFolder).where(
            SessionFolder.user_id == user.id, SessionFolder.lineage_id == lineage_id
        )
    )
    return folder.kind if folder else None


def repo_for(kind: str) -> SeriesRepo:
    return EVENT_REPO if kind == "event" else CLASS_REPO


@dataclass
class Lineage:
    kind: str
    lineage_id: str
    rows: list[Any]  # ClassSeries | EventSeries, by start date
    segments: list[Segment]
    exc_rows: dict[date, SessionException]
    semester_ends: dict[str, date | None] = field(default_factory=dict)  # by segment id

    @property
    def repo(self) -> SeriesRepo:
        return repo_for(self.kind)

    @property
    def exceptions(self) -> list[Any]:
        return [exception_view(e) for e in self.exc_rows.values()]

    def generated(self) -> Callable[[date], bool]:
        def gen(day: date) -> bool:
            return any(generates(rule_of(r), self.semester_ends[r.id], day) for r in self.rows)

        return gen

    def occurrences(self, tz: str, now: datetime | None = None) -> list[SessionView]:
        """Every occurrence the lineage schedules (whole span), incl. frozen ones (R4)."""
        from unihelper.services.timeline_service import _last_day

        now = now or datetime.now(UTC)
        excs = self.exceptions
        out: list[SessionView] = []
        for r in self.rows:
            end = self.semester_ends[r.id]
            out.extend(
                expand(
                    rule_of(r),
                    lineage_id=self.lineage_id,
                    series_id=r.id,
                    semester_end=end,
                    range_from=date.min,
                    range_to=max(
                        [_last_day(r, end), *(e.moved_date or r.start_date for e in excs)]
                    ),
                    tz=tz,
                    now=now,
                    exceptions=excs,
                    location=r.location,
                )
            )
        if self.rows and any(e.detached for e in excs):
            last = self.rows[-1]
            out.extend(
                expand_detached(
                    excs,
                    self.generated(),
                    lineage_id=self.lineage_id,
                    series_id=last.id,
                    range_from=date.min,
                    range_to=date.max,
                    tz=tz,
                    now=now,
                    start_time=last.start_time,
                    end_time=last.end_time,
                    location=last.location,
                )
            )
        out.sort(key=lambda v: (v.start, v.key))
        return out


def _semester_end(db: Session, kind: str, row: Any) -> date | None:
    if kind == "event":
        sem = db.get(Semester, row.semester_id)
    else:
        course = db.get(Course, row.course_id)
        sem = db.get(Semester, course.semester_id) if course else None
    return sem.end_date if sem else None


def load(db: Session, user: User, lineage_id: str, kind: str | None = None) -> Lineage | None:
    """The lineage (None when nothing of it exists for this user)."""
    kind = kind or kind_of(db, user, lineage_id)
    if kind is None:
        return None
    model: Any = EventSeries if kind == "event" else ClassSeries
    rows = list(
        db.scalars(
            select(model)
            .where(model.lineage_id == lineage_id, model.user_id == user.id)
            .order_by(model.start_date)
        )
    )
    ends = {r.id: _semester_end(db, kind, r) for r in rows}
    exc_rows = {
        e.original_date: e
        for e in db.scalars(
            select(SessionException).where(
                SessionException.lineage_id == lineage_id, SessionException.user_id == user.id
            )
        )
    }
    return Lineage(
        kind=kind,
        lineage_id=lineage_id,
        rows=rows,
        segments=[segment_of(r, ends[r.id]) for r in rows],
        exc_rows=exc_rows,
        semester_ends=ends,
    )


def planner_day(lin: Lineage, day: date, scope: str) -> date | None:
    """The date a scope planner works from. Usually `day`; for a frozen occurrence no segment
    generates (R4): the lineage's first generated date ("all") or the next one ("following")."""
    from unihelper.domain.recurrence import occurrence_dates
    from unihelper.domain.scopes import segment_for

    if segment_for(lin.segments, day) is not None:
        return day
    if scope == "this":
        return None
    candidates: list[date] = []
    for s in lin.segments:
        lo = s.start_date if scope == "all" else max(day, s.start_date)
        dates = occurrence_dates(s.rule, s.semester_end, lo, date.max)[:1]
        candidates += dates
    return min(candidates) if candidates else None


def check_target_version(lin: Lineage, day: date, scope: str, version: int) -> None:
    """If-Match of a scoped edit/delete: the exception's version for "this" when there is
    one, else the version of the segment holding `day` — for a frozen occurrence no segment
    generates, its exception ("this") or the lineage's last segment (as `seriesVersion`)."""
    from unihelper.api.deps import check_version
    from unihelper.api.errors import not_found
    from unihelper.domain.scopes import segment_for
    from unihelper.services.class_service import _check_target_version

    if segment_for(lin.segments, day) is not None:
        _check_target_version(version, scope, day, lin.segments, lin.rows, lin.exc_rows)
        return
    exc = lin.exc_rows.get(day)
    if exc is None or exc.kind != "modified" or not exc.detached or not lin.rows:
        raise not_found("Session")
    check_version(version, exc.version if scope == "this" else lin.rows[-1].version)
