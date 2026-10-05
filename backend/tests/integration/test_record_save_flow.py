"""Constitution VI critical flow: record → save (progressive chunks → standard, seekable file)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.contract.recording_helpers import API, make_session, start, stop, upload_all
from tests.webm_fixture import chunks, make_webm
from unihelper.domain import webm

pytestmark = pytest.mark.integration


def test_record_then_save(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    rec = start(c, key)
    audios = tmp_data_dir / "files/owner/2026/Fall 2026/CS 201/2026-09-28/audios"
    path = audios / rec["fileName"]
    assert path.exists() and path.stat().st_size == 0  # file exists from the first second
    original = make_webm(12)
    parts = chunks(original, 5)
    for i in range(1, len(parts) + 1):  # bytes are on disk after every chunk
        upload_all(c, rec["id"], parts[:i])
        assert path.read_bytes() == b"".join(parts[:i])
    done = stop(c, rec["id"]).json()
    data = path.read_bytes()
    layout = webm.analyse(data)
    assert done["durationMs"] == layout.duration_ms == 12000
    first = webm.analyse(original).clusters[0].offset
    assert data.endswith(original[first:])  # audio itself untouched
    assert len(layout.clusters) == 12
    listed = c.get(f"{API}/sessions/{key}/recordings").json()
    assert [r["id"] for r in listed] == [rec["id"]] and listed[0]["status"] == "complete"
    # the session shows audio on the course timeline (002 integration)
    course = c.get(f"{API}/sessions/{key}").json()["courseId"]
    entry = next(
        e for e in c.get(f"{API}/courses/{course}/timeline").json()["entries"] if e["key"] == key
    )
    assert entry["audioCount"] == 1
