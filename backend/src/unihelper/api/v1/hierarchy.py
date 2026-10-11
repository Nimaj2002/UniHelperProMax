from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response, status

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage, check_version
from unihelper.schemas.hierarchy import (
    Course,
    CourseCreate,
    CourseDetail,
    CourseUpdate,
    DeletionImpact,
    Semester,
    SemesterCreate,
    SemesterUpdate,
    Year,
    YearInput,
    YearNode,
    YearOrder,
)
from unihelper.services import class_service
from unihelper.services import hierarchy_service as hs

router = APIRouter(tags=["hierarchy"])


def _created(response: Response, created: bool) -> None:
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK


@router.get("/course-tree", response_model=list[YearNode])
def course_tree(
    user: CurrentUser, db: DbSession, q: str | None = Query(default=None, max_length=120)
) -> Any:
    return hs.course_tree(db, user, q)


@router.get("/years", response_model=list[Year])
def list_years(user: CurrentUser, db: DbSession) -> Any:
    return hs.list_years(db, user)


@router.post(
    "/years",
    response_model=Year,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"model": Year, "description": "Existing year returned"}},
)
def create_year(
    body: YearInput, response: Response, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    year, created = hs.get_or_create_year(db, storage, user, body.name)
    _created(response, created)
    return year


@router.get("/semesters", response_model=list[Semester])
def list_semesters(user: CurrentUser, db: DbSession, year_id: str = Query(alias="yearId")) -> Any:
    return hs.list_semesters(db, user, year_id)


@router.post(
    "/semesters",
    response_model=Semester,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"model": Semester, "description": "Existing semester returned"}},
)
def create_semester(
    body: SemesterCreate, response: Response, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    year = hs.get_year(db, user, body.year_id)
    sem, created = hs.get_or_create_semester(
        db, storage, user, year, body.name, body.start_date, body.end_date
    )
    _created(response, created)
    return sem


@router.get("/courses", response_model=list[Course])
def list_courses(
    user: CurrentUser,
    db: DbSession,
    semester_id: str | None = Query(default=None, alias="semesterId"),
    q: str | None = Query(default=None, max_length=120),
) -> Any:
    return hs.list_courses(db, user, semester_id, q)


@router.post(
    "/courses",
    response_model=Course,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"model": Course, "description": "Existing course returned"}},
)
def create_course(
    body: CourseCreate, response: Response, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    sem = hs.get_semester(db, user, body.semester_id)
    course, created = hs.get_or_create_course(db, storage, user, sem, body.name, body.default_color)
    _created(response, created)
    return course


@router.get("/courses/{course_id}", response_model=CourseDetail)
def get_course(course_id: str, user: CurrentUser, db: DbSession) -> Any:
    course = hs.get_course(db, user, course_id)
    semester, year = hs.course_parents(db, course)
    return class_service.course_detail(course, semester, year)


def _no_content() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# PUT /years/order is declared before /years/{year_id} so "order" is never taken as an id.
@router.put("/years/order", response_model=list[Year])
def reorder_years(body: YearOrder, user: CurrentUser, db: DbSession) -> Any:
    return hs.reorder_years(db, user, body.year_ids)


@router.patch("/years/{year_id}", response_model=Year)
def rename_year(
    year_id: str,
    body: YearInput,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    year = hs.get_year(db, user, year_id)
    check_version(version, year.version)
    return hs.rename_year(db, storage, user, year, body.name)


@router.delete("/years/{year_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_year(year_id: str, version: IfMatch, user: CurrentUser, db: DbSession) -> Response:
    year = hs.get_year(db, user, year_id)
    check_version(version, year.version)
    hs.delete_year(db, user, year)
    return _no_content()


@router.get("/years/{year_id}/deletion-impact", response_model=DeletionImpact)
def year_impact(year_id: str, user: CurrentUser, db: DbSession) -> Any:
    return hs.deletion_impact(db, user, "year", year_id)


@router.patch("/semesters/{semester_id}", response_model=Semester)
def update_semester(
    semester_id: str,
    body: SemesterUpdate,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    sem = hs.get_semester(db, user, semester_id)
    check_version(version, sem.version)
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    return hs.update_semester(db, storage, user, sem, fields)


@router.delete("/semesters/{semester_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_semester(
    semester_id: str, version: IfMatch, user: CurrentUser, db: DbSession
) -> Response:
    sem = hs.get_semester(db, user, semester_id)
    check_version(version, sem.version)
    hs.delete_entity(db, user, sem)
    return _no_content()


@router.get("/semesters/{semester_id}/deletion-impact", response_model=DeletionImpact)
def semester_impact(semester_id: str, user: CurrentUser, db: DbSession) -> Any:
    return hs.deletion_impact(db, user, "semester", semester_id)


@router.patch("/courses/{course_id}", response_model=Course)
def update_course(
    course_id: str,
    body: CourseUpdate,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    course = hs.get_course(db, user, course_id)
    check_version(version, course.version)
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    return hs.update_course(db, storage, user, course, fields)


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: str, version: IfMatch, user: CurrentUser, db: DbSession) -> Response:
    course = hs.get_course(db, user, course_id)
    check_version(version, course.version)
    hs.delete_entity(db, user, course)
    return _no_content()


@router.get("/courses/{course_id}/deletion-impact", response_model=DeletionImpact)
def course_impact(course_id: str, user: CurrentUser, db: DbSession) -> Any:
    return hs.deletion_impact(db, user, "course", course_id)
