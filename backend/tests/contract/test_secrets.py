"""014 T018: GET /secrets/status and POST /secrets/reset."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_status_with_a_key_file(owner_client: TestClient) -> None:
    r = owner_client.get(f"{API}/secrets/status")
    assert r.status_code == 200
    body = r.json()
    check(body, "SecretStoreStatus", spec="014")
    assert body["store"] == "key_file" and body["readable"] is True
    assert "Anyone who can sign in to this computer" in body["protectionNote"]
    assert body["migration"] in ("not_needed", "done")


def test_status_with_the_os_key_store(app, owner_client: TestClient) -> None:  # type: ignore[no-untyped-def]
    app.state.secrets.kind = "os_key_store"
    body = owner_client.get(f"{API}/secrets/status").json()
    check(body, "SecretStoreStatus", spec="014")
    assert body["store"] == "os_key_store" and body["protectionNote"] is None


def test_reset(app, owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:  # type: ignore[no-untyped-def]
    c = owner_client
    assert_problem(c.post(f"{API}/secrets/reset", json={"confirm": True}), 409, "store_readable")
    assert c.post(f"{API}/secrets/reset", json={"confirm": False}).status_code == 422
    member = make_member()
    assert_problem(member.post(f"{API}/secrets/reset", json={"confirm": True}), 403, "forbidden")

    app.state.secrets._aead = None  # as if the master key were lost
    r = c.post(f"{API}/secrets/reset", json={"confirm": True})
    assert r.status_code == 200, r.text
    check(r.json(), "SecretStoreStatus", spec="014")
    assert r.json()["readable"] is True
