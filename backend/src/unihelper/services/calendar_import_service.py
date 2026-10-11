"""Calendar import: staging, preview and apply (010 research R2, R7, R11–R13).

`register_upload` keeps a checked `.ics` file in the import staging area for an hour;
`preview` groups its entries; `apply` turns the user's plan into ordinary classes, events and
exceptions in the request's single transaction. A file entry is matched to what an earlier
import (or an export of this app) made, so repeated imports update instead of duplicating.
Occurrences that hold notes, recordings or documents are never moved: when an update would
change one, it is frozen at its current values and reported as skipped. Nothing is deleted.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import delete, exists, or_, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.api.uploads import StagedUpload
from unihelper.db.engine import on_commit, on_rollback
from unihelper.domain.ical_read import IcsError, read_calendar
from unihelper.domain.ical_rules import (
    SKIP_MESSAGES,
    Expansion,
    Override,
    SegmentSpec,
    SourceEntry,
    normalize,
)
from unihelper.domain.import_plan import (
    EVENT_COLOR,
    NO_TITLE,
    PreviewGroup,
    group_entries,
    next_color,
    re_expand,
    validate_plan,
)
from unihelper.domain.naming import name_key
from unihelper.domain.recurrence import RuleError, occurrence_dates, validate_rule
from unihelper.models import (
    CalendarImportRun,
    CalendarImportSource,
    CalendarImportUpload,
    ClassLink,
    ClassSeries,
    Course,
    Document,
    EventLink,
    EventSeries,
    Note,
    Recording,
    Semester,
    SessionException,
    SessionFolder,
    TrashEntry,
    User,
    Year,
)
from unihelper.models.base import new_id
from unihelper.schemas.calendar_io import CourseExisting, CourseNew, GroupPlan, ImportPlan
from unihelper.schemas.classes import RefId, RefNewSemester
from unihelper.services import hierarchy_service as hs
from unihelper.services import lineage as lineage_mod
from unihelper.services import workspace_service
from unihelper.services.class_service import resolve_semester
from unihelper.services.event_service import _links_json
from unihelper.storage.storage_service import StoragePathError, StorageService

UPLOAD_TTL = timedelta(hours=1)
APP_PRODID = "UniHelperProMax"
CLASS_LOCATION_MAX = 120
EVENT_LOCATION_MAX = 200
TITLE_MAX = 120

HAS_CONTENT = "has notes, recordings or documents"
IN_TRASH = "it is in the Trash"
KIND_MISMATCH = {"class": "already imported as a class", "event": "already imported as an event"}
UNSUPPORTED_SKIPPED = "its repetition is not supported"
NOT_SELECTED = "not selected"


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t is not None else None


# ---- staging ---------------------------------------------------------------------------------


def _staged_path(storage: StorageService, upload: CalendarImportUpload) -> Any:
    return storage.uploads_dir / upload.staged_name


def _drop(db: Session, storage: StorageService, upload: CalendarImportUpload) -> None:
    path = _staged_path(storage, upload)
    db.delete(upload)
    on_commit(db, lambda: _discard_file(storage, path))


def _discard_file(storage: StorageService, path: Any) -> None:
    try:
        storage.discard_upload(path)
    except (StoragePathError, OSError):
        pass


def sweep_expired(db: Session, storage: StorageService) -> None:
    now = _iso(_now())
    for upload in db.scalars(
        select(CalendarImportUpload).where(CalendarImportUpload.expires_at < now)
    ):
        _drop(db, storage, upload)
    db.flush()


def forget_expired(db: Session) -> None:
    """Startup: drop expired preview rows (their staging files go with the staging sweep)."""
    db.execute(delete(CalendarImportUpload).where(CalendarImportUpload.expires_at < _iso(_now())))
    db.commit()


def register_upload(
    db: Session, storage: StorageService, user: User, staged: StagedUpload, file_name: str
) -> CalendarImportUpload:
    """Check a staged file and keep it for the preview. A user has one staged file at a time."""
    on_rollback(db, lambda: _discard_file(storage, staged.path))
    sweep_expired(db, storage)
    for previous in db.scalars(
        select(CalendarImportUpload).where(CalendarImportUpload.user_id == user.id)
    ):
        _drop(db, storage, previous)
    try:
        parsed = read_calendar(staged.path.read_bytes())
    except IcsError as err:
        raise ApiError(422, err.code, err.message) from err
    now = _now()
    upload = CalendarImportUpload(
        user_id=user.id,
        file_name=file_name.strip()[:255] or "calendar.ics",
        size=staged.size,
        sha256=staged.sha256,
        staged_name=staged.path.name,
        event_count=len(parsed.events),
        created_at=_iso(now),
        expires_at=_iso(now + UPLOAD_TTL),
    )
    db.add(upload)
    db.flush()
    return upload


def get_upload(db: Session, user: User, upload_id: str) -> CalendarImportUpload:
    upload = db.get(CalendarImportUpload, upload_id)
    if upload is None or upload.user_id != user.id or upload.expires_at < _iso(_now()):
        raise ApiError(409, "upload_expired", "This preview expired. Choose the file again.")
    return upload


def discard(db: Session, storage: StorageService, user: User, upload_id: str) -> None:
    upload = db.get(CalendarImportUpload, upload_id)
    if upload is not None and upload.user_id == user.id:
        _drop(db, storage, upload)
        db.flush()


# ---- parsing -----------------------------------------------------------------------------------


@dataclass
class Parsed:
    from_this_app: bool
    event_count: int
    skipped: list[SourceEntry]
    groups: list[PreviewGroup]


def _parse(storage: StorageService, upload: CalendarImportUpload, user: User) -> Parsed:
    try:
        data = _staged_path(storage, upload).read_bytes()
    except OSError as err:
        raise ApiError(
            409, "upload_expired", "This preview expired. Choose the file again."
        ) from err
    try:
        cal = read_calendar(data)
    except IcsError as err:
        raise ApiError(422, err.code, err.message) from err
    entries = normalize(cal, user.timezone)
    return Parsed(
        from_this_app=APP_PRODID.lower() in cal.prodid.lower(),
        event_count=len(cal.events),
        skipped=[e for e in entries if e.skip],
        groups=group_entries(entries, user.timezone),
    )


def _skipped_item(
    title: str, reason: str, message: str, day: date | None = None, start: time | None = None
) -> dict[str, Any]:
    return {
        "title": title or NO_TITLE,
        "date": day,
        "start_time": _hhmm(start),
        "reason": reason,
        "message": message,
    }


def _entry_skipped(entry: SourceEntry) -> dict[str, Any]:
    assert entry.skip is not None
    return _skipped_item(
        entry.title, entry.skip, SKIP_MESSAGES[entry.skip], entry.first_day, entry.first_start
    )


# ---- matching ----------------------------------------------------------------------------------


@dataclass
class Match:
    kind: str | None
    lineage_id: str
    status: str  # "live" | "trash" | "gone"
    source: CalendarImportSource | None = None


def _live_kind(db: Session, user: User, lineage_id: str) -> str | None:
    for kind, model in (("event", EventSeries), ("class", ClassSeries)):
        if db.scalar(
            select(exists().where(model.lineage_id == lineage_id, model.user_id == user.id))
        ):
            return kind
    return None


def lineage_in_trash(db: Session, user: User, lineage_id: str) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(TrashEntry.user_id == user.id, TrashEntry.lineage_id == lineage_id)
            )
        )
    )


def _status(db: Session, user: User, lineage_id: str) -> tuple[str | None, str]:
    kind = _live_kind(db, user, lineage_id)
    if kind is not None:
        return kind, "live"
    if lineage_in_trash(db, user, lineage_id):
        return None, "trash"
    return None, "gone"


def _source(db: Session, user: User, uid: str, recurrence_key: str) -> CalendarImportSource | None:
    return db.scalar(
        select(CalendarImportSource).where(
            CalendarImportSource.user_id == user.id,
            CalendarImportSource.source_uid == uid,
            CalendarImportSource.recurrence_key == recurrence_key,
        )
    )


def find_match(
    db: Session, user: User, uid: str, recurrence_key: str, app_lineage: str | None
) -> Match | None:
    """What an entry already is in this account (research R11), if anything."""
    source = _source(db, user, uid, recurrence_key)
    if app_lineage:
        kind, status = _status(db, user, app_lineage)
        if status != "gone":
            return Match(kind, app_lineage, status, source)
    if source is not None:
        kind, status = _status(db, user, source.lineage_id)
        return Match(kind, source.lineage_id, status, source)
    return None


# ---- desired state of one lineage --------------------------------------------------------------


@dataclass
class Detached:
    original: date
    day: date
    start: time
    end: time
    location: str | None


@dataclass
class Single:
    """A one-time entry split off a series: a class occurrence moved to another day, an
    override whose date the rule doesn't produce."""

    uid: str
    recurrence_key: str
    title: str
    day: date
    start: time
    end: time
    location: str
    links: list[tuple[str | None, str]]


