"""Events (009): series owned by a semester, sharing 001's recurrence and scope planners
(research R2). Creation with inline year/semester, and reads. Occurrences are listed by
`session_query` and served by the `sessionKey` APIs like class sessions."""

from __future__ import annotations

import json
from datetime import date, time
from typing import Any

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.domain.recurrence import Rule, RuleError, rule_of, validate_rule
from unihelper.models import (
    Document,
    EventLink,
    EventSeries,
    Note,
    Recording,
    SessionException,
    SessionFolder,
    User,
)
from unihelper.models.base import new_id
from unihelper.schemas.classes import parse_hhmm
from unihelper.schemas.events import EventCreate
from unihelper.services import hierarchy_service as hs
from unihelper.services.class_service import resolve_semester, rule_error
from unihelper.services.series_apply import SeriesRepo, apply_changeset
from unihelper.storage.storage_service import StorageService


def _fmt(t: time) -> str:
    return t.strftime("%H:%M")


EVENT_REPO = SeriesRepo(series=EventSeries, link=EventLink, owner_fields=("semester_id",))


def _rule_from_body(body: EventCreate) -> Rule:
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


def create_event(
    db: Session, storage: StorageService, user: User, body: EventCreate
) -> tuple[EventSeries, dict[str, str]]:
    """One transaction: optional year/semester creation + the first segment. Returns the series
    and the ids of the hierarchy rows this request created (research R10)."""
    rule = _rule_from_body(body)
    if rule.end_time <= rule.start_time:  # fail fast before creating any hierarchy rows
        raise rule_error(
            RuleError("/endTime", "invalid_time_range", "End time must be after the start time.")
        )
    created: dict[str, str] = {}
    semester = resolve_semester(db, storage, user, body.semester, created)
    try:
        validate_rule(rule, semester.end_date)
    except RuleError as err:
        raise rule_error(err) from err
    sid = new_id()
    weekly = rule.freq == "weekly"
    series = EventSeries(
        id=sid,
        user_id=user.id,
        semester_id=semester.id,
        lineage_id=sid,
        title=body.title,
        location=(body.location or "").strip() or None,
        color=body.color,
        start_date=body.start_date,
        start_time=rule.start_time,
        end_time=rule.end_time,
        freq=rule.freq,
        interval_weeks=rule.interval_weeks if weekly else 1,
        by_weekday=",".join(rule.by_weekday) if weekly else "",
        end_kind=rule.end_kind if weekly else "never",
        until_date=rule.until_date if weekly and rule.end_kind == "until" else None,
        count=rule.count if weekly and rule.end_kind == "count" else None,
    )
    series.links = [
        EventLink(label=(link.label or "").strip() or None, url=link.url, position=i)
        for i, link in enumerate(body.links)
    ]
    db.add(series)
    db.flush()
    if body.add_to_board is not None:
        _add_first_occurrence_to_board(db, user, series, body.add_to_board.column_id)
    return series, created


def _add_first_occurrence_to_board(
    db: Session, user: User, series: EventSeries, column_id: str
) -> None:
    """012 FR-035/FR-037: a task linked to the first occurrence only (same transaction)."""
    from unihelper.schemas.tasks import TaskCreate
    from unihelper.services import lineage as lineage_mod
    from unihelper.services import task_column_service as tcs
    from unihelper.services import task_service

    tcs.get_column(db, user, column_id)  # 404 before the task is made
    lin = lineage_mod.load(db, user, series.lineage_id, "event")
    views = lin.occurrences(user.timezone) if lin is not None else []
    if not views:  # pragma: no cover - a valid rule always schedules a first occurrence
        return
    first = min(views, key=lambda v: v.key[-10:])
    task_service.create_task(db, user, TaskCreate(column_id=column_id, event_key=first.key))


