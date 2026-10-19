from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract
API = "/api/v1"


def v(n: int) -> dict[str, str]:
    return {"If-Match": f'"{n}"'}


def setup_tree(c: TestClient) -> dict[str, Any]:
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    node = c.get(f"{API}/course-tree").json()[0]
    return {
        "year": node["year"],
        "semester": node["semesters"][0]["semester"],
        "course": node["semesters"][0]["courses"][0],
        "class": cls,
    }


@pytest.mark.parametrize("kind", ["years", "semesters", "courses"])
def test_rename(owner_client: TestClient, kind: str) -> None:
    c = owner_client
    t = setup_tree(c)
    item = t[kind[:-1]]
    r = c.patch(f"{API}/{kind}/{item['id']}", json={"name": "Renamed"}, headers=v(item["version"]))
    assert r.status_code == 200, r.text
    check(r.json(), {"years": "Year", "semesters": "Semester", "courses": "Course"}[kind])
    assert r.json()["name"] == "Renamed" and r.json()["version"] == item["version"] + 1
    assert_problem(
        c.patch(f"{API}/{kind}/{item['id']}", json={"name": "Again"}, headers=v(item["version"])),
        412,
        "version_conflict",
    )
    assert_problem(
        c.patch(f"{API}/{kind}/{item['id']}", json={"name": "Again"}), 428, "if_match_required"
    )
    assert_problem(
        c.patch(f"{API}/{kind}/nope", json={"name": "x"}, headers=v(1)), 404, "not_found"
    )


def test_rename_to_taken_name(owner_client: TestClient) -> None:
    c = owner_client
    y1 = c.post(f"{API}/years", json={"name": "2026"}).json()
    c.post(f"{API}/years", json={"name": "2027"})
    assert_problem(
        c.patch(f"{API}/years/{y1['id']}", json={"name": "2027"}, headers=v(1)), 409, "name_taken"
    )


def test_semester_dates(owner_client: TestClient) -> None:
    c = owner_client
    t = setup_tree(c)  # class repeats until semester end
    s = t["semester"]
    r = c.patch(
        f"{API}/semesters/{s['id']}", json={"endDate": "2026-12-20"}, headers=v(s["version"])
    )
    assert r.status_code == 200 and r.json()["endDate"] == "2026-12-20"
    assert_problem(
        c.patch(
            f"{API}/semesters/{s['id']}", json={"endDate": None}, headers=v(r.json()["version"])
        ),
        422,
        "semester_end_in_use",
    )
    assert_problem(
        c.patch(
            f"{API}/semesters/{s['id']}",
            json={"startDate": "2027-01-01"},
            headers=v(r.json()["version"]),
        ),
        422,
        "invalid_date_range",
    )


def test_deletion_impact_and_delete(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    t = setup_tree(c)
    folder = tmp_data_dir / "files" / "owner" / "2026" / "Fall 2026" / "CS 201"
    (folder / "lecture.md").write_text("# notes")
    imp = c.get(f"{API}/years/{t['year']['id']}/deletion-impact")
    assert imp.status_code == 200
    check(imp.json(), "DeletionImpact")
    none = {"events": 0, "notes": 0, "recordings": 0, "documents": 0}  # 009 additions
    none |= {"linkedTaskCount": 0, "taskCount": 0}  # 012 additions
    assert imp.json() == {
        "semesters": 1,
        "courses": 1,
        "classes": 1,
        **none,
        "keptFolder": "2026",
    }
    simp = c.get(f"{API}/semesters/{t['semester']['id']}/deletion-impact").json()
    assert simp == {
        "semesters": 0,
        "courses": 1,
        "classes": 1,
        **none,
        "keptFolder": "2026/Fall 2026",
    }
    cimp = c.get(f"{API}/courses/{t['course']['id']}/deletion-impact").json()
    assert cimp["classes"] == 1 and cimp["keptFolder"] == "2026/Fall 2026/CS 201"

    assert_problem(c.delete(f"{API}/courses/{t['course']['id']}"), 428, "if_match_required")
    r = c.delete(f"{API}/courses/{t['course']['id']}", headers=v(t["course"]["version"]))
    assert r.status_code == 204
    assert (folder / "lecture.md").exists()  # FR-019
    assert c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"}).json() == []
    sem = c.get(f"{API}/semesters", params={"yearId": t["year"]["id"]}).json()[0]
    assert c.delete(f"{API}/semesters/{sem['id']}", headers=v(sem["version"])).status_code == 204
    year = c.get(f"{API}/years").json()[0]
    assert c.delete(f"{API}/years/{year['id']}", headers=v(year["version"])).status_code == 204
    assert c.get(f"{API}/course-tree").json() == []
    assert folder.exists()


def test_course_tree_search(owner_client: TestClient) -> None:
    c = owner_client
    c.post(f"{API}/classes", json=new_class_body())
    c.post(
        f"{API}/classes",
        json=new_class_body(
            course={
                "new": {
                    "name": "Math 203",
                    "semester": {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}},
                }
            }
        ),
    )

    def names(r: Any) -> list[str]:
        return [co["name"] for n in r.json() for s in n["semesters"] for co in s["courses"]]

    assert names(c.get(f"{API}/course-tree", params={"q": "cs"})) == ["CS 201"]
    assert names(c.get(f"{API}/course-tree", params={"q": "MATH"})) == ["Math 203"]
    assert c.get(f"{API}/course-tree", params={"q": "zzz"}).json() == []


