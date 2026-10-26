"""015 T010: single-user mode replaces login in the desktop app (research R9, FR-033)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import OWNER, assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_owner_is_created_from_the_login_name(desktop_client: TestClient, desktop_app) -> None:  # type: ignore[no-untyped-def]
    me = desktop_client.get(f"{API}/auth/me")
    assert me.status_code == 200, me.text
    check(me.json(), "Me")
    assert me.json()["username"] == "test-student"
    assert me.json()["role"] == "owner" and me.json()["mustChangePassword"] is False
    files_root = desktop_app.state.settings.files_root
    assert (files_root / "test-student").is_dir()


def test_setup_status_reports_desktop_mode(desktop_client: TestClient) -> None:
    assert desktop_client.get(f"{API}/setup/status").json() == {
        "needsOwner": False,
        "mode": "desktop",
    }


def test_mutations_need_no_csrf_or_cookie(desktop_client: TestClient) -> None:
    assert not desktop_client.cookies
    r = desktop_client.patch(f"{API}/auth/profile", json={"timezone": "Europe/Istanbul"})
    assert r.status_code == 200, r.text
    assert r.json()["timezone"] == "Europe/Istanbul"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/setup/owner", OWNER),
        ("POST", "/auth/login", {"username": "x", "password": "y"}),
        ("POST", "/auth/logout", None),
        ("POST", "/auth/password", {"currentPassword": "a", "newPassword": "b" * 12}),
        ("GET", "/admin/users", None),
        ("POST", "/admin/users", {"username": "member", "password": "member-password-1"}),
    ],
)
def test_account_routes_do_not_exist(
    desktop_client: TestClient, method: str, path: str, body: object
) -> None:
    r = desktop_client.request(method, f"{API}{path}", json=body)
    assert_problem(r, 404, "not_in_desktop")


def test_web_mode_reports_web(client: TestClient) -> None:
    assert client.get(f"{API}/setup/status").json()["mode"] == "web"
    assert_problem(client.get(f"{API}/auth/me"), 401, "unauthorized")


@pytest.mark.parametrize(
    ("login", "expected"),
    [
        ("Test Student", "test-student"),
        ("Nima Jelodarí", "nima-jelodari"),
        ("José.María_02", "jose.maria_02"),
        ("李", "student"),
        ("ab", "student"),
        (None, "student"),
        ("x" * 50, "x" * 32),
    ],
)
def test_desktop_username(login: str | None, expected: str) -> None:
    from unihelper.desktop.owner import desktop_username

    assert desktop_username(login) == expected