def segment_out(s: EventSeries) -> dict[str, Any]:
    end: dict[str, Any] | None = None
    if s.freq == "weekly" and s.end_kind != "never":
        end = {"kind": s.end_kind, "untilDate": s.until_date, "count": s.count}
    return {
        "id": s.id,
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


def lineage_segments(db: Session, user: User, lineage_id: str) -> list[EventSeries]:
    segs = list(
        db.scalars(
            select(EventSeries)
            .where(EventSeries.lineage_id == lineage_id, EventSeries.user_id == user.id)
            .order_by(EventSeries.start_date)
        )
    )
    if not segs:
        raise not_found("Event")
    return segs


def has_content(db: Session, user: User, lineage_id: str) -> bool:
    """Any occurrence of the lineage (not in the Trash) holds a note, recording or document —
    the semester is then locked (FR-018)."""
    folder_ids = select(SessionFolder.id).where(
        SessionFolder.user_id == user.id,
        SessionFolder.lineage_id == lineage_id,
        SessionFolder.trash_entry_id.is_(None),
    )
    return bool(
        db.scalar(
            select(
                or_(
                    exists().where(Note.session_folder_id.in_(folder_ids)),
                    exists().where(Recording.session_folder_id.in_(folder_ids)),
                    exists().where(Document.session_folder_id.in_(folder_ids)),
                )
            )
        )
    )


def get_event(db: Session, user: User, lineage_id: str) -> dict[str, Any]:
    from unihelper.services import session_query

    segs = lineage_segments(db, user, lineage_id)
    semester = hs.get_semester(db, user, segs[0].semester_id)
    year = hs.get_year(db, user, semester.year_id)
    return {
        "lineage_id": lineage_id,
        "semester_id": semester.id,
        "semester_name": semester.name,
        "year_name": year.name,
        "segments": [segment_out(s) for s in segs],
        "exception_count": session_query.count_exceptions(db, lineage_id),
        "semester_locked": has_content(db, user, lineage_id),
    }


# ---- scoped edits (US3, research R3/R4) -------------------------------------------------------

SEMESTER_LOCKED = (
    "The semester can't be changed because this event has notes, recordings or documents."
)


def _folders_with_content(db: Session, user: User, lineage_id: str) -> set[date]:
    """Original dates of the lineage's occurrences (not in the Trash) holding content."""
    folders = select(SessionFolder.id).where(
        SessionFolder.user_id == user.id,
        SessionFolder.lineage_id == lineage_id,
        SessionFolder.trash_entry_id.is_(None),
    )
    ids: set[str] = set()
    for model in (Note, Recording, Document):
        ids |= set(
            db.scalars(select(model.session_folder_id).where(model.session_folder_id.in_(folders)))
        )
    if not ids:
        return set()
    return set(db.scalars(select(SessionFolder.original_date).where(SessionFolder.id.in_(ids))))


def change_semester(
    db: Session, storage: StorageService, user: User, lin: Any, semester_id: str
) -> bool:
    """Move the whole series to another semester (FR-017). Refused with 409 `semester_locked`
    while any occurrence has content (FR-018); its empty folders move along (directories
    renamed, undone if the transaction fails). Returns whether anything changed."""
    from unihelper.db.engine import on_rollback
    from unihelper.domain.naming import EVENTS_DIR, unique_sibling
    from unihelper.services.trash_service import folder_parts

    target = hs.get_semester(db, user, semester_id)
    if all(r.semester_id == target.id for r in lin.rows):
        return False
    if has_content(db, user, lin.lineage_id):
        raise ApiError(
            409,
            "semester_locked",
            SEMESTER_LOCKED,
            errors=[
                {"field": "/semesterId", "code": "semester_locked", "message": SEMESTER_LOCKED}
            ],
        )
    for r in lin.rows:
        try:
            validate_rule(rule_of(r), target.end_date)
        except RuleError as err:
            raise rule_error(err) from err
    year = hs.get_year(db, user, target.year_id)
    parent = [*hs.semester_parts(user, year, target), EVENTS_DIR]
    taken = list(
        db.scalars(select(SessionFolder.folder_name).where(SessionFolder.semester_id == target.id))
    )
    for f in db.scalars(
        select(SessionFolder).where(
            SessionFolder.user_id == user.id,
            SessionFolder.lineage_id == lin.lineage_id,
            SessionFolder.trash_entry_id.is_(None),
        )
    ):
        source = folder_parts(db, user, f)
        name = unique_sibling(f.folder_name, taken)
        while storage.exists([*parent, name]):
            taken.append(name)
            name = unique_sibling(f.folder_name, taken)
        taken.append(name)
        if source is not None and storage.exists(source):
            on_rollback(db, storage.rename_dir(source, [*parent, name]))
        f.semester_id = target.id
        f.folder_name = name
        f.folder_key = name.casefold()
    for r in lin.rows:
        r.semester_id = target.id
    db.flush()
    _sync_tasks(db, user, lin.lineage_id)
    return True


def _sync_tasks(db: Session, user: User, lineage_id: str) -> None:
    """012 R4: linked tasks follow every change of their occurrence."""
    from unihelper.services import task_link_service

    task_link_service.sync_lineage(db, user, lineage_id)


def _scope_error(field: str, code: str, message: str) -> ApiError:
    return ApiError(422, code, message, errors=[{"field": field, "code": code, "message": message}])


def _links_json(pairs: Any) -> str | None:
    if pairs is None:
        return None
    return json.dumps([{"label": label, "url": url} for label, url in pairs])


def _this_values(
    changes: dict[str, Any], body: Any, day: date, existing: SessionException | None
) -> dict[str, Any]:
    """A modified exception's columns after a "This event" edit (merged with what it had)."""

    def keep(col: str) -> Any:
        return (
            getattr(existing, col) if existing is not None and existing.kind == "modified" else None
        )

    values = {
        col: keep(col)
        for col in (
            "start_time",
            "end_time",
            "location",
            "title",
            "color",
            "links_json",
            "moved_date",
        )
    }
    values["detached"] = bool(keep("detached"))
    for col in ("start_time", "end_time", "location", "title", "color"):
        if col in changes:
            values[col] = changes[col]
    if "links" in changes:
        values["links_json"] = _links_json(changes["links"])
    if "date" in body.model_fields_set and body.date is not None:
        values["moved_date"] = None if body.date == day else body.date
    values["kind"] = "modified"
    return values


def _frozen_values(view: Any, row: EventSeries) -> dict[str, Any]:
    """Everything an occurrence shows now, so a series edit cannot change it (R4)."""
    links = view.links if view.links is not None else tuple((lk.label, lk.url) for lk in row.links)
    return {
        "kind": "modified",
        "start_time": view.start.time(),
        "end_time": view.end.time(),
        "location": view.location,
        "title": view.title or row.title,
        "color": view.color or row.color,
        "links_json": _links_json(links),
        "moved_date": view.date if view.date != date.fromisoformat(view.key[-10:]) else None,
        "detached": True,
    }


def apply_scope_edit(
    db: Session,
    storage: StorageService,
    user: User,
    key: str,
    scope: str,
    body: Any,
    version: int,
) -> dict[str, Any]:
    """`PATCH /sessions/{key}` for an event occurrence (FR-016–FR-020)."""
    from unihelper.domain.recurrence import parse_session_key
    from unihelper.domain.scopes import ScopeError, plan_edit
    from unihelper.services import lineage as lineage_mod
    from unihelper.services.class_service import _changes_from, _scope_api_error

    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    lin = lineage_mod.load(db, user, lineage_id, "event")
    if lin is None or not lin.rows:
        raise not_found("Session")
    views = {v.key: v for v in lin.occurrences(user.timezone)}
    if key not in views:
        raise not_found("Session")
    lineage_mod.check_target_version(lin, day, scope, version)
    changes = _changes_from(body)
    changes.pop("semester_id", None)
    changes.pop("date", None)
    if "title" in changes and not changes["title"]:
        raise _scope_error("/title", "title_required", "Enter a title.")

    moved = False
    if body.semester_id is not None:
        moved = change_semester(db, storage, user, lin, body.semester_id)
        if moved:
            lin = lineage_mod.load(db, user, lineage_id, "event")
            assert lin is not None
    affected: list[str] = [r.id for r in lin.rows] if moved else []
    result = {"preserved": 0, "removed": 0, "unchanged": 0}

    if scope == "this":
        if "recurrence" in changes:
            raise _scope_error(
                "/recurrence",
                "field_not_allowed",
                "Repetition can only change for this and following events or all events.",
            )
        existing = lin.exc_rows.get(day)
        values = _this_values(changes, body, day, existing)
        row = next(r for r in lin.rows if r.id == views[key].series_id)
        st = values["start_time"] or row.start_time
        et = values["end_time"] or row.end_time
        if et <= st:
            raise _scope_error(
                "/endTime", "invalid_time_range", "End time must be after the start time."
            )
        if existing is None:
            db.add(
                SessionException(
                    user_id=user.id, lineage_id=lineage_id, original_date=day, **values
                )
            )
        else:
            for k, v in values.items():
                setattr(existing, k, v)
        db.flush()
    else:
        cs = None
        if changes:
            pday = lineage_mod.planner_day(lin, day, scope)
            if pday is None:
                raise not_found("Session")
            try:
                cs = plan_edit(lin.segments, lin.exceptions, pday, scope, changes)
            except ScopeError as err:
                raise _scope_api_error(err) from err
            # R4: occurrences with content or edited individually keep what they show now;
            # the occurrence being edited is the one the user changes
            content = _folders_with_content(db, user, lineage_id)
            rows = {r.id: r for r in lin.rows}
            for k, v in views.items():
                d = date.fromisoformat(k[-10:])
                if k == key or (scope == "following" and d < day):
                    continue
                exc = lin.exc_rows.get(d)
                individually = exc is not None and exc.kind == "modified"
                if d not in content and not individually:
                    continue
                result["unchanged"] += 1
                cs.exception_deletes.discard(d)
                if exc is not None and exc.detached:
                    continue  # already frozen
                cs.exception_upserts[d] = _frozen_values(v, rows[v.series_id])
            target_exc = lin.exc_rows.get(day)
            if (
                target_exc is not None
                and target_exc.kind == "modified"
                and day not in cs.exception_upserts
            ):
                for col in ("start_time", "end_time", "location", "title", "color"):
                    if col in changes and getattr(target_exc, col) is not None:
                        setattr(target_exc, col, changes[col])
                if "links" in changes and target_exc.links_json is not None:
                    target_exc.links_json = _links_json(changes["links"])
            affected += apply_changeset(
                db,
                cs,
                EVENT_REPO,
                user=user,
                lineage_id=lineage_id,
                rows=lin.rows,
                exc_rows=lin.exc_rows,
            )
            result["preserved"] = cs.preserved_overrides
            result["removed"] = cs.removed_overrides
        if "date" in body.model_fields_set and body.date is not None:
            fresh = lineage_mod.load(db, user, lineage_id, "event")
            assert fresh is not None
            existing = fresh.exc_rows.get(day)
            values = _this_values({}, body, day, existing)
            if existing is None:
                db.add(
                    SessionException(
                        user_id=user.id, lineage_id=lineage_id, original_date=day, **values
                    )
                )
            else:
                for k, v in values.items():
                    setattr(existing, k, v)
            db.flush()
    _sync_tasks(db, user, lineage_id)
    return {
        "lineage_id": lineage_id,
        "affected_series_ids": list(dict.fromkeys(affected)),
        "preserved_overrides": result["preserved"],
        "removed_overrides": result["removed"],
        "unchanged_count": result["unchanged"],
    }
