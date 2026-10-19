"""The Trash (009 research R6): every deletion of a class or event moves what it removed here.

- `move_to_trash` (DELETE /sessions/{key}) and `move_lineage_to_trash` (hierarchy deletes) run
  the scope planner, keep the before-images (`TrashPayloadV1`), apply the change and mark the
  content folders of the removed occurrences (`trash_entry_id`, `origin_path`). Files are never
  touched.
- `restore` puts the lineage back exactly (same keys), reusing or recreating its year, semester
  and course by name, and re-attaches the folders (moving a directory only when its readable
  path changed; never over an existing one).
- `purge` is the only place a class or event's files are removed (`StorageService.delete_tree`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, time
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import delete, exists, func, select
from sqlalchemy.orm import Session

from unihelper.api.deps import check_version
from unihelper.api.errors import ApiError, not_found
from unihelper.db.engine import on_rollback
from unihelper.domain.naming import EVENTS_DIR, unique_sibling
from unihelper.domain.recurrence import SessionView, parse_session_key, session_key
from unihelper.domain.scopes import ChangeSet, ScopeError, plan_delete
from unihelper.domain.trash_payload import (
    BeforeState,
    ExceptionImage,
    Owner,
    Removed,
    SegmentImage,
    TrashPayloadV1,
    build,
)
from unihelper.models import (
    CalendarImportSource,
    ClassSeries,
    Course,
    Document,
    EventSeries,
    Note,
    Recording,
    Semester,
    SessionException,
    SessionFolder,
    TrashEntry,
    User,
    WorkspaceState,
    Year,
)
from unihelper.services import hierarchy_service as hs
from unihelper.services import lineage as lineage_mod
from unihelper.services import task_link_service
from unihelper.services.class_service import _scope_api_error
from unihelper.services.lineage import Lineage
from unihelper.services.series_apply import apply_changeset
from unihelper.services.task_link_service import LinkedTasks
from unihelper.storage.storage_service import StoragePathError, StorageService

# ---- paths of session/event folders ----------------------------------------------------------


def folder_parts(db: Session, user: User, folder: SessionFolder) -> list[str] | None:
    """Where the folder's directory is now: under its course / semester `_Events` while it has
    one, otherwise at the `origin_path` recorded when its parents were deleted."""
    if folder.kind == "class" and folder.course_id is not None:
        course = db.get(Course, folder.course_id)
        if course is not None:
            semester, year = hs.course_parents(db, course)
            return [*hs.course_parts(user, year, semester, course), folder.folder_name]
    if folder.kind == "event" and folder.semester_id is not None:
        sem = db.get(Semester, folder.semester_id)
        sem_year = db.get(Year, sem.year_id) if sem else None
        if sem is not None and sem_year is not None:
            return [*hs.semester_parts(user, sem_year, sem), EVENTS_DIR, folder.folder_name]
    if folder.origin_path:
        return [user.username, *PurePosixPath(folder.origin_path).parts]
    return None


def _relative(parts: Sequence[str]) -> str:
    return StorageService.relative_path(parts)


# ---- counts ----------------------------------------------------------------------------------


@dataclass
class Counts:
    notes: int = 0
    recordings: int = 0
    documents: int = 0


def _count(db: Session, model: Any, folder_ids: Sequence[str]) -> int:
    if not folder_ids:
        return 0
    return int(
        db.scalar(
            select(func.count())
            .select_from(model)
            .where(model.session_folder_id.in_(list(folder_ids)))
        )
        or 0
    )


def content_counts(db: Session, folder_ids: Sequence[str]) -> Counts:
    return Counts(
        notes=_count(db, Note, folder_ids),
        recordings=_count(db, Recording, folder_ids),
        documents=_count(db, Document, folder_ids),
    )


# ---- what a scoped delete removes ------------------------------------------------------------


def _removed_by(views: list[SessionView], scope: str, day: date) -> list[SessionView]:
    """Occurrences a `plan_delete` takes off the calendar, by original date (the key): the
    target ("this"), every one from the target on ("following"), all of them ("all")."""
    out = []
    for v in views:
        original = parse_session_key(v.key)
        assert original is not None
        d = original[1]
        if scope == "all" or (scope == "this" and d == day) or (scope == "following" and d >= day):
            out.append(v)
    return out


def _live_folders(db: Session, user: User, lineage_id: str) -> list[SessionFolder]:
    return list(
        db.scalars(
            select(SessionFolder).where(
                SessionFolder.user_id == user.id,
                SessionFolder.lineage_id == lineage_id,
                SessionFolder.trash_entry_id.is_(None),
            )
        )
    )


def _folders_for(folders: list[SessionFolder], scope: str, day: date) -> list[SessionFolder]:
    if scope == "all":
        return folders
    if scope == "following":
        return [f for f in folders if f.original_date >= day]
    return [f for f in folders if f.original_date == day]


@dataclass
class _Plan:
    lin: Lineage
    day: date
    scope: str
    cs: ChangeSet
    removed: list[SessionView]
    folders: list[SessionFolder]


def delete_changeset(lin: Lineage, day: date, scope: str) -> ChangeSet:
    """`plan_delete`, also from a frozen occurrence (`detached`, R4) that no segment
    generates: "this" drops its exception; "following" plans from the next generated date
    and drops every exception from `day` on."""
    if scope == "all":
        return ChangeSet(
            deletes=[r.id for r in lin.rows],
            exception_deletes=set(lin.exc_rows),
            removed_overrides=sum(1 for e in lin.exc_rows.values() if e.kind == "modified"),
        )
    pday = lineage_mod.planner_day(lin, day, scope)
    if pday is None:
        drop = {d for d in lin.exc_rows if d == day or (scope == "following" and d >= day)}
        return ChangeSet(exception_deletes=drop)
    try:
        cs = plan_delete(lin.segments, lin.exceptions, pday, scope)
    except ScopeError as err:
        raise _scope_api_error(err) from err
    if scope == "following":
        cs.exception_deletes |= {d for d in lin.exc_rows if d >= day}
    return cs


def _plan(db: Session, user: User, key: str, scope: str, version: int | None) -> _Plan:
    parsed = parse_session_key(key)
    if parsed is None:
        raise not_found("Session")
    lineage_id, day = parsed
    lin = lineage_mod.load(db, user, lineage_id)
    if lin is None or not lin.rows:
        raise not_found("Session")
    views = lin.occurrences(user.timezone)
    if not any(v.key == key for v in views):
        raise not_found("Session")
    if version is not None:
        lineage_mod.check_target_version(lin, day, scope, version)
    cs = delete_changeset(lin, day, scope)
    removed = _removed_by(views, scope, day)
    folders = _folders_for(_live_folders(db, user, lineage_id), scope, day)
    return _Plan(lin, day, scope, cs, removed, folders)


def deletion_impact(db: Session, user: User, key: str, scope: str) -> dict[str, Any]:
    """What `DELETE /sessions/{key}?scope=` would move to the Trash (R7)."""
    p = _plan(db, user, key, scope, None)
    counts = content_counts(db, [f.id for f in p.folders])
    linked = (
        task_link_service.linked_count(db, user, keys=[v.key for v in p.removed])
        if p.lin.kind == "event"
        else 0
    )
    return {
        "kind": p.lin.kind,
        "occurrences": len(p.removed),
        "notes": counts.notes,
        "recordings": counts.recordings,
        "documents": counts.documents,
        "linked_task_count": linked,
    }


# ---- moving to the Trash ---------------------------------------------------------------------


def _segment_image(r: Any) -> SegmentImage:
    return SegmentImage(
        id=r.id,
        split_from_id=r.split_from_id,
        title=r.title,
        location=r.location,
        color=r.color,
        start_date=r.start_date,
        start_time=r.start_time,
        end_time=r.end_time,
        freq=r.freq,
        interval_weeks=r.interval_weeks,
        by_weekday=r.by_weekday,
        end_kind=r.end_kind,
        until_date=r.until_date,
        count=r.count,
        version=r.version,
        links=tuple((link.label, link.url) for link in r.links),
    )


def _exception_image(e: SessionException) -> ExceptionImage:
    return ExceptionImage(
        original_date=e.original_date,
        kind=e.kind,
        start_time=e.start_time,
        end_time=e.end_time,
        location=e.location,
        title=e.title,
        color=e.color,
        links_json=e.links_json,
        moved_date=e.moved_date,
        detached=bool(e.detached),
        version=e.version,
    )


@dataclass
class _OwnerRows:
    year: Year
    semester: Semester
    course: Course | None


def _owner_rows(
    db: Session, kind: str, rows: list[Any], folders: list[SessionFolder]
) -> _OwnerRows | None:
    course: Course | None = None
    semester: Semester | None = None
    if kind == "class":
        course_id = rows[0].course_id if rows else next((f.course_id for f in folders), None)
        course = db.get(Course, course_id) if course_id else None
        if course is None:
            return None
        semester = db.get(Semester, course.semester_id)
    else:
        sem_id = rows[0].semester_id if rows else next((f.semester_id for f in folders), None)
        semester = db.get(Semester, sem_id) if sem_id else None
    if semester is None:
        return None
    year = db.get(Year, semester.year_id)
    assert year is not None
    return _OwnerRows(year=year, semester=semester, course=course)


def _owner_image(o: _OwnerRows) -> Owner:
    return Owner(
        year_id=o.year.id,
        year_name=o.year.name,
        semester_id=o.semester.id,
        semester_name=o.semester.name,
        semester_start=o.semester.start_date,
        semester_end=o.semester.end_date,
        course_id=o.course.id if o.course else None,
        course_name=o.course.name if o.course else None,
        course_color=o.course.default_color if o.course else None,
    )


def _label(lin: Lineage, owner: _OwnerRows, removed: list[SessionView]) -> str:
    """The course name for a class; the (first removed occurrence's) title for an event."""
    if lin.kind == "class" and owner.course is not None:
        return owner.course.name
    rows = {r.id: r for r in lin.rows}
    for v in removed:
        title = v.title or (rows[v.series_id].title if v.series_id in rows else None)
        if title:
            return str(title)
    return str(lin.rows[0].title) if lin.rows else "Event"


def _trash(
    db: Session,
    user: User,
    lin: Lineage,
    cs: ChangeSet,
    removed: list[SessionView],
    folders: list[SessionFolder],
    reason: str,
    extra_removed: Sequence[Removed] = (),
) -> tuple[TrashEntry, list[str]]:
    """Create the entry, mark the folders, apply the change. Never touches a file."""
    owner = _owner_rows(db, lin.kind, lin.rows, folders)
    if owner is None:  # pragma: no cover - rows always hang off a live course/semester
        raise not_found("Session")
    before = BeforeState(
        segments=tuple(_segment_image(r) for r in lin.rows),
        exceptions={d: _exception_image(e) for d, e in lin.exc_rows.items()},
    )
    payload = build(lin.kind, lin.lineage_id, _owner_image(owner), cs, before)
    gone = [
        Removed(original_date=parse_session_key(v.key)[1], segment_id=v.series_id)  # type: ignore[index]
        for v in removed
    ]
    gone_dates = {r.original_date for r in gone}
    gone += [r for r in extra_removed if r.original_date not in gone_dates]
    shown = sorted(v.date for v in removed) or sorted(r.original_date for r in gone)
    if not shown:
        shown = sorted(r.start_date for r in lin.rows) or [date.today()]
    counts = content_counts(db, [f.id for f in folders])
    entry = TrashEntry(
        user_id=user.id,
        kind=lin.kind,
        lineage_id=lin.lineage_id,
        label=_label(lin, owner, removed),
        year_name=owner.year.name,
        semester_name=owner.semester.name,
        course_name=owner.course.name if owner.course else None,
        first_date=shown[0],
        last_date=shown[-1],
        occurrence_count=max(len(gone), 1),
        note_count=counts.notes,
        recording_count=counts.recordings,
        document_count=counts.documents,
        reason=reason,
        payload_json=payload.to_json(),
    )
    db.add(entry)
    db.flush()
    for f in folders:
        parts = folder_parts(db, user, f)
        f.origin_path = _relative(parts) if parts else f.origin_path
        f.trash_entry_id = entry.id
    db.flush()
    affected = apply_changeset(
        db,
        cs,
        lin.repo,
        user=user,
        lineage_id=lin.lineage_id,
        rows=lin.rows,
        exc_rows=lin.exc_rows,
    )
    deleted = set(cs.deletes)
    after = {r.id: r.version for r in lin.rows if r.id not in deleted}
    times = {(v.start.time(), v.end.time()) for v in removed}
    uniform: tuple[time | None, time | None] = (
        next(iter(times)) if len(times) == 1 else (None, None)
    )
    entry.payload_json = payload.with_result(gone, after, uniform).to_json()
    db.flush()
    return entry, affected


def move_to_trash(
    db: Session,
    user: User,
    key: str,
    scope: str,
    version: int,
    linked_tasks: LinkedTasks = "keep",
) -> dict[str, Any]:
    """`DELETE /sessions/{key}` for classes and events: one Trash entry per deletion. 012:
    the removed occurrences' linked tasks are unlinked (`keep`) or go into the same entry."""
    p = _plan(db, user, key, scope, version)
    entry, affected = _trash(db, user, p.lin, p.cs, p.removed, p.folders, "delete")
    if p.lin.kind == "event":
        task_link_service.apply_choice(
            db, user, linked_tasks, entry.id, keys=[v.key for v in p.removed]
        )
        task_link_service.sync_lineage(db, user, p.lin.lineage_id)
    return {
        "lineage_id": p.lin.lineage_id,
        "affected_series_ids": affected,
        "preserved_overrides": p.cs.preserved_overrides,
        "removed_overrides": p.cs.removed_overrides,
        "unchanged_count": p.cs.preserved_overrides,
        "trash_entry_id": entry.id,
    }


def move_lineage_to_trash(
    db: Session,
    user: User,
    kind: str,
    lineage_id: str,
    reason: str = "hierarchy_delete",
    linked_tasks: LinkedTasks = "keep",
) -> TrashEntry | None:
    """A whole lineage ("all" scope) — for year/semester/course deletes. A lineage without
    segments (only unscheduled folders) gets an entry when a folder holds content; its empty
    folder rows and orphan exceptions are simply dropped (no file touched). 012: an event's
    linked tasks are unlinked (`keep`) or go into its entry."""
    entry = _move_lineage(db, user, kind, lineage_id, reason)
    if kind == "event":
        task_link_service.apply_choice(
            db, user, linked_tasks, entry.id if entry else None, lineage_ids=[lineage_id]
        )
    return entry


def _move_lineage(
    db: Session, user: User, kind: str, lineage_id: str, reason: str
) -> TrashEntry | None:
    lin = lineage_mod.load(db, user, lineage_id, kind)
    if lin is None:
        return None
    folders = _live_folders(db, user, lineage_id)
    cs = ChangeSet(deletes=[r.id for r in lin.rows], exception_deletes=set(lin.exc_rows))
    with_content = [f for f in folders if sum(vars(content_counts(db, [f.id])).values()) > 0]
    if not lin.rows and not with_content:
        for f in folders:
            db.delete(f)
        apply_changeset(
            db, cs, lin.repo, user=user, lineage_id=lineage_id, rows=[], exc_rows=lin.exc_rows
        )
        return None
    removed = lin.occurrences(user.timezone) if lin.rows else []
    extra = [Removed(f.original_date, None) for f in with_content]
    return _trash(db, user, lin, cs, removed, folders, reason, extra)[0]


def detach_folders(db: Session, user: User, folders: Sequence[SessionFolder]) -> None:
    """Before their course/semester rows are deleted: remember where each trashed folder's
    directory is (`origin_path`) and drop the owner, so the rows survive the delete."""
    for f in folders:
        parts = folder_parts(db, user, f)
        if parts is not None:
            f.origin_path = _relative(parts)
        f.course_id = None
        f.semester_id = None
    db.flush()


# ---- listing ---------------------------------------------------------------------------------


def _get_entry(db: Session, user: User, entry_id: str) -> TrashEntry:
    entry = db.get(TrashEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise not_found("Trash entry")
    return entry


def _entry_folders(db: Session, entry: TrashEntry) -> list[SessionFolder]:
    return list(
        db.scalars(
            select(SessionFolder)
            .where(SessionFolder.trash_entry_id == entry.id)
            .order_by(SessionFolder.original_date)
        )
    )


def _missing_files(
    db: Session, storage: StorageService, user: User, folders: list[SessionFolder]
) -> int:
    missing = 0
    for f in folders:
        parts = folder_parts(db, user, f)
        for model, sub in ((Note, "notes"), (Recording, "audios"), (Document, "documents")):
            for name in db.scalars(select(model.file_name).where(model.session_folder_id == f.id)):
                try:
                    if parts is None or not storage.exists([*parts, sub, name]):
                        missing += 1
                except StoragePathError:
                    missing += 1
    return missing


def entry_out(
    db: Session, storage: StorageService, user: User, entry: TrashEntry
) -> dict[str, Any]:
    payload = TrashPayloadV1.from_json(entry.payload_json)
    folders = _entry_folders(db, entry)
    counts = content_counts(db, [f.id for f in folders])
    return {
        "id": entry.id,
        "kind": entry.kind,
        "label": entry.label,
        "year_name": entry.year_name,
        "semester_name": entry.semester_name,
        "course_name": entry.course_name,
        "first_date": entry.first_date,
        "last_date": entry.last_date,
        "start_time": payload.start_time.strftime("%H:%M") if payload.start_time else None,
        "end_time": payload.end_time.strftime("%H:%M") if payload.end_time else None,
        "occurrence_count": entry.occurrence_count,
        "note_count": counts.notes,
        "recording_count": counts.recordings,
        "document_count": counts.documents,
        "deleted_at": entry.deleted_at,
        "purge_error": entry.purge_error,
        "missing_files": _missing_files(db, storage, user, folders),
        "version": entry.version,
        "task_count": task_link_service.entry_task_count(db, entry.id),
    }


def list_entries(
    db: Session, storage: StorageService, user: User, kind: str | None = None
) -> list[dict[str, Any]]:
    stmt = select(TrashEntry).where(TrashEntry.user_id == user.id)
    if kind:
        stmt = stmt.where(TrashEntry.kind == kind)
    entries = db.scalars(stmt.order_by(TrashEntry.deleted_at.desc(), TrashEntry.id.desc()))
    return [entry_out(db, storage, user, e) for e in entries]


# ---- restore ---------------------------------------------------------------------------------


def _reserved(err: ApiError) -> ApiError:
    return ApiError(
        409,
        "reserved_name",
        "This class's course is named “_Events”, which is reserved for events. "
        "Create a course with another name first.",
    )


def _resolve_owner(
    db: Session, storage: StorageService, user: User, p: TrashPayloadV1, lin: Lineage | None
) -> tuple[_OwnerRows, dict[str, bool]]:
    """The lineage's live course/semester when it still has segments; otherwise the original
    rows when they still exist, else rows found or recreated by name (FR-022b)."""
    recreated = {"year": False, "semester": False, "course": False}
    if lin is not None and lin.rows:
        owner = _owner_rows(db, p.kind, lin.rows, [])
        assert owner is not None
        return owner, recreated
    o = p.owner
    if p.kind == "class" and o.course_id:
        course = db.get(Course, o.course_id)
        if course is not None and course.user_id == user.id:
            c_sem, c_year = hs.course_parents(db, course)
            return _OwnerRows(year=c_year, semester=c_sem, course=course), recreated
    found = db.get(Semester, o.semester_id)
    if found is not None and found.user_id == user.id:
        semester = found
    else:
        old_year = db.get(Year, o.year_id)
        if old_year is not None and old_year.user_id == user.id:
            year = old_year
        else:
            year, recreated["year"] = hs.get_or_create_year(db, storage, user, o.year_name)
        semester, recreated["semester"] = hs.get_or_create_semester(
            db, storage, user, year, o.semester_name, o.semester_start, o.semester_end
        )
    year_row = db.get(Year, semester.year_id)
    assert year_row is not None
    course_row: Course | None = None
    if p.kind == "class":
        try:
            course_row, recreated["course"] = hs.get_or_create_course(
                db, storage, user, semester, o.course_name or "Course", o.course_color
            )
        except ApiError as err:
            if err.code == "reserved_name":
                raise _reserved(err) from err
            raise
    return _OwnerRows(year=year_row, semester=semester, course=course_row), recreated


def _owner_fields(kind: str, owner: _OwnerRows) -> dict[str, str]:
    if kind == "class":
        assert owner.course is not None
        return {"course_id": owner.course.id}
    return {"semester_id": owner.semester.id}


def _restore_exceptions(
    db: Session, user: User, p: TrashPayloadV1, lin: Lineage | None, overwrite: bool
) -> None:
    current = dict(lin.exc_rows) if lin else {}
    for d in p.created_cancels:
        e = current.get(d)
        if e is not None and e.kind == "cancelled":
            db.delete(e)
            del current[d]
    db.flush()
    for img in p.exceptions_before:
        e = current.get(img.original_date)
        if e is None:
            db.add(
                SessionException(
                    user_id=user.id,
                    lineage_id=p.lineage_id,
                    original_date=img.original_date,
                    version=img.version,
                    **img.columns(),
                )
            )
        elif overwrite:
            for k, v in img.columns().items():
                setattr(e, k, v)
    db.flush()


def _revert(
    db: Session, user: User, p: TrashPayloadV1, lin: Lineage | None, owner: _OwnerRows
) -> None:
    """Exact restore: nothing of the lineage changed since the deletion."""
    repo = lineage_mod.repo_for(p.kind)
    by_id = {r.id: r for r in (lin.rows if lin else [])}
    known = set(by_id) | {s.id for s in p.segments}
    for img in p.segments:
        cols = img.columns()
        if cols["split_from_id"] not in known:
            cols["split_from_id"] = None
        row = by_id.get(img.id)
        if row is None:
            row = repo.series(
                id=img.id,
                user_id=user.id,
                lineage_id=p.lineage_id,
                version=img.version,
                **_owner_fields(p.kind, owner),
                **cols,
            )
            db.add(row)
            db.flush()  # in start-date order: a split's source exists before the split
        else:
            for k, v in cols.items():
                setattr(row, k, v)
        row.links = repo.links(img.links)
    db.flush()
    _restore_exceptions(db, user, p, lin, overwrite=True)


def _reinsert(db: Session, user: User, p: TrashPayloadV1, lin: Lineage, owner: _OwnerRows) -> None:
    """The lineage was edited after the deletion: bring the removed dates back as their own
    one-date segments of the same lineage (same keys), with their exceptions."""
    repo = lineage_mod.repo_for(p.kind)
    _restore_exceptions(db, user, p, lin, overwrite=False)
    fresh = lineage_mod.load(db, user, p.lineage_id, p.kind)
    assert fresh is not None
    generated = fresh.generated()
    images = {s.id: s for s in p.segments}
    for r in p.removed:
        img = images.get(r.segment_id or "")
        if img is None or generated(r.original_date):
            continue
        exc = fresh.exc_rows.get(r.original_date)
        if exc is not None and exc.kind == "modified" and exc.detached:
            continue  # a frozen occurrence stays scheduled on its own
        cols = img.columns()
        cols.update(
            split_from_id=None,
            start_date=r.original_date,
            freq="none",
            interval_weeks=1,
            by_weekday="",
            end_kind="never",
            until_date=None,
            count=None,
        )
        row = repo.series(
            user_id=user.id, lineage_id=p.lineage_id, **_owner_fields(p.kind, owner), **cols
        )
        row.links = repo.links(img.links)
        db.add(row)
    db.flush()


def _move_own_files(
    db: Session,
    storage: StorageService,
    folder: SessionFolder,
    source: list[str],
    target: list[str],
) -> None:
    """The directory is shared with a live folder: move only the files this folder's rows
    own (a document with its annotations sidecar) into its new directory."""
    for model, sub in ((Note, "notes"), (Recording, "audios"), (Document, "documents")):
        names = list(
            db.scalars(select(model.file_name).where(model.session_folder_id == folder.id))
        )
        storage.ensure_dir([*target, sub])
        for name in names:
            old, new = [*source, sub, name], [*target, sub, name]
            if model is Document:
                on_rollback(db, storage.rename_pair(old, new))
            else:
                on_rollback(db, storage.rename_file(old, new))


def _reattach(
    db: Session,
    storage: StorageService,
    user: User,
    entry: TrashEntry,
    kind: str,
    owner: _OwnerRows,
) -> int:
    """Folders back under their course / semester `_Events`. A directory moves only when its
    readable path changed (parents recreated under other names, or its name is now taken);
    it gets a unique name and nothing is ever overwritten."""
    moved = 0
    if kind == "class":
        assert owner.course is not None
        parent = hs.course_parts(user, owner.year, owner.semester, owner.course)
        owner_col = SessionFolder.course_id
        owner_id = owner.course.id
    else:
        parent = [*hs.semester_parts(user, owner.year, owner.semester), EVENTS_DIR]
        owner_col = SessionFolder.semester_id
        owner_id = owner.semester.id
    for f in _entry_folders(db, entry):
        source = folder_parts(db, user, f)
        taken = [
            n
            for n in db.scalars(
                select(SessionFolder.folder_name).where(
                    owner_col == owner_id, SessionFolder.id != f.id
                )
            )
        ]
        name = f.folder_name
        target = [*parent, name]
        # another live folder of that course/semester has this name — and so this directory
        shared = name.casefold() in {t.casefold() for t in taken}
        if shared or (source != target and storage.exists(target)):
            while True:
                name = unique_sibling(f.folder_name, taken)
                if not storage.exists([*parent, name]):
                    break
                taken.append(name)
            target = [*parent, name]
        if source is not None and source != target and storage.exists(source):
            if shared and source == [*parent, f.folder_name]:
                _move_own_files(db, storage, f, source, target)
            else:
                on_rollback(db, storage.rename_dir(source, target))
            moved += 1
        f.folder_name = name
        f.folder_key = name.casefold()
        if kind == "class":
            f.course_id = owner_id
        else:
            f.semester_id = owner_id
        f.trash_entry_id = None
        f.origin_path = None
    db.flush()
    return moved


def restore(
    db: Session, storage: StorageService, user: User, entry_id: str, version: int
) -> dict[str, Any]:
    entry = _get_entry(db, user, entry_id)
    check_version(version, entry.version)
    p = TrashPayloadV1.from_json(entry.payload_json)
    lin = lineage_mod.load(db, user, p.lineage_id, p.kind)
    owner, recreated = _resolve_owner(db, storage, user, p, lin)
    assert lin is not None  # loaded with its kind: possibly without segments
    # exact when the lineage is exactly as the deletion left it (also: gone after "all");
    # otherwise only the removed dates come back, as their own segments
    if {r.id: r.version for r in lin.rows} == p.after_versions:
        _revert(db, user, p, lin, owner)
    else:
        _reinsert(db, user, p, lin, owner)
    moved = _reattach(db, storage, user, entry, p.kind, owner)
    first = p.removed[0].original_date if p.removed else entry.first_date
    # 012: its tasks come back (linked again) before the entry row goes
    task_link_service.restore_for_entry(db, user, entry.id)
    db.delete(entry)
    db.flush()
    if p.kind == "event":
        task_link_service.sync_lineage(db, user, p.lineage_id)
    return {
        "kind": p.kind,
        "lineage_id": p.lineage_id,
        "first_session_key": session_key(p.lineage_id, first),
        "recreated": recreated,
        "moved_folders": moved,
    }


# ---- permanent delete ------------------------------------------------------------------------


def purge(db: Session, storage: StorageService, user: User, entry_id: str, version: int) -> None:
    """Remove the entry, its folder rows (notes, recordings, documents, annotation ops and
    transcription jobs cascade) and their directories. Files go first: when some cannot be
    removed, the entry stays with `purge_error` (committed) and the request fails with the
    paths, so the user can retry; nothing is half-forgotten."""
    entry = _get_entry(db, user, entry_id)
    check_version(version, entry.version)
    folders = _entry_folders(db, entry)
    failed: list[str] = []
    for f in folders:
        parts = folder_parts(db, user, f)
        if parts is None:
            continue
        try:
            failed += storage.delete_tree(parts)
        except (StoragePathError, OSError):
            failed.append(_relative(parts))
    if failed:
        entry.purge_error = "Some files could not be removed: " + ", ".join(failed[:20])
        db.flush()
        db.commit()
        raise ApiError(
            500,
            "purge_failed",
            "Some files could not be removed. Close any program using them and try again.",
            extra={"failedPaths": failed},
        )
    for f in folders:
        db.execute(
            delete(WorkspaceState).where(
                WorkspaceState.user_id == user.id,
                WorkspaceState.lineage_id == f.lineage_id,
                WorkspaceState.original_date == f.original_date,
            )
        )
        db.delete(f)
    db.flush()
    task_link_service.purge_for_entry(db, user, entry.id)  # 012: its tasks go for good
    lineage_id = entry.lineage_id
    db.delete(entry)
    db.flush()
    _forget_import_source(db, user, lineage_id)


def _forget_import_source(db: Session, user: User, lineage_id: str) -> None:
    """A lineage gone for good no longer blocks a re-import of its file entry (010 R11): the
    next import of that entry creates it again. Kept while any of it is live or in the Trash."""
    still_there = db.scalar(
        select(
            exists().where(ClassSeries.user_id == user.id, ClassSeries.lineage_id == lineage_id)
            | exists().where(EventSeries.user_id == user.id, EventSeries.lineage_id == lineage_id)
            | exists().where(TrashEntry.user_id == user.id, TrashEntry.lineage_id == lineage_id)
        )
    )
    if not still_there:
        db.execute(
            delete(CalendarImportSource).where(
                CalendarImportSource.user_id == user.id,
                CalendarImportSource.lineage_id == lineage_id,
            )
        )
        db.flush()
