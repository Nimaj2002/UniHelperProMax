from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import OWNER, assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_health(client: TestClient) -> None:
    r = client.get(f"{API}/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_setup_status_and_owner_creation(client: TestClient) -> None:
    assert client.get(f"{API}/setup/status").json() == {"needsOwner": True}
    r = client.post(f"{API}/setup/owner", json=OWNER)
    assert r.status_code == 201, r.text
    check(r.json(), "Me")
    assert r.json()["role"] == "owner"
    assert r.json()["mustChangePassword"] is False
    assert "uh_session" in r.cookies and "uh_csrf" in r.cookies
    assert "httponly" in r.headers.get_list("set-cookie")[0].lower()
    assert client.get(f"{API}/setup/status").json() == {"needsOwner": False}
    assert_problem(client.post(f"{API}/setup/owner", json=OWNER), 409, "owner_exists")


@pytest.mark.parametrize(
    "body",
    [
        {"username": "ab", "password": "long-enough-1"},
        {"username": "Bad Name", "password": "long-enough-1"},
        {"username": "valid", "password": "short"},
    ],
)
def test_setup_owner_validation(client: TestClient, body: dict[str, str]) -> None:
    assert_problem(client.post(f"{API}/setup/owner", json=body), 422, "validation_failed")


def test_setup_owner_password_equal_username(client: TestClient) -> None:
    body = {"username": "longusername1", "password": "longusername1"}
    assert_problem(client.post(f"{API}/setup/owner", json=body), 422, "weak_password")


def test_login_logout_me(owner_client: TestClient) -> None:
    c = owner_client
    me = c.get(f"{API}/auth/me")
    assert me.status_code == 200
    check(me.json(), "Me")
    r = c.post(f"{API}/auth/logout")
    assert r.status_code == 204
    assert_problem(c.get(f"{API}/auth/me"), 401, "unauthorized")
    r = c.post(f"{API}/auth/login", json={"username": "owner", "password": OWNER["password"]})
    assert r.status_code == 200
    check(r.json(), "Me")
    assert c.get(f"{API}/auth/me").status_code == 200


def test_login_errors_are_generic(owner_client: TestClient) -> None:
    c = owner_client
    unknown = c.post(f"{API}/auth/login", json={"username": "nobody", "password": "whatever-1"})
    wrong = c.post(f"{API}/auth/login", json={"username": "owner", "password": "wrong-pass-1"})
    assert_problem(unknown, 401, "invalid_credentials")
    assert_problem(wrong, 401, "invalid_credentials")
    assert unknown.json() == wrong.json()


def test_mutation_without_csrf_rejected(owner_client: TestClient) -> None:
    c = owner_client
    del c.headers["X-CSRF-Token"]
    assert_problem(c.post(f"{API}/auth/logout"), 403, "csrf_failed")
    c.headers["X-CSRF-Token"] = "wrong"
    assert_problem(c.post(f"{API}/auth/logout"), 403, "csrf_failed")
