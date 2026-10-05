from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import FileResponse

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage
from unihelper.api.errors import ApiError
from unihelper.schemas.recordings import (
    ChunkResult,
    Recording,
    RecordingRename,
    RecordingStart,
    RecordingStop,
)
from unihelper.services import recording_service as svc

router = APIRouter(tags=["recordings"])


@router.get("/sessions/{session_key}/recordings", response_model=list[Recording])
def list_recordings(session_key: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.list_recordings(db, storage, user, session_key)


@router.post(
    "/sessions/{session_key}/recordings",
    response_model=Recording,
    status_code=status.HTTP_201_CREATED,
)
def start_recording(
    session_key: str, body: RecordingStart, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    return svc.start_recording(db, storage, user, session_key, body.mime_type)


@router.get("/recordings/active", response_model=Recording | None)
def active_recording(user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.active_recording(db, storage, user)


@router.get("/recordings/{recording_id}", response_model=Recording)
def get_recording(recording_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.get_recording(db, storage, user, recording_id)


@router.put("/recordings/{recording_id}/chunks/{seq}", response_model=ChunkResult)
async def put_chunk(
    recording_id: str,
    seq: int,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    if seq < 0:
        raise ApiError(422, "invalid_seq", "Chunk numbers start at 0.")
    data = await request.body()
    return svc.append_chunk(db, storage, user, recording_id, seq, data)


@router.post("/recordings/{recording_id}/stop", response_model=Recording)
def stop_recording(
    recording_id: str, body: RecordingStop, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    return svc.stop_recording(db, storage, user, recording_id, body.interrupted, body.duration_ms)


@router.get("/recordings/{recording_id}/audio", response_class=FileResponse)
def get_audio(recording_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    path, mime, name = svc.audio_file(db, storage, user, recording_id)
    return FileResponse(path, media_type=mime, filename=name, content_disposition_type="inline")


@router.patch("/recordings/{recording_id}", response_model=Recording)
def rename_recording(
    recording_id: str,
    body: RecordingRename,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    return svc.rename_recording(db, storage, user, recording_id, version, body.name)


@router.delete("/recordings/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(
    recording_id: str, version: IfMatch, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    svc.delete_recording(db, storage, user, recording_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
