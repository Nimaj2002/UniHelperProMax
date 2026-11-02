"""020 T017: a running timer lives on the server; restarting the app (or a second client) sees the
same stored start, and two starts leave exactly one timer (research R1, R2)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import OWNER, _attach_csrf
from unihelper.config import Settings
from unihelper.main import create_app

pytestmark = pytest.mark.integration


def _client(data_dir: Path, key_file: Path) -> TestClient:
    app = create_app(Settings(data_dir=data_dir, transcription_autorun=False, key_store="file",
                              key_file=key_file))  # fmt: skip
    return TestClient(app)


def _login(c: TestClient) -> TestClient:
    r = c.post("/api/v1/auth/login", json={"username": OWNER["username"],
               "password": OWNER["password"]})  # fmt: skip
    assert r.status_code == 200, r.text
    return _attach_csrf(c)


def test_timer_survives_restart(tmp_data_dir: Path, key_file: Path) -> None:
    with _client(tmp_data_dir, key_file) as c:
        assert c.post("/api/v1/setup/owner", json=OWNER).status_code == 201
        c = _attach_csrf(c)
        started = c.post("/api/v1/time/timer/start", json={"style": "track"}).json()["timer"]
    with _client(tmp_data_dir, key_file) as c2:  # the app restarted
        timer = _login(c2).get("/api/v1/time/timer").json()["timer"]
        assert timer["startedAt"] == started["startedAt"]
        # a second window starts another: the first is saved, still only one timer runs
        r = c2.post("/api/v1/time/timer/start", json={"style": "track", "description": "B"})
        assert r.status_code == 201 and r.json()["undo"] is not None
        assert c2.get("/api/v1/time/timer").json()["timer"]["description"] == "B"
