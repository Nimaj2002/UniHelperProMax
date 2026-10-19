"""Quick notes of a task (012 T054): list, create, edit, delete + restore, isolation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.test_task_columns import add_task, tasks, v

pytestmark = pytest.mark.contract
API = "/api/v1"


def new_note(c: TestClient, task_id: str, **body: str) -> dict[str, Any]:
    r = c.post(f"{API}/tasks/{task_id}/quick-notes", json=body)
    assert r.status_code == 201, r.text
    check(r.json(), "QuickNote", spec="012")
    return r.json()  # type: ignore[no-any-return]


def notes(c: TestClient, task_id: str) -> list[dict[str, Any]]:
    r = c.get(f"{API}/tasks/{task_id}/quick-notes")
    assert r.status_code == 200, r.text
    check(r.json(), "QuickNote", many=True, spec="012")
    return r.json()  # type: ignore[no-any-return]


def test_create_and_list_newest_first(owner_client: TestClient) -> None:
    c = owner_client
    t = add_task(c, "Essay")
    assert notes(c, t["id"]) == []
    a = new_note(c, t["id"], title="Sources")
    b = new_note(c, t["id"], body="Ask about length")
    assert (a["title"], a["body"], a["taskId"], a["version"]) == ("Sources", "", t["id"], 1)
    assert [n["id"] for n in notes(c, t["id"])] == [b["id"], a["id"]]
    assert tasks(c)[0]["quickNoteCount"] == 2


def test_empty_note_is_refused(owner_client: TestClient) -> None:
    c = owner_client
    t = add_task(c, "Essay")
    for body in ({"title": "  ", "body": " \n"}, {"title": ""}):
        assert_problem(
            c.post(f"{API}/tasks/{t['id']}/quick-notes", json=body), 422, "empty_quick_note"
        )
    assert_problem(c.post(f"{API}/tasks/{t['id']}/quick-notes", json={}), 422, "validation_failed")
    assert_problem(
        c.post(f"{API}/tasks/{t['id']}/quick-notes", json={"title": "x" * 201}),
        422,
        "validation_failed",
    )
    assert_problem(c.post(f"{API}/tasks/nope/quick-notes", json={"body": "x"}), 404, "not_found")
    assert_problem(c.get(f"{API}/tasks/nope/quick-notes"), 404, "not_found")


def test_patch(owner_client: TestClient) -> None:
    c = owner_client
    t = add_task(c, "Essay")
    n = new_note(c, t["id"], title="Draft")
    r = c.patch(f"{API}/quick-notes/{n['id']}", json={"body": "First line"}, headers=v(1))
    assert r.status_code == 200, r.text
    check(r.json(), "QuickNote", spec="012")
    assert (r.json()["title"], r.json()["body"], r.json()["version"]) == ("Draft", "First line", 2)
    assert_problem(
        c.patch(f"{API}/quick-notes/{n['id']}", json={"body": "x"}, headers=v(1)),
        412,
        "version_conflict",
    )
    assert_problem(
        c.patch(f"{API}/quick-notes/{n['id']}", json={"body": "x"}), 428, "if_match_required"
    )
    assert_problem(
        c.patch(f"{API}/quick-notes/{n['id']}", json={}, headers=v(2)), 422, "validation_failed"
    )
    assert_problem(
        c.patch(f"{API}/quick-notes/nope", json={"body": "x"}, headers=v(1)), 404, "not_found"
    )


def test_delete_and_restore(owner_client: TestClient) -> None:
    c = owner_client
    t = add_task(c, "Essay")
    a = new_note(c, t["id"], title="A")
    b = new_note(c, t["id"], title="B")
    assert_problem(c.delete(f"{API}/quick-notes/{a['id']}", headers=v(5)), 412, "version_conflict")
    assert_problem(c.delete(f"{API}/quick-notes/{a['id']}"), 428, "if_match_required")
    r = c.delete(f"{API}/quick-notes/{a['id']}", headers=v(1))
    assert r.status_code == 204, r.text
    assert [n["id"] for n in notes(c, t["id"])] == [b["id"]]
    assert tasks(c)[0]["quickNoteCount"] == 1
    assert_problem(
        c.patch(f"{API}/quick-notes/{a['id']}", json={"body": "x"}, headers=v(1)), 404, "not_found"
    )
    r = c.post(f"{API}/quick-notes/{a['id']}/restore")
    assert r.status_code == 200, r.text
    check(r.json(), "QuickNote", spec="012")
    assert [n["id"] for n in notes(c, t["id"])] == [b["id"], a["id"]]
    assert_problem(c.post(f"{API}/quick-notes/{a['id']}/restore"), 404, "not_found")
    assert_problem(c.post(f"{API}/quick-notes/nope/restore"), 404, "not_found")


def test_other_user_gets_not_found(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    t = add_task(c, "Essay")
    n = new_note(c, t["id"], title="Mine")
    other = make_member()
    assert_problem(other.get(f"{API}/tasks/{t['id']}/quick-notes"), 404, "not_found")
    assert_problem(
        other.post(f"{API}/tasks/{t['id']}/quick-notes", json={"body": "x"}), 404, "not_found"
    )
    assert_problem(
        other.patch(f"{API}/quick-notes/{n['id']}", json={"body": "x"}, headers=v(1)),
        404,
        "not_found",
    )
    assert_problem(other.delete(f"{API}/quick-notes/{n['id']}", headers=v(1)), 404, "not_found")
    assert c.delete(f"{API}/quick-notes/{n['id']}", headers=v(1)).status_code == 204
    assert_problem(other.post(f"{API}/quick-notes/{n['id']}/restore"), 404, "not_found")
