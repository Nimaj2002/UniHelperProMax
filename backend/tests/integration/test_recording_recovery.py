"""US2: crashes, closed tabs and network gaps never lose a recording (FR-007–FR-009)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.contract.recording_helpers import API, make_session, put_chunk, start, stop, upload_all
from tests.webm_fixture import chunks, make_webm
from unihelper.models import Recording

pytestmark = pytest.mark.integration


def age(app: Any, rec_id: str, seconds: int) -> None:
    with app.state.sessionmaker() as db:
        r = db.get(Recording, rec_id)
        old = (datetime.now(UTC) - timedelta(seconds=seconds)).isoformat()
        r.last_chunk_at = old
        r.started_at = old
        db.commit()


def test_crash_becomes_interrupted_and_recovers(owner_client: TestClient, app: Any) -> None:
    c = owner_client
    key = make_session(c)
    rec = start(c, key)
    data = make_webm(8)
    parts = chunks(data, 4)
    upload_all(c, rec["id"], parts[:2])  # browser crashed after 2 chunks
    age(app, rec["id"], 31)
    listed = c.get(f"{API}/sessions/{key}/recordings").json()[0]
    assert listed["status"] == "interrupted" and listed["active"] is False
    assert 0 < listed["durationMs"] < 8000
    assert c.get(f"{API}/recordings/active").json() is None
    # a new recording may start now
    other = start(c, key)
    stop(c, other["id"])
    # the reopened app uploads what IndexedDB still held, then marks it interrupted
    upload_all(c, rec["id"], parts)
    final = stop(c, rec["id"], interrupted=True).json()
    assert final["status"] == "interrupted" and final["durationMs"] == 8000


def test_network_gap_then_live_recorder_resumes(owner_client: TestClient, app: Any) -> None:
    c = owner_client
    rec = start(c, make_session(c))
    parts = chunks(make_webm(6), 3)
    upload_all(c, rec["id"], parts[:1])
    age(app, rec["id"], 45)  # offline for 45 s
    assert c.get(f"{API}/recordings/{rec['id']}").json()["status"] == "interrupted"
    for i in (1, 2):  # back online: queued chunks arrive
        assert put_chunk(c, rec["id"], i, parts[i]).status_code == 200
    assert c.get(f"{API}/recordings/{rec['id']}").json()["status"] == "recording"
    done = stop(c, rec["id"]).json()
    assert done["status"] == "complete" and done["durationMs"] == 6000


def test_truncated_last_chunk_still_playable(owner_client: TestClient, app: Any) -> None:
    c = owner_client
    rec = start(c, make_session(c))
    data = make_webm(5)
    upload_all(c, rec["id"], [data[: len(data) - 777]])
    age(app, rec["id"], 60)
    got = c.get(f"{API}/recordings/{rec['id']}").json()
    assert got["status"] == "interrupted" and 3000 < got["durationMs"] < 5000
    assert c.get(f"{API}/recordings/{rec['id']}/audio").status_code == 200
