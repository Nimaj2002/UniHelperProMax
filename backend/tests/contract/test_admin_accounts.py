from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"
MEMBER = {"username": "ali", "password": "initial-pass-1", "timezone": "Europe/Istanbul"}


def test_list_and_create_members(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(f"{API}/admin/users", json=MEMBER)
    assert r.status_code == 201, r.text
    check(r.json(), "Account")
    assert r.json()["role"] == "member" and r.json()["mustChangePassword"] is True
    lst = c.get(f"{API}/admin/users")
    assert lst.status_code == 200
    check(lst.json(), "Account", many=True)
    assert [a["username"] for a in lst.json()] == ["owner", "ali"]
    # account fields only — never schedule data (FR-003c)
    assert set(lst.json()[0]) <= {
        "id",
        "username",
        "role",
        "disabled",
        "mustChangePassword",
        "createdAt",
    }
    assert_problem(c.post(f"{API}/admin/users", json=MEMBER), 409, "name_taken")
    assert_problem(
        c.post(f"{API}/admin/users", json={**MEMBER, "username": "X y"}), 422, "validation_failed"
    )
    assert_problem(
        c.post(f"{API}/admin/users", json={**MEMBER, "username": "bob", "password": "short"}),
        422,
        "validation_failed",
    )


def test_member_cannot_use_admin(make_member: Callable[..., TestClient]) -> None:
    m = make_member()
    assert_problem(m.get(f"{API}/admin/users"), 403, "forbidden")
    assert_problem(m.post(f"{API}/admin/users", json=MEMBER), 403, "forbidden")


def test_disable_enable(owner_client: TestClient, app: object) -> None:
    c = owner_client
    member = c.post(f"{API}/admin/users", json=MEMBER).json()
    r = c.patch(f"{API}/admin/users/{member['id']}", json={"disabled": True})
    assert r.status_code == 200
    check(r.json(), "Account")
    assert r.json()["disabled"] is True
    other = TestClient(app)  # type: ignore[arg-type]
    login = other.post(
        f"{API}/auth/login", json={"username": "ali", "password": MEMBER["password"]}
    )
    assert_problem(login, 401, "invalid_credentials")
    assert (
        c.patch(f"{API}/admin/users/{member['id']}", json={"disabled": False}).json()["disabled"]
        is False
    )
    me = c.get(f"{API}/auth/me").json()
    assert_problem(
        c.patch(f"{API}/admin/users/{me['id']}", json={"disabled": True}),
        422,
        "cannot_modify_owner",
    )
    assert_problem(c.patch(f"{API}/admin/users/nope", json={"disabled": True}), 404, "not_found")


def test_delete_member_keeps_folder(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    member = c.post(f"{API}/admin/users", json=MEMBER).json()
    folder = tmp_data_dir / "files" / "ali"
    (folder / "keep.md").write_text("notes")
    r = c.delete(f"{API}/admin/users/{member['id']}")
    assert r.status_code == 200
    assert r.json() == {"keptFolder": "ali"}
    assert (folder / "keep.md").exists()
    assert [a["username"] for a in c.get(f"{API}/admin/users").json()] == ["owner"]
    me = c.get(f"{API}/auth/me").json()
    assert_problem(c.delete(f"{API}/admin/users/{me['id']}"), 422, "cannot_modify_owner")
    assert_problem(c.delete(f"{API}/admin/users/{member['id']}"), 404, "not_found")


def test_password_reset_revokes_sessions(owner_client: TestClient, app: object) -> None:
    c = owner_client
    member = c.post(f"{API}/admin/users", json=MEMBER).json()
    m = TestClient(app)  # type: ignore[arg-type]
    assert (
        m.post(
            f"{API}/auth/login", json={"username": "ali", "password": MEMBER["password"]}
        ).status_code
        == 200
    )
    r = c.post(
        f"{API}/admin/users/{member['id']}/password-reset", json={"newPassword": "reset-pass-12"}
    )
    assert r.status_code == 204
    assert_problem(m.get(f"{API}/auth/me"), 401, "unauthorized")
    again = m.post(f"{API}/auth/login", json={"username": "ali", "password": "reset-pass-12"})
    assert again.status_code == 200 and again.json()["mustChangePassword"] is True
    assert_problem(
        c.post(f"{API}/admin/users/nope/password-reset", json={"newPassword": "reset-pass-12"}),
        404,
        "not_found",
    )
