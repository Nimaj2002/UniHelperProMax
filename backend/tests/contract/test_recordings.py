from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.recording_helpers import API, make_session, put_chunk, start, stop, upload_all
from tests.contract.test_classes_sessions_read import new_class_body
from tests.webm_fixture import chunks, make_webm

pytestmark = pytest.mark.contract


def test_start_list_get_active(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    key = make_session(c)
    rec = start(c, key)
    check(rec, "Recording", spec="003")
    assert rec["status"] == "recording" and rec["active"] is True and rec["nextSeq"] == 0
    assert rec["name"].startswith("Recording ") and rec["fileName"].endswith(".webm")
    assert_problem(
        c.post(f"{API}/sessions/{key}/recordings", json={"mimeType": "audio/webm"}),
        409,
        "recording_in_progress",
    )
    assert (
        c.post(f"{API}/sessions/{key}/recordings", json={"mimeType": "audio/ogg"}).status_code
        == 422
    )
    active = c.get(f"{API}/recordings/active")
    assert active.status_code == 200 and active.json()["id"] == rec["id"]
    got = c.get(f"{API}/recordings/{rec['id']}")
    check(got.json(), "Recording", spec="003")
    lst = c.get(f"{API}/sessions/{key}/recordings").json()
    check(lst, "Recording", many=True, spec="003")
    m = make_member()
    assert_problem(m.get(f"{API}/recordings/{rec['id']}"), 404, "not_found")
    assert_problem(put_chunk(m, rec["id"], 0, b"x"), 404, "not_found")
    assert m.get(f"{API}/recordings/active").json() is None
    assert_problem(
        m.post(f"{API}/sessions/{key}/recordings", json={"mimeType": "audio/webm"}),
        404,
        "not_found",
    )


def test_chunks_rules(owner_client: TestClient) -> None:
    c = owner_client
    rec = start(c, make_session(c))
    r = put_chunk(c, rec["id"], 0, b"abc")
    assert r.status_code == 200
    check(r.json(), "ChunkResult", spec="003")
    assert r.json() == {"nextSeq": 1, "size": 3}
    assert put_chunk(c, rec["id"], 0, b"abc").json() == {"nextSeq": 1, "size": 3}  # retry
    body = assert_problem(put_chunk(c, rec["id"], 3, b"x"), 409, "chunk_gap")
    assert body["nextSeq"] == 1
    assert_problem(
        put_chunk(c, rec["id"], 1, b"x" * (10 * 1024 * 1024 + 1)), 413, "chunk_too_large"
    )


def test_stop_finalizes_and_streams(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    rec = start(c, key)
    upload_all(c, rec["id"], chunks(make_webm(6), 4))
    r = stop(c, rec["id"])
    assert r.status_code == 200
    check(r.json(), "Recording", spec="003")
    done = r.json()
    assert done["status"] == "complete" and done["durationMs"] == 6000 and not done["active"]
    assert_problem(put_chunk(c, rec["id"], 4, b"late"), 409, "recording_finished")
    audio = c.get(f"{API}/recordings/{rec['id']}/audio")
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/webm"
    assert len(audio.content) == done["size"]
    part = c.get(f"{API}/recordings/{rec['id']}/audio", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    # a second recording can start now; names stay unique in the session
    second = start(c, key)
    assert second["name"] != rec["name"] or second["fileName"] != rec["fileName"]


def test_mp4_uses_client_duration(owner_client: TestClient) -> None:
    c = owner_client
    rec = start(c, make_session(c), "audio/mp4")
    assert rec["fileName"].endswith(".m4a")
    upload_all(c, rec["id"], [b"\x00\x00\x00\x18ftypmp42", b"moredata"])
    done = stop(c, rec["id"], durationMs=4321).json()
    assert done["durationMs"] == 4321 and done["status"] == "complete"


def test_missing_file(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    rec = start(c, make_session(c))
    upload_all(c, rec["id"], chunks(make_webm(2), 2))
    stop(c, rec["id"])
    for f in tmp_data_dir.rglob("*.webm"):
        f.unlink()
    assert c.get(f"{API}/recordings/{rec['id']}").json()["missing"] is True
    assert_problem(c.get(f"{API}/recordings/{rec['id']}/audio"), 404, "file_missing")


def test_upcoming_session_records_and_timeline_counts_audio(owner_client: TestClient) -> None:
    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()  # Mon+Wed until 2026-10-31
    key = f"{cls['lineageId']}:2026-10-28"  # upcoming: recording is always allowed
    rec = start(c, key)
    upload_all(c, rec["id"], chunks(make_webm(2), 2))
    assert stop(c, rec["id"]).status_code == 200
    entries = c.get(f"{API}/courses/{cls['courseId']}/timeline").json()["entries"]
    by_key = {e["key"]: e for e in entries}
    assert by_key[key]["audioCount"] == 1 and by_key[key]["noteCount"] == 0