def test_year_order(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    ids = [c.post(f"{API}/years", json={"name": n}).json()["id"] for n in ("2024", "2025", "2026")]
    # newest created is on top
    assert [y["name"] for y in c.get(f"{API}/years").json()] == ["2026", "2025", "2024"]
    r = c.put(f"{API}/years/order", json={"yearIds": ids})  # 2024, 2025, 2026
    assert r.status_code == 200
    check(r.json(), "Year", many=True)
    assert [(y["name"], y["position"]) for y in r.json()] == [("2024", 0), ("2025", 1), ("2026", 2)]
    assert [n["year"]["name"] for n in c.get(f"{API}/course-tree").json()] == [
        "2024",
        "2025",
        "2026",
    ]
    for bad in (ids[:2], [*ids, ids[0]], [*ids, "nope"]):
        assert_problem(c.put(f"{API}/years/order", json={"yearIds": bad}), 409, "order_mismatch")
    member = make_member()
    mine = member.post(f"{API}/years", json={"name": "Mine"}).json()["id"]
    assert_problem(
        member.put(f"{API}/years/order", json={"yearIds": [mine, ids[0]]}), 409, "order_mismatch"
    )
    assert_problem(c.put(f"{API}/years/order", json={}), 422, "validation_failed")
    # new year goes to the top; deleting closes the gap
    new = c.post(f"{API}/years", json={"name": "2027"}).json()
    assert new["position"] == 0
    mid = c.get(f"{API}/years").json()[2]
    c.delete(f"{API}/years/{mid['id']}", headers=v(mid["version"]))
    assert [y["position"] for y in c.get(f"{API}/years").json()] == [0, 1, 2]


# ---- 012: tasks when a year, semester or course is deleted -----------------------------------


def _event_in(c: TestClient, semester_id: str, title: str) -> dict[str, Any]:
    from tests.contract.event_helpers import make_event

    return make_event(c, title=title, semester={"id": semester_id}, startDate="2026-10-01")


def test_course_delete_makes_tasks_personal(owner_client: TestClient) -> None:
    from tests.contract.test_task_columns import add_task, tasks

    c = owner_client
    t = setup_tree(c)
    course_id = t["course"]["id"]
    task = add_task(c, "Homework")
    r = c.patch(f"{API}/tasks/{task['id']}", json={"courseId": course_id}, headers=v(1))
    assert r.status_code == 200, r.text
    imp = c.get(f"{API}/courses/{course_id}/deletion-impact")
    assert imp.status_code == 200, imp.text
    check(imp.json(), "CourseTaskImpact", spec="012")
    assert imp.json()["taskCount"] == 1 and imp.json()["linkedTaskCount"] == 0
    r = c.delete(
        f"{API}/courses/{course_id}",
        params={"linkedTasks": "delete"},
        headers=v(t["course"]["version"]),
    )
    assert r.status_code == 204, r.text
    (after,) = tasks(c)
    assert after["id"] == task["id"] and after["courseId"] is None and after["courseName"] is None


@pytest.mark.parametrize("kind", ["years", "semesters"])
def test_delete_with_linked_tasks(owner_client: TestClient, kind: str) -> None:
    from tests.contract.test_tasks import link_task, task_of

    c = owner_client
    t = setup_tree(c)
    sem_id = t["semester"]["id"]
    kept_ev = _event_in(c, sem_id, "Kept talk")
    gone_ev = _event_in(c, sem_id, "Gone talk")
    kept = link_task(c, f"{kept_ev['lineageId']}:2026-10-01")
    gone = link_task(c, f"{gone_ev['lineageId']}:2026-10-01")
    entity = t["year"] if kind == "years" else t["semester"]
    imp = c.get(f"{API}/{kind}/{entity['id']}/deletion-impact")
    check(imp.json(), "DeletionImpact")
    check(imp.json(), "LinkedTaskImpact", spec="012")
    assert imp.json()["linkedTaskCount"] == 2 and imp.json()["events"] == 2
    if kind == "years":
        entity = c.get(f"{API}/years").json()[0]
    else:
        entity = c.get(f"{API}/semesters", params={"yearId": t["year"]["id"]}).json()[0]
    # keep one by unlinking it first through a session delete with the default (keep)
    r = c.delete(
        f"{API}/sessions/{kept_ev['lineageId']}:2026-10-01",
        params={"scope": "all"},
        headers=v(kept_ev["version"]),
    )
    assert r.status_code == 200, r.text
    r = c.delete(
        f"{API}/{kind}/{entity['id']}",
        params={"linkedTasks": "delete"},
        headers=v(entity["version"]),
    )
    assert r.status_code == 204, r.text
    k = task_of(c, kept["id"])
    assert k is not None and k["event"] is None and k["title"] == "Kept talk"
    assert task_of(c, gone["id"]) is None
    entries = {e["label"]: e for e in c.get(f"{API}/trash", params={"kind": "event"}).json()}
    assert entries["Gone talk"]["taskCount"] == 1 and entries["Kept talk"]["taskCount"] == 0


def test_delete_semester_keeps_linked_tasks_by_default(owner_client: TestClient) -> None:
    from tests.contract.test_tasks import link_task, task_of

    c = owner_client
    t = setup_tree(c)
    ev = _event_in(c, t["semester"]["id"], "Talk")
    task = link_task(c, f"{ev['lineageId']}:2026-10-01")
    sem = c.get(f"{API}/semesters", params={"yearId": t["year"]["id"]}).json()[0]
    r = c.delete(f"{API}/semesters/{sem['id']}", headers=v(sem["version"]))
    assert r.status_code == 204, r.text
    k = task_of(c, task["id"])
    assert k is not None and k["event"] is None
    assert (k["title"], k["dueDate"], k["dueTime"]) == ("Talk", "2026-10-01", "14:00")
    (entry,) = c.get(f"{API}/trash", params={"kind": "event"}).json()
    assert entry["taskCount"] == 0
