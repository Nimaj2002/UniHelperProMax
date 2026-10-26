"""016 research R3, R9: safe extraction targets, archive names, entry checks."""

from __future__ import annotations

import hashlib
import io
import json
import stat
import zipfile
from pathlib import Path

import pytest

from unihelper.api.errors import ApiError
from unihelper.backup import manifest as mf
from unihelper.backup import reader
from unihelper.storage import backup_fs

pytestmark = pytest.mark.unit


def _code(fn, *args, **kw) -> str:  # type: ignore[no-untyped-def]
    with pytest.raises(ApiError) as err:
        fn(*args, **kw)
    return err.value.code


# ---- extraction targets --------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["/etc/passwd", "C:/Windows/x", "//server/share/x", "../evil.txt", "a/../../b",
             "a\\b.txt", "a\x00b", "a/./b", ""],
)
def test_unsafe_targets_are_refused(tmp_path: Path, name: str) -> None:
    assert _code(backup_fs.safe_extract_target, tmp_path, name) == "backup_unsafe"


def test_a_nested_path_resolves_under_the_root(tmp_path: Path) -> None:
    target = backup_fs.safe_extract_target(tmp_path, "2026/Fall/CS 201/notes/a.md")
    assert target == (tmp_path / "2026/Fall/CS 201/notes/a.md").resolve()


@pytest.mark.parametrize(
    ("rel", "invalid"),
    [("2026/Fall/notes/a.md", False), ("2026/CON/a.md", True), ("2026/nul.txt", True),
     ("2026/a?.md", True), ("2026/trailing./a.md", True), ("2026/space /a.md", True),
     ("2026/a:b.md", True)],
)
def test_windows_names(rel: str, invalid: bool) -> None:
    assert backup_fs.invalid_here(rel, windows=True) is invalid
    assert backup_fs.invalid_here(rel, windows=False) is False


def test_walk_skips_temp_partial_and_links(tmp_path: Path) -> None:
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "a.md").write_text("a")
    (tmp_path / "notes" / ".a.md.tmp-0a1b2c3d").write_text("temp")
    (tmp_path / "audio.part").write_text("partial")
    (tmp_path / "link.md").symlink_to(tmp_path / "notes" / "a.md")
    assert [rel for rel, _p, _s in backup_fs.walk_account(tmp_path)] == ["notes/a.md"]


# ---- archives ------------------------------------------------------------------------------


def _manifest(entries: dict[str, bytes], **over: object) -> dict[str, object]:
    return {
        "kind": "unihelper-backup",
        "formatVersion": 1,
        "appVersion": "1.0.1",
        "schemaRevision": mf.head_revision(),
        "createdAt": "2026-10-26T12:00:00Z",
        "source": "web",
        "account": {"timezone": "UTC"},
        "counts": {},
        "entries": [
            {"path": n, "size": len(d), "sha256": hashlib.sha256(d).hexdigest()}
            for n, d in sorted(entries.items())
        ],
    } | over


def _zip(path: Path, entries: dict[str, bytes], manifest: dict[str, object] | None = None,
         extra: dict[str, bytes] | None = None, link: str | None = None) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for n, d in {**entries, **(extra or {})}.items():
            info = zipfile.ZipInfo(n)
            if n == link:
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(info, d)
        zf.writestr("README.txt", mf.README_TEXT)
        zf.writestr("manifest.json", json.dumps(manifest or _manifest(entries)))
    return path


ENTRIES = {"data/notes.jsonl": b'{"id": "n1", "user_id": "u"}\n',
           "files/2026/notes/a.md": b"# A\n"}


def _check(path: Path, windows: bool = False) -> None:
    zf, manifest = reader.open_backup(path)
    with zf:
        reader.check_names(zf, manifest, windows)
        reader.verify_entries(zf, manifest)
        reader.data_ids(zf, manifest)


def test_a_good_archive_passes(tmp_path: Path) -> None:
    _check(_zip(tmp_path / "b.zip", ENTRIES))


