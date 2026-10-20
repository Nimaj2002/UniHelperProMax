"""014 Settings → AI: request styles, endpoints and their models, custom instructions."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response

from unihelper.ai.styles import styles_out
from unihelper.api.deps import CurrentUser, DbSession, IfMatch, check_version
from unihelper.api.errors import validation_error
from unihelper.domain.ai_addresses import AddressError, normalize, require_secure
from unihelper.schemas.ai import (
    AiDiscoverResult,
    AiEndpointCreate,
    AiEndpointOut,
    AiEndpointTest,
    AiEndpointUpdate,
    AiSettingsOut,
    AiSettingsUpdate,
    AiStyle,
    AiTestResult,
    BaseUrlCheck,
    BaseUrlResult,
)
from unihelper.secrets.store import SecretStore
from unihelper.services import ai_endpoint_service as svc
from unihelper.services import ai_settings_service

router = APIRouter(tags=["ai"])


def _store(request: Request) -> SecretStore:
    store: SecretStore = request.app.state.secrets
    return store


def _stop_runs(request: Request) -> Any:
    runs = getattr(request.app.state, "chat_runs", None)
    return runs.stop_endpoint if runs is not None else None


@router.get("/ai/styles", response_model=list[AiStyle])
def styles(user: CurrentUser) -> Any:
    return styles_out()


@router.post("/ai/base-url/check", response_model=BaseUrlResult)
def check_base_url(body: BaseUrlCheck, user: CurrentUser) -> Any:
    try:
        n = normalize(body.style, body.base_url)
        require_secure(n.base_url, n.locality)
    except AddressError as exc:
        raise validation_error("/baseUrl", exc.code, exc.message) from exc
    return {"base_url": n.base_url, "removed_path": n.removed_path, "locality": n.locality}


@router.get("/ai/endpoints", response_model=list[AiEndpointOut])
def list_endpoints(request: Request, user: CurrentUser, db: DbSession) -> Any:
    store = _store(request)
    return [svc.endpoint_out(db, store, ep) for ep in svc.list_endpoints(db, user)]


@router.post("/ai/endpoints", response_model=AiEndpointOut, status_code=201)
def create_endpoint(
    body: AiEndpointCreate, request: Request, user: CurrentUser, db: DbSession
) -> Any:
    store = _store(request)
    return svc.endpoint_out(db, store, svc.create(db, store, user, body))


@router.post("/ai/endpoints/test", response_model=AiTestResult)
async def test_endpoint(
    body: AiEndpointTest, request: Request, user: CurrentUser, db: DbSession
) -> Any:
    return await svc.test(db, _store(request), user, body, request.app.state.ai_transport)


@router.post("/ai/endpoints/models/discover", response_model=AiDiscoverResult)
async def discover_models(
    body: AiEndpointTest, request: Request, user: CurrentUser, db: DbSession
) -> Any:
    return await svc.discover(db, _store(request), user, body, request.app.state.ai_transport)


@router.get("/ai/endpoints/{endpoint_id}", response_model=AiEndpointOut)
def get_endpoint(endpoint_id: str, request: Request, user: CurrentUser, db: DbSession) -> Any:
    return svc.endpoint_out(db, _store(request), svc.get(db, user, endpoint_id))


@router.patch("/ai/endpoints/{endpoint_id}", response_model=AiEndpointOut)
def update_endpoint(
    endpoint_id: str,
    body: AiEndpointUpdate,
    version: IfMatch,
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> Any:
    store = _store(request)
    ep = svc.get(db, user, endpoint_id)
    check_version(version, ep.version)
    ep = svc.update(db, store, user, ep, body, key_given="api_key" in body.model_fields_set)
    return svc.endpoint_out(db, store, ep)


@router.delete("/ai/endpoints/{endpoint_id}", status_code=204)
def delete_endpoint(
    endpoint_id: str, version: IfMatch, request: Request, user: CurrentUser, db: DbSession
) -> Response:
    ep = svc.get(db, user, endpoint_id)
    check_version(version, ep.version)
    svc.delete(db, _store(request), ep, _stop_runs(request))
    return Response(status_code=204)


@router.post("/ai/endpoints/{endpoint_id}/privacy-ack", response_model=AiEndpointOut)
def ack_privacy(endpoint_id: str, request: Request, user: CurrentUser, db: DbSession) -> Any:
    ep = svc.ack_privacy(db, svc.get(db, user, endpoint_id))
    return svc.endpoint_out(db, _store(request), ep)


@router.get("/ai/settings", response_model=AiSettingsOut)
def get_ai_settings(user: CurrentUser, db: DbSession) -> Any:
    return ai_settings_service.view(db, user)


@router.put("/ai/settings", response_model=AiSettingsOut)
def put_ai_settings(
    body: AiSettingsUpdate, version: IfMatch, user: CurrentUser, db: DbSession
) -> Any:
    check_version(version, ai_settings_service.row(db, user).version)
    ai_settings_service.put(db, user, body.custom_instructions)
    return ai_settings_service.view(db, user)