@dataclass
class Desired:
    segments: list[SegmentSpec]
    cancelled: set[date] = field(default_factory=set)
    modified: dict[date, Override] = field(default_factory=dict)
    detached: list[Detached] = field(default_factory=list)
    singles: list[Single] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def occurrence_map(
        self, location: str | None, ends: Iterable[date | None] = ()
    ) -> dict[date, tuple[date, time, time, str | None]]:
        """original day → (shown day, start, end, location), like the app's expansion."""
        out: dict[date, tuple[date, time, time, str | None]] = {}
        for seg in self.segments:
            last = seg.until_date or seg.start_date + timedelta(weeks=8 * 501)
            for day in occurrence_dates(seg.rule(), None, seg.start_date, last):
                out[day] = (day, seg.start_time, seg.end_time, location)
        for day in self.cancelled:
            out.pop(day, None)
        for day, ov in self.modified.items():
            if day in out and ov.day and ov.start and ov.end:
                out[day] = (ov.day, ov.start, ov.end, ov.location or location)
        for d in self.detached:
            out[d.original] = (d.day, d.start, d.end, d.location)
        return out


def _app_original(entry: SourceEntry) -> date | None:
    raw = entry.app.get("X-UNIHELPER-ORIGINAL-DATE")
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def _desired(
    kind: str,
    entries: Sequence[SourceEntry],
    expansions: dict[str, Expansion],
    unsupported_choice: str | None,
    skipped: list[dict[str, Any]],
) -> Desired | None:
    """The segments and exceptions a unit of entries (one lineage) should have; None when all of
    it is skipped."""
    desired = Desired(segments=[])
    for entry in entries:
        x = expansions[entry.entry_id]
        if x.unsupported and unsupported_choice == "skip":
            skipped.append(
                _skipped_item(
                    entry.title,
                    "unsupported_skipped",
                    UNSUPPORTED_SKIPPED,
                    entry.first_day,
                    entry.first_start,
                )
            )
            continue
        original = _app_original(entry)
        if (
            original is not None
            and x.segments
            and x.segments[0].freq == "none"
            and desired.segments
        ):
            seg = x.segments[0]
            desired.detached.append(
                Detached(
                    original, seg.start_date, seg.start_time, seg.end_time, entry.location or None
                )
            )
            continue
        desired.segments += x.segments
        desired.notes += [n for n in x.notes if n not in desired.notes]
        if x.unsupported:
            continue  # first occurrence only: no exceptions apply
        desired.cancelled |= x.cancelled
        for day, ov in x.modified.items():
            assert ov.day and ov.start and ov.end
            if kind == "class" and ov.day != day:
                desired.cancelled.add(day)
                desired.singles.append(
                    Single(
                        entry.uid,
                        ov.recurrence_key,
                        entry.title,
                        ov.day,
                        ov.start,
                        ov.end,
                        ov.location or entry.location,
                        ov.links or entry.links,
                    )
                )
                desired.notes.append(
                    f"The {day.isoformat()} occurrence moved to {ov.day.isoformat()} was imported "
                    "as a single class."
                )
                continue
            if kind == "class" and ov.title and name_key(ov.title) != name_key(entry.title):
                desired.notes.append(
                    f"The changed title on {day.isoformat()} was not kept: a class shows its "
                    "course name."
                )
            desired.modified[day] = ov
        for ov in x.orphans:
            assert ov.day and ov.start and ov.end
            desired.singles.append(
                Single(
                    entry.uid,
                    ov.recurrence_key,
                    ov.title or entry.title,
                    ov.day,
                    ov.start,
                    ov.end,
                    ov.location or entry.location,
                    ov.links or entry.links,
                )
            )
            desired.notes.append(
                f"A changed occurrence on {ov.day.isoformat()} that the repetition doesn't "
                "produce was imported as a one-time entry."
            )
    if not desired.segments:
        return None
    desired.segments.sort(key=lambda s: s.start_date)
    return desired


