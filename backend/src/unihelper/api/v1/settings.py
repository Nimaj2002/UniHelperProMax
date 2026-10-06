from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from unihelper.api.deps import CurrentUser, DbSession
from unihelper.schemas.settings import (
    ConnectionTest,
    ConnectionTestResult,
    TranscriptionSettings,
    TranscriptionSettingsSave,
)
from unihelper.services import transcription_settings_service as svc

router = APIRouter(tags=["settings"])


@router.get("/settings/transcription", response_model=TranscriptionSettings)
def get_settings(user: CurrentUser, db: DbSession) -> Any:
    return svc.view(db, user)


@router.put("/settings/transcription", response_model=TranscriptionSettings)
def save_settings(body: TranscriptionSettingsSave, user: CurrentUser, db: DbSession) -> Any:
    return svc.save(db, user, body, key_given="api_key" in body.provider.model_fields_set)


@router.post("/settings/transcription/test", response_model=ConnectionTestResult)
async def test_connection(
    body: ConnectionTest, request: Request, user: CurrentUser, db: DbSession
) -> Any:
    # the worker's transport: tests route provider HTTP to the in-process fake transcriber
    transport = request.app.state.transcription_worker.transport
    return await svc.test(db, user, body, transport)
