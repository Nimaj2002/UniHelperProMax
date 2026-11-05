"""021: requests really go through the proxy, and a dead proxy fails the work naming the proxy —
never retried without it, never losing the recording or the note (FR-010, FR-012)."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract.notes_helpers import create_note
from tests.contract.transcription_helpers import (
    API,
    configure,
    finished_recording,
    job,
    make_session,
    note_content,
    run_jobs,
    transcribe,
)
from tests.fake_proxy import FakeProxy
from unihelper.domain.proxy import proxy_url
from unihelper.services import proxy_service

pytestmark = pytest.mark.integration


@pytest.fixture
def target() -> Iterator[str]:
    class Ok(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(204)
            self.end_headers()

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Ok)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/ping"
    server.shutdown()
    server.server_close()


@pytest.mark.anyio
async def test_client_goes_through_proxy(target: str) -> None:
    proxy = FakeProxy(credentials=("me", "p@ss word"))
    try:
        good = proxy_url("http", "127.0.0.1", proxy.port, "me", "p@ss word")
        async with proxy_service.client(good, None) as http:
            assert (await http.get(target)).status_code == 204
        assert proxy.requests == [target]

        bad = proxy_url("http", "127.0.0.1", proxy.port, "me", "wrong")
        async with proxy_service.client(bad, None) as http:
            assert (await http.get(target)).status_code == 407
        assert proxy.requests == [target]  # nothing relayed
    finally:
        proxy.close()

    # proxy gone: the request fails at the proxy and is not sent direct
    async with proxy_service.client(good, None) as http:
        with pytest.raises(httpx.ConnectError):
            await http.get(target)


def test_dead_proxy_fails_job_naming_proxy(
    app: FastAPI, owner_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    configure(app, address="https://stt.example.com")  # remote: the proxy applies
    c.put(f"{API}/settings/proxy", json={"scheme": "http", "host": "127.0.0.1", "port": 9})
    r = c.put(
        f"{API}/settings/transcription",
        json={
            "activeProviderId": "voice-studio",
            "defaultLanguage": "auto",
            "provider": {"providerId": "voice-studio",
                         "values": {"address": "https://stt.example.com"}},
            "useProxy": True,
        },
    )  # fmt: skip
    assert r.status_code == 200, r.text
    seen: list[str | None] = []
    real = proxy_service.client

    def spy(proxy: str | None, transport: Any) -> httpx.AsyncClient:
        seen.append(proxy)
        return real(proxy, transport)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")  # what httpx raises when the proxy port is closed

    monkeypatch.setattr(proxy_service, "client", spy)
    monkeypatch.setattr(app.state.transcription_worker, "transport", httpx.MockTransport(refused))

    key = make_session(c)
    note = create_note(c, key, "Lecture notes", "keep me")
    rec = finished_recording(c, key)
    started = transcribe(c, rec["id"], noteId=note["id"]).json()
    run_jobs(c)

    failed = job(c, started["id"])
    assert failed["status"] == "failed" and failed["errorCategory"] == "unavailable"
    assert failed["errorMessage"].startswith("Couldn't reach the proxy")
    assert failed["settingsRelated"] is True
    assert seen and all(p == "http://127.0.0.1:9" for p in seen)  # never direct
    assert note_content(c, note["id"]) == "keep me"
    assert c.get(f"{API}/recordings/{rec['id']}").status_code == 200
