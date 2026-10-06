from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request, Response, status

from unihelper.api.deps import CurrentUser, DbSession, Storage
from unihelper.api.errors import validation_error
from unihelper.schemas.transcription import (
    ProviderSpec,
    TranscriptionJob,
    TranscriptionStart,
    TranscriptionStatus,
)
from unihelper.services import transcription_service as svc
from unihelper.transcription import config as provider_config
from unihelper.transcription.providers import all_specs
from unihelper.transcription.worker import TranscriptionWorker

router = APIRouter(tags=["transcription"])


def _worker(request: Request) -> TranscriptionWorker:
    return request.app.state.transcription_worker  # type: ignore[no-any-return]


@router.get("/transcription/providers", response_model=list[ProviderSpec])
def providers(user: CurrentUser) -> Any:
    return [
        {
            "id": s.id,
            "name": s.name,
            "fields": [vars(f) for f in s.fields],
            "max_upload_bytes": s.max_upload_bytes,
        }
        for s in all_specs()
    ]


@router.get("/transcription/status", response_model=TranscriptionStatus)
def transcription_status(user: CurrentUser, db: DbSession) -> Any:
    return provider_config.status(db, user)


@router.post(
    "/recordings/{recording_id}/transcriptions",
    response_model=TranscriptionJob,
    status_code=status.HTTP_202_ACCEPTED,
)
def start(
    recording_id: str,
    body: TranscriptionStart,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    return svc.start(db, storage, user, recording_id, body, _worker(request).wake)


@router.get("/transcriptions/active", response_model=TranscriptionJob | None)
def active(user: CurrentUser, db: DbSession) -> Any:
    return svc.active_job(db, user)


@router.get("/transcriptions", response_model=list[TranscriptionJob])
def unseen(user: CurrentUser, db: DbSession, unseen: bool = Query()) -> Any:
    if not unseen:  # the only supported listing is "not yet acknowledged"
        raise validation_error("/unseen", "unsupported", "Only unseen=true is supported.")
    return svc.unseen_jobs(db, user)


@router.get("/sessions/{session_key}/transcriptions", response_model=list[TranscriptionJob])
def session_history(session_key: str, user: CurrentUser, db: DbSession) -> Any:
    return svc.session_jobs(db, user, session_key)


@router.get("/transcriptions/{job_id}", response_model=TranscriptionJob)
def get_job(job_id: str, user: CurrentUser, db: DbSession) -> Any:
    return svc.get_job(db, user, job_id)


@router.post("/transcriptions/{job_id}/cancel", response_model=TranscriptionJob)
def cancel(job_id: str, request: Request, user: CurrentUser, db: DbSession) -> Any:
    return svc.cancel(db, user, job_id, _worker(request).interrupt)


@router.post(
    "/transcriptions/{job_id}/retry",
    response_model=TranscriptionJob,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry(job_id: str, request: Request, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.retry(db, storage, user, job_id, _worker(request).wake)


@router.post("/transcriptions/{job_id}/seen", status_code=status.HTTP_204_NO_CONTENT)
def seen(job_id: str, user: CurrentUser, db: DbSession) -> Response:
    svc.mark_seen(db, user, job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
