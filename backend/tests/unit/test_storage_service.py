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
    assert deleting == {"delete_content_file"}


def test_delete_content_file_scope(tmp_path: Path) -> None:
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
            s.delete_content_file(bad)
    s.delete_content_file(["alice", "C", "2026-10-05", "notes", "a.md"])
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


def test_append_bytes_fsyncs_and_grows(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    parts = ["u", "c", "2026-10-05", "audios", "r.webm"]
    assert s.append_bytes(parts, b"abc") == 3
    assert s.append_bytes(parts, b"de") == 5
    assert (tmp_path / "u/c/2026-10-05/audios/r.webm").read_bytes() == b"abcde"


def test_delete_content_file_allows_recordings_only_in_audios(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.write_text_atomic(["u", "c", "d", "audios", "r.webm"], "x")
    s.write_text_atomic(["u", "c", "d", "notes", "x.webm"], "x")
    with pytest.raises(StoragePathError):
        s.delete_content_file(["u", "c", "d", "notes", "x.webm"])
    s.delete_content_file(["u", "c", "d", "audios", "r.webm"])
    assert not (tmp_path / "u/c/d/audios/r.webm").exists()


# ---- import staging (006 T009) ------------------------------------------------------------


def test_delete_content_file_accepts_imported_audio_extensions(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    for ext in (".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".webm"):
        s.write_text_atomic(["u", "c", "d", "audios", f"a{ext}"], "x")
        s.delete_content_file(["u", "c", "d", "audios", f"a{ext}"])
        assert not (tmp_path / "u/c/d/audios" / f"a{ext}").exists()
    s.write_text_atomic(["u", "c", "d", "audios", "x.txt"], "x")
    with pytest.raises(StoragePathError):
        s.delete_content_file(["u", "c", "d", "audios", "x.txt"])


def test_open_upload_stages_outside_user_folders(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    path, fh = s.open_upload()
    with fh:
        fh.write(b"abc")
    assert path.parent == (tmp_path / ".uploads").resolve()
    assert path.suffix == ".part"
    assert path.read_bytes() == b"abc"


def test_discard_upload_only_touches_staging_parts(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    path, fh = s.open_upload()
    fh.close()
    s.discard_upload(path)
    assert not path.exists()
    s.discard_upload(path)  # already gone: fine

    s.write_text_atomic(["u", "c", "d", "audios", "a.part"], "keep")
    with pytest.raises(StoragePathError):
        s.discard_upload(tmp_path / "u/c/d/audios/a.part")
    (tmp_path / ".uploads" / "other.txt").write_text("keep")
    with pytest.raises(StoragePathError):
        s.discard_upload(tmp_path / ".uploads" / "other.txt")
    assert (tmp_path / "u/c/d/audios/a.part").read_text() == "keep"


def test_commit_upload_moves_atomically_and_undo_removes_it(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    path, fh = s.open_upload()
    with fh:
        fh.write(b"audio")
    target = ["u", "c", "d", "audios", "Lecture.mp3"]
    undo = s.commit_upload(path, target)
    assert not path.exists()
    assert (tmp_path / "u/c/d/audios/Lecture.mp3").read_bytes() == b"audio"
    undo()
    assert not (tmp_path / "u/c/d/audios/Lecture.mp3").exists()
    assert list((tmp_path / ".uploads").iterdir()) == []


def test_commit_upload_never_replaces_an_existing_file(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.write_text_atomic(["u", "c", "d", "audios", "Lecture.mp3"], "theirs")
    path, fh = s.open_upload()
    with fh:
        fh.write(b"mine")
    with pytest.raises(FileExistsError):
        s.commit_upload(path, ["u", "c", "d", "audios", "Lecture.mp3"])
    assert (tmp_path / "u/c/d/audios/Lecture.mp3").read_text() == "theirs"
    assert path.exists()  # still staged; the caller discards it


def test_sweep_uploads_deletes_only_stale_parts(tmp_path: Path) -> None:
    import os
    import time
    from datetime import timedelta

    s = StorageService(tmp_path)
    old, fh = s.open_upload()
    fh.close()
    new, fh = s.open_upload()
    fh.close()
    hours_ago = time.time() - 2 * 3600
    os.utime(old, (hours_ago, hours_ago))
    (tmp_path / ".uploads" / "notes.txt").write_text("x")
    os.utime(tmp_path / ".uploads" / "notes.txt", (hours_ago, hours_ago))

    assert s.sweep_uploads(timedelta(hours=1)) == 1
    assert not old.exists()
    assert new.exists()
    assert (tmp_path / ".uploads" / "notes.txt").exists()
    assert StorageService(tmp_path / "fresh").sweep_uploads(timedelta(hours=1)) == 0