# ---- apply -------------------------------------------------------------------------------------


@dataclass
class Counter:
    created: int = 0
    updated: int = 0
    skipped: int = 0


@dataclass
class Run:
    db: Session
    storage: StorageService
    user: User
    plan: ImportPlan
    run_id: str
    destination: Semester | None = None
    created: dict[str, list[Any]] = field(
        default_factory=lambda: {"lineages": [], "courseIds": [], "semesterIds": [], "yearIds": []}
    )
    updated: list[dict[str, str]] = field(default_factory=list)
    counts: dict[str, Counter] = field(
        default_factory=lambda: {"class": Counter(), "event": Counter()}
    )
    unchanged: int = 0
    skipped: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    courses_created: list[dict[str, str]] = field(default_factory=list)
    course_cache: dict[tuple[str, str], Course] = field(default_factory=dict)
    semester_cache: dict[tuple[str, str], Semester] = field(default_factory=dict)

    def note(self, text: str) -> None:
        if text not in self.notes:
            self.notes.append(text)

    def compensate(self, parts: list[str]) -> None:
        storage = self.storage
        on_rollback(self.db, lambda: _remove_empty(storage, parts))


def _remove_empty(storage: StorageService, parts: list[str]) -> None:
    try:
        storage.remove_empty_dir(parts)
    except (StoragePathError, OSError):
        pass


def _destination(run: Run) -> Semester:
    if run.destination is not None:
        return run.destination
    ref = run.plan.destination
    made: dict[str, str] = {}
    if isinstance(ref, RefNewSemester) and not ref.new.name.strip():
        raise validation_error(
            "/destination/new/name", "destination_required", "Name the semester."
        )
    semester = resolve_semester(run.db, run.storage, run.user, ref, made)
    if "year_id" in made:
        year = run.db.get(Year, made["year_id"])
        assert year is not None
        run.created["yearIds"].append(year.id)
        run.compensate(hs.year_parts(run.user, year))
    if "semester_id" in made:
        year = run.db.get(Year, semester.year_id)
        assert year is not None
        run.created["semesterIds"].append(semester.id)
        run.compensate(hs.semester_parts(run.user, year, semester))
    run.destination = semester
    return semester


