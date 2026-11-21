from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Response, status

from unihelper.api.deps import CurrentUser, DbSession, Storage, if_match_version
from unihelper.api.errors import validation_error
from unihelper.schemas.media import MediaClassGroup, Peaks, TrimRequest, TrimResult
from unihelper.services import media_service as svc

router = APIRouter(tags=["media"])


@router.get("/media/recordings", response_model=list[MediaClassGroup])
def list_media_recordings(user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.browse(db, storage, user)


@router.get("/recordings/{recording_id}/peaks", response_model=Peaks)
def get_peaks(
    recording_id: str,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    buckets: Annotated[int, Query(ge=50, le=8000)] = 2000,
) -> Any:
    return svc.peaks(db, storage, user, recording_id, buckets)


def _ranges(body: TrimRequest) -> list[tuple[int, int]]:
    if body.ranges is not None and (body.start_ms is not None or body.end_ms is not None):
        raise validation_error("/ranges", "invalid_range", "Send either one window or ranges.")
    if body.ranges is not None:
        return [(r.start_ms, r.end_ms) for r in body.ranges]
    if body.start_ms is None or body.end_ms is None:
        raise validation_error("/ranges", "invalid_range", "Send startMs and endMs, or ranges.")
    return [(body.start_ms, body.end_ms)]


@router.post("/recordings/{recording_id}/trim", response_model=TrimResult)
def trim_recording(
    recording_id: str,
    body: TrimRequest,
    response: Response,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Any:
    ranges = _ranges(body)
    if body.mode == "new":
        response.status_code = status.HTTP_201_CREATED
        if body.name is None or not body.name.strip():
            raise validation_error("/name", "name_required", "Enter a name.")
        made = svc.trim_new(db, storage, user, recording_id, ranges, body.name, body.combine)
        return {"mode": "new", "recording": made[0], "recordings": made, "transcript_stale": False}
    if body.combine == "separate" and len(ranges) > 1:
        raise validation_error(
            "/combine", "overwrite_needs_merge", "Overwriting needs the windows merged into one."
        )
    rec, stale = svc.trim_overwrite(
        db, storage, user, recording_id, ranges, if_match_version(if_match)
    )
    return {"mode": "overwrite", "recording": rec, "recordings": [rec], "transcript_stale": stale}
