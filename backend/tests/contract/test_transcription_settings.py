from __future__ import annotations

import logging
from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import fake_transcriber
from tests.conftest import assert_problem
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.contract.transcription_helpers import (
    API,
    finished_recording,
    make_session,
    run_jobs,
    transcribe,
)

pytestmark = pytest.mark.contract
URL = f"{API}/settings/transcription"
KEY = "sk-live-0123456789abcd"


def vs(address: str = "http://fake", language: str = "auto") -> dict:  # type: ignore[type-arg]
    return {
        "activeProviderId": "voice-studio",
        "defaultLanguage": language,
        "provider": {"providerId": "voice-studio", "values": {"address": address}},
    }


def oa(address: str = "https://fake", model: str = "whisper-1", **key: object) -> dict:  # type: ignore[type-arg]
    provider: dict = {
        "providerId": "openai-compatible",
        "values": {"address": address, "model": model},
    }  # type: ignore[type-arg]
    provider.update(key)
    return {
        "activeProviderId": "openai-compatible",
        "defaultLanguage": "auto",
        "provider": provider,
    }


def by_id(body: dict, pid: str) -> dict:  # type: ignore[type-arg]
    return next(p for p in body["providers"] if p["providerId"] == pid)


def test_defaults_and_voice_studio(owner_client: TestClient) -> None:
    c = owner_client
    body = c.get(URL).json()
    check(body, "TranscriptionSettings", spec="005")
    assert body["activeProviderId"] is None and body["defaultLanguage"] == "auto"
    assert {p["status"] for p in body["providers"]} == {"not_configured"}

    r = c.put(URL, json=vs(language="tr"))
    assert r.status_code == 200, r.text
    saved = r.json()
    check(saved, "TranscriptionSettings", spec="005")
    assert saved["activeProviderId"] == "voice-studio" and saved["defaultLanguage"] == "tr"
    assert by_id(saved, "voice-studio") | {"testedAt": None} == {
        "providerId": "voice-studio",
        "values": {"address": "http://fake"},
        "secret": {"configured": False, "last4": None, "readable": True},  # 014: + readable
        "status": "not_tested",
        "lastError": None,
        "testedAt": None,
    }
    status = c.get(f"{API}/transcription/status").json()  # 004 now sees a configured provider
    assert status["configured"] is True and status["defaultLanguage"] == "tr"
    # http:// to a public host is fine without a key
    assert c.put(URL, json=vs("http://studio.example.com:7000/")).status_code == 200


@pytest.mark.parametrize("address", ["", "localhost:8000", "ftp://h", "http://", "not a url"])
def test_invalid_address(owner_client: TestClient, address: str) -> None:
    r = owner_client.put(URL, json=vs(address))
    body = assert_problem(r, 422, "field_required" if not address else "invalid_address")
    assert body["errors"][0]["field"] == "/provider/values/address"
    if address:
        assert_problem(
            owner_client.post(
                f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": address}}
            ),
            422,
            "invalid_address",
        )


def test_other_validation(owner_client: TestClient) -> None:
    c = owner_client
    assert_problem(c.put(URL, json={**vs(), "activeProviderId": "nope"}), 422, "unknown_provider")
    assert c.put(URL, json=vs(language="english")).status_code == 422
    assert_problem(c.put(URL, json=oa(model="")), 422, "field_required")