def _saved_semester(run: Run, group: PreviewGroup) -> Semester:
    saved = group.saved
    assert saved is not None
    key = (name_key(saved.year_name), name_key(saved.semester_name))
    cached = run.semester_cache.get(key)
    if cached is not None:
        return cached
    year, made_year = hs.get_or_create_year(run.db, run.storage, run.user, saved.year_name)
    if made_year:
        run.created["yearIds"].append(year.id)
        run.compensate(hs.year_parts(run.user, year))
    start, end = saved.semester_start, saved.semester_end
    if start and end and end < start:
        start = end = None
    semester, made = hs.get_or_create_semester(
        run.db, run.storage, run.user, year, saved.semester_name, start, end
    )
    if made:
        run.created["semesterIds"].append(semester.id)
        if not made_year:
            run.compensate(hs.semester_parts(run.user, year, semester))
    run.semester_cache[key] = semester
    return semester


def _target_semester(run: Run, group: PreviewGroup, plan: GroupPlan) -> Semester:
    if group.saved is not None and plan.semester == "saved":
        return _saved_semester(run, group)
    return _destination(run)


def _course(run: Run, group: PreviewGroup, plan: GroupPlan, semester: Semester) -> Course:
    db = run.db
    pointer = f"/groups/{group.group_id}/course"
    if isinstance(plan.course, CourseExisting):
        course = hs.get_course(db, run.user, plan.course.existing)
        if course.semester_id != semester.id:
            raise validation_error(
                pointer, "course_semester_mismatch", "This course is in another semester."
            )
        return course
    if isinstance(plan.course, CourseNew):
        name = plan.course.new
    elif group.saved is not None and plan.semester == "saved" and group.saved.course_name:
        name = group.saved.course_name
    else:
        name = plan.title or group.title
    name = name.strip()[:TITLE_MAX]
    key = (semester.id, name_key(name))
    cached = run.course_cache.get(key)
    if cached is not None:
        return cached
    existing = db.scalar(
        select(Course).where(Course.semester_id == semester.id, Course.name_key == name_key(name))
    )
    if existing is None:
        used = list(
            db.scalars(select(Course.default_color).where(Course.semester_id == semester.id))
        )
        color = (group.saved.color if group.saved else None) or next_color(used)
        try:
            course, _made = hs.get_or_create_course(
                db, run.storage, run.user, semester, name, color
            )
        except ApiError as err:
            if err.errors:  # name rules (reserved name, length): point at the group's course
                err.errors = [{**e, "field": pointer} for e in err.errors]
            raise
        year = db.get(Year, semester.year_id)
        assert year is not None
        run.created["courseIds"].append(course.id)
        run.courses_created.append({"id": course.id, "name": course.name})
        run.compensate(hs.course_parts(run.user, year, semester, course))
    else:
        course = existing
    run.course_cache[key] = course
    return course


def _class_color(run: Run, group: PreviewGroup, course: Course) -> str:
    return (group.saved.color if group.saved else None) or course.default_color


def _validate_segment(seg: SegmentSpec, group: PreviewGroup) -> None:
    try:
        validate_rule(seg.rule(), None)
    except RuleError as err:
        raise validation_error(
            f"/groups/{group.group_id}/endDate", "invalid_end_date", err.message
        ) from err


def _insert_rows(
    run: Run,
    kind: str,
    owner: Course | Semester,
    segments: Sequence[SegmentSpec],
    group: PreviewGroup,
    *,
    title: str,
    location: str | None,
    links: Sequence[tuple[str | None, str]],
    color: str,
    lineage_id: str | None = None,
    previous: str | None = None,
) -> str:
    """Series rows for `segments` (one lineage). Returns the lineage id."""
    db = run.db
    for seg in segments:
        _validate_segment(seg, group)
        sid = new_id()
        lineage_id = lineage_id or sid
        common: dict[str, Any] = {
            "id": sid,
            "user_id": run.user.id,
            "lineage_id": lineage_id,
            "split_from_id": previous,
            "color": color,
            "start_date": seg.start_date,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "freq": seg.freq,
            "interval_weeks": seg.interval_weeks if seg.freq == "weekly" else 1,
            "by_weekday": ",".join(seg.weekdays) if seg.freq == "weekly" else "",
            "end_kind": seg.end_kind if seg.freq == "weekly" else "never",
            "until_date": seg.until_date if seg.end_kind == "until" else None,
            "count": seg.count if seg.end_kind == "count" else None,
        }
        row: Any
        if kind == "class":
            assert isinstance(owner, Course)
            row = ClassSeries(
                course_id=owner.id,
                title=None,
                location=(location or "")[:CLASS_LOCATION_MAX] or None,
                **common,
            )
            row.links = [ClassLink(label=lb, url=u, position=i) for i, (lb, u) in enumerate(links)]
        else:
            assert isinstance(owner, Semester)
            row = EventSeries(
                semester_id=owner.id,
                title=title[:TITLE_MAX],
                location=(location or "")[:EVENT_LOCATION_MAX] or None,
                **common,
            )
            row.links = [EventLink(label=lb, url=u, position=i) for i, (lb, u) in enumerate(links)]
        db.add(row)
        db.flush()
        previous = sid
    assert lineage_id is not None
    return lineage_id


