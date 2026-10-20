"""014 T101: GET /notes/search — notes across sessions and courses for the attach picker."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.contract.event_helpers import EVENT_DATE, make_event
from tests.contract.notes_helpers import API, create_note, make_session
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def test_search(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    key = make_session(c)
    other = key.replace("2026-09-28", "2026-09-30")
    create_note(c, key, "Lecture 5 — Heaps")
    create_note(c, other, "Lecture 6 — Graphs")
    ev = make_event(c)
    create_note(c, f"{ev['lineageId']}:{EVENT_DATE}", "Seminar heaps")
    r = c.get(f"{API}/notes/search")
    assert r.status_code == 200
    for hit in r.json():
        check(hit, "NoteSearchHit", spec="014")
    assert len(r.json()) == 3
    heaps = c.get(f"{API}/notes/search", params={"q": "HEAPS"}).json()
    assert sorted(h["title"] for h in heaps) == ["Lecture 5 — Heaps", "Seminar heaps"]
    seminar = next(h for h in heaps if h["title"] == "Seminar heaps")
    assert seminar["courseId"] is None and seminar["sessionLabel"].startswith("AI Seminar · ")
    lecture = next(h for h in heaps if h["courseName"])
    assert lecture["courseName"] == "CS 201" and lecture["sessionLabel"] == "CS 201 · Mon 28 Sep"
    by_course = c.get(f"{API}/notes/search", params={"courseId": lecture["courseId"]}).json()
    assert len(by_course) == 2
    by_session = c.get(f"{API}/notes/search", params={"sessionKey": other}).json()
    assert [h["title"] for h in by_session] == ["Lecture 6 — Graphs"]
    assert len(c.get(f"{API}/notes/search", params={"limit": 1}).json()) == 1
    assert c.get(f"{API}/notes/search", params={"limit": 101}).status_code == 422
    assert make_member().get(f"{API}/notes/search").json() == []
