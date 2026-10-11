"""010 round trip (SC-004): what user A exports, user B imports with the file's saved targets —
years, semesters (with dates), courses, kinds, colours, times, locations and links come back;
importing the file again into A changes nothing."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.contract.calendar_io_helpers import (
    API,
    apply,
    default_plan,
    sessions,
    upload_bytes,
)
from tests.contract.event_helpers import make_event

pytestmark = pytest.mark.integration


def _class(c: TestClient, course: str, semester: dict[str, Any], **kw: Any) -> dict[str, Any]:
    body = {
        "course": {"new": {"name": course, "semester": semester}},
        "startDate": "2026-09-28",
        "startTime": "10:00",
        "endTime": "11:30",
        "color": "teal",
        "location": "FENS G032",
        "links": [{"label": "Page", "url": "https://lms.example.edu/la"}],
        "recurrence": {
            "freq": "weekly",
            "byWeekday": ["MO", "WE"],
            "end": {"kind": "until", "untilDate": "2026-12-30"},
        },  # fmt: skip
    }
    body.update(kw)
    r = c.post(f"{API}/classes", json=body)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def _normal(items: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return sorted(
        (
            s["kind"],
            s["courseName"] if s["kind"] == "class" else s["title"],
            s["date"],
            s["start"][11:16],
            s["end"][11:16],
            s["location"],
            s["color"],
            tuple((link["label"], link["url"]) for link in s["links"]),
        )
        for s in items
    )


def _tree(c: TestClient) -> list[tuple[Any, ...]]:
    out = []
    for node in c.get(f"{API}/course-tree").json():
        for sem in node["semesters"]:
            names = tuple(sorted(x["name"] for x in sem["courses"]))
            out.append((node["year"]["name"], sem["semester"]["name"], names, sem["eventCount"]))
    return sorted(out)


def test_export_import_round_trip(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    a = owner_client
    fall = {"new": {"name": "Fall 2026", "startDate": "2026-09-21", "endDate": "2027-01-08",
                    "year": {"new": {"name": "2026"}}}}  # fmt: skip
    la = _class(a, "Linear Algebra", fall)
    fall_id = (
        la["courseId"] and a.get(f"{API}/classes/{la['lineageId']}").json()["course"]["semesterId"]
    )
    # a moved session (time change on the same day) and a cancelled one
    key = f"{la['lineageId']}:2026-10-14"
    r = a.patch(f"{API}/sessions/{key}", params={"scope": "this"},
                json={"startTime": "10:30", "endTime": "12:00", "location": "FENS L045"},
                headers={"If-Match": f'"{la["version"]}"'})  # fmt: skip
    assert r.status_code == 200, r.text
    r = a.delete(f"{API}/sessions/{la['lineageId']}:2026-10-12", params={"scope": "this"},
                 headers={"If-Match": f'"{la["version"]}"'})  # fmt: skip
    assert r.status_code == 200, r.text
    # "this and following" makes a second segment of the same lineage
    r = a.patch(f"{API}/sessions/{la['lineageId']}:2026-11-02", params={"scope": "following"},
                json={"startTime": "11:00", "endTime": "12:30"},
                headers={"If-Match": f'"{la["version"]}"'})  # fmt: skip
    assert r.status_code == 200, r.text
    _class(a, "Physics II", {"id": fall_id}, color="orange", links=[],
           recurrence={"freq": "weekly", "byWeekday": ["TU"],
                       "end": {"kind": "count", "count": 10}})  # fmt: skip
    make_event(a, semester={"id": fall_id}, color="pink",
               links=[{"label": "Talk", "url": "https://ai.example.edu"}])  # fmt: skip
    spring = {"new": {"name": "Spring 2027", "year": {"new": {"name": "2027"}}}}
    weekly3 = {"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 3}}
    make_event(a, title="Study group", semester=spring, startDate="2027-02-18", recurrence=weekly3)
    exported = a.get(f"{API}/calendar-export")
    assert exported.status_code == 200

    b = make_member("bea", timezone="Europe/Istanbul")
    r = upload_bytes(b, exported.content, "backup.ics")
    assert r.status_code == 201, r.text
    preview = r.json()
    assert preview["fromThisApp"]
    assert all(g["saved"] and g["defaults"]["selected"] for g in preview["groups"])
    unused = {"new": {"name": "Unused", "year": {"new": {"name": "X"}}}}
    applied = apply(b, preview["uploadId"], default_plan(preview, unused))
    assert applied.status_code == 200, applied.text
    result = applied.json()
    assert result["semesterId"] is None  # everything went to its saved semester

    span = ("2026-09-01", "2027-06-01")
    assert _normal(sessions(b, *span)) == _normal(sessions(a, *span))
    assert _tree(b) == _tree(a)
    sem = next(
        n["semester"] for y in b.get(f"{API}/course-tree").json() for n in y["semesters"]
        if n["semester"]["name"] == "Fall 2026"
    )  # fmt: skip
    assert (sem.get("startDate"), sem.get("endDate")) == ("2026-09-21", "2027-01-08")

    # A re-imports its own export: nothing new, nothing changed
    r = upload_bytes(a, exported.content, "backup.ics")
    again = apply(a, r.json()["uploadId"], default_plan(r.json(), {"id": fall_id})).json()
    assert again["classes"]["created"] == 0 and again["events"]["created"] == 0
    assert again["classes"]["updated"] == 0 and again["events"]["updated"] == 0
    assert _normal(sessions(a, *span)) == _normal(sessions(b, *span))
