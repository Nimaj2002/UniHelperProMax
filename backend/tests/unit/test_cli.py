from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from unihelper.cli import reset_owner_password
from unihelper.config import Settings
from unihelper.main import create_app

pytestmark = pytest.mark.unit


def test_reset_owner_password(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = tmp_path / "data"
    with TestClient(create_app(Settings(data_dir=data))) as c:
        c.post("/api/v1/setup/owner", json={"username": "owner", "password": "old-password-1"})
    monkeypatch.setenv("UNIHELPER_DATA_DIR", str(data))
    assert reset_owner_password("short") == 1
    assert reset_owner_password("brand-new-pass-1") == 0
    with TestClient(create_app(Settings(data_dir=data))) as c:
        r = c.post("/api/v1/auth/login", json={"username": "owner", "password": "brand-new-pass-1"})
        assert r.status_code == 200 and r.json()["mustChangePassword"] is True
