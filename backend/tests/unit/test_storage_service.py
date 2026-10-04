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


def test_only_note_files_can_be_deleted() -> None:
    names = {n for n in dir(StorageService) if not n.startswith("_")}
    deleting = {n for n in names for w in ("delete", "remove", "unlink", "rmtree") if w in n}
    assert deleting == {"delete_note_file"}


def test_delete_note_file_scope(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.write_text_atomic(["alice", "C", "2026-10-05", "notes", "a.md"], "x")
    s.write_text_atomic(["alice", "C", "2026-10-05", "audios", "a.md"], "x")
    s.write_text_atomic(["alice", "C", "2026-10-05", "notes", "keep.txt"], "x")
    for bad in (
        ["alice", "C", "2026-10-05", "audios", "a.md"],
        ["alice", "C", "2026-10-05", "notes", "keep.txt"],
        ["alice", "C", "2026-10-05", "notes"],
    ):
        with pytest.raises(StoragePathError):
            s.delete_note_file(bad)
    s.delete_note_file(["alice", "C", "2026-10-05", "notes", "a.md"])
    assert not (tmp_path / "alice/C/2026-10-05/notes/a.md").exists()
    assert (tmp_path / "alice/C/2026-10-05/notes/keep.txt").exists()


def test_atomic_write_and_hash(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    parts = ["alice", "notes", "n.md"]
    h, size = s.write_text_atomic(parts, "# Title\nçok güzel\n")
    assert size == len("# Title\nçok güzel\n".encode()) and s.file_hash(parts) == h
    assert s.read_bytes(parts) == "# Title\nçok güzel\n".encode()
    assert [p.name for p in (tmp_path / "alice" / "notes").iterdir()] == ["n.md"]  # no temp left
    assert s.read_bytes(["alice", "notes", "missing.md"]) is None


def test_failed_atomic_write_keeps_old_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    s = StorageService(tmp_path)
    parts = ["alice", "notes", "n.md"]
    s.write_text_atomic(parts, "old")

    def boom(*_a: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        s.write_text_atomic(parts, "new")
    assert (tmp_path / "alice/notes/n.md").read_text() == "old"
    assert [p.name for p in (tmp_path / "alice" / "notes").iterdir()] == ["n.md"]


def test_rename_file_and_undo(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.write_text_atomic(["u", "notes", "a.md"], "x")
    undo = s.rename_file(["u", "notes", "a.md"], ["u", "notes", "b.md"])
    assert (tmp_path / "u/notes/b.md").exists() and not (tmp_path / "u/notes/a.md").exists()
    undo()
    assert (tmp_path / "u/notes/a.md").exists()
