"""009 US6 contract: POST /creations/undo (the quick form's Undo, research R10)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.event_helpers import API, make_event
from tests.contract.notes_helpers import create_note
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract

ROOT = "files/owner"


def undo(c: TestClient, made: dict[str, Any], version: int | None = None) -> Any:
    return c.post(
        f"{API}/creations/undo",
        json={
            "created": made["created"],
            "version": made["version"] if version is None else version,
        },
    )


def made_rows(made: dict[str, Any]) -> set[str]:
    return {k for k, v in made["created"].items() if v is not None}


def sessions(c: TestClient) -> list[dict[str, Any]]:
    r = c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"})
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def test_undo_fresh_event_in_existing_semester(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    first = make_event(c)  # creates year 2026 / Fall 2026
    semester_id = first["semesterId"]
    second = make_event(c, title="Exam", semester={"id": semester_id})
    assert made_rows(second) == {"lineageId"}

    r = undo(c, second)
    assert r.status_code == 204, r.text
    keys = {s["key"] for s in sessions(c)}
    assert not any(k.startswith(second["lineageId"]) for k in keys)
    assert any(k.startswith(first["lineageId"]) for k in keys)
    # the semester was not made by this creation: it stays
    assert c.get(f"{API}/semesters/{semester_id}/events/timeline").status_code == 200
    assert (tmp_data_dir / ROOT / "2026/Fall 2026").is_dir()
    # undone: no Trash entry
    assert c.get(f"{API}/trash").json() == []
    assert_problem(c.get(f"{API}/events/{second['lineageId']}"), 404, "not_found")


def test_undo_event_with_inline_year_and_semester(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    made = make_event(c)
    assert made_rows(made) == {"lineageId", "yearId", "semesterId"}
    assert (tmp_data_dir / ROOT / "2026/Fall 2026").is_dir()

    assert undo(c, made).status_code == 204
    assert c.get(f"{API}/years").json() == []
    assert not (tmp_data_dir / ROOT / "2026").exists()


def test_undo_class_with_inline_hierarchy(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    r = c.post(f"{API}/classes", json=new_class_body())
    assert r.status_code == 201, r.text
    made = r.json()
    assert made_rows(made) == {"lineageId", "yearId", "semesterId", "courseId"}
    assert (tmp_data_dir / ROOT / "2026/Fall 2026/CS 201").is_dir()

    assert undo(c, made).status_code == 204
    assert sessions(c) == []
    assert c.get(f"{API}/years").json() == []
    assert c.get(f"{API}/courses/{made['created']['courseId']}").status_code == 404
    assert not (tmp_data_dir / ROOT / "2026").exists()


def test_undo_keeps_directories_holding_files(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    made = c.post(f"{API}/classes", json=new_class_body()).json()
    stray = tmp_data_dir / ROOT / "2026/Fall 2026/CS 201/syllabus.txt"
    stray.write_text("mine", encoding="utf-8")

    assert undo(c, made).status_code == 204
    assert c.get(f"{API}/years").json() == []
    assert stray.read_text(encoding="utf-8") == "mine"  # never removes a file


def test_undo_unavailable_once_content_exists(owner_client: TestClient) -> None:
    c = owner_client
    made = make_event(c)
    create_note(c, f"{made['lineageId']}:2026-10-15", "Minutes")
    assert_problem(undo(c, made), 409, "undo_unavailable")
    assert c.get(f"{API}/events/{made['lineageId']}").status_code == 200


def test_undo_unavailable_when_created_course_is_used(owner_client: TestClient) -> None:
    c = owner_client
    made = c.post(f"{API}/classes", json=new_class_body()).json()
    other = c.post(
        f"{API}/classes",
        json=new_class_body(
            course={"id": made["created"]["courseId"]}, title="Lab", recurrence={"freq": "none"}
        ),
    )
    assert other.status_code == 201, other.text
    assert_problem(undo(c, made), 409, "undo_unavailable")
    assert len({s["lineageId"] for s in sessions(c)}) == 2


def test_undo_unavailable_when_created_semester_is_used(owner_client: TestClient) -> None:
    c = owner_client
    made = make_event(c)
    make_event(c, title="Exam", semester={"id": made["semesterId"]})
    assert_problem(undo(c, made), 409, "undo_unavailable")


def test_undo_stale_version(owner_client: TestClient) -> None:
    c = owner_client
    made = make_event(c)
    assert_problem(undo(c, made, version=made["version"] + 1), 412, "version_conflict")


def test_undo_unknown_lineage(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(f"{API}/creations/undo", json={"created": {"lineageId": "nope"}, "version": 1})
    assert_problem(r, 404, "not_found")


def test_undo_is_per_user(owner_client: TestClient, make_member: Any) -> None:
    made = make_event(owner_client)
    member = make_member()
    assert_problem(undo(member, made), 404, "not_found")
    assert owner_client.get(f"{API}/events/{made['lineageId']}").status_code == 200
