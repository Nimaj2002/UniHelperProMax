"""Production mode: one process serves the API and the built SPA (research R14)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from unihelper.config import Settings
from unihelper.main import create_app

pytestmark = pytest.mark.integration


def test_spa_fallback_and_api(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with TestClient(create_app(Settings(data_dir=tmp_path / "data", static_dir=dist))) as c:
        for path in ("/", "/calendar/week/2026-10-05", "/courses/abc"):
            r = c.get(path)
            assert r.status_code == 200 and "id=root" in r.text, path
        assert c.get("/assets/app.js").text == "console.log(1)"
        health = c.get("/api/v1/health")
        assert health.headers["content-type"].startswith("application/json")
        assert health.json()["status"] == "ok"  # 015 adds version and mode (additive)
        assert c.get("/api/v1/nope").status_code == 404
