from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract


def test_timeline(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()  # Mon+Wed until 2026-10-31
    course = cls["courseId"]
    lab = c.post(
        f"{API}/classes",
        json=new_class_body(
            course={"id": course},
            title="Lab",
            startTime="14:00",
            endTime="15:00",
            recurrence={
                "freq": "weekly",
                "byWeekday": ["FR"],
                "end": {"kind": "count", "count": 3},
            },
        ),
    ).json()
    key = f"{cls['lineageId']}:2026-09-30"
    create_note(c, key, "A")
    create_note(c, key, "B")
    r = c.get(f"{API}/courses/{course}/timeline")
    assert r.status_code == 200
    check(r.json(), "Timeline", spec="002")
    entries = r.json()["entries"]
    assert [e["start"] for e in entries] == sorted(e["start"] for e in entries)
    lectures = [e for e in entries if e["lineageId"] == cls["lineageId"]]
    labs = [e for e in entries if e["lineageId"] == lab["lineageId"]]
    assert len(lectures) == 10 and lectures[-1]["date"] == "2026-10-28"  # Mon+Wed to 31 Oct
    assert [e["date"] for e in labs] == ["2026-10-02", "2026-10-09", "2026-10-16"]  # count = 3
    by_key = {e["key"]: e for e in entries}
    assert by_key[key]["noteCount"] == 2 and by_key[key]["audioCount"] == 0
    assert all(e["scheduled"] for e in entries)

    # cancel the session that has notes → stays, marked unscheduled; cancel one without → gone
    c.delete(
        f"{API}/sessions/{key}",
        params={"scope": "this"},
        headers={"If-Match": f'"{cls["version"]}"'},
    )
    plain = f"{cls['lineageId']}:2026-10-05"
    c.delete(
        f"{API}/sessions/{plain}",
        params={"scope": "this"},
        headers={"If-Match": f'"{cls["version"]}"'},
    )
    entries = c.get(f"{API}/courses/{course}/timeline").json()["entries"]
    by_key = {e["key"]: e for e in entries}
    assert by_key[key]["scheduled"] is False and by_key[key]["noteCount"] == 2
    assert plain not in by_key

    member = make_member()
    assert_problem(member.get(f"{API}/courses/{course}/timeline"), 404, "not_found")
    assert_problem(c.get(f"{API}/courses/nope/timeline"), 404, "not_found")


def test_empty_course(owner_client: TestClient) -> None:
    c = owner_client
    y = c.post(f"{API}/years", json={"name": "2026"}).json()
    s = c.post(f"{API}/semesters", json={"yearId": y["id"], "name": "Fall"}).json()
    co = c.post(f"{API}/courses", json={"semesterId": s["id"], "name": "Empty"}).json()
    assert c.get(f"{API}/courses/{co['id']}/timeline").json() == {
        "courseId": co["id"],
        "entries": [],
    }
