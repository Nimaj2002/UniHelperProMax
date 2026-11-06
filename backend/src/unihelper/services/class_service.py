"""Classes (series) — creation with inline hierarchy, reads, and (US4) scoped edits."""

from __future__ import annotations

from datetime import time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.domain.recurrence import Rule, RuleError, rule_of, validate_rule
from unihelper.models import ClassLink, ClassSeries, Course, Semester, User
from unihelper.models.base import new_id
from unihelper.schemas.classes import (
    ClassCreate,
    Link,
    RefId,
    RefNewCourse,
    RefNewSemester,
    RefNewYear,
    parse_hhmm,
)
from unihelper.services import hierarchy_service as hs
from unihelper.services.series_apply import SeriesRepo, apply_changeset
from unihelper.storage.storage_service import StorageService


def rule_error(err: RuleError) -> ApiError:
    return ApiError(
        422,
        err.code,
        err.message,
        errors=[{"field": err.field, "code": err.code, "message": err.message}],
    )


def series_rule(s: ClassSeries) -> Rule:
    return rule_of(s)


def _fmt(t: time) -> str:
    return t.strftime("%H:%M")


def series_out(s: ClassSeries) -> dict[str, Any]:
    end: dict[str, Any] | None = None
    if s.freq == "weekly" and s.end_kind != "never":
        end = {"kind": s.end_kind, "untilDate": s.until_date, "count": s.count}
    return {
        "id": s.id,
        "lineage_id": s.lineage_id,
        "course_id": s.course_id,
        "title": s.title,
        "location": s.location,
        "color": s.color,
        "start_date": s.start_date,
        "start_time": _fmt(s.start_time),
        "end_time": _fmt(s.end_time),
        "links": [{"label": link.label, "url": link.url} for link in s.links],
        "recurrence": {
            "freq": s.freq,
            "interval_weeks": s.interval_weeks,
            "by_weekday": list(s.weekdays),
            "end": end,
        },
        "version": s.version,
    }


# ---- course reference resolution (inline creation, FR-014) -------------------------------


def resolve_semester(
    db: Session,
    storage: StorageService,
    user: User,
    ref: RefId | RefNewSemester,
    created: dict[str, str],
) -> Semester:
    """An existing semester, or one (and its year) created inline. Ids of the rows this call
    created go into `created` (`year_id`, `semester_id`) for the quick form's Undo (009 R10)."""
    if isinstance(ref, RefId):
        return hs.get_semester(db, user, ref.id)
    ns = ref.new
    if isinstance(ns.year, RefId):
        year = hs.get_year(db, user, ns.year.id)
    else:
        assert isinstance(ns.year, RefNewYear)
        year, made = hs.get_or_create_year(db, storage, user, ns.year.new.name)
        if made:
            created["year_id"] = year.id
    semester, made = hs.get_or_create_semester(
        db, storage, user, year, ns.name, ns.start_date, ns.end_date
    )
    if made:
        created["semester_id"] = semester.id
    return semester


def _resolve_course(
    db: Session,
    storage: StorageService,
    user: User,
    ref: RefId | RefNewCourse,
    color: str,
    created: dict[str, str],
) -> tuple[Course, Semester]:
    if isinstance(ref, RefId):
        course = hs.get_course(db, user, ref.id)
        semester, _ = hs.course_parents(db, course)
        return course, semester
    new_course = ref.new
    semester = resolve_semester(db, storage, user, new_course.semester, created)
    course, made = hs.get_or_create_course(db, storage, user, semester, new_course.name, color)
    if made:
        created["course_id"] = course.id
    return course, semester


def _insert_series(db: Session, user: User, course: Course, body: ClassCreate) -> ClassSeries:
    sid = new_id()
    rec = body.recurrence
    end = rec.end
    weekly = rec.freq == "weekly"
    series = ClassSeries(
        id=sid,
        user_id=user.id,
        course_id=course.id,
        lineage_id=sid,
        title=(body.title or "").strip() or None,
        location=(body.location or "").strip() or None,
        color=body.color,
        start_date=body.start_date,
        start_time=parse_hhmm(body.start_time),
        end_time=parse_hhmm(body.end_time),
        freq=rec.freq,
        interval_weeks=rec.interval_weeks if weekly else 1,
        by_weekday=",".join(rec.by_weekday) if weekly else "",
        end_kind=(end.kind if weekly and end else "never"),
        until_date=(end.until_date if weekly and end and end.kind == "until" else None),
        count=(end.count if weekly and end and end.kind == "count" else None),
    )
    series.links = [
        ClassLink(label=(link.label or "").strip() or None, url=link.url, position=i)
        for i, link in enumerate(body.links)
    ]
    db.add(series)
    db.flush()
    return series


