"""The backend refuses to run as more than one process per data folder (004-D1: note writes
are serialized by an in-process lock)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from unihelper import single_process
from unihelper.config import Settings
from unihelper.main import create_app


def test_second_holder_is_refused_until_the_first_releases(tmp_path: Path) -> None:
    first = single_process.acquire(tmp_path)
    with pytest.raises(single_process.AnotherServerRunning, match="single process"):
        single_process.acquire(tmp_path)
    first.close()
    single_process.acquire(tmp_path).close()


def test_second_app_on_the_same_data_folder_fails_to_start(tmp_path: Path) -> None:
    data = tmp_path / "data"
    with TestClient(create_app(Settings(data_dir=data))) as c:
        assert c.get("/api/v1/health").status_code == 200
        with (
            pytest.raises(single_process.AnotherServerRunning),
            TestClient(create_app(Settings(data_dir=data))),
        ):
            pass  # pragma: no cover - startup must fail
    # after the first server stopped, the folder can be served again
    with TestClient(create_app(Settings(data_dir=data))) as c:
        assert c.get("/api/v1/health").status_code == 200
