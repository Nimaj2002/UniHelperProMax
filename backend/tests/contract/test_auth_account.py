from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import OWNER, assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_change_password(owner_client: TestClient, app: object) -> None:
    c = owner_client
    other = TestClient(app)  # type: ignore[arg-type]
    assert (
        other.post(
            f"{API}/auth/login", json={"username": "owner", "password": OWNER["password"]}
        ).status_code
        == 200
    )
    assert_problem(
        c.post(
            f"{API}/auth/password",
            json={"currentPassword": "wrong-pass-1", "newPassword": "new-password-1"},
        ),
        401,
        "invalid_credentials",
    )
    assert_problem(
        c.post(
            f"{API}/auth/password",
            json={"currentPassword": OWNER["password"], "newPassword": "short"},
        ),
        422,
        "validation_failed",
    )
    r = c.post(
        f"{API}/auth/password",
        json={"currentPassword": OWNER["password"], "newPassword": "new-password-1"},
    )
    assert r.status_code == 204
    assert c.get(f"{API}/auth/me").status_code == 200  # this session survives
    assert_problem(other.get(f"{API}/auth/me"), 401, "unauthorized")  # others revoked
    assert c.post(f"{API}/auth/logout").status_code == 204
    assert (
        c.post(
            f"{API}/auth/login", json={"username": "owner", "password": "new-password-1"}
        ).status_code
        == 200
    )


def test_password_equal_to_username_rejected(make_member: Callable[..., TestClient]) -> None:
    m = make_member(username="longmember1", password="member-password-1")
    r = m.post(
        f"{API}/auth/password",
        json={"currentPassword": "member-password-1", "newPassword": "longmember1"},
    )
    assert_problem(r, 422, "weak_password")


def test_profile_timezone(owner_client: TestClient) -> None:
    c = owner_client
    r = c.patch(f"{API}/auth/profile", json={"timezone": "Europe/Berlin"})
    assert r.status_code == 200
    check(r.json(), "Me")
    assert r.json()["timezone"] == "Europe/Berlin"
    assert_problem(
        c.patch(f"{API}/auth/profile", json={"timezone": "Mars/Olympus"}), 422, "invalid_timezone"
    )


def test_must_change_password_gate(make_member: Callable[..., TestClient]) -> None:
    m = make_member(must_change_password=True)
    assert m.get(f"{API}/auth/me").status_code == 200
    assert_problem(m.get(f"{API}/course-tree"), 403, "password_change_required")
    assert_problem(
        m.get(f"{API}/sessions", params={"from": "2026-01-01", "to": "2026-01-02"}),
        403,
        "password_change_required",
    )
    r = m.post(
        f"{API}/auth/password",
        json={"currentPassword": "member-password-1", "newPassword": "brand-new-pass-1"},
    )
    assert r.status_code == 204
    assert m.get(f"{API}/course-tree").status_code == 200
    assert m.get(f"{API}/auth/me").json()["mustChangePassword"] is False


def test_login_throttled(owner_client: TestClient, app: object) -> None:
    c = TestClient(app)  # type: ignore[arg-type]
    bad = {"username": "owner", "password": "wrong-password-1"}
    for _ in range(5):
        assert_problem(c.post(f"{API}/auth/login", json=bad), 401, "invalid_credentials")
    r = c.post(f"{API}/auth/login", json=bad)
    assert_problem(r, 429, "too_many_attempts")
    assert int(r.headers["Retry-After"]) >= 1
    # even the right password is refused while locked
    ok = c.post(f"{API}/auth/login", json={"username": "owner", "password": OWNER["password"]})
    assert_problem(ok, 429, "too_many_attempts")
