"""015 T011: /desktop/identity, /desktop/shutdown, /desktop/busy and /health (contracts §5–§6)."""

from __future__ import annotations

import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

from tests.conftest import LAUNCH_TOKEN, assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_identity_proves_the_launch_token(desktop_client: TestClient) -> None:
    nonce = "0f" * 32
    r = desktop_client.get(f"{API}/desktop/identity", params={"nonce": nonce})
    assert r.status_code == 200, r.text
    check(r.json(), "DesktopIdentity", spec="015")
    expected = hmac.new(
        bytes.fromhex(LAUNCH_TOKEN), bytes.fromhex(nonce), hashlib.sha256
    ).hexdigest()
    assert r.json()["proof"] == expected
    assert r.json()["port"] == 47813


@pytest.mark.parametrize("nonce", ["", "xyz", "ab" * 8])
def test_identity_bad_nonce(desktop_client: TestClient, nonce: str) -> None:
    assert_problem(
        desktop_client.get(f"{API}/desktop/identity", params={"nonce": nonce}), 400, "bad_nonce"
    )


def test_shutdown_needs_the_launch_token(
    desktop_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unihelper.desktop import lifecycle

    calls: list[bool] = []
    monkeypatch.setattr(lifecycle, "request_shutdown", lambda: calls.append(True))
    assert_problem(desktop_client.post(f"{API}/desktop/shutdown"), 401, "bad_token")
    r = desktop_client.post(
        f"{API}/desktop/shutdown", headers={"authorization": "Bearer " + "c" * 64}
    )
    assert_problem(r, 401, "bad_token")
    assert calls == []
    r = desktop_client.post(
        f"{API}/desktop/shutdown", headers={"authorization": f"Bearer {LAUNCH_TOKEN}"}
    )
    assert r.status_code == 202 and r.json() == {"status": "stopping"}
    assert calls == [True]


def test_busy_is_idle_then_reports_a_recording(desktop_client: TestClient) -> None:
    r = desktop_client.get(f"{API}/desktop/busy")
    assert r.status_code == 200
    check(r.json(), "DesktopBusy", spec="015")
    assert r.json() == {"recording": False, "transcribing": False, "chatRunning": False}


def test_busy_reports_an_active_recording(desktop_client: TestClient) -> None:
    from tests.contract.recording_helpers import make_session, start

    start(desktop_client, make_session(desktop_client))
    assert desktop_client.get(f"{API}/desktop/busy").json()["recording"] is True


def test_desktop_routes_are_absent_in_web_mode(owner_client: TestClient) -> None:
    c = owner_client  # signed in with the CSRF header, so only the desktop check can refuse
    assert_problem(
        c.get(f"{API}/desktop/identity", params={"nonce": "ab" * 16}), 404, "not_desktop"
    )
    assert_problem(c.post(f"{API}/desktop/shutdown"), 404, "not_desktop")
    assert_problem(c.get(f"{API}/desktop/busy"), 404, "not_desktop")


def test_health_reports_version_and_mode(desktop_client: TestClient, client: TestClient) -> None:
    d = desktop_client.get(f"{API}/health").json()
    w = client.get(f"{API}/health").json()
    assert d["mode"] == "desktop" and w["mode"] == "web"
    assert d["status"] == w["status"] == "ok" and d["version"] and w["version"]