def _rule_from_body(body: ClassCreate) -> Rule:
    rec = body.recurrence
    end = rec.end
    weekly = rec.freq == "weekly"
    return Rule(
        freq=rec.freq,
        interval_weeks=rec.interval_weeks,
        by_weekday=tuple(rec.by_weekday),
        end_kind=(end.kind if weekly and end else ("never" if not weekly else "until")),
        until_date=end.until_date if end else None,
        count=end.count if end else None,
        start_date=body.start_date,
        start_time=parse_hhmm(body.start_time),
        end_time=parse_hhmm(body.end_time),
    )


def create_class(
    db: Session,
    storage: StorageService,
    user: User,
    body: ClassCreate,
    created: dict[str, str] | None = None,
) -> ClassSeries:
    """One transaction: optional year/semester/course creation + the series (FR-026). Ids of
    the hierarchy rows it created are added to `created` (009 research R10)."""
    rule = _rule_from_body(body)
    if rule.end_time <= rule.start_time:  # fail fast before creating any hierarchy rows
        raise rule_error(
            RuleError("/endTime", "invalid_time_range", "End time must be after the start time.")
        )
    course, semester = _resolve_course(
        db, storage, user, body.course, body.color, created if created is not None else {}
    )
    try:
        validate_rule(rule, semester.end_date)
    except RuleError as err:
        raise rule_error(err) from err
    is_first = (
        db.scalar(
            select(func.count()).select_from(ClassSeries).where(ClassSeries.course_id == course.id)
        )
        == 0
    )
    series = _insert_series(db, user, course, body)
    if is_first:
        course.default_color = body.color  # FR-021: first class colour becomes the default
    return series


def lineage_segments(db: Session, user: User, lineage_id: str) -> list[ClassSeries]:
    segs = list(
        db.scalars(
            select(ClassSeries)
            .where(ClassSeries.lineage_id == lineage_id, ClassSeries.user_id == user.id)
            .order_by(ClassSeries.start_date)
        )
    )
    if not segs:
        raise not_found("Class")
    return segs


def exception_count(db: Session, lineage_id: str) -> int:
    from unihelper.services import session_query

    return session_query.count_exceptions(db, lineage_id)


def get_lineage(db: Session, user: User, lineage_id: str) -> dict[str, Any]:
    segs = lineage_segments(db, user, lineage_id)
    course = hs.get_course(db, user, segs[0].course_id)
    semester, year = hs.course_parents(db, course)
    return {
        "lineage_id": lineage_id,
        "course": course_detail(course, semester, year),
        "segments": [series_out(s) for s in segs],
        "exception_count": exception_count(db, lineage_id),
    }


def course_detail(course: Course, semester: Semester, year: Any) -> dict[str, Any]:
    from unihelper.schemas.hierarchy import CourseDetail

    return CourseDetail.model_validate(
        {
            "id": course.id,
            "semester_id": course.semester_id,
            "name": course.name,
            "folder_name": course.folder_name,
            "default_color": course.default_color,
            "reserved_name_conflict": course.reserved_name_conflict,
            "version": course.version,
            "year": year,
            "semester": semester,
        }
    ).model_dump(by_alias=True, mode="json")


def links_of(s: ClassSeries) -> list[Link]:
    return [Link(label=link.label, url=link.url) for link in s.links]


# ---- scoped edits and deletes (US4, FR-018a) ------------------------------------------------

CLASS_REPO = SeriesRepo(series=ClassSeries, link=ClassLink, owner_fields=("course_id",))


