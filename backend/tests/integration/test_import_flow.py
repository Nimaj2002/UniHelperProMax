"""006 import flows against the real API, SQLite and a temp file system."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import anyio
import pytest
from fastapi.testclient import TestClient

from tests import audio_fixtures as fx
from tests.contract.import_helpers import (
    API,
    audios_dir,
    import_audio,
    make_session,
    staged_files,
)
from unihelper.storage.storage_service import StorageService

pytestmark = pytest.mark.integration

FORMATS = [
    ("lecture.wav", fx.wav(4000)),
    ("lecture.flac", fx.flac(4000)),
    ("lecture.opus", fx.ogg_opus(4000)),
    ("lecture.aac", fx.adts_aac(4000)),
    ("lecture.mp3", fx.mp3_xing(4000)),
    ("lecture.m4a", fx.m4a(4000)),
]


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_import_then_play(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    for file_name, data in FORMATS:
        r = import_audio(c, key, file_name, data)
        assert r.status_code == 201, (file_name, r.text)
        rec = r.json()
        stored = audios_dir(tmp_data_dir) / rec["fileName"]
        assert _sha(stored.read_bytes()) == _sha(data), file_name  # stored unchanged (FR-008)
        assert abs(rec["durationMs"] - 4000) <= 50, file_name
        assert staged_files(tmp_data_dir) == []
        assert c.get(f"{API}/recordings/{rec['id']}/audio").content == data

    listed = c.get(f"{API}/sessions/{key}/recordings").json()
    assert len(listed) == len(FORMATS)
    assert all(r["origin"] == "imported" for r in listed)
    cls_course = c.get(f"{API}/sessions/{key}").json()["courseId"]
    entries = c.get(f"{API}/courses/{cls_course}/timeline").json()["entries"]
    assert next(e for e in entries if e["key"] == key)["audioCount"] == len(FORMATS)


def _asgi_upload(
    app: Any,
    client: TestClient,
    key: str,
    parts: list[bytes],
    total: int,
    disconnect: bool = True,
) -> list[dict[str, Any]]:
    """Send `parts` as the body with a declared `total` length, then disconnect (what a
    cancelled XHR looks like to the server) or end the body there."""
    cookie = "; ".join(f"{k}={v}" for k, v in client.cookies.items())
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "root_path": "",
        "path": f"{API}/sessions/{key}/recordings/import",
        "raw_path": f"{API}/sessions/{key}/recordings/import".encode(),
        "query_string": b"fileName=lecture.wav",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/octet-stream"),
            (b"content-length", str(total).encode()),
            (b"cookie", cookie.encode()),
            (b"x-csrf-token", client.headers["X-CSRF-Token"].encode()),
        ],
    }
    messages: list[dict[str, Any]] = [
        {"type": "http.request", "body": p, "more_body": disconnect or i < len(parts) - 1}
        for i, p in enumerate(parts)
    ]
    if disconnect:
        messages.append({"type": "http.disconnect"})
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        if messages:
            return messages.pop(0)
        await anyio.sleep_forever()
        raise AssertionError  # pragma: no cover

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    async def run() -> None:
        await app(scope, receive, send)

    anyio.run(run)
    return sent


def test_disconnect_mid_upload_leaves_nothing(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    seed = import_audio(c, key, "seed.wav", fx.wav(500))
    assert seed.status_code == 201
    before = sorted(p.name for p in audios_dir(tmp_data_dir).iterdir())

    data = fx.wav(30_000)
    half = len(data) // 2
    sent = _asgi_upload(app, c, key, [data[:half]], total=len(data))
    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 400  # ClientDisconnect path (upload_cancelled), not a 5xx

    assert sorted(p.name for p in audios_dir(tmp_data_dir).iterdir()) == before
    assert staged_files(tmp_data_dir) == []
    assert [r["name"] for r in c.get(f"{API}/sessions/{key}/recordings").json()] == ["seed"]


# ---- transcribe imported audio (US3, T030; extends critical flow 2) -------------------------


def test_import_transcribe_append(
    app: Any, owner_client: TestClient, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import dataclasses

    from tests import fake_transcriber
    from tests.contract.notes_helpers import create_note
    from tests.contract.transcription_helpers import configure, job, run_jobs, transcribe
    from unihelper.transcription import providers

    c = owner_client
    configure(app)
    key = make_session(c)
    original = "# Week 3\n\nmy own notes ✓"
    note = create_note(c, key, "Lecture notes", original)
    note_file = (
        tmp_data_dir / "files/owner/2026/Fall 2026/CS 201/2026-09-28/notes" / note["fileName"]
    )
    rec = import_audio(c, key, "Week 3.wav", fx.wav(3000)).json()

    started = transcribe(c, rec["id"], noteId=note["id"])
    assert started.status_code == 202, started.text
    run_jobs(c)
    assert job(c, started.json()["id"])["status"] == "completed"
    call = fake_transcriber.app.state.calls[-1]
    assert call["file"] == "Week 3.wav" and call["size"] == rec["size"]
    text = note_file.read_text(encoding="utf-8")
    assert text.startswith(original)  # appended after the last character, nothing changed
    assert "Transcript of Week 3.wav" in text[len(original) :]

    # over a provider's per-file limit: refused before the file is read, note untouched
    big = import_audio(c, key, "Long lecture.wav", fx.wav(20_000)).json()
    spec = dataclasses.replace(providers.VOICE_STUDIO, max_upload_bytes=big["size"] // 2)
    monkeypatch.setitem(providers.SPECS, "voice-studio", spec)
    reads: list[str] = []
    real_read = StorageService.read_bytes

    def spy(self: StorageService, parts: Any) -> bytes | None:
        reads.append(parts[-1])
        return real_read(self, parts)

    monkeypatch.setattr(StorageService, "read_bytes", spy)
    before = note_file.read_bytes()
    failed = transcribe(c, big["id"], noteId=note["id"])
    assert failed.status_code == 202, failed.text
    run_jobs(c)
    result = job(c, failed.json()["id"])
    assert result["status"] == "failed" and result["errorCategory"] == "file_rejected"
    assert "too long" in result["errorMessage"]
    assert note_file.read_bytes() == before
    assert "Long lecture.wav" not in reads


# ---- replace vs transcript append (US5, T038) ---------------------------------------------


def test_replace_vs_append(
    app: Any, owner_client: TestClient, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A job created while a Replace is writing must wait for it and append after the
    replaced text; a Replace chosen before a transcript landed is refused (version)."""
    import threading
    from collections.abc import Sequence

    from tests.contract.notes_helpers import create_note
    from tests.contract.transcription_helpers import configure
    from tests.integration.test_transcribe_append_flow import _ready_to_append
    from unihelper.services import transcription_service as tsvc

    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    path = tmp_data_dir / "files/owner/2026/Fall 2026/CS 201/2026-09-28/notes" / note["fileName"]

    in_write = threading.Event()
    job_ready = threading.Event()
    original = StorageService.write_text_atomic

    def paused(self: StorageService, parts: Sequence[str], text: str) -> tuple[str, int]:
        if text == "imported text":
            in_write.set()
            job_ready.wait(timeout=5)
        return original(self, parts, text)

    monkeypatch.setattr(StorageService, "write_text_atomic", paused)
    result: dict[str, Any] = {}

    def do_replace() -> None:
        result["r"] = c.put(
            f"{API}/notes/{note['id']}/import-replace",
            json={"content": "imported text"},
            headers={"If-Match": f'"{note["version"]}"'},
        )

    replacer = threading.Thread(target=do_replace)
    replacer.start()
    assert in_write.wait(timeout=5)
    monkeypatch.setattr(StorageService, "write_text_atomic", original)
    job_id = _ready_to_append(app, c, key, note)  # created after the replace passed its checks
    appender = threading.Thread(
        target=tsvc.append_result, args=(app.state.sessionmaker, app.state.storage, job_id)
    )
    appender.start()
    job_ready.set()
    replacer.join(timeout=10)
    appender.join(timeout=10)
    assert result["r"].status_code == 200, result["r"].text
    final = path.read_text(encoding="utf-8")
    assert final.startswith("imported text\n\n## Transcript — ") and final.endswith(
        "SPOKEN WORDS\n"
    )

    # the user's earlier choice is now stale: nothing is replaced, the transcript stays
    stale = c.put(
        f"{API}/notes/{note['id']}/import-replace",
        json={"content": "second import"},
        headers={"If-Match": f'"{result["r"].json()["version"]}"'},
    )
    assert stale.status_code == 412
    assert path.read_text(encoding="utf-8") == final


def test_first_two_imports_into_a_new_session_race_safely(
    app: Any, owner_client: TestClient
) -> None:
    """Found in e2e: two uploads dropped together both created the session folder row
    (UNIQUE session_folders) and one failed. Run the service in two threads, each with its own
    DB session, released together."""
    import threading

    from unihelper.models import User
    from unihelper.services import recording_service as rsvc

    c = owner_client
    key = make_session(c)
    storage: StorageService = app.state.storage
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []
    names: list[str] = []

    def run(n: str) -> None:
        with app.state.sessionmaker() as db:
            user = db.query(User).filter_by(username="owner").one()
            staged, fh = storage.open_upload()
            with fh:
                fh.write(fx.wav(500))
            barrier.wait()
            try:
                names.append(
                    rsvc.import_audio(db, storage, user, key, staged, "lecture.wav", None)["name"]
                )
                db.commit()
            except BaseException as err:  # noqa: BLE001 - collected for the assertion
                errors.append(err)
                db.rollback()

    threads = [threading.Thread(target=run, args=(n,)) for n in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert errors == []
    assert sorted(names) == ["lecture", "lecture (2)"]
    assert len(c.get(f"{API}/sessions/{key}/recordings").json()) == 2
