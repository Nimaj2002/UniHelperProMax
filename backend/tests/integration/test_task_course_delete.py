"""012 US7 (FR-058, research R18): deleting a course keeps its tasks as personal tasks (also
deleted ones awaiting Undo); restoring the course's classes from the Trash does not reassign
them. Real API, real SQLite."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.contract.test_classes_sessions_read import new_class_body
from tests.contract.test_task_columns import tasks

pytestmark = pytest.mark.integration
API = "/api/v1"


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def course_task(c: TestClient, title: str, course_id: str) -> dict[str, Any]:
    r = c.post(f"{API}/tasks", json={"title": title, "courseId": course_id})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def test_course_delete_makes_tasks_personal(owner_client: TestClient) -> None:
    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    course_id = cls["courseId"]
    a = course_task(c, "Problem set", course_id)
    course_task(c, "Read ch. 2", course_id)
    undone = course_task(c, "Deleted one", course_id)
    personal = c.post(f"{API}/tasks", json={"title": "Groceries"}).json()
    assert c.delete(f"{API}/tasks/{undone['id']}", headers=im(1)).status_code == 204

    imp = c.get(f"{API}/courses/{course_id}/deletion-impact").json()
    assert imp["taskCount"] == 2 and imp["linkedTaskCount"] == 0  # live tasks only
    course = c.get(f"{API}/courses/{course_id}").json()
    r = c.delete(f"{API}/courses/{course_id}", headers=im(course["version"]))
    assert r.status_code == 204, r.text

    after = {t["title"]: t for t in tasks(c)}
    assert set(after) == {"Problem set", "Read ch. 2", "Groceries"}
    for t in after.values():
        assert t["courseId"] is None and t["courseName"] is None and t["courseColor"] is None
    assert after["Problem set"]["version"] > a["version"]  # clients see the change
    assert after["Groceries"]["version"] == personal["version"]
    # the deleted task awaiting Undo comes back personal too
    r = c.post(f"{API}/tasks/{undone['id']}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["courseId"] is None

    # restoring the course's classes recreates the course, but the tasks stay personal
    (entry,) = c.get(f"{API}/trash", params={"kind": "class"}).json()
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["recreated"]["course"] is True
    assert all(t["courseId"] is None for t in tasks(c))


def test_semester_and_year_delete_also_make_tasks_personal(owner_client: TestClient) -> None:
    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    t = course_task(c, "Essay", cls["courseId"])
    year = c.get(f"{API}/years").json()[0]
    imp = c.get(f"{API}/years/{year['id']}/deletion-impact").json()
    assert imp["taskCount"] == 1
    r = c.delete(f"{API}/years/{year['id']}", headers=im(year["version"]))
    assert r.status_code == 204, r.text
    (after,) = tasks(c)
    assert after["id"] == t["id"] and after["courseId"] is None