def _exception_rows(
    run: Run, kind: str, lineage_id: str, desired: Desired, skip_days: set[date]
) -> None:
    db = run.db
    for day in sorted(desired.cancelled - skip_days):
        db.add(
            SessionException(
                user_id=run.user.id, lineage_id=lineage_id, original_date=day, kind="cancelled"
            )
        )
    for day, ov in sorted(desired.modified.items()):
        if day in skip_days or day in desired.cancelled:
            continue
        values: dict[str, Any] = {
            "start_time": ov.start,
            "end_time": ov.end,
            "location": (ov.location or None),
        }
        if kind == "event":
            if ov.location:
                values["location"] = ov.location[:EVENT_LOCATION_MAX]
            values["moved_date"] = ov.day if ov.day != day else None
            values["title"] = ov.title[:TITLE_MAX] if ov.title else None
            values["links_json"] = _links_json(ov.links) if ov.links else None
        elif ov.location:
            values["location"] = ov.location[:CLASS_LOCATION_MAX]
        db.add(
            SessionException(
                user_id=run.user.id,
                lineage_id=lineage_id,
                original_date=day,
                kind="modified",
                **values,
            )
        )
    for d in desired.detached:
        if d.original in skip_days:
            continue
        db.add(
            SessionException(
                user_id=run.user.id,
                lineage_id=lineage_id,
                original_date=d.original,
                kind="modified",
                start_time=d.start,
                end_time=d.end,
                location=d.location,
                moved_date=d.day if d.day != d.original else None,
                detached=True,
            )
        )
    db.flush()


def _scheduled_count(desired: Desired) -> int:
    return len(desired.occurrence_map(None))


def _remember(run: Run, uid: str, recurrence_key: str, kind: str, lineage_id: str) -> None:
    db = run.db
    source = _source(db, run.user, uid, recurrence_key)
    if source is None:
        db.add(
            CalendarImportSource(
                user_id=run.user.id,
                source_uid=uid,
                recurrence_key=recurrence_key,
                kind=kind,
                lineage_id=lineage_id,
                first_run_id=run.run_id,
                last_run_id=run.run_id,
            )
        )
    else:
        source.kind = kind
        source.lineage_id = lineage_id
        source.last_run_id = run.run_id
    db.flush()


# ---- updates -------------------------------------------------------------------------------


def _content_days(db: Session, user: User, lineage_id: str) -> set[date]:
    folders = select(SessionFolder.id).where(
        SessionFolder.user_id == user.id,
        SessionFolder.lineage_id == lineage_id,
        SessionFolder.trash_entry_id.is_(None),
    )
    with_content = select(SessionFolder.original_date).where(
        SessionFolder.id.in_(folders),
        or_(
            exists().where(Note.session_folder_id == SessionFolder.id),
            exists().where(Recording.session_folder_id == SessionFolder.id),
            exists().where(Document.session_folder_id == SessionFolder.id),
        ),
    )
    return set(db.scalars(with_content))


def _row_links(row: Any) -> list[tuple[str | None, str]]:
    return [(lk.label, lk.url) for lk in row.links]


