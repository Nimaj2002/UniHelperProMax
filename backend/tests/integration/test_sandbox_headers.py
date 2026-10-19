"""013: the diagram renderer frames get their own CSP; every other page keeps the app's."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from unihelper.config import Settings
from unihelper.main import APP_CSP, SANDBOX_CSP, create_app

pytestmark = pytest.mark.integration


@pytest.fixture
def client(tmp_path: Path):  # type: ignore[no-untyped-def]
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "sandbox").mkdir()
    (dist / "index.html").write_text("<!doctype html><div id=root></div>")
    (dist / "diagram-sandbox.html").write_text("<!doctype html><html data-mode=safe></html>")
    (dist / "diagram-sandbox-allowed.html").write_text(
        "<!doctype html><html data-mode=allowed></html>"
    )
    (dist / "sandbox" / "diagram-renderer.js").write_text("void 0")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with TestClient(create_app(Settings(data_dir=tmp_path / "data", static_dir=dist))) as c:
        yield c


def test_safe_frame_has_no_network_and_may_only_be_framed_by_the_app(client: TestClient) -> None:
    r = client.get("/diagram-sandbox.html")
    assert r.status_code == 200 and "data-mode=safe" in r.text
    csp = r.headers["content-security-policy"]
    assert csp == SANDBOX_CSP["/diagram-sandbox.html"]
    assert "default-src 'none'" in csp and "connect-src" not in csp
    assert "frame-ancestors 'self'" in csp


def test_allowed_frame_policy(client: TestClient) -> None:
    r = client.get("/diagram-sandbox-allowed.html")
    assert r.status_code == 200 and "data-mode=allowed" in r.text
    assert r.headers["content-security-policy"] == (
        "default-src 'none'; script-src 'self' 'unsafe-inline'; "
        "style-src 'unsafe-inline' https:; img-src data: https:; font-src 'self' https:; "
        "connect-src https:; base-uri 'none'; frame-ancestors 'self'"
    )


def test_other_pages_keep_the_app_policy(client: TestClient) -> None:
    for path in ("/", "/courses/abc", "/assets/app.js", "/sandbox/diagram-renderer.js"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.headers["content-security-policy"] == APP_CSP, path
        assert "frame-ancestors 'none'" in APP_CSP
    assert "content-security-policy" not in client.get("/api/v1/health").headers
