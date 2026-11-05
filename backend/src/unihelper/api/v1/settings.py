from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, if_match_version
from unihelper.schemas.proxy import (
    ProxyDeleted,
    ProxySave,
    ProxySettingsOut,
    ProxyTest,
    ProxyTestResult,
)
from unihelper.schemas.settings import (
    ConnectionTest,
    ConnectionTestResult,
    TranscriptionSettings,
    TranscriptionSettingsSave,
)
from unihelper.services import proxy_service
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


# ───────────────────────────── 021: proxy ─────────────────────────────


@router.get("/settings/proxy", response_model=ProxySettingsOut)
def get_proxy(user: CurrentUser, db: DbSession) -> Any:
    return proxy_service.view(db, user)


@router.put("/settings/proxy", response_model=ProxySettingsOut)
def put_proxy(
    body: ProxySave,
    user: CurrentUser,
    db: DbSession,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Any:
    # If-Match is required only once a proxy exists (the service raises 428 then)
    version = if_match_version(if_match) if if_match is not None else None
    return proxy_service.put(db, user, body, "password" in body.model_fields_set, version)


@router.delete("/settings/proxy", response_model=ProxyDeleted)
def delete_proxy(version: IfMatch, user: CurrentUser, db: DbSession) -> Any:
    return proxy_service.delete(db, user, version)


@router.post("/settings/proxy/test", response_model=ProxyTestResult)
async def test_proxy(body: ProxyTest, user: CurrentUser, db: DbSession) -> Any:
    return await proxy_service.test(db, user, body)
