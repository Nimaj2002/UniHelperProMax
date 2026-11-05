"""021 US1: Settings → Proxy — save, mask, replace/remove, test, delete (contracts/openapi.yaml)."""

from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem, register_test_key
from tests.contract.openapi_check import check
from tests.contract.transcription_helpers import API
from unihelper.services import proxy_service

pytestmark = pytest.mark.contract
URL = f"{API}/settings/proxy"
PASSWORD = register_test_key("proxy-pass-@:/ 9876wxyz")


def body(**over: object) -> dict[str, object]:
    data: dict[str, object] = {"scheme": "http", "host": "proxy.example.com", "port": 8080}
    data.update(over)
    return data


def _version(c: TestClient) -> str:
    return str(c.get(URL).json()["proxy"]["version"])


def test_empty_then_create_masked(owner_client: TestClient) -> None:
    c = owner_client
    r = c.get(URL)
    assert r.status_code == 200
    check(r.json(), "ProxySettings", spec="021")
    assert r.json() == {"proxy": None, "usedBy": []}

    r = c.put(URL, json=body(username="me", password=PASSWORD))
    assert r.status_code == 200, r.text
    out = r.json()
    check(out, "ProxySettings", spec="021")
    p = out["proxy"]
    assert (p["scheme"], p["host"], p["port"], p["username"]) == (
        "http",
        "proxy.example.com",
        8080,
        "me",
    )
    assert p["password"] == {"configured": True, "last4": "wxyz", "readable": True}
    assert PASSWORD not in r.text


def test_password_keep_replace_remove(owner_client: TestClient) -> None:
    c = owner_client
    c.put(URL, json=body(password=PASSWORD))
    # absent → kept
    r = c.put(URL, json=body(port=3128), headers={"If-Match": _version(c)})
    assert r.status_code == 200, r.text
    assert r.json()["proxy"]["port"] == 3128
    assert r.json()["proxy"]["password"]["configured"] is True
    # short password → no characters shown
    r = c.put(URL, json=body(password="short"), headers={"If-Match": _version(c)})
    assert r.json()["proxy"]["password"] == {"configured": True, "last4": None, "readable": True}
    # null → removed
    r = c.put(URL, json=body(password=None), headers={"If-Match": _version(c)})
    assert r.json()["proxy"]["password"]["configured"] is False


def test_versioning(owner_client: TestClient) -> None:
    c = owner_client
    c.put(URL, json=body())
    assert_problem(c.put(URL, json=body()), 428, "if_match_required")
    assert_problem(c.put(URL, json=body(), headers={"If-Match": "99"}), 412, "version_conflict")
    assert_problem(c.delete(URL), 428, "if_match_required")
    assert_problem(c.delete(URL, headers={"If-Match": "99"}), 412, "version_conflict")


@pytest.mark.parametrize(
    ("over", "code"),
    [
        ({"port": 70000}, None),
        ({"port": 0}, None),
        ({"host": "http://x/y"}, "invalid_host"),
        ({"host": "user@proxy"}, "invalid_host"),
        ({"host": "proxy:8080"}, "invalid_host"),
        ({"scheme": "ftp"}, None),
    ],
)
def test_invalid_input(owner_client: TestClient, over: dict[str, object], code: str | None) -> None:
    r = owner_client.put(URL, json=body(**over))
    assert r.status_code == 422
    check(r.json(), "Problem", spec="021")
    if code:
        assert_problem(r, 422, code)
    assert owner_client.get(URL).json()["proxy"] is None


def test_ipv6_host_kept_bare(owner_client: TestClient) -> None:
    r = owner_client.put(URL, json=body(host="[::1]"))
    assert r.json()["proxy"]["host"] == "::1"


def test_delete(owner_client: TestClient) -> None:
    c = owner_client
    assert_problem(c.delete(URL, headers={"If-Match": "1"}), 404, "not_found")
    c.put(URL, json=body(password=PASSWORD))
    r = c.delete(URL, headers={"If-Match": _version(c)})
    assert r.status_code == 200
    check(r.json(), "ProxyDeleted", spec="021")
    assert r.json() == {"disabledSections": []}
    assert c.get(URL).json()["proxy"] is None


