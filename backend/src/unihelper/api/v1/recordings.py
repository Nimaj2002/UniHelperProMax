from __future__ import annotations

import errno
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import FileResponse
from starlette.requests import ClientDisconnect

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage
from unihelper.api.errors import ApiError
from unihelper.domain import audio_probe
from unihelper.schemas.recordings import (
    ChunkResult,
    Recording,
    RecordingRename,
    RecordingStart,
    RecordingStop,
)
from unihelper.services import recording_service as svc
from unihelper.services import session_folder_service as sfs

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


# ---- import (feature 006, research I5) ----------------------------------------------------

MAX_IMPORT_BYTES = 1024 * 1024 * 1024  # 1 GB (FR-004)
FREE_SPACE_MARGIN = 64 * 1024 * 1024
WRITE_SIZE = 1024 * 1024


def _too_large() -> ApiError:
    return ApiError(
        413,
        "file_too_large",
        "Audio files can be at most 1 GB.",
        extra={"maxBytes": MAX_IMPORT_BYTES},
    )


def _no_space() -> ApiError:
    return ApiError(507, "insufficient_storage", "There isn't enough space on the server.")


@router.post(
    "/sessions/{session_key}/recordings/import",
    response_model=Recording,
    status_code=status.HTTP_201_CREATED,
)
async def import_recording(
    session_key: str,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    file_name: Annotated[str, Query(alias="fileName", min_length=1, max_length=255)],
    duration_ms: Annotated[int | None, Query(alias="durationMs", ge=0)] = None,
) -> Any:
    """Stream one audio file into staging, check it, then move it into the session (FR-001–
    FR-010). Everything that can be refused is refused before the body is read (SC-002)."""
    if audio_probe.mime_for(file_name) is None:
        raise ApiError(
            415,
            "unsupported_type",
            "This file type isn't supported.",
            extra={"accepted": list(audio_probe.ACCEPTED_EXTENSIONS)},
        )
    raw_length = request.headers.get("content-length")
    if raw_length is None or not raw_length.isdigit():
        raise ApiError(411, "length_required", "The upload must state its size.")
    length = int(raw_length)
    if length > MAX_IMPORT_BYTES:
        raise _too_large()
    if length == 0:
        raise ApiError(422, "unreadable_audio", f"{file_name} couldn't be read as audio.")
    await anyio.to_thread.run_sync(sfs.resolve, db, user, session_key)  # 404 before the body
    if await anyio.to_thread.run_sync(storage.free_bytes) < length + FREE_SPACE_MARGIN:
        raise _no_space()

    staged, fh = await anyio.to_thread.run_sync(storage.open_upload)
    received = 0
    try:
        try:
            buffer = bytearray()
            async for chunk in request.stream():
                received += len(chunk)
                if received > MAX_IMPORT_BYTES:
                    raise _too_large()
                buffer += chunk
                if len(buffer) >= WRITE_SIZE:
                    await anyio.to_thread.run_sync(fh.write, bytes(buffer))
                    buffer.clear()
            if buffer:
                await anyio.to_thread.run_sync(fh.write, bytes(buffer))
        finally:
            await anyio.to_thread.run_sync(fh.close)
        if received != length:
            raise ApiError(
                422, "incomplete_upload", "The upload ended before the whole file arrived."
            )
        return await anyio.to_thread.run_sync(
            svc.import_audio, db, storage, user, session_key, staged, file_name, duration_ms
        )
    except ClientDisconnect:
        await anyio.to_thread.run_sync(storage.discard_upload, staged)
        # the browser cancelled or went away: nobody receives this answer
        raise ApiError(400, "upload_cancelled", "The upload was cancelled.") from None
    except OSError as err:
        await anyio.to_thread.run_sync(storage.discard_upload, staged)
        if err.errno == errno.ENOSPC:
            raise _no_space() from err
        raise
    except BaseException:
        await anyio.to_thread.run_sync(storage.discard_upload, staged)
        raise
