from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from unihelper.api.deps import CurrentUser, DbSession
from unihelper.schemas.notes import Timeline
from unihelper.services import timeline_service

router = APIRouter(tags=["timeline"])


@router.get("/courses/{course_id}/timeline", response_model=Timeline)
def course_timeline(course_id: str, user: CurrentUser, db: DbSession) -> Any:
    return timeline_service.course_timeline(db, user, course_id)
