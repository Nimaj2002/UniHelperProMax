"""Years → semesters → courses, kept in sync with their folders (FR-014, FR-020, FR-022, FR-025)."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import false, func, select, update
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.db.engine import on_rollback
from unihelper.domain.naming import (
    EVENTS_DIR,
    is_reserved_course_folder,
    name_key,
    normalize_display,
    safe_name,
    unique_sibling,
)
from unihelper.models import (
    ClassSeries,
    Course,
    Document,
    EventSeries,
    Note,
    Recording,
    Semester,
    SessionFolder,
    User,
    Year,
)
from unihelper.storage.storage_service import StorageService

# ---- lookups (always scoped to the user; foreign ids are "not found") -------------------


def get_year(db: Session, user: User, year_id: str) -> Year:
    y = db.get(Year, year_id)
    if y is None or y.user_id != user.id:
        raise not_found("Year")
    return y


def get_semester(db: Session, user: User, semester_id: str) -> Semester:
    s = db.get(Semester, semester_id)
    if s is None or s.user_id != user.id:
        raise not_found("Semester")
    return s


def get_course(db: Session, user: User, course_id: str) -> Course:
    c = db.get(Course, course_id)
    if c is None or c.user_id != user.id:
        raise not_found("Course")
    return c


def course_parents(db: Session, course: Course) -> tuple[Semester, Year]:
    semester = db.get(Semester, course.semester_id)
    assert semester is not None
    year = db.get(Year, semester.year_id)
    assert year is not None
    return semester, year


# ---- folder paths ------------------------------------------------------------------------


def year_parts(user: User, year: Year) -> list[str]:
    return [user.username, year.folder_name]


def semester_parts(user: User, year: Year, semester: Semester) -> list[str]:
    return [*year_parts(user, year), semester.folder_name]


def course_parts(user: User, year: Year, semester: Semester, course: Course) -> list[str]:
    return [*semester_parts(user, year, semester), course.folder_name]


def _folder_for(name: str, siblings: list[str]) -> tuple[str, str]:
    folder = unique_sibling(safe_name(name), siblings)
    return folder, folder.casefold()


def _course_folder_for(name: str, siblings: list[str]) -> tuple[str, str]:
    """A course folder never takes the semester's `_Events` folder (009 research R1)."""
    return _folder_for(name, [*siblings, EVENTS_DIR])


def _clean(name: str, field: str = "/name") -> str:
    cleaned = normalize_display(name)
    if not cleaned:
        raise validation_error(field, "name_required", "Enter a name.")
    return cleaned


def _clean_course(name: str, field: str = "/name") -> str:
    cleaned = _clean(name, field)
    if is_reserved_course_folder(cleaned):
        raise validation_error(field, "reserved_name", "“_Events” is reserved for events.")
    return cleaned


def _check_dates(start: date | None, end: date | None) -> None:
    if start and end and end < start:
        raise validation_error(
            "/endDate", "invalid_date_range", "The end date must be on or after the start date."
        )


# ---- create (get-or-create by case-insensitive name) -----------------------------------


def _shift_years_down(db: Session, user: User) -> None:
    """Make room at position 0 without violating UNIQUE(user_id, position)."""
    db.execute(
        update(Year)
        .where(Year.user_id == user.id)
        .values(position=-Year.position - 2)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(Year)
        .where(Year.user_id == user.id)
        .values(position=-Year.position - 1)
        .execution_options(synchronize_session=False)
    )
    db.expire_all()


def get_or_create_year(
    db: Session, storage: StorageService, user: User, name: str
) -> tuple[Year, bool]:
    name = _clean(name)
    key = name_key(name)
    existing = db.scalar(select(Year).where(Year.user_id == user.id, Year.name_key == key))
    if existing is not None:
        return existing, False
    siblings = list(db.scalars(select(Year.folder_name).where(Year.user_id == user.id)))
    folder, folder_key = _folder_for(name, siblings)
    _shift_years_down(db, user)
    year = Year(
        user_id=user.id,
        name=name,
        name_key=key,
        folder_name=folder,
        folder_key=folder_key,
        position=0,
    )
    db.add(year)
    db.flush()
    storage.ensure_dir(year_parts(user, year))
    return year, True


