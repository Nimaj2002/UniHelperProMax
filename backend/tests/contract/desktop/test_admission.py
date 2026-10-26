"""015 T009: request admission in desktop and web mode (research R8, contracts §3)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import CLIENT_SECRET, DESKTOP_HOST, assert_problem
from unihelper.config import Settings
from unihelper.main import create_app

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_foreign_host_is_misdirected(desktop_client: TestClient) -> None:
    r = desktop_client.get(f"{API}/health", headers={"host": "evil.example"})
    assert_problem(r, 421, "misdirected_request")
    r = desktop_client.get(f"{API}/health", headers={"host": "localhost:47813"})
    assert_problem(r, 421, "misdirected_request")


@pytest.mark.parametrize("path", [f"{API}/health", f"{API}/setup/status", "/", "/index.html"])
def test_missing_or_wrong_client_secret_is_refused(desktop_app, path: str) -> None:  # type: ignore[no-untyped-def]
    with TestClient(desktop_app, base_url=f"http://{DESKTOP_HOST}") as c:
        assert_problem(c.get(path), 403, "not_from_app")
        assert_problem(c.get(path, headers={"X-UniHelper-Client": "c" * 64}), 403, "not_from_app")


def test_foreign_origin_is_refused(desktop_client: TestClient) -> None:
    r = desktop_client.get(f"{API}/health", headers={"origin": "http://evil.example"})
    assert_problem(r, 403, "bad_origin")
    ok = desktop_client.get(f"{API}/health", headers={"origin": f"http://{DESKTOP_HOST}"})
    assert ok.status_code == 200


def test_app_requests_are_admitted(desktop_client: TestClient) -> None:
    assert desktop_client.get(f"{API}/health").status_code == 200


def test_identity_needs_no_client_secret(desktop_app) -> None:  # type: ignore[no-untyped-def]
    with TestClient(desktop_app, base_url=f"http://{DESKTOP_HOST}") as c:
        assert c.get(f"{API}/desktop/identity", params={"nonce": "ab" * 16}).status_code == 200
        # …but still only on the app's own host
        r = c.get(
            f"{API}/desktop/identity", params={"nonce": "ab" * 16}, headers={"host": "evil.example"}
        )
        assert_problem(r, 421, "misdirected_request")


def test_web_mode_without_allow_list_has_no_host_check(client: TestClient) -> None:
    assert client.get(f"{API}/health", headers={"host": "anything.example"}).status_code == 200


def test_web_mode_allow_list(tmp_path: Path, key_file: Path) -> None:
    app = create_app(
        Settings(
            data_dir=tmp_path / "data",
            key_store="file",
            key_file=key_file,
            transcription_autorun=False,
            allowed_hosts=("localhost", "notes.example:8443"),
        )
    )
    with TestClient(app, base_url="http://localhost:5173") as c:
        assert c.get(f"{API}/health").status_code == 200
        assert c.get(f"{API}/health", headers={"host": "notes.example:8443"}).status_code == 200
        assert_problem(
            c.get(f"{API}/health", headers={"host": "evil.example"}), 421, "misdirected_request"
        )


def test_client_secret_constant_is_not_the_launch_token() -> None:
    from tests.conftest import LAUNCH_TOKEN

    assert CLIENT_SECRET != LAUNCH_TOKEN