def test_connection_test(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    ok = c.post(
        f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": "http://fake"}}
    )
    assert ok.status_code == 200
    check(ok.json(), "ConnectionTestResult", spec="005")
    assert ok.json() == {"ok": True, "category": None, "message": None}
    c.put(URL, json=vs())  # saved values tested → stored as connected
    c.post(f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": "http://fake"}})
    assert by_id(c.get(URL).json(), "voice-studio")["status"] == "connected"

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    worker = app.state.transcription_worker
    fake = worker.transport
    worker.transport = httpx.MockTransport(refuse)
    down = c.post(
        f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": "http://fake"}}
    ).json()
    assert down["ok"] is False and down["category"] == "unreachable"
    local = c.post(
        f"{URL}/test",
        json={"providerId": "voice-studio", "values": {"address": "http://localhost:3900"}},
    ).json()
    assert local["category"] == "unreachable" and "WSL" in local["message"]
    saved = by_id(c.get(URL).json(), "voice-studio")
    assert saved["status"] == "failed" and saved["lastError"] == down["message"]

    worker.transport = httpx.MockTransport(lambda r: httpx.Response(404, text="nope"))
    assert (
        c.post(
            f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": "http://fake"}}
        ).json()["category"]
        == "not_a_transcription_service"
    )
    worker.transport = httpx.MockTransport(lambda r: httpx.Response(200, text="<html>"))
    assert (
        c.post(
            f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": "http://fake"}}
        ).json()["category"]
        == "not_a_transcription_service"
    )
    worker.transport = fake

    # a successful transcription also marks the provider connected
    c.put(URL, json=vs())  # unchanged values keep the stored status → retest state
    c.put(URL, json=vs("http://fake/"))  # changed values → not tested
    assert by_id(c.get(URL).json(), "voice-studio")["status"] == "not_tested"
    key = make_session(c)
    note = create_note(c, key, "N")
    rec = finished_recording(c, key)
    transcribe(c, rec["id"], noteId=note["id"])
    run_jobs(c)
    assert by_id(c.get(URL).json(), "voice-studio")["status"] == "connected"


def test_timeout(app: FastAPI, owner_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from unihelper.services import transcription_settings_service as svc

    monkeypatch.setattr(svc, "TEST_BUDGET", 0.2)

    async def slow(request: httpx.Request) -> httpx.Response:
        import asyncio

        await asyncio.sleep(2)
        return httpx.Response(200, json={"data": []})

    app.state.transcription_worker.transport = httpx.MockTransport(slow)
    r = owner_client.post(
        f"{URL}/test", json={"providerId": "voice-studio", "values": {"address": "http://fake"}}
    )
    assert r.json()["category"] == "timeout"


def test_keys_are_never_returned(
    owner_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    c = owner_client
    fake_transcriber.app.state.required_key = KEY
    r = c.put(URL, json=oa(apiKey=KEY))
    assert r.status_code == 200, r.text
    assert KEY not in r.text
    saved = by_id(r.json(), "openai-compatible")
    assert (
        saved["secret"] == {"configured": True, "last4": "abcd", "readable": True}
        and saved["status"] == "not_tested"
    )
    got = c.get(URL)
    assert KEY not in got.text
    test = c.post(
        f"{URL}/test",
        json={
            "providerId": "openai-compatible",
            "values": {"address": "https://fake", "model": "whisper-1"},
            "useSavedKey": True,
        },
    )
    assert test.json()["ok"] is True and KEY not in test.text
    assert by_id(c.get(URL).json(), "openai-compatible")["status"] == "connected"
    assert KEY not in caplog.text

    # change only the model: the key stays
    r = c.put(URL, json=oa(model="whisper-1"))
    assert by_id(r.json(), "openai-compatible")["secret"]["configured"] is True
    # wrong key / unknown model
    bad = c.post(
        f"{URL}/test",
        json={
            "providerId": "openai-compatible",
            "values": {"address": "https://fake", "model": "whisper-1"},
            "apiKey": "sk-wrong-key-0000",
        },
    )
    assert bad.json()["category"] == "invalid_credentials"
    nomodel = c.post(
        f"{URL}/test",
        json={
            "providerId": "openai-compatible",
            "values": {"address": "https://fake", "model": "nope-9"},
            "useSavedKey": True,
        },
    )
    assert nomodel.json()["category"] == "model_not_found"
    # remove the key → not configured; 004 sees it
    r = c.put(URL, json=oa(apiKey=None))
    removed = by_id(r.json(), "openai-compatible")
    assert (
        removed["secret"] == {"configured": False, "last4": None, "readable": True}
        and removed["status"] == "not_configured"
    )
    assert c.get(f"{API}/transcription/status").json()["configured"] is False
    assert_problem(c.put(URL, json=oa(apiKey="   ")), 422, "field_required")


def test_switching_keeps_each_providers_values(owner_client: TestClient) -> None:
    c = owner_client
    c.put(URL, json=oa(apiKey=KEY, model="whisper-large"))
    c.put(URL, json=vs("http://studio.lan:7000"))
    body = c.get(URL).json()
    assert body["activeProviderId"] == "voice-studio"
    kept = by_id(body, "openai-compatible")
    assert (
        kept["values"] == {"address": "https://fake", "model": "whisper-large"}
        and kept["secret"]["configured"]
    )


@pytest.mark.parametrize(
    ("address", "ok"),
    [
        ("http://localhost:8020", True),
        ("http://192.168.1.5:8000", True),
        ("http://127.0.0.1", True),
        ("http://93.184.216.34", False),
        ("https://93.184.216.34", True),
    ],
)
def test_https_rule_with_key(owner_client: TestClient, address: str, ok: bool) -> None:
    r = owner_client.put(URL, json=oa(address=address, apiKey=KEY))
    if ok:
        assert r.status_code == 200, r.text
    else:
        body = assert_problem(r, 422, "https_required")
        assert body["errors"][0]["field"] == "/provider/values/address"
        t = owner_client.post(
            f"{URL}/test",
            json={
                "providerId": "openai-compatible",
                "values": {"address": address, "model": "m"},
                "apiKey": KEY,
            },
        )
        assert_problem(t, 422, "https_required")


def test_settings_are_per_user(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    owner_client.put(URL, json=oa(apiKey=KEY))
    member = make_member()
    body = member.get(URL).json()
    assert body["activeProviderId"] is None
    assert by_id(body, "openai-compatible")["secret"]["configured"] is False
