"""020 tags contract (T043): unique names ignoring case, rename/recolor, delete untags."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.time_helpers import (
    API,
    T0,
    Clock,
    act,
    entries,
    start,
    tag,
    timer_call,
    v,
)

pytestmark = pytest.mark.contract


def tags(c: TestClient) -> list[dict[str, object]]:
    r = c.get(f"{API}/tags")
    assert r.status_code == 200, r.text
    check(r.json(), "Tag", many=True, spec="020")
    return r.json()  # type: ignore[no-any-return]


def test_create_rules(owner_client: TestClient) -> None:
    c = owner_client
    h = tag(c, "  Homework ", "tag-3")
    assert (h["name"], h["color"], h["entryCount"]) == ("Homework", "tag-3", 0)
    assert_problem(c.post(f"{API}/tags", json={"name": "homework", "color": "tag-1"}), 409,
                   "tag_name_taken")  # fmt: skip
    assert_problem(c.post(f"{API}/tags", json={"name": "  ", "color": "tag-1"}), 422,
                   "name_required")  # fmt: skip
    assert_problem(c.post(f"{API}/tags", json={"name": "x" * 31, "color": "tag-1"}), 422,
                   "name_too_long")  # fmt: skip
    assert c.post(f"{API}/tags", json={"name": "Red", "color": "red"}).status_code == 422
    tag(c, "Exam prep")
    assert [t["name"] for t in tags(c)] == ["Exam prep", "Homework"]


def test_rename_recolor(owner_client: TestClient) -> None:
    c = owner_client
    a = tag(c, "Reading")
    tag(c, "Lab")
    r = c.patch(f"{API}/tags/{a['id']}", json={"name": "Readings", "color": "tag-5"},
                headers=v(a["version"]))  # fmt: skip
    assert r.status_code == 200 and (r.json()["name"], r.json()["color"]) == ("Readings", "tag-5")
    clash = c.patch(f"{API}/tags/{a['id']}", json={"name": "LAB"}, headers=v(r.json()["version"]))
    assert_problem(clash, 409, "tag_name_taken")


def test_delete_untags_entries_and_running_timer(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    h = tag(c)
    for _ in range(2):
        t = start(c, tagId=h["id"])["timer"]
        clock.tick(minutes=10)
        act(c, "stop", t["version"])
    start(c, tagId=h["id"])
    assert tags(c)[0]["entryCount"] == 2
    assert c.delete(f"{API}/tags/{h['id']}").status_code == 204
    assert tags(c) == []
    assert [e["tagId"] for e in entries(c, T0)] == [None, None]
    assert timer_call(c, "GET")["timer"]["tagId"] is None
    assert_problem(c.delete(f"{API}/tags/{h['id']}"), 404, "not_found")
