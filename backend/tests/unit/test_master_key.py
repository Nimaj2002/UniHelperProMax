"""014 T015: the master key lives in the OS key store when one works, otherwise in a user-only
file outside the data folder."""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.backends import fail

from unihelper.config import Settings
from unihelper.secrets import master_key

pytestmark = pytest.mark.unit


class MemoryKeyring(KeyringBackend):
    priority = 10  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self.items: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.items.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.items[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        self.items.pop((service, username), None)


@pytest.fixture
def memory_keyring():  # type: ignore[no-untyped-def]
    previous = keyring.get_keyring()
    backend = MemoryKeyring()
    keyring.set_keyring(backend)
    yield backend
    keyring.set_keyring(previous)


def _settings(tmp_path: Path, mode: str = "auto", key_file: Path | None = None) -> Settings:
    return Settings(data_dir=tmp_path / "data", key_store=mode, key_file=key_file)  # type: ignore[arg-type]


def test_keyring_used_when_usable(tmp_path: Path, memory_keyring: MemoryKeyring) -> None:
    settings = _settings(tmp_path)
    assert master_key.keyring_usable()
    kind = master_key.choose_kind(settings)
    assert kind == "os_key_store"
    created = master_key.create(settings, "inst-1", kind)
    assert (master_key.SERVICE, "master-key:inst-1") in memory_keyring.items
    assert len(memory_keyring.items) == 1  # the usability probe cleaned up after itself
    loaded = master_key.load(settings, "inst-1", kind)
    assert loaded is not None and loaded.key == created.key and len(created.key) == 32


def test_falls_back_to_a_file_without_a_key_store(tmp_path: Path) -> None:
    previous = keyring.get_keyring()
    keyring.set_keyring(fail.Keyring())
    try:
        assert not master_key.keyring_usable()
        assert master_key.choose_kind(_settings(tmp_path)) == "key_file"
    finally:
        keyring.set_keyring(previous)


def test_low_priority_backend_is_not_usable(tmp_path: Path, memory_keyring: MemoryKeyring) -> None:
    memory_keyring.priority = 0  # type: ignore[misc]
    assert not master_key.keyring_usable()


def test_key_file_mode_and_permissions(tmp_path: Path) -> None:
    path = tmp_path / "keys" / "master.key"
    settings = _settings(tmp_path, "file", path)
    assert master_key.choose_kind(settings) == "key_file"
    created = master_key.create(settings, "inst-2", "key_file")
    assert path.exists()
    if sys.platform != "win32":
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    loaded = master_key.load(settings, "inst-2", "key_file")
    assert loaded is not None and loaded.key == created.key
    assert created.key not in repr(created).encode()


def test_default_key_file_is_in_the_user_config_folder() -> None:
    path = master_key.default_key_file("inst-3")
    assert path.name == "master-inst-3.key"
    assert "UniHelperProMax" in str(path)


def test_key_file_inside_the_data_folder_is_refused(tmp_path: Path) -> None:
    settings = _settings(tmp_path, "file", tmp_path / "data" / "master.key")
    with pytest.raises(RuntimeError, match="must not be inside the data folder"):
        settings.check()
    _settings(tmp_path, "file", tmp_path / "elsewhere" / "master.key").check()


def test_corrupt_key_file_reads_as_missing(tmp_path: Path) -> None:
    path = tmp_path / "keys" / "master.key"
    path.parent.mkdir(parents=True)
    path.write_text("not-a-key", encoding="ascii")
    assert master_key.load(_settings(tmp_path, "file", path), "inst-4", "key_file") is None
