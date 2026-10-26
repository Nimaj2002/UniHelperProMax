"""/api/v1/desktop/* (contracts/backend-desktop-mode.md §5). Always registered so the live API
matches the contract; every route answers 404 not_desktop outside desktop mode."""

from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select

from unihelper.api.deps import DbSession, get_settings
from unihelper.api.errors import ApiError
from unihelper.api.v1.health import app_version
from unihelper.chat.runs import RunRegistry
from unihelper.desktop import handshake, lifecycle
from unihelper.models import Recording, TranscriptionJob
from unihelper.models.transcription import ACTIVE_STATUSES
from unihelper.services import recording_service


def desktop_only(request: Request) -> None:
    if not get_settings(request).desktop:
        raise ApiError(404, "not_desktop", "Only available in the desktop app.")


router = APIRouter(prefix="/desktop", tags=["desktop"], dependencies=[Depends(desktop_only)])


def _handshake() -> handshake.Handshake:
    hs = handshake.current()
    if hs is None:  # desktop mode always has one; serve.py refuses to start without it
        raise ApiError(503, "not_ready", "The app is still starting.")
    return hs


@router.get("/identity")
def identity(request: Request, nonce: Annotated[str, Query()] = "") -> dict[str, Any]:
    try:
        proof = _handshake().proof(nonce)
    except handshake.HandshakeError as exc:
        raise ApiError(
            400, "bad_nonce", "The nonce must be 32–128 hexadecimal characters."
        ) from exc
    settings = get_settings(request)
    return {
        "proof": proof,
        "version": app_version(request),
        "pid": os.getpid(),
        "port": settings.port,
    }


@router.post("/shutdown", status_code=status.HTTP_202_ACCEPTED)
def shutdown(request: Request) -> dict[str, str]:
    if not _handshake().check_bearer(request.headers.get("authorization")):
        raise ApiError(401, "bad_token", "Not allowed to stop the app.")
    lifecycle.request_shutdown()
    return {"status": "stopping"}


@router.get("/busy")
def busy(request: Request, db: DbSession) -> dict[str, bool]:
    """Work running inside the server; the window reports its own pending saves (FR-013a)."""
    recording = any(
        recording_service.is_active(r)
        for r in db.scalars(select(Recording).where(Recording.status == "recording")).all()
    )
    transcribing = (
        db.scalar(
            select(func.count())
            .select_from(TranscriptionJob)
            .where(TranscriptionJob.status.in_(ACTIVE_STATUSES))
        )
        or 0
    ) > 0
    runs: RunRegistry = request.app.state.chat_runs
    return {
        "recording": recording,
        "transcribing": transcribing,
        "chatRunning": bool(runs.active()),
    }
