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
    # 009: `delete_tree` — one session/event folder, only for a permanent delete from the Trash
    # 009: `remove_empty_dir` — only folders without any file inside (creation Undo)
    assert deleting == {"delete_content_file", "delete_tree", "remove_empty_dir"}


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


# ---- documents (007 T008) -------------------------------------------------------------------


def test_delete_content_file_accepts_documents_and_sidecars_only(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    d = ["u", "c", "d", "documents"]
    for name in ("Slides.pdf", "Slides.annotations.json"):
        s.write_text_atomic([*d, name], "x")
        s.delete_content_file([*d, name])
        assert not (tmp_path / "u/c/d/documents" / name).exists()
    for name in ("notes.txt", "other.json", "Slides.annotations.unreadable.json.bak"):
        s.write_text_atomic([*d, name], "keep")
        with pytest.raises(StoragePathError):
            s.delete_content_file([*d, name])
    s.write_text_atomic(["u", "c", "d", "notes", "x.pdf"], "keep")
    with pytest.raises(StoragePathError):
        s.delete_content_file(["u", "c", "d", "notes", "x.pdf"])


def test_rename_pair_moves_pdf_and_sidecar_with_one_undo(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    d = ["u", "c", "d", "documents"]
    s.write_text_atomic([*d, "Old.pdf"], "pdf")
    s.write_text_atomic([*d, "Old.annotations.json"], "{}")
    undo = s.rename_pair([*d, "Old.pdf"], [*d, "New.pdf"])
    base = tmp_path / "u/c/d/documents"
    assert (base / "New.pdf").read_text() == "pdf"
    assert (base / "New.annotations.json").read_text() == "{}"
    assert not (base / "Old.pdf").exists() and not (base / "Old.annotations.json").exists()
    undo()
    assert (base / "Old.pdf").exists() and (base / "Old.annotations.json").exists()
    assert not (base / "New.pdf").exists()


def test_rename_pair_without_sidecar_and_never_replacing(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    d = ["u", "c", "d", "documents"]
    s.write_text_atomic([*d, "A.pdf"], "a")
    s.rename_pair([*d, "A.pdf"], [*d, "B.pdf"])
    assert (tmp_path / "u/c/d/documents/B.pdf").read_text() == "a"
    s.write_text_atomic([*d, "C.pdf"], "c")
    s.write_text_atomic([*d, "D.annotations.json"], "theirs")
    with pytest.raises(FileExistsError):
        s.rename_pair([*d, "C.pdf"], [*d, "D.pdf"])
    assert (tmp_path / "u/c/d/documents/C.pdf").read_text() == "c"
    assert (tmp_path / "u/c/d/documents/D.annotations.json").read_text() == "theirs"


def test_move_aside_keeps_the_file_under_a_new_name(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    parts = ["u", "c", "d", "documents", "Slides.annotations.json"]
    s.write_text_atomic(parts, "not json")
    first = s.move_aside(parts, "unreadable-20261008-101500")
    assert first is not None and first.name == "Slides.annotations.unreadable-20261008-101500.json"
    assert first.read_text() == "not json"
    s.write_text_atomic(parts, "again")
    second = s.move_aside(parts, "unreadable-20261008-101500")
    assert second is not None and second.name.endswith("-2.json")
    assert s.move_aside(parts, "x") is None  # nothing left to move


# ---- 009: permanent delete of one session/event folder (Trash → Delete → Yes) -------------

FOLDER = ["alice", "2026", "Fall 2026", "_Events", "2026-10-15 AI Seminar"]


def test_delete_tree_removes_exactly_one_folder(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.ensure_dir([*FOLDER, "notes"])
    (tmp_path.joinpath(*FOLDER) / "notes" / "a.md").write_text("x")
    sibling = s.ensure_dir(["alice", "2026", "Fall 2026", "_Events", "2026-10-16 Other"])
    (sibling / "keep.md").write_text("keep")
    assert s.delete_tree(FOLDER) == []
    assert not tmp_path.joinpath(*FOLDER).exists()
    assert (sibling / "keep.md").read_text() == "keep"
    assert s.delete_tree(FOLDER) == []  # already gone: nothing to do, no error


@pytest.mark.parametrize(
    "parts",
    [
        ["alice"],
        ["alice", "2026"],
        ["alice", "2026", "Fall 2026"],
        ["alice", "2026", "Fall 2026", "_Events"],
        [*FOLDER, "notes"],
        ["alice", "2026", "..", "_Events", "x"],
        ["alice", "2026", "Fall 2026", "_Events", "a/b"],
    ],
)
def test_delete_tree_refuses_other_depths_and_traversal(tmp_path: Path, parts: list[str]) -> None:
    s = StorageService(tmp_path)
    s.ensure_dir([*FOLDER, "notes"])
    with pytest.raises(StoragePathError):
        s.delete_tree(parts)
    assert tmp_path.joinpath(*FOLDER, "notes").is_dir()


def test_delete_tree_never_follows_links(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "precious.txt").write_text("keep")
    root = tmp_path / "files"
    s = StorageService(root)
    s.ensure_dir(FOLDER[:4])
    link = root.joinpath(*FOLDER)
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:  # pragma: no cover - symlinks need privileges on some Windows setups
        pytest.skip("symlinks not available")
    with pytest.raises(StoragePathError):
        s.delete_tree(FOLDER)
    # a link higher up the path is refused too
    s2 = StorageService(tmp_path / "files2")
    (tmp_path / "files2" / "alice").mkdir(parents=True)
    (tmp_path / "files2" / "alice" / "2026").symlink_to(outside, target_is_directory=True)
    (outside / "Fall 2026" / "_Events" / "x").mkdir(parents=True)
    with pytest.raises(StoragePathError):
        s2.delete_tree(["alice", "2026", "Fall 2026", "_Events", "x"])
    assert (outside / "precious.txt").read_text() == "keep"
    assert (outside / "Fall 2026" / "_Events" / "x").is_dir()


def test_delete_tree_refuses_a_file(tmp_path: Path) -> None:
    s = StorageService(tmp_path)
    s.ensure_dir(FOLDER[:4])
    tmp_path.joinpath(*FOLDER).write_text("not a folder")
    with pytest.raises(StoragePathError):
        s.delete_tree(FOLDER)


def test_delete_tree_reports_what_it_could_not_remove(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    s = StorageService(tmp_path)
    s.ensure_dir([*FOLDER, "audios"])
    locked = tmp_path.joinpath(*FOLDER, "audios", "talk.webm")
    locked.write_bytes(b"x")
    real_unlink = os.unlink

    def unlink(path: object, *a: object, **kw: object) -> None:
        if str(path).endswith("talk.webm") or getattr(path, "name", "") == "talk.webm":
            raise PermissionError("locked")
        real_unlink(path, *a, **kw)  # type: ignore[arg-type]

    monkeypatch.setattr(os, "unlink", unlink)
    failed = s.delete_tree(FOLDER)
    assert "2026/Fall 2026/_Events/2026-10-15 AI Seminar/audios/talk.webm" in failed
    assert locked.exists()


def test_remove_empty_dir_only_removes_empty_folders(tmp_path: Path) -> None:
    storage = StorageService(tmp_path)
    storage.ensure_dir(["u", "2026", "Fall", "CS", "2026-10-01", "notes"])
    assert storage.remove_empty_dir(["u", "2026"]) is True
    assert not (tmp_path / "u" / "2026").exists()
    assert (tmp_path / "u").is_dir()

    storage.ensure_dir(["u", "2027", "Spring", "empty"])
    (tmp_path / "u" / "2027" / "Spring" / "keep.txt").write_text("x", encoding="utf-8")
    assert storage.remove_empty_dir(["u", "2027"]) is False
    assert (tmp_path / "u" / "2027" / "Spring" / "keep.txt").exists()
    assert not (tmp_path / "u" / "2027" / "Spring" / "empty").exists()
    assert storage.remove_empty_dir(["u", "missing"]) is True
    with pytest.raises(StoragePathError):
        storage.remove_empty_dir(["u"])
