"""014 T030: every /ai/* operation — styles, base URL check, endpoints with keys and models,
Test connection and Refresh (which never write), the privacy acknowledgement, AI settings."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import assert_problem
from tests.contract.ai_helpers import API, BASES, create_endpoint, model
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
KEY = "sk-contract-key-0123456789wxyz"


def test_styles(owner_client: TestClient) -> None:
    r = owner_client.get(f"{API}/ai/styles")
    assert r.status_code == 200
    styles = r.json()
    for s in styles:
        check(s, "AiStyle", spec="014")
    by_id = {s["id"]: s for s in styles}
    assert by_id["openai"]["defaultCapabilities"] == {"images": True, "pdf": False, "audio": False}
    assert by_id["anthropic"]["defaultCapabilities"] == {
        "images": True,
        "pdf": True,
        "audio": False,
    }
    assert by_id["gemini"]["defaultCapabilities"] == {"images": True, "pdf": True, "audio": True}
    assert by_id["openai"]["limits"]["maxAttachments"] == 10


def test_base_url_check(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(
        f"{API}/ai/base-url/check",
        json={"style": "openai", "baseUrl": "http://localhost:11434/v1/chat/completions/"},
    )
    assert r.status_code == 200
    check(r.json(), "BaseUrlResult", spec="014")
    assert r.json() == {
        "baseUrl": "http://localhost:11434/v1",
        "removedPath": "/chat/completions",
        "locality": "local",
    }
    assert_problem(
        c.post(f"{API}/ai/base-url/check", json={"style": "openai", "baseUrl": "nope"}),
        422,
        "invalid_url",
    )
    assert_problem(
        c.post(
            f"{API}/ai/base-url/check", json={"style": "anthropic", "baseUrl": "http://example.com"}
        ),
        422,
        "https_required",
    )


def test_endpoint_lifecycle(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    assert c.get(f"{API}/ai/endpoints").json() == []  # nothing ships with the app (FR-012)
    created = create_endpoint(
        c, "anthropic", name="Claude", remote=True, api_key=KEY, models=["echo"]
    )
    check(created, "AiEndpoint", spec="014")
    assert KEY not in str(created)
    assert created["key"] == {"configured": True, "masked": "••••wxyz", "readable": True}
    assert created["locality"] == "remote" and created["privacyAcknowledged"] is False
    assert created["models"][0]["capabilities"]["audio"] is False  # Anthropic takes no audio

    assert_problem(
        c.post(
            f"{API}/ai/endpoints",
            json={"name": "claude", "style": "openai", "baseUrl": BASES["openai"]},
        ),
        409,
        "name_taken",
    )
    assert (
        c.post(
            f"{API}/ai/endpoints", json={"name": "", "style": "openai", "baseUrl": BASES["openai"]}
        ).status_code
        == 422
    )
    assert_problem(
        c.post(
            f"{API}/ai/endpoints",
            json={"name": "Remote http", "style": "openai", "baseUrl": "http://example.com/v1"},
        ),
        422,
        "https_required",
    )

    eid, version = created["id"], created["version"]
    url = f"{API}/ai/endpoints/{eid}"
    got = c.get(url)
    assert got.status_code == 200 and KEY not in got.text
    assert c.patch(url, json={"enabled": False}).status_code == 428
    assert_problem(
        c.patch(url, json={"enabled": False}, headers={"If-Match": "99"}), 412, "version_conflict"
    )
    # absent key = keep
    r = c.patch(url, json={"enabled": False}, headers={"If-Match": str(version)})
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] is False and r.json()["key"]["configured"] is True
    # string = replace
    r = c.patch(
        url, json={"apiKey": "sk-new-key-99998888"}, headers={"If-Match": str(r.json()["version"])}
    )
    assert r.json()["key"]["masked"] == "••••8888"
    # replace models
    r = c.patch(
        url,
        json={"models": [model("echo"), model("slow", hidden=True)]},
        headers={"If-Match": str(r.json()["version"])},
    )
    assert [(m["modelId"], m["hidden"]) for m in r.json()["models"]] == [
        ("echo", False),
        ("slow", True),
    ]
    # null = remove
    r = c.patch(url, json={"apiKey": None}, headers={"If-Match": str(r.json()["version"])})
    assert r.json()["key"] == {"configured": False, "masked": None, "readable": True}

    ack = c.post(f"{url}/privacy-ack")
    assert ack.status_code == 200 and ack.json()["privacyAcknowledged"] is True

    member = make_member()
    assert_problem(member.get(url), 404, "not_found")
    assert member.get(f"{API}/ai/endpoints").json() == []

    assert c.delete(url).status_code == 428
    r = c.delete(url, headers={"If-Match": str(ack.json()["version"])})
    assert r.status_code == 204
    assert c.get(f"{API}/ai/endpoints").json() == []


def _db_snapshot(app) -> str:  # type: ignore[no-untyped-def]
    from unihelper.models import AiEndpoint, AiModel, Secret

    with app.state.sessionmaker() as db:
        return str(
            [(e.id, e.version, e.base_url) for e in db.query(AiEndpoint)]
            + [(m.id, m.model_id) for m in db.query(AiModel)]
            + [(s.id, s.nonce) for s in db.query(Secret)]
        )


@pytest.mark.parametrize(
    ("setup", "body", "outcome"),
    [
        ({}, {"style": "openai", "baseUrl": BASES["openai"]}, "working"),
        ({}, {"style": "anthropic", "baseUrl": BASES["anthropic"]}, "working"),
        ({}, {"style": "gemini", "baseUrl": BASES["gemini"]}, "working"),
        (
            {"required_key": "right"},
            {"style": "openai", "baseUrl": BASES["openai"], "apiKey": "wrong"},
            "key_rejected",
        ),
        (
            {},
            {"style": "openai", "baseUrl": BASES["openai"], "modelId": "fail-404"},
            "model_not_found",
        ),
        ({}, {"style": "openai", "baseUrl": "http://fake/wrong"}, "not_this_style"),
        ({}, {"style": "openai", "baseUrl": "http://example.com/v1"}, "https_required"),
        (
            {"no_model_list": True},
            {"style": "openai", "baseUrl": BASES["openai"], "modelId": "echo"},
            "working",
        ),
    ],
)
def test_test_connection_outcomes(app, owner_client: TestClient, setup, body, outcome) -> None:  # type: ignore[no-untyped-def]
    fake_llm.STATE.update(setup)
    before = _db_snapshot(app)
    r = owner_client.post(f"{API}/ai/endpoints/test", json=body)
    assert r.status_code == 200, r.text
    check(r.json(), "AiTestResult", spec="014")
    assert r.json()["outcome"] == outcome, r.json()
    assert _db_snapshot(app) == before  # never changes saved data
    if outcome == "not_this_style":
        assert r.json()["looksLike"] == "gemini"


def test_unreachable_local_server_gets_the_hint(app, owner_client: TestClient) -> None:  # type: ignore[no-untyped-def]
    import httpx

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    app.state.ai_transport = httpx.MockTransport(refuse)
    r = owner_client.post(
        f"{API}/ai/endpoints/test", json={"style": "openai", "baseUrl": "http://localhost:11434/v1"}
    )
    assert r.json()["outcome"] == "unreachable" and "“localhost”" in r.json()["hint"]


def test_test_with_saved_key(owner_client: TestClient) -> None:
    fake_llm.STATE["required_key"] = KEY
    ep = create_endpoint(owner_client, "gemini", api_key=KEY)
    r = owner_client.post(
        f"{API}/ai/endpoints/test",
        json={"style": "gemini", "baseUrl": BASES["gemini"], "useSavedKeyOf": ep["id"]},
    )
    assert r.json()["outcome"] == "working" and KEY not in r.text


def test_discover(app, owner_client: TestClient) -> None:  # type: ignore[no-untyped-def]
    c = owner_client
    ep = create_endpoint(c, "anthropic", models=["echo"])
    before = _db_snapshot(app)
    r = c.post(
        f"{API}/ai/endpoints/models/discover",
        json={"style": "anthropic", "baseUrl": BASES["anthropic"], "useSavedKeyOf": ep["id"]},
    )
    assert r.status_code == 200
    check(r.json(), "AiDiscoverResult", spec="014")
    found = {m["modelId"]: m for m in r.json()["models"]}
    assert set(found) == set(fake_llm.MODELS)
    assert found["echo"]["id"] == ep["models"][0]["id"]  # the saved model keeps its edits
    assert found["slow"]["id"] is None and found["slow"]["contextLimit"] == 200000
    assert found["slow"]["capabilities"] == {"images": True, "pdf": True, "audio": False}
    assert _db_snapshot(app) == before  # Refresh saves nothing
    fake_llm.STATE["no_model_list"] = True
    none = c.post(
        f"{API}/ai/endpoints/models/discover", json={"style": "openai", "baseUrl": BASES["openai"]}
    )
    assert none.json()["outcome"] == "no_model_list" and none.json()["models"] == []


def test_ai_settings(owner_client: TestClient) -> None:
    c = owner_client
    r = c.get(f"{API}/ai/settings")
    assert r.status_code == 200
    check(r.json(), "AiSettings", spec="014")
    assert r.json()["customInstructions"] == "" and r.json()["lastModel"] is None
    assert c.put(f"{API}/ai/settings", json={"customInstructions": "x"}).status_code == 428
    saved = c.put(
        f"{API}/ai/settings",
        json={"customInstructions": "  Answer briefly.  "},
        headers={"If-Match": str(r.json()["version"])},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["customInstructions"] == "Answer briefly."
    assert (
        c.put(
            f"{API}/ai/settings",
            json={"customInstructions": "x" * 8001},
            headers={"If-Match": str(saved.json()["version"])},
        ).status_code
        == 422
    )