def test_csrf_required(owner_client: TestClient) -> None:
    c = owner_client
    token = c.headers.pop("X-CSRF-Token")
    try:
        assert c.put(URL, json=body()).status_code == 403
    finally:
        c.headers["X-CSRF-Token"] = token


# ───────────────────────────── test proxy ─────────────────────────────


def _answer(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _raise(exc: Exception) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise exc

    return httpx.MockTransport(handler)


@pytest.mark.parametrize(
    ("transport", "outcome"),
    [
        (_answer(lambda r: httpx.Response(204)), "working"),
        (_answer(lambda r: httpx.Response(500)), "working"),  # any answer: the proxy got through
        (_answer(lambda r: httpx.Response(407)), "credentials_rejected"),
        (_raise(httpx.ConnectError("refused")), "unreachable"),
        (_raise(httpx.ConnectTimeout("slow")), "unreachable"),
        (_raise(httpx.ProxyError("407 Proxy Authentication Required")), "credentials_rejected"),
        (_raise(httpx.ProxyError("502 Bad Gateway")), "no_onward_connection"),
        (_raise(httpx.ReadTimeout("slow")), "timeout"),
    ],
)
def test_proxy_test_outcomes(
    owner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    transport: httpx.MockTransport,
    outcome: str,
) -> None:
    monkeypatch.setattr(proxy_service, "TEST_TRANSPORT", transport)
    r = owner_client.post(f"{URL}/test", json=body(password=PASSWORD))
    assert r.status_code == 200, r.text
    check(r.json(), "ProxyTestResult", spec="021")
    assert r.json()["outcome"] == outcome
    if outcome != "working":
        assert "proxy" in r.json()["message"].lower()
    assert PASSWORD not in r.text


def test_proxy_test_uses_saved_password(
    owner_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    c.put(URL, json=body(username="me", password=PASSWORD))
    seen: list[str | None] = []

    def fake_url(scheme: str, host: str, port: int, user: str | None, pw: str | None) -> str:
        seen.append(pw)
        return "http://proxy.example.com:8080"

    monkeypatch.setattr(proxy_service.proxy_domain, "proxy_url", fake_url)
    monkeypatch.setattr(proxy_service, "TEST_TRANSPORT", _answer(lambda r: httpx.Response(204)))
    c.post(f"{URL}/test", json=body(username="me", useSavedPassword=True))
    c.post(f"{URL}/test", json=body(username="me"))
    assert seen == [PASSWORD, None]


def test_proxy_test_rejects_bad_host(owner_client: TestClient) -> None:
    assert_problem(owner_client.post(f"{URL}/test", json=body(host="a b")), 422, "invalid_host")


# ───────────────────────────── routing (data-model.md table) ─────────────────────────────


def test_route_table(app, owner_client: TestClient) -> None:  # type: ignore[no-untyped-def]
    from sqlalchemy import select

    from unihelper.models import AiSettings, TranscriptionSettings, User

    c = owner_client
    remote, local = "https://api.openai.com/v1", "http://localhost:11434/v1"
    with app.state.sessionmaker() as db:
        uid = db.scalar(select(User.id))
        assert proxy_service.route(db, uid, "ai", remote) is None  # no proxy saved
    c.put(URL, json=body(username="me", password=PASSWORD))
    with app.state.sessionmaker() as db:
        assert proxy_service.route(db, uid, "ai", remote) is None  # switch off (no row)
        db.add(AiSettings(user_id=uid, use_proxy=True))
        db.add(TranscriptionSettings(user_id=uid, use_proxy=False))
        db.flush()
        expected = "http://me:" + "proxy-pass-%40%3A%2F%209876wxyz" + "@proxy.example.com:8080"
        assert proxy_service.route(db, uid, "ai", remote) == expected
        assert proxy_service.route(db, uid, "ai", local) is None  # local bypass (FR-011a)
        assert proxy_service.route(db, uid, "transcription", remote) is None  # independent
        db.rollback()


# ───────────────────────────── US2: transcription switch ─────────────────────────────

TRANSCRIPTION = f"{API}/settings/transcription"


def vs(address: str, use_proxy: bool | None = None) -> dict[str, object]:
    data: dict[str, object] = {
        "activeProviderId": "voice-studio",
        "defaultLanguage": "auto",
        "provider": {"providerId": "voice-studio", "values": {"address": address}},
    }
    if use_proxy is not None:
        data["useProxy"] = use_proxy
    return data


def _spy_clients(monkeypatch: pytest.MonkeyPatch) -> list[str | None]:
    seen: list[str | None] = []
    real = proxy_service.client

    def spy(proxy: str | None, transport: httpx.AsyncBaseTransport | None) -> httpx.AsyncClient:
        seen.append(proxy)
        return real(proxy, transport)

    monkeypatch.setattr(proxy_service, "client", spy)
    return seen


def test_transcription_switch(owner_client: TestClient) -> None:
    c = owner_client
    r = c.get(TRANSCRIPTION)
    check(r.json(), "TranscriptionSettings", spec="005")
    assert r.json()["useProxy"] is False
    assert_problem(c.put(TRANSCRIPTION, json=vs("http://fake", True)), 409, "proxy_not_configured")

    c.put(URL, json=body())
    r = c.put(TRANSCRIPTION, json=vs("http://fake", True))
    assert r.status_code == 200, r.text
    check(r.json(), "TranscriptionSettings", spec="005")
    assert r.json()["useProxy"] is True
    assert c.put(TRANSCRIPTION, json=vs("http://fake")).json()["useProxy"] is True  # absent: kept
    assert c.get(URL).json()["usedBy"] == ["transcription"]

    r = c.delete(URL, headers={"If-Match": _version(c)})
    assert r.json() == {"disabledSections": ["transcription"]}
    assert c.get(TRANSCRIPTION).json()["useProxy"] is False


def test_transcription_test_through_proxy(
    app,
    owner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,  # type: ignore[no-untyped-def]
) -> None:
    c = owner_client
    c.put(URL, json=body())
    c.put(TRANSCRIPTION, json=vs("http://fake", True))
    seen = _spy_clients(monkeypatch)

    # local address: direct even with the switch on (FR-011a), and the fake answers
    r = c.post(f"{TRANSCRIPTION}/test", json={"providerId": "voice-studio",
                                              "values": {"address": "http://fake"}})  # fmt: skip
    assert r.json()["ok"] is True and seen == [None]

    # remote address: through the proxy; a dead proxy is named, never bypassed (FR-010)
    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(app.state.transcription_worker, "transport", httpx.MockTransport(refused))
    remote = {"providerId": "voice-studio", "values": {"address": "https://stt.example.com"}}
    r = c.post(f"{TRANSCRIPTION}/test", json=remote)
    out = r.json()
    check(out, "ConnectionTestResult", spec="005")
    assert seen[-1] == "http://proxy.example.com:8080"
    assert (out["ok"], out["category"]) == (False, "proxy")
    assert "proxy" in out["message"].lower()


# ───────────────────────────── US3: AI switch ─────────────────────────────

AI_SETTINGS = f"{API}/ai/settings"


def _ai_put(c: TestClient, **extra: object) -> httpx.Response:
    version = str(c.get(AI_SETTINGS).json()["version"])
    return c.put(AI_SETTINGS, json={"customInstructions": "", **extra},  # type: ignore[return-value]
                 headers={"If-Match": version})  # fmt: skip


def test_ai_switch(owner_client: TestClient) -> None:
    c = owner_client
    r = c.get(AI_SETTINGS)
    check(r.json(), "AiSettings", spec="014")
    assert r.json()["useProxy"] is False
    assert_problem(_ai_put(c, useProxy=True), 409, "proxy_not_configured")
    c.put(URL, json=body())
    r = _ai_put(c, useProxy=True)
    assert r.status_code == 200, r.text
    check(r.json(), "AiSettings", spec="014")
    assert r.json()["useProxy"] is True
    assert _ai_put(c).json()["useProxy"] is True  # absent: kept
    c.put(TRANSCRIPTION, json=vs("http://fake", True))
    assert c.get(URL).json()["usedBy"] == ["transcription", "ai"]
    r = c.delete(URL, headers={"If-Match": _version(c)})
    assert r.json() == {"disabledSections": ["transcription", "ai"]}
    assert c.get(AI_SETTINGS).json()["useProxy"] is False


def test_ai_test_and_discovery_through_proxy(
    app,
    owner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,  # type: ignore[no-untyped-def]
) -> None:
    from tests.contract.ai_helpers import BASES, REMOTE_BASES

    c = owner_client
    c.put(URL, json=body(scheme="socks5", port=1080))
    _ai_put(c, useProxy=True)
    seen = _spy_clients(monkeypatch)

    # local endpoint: direct (FR-011a)
    r = c.post(f"{API}/ai/endpoints/test", json={"style": "openai", "baseUrl": BASES["openai"]})
    assert r.json()["outcome"] == "working" and seen == [None]

    # remote endpoint: through the proxy, both test and discovery
    r = c.post(f"{API}/ai/endpoints/test",
               json={"style": "openai", "baseUrl": REMOTE_BASES["openai"]})  # fmt: skip
    assert r.json()["outcome"] == "working"
    r = c.post(f"{API}/ai/endpoints/models/discover",
               json={"style": "openai", "baseUrl": REMOTE_BASES["openai"]})  # fmt: skip
    assert r.json()["outcome"] == "working"
    assert seen[1:] == ["socks5://proxy.example.com:1080"] * 2

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ProxyError("407 Proxy Authentication Required")

    app.state.ai_transport = httpx.MockTransport(refuse)
    r = c.post(f"{API}/ai/endpoints/test",
               json={"style": "openai", "baseUrl": REMOTE_BASES["openai"]})  # fmt: skip
    check(r.json(), "AiTestResult", spec="014")
    assert r.json()["outcome"] == "proxy" and "proxy" in r.json()["message"].lower()
    r = c.post(f"{API}/ai/endpoints/models/discover",
               json={"style": "openai", "baseUrl": REMOTE_BASES["openai"]})  # fmt: skip
    check(r.json(), "AiDiscoverResult", spec="014")
    assert r.json()["outcome"] == "proxy"


def test_chat_through_proxy_and_dead_proxy(
    app,
    owner_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,  # type: ignore[no-untyped-def]
) -> None:
    from tests.contract.chat_helpers import (
        ack,
        create_endpoint,
        events,
        make_session,
        model_ref,
        start_chat,
        wait_idle,
    )  # fmt: skip

    c = owner_client
    c.put(URL, json=body())
    _ai_put(c, useProxy=True)
    remote = create_endpoint(c, "openai", remote=True)
    local = create_endpoint(c, "openai", name="local")
    ack(c, remote)
    seen = _spy_clients(monkeypatch)
    key = make_session(c)

    sent = start_chat(c, key, model_ref(remote))
    assert events(c, sent["runId"])[-1][1] == "done"
    sent = start_chat(c, key, model_ref(local))
    assert events(c, sent["runId"])[-1][1] == "done"
    assert seen == ["http://proxy.example.com:8080", None]
    wait_idle(c)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    app.state.ai_transport = httpx.MockTransport(refuse)
    sent = start_chat(c, key, model_ref(remote), "keep this text")
    last = events(c, sent["runId"])[-1]
    assert last[1] == "failed" and last[2]["error"]["category"] == "proxy"
    assert last[2]["error"]["message"].startswith("Couldn't reach the proxy")
    wait_idle(c)
    chat = c.get(f"{API}/chats/{sent['chat']['id']}").json()
    check(chat, "Chat", spec="014")
    version = chat["turns"][0]["versions"][0]
    assert version["text"] == "keep this text"  # the message is never lost (FR-012)
    assert version["answers"][0]["error"]["category"] == "proxy"