def _lineage_state(
    db: Session, user: User, key: str
) -> tuple[str, Any, list[ClassSeries], list[Any], dict[Any, Any]]:
    from unihelper.domain.recurrence import parse_session_key
    from unihelper.domain.scopes import Segment, segment_of
    from unihelper.models import SessionException

    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    rows = list(
        db.scalars(
            select(ClassSeries)
            .where(ClassSeries.lineage_id == lineage_id, ClassSeries.user_id == user.id)
            .order_by(ClassSeries.start_date)
        )
    )
    if not rows:
        raise not_found("Session")
    sem_end: dict[str, Any] = {}
    segments: list[Segment] = []
    for s in rows:
        if s.course_id not in sem_end:
            course = db.get(Course, s.course_id)
            semester = db.get(Semester, course.semester_id) if course else None
            sem_end[s.course_id] = semester.end_date if semester else None
        segments.append(segment_of(s, sem_end[s.course_id]))
    exc_rows = {
        e.original_date: e
        for e in db.scalars(
            select(SessionException).where(SessionException.lineage_id == lineage_id)
        )
    }
    return lineage_id, day, rows, segments, exc_rows


def _changes_from(body: Any) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    for name in body.model_fields_set:
        value = getattr(body, name)
        if name in ("start_time", "end_time"):
            if value is None:
                continue
            changes[name] = parse_hhmm(value)
        elif name in ("title", "location"):
            changes[name] = (value or "").strip() or None
        elif name == "links":
            changes[name] = [((link.label or "").strip() or None, link.url) for link in value or []]
        elif name == "recurrence":
            if value is None:
                continue
            end = value.end
            changes[name] = {
                "freq": value.freq,
                "interval_weeks": value.interval_weeks,
                "by_weekday": list(value.by_weekday),
                "end": {"kind": end.kind, "until_date": end.until_date, "count": end.count}
                if end
                else None,
            }
        elif name == "color" and value is not None:
            changes[name] = value
    return changes


def _check_target_version(
    version: int,
    scope: str,
    day: Any,
    segments: list[Any],
    rows: list[ClassSeries],
    exc_rows: dict[Any, Any],
) -> None:
    from unihelper.api.deps import check_version
    from unihelper.domain.scopes import segment_for

    target = segment_for(segments, day)
    if target is None:
        raise not_found("Session")
    existing = exc_rows.get(day)
    if existing is not None and existing.kind == "cancelled":
        raise not_found("Session")
    if scope == "this" and existing is not None:
        check_version(version, existing.version)
    else:
        check_version(version, next(r for r in rows if r.id == target.id).version)


def _scope_api_error(err: Any) -> ApiError:
    if err.code == "not_found":
        return not_found("Session")
    return ApiError(
        422,
        err.code,
        err.message,
        errors=[{"field": err.field, "code": err.code, "message": err.message}],
    )


def apply_scope_edit(
    db: Session, user: User, key: str, scope: str, body: Any, version: int
) -> dict[str, Any]:
    from unihelper.domain.scopes import ScopeError, plan_edit

    lineage_id, day, rows, segments, exc_rows = _lineage_state(db, user, key)
    _check_target_version(version, scope, day, segments, rows, exc_rows)
    exceptions = [e for e in _exception_views(exc_rows)]
    try:
        cs = plan_edit(segments, exceptions, day, scope, _changes_from(body))
    except ScopeError as err:
        raise _scope_api_error(err) from err
    if body.date is not None:  # move this one session to another day
        if scope != "this":
            raise _scope_api_error(
                ScopeError("/date", "field_not_allowed", "Only a single session can move.")
            )
        cs.exception_upserts[day]["moved_date"] = None if body.date == day else body.date
    affected = apply_changeset(
        db, cs, CLASS_REPO, user=user, lineage_id=lineage_id, rows=rows, exc_rows=exc_rows
    )
    return {
        "lineage_id": lineage_id,
        "affected_series_ids": affected,
        "preserved_overrides": cs.preserved_overrides,
        "removed_overrides": cs.removed_overrides,
        "unchanged_count": cs.preserved_overrides,
    }


def _exception_views(exc_rows: dict[Any, Any]) -> list[Any]:
    from unihelper.domain.recurrence import ExceptionView

    return [
        ExceptionView(
            original_date=e.original_date,
            kind=e.kind,
            start_time=e.start_time,
            end_time=e.end_time,
            location=e.location,
            version=e.version,
        )
        for e in exc_rows.values()
    ]
