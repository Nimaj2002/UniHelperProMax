"""015: start-up failures map to exit statuses and startup-error.json (contracts §2, FR-005)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from unihelper.config import Settings
from unihelper.desktop import serve
from unihelper.desktop.startup_errors import StartupError, write_startup_error
from unihelper.single_process import AnotherServerRunning

pytestmark = pytest.mark.unit


def _settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "backend", files_dir=tmp_path / "files", desktop=True)


def _read(settings: Settings) -> dict[str, object]:
    return json.loads((settings.data_dir / "startup-error.json").read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_write_is_atomic_and_returns_the_exit_status(tmp_path: Path) -> None:
    code = write_startup_error(tmp_path, StartupError.PORT_IN_USE, "busy", {"port": 1}, "/log")
    body = json.loads((tmp_path / "startup-error.json").read_text(encoding="utf-8"))
    assert code == 10
    assert body["code"] == "port_in_use" and body["exitCode"] == 10
    assert body["details"] == {"port": 1} and body["logFile"] == "/log"
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.parametrize(
    ("exc", "code", "status"),
    [
        (AnotherServerRunning("held"), "another_server", 16),
        (sqlite3.DatabaseError("file is not a database"), "database_damaged", 13),
        (RuntimeError("boom"), "unexpected", 1),
    ],
)
def test_startup_exceptions_are_mapped(
    tmp_path: Path, exc: BaseException, code: str, status: int
) -> None:
    settings = _settings(tmp_path)
    assert serve._map_startup_error(settings, exc) == status
    body = _read(settings)
    assert body["code"] == code and body["exitCode"] == status


def test_missing_files_folder_is_reported(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    assert serve._map_startup_error(settings, FileNotFoundError(settings.files_root)) == 12
    assert _read(settings)["details"] == {"path": str(settings.files_root)}


def test_preflight_reports_a_missing_files_folder_and_a_busy_port(tmp_path: Path) -> None:
    import socket

    settings = _settings(tmp_path)
    assert serve._preflight(settings) == 12
    settings.files_root.mkdir(parents=True)
    with socket.socket() as held:
        held.bind(("127.0.0.1", 0))
        held.listen()
        port = held.getsockname()[1]
        busy = Settings(
            data_dir=settings.data_dir, files_dir=settings.files_root, desktop=True, port=port
        )
        assert serve._preflight(busy) == 10
        assert _read(busy)["details"] == {"port": port}
