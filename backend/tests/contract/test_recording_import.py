"""POST /sessions/{key}/recordings/import (006 T013, T025)."""

from __future__ import annotations

import hashlib
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests import audio_fixtures as fx
from tests.conftest import assert_problem
from tests.contract.import_helpers import (
    API,
    audios_dir,
    import_audio,
    make_session,
    staged_files,
)
from tests.contract.openapi_check import check
from tests.webm_fixture import make_webm

pytestmark = pytest.mark.contract


def _ok(r: Any) -> dict[str, Any]:
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    check(body, "Recording", spec="006")
    check(body, "Recording", spec="003")
    return body


def test_import_wav(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    data = fx.wav(61_000)
    rec = _ok(import_audio(c, key, "Week 3 lecture.wav", data))
    assert rec["origin"] == "imported"
    assert rec["originalFileName"] == "Week 3 lecture.wav"
    assert rec["status"] == "complete" and rec["active"] is False and rec["nextSeq"] == 0
    assert rec["name"] == "Week 3 lecture" and rec["fileName"] == "Week 3 lecture.wav"
    assert rec["mimeType"] == "audio/wav" and rec["size"] == len(data)
    assert abs(rec["durationMs"] - 61_000) <= 50
    started = datetime.fromisoformat(rec["startedAt"])
    assert abs((datetime.now(UTC) - started).total_seconds()) < 60

    stored = audios_dir(tmp_data_dir) / "Week 3 lecture.wav"
    assert hashlib.sha256(stored.read_bytes()).digest() == hashlib.sha256(data).digest()
    assert staged_files(tmp_data_dir) == []

    listed = c.get(f"{API}/sessions/{key}/recordings").json()
    assert listed[0]["id"] == rec["id"]
    got = c.get(f"{API}/recordings/{rec['id']}/audio", headers={"Range": "bytes=0-99"})
    assert got.status_code == 206 and got.content == data[:100]
    assert got.headers["content-type"].startswith("audio/wav")


def test_client_duration_only_when_file_has_none(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    big_webm = make_webm(60) + bytes(5 * 1024 * 1024)  # > 4 MB head, no Duration element
    rec = _ok(import_audio(c, key, "from-obs.webm", big_webm, duration_ms=59_870))
    assert rec["durationMs"] == 59_870
    rec2 = _ok(import_audio(c, key, "a.wav", fx.wav(2000), duration_ms=99_999))
    assert abs(rec2["durationMs"] - 2000) <= 50  # the file's own value wins


def test_name_clash_gets_next_free_name(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    first = _ok(import_audio(c, key, "lecture.mp3", fx.mp3_cbr(3000)))
    second = _ok(import_audio(c, key, "LECTURE.mp3", fx.mp3_cbr(4000)))
    assert (first["name"], second["name"]) == ("lecture", "LECTURE (2)")
    assert second["fileName"] == "LECTURE (2).mp3"
    again = c.get(f"{API}/recordings/{first['id']}").json()
    assert again["name"] == "lecture" and again["version"] == first["version"]
    assert (audios_dir(tmp_data_dir) / "lecture.mp3").read_bytes() == fx.mp3_cbr(3000)


def test_never_takes_the_name_of_a_file_already_on_disk(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    _ok(import_audio(c, key, "seed.wav", fx.wav(500)))  # creates the session folder
    hand_copied = audios_dir(tmp_data_dir) / "Guest talk.flac"
    hand_copied.write_bytes(b"theirs")
    rec = _ok(import_audio(c, key, "Guest talk.flac", fx.flac(3000)))
    assert rec["name"] == "Guest talk" and rec["fileName"] == "Guest talk (2).flac"
    assert hand_copied.read_bytes() == b"theirs"


def test_long_and_empty_names(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    long = "L" * 200
    a = _ok(import_audio(c, key, f"{long}.ogg", fx.ogg_opus(1000)))
    b = _ok(import_audio(c, key, f"{long}.ogg", fx.ogg_opus(1000)))
    assert a["name"] == "L" * 120
    assert b["name"] == "L" * 116 + " (2)" and len(b["name"]) == 120
    hidden = _ok(import_audio(c, key, ".m4a", fx.m4a(1000)))
    assert hidden["name"] == "Imported audio"


def test_concurrent_imports_with_the_same_name(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    _ok(import_audio(c, key, "seed.wav", fx.wav(200)))
    results: list[Any] = []

    def go() -> None:
        results.append(import_audio(c, key, "lecture.mp3", fx.mp3_cbr(2000)))

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    names = sorted(_ok(r)["name"] for r in results)
    assert names == ["lecture", "lecture (2)"]


def test_upcoming_session_and_timeline(owner_client: TestClient, tmp_data_dir: Path) -> None:
    from tests.contract.test_classes_sessions_read import new_class_body

    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    key = f"{cls['lineageId']}:2026-10-28"
    rec = _ok(import_audio(c, key, "prep.aac", fx.adts_aac(5000)))
    assert (audios_dir(tmp_data_dir, "2026-10-28") / rec["fileName"]).exists()
    entries = c.get(f"{API}/courses/{cls['courseId']}/timeline").json()["entries"]
    entry = next(e for e in entries if e["key"] == key)
    assert entry["audioCount"] == 1


def test_unknown_or_foreign_session(owner_client: TestClient, make_member: Any) -> None:
    c = owner_client
    key = make_session(c)
    other = make_member()
    assert_problem(import_audio(other, key, "a.wav", fx.wav(500)), 404, "not_found")
    assert_problem(import_audio(c, "nope:2026-09-28", "a.wav", fx.wav(500)), 404, "not_found")


# ---- rejections (US2, T025): every case leaves no row, no file in audios/, no staging file ----


def _nothing_left(c: TestClient, key: str, tmp_data_dir: Path, names_before: list[str]) -> None:
    listed = [r["name"] for r in c.get(f"{API}/sessions/{key}/recordings").json()]
    assert listed == names_before
    folder = audios_dir(tmp_data_dir)
    on_disk = sorted(p.name for p in folder.iterdir()) if folder.exists() else []
    assert on_disk == sorted(f"{n}.wav" for n in names_before)
    assert staged_files(tmp_data_dir) == []


@pytest.fixture
def seeded(owner_client: TestClient) -> tuple[TestClient, str]:
    key = make_session(owner_client)
    _ok(import_audio(owner_client, key, "seed.wav", fx.wav(300)))
    return owner_client, key


@pytest.mark.parametrize("name", ["notes.pdf", "video.mp4", "lecture", "song.MP3.txt"])
def test_unsupported_type(seeded: tuple[TestClient, str], tmp_data_dir: Path, name: str) -> None:
    c, key = seeded
    body = assert_problem(import_audio(c, key, name, fx.wav(500)), 415, "unsupported_type")
    assert body["accepted"] == [
        ".mp3",
        ".m4a",
        ".aac",
        ".wav",
        ".ogg",
        ".oga",
        ".opus",
        ".webm",
        ".flac",
    ]
    _nothing_left(c, key, tmp_data_dir, ["seed"])


def test_length_required(seeded: tuple[TestClient, str], tmp_data_dir: Path) -> None:
    c, key = seeded

    def chunked() -> Any:  # a generator body is sent without Content-Length
        yield fx.wav(500)

    r = c.post(
        f"{API}/sessions/{key}/recordings/import",
        params={"fileName": "a.wav"},
        content=chunked(),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert_problem(r, 411, "length_required")
    _nothing_left(c, key, tmp_data_dir, ["seed"])


def test_declared_size_over_the_limit_is_refused_before_reading(
    seeded: tuple[TestClient, str], tmp_data_dir: Path
) -> None:
    c, key = seeded
    r = import_audio(c, key, "huge.wav", b"x" * 10, headers={"Content-Length": str(2**30 + 1)})
    body = assert_problem(r, 413, "file_too_large")
    assert body["maxBytes"] == 1073741824
    _nothing_left(c, key, tmp_data_dir, ["seed"])


def test_streamed_body_over_the_limit(
    app: Any,
    seeded: tuple[TestClient, str],
    tmp_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.integration.test_import_flow import _asgi_upload
    from unihelper.api.v1 import recordings as route

    c, key = seeded
    monkeypatch.setattr(route, "MAX_IMPORT_BYTES", 1000)
    # declares less than the limit, then keeps sending: stopped as soon as it passes 1 GB
    sent = _asgi_upload(app, c, key, [bytes(600), bytes(600)], total=900, disconnect=False)
    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 413
    _nothing_left(c, key, tmp_data_dir, ["seed"])


def test_body_shorter_than_content_length(
    app: Any, seeded: tuple[TestClient, str], tmp_data_dir: Path
) -> None:
    from tests.integration.test_import_flow import _asgi_upload

    c, key = seeded
    data = fx.wav(2000)
    sent = _asgi_upload(app, c, key, [data[:1000]], total=len(data), disconnect=False)
    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 422
    body = next(m for m in sent if m["type"] == "http.response.body")["body"]
    assert b"incomplete_upload" in body
    _nothing_left(c, key, tmp_data_dir, ["seed"])


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("slides.mp3", fx.renamed_pdf()),
        ("lecture.flac", fx.wav(1000)),
        ("x.m4a", fx.truncated(fx.m4a(1000))),
    ],
)
def test_unreadable_audio(
    seeded: tuple[TestClient, str], tmp_data_dir: Path, name: str, data: bytes
) -> None:
    c, key = seeded
    body = assert_problem(import_audio(c, key, name, data), 422, "unreadable_audio")
    assert name in body["title"]
    _nothing_left(c, key, tmp_data_dir, ["seed"])


def test_insufficient_storage(
    seeded: tuple[TestClient, str], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unihelper.storage.storage_service import StorageService

    c, key = seeded
    monkeypatch.setattr(StorageService, "free_bytes", lambda self: 10 * 1024 * 1024)
    assert_problem(import_audio(c, key, "a.wav", fx.wav(1000)), 507, "insufficient_storage")
    _nothing_left(c, key, tmp_data_dir, ["seed"])
