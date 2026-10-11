"""009: `_Events` is reserved for the semester's events folder (research R1) — course create,
rename and inline creation refuse it; the course tree flags pre-existing conflicts and counts
each semester's events."""

from __future__ import annotations

from datetime import date, time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body
from unihelper.models import Course, EventSeries, User

pytestmark = pytest.mark.contract
API = "/api/v1"
RESERVED = ["_Events", "_events", " _Events. ", "_EVENTS"]


def v(n: int) -> dict[str, str]:
    return {"If-Match": f'"{n}"'}


def _semester(c: TestClient) -> dict[str, Any]:
    year = c.post(f"{API}/years", json={"name": "2026"}).json()
    return c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Fall 2026"}).json()


def _reserved(r: Any) -> None:
    body = assert_problem(r, 422, "reserved_name")
    assert body["errors"][0]["field"] == "/name"
    assert body["errors"][0]["message"] == "“_Events” is reserved for events."


@pytest.mark.parametrize("name", RESERVED)
def test_create_course_with_reserved_name(owner_client: TestClient, name: str) -> None:
    c = owner_client
    sem = _semester(c)
    _reserved(c.post(f"{API}/courses", json={"semesterId": sem["id"], "name": name}))
    ok = c.post(f"{API}/courses", json={"semesterId": sem["id"], "name": "_Events 2"})
    assert ok.status_code == 201 and ok.json()["folderName"] == "_Events 2"
    r = c.post(f"{API}/courses", json={"semesterId": sem["id"], "name": "Events"})
    assert r.status_code == 201


def test_rename_course_to_reserved_name(owner_client: TestClient) -> None:
    c = owner_client
    sem = _semester(c)
    course = c.post(f"{API}/courses", json={"semesterId": sem["id"], "name": "CS 201"}).json()
    _reserved(c.patch(f"{API}/courses/{course['id']}", json={"name": "_events"}, headers=v(1)))
    assert c.get(f"{API}/courses/{course['id']}").json()["name"] == "CS 201"


def test_inline_course_with_reserved_name(owner_client: TestClient) -> None:
    c = owner_client
    body = new_class_body()
    body["course"]["new"]["name"] = "_Events"
    r = c.post(f"{API}/classes", json=body)
    body = assert_problem(r, 422, "reserved_name")
    assert body["errors"][0]["field"] == "/name"
    assert c.get(f"{API}/course-tree").json() == []  # nothing created (one transaction)


def test_course_tree_flags_conflicts_and_counts_events(app: Any, owner_client: TestClient) -> None:
    c = owner_client
    c.post(f"{API}/classes", json=new_class_body())
    sem_id = c.get(f"{API}/course-tree").json()[0]["semesters"][0]["semester"]["id"]
    with app.state.sessionmaker() as db:  # a course created before 009 under the reserved name
        user = db.query(User).one()
        db.add(
            Course(
                user_id=user.id,
                semester_id=sem_id,
                name="_Events",
                name_key="_events",
                folder_name="_Events",
                folder_key="_events",
            )
        )
        for lineage in ("ev1", "ev1", "ev2"):  # two events, one of them with two segments
            db.add(
                EventSeries(
                    user_id=user.id,
                    semester_id=sem_id,
                    lineage_id=lineage,
                    title="AI Seminar",
                    start_date=date(2026, 10, 15),
                    start_time=time(14, 0),
                    end_time=time(15, 30),
                    freq="none",
                    end_kind="never",
                )
            )
        db.commit()
    tree = c.get(f"{API}/course-tree").json()
    check(tree, "YearNode", many=True)
    node = tree[0]["semesters"][0]
    assert node["eventCount"] == 2
    flags = {co["name"]: co["reservedNameConflict"] for co in node["courses"]}
    assert flags == {"CS 201": False, "_Events": True}
    # renaming the conflicting course clears the flag and moves its folder out of the way
    conflict = next(co for co in node["courses"] if co["name"] == "_Events")
    r = c.patch(
        f"{API}/courses/{conflict['id']}", json={"name": "Seminars"}, headers=v(conflict["version"])
    )
    assert r.status_code == 200, r.text
    assert (r.json()["folderName"], r.json()["reservedNameConflict"]) == ("Seminars", False)


@pytest.mark.parametrize("kind", ["years", "semesters", "courses"])
def test_delete_with_session_content_still_works(
    owner_client: TestClient, tmp_data_dir: Any, kind: str
) -> None:
    """`session_folders.course_id` is SET NULL since 0010; until hierarchy deletes move
    lineages to the Trash (US4) the folder rows go as before and the files stay on disk."""
    from tests.contract.notes_helpers import create_note, make_session

    c = owner_client
    key = make_session(c)
    create_note(c, key, "Lecture", "# hello")
    node = c.get(f"{API}/course-tree").json()[0]
    item = {
        "years": node["year"],
        "semesters": node["semesters"][0]["semester"],
        "courses": node["semesters"][0]["courses"][0],
    }[kind]
    r = c.delete(f"{API}/{kind}/{item['id']}", headers=v(item["version"]))
    assert r.status_code == 204, r.text
    note = tmp_data_dir / "files/owner/2026/Fall 2026/CS 201/2026-09-28/notes/Lecture.md"
    assert note.read_text() == "# hello"
