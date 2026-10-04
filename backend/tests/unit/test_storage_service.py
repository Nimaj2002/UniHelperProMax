from __future__ import annotations

from pathlib import Path

import pytest

from unihelper.storage.storage_service import StoragePathError, StorageService

pytestmark = pytest.mark.unit


def test_ensure_dir_is_idempotent(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    p = s.ensure_dir(["alice", "2026", "Fall 2026", "CS 201"])
    assert p.is_dir()
    assert s.ensure_dir(["alice", "2026", "Fall 2026", "CS 201"]) == p


def test_rename_and_undo(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.ensure_dir(["alice", "2026", "Fall"])
    (tmp_path / "alice" / "2026" / "Fall" / "keep.md").write_text("x")
    undo = s.rename_dir(["alice", "2026", "Fall"], ["alice", "2026", "Fall 2026"])
    assert (tmp_path / "alice" / "2026" / "Fall 2026" / "keep.md").exists()
    assert not (tmp_path / "alice" / "2026" / "Fall").exists()
    undo()
    assert (tmp_path / "alice" / "2026" / "Fall" / "keep.md").exists()


def test_rename_missing_source_creates_target(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.rename_dir(["alice", "old"], ["alice", "new"])
    assert (tmp_path / "alice" / "new").is_dir()


@pytest.mark.parametrize("bad", [[".."], ["alice", ".."], ["/etc"], ["a/b"], [""], ["a\\b"]])
def test_traversal_rejected(tmp_path: Path, bad: list[str]) -> None:
    with pytest.raises(StoragePathError):
        StorageService(tmp_path).ensure_dir(bad)


def test_no_delete_api() -> None:
    names = {n for n in dir(StorageService) if not n.startswith("_")}
    assert not any(word in n for n in names for word in ("delete", "remove", "unlink", "rmtree"))
