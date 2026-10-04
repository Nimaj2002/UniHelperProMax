from __future__ import annotations

import re
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import OWNER, assert_problem
from unihelper.config import Settings
from unihelper.main import create_app

pytestmark = pytest.mark.contract
API = "/api/v1"
EXEMPT = {"/setup/owner", "/auth/login"}


def mutating_operations(app: Any) -> list[tuple[str, str]]:
    ops = []
    for path, item in app.openapi()["paths"].items():
        for method in item:
            if method in ("post", "put", "patch", "delete"):
                bare = path.removeprefix(API)
                if bare not in EXEMPT:
                    ops.append((method.upper(), re.sub(r"\{[^}]+\}", "x", bare)))
    return ops


def test_every_mutation_requires_csrf(owner_client: TestClient, app: Any) -> None:
    c = owner_client
    token = c.headers.pop("X-CSRF-Token")
    ops = mutating_operations(app)
    assert len(ops) >= 15
    for method, path in ops:
        assert_problem(c.request(method, f"{API}{path}", json={}), 403, "csrf_failed")
        r = c.request(method, f"{API}{path}", json={}, headers={"X-CSRF-Token": token + "x"})
        assert_problem(r, 403, "csrf_failed")


def test_cookie_flags(client: TestClient) -> None:
    r = client.post(f"{API}/setup/owner", json=OWNER)
    cookies = {c.split("=", 1)[0]: c.lower() for c in r.headers.get_list("set-cookie")}
    assert "httponly" in cookies["uh_session"] and "samesite=lax" in cookies["uh_session"]
    assert "httponly" not in cookies["uh_csrf"] and "samesite=lax" in cookies["uh_csrf"]
    assert "secure" not in cookies["uh_session"]


def test_secure_cookies_when_enabled(tmp_path: Any) -> None:
    app = create_app(Settings(data_dir=tmp_path / "d", secure_cookies=True))
    with TestClient(app, base_url="https://testserver") as c:
        r = c.post(f"{API}/setup/owner", json=OWNER)
        assert all("secure" in v.lower() for v in r.headers.get_list("set-cookie"))


def test_security_headers(owner_client: TestClient) -> None:
    r = owner_client.get(f"{API}/auth/me")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Referrer-Policy"] == "same-origin"


def test_spa_csp(tmp_path: Any) -> None:
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>x</title>")
    with TestClient(create_app(Settings(data_dir=tmp_path / "d", static_dir=static))) as c:
        r = c.get("/calendar")
        assert "default-src 'self'" in r.headers["Content-Security-Policy"]
        assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
