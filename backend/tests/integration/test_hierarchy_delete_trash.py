"""009 FR-022a/b: deleting a year, semester or course moves each class and event lineage inside
to the Trash as its own entry (files untouched, folders detached); restoring one recreates the
missing year/semester/course by name (reusing their folders on disk) — real API, SQLite, files."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tests.contract.event_helpers import API, content_for, make_event
from tests.contract.notes_helpers import create_note
from tests.contract.test_classes_sessions_read import new_class_body
from unihelper.models import SessionException, SessionFolder, TrashEntry

pytestmark = pytest.mark.integration
ROOT = "files/owner/2026/Fall 2026"


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def tree(folder: Path) -> dict[str, str]:
    return {
        p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(folder.rglob("*"))
        if p.is_file()
    }


def setup(c: TestClient) -> dict[str, Any]:
    """Fall 2026 with CS 201 (Mon+Wed), Math (one-off) and the AI Seminar event, each with
    content; CS 201 also has one cancelled session."""
    cs = c.post(f"{API}/classes", json=new_class_body()).json()
    sem_id = c.get(f"{API}/courses/{cs['courseId']}").json()["semesterId"]
    math = c.post(
        f"{API}/classes",
        json=new_class_body(
            course={"new": {"name": "Math 101", "semester": {"id": sem_id}}},
            startDate="2026-10-02",
            recurrence={"freq": "none"},
        ),
    ).json()
    ev = make_event(c, semester={"id": sem_id})
    content_for(c, f"{cs['lineageId']}:2026-09-30")
    create_note(c, f"{math['lineageId']}:2026-10-02", "Math notes", "x")
    content_for(c, f"{ev['lineageId']}:2026-10-15")
    c.delete(
        f"{API}/sessions/{cs['lineageId']}:2026-10-05",
        params={"scope": "this"},
        headers=im(cs["version"]),
    )
    return {"cs": cs, "math": math, "event": ev, "semester_id": sem_id}


def all_sessions(c: TestClient) -> list[dict[str, Any]]:
    return c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"}).json()  # type: ignore[no-any-return]


def test_semester_delete_and_restore(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    t = setup(c)
    before_files = tree(tmp_data_dir / ROOT)
    before_sessions = {s["key"]: s for s in all_sessions(c)}
    impact = c.get(f"{API}/semesters/{t['semester_id']}/deletion-impact").json()
    assert (impact["courses"], impact["classes"], impact["events"]) == (2, 2, 1)
    assert (impact["notes"], impact["recordings"], impact["documents"]) == (3, 2, 2)
    sem = c.get(f"{API}/course-tree").json()[0]["semesters"][0]["semester"]
    r = c.delete(f"{API}/semesters/{sem['id']}", headers=im(sem["version"]))
    assert r.status_code == 204, r.text

    assert all_sessions(c) == []
    assert tree(tmp_data_dir / ROOT) == before_files  # nothing touched
    entries = c.get(f"{API}/trash").json()
    by_label = {(e["kind"], e["label"], e["occurrenceCount"]): e for e in entries}
    assert sorted(by_label) == [
        ("class", "CS 201", 1),  # the cancelled session, deleted earlier
        ("class", "CS 201", 9),
        ("class", "Math 101", 1),
        ("event", "AI Seminar", 1),
    ]
    with app.state.sessionmaker() as db:
        reasons = sorted(e.reason for e in db.scalars(select(TrashEntry)))
        assert reasons == ["delete", "hierarchy_delete", "hierarchy_delete", "hierarchy_delete"]
        folders = list(db.scalars(select(SessionFolder)))
        assert folders and all(f.course_id is None and f.semester_id is None for f in folders)
        assert all(f.trash_entry_id and f.origin_path for f in folders)
        assert list(db.scalars(select(SessionException))) == []  # captured in the payloads

    # restore the event: year and semester come back by name, its folder is reused on disk
    ev_entry = by_label[("event", "AI Seminar", 1)]
    r = c.post(f"{API}/trash/{ev_entry['id']}/restore", headers=im(ev_entry["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["recreated"] == {"year": False, "semester": True, "course": False}
    assert r.json()["movedFolders"] == 0
    tree_now = c.get(f"{API}/course-tree").json()
    assert tree_now[0]["year"]["name"] == "2026"
    assert tree_now[0]["semesters"][0]["semester"]["name"] == "Fall 2026"
    assert tree_now[0]["semesters"][0]["eventCount"] == 1
    ekey = f"{t['event']['lineageId']}:2026-10-15"
    assert [n["name"] for n in c.get(f"{API}/sessions/{ekey}/notes").json()] == ["Lecture"]

    # restoring a class into the semester that exists again recreates only its course
    cs_entry = by_label[("class", "CS 201", 9)]
    r = c.post(f"{API}/trash/{cs_entry['id']}/restore", headers=im(cs_entry["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["recreated"] == {"year": False, "semester": False, "course": True}
    # and the session deleted earlier rejoins its series
    rest = by_label[("class", "CS 201", 1)]
    r = c.post(f"{API}/trash/{rest['id']}/restore", headers=im(rest["version"]))
    assert r.status_code == 200, r.text
    math = by_label[("class", "Math 101", 1)]
    assert (
        c.post(f"{API}/trash/{math['id']}/restore", headers=im(math["version"])).status_code == 200
    )

    after = {s["key"]: s for s in all_sessions(c)}
    assert sorted(after) == sorted([*before_sessions, f"{t['cs']['lineageId']}:2026-10-05"])
    assert tree(tmp_data_dir / ROOT) == before_files
    ckey = f"{t['cs']['lineageId']}:2026-09-30"
    assert len(c.get(f"{API}/sessions/{ckey}/documents").json()) == 1
    assert c.get(f"{API}/trash").json() == []


def test_course_and_year_deletes_behave_the_same(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    t = setup(c)
    course = c.get(f"{API}/courses/{t['math']['courseId']}").json()
    assert (
        c.delete(f"{API}/courses/{course['id']}", headers=im(course["version"])).status_code == 204
    )
    labels = sorted(e["label"] for e in c.get(f"{API}/trash").json())
    assert labels == ["CS 201", "Math 101"]  # the course's class (+ the earlier cancel)
    year = c.get(f"{API}/years").json()[0]
    assert c.delete(f"{API}/years/{year['id']}", headers=im(year["version"])).status_code == 204
    labels = sorted(e["label"] for e in c.get(f"{API}/trash").json())
    assert labels == ["AI Seminar", "CS 201", "CS 201", "Math 101"]
    assert (tmp_data_dir / ROOT / "Math 101" / "2026-10-02" / "notes" / "Math notes.md").exists()
    # restore Math 101: year, semester and course recreated, folder reused on disk
    math = next(e for e in c.get(f"{API}/trash").json() if e["label"] == "Math 101")
    r = c.post(f"{API}/trash/{math['id']}/restore", headers=im(math["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["recreated"] == {"year": True, "semester": True, "course": True}
    key = f"{t['math']['lineageId']}:2026-10-02"
    assert [n["name"] for n in c.get(f"{API}/sessions/{key}/notes").json()] == ["Math notes"]
    tl = c.get(f"{API}/courses/{t['math']['courseId']}/timeline")
    assert tl.status_code == 404  # a new course row, same name and folder
    courses = c.get(f"{API}/courses").json()
    assert [x["name"] for x in courses] == ["Math 101"]


def test_renamed_parents_take_trashed_folders_along(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    t = setup(c)
    sem = c.get(f"{API}/course-tree").json()[0]["semesters"][0]["semester"]
    course = c.get(f"{API}/courses/{t['cs']['courseId']}").json()
    assert (
        c.delete(f"{API}/courses/{course['id']}", headers=im(course["version"])).status_code == 204
    )
    r = c.patch(
        f"{API}/semesters/{sem['id']}", json={"name": "Autumn 2026"}, headers=im(sem["version"])
    )
    assert r.status_code == 200, r.text
    entry = next(
        e
        for e in c.get(f"{API}/trash").json()
        if e["label"] == "CS 201" and e["occurrenceCount"] > 1
    )
    assert entry["missingFiles"] == 0
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["recreated"]["course"] is True and r.json()["recreated"]["semester"] is False
    folder = tmp_data_dir / "files/owner/2026/Autumn 2026/CS 201/2026-09-30"
    assert (folder / "notes" / "Lecture.md").read_text() == "# Notes"