def _update(
    run: Run,
    kind: str,
    lineage_id: str,
    desired: Desired,
    group: PreviewGroup,
    *,
    title: str,
    location: str | None,
    links: list[tuple[str | None, str]],
    color: str | None,
) -> tuple[bool, list[tuple[date, Any]]]:
    """Make an existing lineage match the file. Returns (changed, frozen occurrences)."""
    db, user = run.db, run.user
    lin = lineage_mod.load(db, user, lineage_id, kind)
    assert lin is not None and lin.rows
    loc_max = CLASS_LOCATION_MAX if kind == "class" else EVENT_LOCATION_MAX
    location = (location or "")[:loc_max] or None
    first = lin.rows[0]
    color = color or first.color
    title = title[:TITLE_MAX]
    now_views = {date.fromisoformat(v.key[-10:]): v for v in lin.occurrences(user.timezone)}
    current = {
        d: (
            v.date,
            v.start.time().replace(tzinfo=None),
            v.end.time().replace(tzinfo=None),
            v.location,
        )
        for d, v in now_views.items()
    }
    wanted = desired.occurrence_map(location)
    same_rows = all(
        _row_links(r) == list(links)
        and r.color == color
        and (kind == "class" or r.title == title)
        and (r.location or None) == location
        for r in lin.rows
    )
    if current == wanted and same_rows:
        return False, []

    content = _content_days(db, user, lineage_id)
    frozen = [
        (d, now_views[d]) for d in sorted(content) if d in now_views and current[d] != wanted.get(d)
    ]
    frozen_days = {d for d, _ in frozen}
    db.execute(
        delete(SessionException).where(
            SessionException.user_id == user.id, SessionException.lineage_id == lineage_id
        )
    )
    owner: Course | Semester
    if kind == "class":
        owner_c = db.get(Course, first.course_id)
        assert owner_c is not None
        owner = owner_c
    else:
        owner_s = db.get(Semester, first.semester_id)
        assert owner_s is not None
        owner = owner_s
    # rebuild the segments under the same lineage: the first row keeps its id (= lineage id)
    for seg in desired.segments:
        _validate_segment(seg, group)
    rows = list(lin.rows)
    for extra in rows[1:]:
        db.delete(extra)
    db.flush()
    head, rest = desired.segments[0], desired.segments[1:]
    first.start_date = head.start_date
    first.start_time = head.start_time
    first.end_time = head.end_time
    first.freq = head.freq
    first.interval_weeks = head.interval_weeks if head.freq == "weekly" else 1
    first.by_weekday = ",".join(head.weekdays) if head.freq == "weekly" else ""
    first.end_kind = head.end_kind if head.freq == "weekly" else "never"
    first.until_date = head.until_date if head.end_kind == "until" else None
    first.count = head.count if head.end_kind == "count" else None
    first.location = location
    first.color = color
    first.split_from_id = None
    if kind == "event":
        first.title = title
    link_model: Any = ClassLink if kind == "class" else EventLink
    first.links = [link_model(label=lb, url=u, position=i) for i, (lb, u) in enumerate(links)]
    db.flush()
    if rest:
        _insert_rows(
            run,
            kind,
            owner,
            rest,
            group,
            title=title,
            location=location,
            links=links,
            color=color,
            lineage_id=lineage_id,
            previous=first.id,
        )
    _exception_rows(run, kind, lineage_id, desired, frozen_days)
    for day, view in frozen:  # keep what it shows now (research R11)
        values: dict[str, Any] = {
            "start_time": view.start.time().replace(tzinfo=None),
            "end_time": view.end.time().replace(tzinfo=None),
            "location": view.location,
            "moved_date": view.date if view.date != day else None,
        }
        if kind == "event":
            values["title"] = view.title or first.title
            values["links_json"] = _links_json(view.links) if view.links is not None else None
            values["color"] = view.color
        db.add(
            SessionException(
                user_id=user.id,
                lineage_id=lineage_id,
                original_date=day,
                kind="modified",
                detached=True,
                **values,
            )
        )
    db.flush()
    return True, frozen


# ---- one group -----------------------------------------------------------------------------


def _units(group: PreviewGroup) -> list[list[SourceEntry]]:
    """Entries that form one lineage: an app export's segments share `X-UNIHELPER-LINEAGE`."""
    units: dict[str, list[SourceEntry]] = {}
    for entry in group.entries:
        key = entry.app.get("X-UNIHELPER-LINEAGE") or f"entry:{entry.entry_id}"
        units.setdefault(key, []).append(entry)
    out = list(units.values())
    for unit in out:
        unit.sort(key=lambda e: (_app_original(e) is not None, e.first_day or date.min))
    return out


def _apply_group(run: Run, group: PreviewGroup, plan: GroupPlan) -> None:
    kind = plan.import_as
    semester = _target_semester(run, group, plan)
    course = _course(run, group, plan, semester) if kind == "class" else None
    if group.open_ended:
        end = plan.end_date or group.suggested_end
        re_expand(group, run.user.timezone, end)
        for entry in group.entries:
            x = group.expansions[entry.entry_id]
            if entry.open_ended and x.unsupported:
                raise validation_error(
                    f"/groups/{group.group_id}/endDate",
                    "invalid_end_date",
                    f"With this end date, {x.unsupported}.",
                )
    for unit in _units(group):
        _apply_unit(run, group, plan, unit, semester, course)