def test_not_a_backup(tmp_path: Path) -> None:
    junk = tmp_path / "junk.zip"
    junk.write_bytes(b"not a zip")
    assert _code(_check, junk) == "not_a_backup"
    other = tmp_path / "other.zip"
    with zipfile.ZipFile(other, "w") as zf:
        zf.writestr("hello.txt", "hi")
    assert _code(_check, other) == "not_a_backup"
    wrong_kind = _zip(tmp_path / "k.zip", ENTRIES, _manifest(ENTRIES, kind="something-else"))
    assert _code(_check, wrong_kind) == "not_a_backup"


def test_newer_versions_are_refused(tmp_path: Path) -> None:
    newer_schema = _zip(tmp_path / "s.zip", ENTRIES, _manifest(ENTRIES, schemaRevision="9999"))
    assert _code(_check, newer_schema) == "backup_too_new"
    newer_format = _zip(tmp_path / "f.zip", ENTRIES, _manifest(ENTRIES, formatVersion=2))
    assert _code(_check, newer_format) == "backup_too_new"


def test_extra_and_missing_entries_are_damaged(tmp_path: Path) -> None:
    extra = _zip(tmp_path / "e.zip", ENTRIES, _manifest(ENTRIES),
                 extra={"files/2026/new.txt": b"x"})
    assert _code(_check, extra) == "backup_damaged"
    fewer = dict(ENTRIES)
    del fewer["files/2026/notes/a.md"]
    missing = _zip(tmp_path / "m.zip", fewer, _manifest(ENTRIES))
    assert _code(_check, missing) == "backup_damaged"
    unknown = {**ENTRIES, "data/not_a_table.jsonl": b""}
    assert _code(_check, _zip(tmp_path / "u.zip", unknown)) == "backup_damaged"


def test_changed_bytes_are_damaged(tmp_path: Path) -> None:
    changed = dict(ENTRIES)
    changed["files/2026/notes/a.md"] = b"# B\n"  # same size, other hash
    assert _code(_check, _zip(tmp_path / "h.zip", changed, _manifest(ENTRIES))) == (
        "backup_damaged"
    )
    longer = dict(ENTRIES)
    longer["files/2026/notes/a.md"] = b"# A, but longer than the manifest says\n"
    assert _code(_check, _zip(tmp_path / "l.zip", longer, _manifest(ENTRIES))) == (
        "backup_damaged"
    )


@pytest.mark.parametrize(
    "name", ["/abs.txt", "C:/x.txt", "files/../evil.txt", "files/a\\b.txt"],
)
def test_unsafe_names_are_refused(tmp_path: Path, name: str) -> None:
    entries = {**ENTRIES, name: b"x"}
    path = tmp_path / "bad.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for n, d in entries.items():
            info = zipfile.ZipInfo("x")
            info.filename = n  # bypass zipfile's own name normalisation
            zf.writestr(info, d)
        zf.writestr("README.txt", mf.README_TEXT)
        zf.writestr("manifest.json", json.dumps(_manifest(entries)))
    assert _code(_check, path) == "backup_unsafe"


def test_links_and_case_duplicates_are_unsafe(tmp_path: Path) -> None:
    linked = {**ENTRIES, "files/2026/link.md": b"/etc/passwd"}
    assert _code(_check, _zip(tmp_path / "l.zip", linked, link="files/2026/link.md")) == (
        "backup_unsafe"
    )
    cased = {**ENTRIES, "files/2026/notes/A.md": b"# A\n"}
    assert _code(_check, _zip(tmp_path / "c.zip", cased)) == "backup_unsafe"


def test_names_invalid_on_windows(tmp_path: Path) -> None:
    names = {**ENTRIES, "files/2026/CON.md": b"x"}
    path = _zip(tmp_path / "w.zip", names)
    _check(path, windows=False)
    assert _code(_check, path, windows=True) == "backup_names_invalid"


def test_entry_is_cut_off_at_its_manifest_size() -> None:
    data = b"y" * 5000
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("files/big.bin", data)
    seen: list[int] = []
    entry = mf.Entry(path="files/big.bin", size=10, sha256="0" * 64)
    with zipfile.ZipFile(buf) as zf:
        assert _code(reader.stream_entry, zf, entry, lambda b: seen.append(len(b))) == (
            "backup_damaged"
        )
    assert sum(seen) <= 10
