"""009 US1: `GET /sessions` lists classes and events together; events stay out of course
timelines, `?courseId=` and every session count (FR-009)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.contract.event_helpers import API, make_event
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract


def _setup(c: TestClient) -> tuple[dict, dict]:  # type: ignore[type-arg]
    cls = c.post(f"{API}/classes", json=new_class_body()).json()  # Mon+Wed 10:00, Fall 2026
    course = c.get(f"{API}/courses/{cls['courseId']}").json()
    ev = make_event(
        c,
        semester={"id": course["semesterId"]},
        startDate="2026-09-30",  # a Wednesday, overlapping the class
        startTime="10:30",
        endTime="12:00",
        recurrence={"freq": "weekly", "byWeekday": ["WE"], "end": {"kind": "count", "count": 3}},
    )
    return cls, ev


def test_sessions_list_classes_and_events(owner_client: TestClient) -> None:
    c = owner_client
    cls, ev = _setup(c)
    r = c.get(f"{API}/sessions", params={"from": "2026-09-28", "to": "2026-10-04"})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [s["start"] for s in rows] == sorted(s["start"] for s in rows)
    classes = [s for s in rows if s["kind"] == "class"]
    events = [s for s in rows if s["kind"] == "event"]
    assert [s["date"] for s in classes] == ["2026-09-28", "2026-09-30"]
    assert [s["date"] for s in events] == ["2026-09-30"]
    for s in classes:
        check(s, "Session")
        assert s["courseId"] == cls["courseId"] and s["seriesId"] == cls["id"]
        assert s["semesterId"] == ev["semesterId"]
    (e,) = events
    check(e, "SessionAddition", spec="009")
    assert e["title"] == "AI Seminar" and e["semesterId"] == ev["semesterId"]
    assert e["courseId"] is None and e["courseName"] is None and e["seriesId"] is None
    assert e["lineageId"] == ev["lineageId"] and e["key"] == f"{ev['lineageId']}:2026-09-30"
    assert e["color"] == "blue" and e["recurrenceSummary"] == "Weekly on Wed, 3 times"
    assert isinstance(e["seriesVersion"], int)

    only_course = c.get(
        f"{API}/sessions",
        params={"from": "2026-09-28", "to": "2026-10-04", "courseId": cls["courseId"]},
    ).json()
    assert {s["kind"] for s in only_course} == {"class"} and len(only_course) == 2


def test_events_never_count_as_sessions(owner_client: TestClient) -> None:
    c = owner_client
    cls, ev = _setup(c)
    timeline = c.get(f"{API}/courses/{cls['courseId']}/timeline").json()["entries"]
    assert len(timeline) == 10  # Mon+Wed until 31 Oct — unchanged by the 3 events
    assert all(e["lineageId"] == cls["lineageId"] for e in timeline)
    impact = c.get(f"{API}/courses/{cls['courseId']}/deletion-impact").json()
    assert impact["classes"] == 1
    sem_impact = c.get(f"{API}/semesters/{ev['semesterId']}/deletion-impact").json()
    assert sem_impact["classes"] == 1 and sem_impact["courses"] == 1


def test_create_class_reports_created_rows(owner_client: TestClient) -> None:
    c = owner_client
    first = c.post(f"{API}/classes", json=new_class_body()).json()
    check(first, "ClassSeries")
    check(first["created"], "CreatedRefs", spec="009")
    made = first["created"]
    assert made["lineageId"] == first["lineageId"] and made["courseId"] == first["courseId"]
    assert made["semesterId"] and made["yearId"]
    again = c.post(f"{API}/classes", json=new_class_body(course={"id": first["courseId"]})).json()
    assert again["created"] == {"lineageId": again["lineageId"]}  # nothing new in the hierarchy