def _apply_unit(
    run: Run,
    group: PreviewGroup,
    plan: GroupPlan,
    unit: list[SourceEntry],
    semester: Semester,
    course: Course | None,
) -> None:
    db = run.db
    kind = plan.import_as
    head = unit[0]
    title = (plan.title or "").strip() if group.title_missing else head.title
    display = (course.name if course is not None else title) or NO_TITLE
    desired = _desired(kind, unit, group.expansions, plan.unsupported, run.skipped)
    if desired is None:
        run.counts[kind].skipped += len(unit)
        return
    for n in desired.notes:
        run.note(f"{display}: {n}")
    for e in unit:
        for n in e.notes:
            run.note(f"{display}: {n}")
    color = (
        _class_color(run, group, course)
        if course is not None
        else ((group.saved.color if group.saved else None) or EVENT_COLOR)
    )
    file_color = group.saved.color if group.saved else None
    links = list(head.links)
    location = head.location or None

    match = None
    for e in unit:
        match = find_match(db, run.user, e.uid, e.recurrence_key, e.app.get("X-UNIHELPER-LINEAGE"))
        if match is not None:
            break
    occurrences = _scheduled_count(desired)
    if match is not None and match.status == "trash":
        run.skipped.append(
            _skipped_item(display, "in_trash", IN_TRASH, head.first_day, head.first_start)
        )
        run.counts[kind].skipped += 1
        return
    if match is not None and match.status == "live" and match.kind != kind:
        assert match.kind is not None
        run.skipped.append(
            _skipped_item(
                display,
                "kind_mismatch",
                KIND_MISMATCH[match.kind],
                head.first_day,
                head.first_start,
            )
        )
        run.counts[kind].skipped += 1
        return
    if match is not None and match.status == "live":
        lineage_id = match.lineage_id
        changed, frozen = _update(
            run,
            kind,
            lineage_id,
            desired,
            group,
            title=title,
            location=location,
            links=links,
            color=file_color,
        )
        for day, view in frozen:
            run.skipped.append(
                _skipped_item(display, "has_content", HAS_CONTENT, day, view.start.time())
            )
        run.counts[kind].skipped += len(frozen)
        if changed:
            run.counts[kind].updated += max(occurrences - len(frozen), 0)
            run.updated.append({"id": lineage_id, "kind": kind})
        else:
            run.unchanged += occurrences
    else:
        owner: Course | Semester = course if course is not None else semester
        is_first = course is not None and not db.scalar(
            select(exists().where(ClassSeries.course_id == course.id))
        )
        lineage_id = _insert_rows(
            run,
            kind,
            owner,
            desired.segments,
            group,
            title=title,
            location=location,
            links=links,
            color=color,
        )
        if is_first and course is not None:
            course.default_color = color
        _exception_rows(run, kind, lineage_id, desired, set())
        run.created["lineages"].append({"id": lineage_id, "kind": kind})
        run.counts[kind].created += occurrences
    for e in unit:
        _remember(run, e.uid, e.recurrence_key, kind, lineage_id)
    for single in desired.singles:
        _apply_single(run, group, kind, single, semester, course, color, file_color)


def _apply_single(
    run: Run,
    group: PreviewGroup,
    kind: str,
    single: Single,
    semester: Semester,
    course: Course | None,
    color: str,
    file_color: str | None,
) -> None:
    seg = SegmentSpec(
        freq="none", start_date=single.day, start_time=single.start, end_time=single.end
    )
    desired = Desired(segments=[seg])
    match = find_match(run.db, run.user, single.uid, single.recurrence_key, None)
    display = course.name if course is not None else single.title
    if match is not None and match.status == "trash":
        run.skipped.append(_skipped_item(display, "in_trash", IN_TRASH, single.day, single.start))
        run.counts[kind].skipped += 1
        return
    if match is not None and match.status == "live" and match.kind == kind:
        changed, frozen = _update(
            run,
            kind,
            match.lineage_id,
            desired,
            group,
            title=single.title,
            location=single.location or None,
            links=list(single.links),
            color=file_color,
        )
        for day, view in frozen:
            run.skipped.append(
                _skipped_item(display, "has_content", HAS_CONTENT, day, view.start.time())
            )
        run.counts[kind].skipped += len(frozen)
        if changed and not frozen:
            run.counts[kind].updated += 1
            run.updated.append({"id": match.lineage_id, "kind": kind})
        elif not changed:
            run.unchanged += 1
        lineage_id = match.lineage_id
    elif match is not None and match.status == "live":
        assert match.kind is not None
        run.skipped.append(
            _skipped_item(
                display, "kind_mismatch", KIND_MISMATCH[match.kind], single.day, single.start
            )
        )
        run.counts[kind].skipped += 1
        return
    else:
        owner: Course | Semester = course if course is not None else semester
        lineage_id = _insert_rows(
            run,
            kind,
            owner,
            [seg],
            group,
            title=single.title,
            location=single.location or None,
            links=list(single.links),
            color=color,
        )
        run.created["lineages"].append({"id": lineage_id, "kind": kind})
        run.counts[kind].created += 1
    _remember(run, single.uid, single.recurrence_key, kind, lineage_id)


# ---- preview -----------------------------------------------------------------------------------


def _matches(db: Session, user: User, group: PreviewGroup) -> tuple[dict[str, int], list[Any]]:
    kind = group.default_kind
    counts = {"create": 0, "update": 0, "unchanged": 0, "skip": 0}
    skipped: list[dict[str, Any]] = []
    for entry in group.entries:
        n = len(group.expansions[entry.entry_id].scheduled)
        match = find_match(
            db, user, entry.uid, entry.recurrence_key, entry.app.get("X-UNIHELPER-LINEAGE")
        )
        if match is None or match.status == "gone":
            counts["create"] += n
        elif match.status == "trash":
            counts["skip"] += 1
            skipped.append(
                _skipped_item(entry.title, "in_trash", IN_TRASH, entry.first_day, entry.first_start)
            )
        elif match.kind != kind:
            counts["skip"] += 1
            assert match.kind is not None
            skipped.append(
                _skipped_item(
                    entry.title,
                    "kind_mismatch",
                    KIND_MISMATCH[match.kind],
                    entry.first_day,
                    entry.first_start,
                )
            )
        else:
            counts["update"] += n
    return counts, skipped


