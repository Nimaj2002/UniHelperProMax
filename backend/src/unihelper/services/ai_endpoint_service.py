"""Settings → AI: the student's endpoints and their models (014 US1, FR-012–FR-021).

Keys go into the encrypted secret store and never come back out of the API: views carry only
`{configured, masked, readable}` (FR-019). Test connection and Refresh use a draft configuration
and never write anything (FR-017)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.ai.base import AiError, DiscoveredModel, EndpointConfig
from unihelper.ai.errors import LOCAL_HINT
from unihelper.ai.http import NoModelList
from unihelper.ai.styles import adapter, default_capabilities
from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.domain.ai_addresses import AddressError, normalize, require_secure
from unihelper.models import AiEndpoint, AiModel, Chat, User
from unihelper.models.base import name_key, now_iso
from unihelper.schemas.ai import AiEndpointCreate, AiEndpointTest, AiEndpointUpdate, AiModelInput
from unihelper.secrets.store import KeyUnreadable, SecretStore
from unihelper.services import proxy_service

OWNER_KIND = "ai_endpoint"
TEST_BUDGET = 15.0

OUTCOME_MESSAGES = {
    "working": "Connected. The endpoint answered.",
    "key_rejected": "The API key was rejected.",
    "model_not_found": "This model isn't available on the endpoint.",
    "unreachable": "The endpoint couldn't be reached.",
    "timeout": "The endpoint didn't answer within 15 seconds.",
    "not_this_style": "The address answered, but it doesn't look like this request style.",
    "https_required": "Use https:// for this address. Only addresses on this computer or your "
    "local network may use plain http://.",
    "no_model_list": "This endpoint has no model list. Type the exact model ID and test again.",
}
STYLE_NAMES = {"openai": "OpenAI-compatible", "anthropic": "Anthropic", "gemini": "Google Gemini"}


# ───────────────────────────── views ─────────────────────────────


def model_out(m: AiModel) -> dict[str, Any]:
    return {
        "id": m.id,
        "model_id": m.model_id,
        "display_name": m.display_name,
        "capabilities": {"images": m.cap_images, "pdf": m.cap_pdf, "audio": m.cap_audio},
        "hidden": m.hidden,
        "source": m.source,
        "context_limit": m.context_limit,
        "output_limit": m.output_limit,
    }


def endpoint_out(db: Session, store: SecretStore, ep: AiEndpoint) -> dict[str, Any]:
    return {
        "id": ep.id,
        "name": ep.name,
        "style": ep.style,
        "base_url": ep.base_url,
        "locality": ep.locality,
        "enabled": ep.enabled,
        "key": store.state(db, ep.user_id, OWNER_KIND, ep.id),
        "models": [model_out(m) for m in ep.models],
        "privacy_acknowledged": ep.privacy_ack_at is not None,
        "version": ep.version,
    }


def get(db: Session, user: User, endpoint_id: str) -> AiEndpoint:
    ep = db.get(AiEndpoint, endpoint_id)
    if ep is None or ep.user_id != user.id:
        raise not_found("Endpoint")
    return ep


def list_endpoints(db: Session, user: User) -> list[AiEndpoint]:
    return list(
        db.scalars(
            select(AiEndpoint).where(AiEndpoint.user_id == user.id).order_by(AiEndpoint.created_at)
        )
    )


# ───────────────────────────── validation ─────────────────────────────


def _address(style: str, base_url: str, pointer: str = "/baseUrl") -> tuple[str, str]:
    try:
        n = normalize(style, base_url)
        require_secure(n.base_url, n.locality)
    except AddressError as exc:
        raise validation_error(pointer, exc.code, exc.message) from exc
    return n.base_url, n.locality


def _name(db: Session, user: User, name: str, exclude: str | None = None) -> tuple[str, str]:
    clean = " ".join(name.split())
    if not clean:
        raise validation_error("/name", "field_required", "Enter a name.")
    key = name_key(clean)
    clash = db.scalar(
        select(AiEndpoint.id).where(AiEndpoint.user_id == user.id, AiEndpoint.name_key == key)
    )
    if clash is not None and clash != exclude:
        raise ApiError(409, "name_taken", "Another endpoint already has this name.")
    return clean, key


def _apply_models(ep: AiEndpoint, inputs: list[AiModelInput]) -> None:
    existing = {m.id: m for m in ep.models}
    by_model_id = {m.model_id: m for m in ep.models}
    seen: set[str] = set()
    models: list[AiModel] = []
    for position, item in enumerate(inputs):
        if item.model_id in seen:
            raise validation_error(
                f"/models/{position}/modelId", "duplicate", "This model is listed twice."
            )
        seen.add(item.model_id)
        model = (
            existing.get(item.id or "")
            or by_model_id.get(item.model_id)
            or AiModel(user_id=ep.user_id)
        )
        model.model_id = item.model_id
        model.display_name = item.display_name
        model.cap_images = item.capabilities.images
        model.cap_pdf = item.capabilities.pdf
        model.cap_audio = item.capabilities.audio and ep.style != "anthropic"
        model.hidden = item.hidden
        model.source = item.source
        model.context_limit = item.context_limit
        model.output_limit = item.output_limit
        model.position = position
        models.append(model)
    ep.models = models


def _store_key(db: Session, store: SecretStore, ep: AiEndpoint, key: str | None) -> None:
    if key is None:
        store.remove(db, ep.user_id, OWNER_KIND, ep.id)
        ep.secret_id = None
        return
    try:
        ep.secret_id = store.put(db, ep.user_id, OWNER_KIND, ep.id, key)
    except KeyUnreadable as exc:
        raise ApiError(
            409,
            "key_store_unreadable",
            "Saved keys can't be read on this computer.",
            "Start a new key store in Settings, then enter the key again.",
        ) from exc


def _clean_key(raw: str | None) -> str | None:
    return raw.strip() or None if raw is not None else None


# ───────────────────────────── writes ─────────────────────────────


def create(db: Session, store: SecretStore, user: User, body: AiEndpointCreate) -> AiEndpoint:
    name, key = _name(db, user, body.name)
    base_url, locality = _address(body.style, body.base_url)
    ep = AiEndpoint(
        user_id=user.id,
        name=name,
        name_key=key,
        style=body.style,
        base_url=base_url,
        locality=locality,
        enabled=body.enabled,
    )
    db.add(ep)
    db.flush()
    _apply_models(ep, body.models)
    api_key = _clean_key(body.api_key)
    if api_key:
        _store_key(db, store, ep, api_key)
    db.flush()
    return ep


def update(
    db: Session,
    store: SecretStore,
    user: User,
    ep: AiEndpoint,
    body: AiEndpointUpdate,
    key_given: bool,
) -> AiEndpoint:
    if body.name is not None:
        ep.name, ep.name_key = _name(db, user, body.name, exclude=ep.id)
    style = body.style or ep.style
    if body.base_url is not None or body.style is not None:
        ep.base_url, ep.locality = _address(style, body.base_url or ep.base_url)
        ep.style = style
    if body.enabled is not None:
        ep.enabled = body.enabled
    if body.models is not None:
        _apply_models(ep, body.models)
    elif body.style == "anthropic":
        for m in ep.models:
            m.cap_audio = False
    if key_given:
        _store_key(db, store, ep, _clean_key(body.api_key))
    ep.updated_at = now_iso()  # bumps the version even when only models or the key changed
    db.flush()
    return ep


def delete(
    db: Session,
    store: SecretStore,
    ep: AiEndpoint,
    stop_runs: Callable[[str], None] | None = None,
) -> None:
    """Chats that used the endpoint keep their history and show the model name as text
    (FR-020): their `model_label` stays, `model_ref_id` becomes NULL with the models."""
    if stop_runs is not None:
        stop_runs(ep.id)
    model_ids = [m.id for m in ep.models]
    if model_ids:
        for chat in db.scalars(select(Chat).where(Chat.model_ref_id.in_(model_ids))):
            chat.model_ref_id = None
    store.remove(db, ep.user_id, OWNER_KIND, ep.id)
    db.delete(ep)
    db.flush()


def ack_privacy(db: Session, ep: AiEndpoint) -> AiEndpoint:
    if ep.privacy_ack_at is None:
        ep.privacy_ack_at = now_iso()
        db.flush()
    return ep


# ───────────────────────────── test and refresh (never write) ─────────────────────────────


def _draft_config(
    db: Session, store: SecretStore, user: User, body: AiEndpointTest
) -> EndpointConfig:
    n = normalize(body.style, body.base_url)
    key = _clean_key(body.api_key)
    if key is None and body.use_saved_key_of:
        saved = get(db, user, body.use_saved_key_of)
        try:
            key = store.reveal(db, user.id, OWNER_KIND, saved.id)
        except KeyUnreadable:
            key = None
    proxy = proxy_service.route(db, user.id, "ai", n.base_url)
    return EndpointConfig(body.style, n.base_url, n.locality, key, proxy)


def _outcome(error: AiError, cfg: EndpointConfig) -> dict[str, Any]:
    category = {"network": "unreachable"}.get(error.category, error.category)
    if category == "proxy":  # 021: the specific proxy failure
        return {"outcome": "proxy", "message": error.message}
    if category not in OUTCOME_MESSAGES:
        return {"outcome": "provider", "message": error.message}
    message = OUTCOME_MESSAGES[category]
    if category == "not_this_style" and error.looks_like:
        message += f" It looks like {STYLE_NAMES[error.looks_like]}."
    return {
        "outcome": category,
        "message": message,
        "hint": LOCAL_HINT if category == "unreachable" and cfg.locality == "local" else None,
        "looks_like": error.looks_like,
    }


async def test(
    db: Session,
    store: SecretStore,
    user: User,
    body: AiEndpointTest,
    transport: httpx.AsyncBaseTransport | None,
) -> dict[str, Any]:
    try:
        cfg = _draft_config(db, store, user, body)
    except AddressError as exc:
        return {
            "outcome": "https_required" if exc.code == "https_required" else "provider",
            "message": exc.message,
        }
    chat = adapter(cfg.style)
    typed = (body.model_id or "").strip() or None

    async def run() -> dict[str, Any]:
        async with proxy_service.client(cfg.proxy, transport) as http:
            try:
                models = await chat.list_models(http, cfg)
            except NoModelList:
                if typed is None:
                    return {"outcome": "provider", "message": OUTCOME_MESSAGES["no_model_list"]}
                await chat.probe(http, cfg, typed)
                return {"outcome": "working", "message": OUTCOME_MESSAGES["working"]}
            if typed is not None:  # the model the student typed must answer too
                await chat.probe(http, cfg, typed)
            return {
                "outcome": "working",
                "message": OUTCOME_MESSAGES["working"],
                "model_count": len(models),
            }

    try:
        return await asyncio.wait_for(run(), TEST_BUDGET)
    except TimeoutError:
        return {"outcome": "timeout", "message": OUTCOME_MESSAGES["timeout"]}
    except AiError as err:
        return _outcome(err, cfg)


def _candidate(style: str, found: DiscoveredModel, saved: dict[str, AiModel]) -> dict[str, Any]:
    old = saved.get(found.model_id)
    if old is not None:
        out = model_out(old)
        out["source"] = "fetched"
        out["context_limit"] = old.context_limit or found.context_limit
        out["output_limit"] = old.output_limit or found.output_limit
        return out
    return {
        "id": None,
        "model_id": found.model_id,
        "display_name": found.display_name[:80] or found.model_id[:80],
        "capabilities": default_capabilities(style),
        "hidden": False,
        "source": "fetched",
        "context_limit": found.context_limit,
        "output_limit": found.output_limit,
    }


async def discover(
    db: Session,
    store: SecretStore,
    user: User,
    body: AiEndpointTest,
    transport: httpx.AsyncBaseTransport | None,
) -> dict[str, Any]:
    try:
        cfg = _draft_config(db, store, user, body)
    except AddressError as exc:
        return {"outcome": "provider", "message": exc.message, "models": []}
    saved: dict[str, AiModel] = {}
    if body.use_saved_key_of:
        saved = {m.model_id: m for m in get(db, user, body.use_saved_key_of).models}

    async def run() -> list[DiscoveredModel]:
        async with proxy_service.client(cfg.proxy, transport) as http:
            return await adapter(cfg.style).list_models(http, cfg)

    try:
        found = await asyncio.wait_for(run(), TEST_BUDGET)
    except NoModelList:
        return {
            "outcome": "no_model_list",
            "message": OUTCOME_MESSAGES["no_model_list"],
            "models": [],
        }
    except TimeoutError:
        return {"outcome": "timeout", "message": OUTCOME_MESSAGES["timeout"], "models": []}
    except AiError as err:
        result = _outcome(err, cfg)
        outcome = result["outcome"]
        if outcome not in ("key_rejected", "unreachable", "timeout", "not_this_style", "proxy"):
            outcome = "provider"
        return {"outcome": outcome, "message": result["message"], "models": []}
    return {
        "outcome": "working",
        "message": None,
        "models": [_candidate(cfg.style, m, saved) for m in found[:500]],
    }


def config_for(db: Session, store: SecretStore, ep: AiEndpoint) -> EndpointConfig:
    """The endpoint's live configuration with its key, decrypted at the moment of use."""
    key = store.reveal(db, ep.user_id, OWNER_KIND, ep.id) if ep.secret_id else None
    proxy = proxy_service.route(db, ep.user_id, "ai", ep.base_url)
    return EndpointConfig(ep.style, ep.base_url, ep.locality, key, proxy)  # type: ignore[arg-type]
