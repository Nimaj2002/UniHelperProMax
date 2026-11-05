"""Settings → Proxy (021): one proxy per user, and which provider requests go through it.

`route()` is the single decision point used by every place that opens a provider client
(research R1). The password lives in the secret store (owner kind "proxy", owner id = user id)
and is never returned, logged or written to a file (Constitution IV).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal

import httpx
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, validation_error
from unihelper.domain import proxy as proxy_domain
from unihelper.models import AiSettings, ProxySettings, TranscriptionSettings, User
from unihelper.schemas.proxy import ProxySave, ProxyTest
from unihelper.secrets import store as secret_store

log = logging.getLogger("unihelper.proxy")

Section = Literal["transcription", "ai"]
OWNER_KIND = "proxy"
TEST_URL = "https://www.gstatic.com/generate_204"
TEST_BUDGET = 15.0
# tests replace this to answer the proxy test without the network
TEST_TRANSPORT: httpx.AsyncBaseTransport | None = None
TEST_MESSAGES: dict[str, str] = {
    "working": "The proxy works.",
    "timeout": "The proxy didn't answer within 15 seconds.",
    **proxy_domain.MESSAGES,
}
NOT_CONFIGURED = "Add a proxy in Settings → Proxy first."


def _switch_rows(db: Session, user_id: str) -> dict[Section, Any]:
    return {
        "transcription": db.get(TranscriptionSettings, user_id),
        "ai": db.get(AiSettings, user_id),
    }


def used_by(db: Session, user_id: str) -> list[Section]:
    return [s for s, row in _switch_rows(db, user_id).items() if row is not None and row.use_proxy]


def require_configured(db: Session, user_id: str) -> None:
    """Turning a "Use proxy" switch on needs a saved proxy (409)."""
    if db.get(ProxySettings, user_id) is None:
        raise ApiError(409, "proxy_not_configured", NOT_CONFIGURED)


# ───────────────────────────── routing ─────────────────────────────


def route(db: Session, user_id: str, section: Section, target_url: str) -> str | None:
    """The proxy URL for a request to `target_url`, or None to connect directly (data-model.md
    routing table). Never falls back: the caller uses exactly what this returns (FR-010)."""
    row = db.get(ProxySettings, user_id)
    switch = _switch_rows(db, user_id)[section]
    if row is None or switch is None or not switch.use_proxy:
        return None
    if proxy_domain.bypasses(target_url):
        return None
    try:
        password = secret_store.current().reveal(db, user_id, OWNER_KIND, user_id)
    except secret_store.KeyUnreadable:
        password = None  # the proxy then reports "credentials rejected"; never go direct
    log.info("provider request: section=%s proxied=True", section)
    return proxy_domain.proxy_url(row.scheme, row.host, row.port, row.username, password)


def client(proxy: str | None, transport: httpx.AsyncBaseTransport | None) -> httpx.AsyncClient:
    # an injected test transport replaces the network entirely, so httpx would ignore `proxy`
    return httpx.AsyncClient(transport=transport, proxy=proxy if transport is None else None)


# ───────────────────────────── settings ─────────────────────────────


def view(db: Session, user: User) -> dict[str, Any]:
    row = db.get(ProxySettings, user.id)
    proxy = None
    if row is not None:
        configured, readable, secret = False, True, None
        try:
            secret = secret_store.current().reveal(db, user.id, OWNER_KIND, user.id)
            configured = secret is not None
        except secret_store.KeyUnreadable:
            configured, readable = True, False
        proxy = {
            "scheme": row.scheme,
            "host": row.host,
            "port": row.port,
            "username": row.username,
            "password": {
                "configured": configured,
                "last4": secret[-4:] if secret and len(secret) >= 8 else None,
                "readable": readable,
            },
            "version": row.version,
            "updated_at": row.updated_at,
        }
    return {"proxy": proxy, "used_by": used_by(db, user.id)}


def _host(host: str) -> str:
    cleaned = proxy_domain.clean_host(host)
    if cleaned is None:
        raise validation_error(
            "/host",
            "invalid_host",
            "Enter only the proxy's host name or IP address, such as proxy.example.com.",
        )
    return cleaned


def put(
    db: Session, user: User, body: ProxySave, password_given: bool, version: int | None
) -> dict[str, Any]:
    host = _host(body.host)
    row = db.get(ProxySettings, user.id)
    if row is not None:
        if version is None:
            raise ApiError(428, "if_match_required", "This request needs an If-Match header.")
        if version != row.version:
            raise ApiError(
                412, "version_conflict", "This item was changed elsewhere. Reload and try again."
            )
    else:
        row = ProxySettings(user_id=user.id)
        db.add(row)
    row.scheme, row.host, row.port = body.scheme, host, body.port
    row.username = (body.username or "").strip() or None
    if password_given:
        store = secret_store.current()
        if body.password:
            try:
                store.put(db, user.id, OWNER_KIND, user.id, body.password)
            except secret_store.KeyUnreadable as exc:
                raise ApiError(
                    409,
                    "key_store_unreadable",
                    "Saved keys can't be read on this computer.",
                    "Start a new key store in Settings, then enter the password again.",
                ) from exc
        else:
            store.remove(db, user.id, OWNER_KIND, user.id)
    db.flush()
    return view(db, user)


def delete(db: Session, user: User, version: int) -> dict[str, Any]:
    row = db.get(ProxySettings, user.id)
    if row is None:
        raise ApiError(404, "not_found", "No proxy is saved.")
    if version != row.version:
        raise ApiError(
            412, "version_conflict", "This item was changed elsewhere. Reload and try again."
        )
    disabled = used_by(db, user.id)
    for switch in _switch_rows(db, user.id).values():
        if switch is not None:
            switch.use_proxy = False
    secret_store.current().remove(db, user.id, OWNER_KIND, user.id)
    db.delete(row)
    db.flush()
    return {"disabled_sections": disabled}


async def test(db: Session, user: User, body: ProxyTest) -> dict[str, Any]:
    host = _host(body.host)
    password = body.password or None
    if password is None and body.use_saved_password:
        try:
            password = secret_store.current().reveal(db, user.id, OWNER_KIND, user.id)
        except secret_store.KeyUnreadable:
            password = None
    url = proxy_domain.proxy_url(body.scheme, host, body.port, body.username, password)
    outcome: str
    try:
        async with client(url, TEST_TRANSPORT) as http:
            response = await asyncio.wait_for(
                http.get(TEST_URL, timeout=httpx.Timeout(TEST_BUDGET)), TEST_BUDGET
            )
        # an HTTP-type proxy answers a plain request itself when credentials are missing
        outcome = "credentials_rejected" if response.status_code == 407 else "working"
    except TimeoutError:
        outcome = "timeout"
    except httpx.TimeoutException as exc:
        outcome = proxy_domain.failure(exc) or "timeout"
    except httpx.HTTPError as exc:
        outcome = proxy_domain.failure(exc) or "no_onward_connection"
    log.info("proxy test: outcome=%s", outcome)
    return {"outcome": outcome, "message": TEST_MESSAGES[outcome]}
