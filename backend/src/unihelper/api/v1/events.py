"""Events (009): creation, detail and the semester's events timeline. Event occurrences are
otherwise served by the `sessionKey` routes like class sessions."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from unihelper.api.deps import CurrentUser, DbSession, Storage
from unihelper.schemas.classes import UndoCreation
from unihelper.schemas.events import EventCreate, EventCreated, EventDetail, EventTimelineEntry
from unihelper.services import creation_undo, event_service, timeline_service

router = APIRouter(tags=["events"])


@router.post("/events", response_model=EventCreated, status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    series, created = event_service.create_event(db, storage, user, body)
    return {
        "lineage_id": series.lineage_id,
        "semester_id": series.semester_id,
        "version": series.version,
        "created": {"lineage_id": series.lineage_id, **created},
    }


@router.get("/events/{lineage_id}", response_model=EventDetail)
def get_event(lineage_id: str, user: CurrentUser, db: DbSession) -> Any:
    return event_service.get_event(db, user, lineage_id)


@router.get("/semesters/{semester_id}/events/timeline", response_model=list[EventTimelineEntry])
def semester_events_timeline(semester_id: str, user: CurrentUser, db: DbSession) -> Any:
    return timeline_service.semester_events_timeline(db, user, semester_id)


@router.post("/creations/undo", status_code=status.HTTP_204_NO_CONTENT, tags=["classes", "events"])
def undo_creation(
    body: UndoCreation, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    """The quick form's Undo (009 research R10): removes only what one create made."""
    creation_undo.undo_creation(db, storage, user, body.created, body.version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