def _pattern_out(p: tuple[tuple[str, ...], time, time]) -> dict[str, Any]:
    return {"weekdays": list(p[0]), "start_time": _hhmm(p[1]), "end_time": _hhmm(p[2])}


def preview(
    db: Session, storage: StorageService, user: User, upload: CalendarImportUpload
) -> dict[str, Any]:
    parsed = _parse(storage, upload, user)
    groups_out = []
    for g in parsed.groups:
        matches, skipped = _matches(db, user, g)
        issues = list(g.issues)
        if any(s["reason"] == "kind_mismatch" for s in skipped):
            issues.append("kind_mismatch")
        groups_out.append(
            {
                "group_id": g.group_id,
                "title": g.title,
                "title_missing": g.title_missing,
                "occurrence_count": g.occurrence_count,
                "patterns": [_pattern_out(p) for p in g.patterns],
                "location": g.location,
                "repeating": g.repeating,
                "unsupported": g.unsupported,
                "open_ended": (
                    {"suggested_end_date": g.suggested_end} if g.suggested_end else None
                ),
                "first_date": g.first_date,
                "saved": (
                    {
                        "kind": g.saved.kind,
                        "year_name": g.saved.year_name,
                        "semester_name": g.saved.semester_name,
                        "course_name": g.saved.course_name,
                        "color": g.saved.color,
                    }
                    if g.saved
                    else None
                ),
                "defaults": {
                    "selected": g.default_selected,
                    "import_as": g.default_kind,
                    "color": g.default_color,
                },
                "matches": matches,
                "issues": issues,
                "notes": g.notes,
                "skipped": skipped,
            }
        )
    return {
        "upload_id": upload.id,
        "file_name": upload.file_name,
        "event_count": parsed.event_count,
        "timezone": user.timezone,
        "from_this_app": parsed.from_this_app,
        "groups": groups_out,
        "skipped": [_entry_skipped(e) for e in parsed.skipped],
        "expires_at": upload.expires_at,
    }


# ---- apply entry point -----------------------------------------------------------------------

# test hook (integration tests inject a failure mid-apply to check atomicity, T018)
_after_group: Callable[[Run, PreviewGroup], None] | None = None


def apply(
    db: Session, storage: StorageService, user: User, upload: CalendarImportUpload, plan: ImportPlan
) -> dict[str, Any]:
    parsed = _parse(storage, upload, user)
    errors = validate_plan(plan.groups, parsed.groups)
    if errors:
        first = errors[0]
        raise ApiError(422, first["code"], first["message"], errors=errors)
    by_id = {g.group_id: g for g in parsed.groups}
    needs_destination = any(
        p.selected
        and p.group_id in by_id
        and not (by_id[p.group_id].saved is not None and p.semester == "saved")
        for p in plan.groups
    )
    if needs_destination:  # an app export going back to its saved semesters needs none
        if isinstance(plan.destination, RefNewSemester) and not plan.destination.new.name.strip():
            raise validation_error(
                "/destination/new/name", "destination_required", "Name the semester."
            )
        if isinstance(plan.destination, RefId):
            hs.get_semester(db, user, plan.destination.id)  # 404 before anything changes
    run_row = CalendarImportRun(
        user_id=user.id,
        file_name=upload.file_name,
        file_sha256=upload.sha256,
        created_json="{}",
        updated_json="{}",
        summary_json="{}",
    )
    db.add(run_row)
    db.flush()
    run = Run(db=db, storage=storage, user=user, plan=plan, run_id=run_row.id)
    plans = {p.group_id: p for p in plan.groups}
    run.skipped += [_entry_skipped(e) for e in parsed.skipped]
    try:
        for group in parsed.groups:
            p = plans.get(group.group_id)
            if p is None or not p.selected:
                run.skipped.append(
                    _skipped_item(group.title, "not_selected", NOT_SELECTED, group.first_date)
                )
                continue
            _apply_group(run, group, p)
            if _after_group is not None:
                _after_group(run, group)
    except ApiError:
        raise
    except Exception as err:
        raise ApiError(500, "import_failed", "The import failed and nothing was changed.") from err

    result = {
        "run_id": run_row.id,
        "classes": vars(run.counts["class"]),
        "events": vars(run.counts["event"]),
        "unchanged": run.unchanged,
        "courses_created": run.courses_created,
        "semester_id": run.destination.id if run.destination else None,
        "skipped": run.skipped,
        "notes": run.notes,
        "undo_available": bool(run.created["lineages"] or run.created["courseIds"]),
    }
    run_row.destination_semester_id = run.destination.id if run.destination else None
    run_row.created_json = json.dumps(run.created)
    run_row.updated_json = json.dumps({"lineages": run.updated})
    run_row.summary_json = json.dumps(result, default=str)
    if run.destination is not None:
        workspace_service.patch_preferences(db, user, {"last_semester_id": run.destination.id})
    _drop(db, storage, upload)
    db.flush()
    return result


def get_run(db: Session, user: User, run_id: str) -> CalendarImportRun:
    run = db.get(CalendarImportRun, run_id)
    if run is None or run.user_id != user.id:
        raise not_found("Import")
    return run