def get_or_create_semester(
    db: Session,
    storage: StorageService,
    user: User,
    year: Year,
    name: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> tuple[Semester, bool]:
    name = _clean(name)
    key = name_key(name)
    existing = db.scalar(
        select(Semester).where(Semester.year_id == year.id, Semester.name_key == key)
    )
    if existing is not None:
        return existing, False
    _check_dates(start_date, end_date)
    siblings = list(db.scalars(select(Semester.folder_name).where(Semester.year_id == year.id)))
    folder, folder_key = _folder_for(name, siblings)
    sem = Semester(
        user_id=user.id,
        year_id=year.id,
        name=name,
        name_key=key,
        folder_name=folder,
        folder_key=folder_key,
        start_date=start_date,
        end_date=end_date,
    )
    db.add(sem)
    db.flush()
    storage.ensure_dir(semester_parts(user, year, sem))
    return sem, True


def get_or_create_course(
    db: Session,
    storage: StorageService,
    user: User,
    semester: Semester,
    name: str,
    default_color: str | None = None,
) -> tuple[Course, bool]:
    name = _clean_course(name)
    key = name_key(name)
    existing = db.scalar(
        select(Course).where(Course.semester_id == semester.id, Course.name_key == key)
    )
    if existing is not None:
        return existing, False
    year = db.get(Year, semester.year_id)
    assert year is not None
    siblings = list(db.scalars(select(Course.folder_name).where(Course.semester_id == semester.id)))
    folder, folder_key = _course_folder_for(name, siblings)
    course = Course(
        user_id=user.id,
        semester_id=semester.id,
        name=name,
        name_key=key,
        folder_name=folder,
        folder_key=folder_key,
        default_color=default_color or "blue",
    )
    db.add(course)
    db.flush()
    storage.ensure_dir(course_parts(user, year, semester, course))
    return course, True


# ---- reads -------------------------------------------------------------------------------


def list_years(db: Session, user: User) -> list[Year]:
    return list(db.scalars(select(Year).where(Year.user_id == user.id).order_by(Year.position)))


def _semester_order() -> tuple[Any, ...]:
    # most recent first: start date desc (nulls last), then created desc
    return (Semester.start_date.is_(None), Semester.start_date.desc(), Semester.created_at.desc())


def list_semesters(db: Session, user: User, year_id: str) -> list[Semester]:
    get_year(db, user, year_id)
    return list(
        db.scalars(select(Semester).where(Semester.year_id == year_id).order_by(*_semester_order()))
    )


def list_courses(db: Session, user: User, semester_id: str | None, q: str | None) -> list[Course]:
    stmt = select(Course).where(Course.user_id == user.id)
    if semester_id:
        get_semester(db, user, semester_id)
        stmt = stmt.where(Course.semester_id == semester_id)
    if q:
        stmt = stmt.where(Course.name_key.contains(name_key(q), autoescape=True))
    return list(db.scalars(stmt.order_by(Course.name_key)))


def course_tree(db: Session, user: User, q: str | None = None) -> list[dict[str, object]]:
    years = list_years(db, user)
    semesters = list(
        db.scalars(select(Semester).where(Semester.user_id == user.id).order_by(*_semester_order()))
    )
    courses = list_courses(db, user, None, q)
    by_sem: dict[str, list[Course]] = {}
    for c in courses:
        by_sem.setdefault(c.semester_id, []).append(c)
    by_year: dict[str, list[Semester]] = {}
    for s in semesters:
        by_year.setdefault(s.year_id, []).append(s)
    events = event_counts(db, user)
    out: list[dict[str, object]] = []
    for y in years:
        nodes = [
            {"semester": s, "courses": by_sem.get(s.id, []), "event_count": events.get(s.id, 0)}
            for s in by_year.get(y.id, [])
        ]
        if q:
            nodes = [n for n in nodes if n["courses"]]
            if not nodes:
                continue
        out.append({"year": y, "semesters": nodes})
    return out


def event_counts(db: Session, user: User) -> dict[str, int]:
    """Events (lineages) per semester id, for the course panel's "Events" row (009)."""
    rows = db.execute(
        select(EventSeries.semester_id, func.count(func.distinct(EventSeries.lineage_id)))
        .where(EventSeries.user_id == user.id)
        .group_by(EventSeries.semester_id)
    ).all()
    return {sem_id: int(n) for sem_id, n in rows}


def class_count(db: Session, *conditions: Any) -> int:
    return int(db.scalar(select(func.count()).select_from(ClassSeries).where(*conditions)) or 0)


# ---- rename / dates / delete / reorder (US3) -----------------------------------------


def _name_taken() -> ApiError:
    msg = "That name is already used here."
    return ApiError(
        409, "name_taken", msg, errors=[{"field": "/name", "code": "name_taken", "message": msg}]
    )


def _rename(
    db: Session,
    storage: StorageService,
    entity: Year | Semester | Course,
    new_name: str,
    sibling_folders: list[str],
    parts_before: list[str],
) -> None:
    """Rename entity + its folder. The folder move is compensated if the transaction fails."""
    is_course = isinstance(entity, Course)
    new_name = _clean_course(new_name) if is_course else _clean(new_name)
    entity.name = new_name
    entity.name_key = name_key(new_name)
    others = [f for f in sibling_folders if f.casefold() != entity.folder_key]
    folder, folder_key = (_course_folder_for if is_course else _folder_for)(new_name, others)
    if folder != entity.folder_name:
        undo = storage.rename_dir(parts_before, [*parts_before[:-1], folder])
        on_rollback(db, undo)
        entity.folder_name = folder
        entity.folder_key = folder_key
        _follow_rename(db, entity.user_id, parts_before, [*parts_before[:-1], folder])
    db.flush()


def _follow_rename(db: Session, user_id: str, before: list[str], after: list[str]) -> None:
    """009: folders in the Trash whose parents were deleted remember their directory by path
    (`origin_path`); a renamed year/semester/course folder takes them along on disk."""
    old = StorageService.relative_path(before) + "/"
    new = StorageService.relative_path(after) + "/"
    for f in db.scalars(
        select(SessionFolder).where(
            SessionFolder.user_id == user_id,
            SessionFolder.origin_path.startswith(old, autoescape=True),
        )
    ):
        assert f.origin_path is not None
        f.origin_path = new + f.origin_path[len(old) :]


def rename_year(db: Session, storage: StorageService, user: User, year: Year, name: str) -> Year:
    key = name_key(_clean(name))
    clash = db.scalar(
        select(Year).where(Year.user_id == user.id, Year.name_key == key, Year.id != year.id)
    )
    if clash is not None:
        raise _name_taken()
    siblings = list(db.scalars(select(Year.folder_name).where(Year.user_id == user.id)))
    _rename(db, storage, year, name, siblings, year_parts(user, year))
    return year


def update_semester(
    db: Session, storage: StorageService, user: User, sem: Semester, fields: dict[str, Any]
) -> Semester:
    start = fields.get("start_date", sem.start_date)
    end = fields.get("end_date", sem.end_date)
    _check_dates(start, end)
    if "end_date" in fields and fields["end_date"] is None and sem.end_date is not None:
        in_use = class_count(
            db,
            ClassSeries.end_kind == "semester_end",
            ClassSeries.course_id.in_(select(Course.id).where(Course.semester_id == sem.id)),
        )
        in_use += int(
            db.scalar(
                select(func.count())
                .select_from(EventSeries)
                .where(EventSeries.semester_id == sem.id, EventSeries.end_kind == "semester_end")
            )
            or 0
        )
        if in_use:
            raise validation_error(
                "/endDate",
                "semester_end_in_use",
                "Classes or events in this semester repeat until the semester ends. "
                "Change them before removing the end date.",
            )
    if "name" in fields and fields["name"] is not None:
        key = name_key(_clean(fields["name"]))
        clash = db.scalar(
            select(Semester).where(
                Semester.year_id == sem.year_id, Semester.name_key == key, Semester.id != sem.id
            )
        )
        if clash is not None:
            raise _name_taken()
        year = db.get(Year, sem.year_id)
        assert year is not None
        siblings = list(
            db.scalars(select(Semester.folder_name).where(Semester.year_id == sem.year_id))
        )
        _rename(db, storage, sem, fields["name"], siblings, semester_parts(user, year, sem))
    if "start_date" in fields:
        sem.start_date = fields["start_date"]
    if "end_date" in fields:
        sem.end_date = fields["end_date"]
    db.flush()
    return sem


def update_course(
    db: Session, storage: StorageService, user: User, course: Course, fields: dict[str, Any]
) -> Course:
    if fields.get("name") is not None:
        key = name_key(_clean_course(fields["name"]))
        clash = db.scalar(
            select(Course).where(
                Course.semester_id == course.semester_id,
                Course.name_key == key,
                Course.id != course.id,
            )
        )
        if clash is not None:
            raise _name_taken()
        semester, year = course_parents(db, course)
        siblings = list(
            db.scalars(select(Course.folder_name).where(Course.semester_id == course.semester_id))
        )
        _rename(
            db,
            storage,
            course,
            fields["name"],
            siblings,
            course_parts(user, year, semester, course),
        )
    if fields.get("default_color") is not None:
        course.default_color = fields["default_color"]
    db.flush()
    return course


def _renumber_years(db: Session, years: list[Year]) -> None:
    """Assign positions 0..n-1 in list order without tripping UNIQUE(user_id, position)."""
    for i, y in enumerate(years):
        y.position = -(i + 1)
    db.flush()
    for i, y in enumerate(years):
        y.position = i
    db.flush()


def reorder_years(db: Session, user: User, year_ids: list[str]) -> list[Year]:
    years = list_years(db, user)
    by_id = {y.id: y for y in years}
    if len(year_ids) != len(set(year_ids)) or set(year_ids) != set(by_id):
        raise ApiError(
            409, "order_mismatch", "The list of years has changed. Reload and try again."
        )
    ordered = [by_id[i] for i in year_ids]
    _renumber_years(db, ordered)
    return ordered


def deletion_impact(db: Session, user: User, kind: str, entity_id: str) -> dict[str, Any]:
    if kind == "year":
        y = get_year(db, user, entity_id)
        sem_ids = select(Semester.id).where(Semester.year_id == y.id)
        course_ids = select(Course.id).where(Course.semester_id.in_(sem_ids))
        sems = int(
            db.scalar(select(func.count()).select_from(Semester).where(Semester.year_id == y.id))
            or 0
        )
        courses = int(
            db.scalar(
                select(func.count()).select_from(Course).where(Course.semester_id.in_(sem_ids))
            )
            or 0
        )
        parts = year_parts(user, y)
    elif kind == "semester":
        sem = get_semester(db, user, entity_id)
        year = db.get(Year, sem.year_id)
        assert year is not None
        course_ids = select(Course.id).where(Course.semester_id == sem.id)
        sem_ids = select(Semester.id).where(Semester.id == sem.id)
        sems = 0
        courses = int(
            db.scalar(select(func.count()).select_from(Course).where(Course.semester_id == sem.id))
            or 0
        )
        parts = semester_parts(user, year, sem)
    else:
        course = get_course(db, user, entity_id)
        semester, year = course_parents(db, course)
        course_ids = select(Course.id).where(Course.id == course.id)
        sem_ids = select(Semester.id).where(false())
        sems = 0
        courses = 0
        parts = course_parts(user, year, semester, course)
    classes = int(
        db.scalar(
            select(func.count(func.distinct(ClassSeries.lineage_id))).where(
                ClassSeries.course_id.in_(course_ids)
            )
        )
        or 0
    )
    events = int(
        db.scalar(
            select(func.count(func.distinct(EventSeries.lineage_id))).where(
                EventSeries.semester_id.in_(sem_ids)
            )
        )
        or 0
    )
    folder_ids = select(SessionFolder.id).where(
        (SessionFolder.course_id.in_(course_ids)) | (SessionFolder.semester_id.in_(sem_ids)),
        SessionFolder.trash_entry_id.is_(None),
    )

    def count(model: Any) -> int:
        return int(
            db.scalar(
                select(func.count())
                .select_from(model)
                .where(model.session_folder_id.in_(folder_ids))
            )
            or 0
        )

    return {
        "semesters": sems,
        "courses": courses,
        "classes": classes,
        "events": events,
        "notes": count(Note),
        "recordings": count(Recording),
        "documents": count(Document),
        "kept_folder": StorageService.relative_path(parts),
    }


def _trash_contents(db: Session, user: User, course_ids: Any, semester_ids: Any) -> None:
    """009 FR-022a: before courses/semesters go, every class and event lineage inside moves to
    the Trash as its own entry ("all" scope; unscheduled folders with content go with their
    lineage). Every folder left under them — also ones already in the Trash — is detached
    (owner NULL, `origin_path` = where its directory is), so no content row is lost with the
    deleted rows. No file is touched."""
    from unihelper.services import trash_service

    class_lineages = set(
        db.scalars(select(ClassSeries.lineage_id).where(ClassSeries.course_id.in_(course_ids)))
    )
    event_lineages = set(
        db.scalars(select(EventSeries.lineage_id).where(EventSeries.semester_id.in_(semester_ids)))
    )
    under = (SessionFolder.course_id.in_(course_ids)) | (
        SessionFolder.semester_id.in_(semester_ids)
    )
    for f in db.scalars(select(SessionFolder).where(under, SessionFolder.trash_entry_id.is_(None))):
        (class_lineages if f.kind == "class" else event_lineages).add(f.lineage_id)
    for lineage_id in sorted(class_lineages):
        trash_service.move_lineage_to_trash(db, user, "class", lineage_id)
    for lineage_id in sorted(event_lineages):
        trash_service.move_lineage_to_trash(db, user, "event", lineage_id)
    trash_service.detach_folders(db, user, list(db.scalars(select(SessionFolder).where(under))))


def delete_year(db: Session, user: User, year: Year) -> None:
    sem_ids = select(Semester.id).where(Semester.year_id == year.id)
    _trash_contents(db, user, select(Course.id).where(Course.semester_id.in_(sem_ids)), sem_ids)
    db.delete(year)
    db.flush()
    _renumber_years(db, list_years(db, user))


def delete_entity(db: Session, user: User, entity: Semester | Course) -> None:
    """Metadata only; folders and files are never deleted (FR-019). 009: its classes and
    events go to the Trash first."""
    if isinstance(entity, Semester):
        _trash_contents(
            db,
            user,
            select(Course.id).where(Course.semester_id == entity.id),
            select(Semester.id).where(Semester.id == entity.id),
        )
    else:
        _trash_contents(
            db,
            user,
            select(Course.id).where(Course.id == entity.id),
            select(Semester.id).where(false()),
        )
    db.delete(entity)
    db.flush()
