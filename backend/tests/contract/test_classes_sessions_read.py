from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def new_class_body(**kw: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "course": {
            "new": {
                "name": "CS 201",
                "semester": {
                    "new": {
                        "name": "Fall 2026",
                        "startDate": "2026-09-21",
                        "endDate": "2026-10-31",
                        "year": {"new": {"name": "2026"}},
                    }
                },
            }
        },
        "title": "Lecture",
        "startDate": "2026-09-28",
        "startTime": "10:00",
        "endTime": "11:30",
        "location": "FENS G032",
        "color": "blue",
        "links": [{"label": "Course site", "url": "https://cs201.example.edu"}],
        "recurrence": {
            "freq": "weekly",
            "byWeekday": ["MO", "WE"],
            "end": {"kind": "semester_end"},
        },
    }
    body.update(kw)
    return body


def test_create_class_inline_and_by_id(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(f"{API}/classes", json=new_class_body())
    assert r.status_code == 201, r.text
    check(r.json(), "ClassSeries")
    assert r.json()["lineageId"] == r.json()["id"]
    course_id = r.json()["courseId"]
    by_id = c.post(
        f"{API}/classes", json=new_class_body(course={"id": course_id}, title="Lab", color="green")
    )
    assert by_id.status_code == 201
    assert by_id.json()["courseId"] == course_id


def test_create_class_errors(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    course_id = c.post(f"{API}/classes", json=new_class_body()).json()["courseId"]
    member = make_member()
    assert_problem(
        member.post(f"{API}/classes", json=new_class_body(course={"id": course_id})),
        404,
        "not_found",
    )
    bad = c.post(f"{API}/classes", json=new_class_body(endTime="09:00"))
    body = assert_problem(bad, 422, "invalid_time_range")
    assert body["errors"][0]["field"] == "/endTime"
    bad = c.post(
        f"{API}/classes",
        json=new_class_body(
            recurrence={"freq": "weekly", "byWeekday": ["MO"], "end": {"kind": "until"}}
        ),
    )
    body = assert_problem(bad, 422, "until_required")
    assert body["errors"][0]["field"] == "/recurrence/end/untilDate"
    no_end = new_class_body(
        course={
            "new": {
                "name": "X",
                "semester": {"new": {"name": "No dates", "year": {"new": {"name": "2027"}}}},
            }
        }
    )
    assert_problem(c.post(f"{API}/classes", json=no_end), 422, "semester_end_missing")
    assert_problem(
        c.post(f"{API}/classes", json=new_class_body(links=[{"url": "nope"}])),
        422,
        "validation_failed",
    )


def test_get_lineage(owner_client: TestClient) -> None:
    c = owner_client
    lineage = c.post(f"{API}/classes", json=new_class_body()).json()["lineageId"]
    r = c.get(f"{API}/classes/{lineage}")
    assert r.status_code == 200
    check(r.json(), "ClassDetail")
    assert r.json()["exceptionCount"] == 0 and len(r.json()["segments"]) == 1
    assert_problem(c.get(f"{API}/classes/does-not-exist"), 404, "not_found")


def test_sessions_list_and_get(owner_client: TestClient) -> None:
    c = owner_client
    created = c.post(f"{API}/classes", json=new_class_body()).json()
    other = c.post(
        f"{API}/classes",
        json=new_class_body(
            course={
                "new": {
                    "name": "MATH 203",
                    "semester": {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}},
                }
            },
            startTime="09:00",
            endTime="09:50",
            recurrence={
                "freq": "weekly",
                "byWeekday": ["MO"],
                "end": {"kind": "count", "count": 3},
            },
        ),
    ).json()
    r = c.get(f"{API}/sessions", params={"from": "2026-09-28", "to": "2026-10-04"})
    assert r.status_code == 200
    check(r.json(), "Session", many=True)
    starts = [s["start"] for s in r.json()]
    assert starts == sorted(starts)
    assert len(r.json()) == 3  # Mon MATH, Mon CS, Wed CS
    only = c.get(
        f"{API}/sessions",
        params={"from": "2026-09-28", "to": "2026-10-04", "courseId": created["courseId"]},
    )
    assert {s["courseId"] for s in only.json()} == {created["courseId"]}
    assert other["courseId"] != created["courseId"]
    assert_problem(
        c.get(f"{API}/sessions", params={"from": "2026-01-01", "to": "2027-03-01"}),
        422,
        "range_too_large",
    )
    key = r.json()[1]["key"]
    one = c.get(f"{API}/sessions/{key}")
    assert one.status_code == 200
    check(one.json(), "Session")
    assert one.json()["recurrenceSummary"] == "Weekly on Mon, Wed until semester end"
    assert_problem(c.get(f"{API}/sessions/garbage"), 404, "not_found")
    lineage = created["lineageId"]
    assert_problem(c.get(f"{API}/sessions/{lineage}:2026-09-29"), 404, "not_found")  # Tuesday


def test_unscheduled_session_with_content_is_still_found(owner_client: TestClient) -> None:
    from tests.contract.notes_helpers import create_note

    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    key = f"{cls['lineageId']}:2026-09-30"
    assert c.get(f"{API}/sessions/{key}").json()["scheduled"] is True
    create_note(c, key, "Notes")
    c.delete(
        f"{API}/sessions/{key}",
        params={"scope": "this"},
        headers={"If-Match": f'"{cls["version"]}"'},
    )
    r = c.get(f"{API}/sessions/{key}")
    assert r.status_code == 200
    check(r.json(), "Session")
    assert r.json()["scheduled"] is False and r.json()["start"].startswith("2026-09-30T10:00")
    # without content a cancelled session stays gone
    other = f"{cls['lineageId']}:2026-10-05"
    v = c.get(f"{API}/sessions/{other}").json()["seriesVersion"]
    c.delete(f"{API}/sessions/{other}", params={"scope": "this"}, headers={"If-Match": f'"{v}"'})
    assert_problem(c.get(f"{API}/sessions/{other}"), 404, "not_found")
