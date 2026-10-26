"""015 T008: desktop settings (contracts/backend-desktop-mode.md §1)."""

from __future__ import annotations

from pathlib import Path

import pytest

from unihelper.config import DEFAULT_PORT, Settings, load_settings

pytestmark = pytest.mark.unit


def test_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "UNIHELPER_PORT",
        "UNIHELPER_FILES_DIR",
        "UNIHELPER_DESKTOP",
        "UNIHELPER_ALLOWED_HOSTS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("UNIHELPER_DATA_DIR", str(tmp_path / "data"))
    s = load_settings()
    assert s.port == DEFAULT_PORT == 47813
    assert s.files_root == (tmp_path / "data" / "files").resolve()
    assert s.desktop is False and s.allowed_hosts == ()


def test_desktop_forces_the_loopback_host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UNIHELPER_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("UNIHELPER_DESKTOP", "1")
    monkeypatch.setenv("UNIHELPER_HOST", "0.0.0.0")
    monkeypatch.setenv("UNIHELPER_FILES_DIR", str(tmp_path / "Documents" / "UniHelperProMax"))
    s = load_settings()
    assert s.host == "127.0.0.1"
    assert s.files_root == (tmp_path / "Documents" / "UniHelperProMax").resolve()
    assert Settings(data_dir=tmp_path, desktop=True, host="0.0.0.0").host == "127.0.0.1"


def test_allowed_hosts_parsing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("UNIHELPER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("UNIHELPER_ALLOWED_HOSTS", " notes.example , localhost:8000,,")
    assert load_settings().allowed_hosts == ("notes.example", "localhost:8000")


def test_check_refuses_files_in_backups_and_key_in_files(tmp_path: Path) -> None:
    data = tmp_path / "data"
    with pytest.raises(RuntimeError, match="backups"):
        Settings(data_dir=data, files_dir=data / "backups" / "files").check()
    files = tmp_path / "files"
    with pytest.raises(RuntimeError, match="files folder"):
        Settings(data_dir=data, files_dir=files, key_file=files / "k.key").check()
    Settings(data_dir=data, files_dir=files, key_file=tmp_path / "keys" / "k.key").check()
