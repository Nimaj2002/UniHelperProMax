"""Task board columns (012 T011): seeding, create/rename, limits, reorder, done flag, delete."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def v(n: int) -> dict[str, str]:
    return {"If-Match": f'"{n}"'}


def columns(c: TestClient) -> list[dict[str, Any]]:
    r = c.get(f"{API}/task-columns")
    assert r.status_code == 200, r.text
    check(r.json(), "TaskColumn", many=True, spec="012")
    return r.json()  # type: ignore[no-any-return]


def tasks(c: TestClient) -> list[dict[str, Any]]:
    r = c.get(f"{API}/tasks")
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def add_task(c: TestClient, title: str, column_id: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"title": title}
    if column_id:
        body["columnId"] = column_id
    r = c.post(f"{API}/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def test_first_use_seeds_three_columns_once(owner_client: TestClient) -> None:
    c = owner_client
    cols = columns(c)
    assert [(x["name"], x["position"], x["countsAsDone"]) for x in cols] == [
        ("To do", 0, False),
        ("In progress", 1, False),
        ("Done", 2, True),
    ]
    assert all(x["taskCount"] == 0 and x["version"] == 1 for x in cols)
    assert [x["id"] for x in columns(c)] == [x["id"] for x in cols]  # idempotent


def test_create_and_rename(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(f"{API}/task-columns", json={"name": "  Waiting  "})
    assert r.status_code == 201, r.text
    check(r.json(), "TaskColumn", spec="012")
    col = r.json()
    assert col["name"] == "Waiting" and col["position"] == 3 and col["countsAsDone"] is False
    assert_problem(c.post(f"{API}/task-columns", json={"name": "waiting"}), 409, "name_taken")
    assert_problem(c.post(f"{API}/task-columns", json={"name": "TO DO"}), 409, "name_taken")
    assert_problem(c.post(f"{API}/task-columns", json={"name": "x" * 41}), 422, "validation_failed")
    assert_problem(c.post(f"{API}/task-columns", json={"name": "   "}), 422, "validation_failed")
    assert c.post(f"{API}/task-columns", json={"name": "y" * 40}).status_code == 201

    r = c.patch(f"{API}/task-columns/{col['id']}", json={"name": "Blocked"}, headers=v(1))
    assert r.status_code == 200, r.text
    check(r.json(), "TaskColumn", spec="012")
    assert r.json()["name"] == "Blocked" and r.json()["version"] == 2
    # renaming to its own name in another case is fine; to another column's name is not
    r = c.patch(f"{API}/task-columns/{col['id']}", json={"name": "BLOCKED"}, headers=v(2))
    assert r.status_code == 200 and r.json()["name"] == "BLOCKED"
    assert_problem(
        c.patch(f"{API}/task-columns/{col['id']}", json={"name": "done"}, headers=v(3)),
        409,
        "name_taken",
    )
    assert_problem(
        c.patch(f"{API}/task-columns/{col['id']}", json={}, headers=v(3)), 422, "validation_failed"
    )


def test_twelve_columns_at_most(owner_client: TestClient) -> None:
    c = owner_client
    for i in range(9):
        assert c.post(f"{API}/task-columns", json={"name": f"Col {i}"}).status_code == 201
    assert len(columns(c)) == 12
    assert_problem(c.post(f"{API}/task-columns", json={"name": "Thirteen"}), 409, "column_limit")


def test_reorder(owner_client: TestClient) -> None:
    c = owner_client
    ids = [x["id"] for x in columns(c)]
    new = [ids[2], ids[0], ids[1]]
    r = c.put(f"{API}/task-columns/order", json={"columnIds": new})
    assert r.status_code == 200, r.text
    check(r.json(), "TaskColumn", many=True, spec="012")
    assert [x["id"] for x in r.json()] == new
    assert [x["position"] for x in r.json()] == [0, 1, 2]
    assert [x["id"] for x in columns(c)] == new
    assert_problem(
        c.put(f"{API}/task-columns/order", json={"columnIds": new[:2]}), 409, "order_mismatch"
    )
    assert_problem(
        c.put(f"{API}/task-columns/order", json={"columnIds": [*new[:2], new[0]]}),
        409,
        "order_mismatch",
    )


def test_counts_as_done_sets_and_clears_completion(owner_client: TestClient) -> None:
    c = owner_client
    todo = columns(c)[0]
    add_task(c, "Read ch. 4")
    assert tasks(c)[0]["completedAt"] is None
    r = c.patch(f"{API}/task-columns/{todo['id']}", json={"countsAsDone": True}, headers=v(1))
    assert r.status_code == 200 and r.json()["countsAsDone"] is True
    assert r.json()["taskCount"] == 1
    assert tasks(c)[0]["completedAt"] is not None
    r = c.patch(f"{API}/task-columns/{todo['id']}", json={"countsAsDone": False}, headers=v(2))
    assert r.status_code == 200
    assert tasks(c)[0]["completedAt"] is None


def test_delete_columns(owner_client: TestClient) -> None:
    c = owner_client
    todo, doing, done = columns(c)
    # empty column: deleted at once, the others renumbered
    r = c.delete(f"{API}/task-columns/{doing['id']}", headers=v(1))
    assert r.status_code == 200, r.text
    check(r.json(), "TaskColumn", many=True, spec="012")
    assert [(x["name"], x["position"]) for x in r.json()] == [("To do", 0), ("Done", 1)]

    a = add_task(c, "A", done["id"])
    add_task(c, "B", todo["id"])
    add_task(c, "C", todo["id"])
    assert_problem(
        c.delete(f"{API}/task-columns/{todo['id']}", headers=v(1)), 409, "move_target_required"
    )
    assert_problem(
        c.delete(f"{API}/task-columns/{todo['id']}?moveTo=nope", headers=v(1)), 404, "not_found"
    )
    r = c.delete(f"{API}/task-columns/{todo['id']}?moveTo={done['id']}", headers=v(1))
    assert r.status_code == 200, r.text
    assert [(x["name"], x["taskCount"], x["position"]) for x in r.json()] == [("Done", 3, 0)]
    after = tasks(c)
    assert [(t["title"], t["position"]) for t in after] == [("A", 0), ("B", 1), ("C", 2)]
    assert all(t["columnId"] == done["id"] and t["completedAt"] for t in after)
    assert after[0]["completedAt"] == a["completedAt"]
    assert_problem(c.delete(f"{API}/task-columns/{done['id']}", headers=v(1)), 409, "last_column")


def test_versions_and_isolation(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    col = columns(c)[1]
    assert_problem(
        c.patch(f"{API}/task-columns/{col['id']}", json={"name": "X"}, headers=v(9)),
        412,
        "version_conflict",
    )
    assert_problem(
        c.patch(f"{API}/task-columns/{col['id']}", json={"name": "X"}), 428, "if_match_required"
    )
    assert_problem(
        c.delete(f"{API}/task-columns/{col['id']}", headers=v(9)), 412, "version_conflict"
    )
    assert_problem(c.delete(f"{API}/task-columns/{col['id']}"), 428, "if_match_required")

    other = make_member()
    assert len(columns(other)) == 3
    assert_problem(
        other.patch(f"{API}/task-columns/{col['id']}", json={"name": "X"}, headers=v(1)),
        404,
        "not_found",
    )
    assert_problem(other.delete(f"{API}/task-columns/{col['id']}", headers=v(1)), 404, "not_found")
    assert_problem(
        other.post(f"{API}/tasks", json={"title": "x", "columnId": col["id"]}), 404, "not_found"
    )
